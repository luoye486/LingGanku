//! 命令层：把 HTTP 版的 `/api/*` 原样搬成 Tauri 命令。
//!
//! 前端不需要改写：`ui/bridge.js` 把 `fetch('/api/...')` 转成 `invoke('api_call')`，
//! 这里按同样的路径分发，返回同样的 JSON 结构。
use crate::ai;
#[path = "task_plan.rs"]
mod task_plan;
use crate::assets;
#[path = "recovery.rs"]
pub(crate) mod recovery;
use crate::config::{self, AiConfig, Config};
use crate::index::Index;
use crate::vault;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub cfg: Mutex<Config>,
    pub index: Mutex<Index>,
    pub assets: Mutex<Vec<Value>>,
    pub assets_summary: Mutex<Value>,
    pub last_assets_scan: Mutex<f64>,
    pub writes: Mutex<()>,
    pub semantic: crate::semantic::Engine,
    /// 最近一次已知的库指纹，后台监听线程用它判断「外面有没有改动」。
    pub watch_sig: Mutex<u64>,
    /// 后端要主动推事件（AI 流式输出）时需要 AppHandle，setup 时塞进来。
    pub handle: Mutex<Option<AppHandle>>,
}

impl AppState {
    pub fn new(cfg: Config) -> Self {
        Self {
            cfg: Mutex::new(cfg),
            index: Mutex::new(Index::new()),
            assets: Mutex::new(Vec::new()),
            assets_summary: Mutex::new(json!({ "total": 0, "size": 0, "cats": [] })),
            last_assets_scan: Mutex::new(0.0),
            writes: Mutex::new(()),
            semantic: crate::semantic::Engine::default(),
            watch_sig: Mutex::new(0),
            handle: Mutex::new(None),
        }
    }
}

/// 写之前先比一下磁盘上的修改时间：不一样说明 Obsidian 那边改过，
/// 直接覆盖会把别人的编辑吞掉，所以返回一个可识别的错误码让前端去问用户。
fn check_conflict(root: &Path, rel: &str, base: Option<f64>) -> Result<(), String> {
    let Some(base) = base else { return Ok(()) };
    match vault::note_mtime(root, rel) {
        Some(cur) if (cur - base).abs() < 0.001 => Ok(()),
        _ => Err("E_CONFLICT".to_string()),
    }
}

/// 自己写完之后同步一下指纹，免得后台监听把自己的改动当成外部改动。
fn touch_sig(state: &State<AppState>) {
    let root = vault_root(state);
    let sig = vault::signature(&root);
    *state.watch_sig.lock().unwrap() = sig;
}

fn now_ts() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

fn vault_root(state: &State<AppState>) -> PathBuf {
    let cfg = state.cfg.lock().unwrap();
    PathBuf::from(&cfg.vault)
}

fn library_root(state: &State<AppState>) -> PathBuf {
    let cfg = state.cfg.lock().unwrap();
    if cfg.library.trim().is_empty() {
        crate::config::detect_library()
    } else {
        PathBuf::from(&cfg.library)
    }
}

/// 解析 `path?q=1&k=2` 里的查询参数。
fn query(path: &str) -> (String, HashMap<String, String>) {
    let (p, q) = match path.split_once('?') {
        Some((p, q)) => (p, q),
        None => (path, ""),
    };
    let mut map: HashMap<String, String> = HashMap::new();
    for kv in q.split('&') {
        if kv.is_empty() {
            continue;
        }
        let (k, v) = match kv.split_once('=') {
            Some((k, v)) => (k, v),
            None => (kv, ""),
        };
        map.insert(k.to_string(), percent_decode(v));
    }
    (p.to_string(), map)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                if let Ok(b) = u8::from_str_radix(hex, 16) {
                    out.push(b);
                    i += 3;
                    continue;
                }
                out.push(bytes[i]);
                i += 1;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn s(v: &Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn statuses() -> Vec<&'static str> {
    vec!["inbox", "thinking", "building", "done"]
}

// ---------------------------------------------------------------- bootstrap

fn bootstrap(state: &State<AppState>) -> Value {
    let root = vault_root(state);
    let cfg = state.cfg.lock().unwrap().public_json();
    let idx = state.index.lock().unwrap();
    let notes = idx.list(None, None, 100_000);
    let ideas: Vec<Value> = notes.iter().filter(|n| n["kind"] == "idea").cloned().collect();
    let digests: Vec<Value> = notes.iter().filter(|n| n["kind"] == "digest").cloned().collect();
    let recent: Vec<Value> = notes.iter().take(12).cloned().collect();
    let folders = idx.folders();
    let stats = idx.stats();
    let tasks = tasks_payload(&idx);
    let runs = idx.runs_json(30);
    drop(idx);
    let assets = state.assets.lock().unwrap().clone();
    let asset_summary = state.assets_summary.lock().unwrap().clone();
    let vault_exists = root.is_dir();
    json!({
        "config": cfg,
        "vault_exists": vault_exists,
        "stats": stats,
        "ideas": ideas,
        "digests": digests,
        "tasks": tasks["items"].clone(),
        "task_counts": tasks["counts"].clone(),
        "today": tasks["today"].clone(),
        "recent": recent,
        "folders": folders,
        "assets": asset_summary,
        "asset_items": assets,
        "runs": runs,
        "statuses": statuses(),
        "time": vault::now_str(),
    })
}

fn refresh_assets(state: &State<AppState>, force: bool) {
    let root = library_root(state);
    let items = assets::scan(&root, force);
    let summary = assets::summary(&items);
    *state.assets.lock().unwrap() = items;
    *state.assets_summary.lock().unwrap() = summary;
    *state.last_assets_scan.lock().unwrap() = now_ts();
}

fn sync_vault(state: &State<AppState>) -> Value {
    let root = vault_root(state);
    let mut idx = state.index.lock().unwrap();
    idx.sync(&root)
}

/// Explicit semantic requests snapshot current disk content before any HTTP call.
/// Neither the write queue nor index/config/cache locks cross the network boundary.
fn semantic_request(state: &State<AppState>, body: &Value, related: bool) -> Result<Value, String> {
    let cfg = state.cfg.lock().unwrap().clone();
    // Validate opt-in/config first: disabled requests do not scan or contact anything.
    let connection = crate::semantic::Connection::from_config(&cfg.ai)?;
    let query = s(body, "q");
    if !related && (query.trim().is_empty() || query.chars().count() > 2000) {
        return Err("E_SEMANTIC_QUERY: 请输入 1–2000 字的语义查询".into());
    }
    let path = s(body, "path").replace('\\', "/");
    if related && path.trim().is_empty() {
        return Err("E_SEMANTIC_PATH: 请指定相关推荐的内容路径".into());
    }
    let limit = body.get("limit").and_then(Value::as_u64).unwrap_or(12).clamp(1, 50) as usize;
    // Use fresh disk snapshots so external Obsidian edits and asset metadata changes
    // invalidate embeddings even when the background watcher is disabled.
    let mut notes = vault::scan(Path::new(&cfg.vault), true);
    let library = if cfg.library.trim().is_empty() { config::detect_library() } else { PathBuf::from(&cfg.library) };
    let mut asset_items = assets::scan(&library, false);
    let total = notes.len() + asset_items.len();
    let source = if related {
        notes.iter().find(|n| n.path == path).map(crate::semantic::note_document)
            .or_else(|| asset_items.iter().find(|a| a["path"].as_str() == Some(path.as_str())).map(crate::semantic::asset_document))
            .ok_or_else(|| "E_SEMANTIC_PATH: 当前内容不存在或不在可搜索的库中".to_string()).map(Some)?
    } else { None };
    notes.sort_by(|a, b| b.mtime.total_cmp(&a.mtime).then(a.path.cmp(&b.path)));
    asset_items.sort_by(|a, b| b["mtime"].as_f64().unwrap_or(0.0).total_cmp(&a["mtime"].as_f64().unwrap_or(0.0))
        .then_with(|| a["path"].as_str().cmp(&b["path"].as_str())));
    let docs = notes.iter().take(crate::semantic::PER_SOURCE_LIMIT).map(crate::semantic::note_document)
        .chain(asset_items.iter().take(crate::semantic::PER_SOURCE_LIMIT).map(crate::semantic::asset_document)).collect();
    state.semantic.search(connection, docs, &query, source.as_ref(), limit, total)
}

// ---------------------------------------------------------------- 分发

#[tauri::command]
pub async fn api_call(
    app: AppHandle,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    // 文件扫描和 blocking HTTP 运行在工作线程，不占用窗口事件循环。
    tauri::async_runtime::spawn_blocking(move || {
        dispatch(app.state::<AppState>(), method, path, body)
    })
    .await
    .map_err(|e| format!("后台任务失败：{e}"))?
}

fn dispatch(
    state: State<AppState>,
    method: String,
    path: String,
    body: Option<Value>,
) -> Result<Value, String> {
    let (p, q) = query(&path);
    let body = body.unwrap_or(json!({}));
    let m = method.to_uppercase();
    // 名字分配与写入是同一临界区，避免并发创建同名笔记互相覆盖。
    // AI 网络调用不持锁，其他读操作仍可响应。
    let mutating = matches!((m.as_str(), p.as_str()),
        ("PUT", "/api/note" | "/api/config" | "/api/task" | "/api/canvas") |
        ("DELETE", "/api/note" | "/api/task") |
        ("POST", "/api/idea" | "/api/idea/update" | "/api/digest" | "/api/upload"
            | "/api/asset/tags" | "/api/asset/note" | "/api/asset/rename" | "/api/asset/delete"
            | "/api/asset/delete-batch" | "/api/task" | "/api/task/from-idea" | "/api/task/plan/apply"
            | "/api/recovery/restore" | "/api/backup/create" | "/api/backup/restore") |
        ("GET", "/api/recovery/trash" | "/api/backup/list"));
    let _write_guard = if mutating { Some(state.writes.lock().map_err(|_| "写入队列不可用".to_string())?) } else { None };
    match (m.as_str(), p.as_str()) {
        ("GET", "/api/recovery/trash") => recovery::list(&vault_root(&state), &library_root(&state)),
        ("POST", "/api/recovery/restore") => {
            let kind = s(&body, "kind");
            let root = match kind.as_str() { "note" => vault_root(&state), "asset" => library_root(&state), _ => return Err("E_RECOVERY_KIND".into()) };
            let out = recovery::restore(&root, &s(&body, "id"), &kind)?;
            let _ = sync_vault(&state);
            refresh_assets(&state, true);
            touch_sig(&state);
            Ok(out)
        }
        ("POST", "/api/backup/create") => recovery::backup_create(&vault_root(&state), &library_root(&state), &config::data_dir()),
        ("GET", "/api/backup/list") => recovery::backup_list(&config::data_dir()),
        ("POST", "/api/backup/restore") => {
            let out = recovery::backup_restore(&vault_root(&state), &library_root(&state), &config::data_dir(), &s(&body, "id"));
            // An I/O failure may follow earlier additive copies; refresh those too.
            let _ = sync_vault(&state);
            refresh_assets(&state, true);
            touch_sig(&state);
            out
        }
        ("GET", "/api/bootstrap") => {
            let needs_sync = state.index.lock().unwrap().notes.is_empty();
            if needs_sync {
                let _ = sync_vault(&state);
            }
            if state.assets.lock().unwrap().is_empty() {
                refresh_assets(&state, false);
            }
            Ok(bootstrap(&state))
        }
        ("GET", "/api/notes") => {
            let kind = q.get("kind").map(|x| x.as_str()).filter(|x| !x.is_empty());
            let folder = q.get("folder").map(|x| x.as_str()).filter(|x| !x.is_empty());
            let limit = q
                .get("limit")
                .and_then(|x| x.parse::<usize>().ok())
                .unwrap_or(500);
            let idx = state.index.lock().unwrap();
            Ok(json!({ "items": idx.list(kind, folder, limit) }))
        }
        ("GET", "/api/note") => {
            let rel = q.get("path").cloned().unwrap_or_default();
            // fresh=1 直接从磁盘读：解决冲突时必须看到磁盘上真正的内容，
            // 不能用可能还没重建的索引。
            if q.get("fresh").map(|v| v == "1" || v == "true").unwrap_or(false) {
                let root = vault_root(&state);
                let n = vault::read_note(&root, &rel).ok_or_else(|| "笔记不存在".to_string())?;
                let mut out = n.list_json();
                if let Some(obj) = out.as_object_mut() {
                    obj.insert("body".into(), json!(n.body));
                }
                return Ok(out);
            }
            let idx = state.index.lock().unwrap();
            match idx.get(&rel) {
                Some(n) => Ok(json!({
                    "path": n.path, "title": n.title, "folder": n.folder, "kind": n.kind,
                    "tags": n.tags, "links": n.links, "words": n.words, "mtime": n.mtime,
                    "meta": n.meta, "body": n.body,
                })),
                None => Err("笔记不存在".into()),
            }
        }
        ("PUT", "/api/note") => {
            let rel = s(&body, "path");
            let text = s(&body, "body");
            let force = body.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
            let base = body.get("base_mtime").and_then(|v| v.as_f64());
            let root = vault_root(&state);
            if !force {
                check_conflict(&root, &rel, base)?;
            }
            let mut meta = serde_json::Map::new();
            if force {
                // 强制覆盖时以磁盘为准，避免索引落后导致无关 frontmatter 丢失。
                if let Some(n) = vault::read_note(&root, &rel) {
                    meta = n.meta;
                }
            } else if let Some(n) = state.index.lock().unwrap().get(&rel).cloned() {
                meta = n.meta.clone();
            }
            if let Some(t) = body.get("title").and_then(|v| v.as_str()) {
                if !t.trim().is_empty() {
                    meta.insert("title".into(), json!(t.trim()));
                }
            }
            if body.get("tags").is_some() {
                meta.insert("tags".into(), body["tags"].clone());
            }
            meta.insert("updated".into(), json!(vault::now_str()));
            vault::write_note(&root, &rel, &meta, &text).map_err(|e| format!("写入失败：{e}"))?;
            let _ = sync_vault(&state);
            touch_sig(&state);
            let mtime = vault::note_mtime(&root, &rel).unwrap_or(0.0);
            Ok(json!({ "ok": true, "mtime": mtime }))
        }
        ("DELETE", "/api/note") => {
            let rel = q.get("path").cloned().unwrap_or_default();
            let root = vault_root(&state);
            match vault::trash_note(&root, &rel) {
                Some(dst) => {
                    let _ = sync_vault(&state);
                    touch_sig(&state);
                    let shown = fs::canonicalize(&root)
                        .ok()
                        .and_then(|r| dst.strip_prefix(&r).ok().map(|p| p.to_string_lossy().replace('\\', "/")))
                        .unwrap_or_else(|| dst.to_string_lossy().to_string());
                    Ok(json!({ "ok": true, "trashed": shown }))
                }
                None => Err("删除失败：文件不存在".into()),
            }
        }
        ("GET", "/api/tasks") => {
            let idx = state.index.lock().unwrap();
            Ok(tasks_payload(&idx))
        }
        ("GET", "/api/canvas") => {
            let file = config::data_dir().join("canvas.json");
            let data = fs::read_to_string(&file)
                .ok()
                .and_then(|t| serde_json::from_str::<Value>(&t).ok())
                .unwrap_or_else(|| json!({ "version": 1, "links": [], "positions": {} }));
            Ok(data)
        }
        ("PUT", "/api/canvas") => {
            let links = body.get("links").cloned().unwrap_or_else(|| json!([]));
            let positions = body.get("positions").cloned().unwrap_or_else(|| json!({}));
            if !links.is_array() || !positions.is_object() {
                return Err("画布数据格式不正确".into());
            }
            let dir = config::data_dir();
            fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败：{e}"))?;
            let out = json!({ "version": 1, "links": links, "positions": positions });
            let text = serde_json::to_string_pretty(&out).map_err(|e| format!("序列化画布失败：{e}"))?;
            fs::write(dir.join("canvas.json"), text).map_err(|e| format!("保存画布失败：{e}"))?;
            Ok(json!({ "ok": true }))
        }
        ("GET", "/api/tags") => {
            let idx = state.index.lock().unwrap();
            Ok(json!({ "items": idx.tags() }))
        }
        ("POST", "/api/media/analyze") => {
            // Preview only: no write lock, note/metadata writes, or run history.
            // Clone the configuration once; release cfg before subprocess/network work.
            let cfg = state.cfg.lock().map_err(|_| "E_MEDIA_CONFIG: 配置不可用".to_string())?.clone();
            let root = if cfg.library.trim().is_empty() { config::detect_library() }
                else { PathBuf::from(&cfg.library) };
            crate::media::analyze(&cfg.ai, &root, &body)
        }
        ("POST", "/api/search/semantic") => semantic_request(&state, &body, false),
        ("POST", "/api/related") => semantic_request(&state, &body, true),
        ("GET", "/api/search") => {
            let text = q.get("q").cloned().unwrap_or_default();
            let limit = q
                .get("limit")
                .and_then(|x| x.parse::<usize>().ok())
                .unwrap_or(60);
            let idx = state.index.lock().unwrap();
            Ok(json!({ "items": idx.search(&text, limit) }))
        }
        ("GET", "/api/assets") => {
            let force = q.get("force").map(|v| v == "1" || v == "true").unwrap_or(false);
            let stale = now_ts() - *state.last_assets_scan.lock().unwrap() > 60.0;
            if force || stale || state.assets.lock().unwrap().is_empty() {
                refresh_assets(&state, force);
            }
            let items = state.assets.lock().unwrap().clone();
            let summary = state.assets_summary.lock().unwrap().clone();
            Ok(json!({ "items": items, "summary": summary }))
        }
        ("GET", "/api/runs") => {
            let limit = q
                .get("limit")
                .and_then(|x| x.parse::<usize>().ok())
                .unwrap_or(30);
            let idx = state.index.lock().unwrap();
            Ok(json!({ "items": idx.runs_json(limit) }))
        }
        ("GET", "/api/config") => {
            let cfg = state.cfg.lock().unwrap().public_json();
            Ok(cfg)
        }
        ("POST", "/api/sync") => Ok(sync_vault(&state)),
        ("POST", "/api/asset/note") => {
            let root = library_root(&state);
            let rel = s(&body, "path");
            let text = body.get("ai_note").and_then(Value::as_str).ok_or("素材说明必须是文本")?;
            if text.chars().count() > 400 { return Err("素材说明最多400字".into()); }
            let note = assets::set_note(&root, &rel, text)?;
            refresh_assets(&state, false);
            Ok(json!({"ok":true,"ai_note":note}))
        }
        ("POST", "/api/asset/tags") => {
            let root = library_root(&state);
            let rel = s(&body, "path");
            let raw: Vec<String> = body
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            let tags = assets::set_tags(&root, &rel, &raw)?;
            let note = body.get("ai_note").and_then(|v| v.as_str())
                .map(|text| assets::set_note(&root, &rel, text))
                .transpose()?;
            refresh_assets(&state, false);
            Ok(json!({ "ok": true, "tags": tags, "ai_note": note }))
        }
        ("POST", "/api/asset/rename") => {
            let root = library_root(&state);
            let rel = s(&body, "path");
            let name = s(&body, "name");
            let new_rel = assets::rename(&root, &rel, &name)?;
            refresh_assets(&state, false);
            Ok(json!({ "ok": true, "path": new_rel }))
        }
        ("POST", "/api/asset/delete") => {
            let root = library_root(&state);
            let rel = s(&body, "path");
            let trashed = assets::delete_to_trash(&root, &rel)?;
            refresh_assets(&state, false);
            Ok(json!({ "ok": true, "trashed": trashed }))
        }
        ("POST", "/api/asset/delete-batch") => {
            let root = library_root(&state);
            let paths: Vec<String> = body
                .get("paths")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            if paths.is_empty() {
                return Err("没有选择素材".to_string());
            }
            if paths.len() > 500 {
                return Err("一次最多删除 500 个素材".to_string());
            }
            let mut trashed = Vec::new();
            let mut failed: Vec<Value> = Vec::new();
            for rel in &paths {
                match assets::delete_to_trash(&root, rel) {
                    Ok(dst) => trashed.push(json!({ "path": rel, "trashed": dst })),
                    Err(e) => failed.push(json!({ "path": rel, "error": e })),
                }
            }
            refresh_assets(&state, false);
            Ok(json!({ "ok": failed.is_empty(), "trashed": trashed, "failed": failed }))
        }
        ("POST", "/api/rescan-assets") => {
            refresh_assets(&state, true);
            let summary = state.assets_summary.lock().unwrap().clone();
            Ok(summary)
        }
        ("POST", "/api/idea") => create_idea(&state, &body),
        ("POST", "/api/task/plan") => {
            let cfg = state.cfg.lock().unwrap().clone();
            task_plan::preview(Path::new(&cfg.vault), &cfg.ai, &body)
        }
        ("POST", "/api/task/plan/apply") => {
            let result = task_plan::apply(&vault_root(&state), &body)?;
            let _ = sync_vault(&state);
            touch_sig(&state);
            Ok(result)
        }
        ("POST", "/api/task") => create_task(&state, &body),
        ("PUT", "/api/task") => update_task(&state, &body),
        ("DELETE", "/api/task") => {
            let rel = q.get("path").cloned().unwrap_or_default();
            if !rel.starts_with("灵感盒/任务/") {
                return Err("不是任务".into());
            }
            let root = vault_root(&state);
            let p = vault::safe_join(&root, &rel).ok_or_else(|| "路径不合法".to_string())?;
            let trash = root.join("灵感盒").join(".trash");
            let _ = std::fs::create_dir_all(&trash);
            let name = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "task.md".into());
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
            std::fs::rename(&p, trash.join(format!("{stamp}-{name}"))).map_err(|e| format!("删除失败：{e}"))?;
            let _ = sync_vault(&state);
            touch_sig(&state);
            Ok(json!({ "ok": true }))
        }
        ("POST", "/api/task/from-idea") => task_from_idea(&state, &body),
        ("POST", "/api/idea/update") => update_idea(&state, &body),
        ("POST", "/api/idea/synthesize") => synthesize_ideas(&state, &body),
        ("POST", "/api/idea/merge") => synthesize_ideas(&state, &body),
        ("POST", "/api/ai/test") => test_ai(&state, &body),
        ("POST", "/api/ai/models") => models_ai(&state, &body),
        ("GET", "/api/ai/models") => models_ai(&state, &body),
        ("POST", "/api/asset/ai-tags") => ai_tag_assets(&state, &body),
        ("POST", "/api/asset/analyze") => ai_tag_assets(&state, &body),
        ("POST", "/api/digest") => save_digest(&state, &body),
        ("POST", "/api/ai") => run_ai(&state, &body),
        ("POST", "/api/upload") => {
            let name = s(&body, "name");
            let data = s(&body, "data");
            let bytes = base64_decode(&data).ok_or_else(|| "上传数据解析失败".to_string())?;
            let root = library_root(&state);
            let info = assets::save_upload(&root, &name, &bytes).map_err(|e| format!("保存失败：{e}"))?;
            refresh_assets(&state, false);
            Ok(info)
        }
        ("PUT", "/api/config") => {
            let mut cfg = state.cfg.lock().unwrap();
            let mut next = cfg.clone();
            next.apply_patch(&body);
            // 用户可能直接选中了 assets 子目录：自动回到上一级素材根目录。
            let mut lib = next.library.trim().trim_end_matches(['/', '\\']).to_string();
            if lib.to_ascii_lowercase().ends_with("assets") {
                let cut = lib.len() - "assets".len();
                let parent = lib[..cut].trim_end_matches(['/', '\\']).to_string();
                if !parent.is_empty() && Path::new(&parent).is_dir() {
                    lib = parent;
                }
            }
            next.library = lib;
            if next.vault.trim().is_empty() || !Path::new(&next.vault).is_absolute() || !Path::new(&next.vault).is_dir() {
                return Err("请选择已存在的 Obsidian 库目录".into());
            }
            if next.library.trim().is_empty() || !Path::new(&next.library).is_absolute() || !Path::new(&next.library).is_dir() {
                return Err("请选择已存在的素材库目录（应用会在其中使用 assets 子目录）".into());
            }
            // 新选的素材根目录里没有 assets/ 时补一个，否则扫描结果永远是空的。
            let assets_dir = Path::new(&next.library).join("assets");
            if !assets_dir.is_dir() {
                let _ = std::fs::create_dir_all(&assets_dir);
            }
            let library_changed = next.library != cfg.library;
            let vault_changed = next.vault != cfg.vault;
            next.save().map_err(|e| format!("保存配置失败：{e}"))?;
            *cfg = next;
            let pub_cfg = cfg.public_json();
            drop(cfg);
            let _ = sync_vault(&state);
            if library_changed || vault_changed { refresh_assets(&state, true); }
            Ok(pub_cfg)
        }
        _ => Err(format!("未知接口：{m} {p}")),
    }
}

// ---------------------------------------------------------------- 想法

fn create_idea(state: &State<AppState>, body: &Value) -> Result<Value, String> {
    let mut title = s(body, "title").trim().to_string();
    let text = s(body, "body").trim().to_string();
    if title.is_empty() && text.is_empty() {
        return Err("想法不能为空".into());
    }
    if title.is_empty() {
        title = text.lines().next().unwrap_or("").chars().take(40).collect();
    }
    let root = vault_root(state);
    let folder = root.join("灵感盒").join("想法");
    let stem = vault::slugify(&title, "idea");
    let p = vault::unique_path(&folder, &stem, ".md");
    let rel = p
        .strip_prefix(&root)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "路径错误".to_string())?;
    let now = vault::now_str();
    let mut meta = serde_json::Map::new();
    meta.insert("title".into(), json!(title));
    meta.insert("type".into(), json!("idea"));
    let status = {
        let v = s(body, "status");
        if v.is_empty() { "inbox".to_string() } else { v }
    };
    meta.insert("status".into(), json!(status));
    meta.insert("created".into(), json!(now));
    meta.insert("updated".into(), json!(now));
    if let Some(tags) = body.get("tags") {
        meta.insert("tags".into(), tags.clone());
    }
    if let Some(asset_list) = body.get("assets") {
        if asset_list.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
            meta.insert("assets".into(), asset_list.clone());
        }
    }
    // 从桌面拖进来的文本会带上原文件名，记在 source 里方便回溯。
    if let Some(src) = body.get("source").and_then(|v| v.as_str()) {
        let src = src.trim();
        if !src.is_empty() {
            meta.insert("source".into(), json!(src));
        }
    }
    vault::write_note(&root, &rel, &meta, &text).map_err(|e| format!("写入失败：{e}"))?;
    let _ = sync_vault(state);
    Ok(json!({ "ok": true, "path": rel, "title": title }))
}

fn update_idea(state: &State<AppState>, body: &Value) -> Result<Value, String> {
    let rel = s(body, "path");
    if rel.is_empty() {
        return Err("缺少 path".into());
    }
    let root = vault_root(state);
    let force = body.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
    let base = body.get("base_mtime").and_then(|v| v.as_f64());
    if !force {
        check_conflict(&root, &rel, base)?;
    }
    let mut note = vault::read_note(&root, &rel).ok_or_else(|| "想法不存在".to_string())?;
    let mut meta = note.meta.clone();
    if body.get("title").is_some() {
        meta.insert("title".into(), body["title"].clone());
    }
    if body.get("status").is_some() {
        meta.insert("status".into(), body["status"].clone());
    }
    if body.get("tags").is_some() {
        meta.insert("tags".into(), body["tags"].clone());
    }
    if body.get("assets").is_some() {
        meta.insert("assets".into(), body["assets"].clone());
    }
    meta.insert("updated".into(), json!(vault::now_str()));
    let text = if body.get("body").is_some() {
        s(body, "body")
    } else {
        note.body.clone()
    };
    vault::write_note(&root, &rel, &meta, &text).map_err(|e| format!("写入失败：{e}"))?;
    note.meta = meta;
    let _ = sync_vault(state);
    touch_sig(state);
    let mtime = vault::note_mtime(&root, &rel).unwrap_or(0.0);
    Ok(json!({ "ok": true, "path": rel, "mtime": mtime }))
}

// ---------------------------------------------------------------- 2.5 AI 能力

fn paths_from(body: &Value) -> Vec<String> {
    body.get("paths")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// 设置页可以先填参数再测试，不必先保存；打码的 Key 表示沿用已保存的 Key。
fn ai_from_body(state: &State<AppState>, body: &Value) -> AiConfig {
    let mut ai = state.cfg.lock().unwrap().ai.clone();
    let p = body.get("ai").unwrap_or(body);
    if let Some(v) = p.get("provider").and_then(|x| x.as_str()) {
        if !v.trim().is_empty() {
            ai.provider = v.trim().to_string();
        }
    }
    if let Some(v) = p.get("base_url").and_then(|x| x.as_str()) {
        if !v.trim().is_empty() {
            ai.base_url = v.trim().to_string();
        }
    }
    if let Some(v) = p.get("model").and_then(|x| x.as_str()) {
        if !v.trim().is_empty() {
            ai.model = v.trim().to_string();
        }
    }
    if let Some(v) = p.get("api_key").and_then(|x| x.as_str()) {
        let v = v.trim();
        if !v.is_empty() && !v.starts_with("••••") {
            ai.api_key = v.to_string();
        }
    }
    if let Some(v) = p.get("vision").and_then(|x| x.as_bool()) {
        ai.vision = v;
    }
    if let Some(v) = p.get("vision_model").and_then(|x| x.as_str()) {
        ai.vision_model = v.trim().to_string();
    }
    ai
}

fn test_ai(state: &State<AppState>, body: &Value) -> Result<Value, String> {
    ai::test_connection(&ai_from_body(state, body))
}

fn models_ai(state: &State<AppState>, body: &Value) -> Result<Value, String> {
    ai::list_models(&ai_from_body(state, body))
}

/// 视觉分析前把图缩到最长边 768 并转 JPEG：省钱、省带宽，也避开各家对超大图的限制。
fn image_data_url(root: &Path, rel: &str) -> Option<String> {
    let abs = assets::resolve(root, rel)?;
    let size = fs::metadata(&abs).ok()?.len();
    // 原图太大时先看尺寸，避免解码一张几百 MB 的图把内存打满。
    if size > 30 * 1024 * 1024 {
        return None;
    }
    let img = image::open(&abs).ok()?;
    let img = if img.width() > 768 || img.height() > 768 {
        img.thumbnail(768, 768)
    } else {
        img
    };
    let rgb = img.to_rgb8();
    let (w, h) = (rgb.width(), rgb.height());
    let mut buf: Vec<u8> = Vec::new();
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 80);
    enc.encode(rgb.as_raw(), w, h, image::ExtendedColorType::Rgb8).ok()?;
    if buf.is_empty() {
        return None;
    }
    Some(format!("data:image/jpeg;base64,{}", base64_encode(&buf)))
}

/// 批量分析素材并（可选）写回标签。默认只分析图片元数据，除非配置里显式打开 vision。
fn ai_tag_assets(state: &State<AppState>, body: &Value) -> Result<Value, String> {
    let paths = paths_from(body);
    if paths.is_empty() {
        return Err("没有选择素材".into());
    }
    if paths.len() > 8 {
        return Err("一次最多分析 8 个素材".into());
    }
    let ai_cfg = ai_from_body(state, body);
    let apply = body.get("apply").and_then(|v| v.as_bool()).unwrap_or(false);
    let root = library_root(state);
    let snapshot = state.assets.lock().unwrap().clone();
    let mut items: Vec<Value> = Vec::new();
    let mut failed: Vec<Value> = Vec::new();
    let mut vision_used = 0usize;
    for rel in &paths {
        let Some(item) = snapshot.iter().find(|a| a.get("path").and_then(|v| v.as_str()) == Some(rel.as_str())).cloned() else {
            failed.push(json!({ "path": rel, "error": "素材不存在或已变更" }));
            continue;
        };
        let mut image_url: Option<String> = None;
        if ai_cfg.vision
            && ai_cfg.provider.eq_ignore_ascii_case("openai")
            && !ai_cfg.base_url.trim().is_empty()
        {
            let kind = item.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            let ext = item.get("ext").and_then(|v| v.as_str()).unwrap_or("");
            let is_image = kind == "image"
                || matches!(
                    ext.to_ascii_lowercase().as_str(),
                    "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp"
                );
            if is_image {
                image_url = image_data_url(&root, rel);
            }
        }
        let result = match ai::analyze_asset(&ai_cfg, &item, image_url.as_deref()) {
            Ok(v) => Ok(v),
            Err(e) if image_url.is_some() => {
                // 视觉模型不支持图片时退回纯文本，不让整批失败。
                ai::analyze_asset(&ai_cfg, &item, None).map(|mut v| {
                    v["vision_error"] = json!(e);
                    v
                })
            }
            Err(e) => Err(e),
        };
        match result {
            Ok(mut v) => {
                if v.get("vision").and_then(|x| x.as_bool()).unwrap_or(false) {
                    vision_used += 1;
                }
                let proposed: Vec<String> = v
                    .get("tags")
                    .and_then(|x| x.as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                let existing: Vec<String> = item
                    .get("tags")
                    .and_then(|x| x.as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                if apply {
                    let note_text = {
                        let sum = v.get("summary").and_then(|x| x.as_str()).unwrap_or("").trim();
                        let useit = v.get("use").and_then(|x| x.as_str()).unwrap_or("").trim();
                        [sum.to_string(), if useit.is_empty() { String::new() } else { format!("适用：{useit}") }]
                            .into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("｜")
                    };
                    // AI 调用后重新读取标签，并在同一短写锁内更新标签及说明。
                    let applied = {
                        let _w = state.writes.lock().map_err(|_| "写入队列不可用".to_string())?;
                        let mut merged = assets::load_tags(&root).remove(rel).unwrap_or_default();
                        for t in &proposed {
                            if !merged.contains(t) { merged.push(t.clone()); }
                        }
                        assets::set_tags(&root, rel, &merged).and_then(|tags| {
                            if !note_text.is_empty() { assets::set_note(&root, rel, &note_text)?; }
                            Ok(tags)
                        })
                    };
                    match applied {
                        Ok(tags) => v["tags"] = json!(tags),
                        Err(e) => { failed.push(json!({ "path": rel, "error": e })); continue; }
                    }
                } else {
                    v["existing_tags"] = json!(existing);
                    v["tags"] = json!(proposed);
                }
                v["path"] = json!(rel);
                v["name"] = item.get("name").cloned().unwrap_or(json!(rel));
                items.push(v);
            }
            Err(e) => failed.push(json!({ "path": rel, "error": e })),
        }
    }
    if apply {
        refresh_assets(state, true);
    }
    Ok(json!({
        "ok": failed.is_empty(),
        "applied": apply,
        "vision": vision_used,
        "items": items,
        "failed": failed,
    }))
}

/// 多条想法 → 一条新想法；可选择同时落地成一个任务。
fn synthesize_ideas(state: &State<AppState>, body: &Value) -> Result<Value, String> {
    let paths = paths_from(body);
    if paths.len() < 2 {
        return Err("至少选择两条想法".into());
    }
    if paths.len() > 8 {
        return Err("一次最多连接 8 条想法".into());
    }
    if !paths.iter().all(|p| p.starts_with("灵感盒/")) {
        return Err("只能连接灵感盒里的笔记".into());
    }
    let items = collect_items(state, &paths);
    if items.len() < 2 {
        return Err("有想法读不到了，请刷新后重试".into());
    }
    let root = vault_root(state);
    let now = vault::now_str();
    let mut title = s(body, "title").trim().to_string();
    if title.is_empty() {
        title = format!("合成想法 · {}", chrono::Local::now().format("%m-%d %H:%M"));
    }
    let extra = s(body, "extra");
    let provided = s(body, "text").trim().to_string();
    let (text, model) = if !provided.is_empty() {
        (provided, "manual".to_string())
    } else {
        let ai_cfg = ai_from_body(state, body);
        let out = ai::run("synthesize", &items, &ai_cfg, &extra)?;
        let text = out.get("text").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        if text.is_empty() {
            return Err("模型没有返回内容".into());
        }
        let model = out.get("model").and_then(|v| v.as_str()).unwrap_or("local").to_string();
        (text, model)
    };
    let save = body.get("save").and_then(|v| v.as_bool()).unwrap_or(true);
    if !save {
        return Ok(json!({ "ok": true, "saved": false, "title": title, "text": text, "model": model, "sources": paths }));
    }
    let mut tags: Vec<String> = Vec::new();
    let mut links: Vec<String> = Vec::new();
    let mut merged_titles: Vec<String> = Vec::new();
    for p in &paths {
        if let Some(n) = vault::read_note(&root, p) {
            links.push(format!("[[{}]]", n.title));
            merged_titles.push(n.title.clone());
            if let Some(arr) = n.meta.get("tags").and_then(|v| v.as_array()) {
                for t in arr {
                    if let Some(t) = t.as_str() {
                        if !t.trim().is_empty() && !tags.iter().any(|x| x == t) {
                            tags.push(t.to_string());
                        }
                    }
                }
            }
        }
    }
    let body_text = format!("{}\n\n---\n来源：{}", text, if links.is_empty() { paths.join("、") } else { links.join("、") });
    let _write_guard = state.writes.lock().map_err(|_| "写入队列不可用".to_string())?;
    let folder = root.join("灵感盒").join("想法");
    let p = vault::unique_path(&folder, &vault::slugify(&title, "idea"), ".md");
    let rel = p
        .strip_prefix(&root)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "路径错误".to_string())?;
    let mut meta = serde_json::Map::new();
    meta.insert("title".into(), json!(title));
    meta.insert("type".into(), json!("idea"));
    meta.insert("status".into(), json!("thinking"));
    meta.insert("created".into(), json!(now));
    meta.insert("updated".into(), json!(now));
    meta.insert("tags".into(), json!(tags));
    meta.insert("merged_from".into(), json!(merged_titles));
    meta.insert("sources".into(), json!(paths));
    meta.insert("source".into(), json!("AI 合成"));
    vault::write_note(&root, &rel, &meta, &body_text).map_err(|e| format!("写入失败：{e}"))?;
    let mut task_out: Option<Value> = None;
    if body.get("create_task").and_then(|v| v.as_bool()).unwrap_or(false) {
        let task_title = {
            let t = s(body, "task_title").trim().to_string();
            if t.is_empty() { format!("{title} · 落地") } else { t }
        };
        let task_text = format!("{}\n\n---\n来源：[[{}]]", text, title);
        let tfolder = root.join("灵感盒").join("任务");
        let tp = vault::unique_path(&tfolder, &vault::slugify(&task_title, "task"), ".md");
        let trel = tp
            .strip_prefix(&root)
            .map(|r| r.to_string_lossy().replace('\\', "/"))
            .map_err(|_| "路径错误".to_string())?;
        let tnow = vault::now_str();
        let mut tm = serde_json::Map::new();
        tm.insert("title".into(), json!(task_title));
        tm.insert("type".into(), json!("task"));
        tm.insert("status".into(), json!("todo"));
        tm.insert("priority".into(), json!("mid"));
        tm.insert("created".into(), json!(tnow));
        tm.insert("updated".into(), json!(tnow));
        tm.insert("source".into(), json!(rel));
        tm.insert("tags".into(), json!(tags));
        vault::write_note(&root, &trel, &tm, &task_text).map_err(|e| format!("写入失败：{e}"))?;
        task_out = Some(json!({ "path": trel, "title": task_title }));
    }
    let _ = sync_vault(state);
    touch_sig(state);
    Ok(json!({
        "ok": true,
        "saved": true,
        "title": title,
        "text": text,
        "model": model,
        "idea": { "path": rel, "title": title },
        "task": task_out,
        "sources": paths,
    }))
}

// ---------------------------------------------------------------- 任务

fn task_rank(status: &str) -> u8 {
    match status {
        "doing" => 0,
        "todo" => 1,
        "done" => 3,
        _ => 2,
    }
}

fn prio_rank(p: &str) -> u8 {
    match p {
        "high" => 0,
        "mid" => 1,
        "low" => 3,
        _ => 2,
    }
}

fn task_json(n: &vault::Note) -> Value {
    json!({
        "path": n.path,
        "title": n.title,
        "folder": n.folder,
        "kind": "task",
        "status": n.meta.get("status").and_then(Value::as_str).unwrap_or("todo"),
        "priority": n.meta.get("priority").and_then(Value::as_str).unwrap_or("mid"),
        "due": n.meta.get("due").and_then(Value::as_str).unwrap_or(""),
        "source": n.meta.get("source").and_then(Value::as_str).unwrap_or(""),
        "tags": n.tags,
        "excerpt": n.excerpt,
        "words": n.words,
        "mtime": n.mtime,
        "meta": n.meta,
    })
}

/// 任务列表 + 计数。今天的定义用本地日期，逾期只看未完成的。
fn tasks_payload(idx: &Index) -> Value {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut items: Vec<Value> = idx
        .notes
        .iter()
        .filter(|n| n.kind == "task")
        .map(task_json)
        .collect();
    items.sort_by(|a, b| {
        let sa = a["status"].as_str().unwrap_or("todo");
        let sb = b["status"].as_str().unwrap_or("todo");
        task_rank(sa)
            .cmp(&task_rank(sb))
            .then_with(|| {
                let da = a["due"].as_str().unwrap_or("");
                let db = b["due"].as_str().unwrap_or("");
                match (da.is_empty(), db.is_empty()) {
                    (false, false) => da.cmp(db),
                    (false, true) => std::cmp::Ordering::Less,
                    (true, false) => std::cmp::Ordering::Greater,
                    (true, true) => std::cmp::Ordering::Equal,
                }
            })
            .then_with(|| {
                prio_rank(a["priority"].as_str().unwrap_or("mid"))
                    .cmp(&prio_rank(b["priority"].as_str().unwrap_or("mid")))
            })
            .then_with(|| {
                b["mtime"]
                    .as_f64()
                    .unwrap_or(0.0)
                    .partial_cmp(&a["mtime"].as_f64().unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });
    let mut todo = 0;
    let mut doing = 0;
    let mut done = 0;
    let mut today_n = 0;
    let mut overdue = 0;
    for it in &items {
        let st = it["status"].as_str().unwrap_or("todo");
        let due = it["due"].as_str().unwrap_or("");
        match st {
            "doing" => doing += 1,
            "done" => done += 1,
            _ => todo += 1,
        }
        if st != "done" && !due.is_empty() {
            if due == today {
                today_n += 1;
            } else if due < today.as_str() {
                overdue += 1;
            }
        }
    }
    json!({
        "items": items,
        "counts": { "todo": todo, "doing": doing, "done": done, "today": today_n, "overdue": overdue, "open": todo + doing },
        "today": today,
    })
}

fn create_task(state: &State<AppState>, body: &Value) -> Result<Value, String> {
    let mut title = s(body, "title").trim().to_string();
    let text = s(body, "body").trim().to_string();
    if title.is_empty() && text.is_empty() {
        return Err("任务总得有个名字".into());
    }
    if title.is_empty() {
        title = text.lines().next().unwrap_or("").chars().take(40).collect();
    }
    let root = vault_root(state);
    let folder = root.join("灵感盒").join("任务");
    let stem = vault::slugify(&title, "task");
    let p = vault::unique_path(&folder, &stem, ".md");
    let rel = p
        .strip_prefix(&root)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "路径错误".to_string())?;
    let now = vault::now_str();
    let status = {
        let v = s(body, "status");
        if matches!(v.as_str(), "todo" | "doing" | "done") { v } else { "todo".to_string() }
    };
    let priority = {
        let v = s(body, "priority");
        if matches!(v.as_str(), "high" | "mid" | "low") { v } else { "mid".to_string() }
    };
    let mut meta = serde_json::Map::new();
    meta.insert("title".into(), json!(title));
    meta.insert("type".into(), json!("task"));
    meta.insert("status".into(), json!(status));
    meta.insert("priority".into(), json!(priority));
    meta.insert("created".into(), json!(now));
    meta.insert("updated".into(), json!(now));
    let due = s(body, "due");
    if !due.trim().is_empty() {
        meta.insert("due".into(), json!(due.trim()));
    }
    let source = s(body, "source");
    if !source.trim().is_empty() {
        meta.insert("source".into(), json!(source.trim()));
    }
    if let Some(tags) = body.get("tags") {
        meta.insert("tags".into(), tags.clone());
    }
    vault::write_note(&root, &rel, &meta, &text).map_err(|e| format!("写入失败：{e}"))?;
    let _ = sync_vault(state);
    Ok(json!({ "ok": true, "path": rel, "title": title }))
}

fn update_task(state: &State<AppState>, body: &Value) -> Result<Value, String> {
    let rel = s(body, "path");
    if rel.is_empty() {
        return Err("缺少 path".into());
    }
    if !rel.starts_with("灵感盒/任务/") {
        return Err("不是任务".into());
    }
    let root = vault_root(state);
    let force = body.get("force").and_then(|v| v.as_bool()).unwrap_or(false);
    let base = body.get("base_mtime").and_then(|v| v.as_f64());
    if !force {
        check_conflict(&root, &rel, base)?;
    }
    let mut note = vault::read_note(&root, &rel).ok_or_else(|| "任务不存在".to_string())?;
    let mut meta = note.meta.clone();
    for key in ["title", "status", "priority", "due", "source", "tags"] {
        if body.get(key).is_some() {
            meta.insert(key.to_string(), body[key].clone());
        }
    }
    if body.get("due").and_then(|v| v.as_str()) == Some("") {
        meta.remove("due");
    }
    let now = vault::now_str();
    meta.insert("updated".into(), json!(now));
    if meta.get("status").and_then(Value::as_str) == Some("done") {
        if !meta.contains_key("completed") {
            meta.insert("completed".into(), json!(now));
        }
    } else {
        meta.remove("completed");
    }
    let text = if body.get("body").is_some() {
        s(body, "body")
    } else {
        note.body.clone()
    };
    vault::write_note(&root, &rel, &meta, &text).map_err(|e| format!("写入失败：{e}"))?;
    note.meta = meta;
    let _ = sync_vault(state);
    touch_sig(state);
    let mtime = vault::note_mtime(&root, &rel).unwrap_or(0.0);
    Ok(json!({ "ok": true, "path": rel, "mtime": mtime }))
}

/// 想法 → 任务：保留来源双链，并把还没动过的想法状态推进到「在做」。
fn task_from_idea(state: &State<AppState>, body: &Value) -> Result<Value, String> {
    let rel = s(body, "path");
    let root = vault_root(state);
    let idea = vault::read_note(&root, &rel).ok_or_else(|| "想法不存在".to_string())?;
    if !rel.starts_with("灵感盒/想法/") {
        return Err("这不是一条想法".into());
    }
    let title = idea.title.trim().to_string();
    let title = if title.is_empty() { "未命名想法".to_string() } else { title };
    let text = format!("{}\n\n---\n来源：[[{}]]\n", idea.body.trim(), title);
    let mut meta = serde_json::Map::new();
    meta.insert("title".into(), json!(title));
    meta.insert("type".into(), json!("task"));
    meta.insert("status".into(), json!("todo"));
    meta.insert("priority".into(), json!("mid"));
    meta.insert("source".into(), json!(rel));
    meta.insert("created".into(), json!(vault::now_str()));
    meta.insert("updated".into(), json!(vault::now_str()));
    if !idea.tags.is_empty() {
        meta.insert("tags".into(), json!(idea.tags));
    }
    let folder = root.join("灵感盒").join("任务");
    let stem = vault::slugify(&title, "task");
    let p = vault::unique_path(&folder, &stem, ".md");
    let task_rel = p
        .strip_prefix(&root)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "路径错误".to_string())?;
    vault::write_note(&root, &task_rel, &meta, &text).map_err(|e| format!("写入失败：{e}"))?;
    // 想法还在「收件箱/想想」时顺手推进为「在做」，让两条视图对得上。
    let st = idea.meta.get("status").and_then(Value::as_str).unwrap_or("inbox");
    if matches!(st, "inbox" | "thinking") {
        let mut im = idea.meta.clone();
        im.insert("status".into(), json!("building"));
        im.insert("updated".into(), json!(vault::now_str()));
        let _ = vault::write_note(&root, &rel, &im, &idea.body);
    }
    let _ = sync_vault(state);
    touch_sig(state);
    Ok(json!({ "ok": true, "path": task_rel, "title": title }))
}

/// 后台监听：每 5 秒算一次库指纹，发现外部改动就重建索引并通知界面。
///
/// 用轮询而不是文件系统事件，是为了不引入额外依赖、也不被编辑器的
/// 「先写临时文件再改名」这类行为绕晕；两百多篇笔记算一次指纹是毫秒级。
pub fn spawn_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let mut root = vault_root(&state);
        *state.watch_sig.lock().unwrap() = vault::signature(&root);
        loop {
            // 设置里的「自动刷新」可以关掉，间隔也能改；关闭时低频空转，便于随时打开。
            let (watch, interval) = {
                let c = state.cfg.lock().unwrap();
                (c.behavior.watch, c.behavior.watch_interval.clamp(2, 120) as u64)
            };
            std::thread::sleep(std::time::Duration::from_secs(if watch { interval } else { 2 }));
            if !watch {
                continue;
            }
            let now_root = vault_root(&state);
            if now_root.as_os_str().is_empty() || !now_root.is_dir() {
                continue;
            }
            // 换了库：指纹基准要跟着换，并立刻重建一次索引
            if now_root != root {
                root = now_root;
                *state.watch_sig.lock().unwrap() = vault::signature(&root);
                let Ok(_guard) = state.writes.lock() else { continue };
                let report = sync_vault(&state);
                drop(_guard);
                let total = report.get("total").cloned().unwrap_or(json!(0));
                let _ = app.emit("vault-changed", json!({ "total": total }));
                continue;
            }
            let sig = vault::signature(&root);
            {
                let mut last = state.watch_sig.lock().unwrap();
                if *last == sig {
                    continue;
                }
                *last = sig;
            }
            let Ok(_guard) = state.writes.lock() else { continue };
            let report = sync_vault(&state);
            drop(_guard);
            let total = report.get("total").cloned().unwrap_or(json!(0));
            let _ = app.emit("vault-changed", json!({ "total": total }));
        }
    });
}

fn collect_items(state: &State<AppState>, paths: &[String]) -> Vec<Value> {
    let idx = state.index.lock().unwrap();
    let assets_items = state.assets.lock().unwrap().clone();
    let mut out: Vec<Value> = Vec::new();
    for p in paths {
        if let Some(n) = idx.get(p) {
            out.push(json!({ "title": n.title, "kind": n.kind, "path": n.path, "text": n.body }));
        } else if let Some(a) = assets_items.iter().find(|a| a["path"] == *p) {
            let mut lines = vec![format!("文件名：{}", a["name"].as_str().unwrap_or(""))];
            if let Some(c) = a.get("cat").and_then(|x| x.as_str()) {
                lines.push(format!("分类：{c}"));
            }
            if let (Some(w), Some(h)) = (a.get("w").and_then(|x| x.as_i64()), a.get("h").and_then(|x| x.as_i64())) {
                lines.push(format!("尺寸：{w}×{h}"));
            }
            if let Some(d) = a.get("dur").and_then(|x| x.as_f64()) {
                lines.push(format!("时长：{d} 秒"));
            }
            if let Some(note) = a.get("note").and_then(|x| x.as_str()) {
                if !note.is_empty() {
                    lines.push(format!("说明：{note}"));
                }
            }
            if let Some(auth) = a.get("author").and_then(|x| x.as_str()) {
                if !auth.is_empty() {
                    lines.push(format!("作者：{auth}"));
                }
            }
            out.push(json!({ "title": a["name"], "kind": "asset", "path": p, "text": lines.join("\n") }));
        }
    }
    out
}

fn run_ai(state: &State<AppState>, body: &Value) -> Result<Value, String> {
    let mode = {
        let v = s(body, "mode");
        if v.is_empty() { "summarize".to_string() } else { v }
    };
    let paths: Vec<String> = body
        .get("paths")
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    if paths.is_empty() {
        return Err("先选几篇笔记或素材".into());
    }
    let items = collect_items(state, &paths);
    if items.is_empty() {
        return Err("选中的内容都读不到".into());
    }
    let ai_cfg = state.cfg.lock().unwrap().ai.clone();
    let extra = s(body, "extra");
    let run_id = s(body, "run_id");
    // 只有远程接口 + 前端给了 run_id 才走流式；本地分析本来就快，没必要。
    // 前端没显式传 stream 时，跟随设置里的「流式输出」开关。
    let want_stream = body
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(ai_cfg.stream);
    let streamable = want_stream && ai_cfg.provider.eq_ignore_ascii_case("openai") && !run_id.is_empty();
    let out = if streamable {
        let handle = state.handle.lock().unwrap().clone();
        let id = run_id.clone();
        crate::ai::call_llm_stream(&ai_cfg, &mode, &items, &extra, move |delta| {
            if let Some(h) = &handle {
                let _ = h.emit("ai-chunk", json!({ "id": id, "delta": delta }));
            }
        })?
    } else {
        crate::ai::run(&mode, &items, &ai_cfg, &extra)?
    };
    let model = out.get("model").and_then(|x| x.as_str()).unwrap_or("local").to_string();
    let text = out.get("text").and_then(|x| x.as_str()).unwrap_or("").to_string();
    {
        let mut idx = state.index.lock().unwrap();
        idx.save_run(&mode, "", &text, &model, &paths);
    }
    Ok(json!({ "mode": mode, "text": text, "model": model, "sources": paths, "usage": out.get("usage").cloned().unwrap_or(json!({})) }))
}

fn save_digest(state: &State<AppState>, body: &Value) -> Result<Value, String> {
    let mode = {
        let v = s(body, "mode");
        if v.is_empty() { "summarize".to_string() } else { v }
    };
    let text = s(body, "text");
    let paths: Vec<String> = body
        .get("sources")
        .or_else(|| body.get("paths"))
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    if text.trim().is_empty() {
        return Err("内容为空".into());
    }
    let root = vault_root(state);
    let folder = root.join("灵感盒").join("整理");
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M").to_string();
    let requested_title = s(body, "title");
    let title = if requested_title.trim().is_empty() {
        format!("AI 整理 · {mode} · {stamp}")
    } else {
        requested_title.trim().to_string()
    };
    let stem = vault::slugify(&title, &format!("AI-整理-{stamp}"));
    let p = vault::unique_path(&folder, &stem, ".md");
    let rel = p
        .strip_prefix(&root)
        .map(|r| r.to_string_lossy().replace('\\', "/"))
        .map_err(|_| "路径错误".to_string())?;
    let mut meta = serde_json::Map::new();
    meta.insert("title".into(), json!(title));
    if let Some(model) = body.get("model").and_then(Value::as_str) {
        meta.insert("model".into(), json!(model));
    }
    // 来源写成 Obsidian 双链：点开整理稿能跳到来源笔记，来源笔记的反向
    // 链接面板里也会出现这篇整理稿，等于自带双向追溯。
    let links: Vec<String> = {
        let idx = state.index.lock().unwrap();
        paths
            .iter()
            .map(|p| match idx.get(p) {
                Some(n) if !n.title.trim().is_empty() => format!("[[{}]]", n.title.trim()),
                _ => p.clone(),
            })
            .collect()
    };
    meta.insert("type".into(), json!("digest"));
    meta.insert("created".into(), json!(vault::now_str()));
    meta.insert("mode".into(), json!(mode));
    if !paths.is_empty() {
        meta.insert("sources".into(), json!(paths));
    }
    let body_text = format!("{}\n\n---\n来源：{}\n", text.trim(), links.join("、"));
    vault::write_note(&root, &rel, &meta, &body_text).map_err(|e| format!("写入失败：{e}"))?;
    let _ = sync_vault(state);
    Ok(json!({ "ok": true, "path": rel }))
}

fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let s = s.split(',').last().unwrap_or(s);
    let table = |c: u8| -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut bits = 0;
    for c in s.bytes() {
        if c == b'=' || c == b'\n' || c == b'\r' || c == b' ' {
            continue;
        }
        let v = table(c)?;
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Some(out)
}

fn base64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    out
}

// ---------------------------------------------------------------- 原生能力

#[tauri::command]
pub fn open_asset(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("文件不存在".into());
    }
    open::that(p).map_err(|e| format!("打开失败：{e}"))
}

#[tauri::command]
pub fn reveal_asset(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("文件不存在".into());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(p)
            .spawn()
            .map_err(|e| format!("打开资源管理器失败：{e}"))?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let dir = p.parent().unwrap_or(p);
        open::that(dir).map_err(|e| format!("打开失败：{e}"))
    }
}

#[tauri::command]
pub fn open_in_obsidian(state: State<AppState>, path: String) -> Result<(), String> {
    let root = vault_root(&state);
    let vault_name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let rel = path.trim_end_matches(".md").to_string();
    let url = format!(
        "obsidian://open?vault={}&file={}",
        urlencode(&vault_name),
        urlencode(&rel)
    );
    open::that(&url).map_err(|e| format!("调用 Obsidian 失败：{e}"))
}

fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[tauri::command]
pub fn pick_vault(app: AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    folder.map(|p| p.to_string())
}

/// 把 "Ctrl+Alt+N" 这样的组合串解析成插件能注册的快捷键。
fn parse_shortcut(combo: &str) -> Result<tauri_plugin_global_shortcut::Shortcut, String> {
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
    let mut mods = Modifiers::empty();
    let mut key: Option<String> = None;
    for part in combo.split('+').map(|s| s.trim()).filter(|s| !s.is_empty()) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => mods |= Modifiers::CONTROL,
            "alt" | "option" => mods |= Modifiers::ALT,
            "shift" => mods |= Modifiers::SHIFT,
            "win" | "meta" | "super" | "cmd" => mods |= Modifiers::SUPER,
            other => key = Some(other.to_string()),
        }
    }
    let k = key.ok_or_else(|| "热键里缺少主键，例如 Ctrl+Alt+N".to_string())?;
    let code_name = if k.chars().count() == 1 {
        let ch = k.chars().next().unwrap();
        if ch.is_ascii_digit() {
            format!("Digit{ch}")
        } else {
            format!("Key{}", ch.to_ascii_uppercase())
        }
    } else {
        k.to_ascii_uppercase()
    };
    let code = Code::from_str(&code_name).map_err(|_| format!("不支持的按键：{k}（可用 A–Z、0–9、F1–F12）"))?;
    Ok(Shortcut::new(Some(mods), code))
}

/// 重新注册全局热键。设置页保存后调用，返回错误时界面提示原因。
#[tauri::command]
pub fn apply_hotkey(state: State<AppState>, enabled: bool, combo: String) -> Result<(), String> {
    let app = state
        .handle
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "应用尚未就绪".to_string())?;
    apply_hotkey_impl(&app, enabled, &combo)
}

pub fn apply_hotkey_impl(
    app: &AppHandle,
    enabled: bool,
    combo: &str,
) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if !enabled {
        return Ok(());
    }
    let sc = parse_shortcut(combo)?;
    gs.register(sc)
        .map_err(|e| format!("热键 {combo} 注册失败（可能被其他程序占用）：{e}"))
}

#[tauri::command]
pub fn app_info(state: State<AppState>) -> Value {
    let vault = vault_root(&state);
    let library = library_root(&state);
    json!({
        "vault": vault.to_string_lossy(),
        "library": library.to_string_lossy(),
        "exe_dir": crate::config::exe_dir().to_string_lossy(),
        "config_dir": crate::config::config_path().parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        "version": env!("CARGO_PKG_VERSION"),
    })
}

/// 在系统文件管理器里定位文件（资源管理器会选中它）。
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("找不到这个文件：{path}"));
    }
    #[cfg(target_os = "windows")]
    {
        let mut cmd = std::process::Command::new("explorer.exe");
        cmd.arg(format!("/select,{path}"));
        cmd.spawn().map_err(|e| format!("打开资源管理器失败：{e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let dir = p.parent().ok_or_else(|| "找不到所在目录".to_string())?;
        open::that(dir).map_err(|e| format!("打开失败：{e}"))
    }
}

/// 用系统文件管理器打开目录（设置页的“打开”按钮）。
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    if !Path::new(&path).is_dir() {
        return Err(format!("目录不存在：{path}"));
    }
    open::that(&path).map_err(|e| format!("打开失败：{e}"))
}

/// 让前端可以拿到 asset:// 地址（音视频/图片走 Tauri 协议，避免把文件读进内存）。
#[tauri::command]
pub fn asset_url(app: AppHandle, path: String) -> String {
    // 前端也可以用 convertFileSrc；这里保留一个服务端实现方便调试
    let _ = app;
    path
}

pub fn setup_state(app: &AppHandle) -> AppState {
    let cfg = Config::load();
    let state = AppState::new(cfg);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_title("灵感坞");
    }
    state
}
