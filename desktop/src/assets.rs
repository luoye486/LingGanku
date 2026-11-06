//! 素材库：扫描 assets/、读取署名与像素元数据、处理导入。
//!
//! 统一返回 {path,name,cat,kind,ext,size,mtime,w,h,dur,note,author,license}
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::LazyLock;

pub const IMAGE_EXT: [&str; 7] = ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"];
pub const AUDIO_EXT: [&str; 5] = ["wav", "mp3", "ogg", "m4a", "flac"];
pub const VIDEO_EXT: [&str; 4] = ["mp4", "webm", "mov", "mkv"];

/// 目录 → 中文分类（顺序即展示顺序）
pub const CATS: [(&str, &str); 16] = [
    ("assets/pixel/characters", "像素 · 角色"),
    ("assets/pixel/items", "像素 · 道具"),
    ("assets/pixel/tiles", "像素 · 瓦片"),
    ("assets/pixel/ui", "像素 · 界面"),
    ("assets/pixel/backgrounds", "像素 · 背景"),
    ("assets/pixel/audio/bgm", "像素 · 配乐"),
    ("assets/pixel/audio/sfx", "像素 · 音效"),
    ("assets/images/icons", "图标"),
    ("assets/images/patterns", "图案"),
    ("assets/images/backgrounds", "背景图"),
    ("assets/images/photos", "照片"),
    ("assets/audio/bgm", "配乐"),
    ("assets/audio/sfx", "音效"),
    ("assets/video/stock", "视频"),
    ("assets/video/placeholders", "占位视频"),
    ("assets/uploads", "我的上传"),
];

static VIEWBOX_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"viewBox="([\d.\-]+) ([\d.\-]+) ([\d.]+) ([\d.]+)""#).unwrap()
});
static WIDTH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"width="([\d.]+)""#).unwrap());
static SAFE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"[\\/:*?"<>|\r\n\t]+"#).unwrap());

pub fn cat_of(rel: &str) -> String {
    for (prefix, name) in CATS.iter() {
        if rel.starts_with(&format!("{prefix}/")) {
            return name.to_string();
        }
    }
    let parent = rel.rsplit_once('/').map(|(p, _)| p).unwrap_or(rel);
    CATS.iter()
        .find(|(p, _)| *p == parent)
        .map(|(_, n)| n.to_string())
        .unwrap_or_else(|| "其他".to_string())
}

pub fn kind_of(ext: &str) -> &'static str {
    let e = ext.to_lowercase();
    if IMAGE_EXT.contains(&e.as_str()) {
        "image"
    } else if AUDIO_EXT.contains(&e.as_str()) {
        "audio"
    } else if VIDEO_EXT.contains(&e.as_str()) {
        "video"
    } else {
        "file"
    }
}

fn load_json(p: &Path) -> Option<Value> {
    let text = fs::read_to_string(p).ok()?;
    serde_json::from_str(&text).ok()
}

fn credits(root: &Path) -> HashMap<String, Value> {
    let mut out = HashMap::new();
    if let Some(v) = load_json(&root.join("meta").join("credits.json")) {
        if let Some(items) = v.get("items").and_then(|x| x.as_array()) {
            for it in items {
                if let Some(p) = it.get("path").and_then(|x| x.as_str()) {
                    out.insert(p.to_string(), it.clone());
                }
            }
        }
    }
    out
}

fn pixel_meta(root: &Path) -> (HashMap<String, Value>, Value) {
    let mut sheets = HashMap::new();
    let data = load_json(&root.join("meta").join("pixel.json")).unwrap_or(Value::Null);
    if let Some(arr) = data.get("sheets").and_then(|x| x.as_array()) {
        for s in arr {
            if let Some(f) = s.get("file").and_then(|x| x.as_str()) {
                sheets.insert(f.to_string(), s.clone());
            }
        }
    }
    (sheets, data)
}

/// 图片尺寸：png/gif/jpeg 读头部，其它交给 image crate。
fn probe_image(p: &Path, ext: &str) -> Option<(u32, u32)> {
    let mut f = fs::File::open(p).ok()?;
    let mut head = [0u8; 32];
    let n = f.read(&mut head).ok()?;
    let head = &head[..n];
    if head.len() >= 24 && &head[..8] == b"\x89PNG\r\n\x1a\n" {
        let w = u32::from_be_bytes([head[16], head[17], head[18], head[19]]);
        let h = u32::from_be_bytes([head[20], head[21], head[22], head[23]]);
        return Some((w, h));
    }
    if head.len() >= 10 && (&head[..6] == b"GIF87a" || &head[..6] == b"GIF89a") {
        let w = u16::from_le_bytes([head[6], head[7]]) as u32;
        let h = u16::from_le_bytes([head[8], head[9]]) as u32;
        return Some((w, h));
    }
    if ext == "jpg" || ext == "jpeg" {
        if let Ok(reader) = image::ImageReader::open(p) {
            if let Ok(reader) = reader.with_guessed_format() {
                if let Ok(dims) = reader.into_dimensions() {
                    return Some(dims);
                }
            }
        }
        return None;
    }
    if ext == "webp" || ext == "bmp" || ext == "avif" || ext == "png" || ext == "gif" {
        if let Ok(reader) = image::ImageReader::open(p) {
            if let Ok(reader) = reader.with_guessed_format() {
                if let Ok(dims) = reader.into_dimensions() {
                    return Some(dims);
                }
            }
        }
    }
    None
}

/// WAV 时长：直接解析 RIFF 头，不依赖解码器。
fn wav_duration(p: &Path) -> Option<f64> {
    let bytes = fs::read(p).ok()?;
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut pos = 12usize;
    let mut byte_rate = 0u32;
    let mut data_len = 0u32;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes([
            bytes[pos + 4],
            bytes[pos + 5],
            bytes[pos + 6],
            bytes[pos + 7],
        ]) as usize;
        if id == b"fmt " && pos + 8 + 16 <= bytes.len() {
            byte_rate = u32::from_le_bytes([
                bytes[pos + 16],
                bytes[pos + 17],
                bytes[pos + 18],
                bytes[pos + 19],
            ]);
        } else if id == b"data" {
            data_len = size as u32;
            break;
        }
        pos += 8 + size + (size & 1);
    }
    if byte_rate == 0 {
        return None;
    }
    Some((data_len as f64 / byte_rate as f64 * 100.0).round() / 100.0)
}

fn ffprobe(args: &[&str]) -> Option<String> {
    let out = Command::new("ffprobe").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn probe(p: &Path) -> Map<String, Value> {
    let mut info = Map::new();
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if ext == "svg" {
        if let Ok(text) = fs::read_to_string(p) {
            let head: String = text.chars().take(1200).collect();
            if let Some(c) = VIEWBOX_RE.captures(&head) {
                if let (Ok(w), Ok(h)) = (c[3].parse::<f64>(), c[4].parse::<f64>()) {
                    info.insert("w".into(), json!(w.round() as i64));
                    info.insert("h".into(), json!(h.round() as i64));
                }
            } else if let Some(c) = WIDTH_RE.captures(&head) {
                if let Ok(w) = c[1].parse::<f64>() {
                    info.insert("w".into(), json!(w.round() as i64));
                }
            }
        }
    } else if IMAGE_EXT.contains(&ext.as_str()) {
        if let Some((w, h)) = probe_image(p, &ext) {
            info.insert("w".into(), json!(w));
            info.insert("h".into(), json!(h));
        }
    } else if ext == "wav" {
        if let Some(d) = wav_duration(p) {
            info.insert("dur".into(), json!(d));
        }
    } else if AUDIO_EXT.contains(&ext.as_str()) || VIDEO_EXT.contains(&ext.as_str()) {
        let ps = p.to_string_lossy().to_string();
        if let Some(dur) = ffprobe(&[
            "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", &ps,
        ]) {
            if let Ok(d) = dur.parse::<f64>() {
                info.insert("dur".into(), json!((d * 100.0).round() / 100.0));
            }
        }
        if VIDEO_EXT.contains(&ext.as_str()) {
            if let Some(wh) = ffprobe(&[
                "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                "-of", "csv=p=0:s=x", &ps,
            ]) {
                let parts: Vec<&str> = wh.split('x').collect();
                if parts.len() >= 2 {
                    if let (Ok(w), Ok(h)) = (parts[0].trim().parse::<i64>(), parts[1].trim().parse::<i64>()) {
                        info.insert("w".into(), json!(w));
                        info.insert("h".into(), json!(h));
                    }
                }
            }
        }
    }
    info
}

fn is_hidden(rel: &str) -> bool {
    rel.split('/').any(|part| part.starts_with('_') || part.starts_with('.'))
}

pub fn scan(root: &Path, force: bool) -> Vec<Value> {
    let assets = root.join("assets");
    let cache_path = root.join(".data").join("assets.json");
    let mut cached: HashMap<String, Value> = HashMap::new();
    if !force {
        if let Some(v) = load_json(&cache_path) {
            if let Some(obj) = v.get("items").and_then(|x| x.as_object()) {
                for (k, val) in obj {
                    cached.insert(k.clone(), val.clone());
                }
            }
        }
    }
    let creds = credits(root);
    let (sheets, _pix) = pixel_meta(root);
    let tag_map = load_tags(root);
    let note_map = load_notes(root);
    let mut items: Vec<Value> = Vec::new();
    let mut new_cache = Map::new();

    let mut files: Vec<PathBuf> = Vec::new();
    collect_files(&assets, &mut files);
    files.sort();

    for p in files {
        let rel = match p.strip_prefix(root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if is_hidden(&rel) {
            continue;
        }
        let md = match fs::metadata(&p) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let key = format!(
            "{}:{}",
            md.modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0),
            md.len()
        );
        let info = match cached.get(&rel) {
            Some(c) if c.get("key").and_then(|k| k.as_str()) == Some(key.as_str()) => {
                c.get("info").cloned().unwrap_or(json!({}))
            }
            _ => Value::Object(probe(&p)),
        };
        new_cache.insert(rel.clone(), json!({ "key": key, "info": info }));

        let ext = p
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let mut item = Map::new();
        item.insert("path".into(), json!(rel));
        item.insert("name".into(), json!(p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
        item.insert("cat".into(), json!(cat_of(&rel)));
        item.insert("kind".into(), json!(kind_of(&ext)));
        item.insert("ext".into(), json!(ext));
        item.insert("size".into(), json!(md.len()));
        item.insert(
            "mtime".into(),
            json!(md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0)),
        );
        if let Some(obj) = info.as_object() {
            for (k, v) in obj {
                item.insert(k.clone(), v.clone());
            }
        }
        if let Some(cr) = creds.get(&rel) {
            item.insert("author".into(), cr.get("author").cloned().unwrap_or(json!("")));
            item.insert("license".into(), cr.get("license").cloned().unwrap_or(json!("")));
            item.insert("source".into(), cr.get("source").cloned().unwrap_or(json!("")));
        }
        item.insert(
            "tags".into(),
            json!(tag_map.get(&rel).cloned().unwrap_or_default()),
        );
        if let Some(n) = note_map.get(&rel) {
            item.insert("ai_note".into(), json!(n));
        }
        if let Some(sh) = sheets.get(&rel) {
            item.insert("frames".into(), sh.get("frames").cloned().unwrap_or(json!(0)));
            item.insert("fps".into(), sh.get("fps").cloned().unwrap_or(json!(0)));
            item.insert("fw".into(), sh.get("frame_w").cloned().unwrap_or(json!(0)));
            item.insert("fh".into(), sh.get("frame_h").cloned().unwrap_or(json!(0)));
            item.insert("note".into(), sh.get("note").cloned().unwrap_or(json!("")));
        }
        items.push(Value::Object(item));
    }

    let _ = fs::create_dir_all(root.join(".data"));
    let _ = fs::write(
        &cache_path,
        serde_json::to_string(&json!({ "version": 1, "items": new_cache })).unwrap_or_default(),
    );

    let order: HashMap<&str, usize> = CATS.iter().enumerate().map(|(i, (_, n))| (*n, i)).collect();
    items.sort_by(|a, b| {
        let ca = a.get("cat").and_then(|x| x.as_str()).unwrap_or("");
        let cb = b.get("cat").and_then(|x| x.as_str()).unwrap_or("");
        let oa = order.get(ca).copied().unwrap_or(99);
        let ob = order.get(cb).copied().unwrap_or(99);
        oa.cmp(&ob).then_with(|| {
            a.get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .cmp(b.get("name").and_then(|x| x.as_str()).unwrap_or(""))
        })
    });
    items
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let rd = match fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect_files(&p, out);
        } else if p.is_file() {
            out.push(p);
        }
    }
}

pub fn summary(items: &[Value]) -> Value {
    let mut cats: Vec<(String, usize, u64)> = Vec::new();
    for it in items {
        let cat = it.get("cat").and_then(|x| x.as_str()).unwrap_or("其他").to_string();
        let size = it.get("size").and_then(|x| x.as_u64()).unwrap_or(0);
        match cats.iter_mut().find(|(c, _, _)| *c == cat) {
            Some(e) => {
                e.1 += 1;
                e.2 += size;
            }
            None => cats.push((cat, 1, size)),
        }
    }
    let order: Vec<&str> = CATS.iter().map(|(_, n)| *n).collect();
    cats.sort_by_key(|(name, _, _)| {
        order
            .iter()
            .position(|n| *n == name.as_str())
            .unwrap_or(99)
    });
    json!({
        "total": items.len(),
        "size": items.iter().map(|i| i.get("size").and_then(|x| x.as_u64()).unwrap_or(0)).sum::<u64>(),
        "cats": cats.into_iter().map(|(name, count, size)| json!({
            "name": name, "count": count, "size": size
        })).collect::<Vec<_>>(),
    })
}

pub fn save_upload(root: &Path, filename: &str, data: &[u8]) -> std::io::Result<Value> {
    let safe = SAFE_RE.replace_all(filename, "_").trim().to_string();
    let safe = if safe.is_empty() { "upload.bin".to_string() } else { safe };
    let folder = root.join("assets").join("uploads");
    fs::create_dir_all(&folder)?;
    let mut p = folder.join(&safe);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    let mut i = 2;
    while p.exists() {
        p = folder.join(format!("{stem}-{i}{ext}"));
        i += 1;
    }
    fs::write(&p, data)?;
    let rel = p.strip_prefix(root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
    Ok(json!({ "path": rel, "name": p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), "size": data.len() }))
}


/* ---------------------------------------------------------------- 自定义标签 */
fn tags_path(root: &Path) -> PathBuf {
    root.join(".data").join("asset-tags.json")
}

pub fn load_tags(root: &Path) -> HashMap<String, Vec<String>> {
    let mut out = HashMap::new();
    if let Some(obj) = load_json(&tags_path(root)).and_then(|v| v.as_object().cloned()) {
        for (k, v) in obj {
            let tags: Vec<String> = v
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str())
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            if !tags.is_empty() {
                out.insert(k, tags);
            }
        }
    }
    out
}

fn write_tags(root: &Path, map: &HashMap<String, Vec<String>>) -> std::io::Result<()> {
    let p = tags_path(root);
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut obj: Map<String, Value> = Map::new();
    for (k, v) in map {
        obj.insert(k.clone(), json!(v));
    }
    fs::write(
        &p,
        serde_json::to_string_pretty(&Value::Object(obj)).unwrap_or_default(),
    )
}

fn notes_path(root: &Path) -> PathBuf {
    root.join(".data").join("asset-notes.json")
}

pub fn load_notes(root: &Path) -> HashMap<String, String> {
    let mut out = HashMap::new();
    if let Some(obj) = load_json(&notes_path(root)).and_then(|v| v.as_object().cloned()) {
        for (k, v) in obj {
            if let Some(s) = v.as_str() {
                let s = s.trim().to_string();
                if !s.is_empty() {
                    out.insert(k, s);
                }
            }
        }
    }
    out
}

fn write_notes(root: &Path, map: &HashMap<String, String>) -> std::io::Result<()> {
    let p = notes_path(root);
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut obj: Map<String, Value> = Map::new();
    for (k, v) in map {
        obj.insert(k.clone(), json!(v));
    }
    fs::write(
        &p,
        serde_json::to_string_pretty(&Value::Object(obj)).unwrap_or_default(),
    )
}

/// 写入/覆盖一条素材的 AI 说明；空串表示删除。
pub fn set_note(root: &Path, rel: &str, text: &str) -> Result<String, String> {
    if resolve(root, rel).is_none() {
        return Err("找不到这个素材文件".into());
    }
    let mut map = load_notes(root);
    let text: String = text.trim().chars().take(400).collect();
    if text.is_empty() {
        if map.remove(rel).is_some() {
            write_notes(root, &map).map_err(|e| format!("清空素材说明失败：{e}"))?;
        }
        return Ok(String::new());
    }
    map.insert(rel.to_string(), text.clone());
    write_notes(root, &map).map_err(|e| format!("写入素材说明失败：{e}"))?;
    Ok(text)
}

fn clean_tag(raw: &str) -> Option<String> {
    let t = raw.trim().trim_start_matches('#').trim();
    if t.is_empty() || t.chars().count() > 24 {
        return None;
    }
    if t.chars().any(|c| matches!(c, '/' | '\\' | '\n' | '\r' | '\t')) {
        return None;
    }
    Some(t.to_string())
}

/// 设置某个素材的自定义标签；返回清理后的标签列表。
pub fn set_tags(root: &Path, rel: &str, raw: &[String]) -> Result<Vec<String>, String> {
    if resolve(root, rel).is_none() {
        return Err("找不到这个素材文件".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut tags: Vec<String> = Vec::new();
    for r in raw {
        if let Some(t) = clean_tag(r) {
            if seen.insert(t.clone()) {
                tags.push(t);
            }
        }
        if tags.len() >= 12 {
            break;
        }
    }
    let mut map = load_tags(root);
    if tags.is_empty() {
        map.remove(rel);
    } else {
        map.insert(rel.to_string(), tags.clone());
    }
    write_tags(root, &map).map_err(|e| format!("标签保存失败：{e}"))?;
    Ok(tags)
}

/* ---------------------------------------------------------------- 重命名 / 删除 */
fn check_name(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("文件名不能为空".into());
    }
    if n.starts_with('.') || n.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')) {
        return Err("文件名里有不允许的字符".into());
    }
    if n.chars().count() > 120 {
        return Err("文件名太长".into());
    }
    Ok(n.to_string())
}

pub fn rename(root: &Path, rel: &str, new_name: &str) -> Result<String, String> {
    let src = resolve(root, rel).ok_or_else(|| "找不到这个素材文件".to_string())?;
    let parent = src.parent().ok_or_else(|| "路径异常".to_string())?;
    let mut name = check_name(new_name)?;
    let old_ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();
    let has_ext = Path::new(&name).extension().is_some();
    if !has_ext && !old_ext.is_empty() {
        name = format!("{name}.{old_ext}");
    }
    let dst = parent.join(&name);
    if dst == src {
        return Ok(rel.to_string());
    }
    if dst.exists() {
        return Err("同目录下已经有同名文件".into());
    }
    fs::rename(&src, &dst).map_err(|e| format!("重命名失败：{e}"))?;
    // dst 来自 canonicalize 后的绝对路径（Windows 上带 \\?\ 前缀），
    // 不能直接 strip_prefix(root)，改由原相对路径换掉文件名部分。
    let new_rel = match rel.rsplit_once('/') {
        Some((dir, _)) => format!("{dir}/{name}"),
        None => name.clone(),
    };
    let mut map = load_tags(root);
    if let Some(tags) = map.remove(rel) {
        map.insert(new_rel.clone(), tags);
        let _ = write_tags(root, &map);
    }
    let mut notes = load_notes(root);
    if let Some(n) = notes.remove(rel) {
        notes.insert(new_rel.clone(), n);
        let _ = write_notes(root, &notes);
    }
    Ok(new_rel)
}

/// 删除素材：移到 `<library>/.data/trash/`，`.data` 是点开头目录，不会被索引。
pub fn delete_to_trash(root: &Path, rel: &str) -> Result<String, String> {
    for p in [".data/asset-tags.json", ".data/asset-notes.json"] {
        crate::api::recovery::checked(root, p)?;
    }
    let tags = load_tags(root).remove(rel).unwrap_or_default();
    let note = load_notes(root).remove(rel).unwrap_or_default();
    let dst = crate::api::recovery::trash(root, rel, "asset", json!({"tags":tags,"ai_note":note}))?;
    let mut map = load_tags(root);
    if map.remove(rel).is_some() {
        let _ = write_tags(root, &map);
    }
    let mut notes = load_notes(root);
    if notes.remove(rel).is_some() {
        let _ = write_notes(root, &notes);
    }
    Ok(dst
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| ".data/trash".into()))
}

/// Restore exact stored metadata without UI tag/note normalization or truncation.
pub(crate) fn restore_metadata(root: &Path, rel: &str, metadata: &Value) -> Result<(), String> {
    for p in [".data/asset-tags.json", ".data/asset-notes.json"] {
        crate::api::recovery::checked(root, p)?;
    }
    let mut tags = load_tags(root);
    let mut notes = load_notes(root);
    if let Some(v) = metadata["tags"].as_array() {
        tags.insert(rel.into(), v.iter().filter_map(Value::as_str).map(str::to_string).collect());
    }
    if let Some(v) = metadata["ai_note"].as_str() {
        notes.insert(rel.into(), v.into());
    }
    write_tags(root, &tags).map_err(|e| format!("E_RECOVERY_METADATA: {e}"))?;
    write_notes(root, &notes).map_err(|e| format!("E_RECOVERY_METADATA: {e}"))?;
    Ok(())
}

pub fn resolve(root: &Path, rel: &str) -> Option<PathBuf> {
    let assets = fs::canonicalize(root.join("assets")).ok()?;
    let p = fs::canonicalize(root.join(rel)).ok()?;
    if p.starts_with(&assets) && p.is_file() {
        Some(p)
    } else {
        None
    }
}
