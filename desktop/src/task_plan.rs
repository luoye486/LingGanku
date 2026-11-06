//! Preview has no side effects. Apply is called only under api::AppState::writes.
use crate::{ai, config::AiConfig, vault};
use serde_json::{json, Value};
use std::{fs, io::Write, path::{Component, Path, PathBuf}};

fn invalid(message: &str) -> String { format!("E_TASK_PLAN_INVALID: {message}") }

fn source_path(body: &Value) -> Result<String, String> {
    let rel = body["path"].as_str().ok_or_else(|| invalid("缺少 path"))?;
    if rel.len() > 1024 || rel.contains('\\') || rel.contains(':') || rel.chars().any(char::is_control)
        || !Path::new(rel).components().all(|c| matches!(c, Component::Normal(_)))
        || !(rel.starts_with("灵感盒/想法/") || rel.starts_with("灵感盒/任务/"))
        || !rel.ends_with(".md") {
        return Err(invalid("只能选择当前库内的想法或任务 Markdown 路径"));
    }
    Ok(rel.to_owned())
}

fn source(root: &Path, rel: &str) -> Result<vault::Note, String> {
    let canonical = fs::canonicalize(root).map_err(|_| invalid("库不存在"))?;
    let path = vault::safe_join(&canonical, rel).ok_or_else(|| invalid("来源不存在或越过库边界"))?;
    let before = fs::metadata(&path).map_err(|e| invalid(&e.to_string()))?;
    if !before.is_file() || before.len() > 2_000_000 { return Err(invalid("来源过大或不是文件")); }
    let note = vault::read_note(&canonical, rel).ok_or_else(|| invalid("无法读取来源"))?;
    let after = fs::metadata(path).map_err(|e| invalid(&e.to_string()))?;
    if before.modified().ok() != after.modified().ok() || before.len() != after.len() {
        return Err("E_CONFLICT".into());
    }
    Ok(note)
}

pub(super) fn validate_steps(value: &Value) -> Result<Vec<Value>, String> {
    let steps = value.as_array().ok_or_else(|| invalid("steps 必须是数组"))?;
    if !(1..=12).contains(&steps.len()) { return Err(invalid("需要 1–12 个步骤")); }
    steps.iter().map(|step| {
        let text = |key: &str, max: usize, empty: bool| -> Result<String, String> {
            let v = step[key].as_str().ok_or_else(|| invalid(&format!("{key} 必须是字符串")))?;
            if (!empty && v.trim().is_empty()) || v.chars().count() > max || v.contains('\0') {
                return Err(invalid(&format!("{key} 为空或过长")));
            }
            Ok(v.to_owned())
        };
        let title = text("title", 120, false)?;
        if title.chars().any(char::is_control) { return Err(invalid("title 必须单行")); }
        let body = text("body", 6000, false)?;
        let priority = text("priority", 4, false)?;
        if !matches!(priority.as_str(), "high" | "mid" | "low") { return Err(invalid("priority 必须为 high/mid/low")); }
        let due = text("due", 10, true)?;
        if !due.is_empty() && (due.len() != 10 || !due.bytes().enumerate().all(|(i,b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() })
            || chrono::NaiveDate::parse_from_str(&due, "%Y-%m-%d").is_err() || due.starts_with("0000")) {
            return Err(invalid("due 必须为空或有效的 YYYY-MM-DD 日期"));
        }
        Ok(json!({"title":title,"body":body,"priority":priority,"due":due}))
    }).collect()
}

pub(super) fn preview(root: &Path, cfg: &AiConfig, body: &Value) -> Result<Value, String> {
    let rel = source_path(body)?;
    let note = source(root, &rel)?;
    let extra = match body.get("extra") { None => "", Some(v) => v.as_str().ok_or_else(|| invalid("extra 必须是字符串"))? };
    if extra.chars().count() > 4000 { return Err(invalid("extra 最多 4000 字")); }
    let (model, raw) = if cfg.provider.eq_ignore_ascii_case("openai") {
        let result = ai::call_llm(cfg, "task_plan", &[json!({"title":note.title,"text":note.body})], extra)?;
        let raw: Value = serde_json::from_str(result["text"].as_str().unwrap_or(""))
            .map_err(|_| invalid("模型没有返回合法的计划 JSON"))?;
        (cfg.model.clone(), raw["steps"].clone())
    } else {
        let subject: String = note.title.chars().take(65).collect();
        let excerpt: String = note.body.trim().chars().take(800).collect();
        let extra: String = extra.chars().take(800).collect();
        let rows = [
            (format!("明确「{subject}」的验收标准"), format!("本地规则拆解（非大模型生成）：阅读来源，列出目标、约束和待确认事项。\n来源摘录：{excerpt}\n补充要求：{extra}\n产出：一份可核对的验收清单。")),
            (format!("完成「{subject}」的最小可用成果"), "本地规则拆解：根据验收清单选择最小范围，逐项执行并记录结果；遇到缺失信息先列明问题。\n产出：可演示或可检查的第一版成果。".into()),
            (format!("验证并复盘「{subject}」"), "本地规则拆解：逐项对照验收清单检查成果，记录证据、未达标项和下一步；通过后再由你决定是否完成来源任务。\n产出：验证记录与后续行动清单。".into()),
        ];
        ("local".to_string(), Value::Array(rows.into_iter().map(|(title,body)| json!({"title":title,"body":body,"priority":"mid","due":""})).collect()))
    };
    let steps = validate_steps(&raw)?;
    // Accept model dates only when an explicit date actually occurs in supplied material.
    for step in &steps {
        let due = step["due"].as_str().unwrap_or("");
        if !due.is_empty() && !note.body.contains(due) && !note.title.contains(due) && !extra.contains(due) {
            return Err(invalid("模型生成了来源和补充要求中没有的截止日期"));
        }
    }
    Ok(json!({"path":rel,"base_mtime":note.mtime,"model":model,"steps":steps}))
}

// Validate existing ancestors before creating anything, including junction targets.
fn destination(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let path = root.join(rel);
    let mut ancestor = path.as_path();
    while !ancestor.exists() { ancestor = ancestor.parent().ok_or_else(|| invalid("写入路径错误"))?; }
    if !fs::canonicalize(ancestor).map_err(|e| e.to_string())?.starts_with(&root) {
        return Err(invalid("写入路径越过库边界"));
    }
    Ok(path)
}

fn create_new(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| invalid("写入路径错误"))?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // Publish only a complete file; hard_link is atomic and never replaces a destination.
    let mut temp = None;
    for i in 0..1000 {
        let p = parent.join(format!(".task-plan-{}-{i}.tmp", std::process::id()));
        match fs::OpenOptions::new().write(true).create_new(true).open(&p) {
            Ok(f) => { temp = Some((p, f)); break; }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    let (temp, mut file) = temp.ok_or_else(|| "临时文件名称耗尽".to_string())?;
    let result = (|| {
        file.write_all(data).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::hard_link(&temp, path).map_err(|e| e.to_string())
    })();
    let _ = fs::remove_file(temp);
    result
}

pub(super) fn apply(root: &Path, body: &Value) -> Result<Value, String> {
    let rel = source_path(body)?;
    let base = body["base_mtime"].as_f64().filter(|v| v.is_finite() && *v >= 0.0).ok_or_else(|| invalid("缺少有效 base_mtime"))?;
    let steps = validate_steps(&body["steps"])?;
    let id = body["request_id"].as_str().ok_or_else(|| invalid("缺少 request_id"))?;
    if id.is_empty() || id.len() > 100 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err(invalid("request_id 需为 1–100 位字母、数字、- 或 _"));
    }
    let payload = json!({"path":rel,"base_mtime":base,"steps":steps});
    // Lossless ASCII encoding: vault's minimal scalar parser does not unescape JSON.
    let payload_key: String = payload.to_string().bytes().map(|b| format!("{b:02x}")).collect();
    let receipt_path = destination(root, &format!(".linganhe/task-plans/{id}.json"))?;
    let mut reused = receipt_path.exists();
    let mut receipt: Value = if reused {
        serde_json::from_slice(&fs::read(&receipt_path).map_err(|e| format!("E_TASK_PLAN_RECEIPT: {e}"))?)
            .map_err(|_| "E_TASK_PLAN_RECEIPT: 重试记录损坏".to_string())?
    } else { Value::Null };
    if reused && receipt["payload"] != payload { return Err("E_TASK_PLAN_REQUEST_REUSE: request_id 已用于不同请求".into()); }
    // Scan fresh disk metadata (not the index); recover files even after an interrupted response.
    let mut found: Vec<Option<Value>> = vec![None; steps.len()];
    for note in vault::scan(root, false) {
        if note.meta.get("plan_id").and_then(Value::as_str) != Some(id) { continue; }
        if note.meta.get("plan_payload").and_then(Value::as_str) != Some(payload_key.as_str()) {
            return Err("E_TASK_PLAN_REQUEST_REUSE: 已存在不同内容的计划任务".into());
        }
        let i = note.meta.get("plan_step").and_then(Value::as_u64).ok_or_else(|| invalid("计划步骤记录损坏"))? as usize;
        if i == 0 || i > steps.len() || found[i-1].is_some() { return Err(invalid("计划步骤记录重复或损坏")); }
        found[i-1] = Some(json!({"path":note.path,"title":steps[i-1]["title"]}));
        reused = true;
    }
    if found.iter().all(Option::is_some) {
        return Ok(json!({"ok":true,"items":found.into_iter().flatten().collect::<Vec<_>>(),"reused":true}));
    }
    if receipt.is_null() {
        let note = source(root, &rel)?;
        if (note.mtime - base).abs() >= 0.001 { return Err("E_CONFLICT".into()); }
        let mut paths = Vec::new();
        for (i, step) in steps.iter().enumerate() {
            let stem = vault::slugify(step["title"].as_str().unwrap(), "task");
            let p = format!("灵感盒/任务/{stem}-{id}-{}.md", i+1);
            let destination = destination(root, &p)?;
            if destination.exists() && found[i].is_none() { return Err(invalid("目标文件已存在，未覆盖")); }
            paths.push(p);
        }
        receipt = json!({"payload":payload,"paths":paths,"parent":rel.starts_with("灵感盒/任务/"),"created":vault::now_str()});
        create_new(&receipt_path, &serde_json::to_vec(&receipt).map_err(|e| e.to_string())?)
            .map_err(|e| format!("E_TASK_PLAN_RECEIPT: {e}"))?;
    }
    let paths = receipt["paths"].as_array().filter(|p| p.len() == steps.len()).ok_or_else(|| invalid("重试记录缺少路径"))?;
    let mut targets = Vec::new();
    for path in paths {
        let p = path.as_str().ok_or_else(|| invalid("重试记录路径损坏"))?;
        if !p.starts_with("灵感盒/任务/") || p.contains('\\') || !Path::new(p).components().all(|c| matches!(c, Component::Normal(_))) || !p.ends_with(".md") { return Err(invalid("重试记录路径越界")); }
        targets.push(destination(root, p)?);
    }
    // Also inspect reserved paths directly: vault scans intentionally skip directory
    // symlinks, while safe in-vault junction destinations are still valid writes.
    for (i, path) in paths.iter().enumerate() {
        if found[i].is_some() || !targets[i].exists() { continue; }
        let note = vault::read_note(root, path.as_str().unwrap()).ok_or_else(|| invalid("无法读取已存在的目标任务"))?;
        if note.meta.get("plan_id").and_then(Value::as_str) != Some(id)
            || note.meta.get("plan_payload").and_then(Value::as_str) != Some(payload_key.as_str())
            || note.meta.get("plan_step").and_then(Value::as_u64) != Some((i+1) as u64) {
            return Err("E_TASK_PLAN_REQUEST_REUSE: 目标文件已存在且内容不同，未覆盖".into());
        }
        found[i] = Some(json!({"path":path,"title":steps[i]["title"]}));
        reused = true;
    }
    let mut created = Vec::new();
    for (i, step) in steps.iter().enumerate() {
        if found[i].is_some() { continue; }
        let mut meta = serde_json::Map::new();
        for key in ["title", "priority", "due"] { meta.insert(key.into(), step[key].clone()); }
        meta.insert("type".into(), json!("task"));
        meta.insert("status".into(), json!("todo"));
        meta.insert("source".into(), json!(rel));
        if receipt["parent"] == true { meta.insert("parent".into(), json!(rel)); }
        meta.insert("plan_id".into(), json!(id));
        meta.insert("plan_step".into(), json!(i+1));
        meta.insert("plan_payload".into(), json!(payload_key));
        for key in ["created", "updated"] { meta.insert(key.into(), receipt["created"].clone()); }
        let text = format!("{}\n\n---\n来源：[[{}]]", step["body"].as_str().unwrap(), rel.trim_end_matches(".md"));
        // JSON scalars are valid YAML and prevent frontmatter injection. The receipt
        // key uses plain ASCII hex so even the minimal vault parser round-trips it.
        let mut content = String::from("---\n");
        for (key, value) in &meta { content.push_str(&format!("{key}: {value}\n")); }
        content.push_str(&format!("---\n\n{text}\n"));
        if let Err(error) = create_new(&targets[i], content.as_bytes()) {
            return Ok(json!({"ok":false,"error":format!("E_TASK_PLAN_PARTIAL: {error}"),"items":found.into_iter().flatten().collect::<Vec<_>>(),"created":created,"reused":reused}));
        }
        let item = json!({"path":paths[i],"title":step["title"]});
        found[i] = Some(item.clone());
        created.push(item);
    }
    Ok(json!({"ok":true,"items":found.into_iter().flatten().collect::<Vec<_>>(),"reused":reused}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, String, AiConfig) {
        static SEQ: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!("linganhe-plan-test-{}-{}", std::process::id(), SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
        fs::create_dir_all(root.join("灵感盒/想法")).unwrap();
        let rel = "灵感盒/想法/来源.md".to_owned();
        fs::write(root.join(&rel), "---\ntitle: 测试计划\nstatus: thinking\n---\n\n实现一个能导出数据的小工具。\n").unwrap();
        (root, rel, serde_json::from_str("{}").unwrap())
    }
    #[test]
    fn validation_dates_and_paths() {
        let step = |due: &str| json!([{"title":"任务","body":"验收结果","priority":"mid","due":due}]);
        assert!(validate_steps(&step("2028-02-29")).is_ok());
        for date in ["2026-02-29", "2026-04-31", "0000-01-01", "2026-1-01"] { assert!(validate_steps(&step(date)).is_err()); }
        for path in ["../secret.md", "灵感盒/想法/../../secret.md", "灵感盒/整理/x.md", "C:/a.md"] { assert!(source_path(&json!({"path":path})).is_err()); }
        assert!(validate_steps(&json!([])).is_err());
        assert!(validate_steps(&json!([{"title":"x\ny","body":"x","priority":"mid","due":""}])).is_err());
    }
    #[test]
    fn local_preview_apply_retry_and_stale_source() {
        let (root, rel, cfg) = fixture();
        let original = fs::read(root.join(&rel)).unwrap();
        let plan = preview(&root, &cfg, &json!({"path":rel})).unwrap();
        assert_eq!(plan["model"], "local"); assert_eq!(plan["steps"].as_array().unwrap().len(), 3);
        assert!(!root.join("灵感盒/任务").exists());
        let mut request = plan.clone(); request["request_id"] = json!("retry-test");
        let first = apply(&root, &request).unwrap(); assert_eq!(first["ok"], true); assert_eq!(first["reused"], false);
        assert_eq!(fs::read(root.join(&rel)).unwrap(), original);
        fs::write(root.join(&rel), "changed source").unwrap();
        let second = apply(&root, &request).unwrap(); assert_eq!(second["items"], first["items"]); assert_eq!(second["reused"], true);
        request["steps"][0]["title"] = json!("different"); assert!(apply(&root, &request).unwrap_err().starts_with("E_TASK_PLAN_REQUEST_REUSE"));
        request = plan; request["request_id"] = json!("stale-test"); assert_eq!(apply(&root, &request).unwrap_err(), "E_CONFLICT");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn partial_failure_resumes_without_duplicate() {
        let (root, rel, cfg) = fixture();
        let mut request = preview(&root, &cfg, &json!({"path":rel})).unwrap(); request["request_id"] = json!("partial-test");
        // Arrange an unwritable second destination (a directory) before apply.
        let title = request["steps"][1]["title"].as_str().unwrap();
        let blocked = root.join(format!("灵感盒/任务/{}-partial-test-2.md", vault::slugify(title, "task")));
        // First persist a valid receipt, then simulate interruption by removing tasks.
        let result = apply(&root, &request).unwrap();
        for item in result["items"].as_array().unwrap() { fs::remove_file(root.join(item["path"].as_str().unwrap())).unwrap(); }
        fs::create_dir(&blocked).unwrap();
        let failed = apply(&root, &request).unwrap_err();
        assert!(failed.starts_with("E_TASK_PLAN_INVALID")); // all targets checked before writes
        fs::remove_dir(&blocked).unwrap();
        // Now force a later failure by making the third title's destination parent readonly
        // is platform-dependent; disk recovery is exercised by leaving only step one.
        let complete = apply(&root, &request).unwrap();
        for item in complete["items"].as_array().unwrap().iter().skip(1) { fs::remove_file(root.join(item["path"].as_str().unwrap())).unwrap(); }
        fs::write(root.join(&rel), "changed after partial apply").unwrap();
        let resumed = apply(&root, &request).unwrap(); assert_eq!(resumed["ok"], true); assert_eq!(resumed["items"], complete["items"]);
        assert_eq!(vault::scan(&root, false).iter().filter(|n| n.meta.get("plan_id").and_then(Value::as_str) == Some("partial-test")).count(), 3);
        fs::remove_dir_all(root).unwrap();
    }
}
