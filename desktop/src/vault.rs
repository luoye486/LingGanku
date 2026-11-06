//! Obsidian 库：frontmatter 解析、标签/双链提取、扫描与读写。
//!
//! 约定（与 Python 版一致）：库里的 `.md` 是唯一事实来源，应用只做索引；
//! 应用写入的笔记放在 `灵感盒/` 下，带 frontmatter。
use regex::Regex;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

pub const SKIP_DIRS: [&str; 5] = [".obsidian", ".trash", ".git", "node_modules", "__pycache__"];
pub const MAX_SIZE: u64 = 4 * 1024 * 1024;

static FM_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?s)\A---\r?\n(.*?)\r?\n---[ \t]*\r?\n?").unwrap());
static TAG_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:^|[^\w#/])#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5/\-]{0,39})").unwrap()
});
static LINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]").unwrap());
static H1_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^#[ \t]+(.+)$").unwrap());
static IMG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"!\[[^\]]*\]\(([^)]+)\)").unwrap());
static CODE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?s)```.*?```").unwrap());
static LIST_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^[ \t]*[-*+]\s+").unwrap());
static PUNCT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[#>*_`~\[\]()]+").unwrap());
static WS_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());
static CJK_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\u4e00-\u9fa5]").unwrap());
static WORD_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[A-Za-z0-9_]+").unwrap());
static ILLEGAL_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"[\\/:*?"<>|\r\n\t]"#).unwrap());
static FM_LINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([\w\u4e00-\u9fa5\-]+)\s*:\s*(.*)$").unwrap());

/// 一条笔记（扫描结果）。
#[derive(Clone, Debug)]
pub struct Note {
    pub path: String,
    pub title: String,
    pub folder: String,
    pub kind: String,
    pub tags: Vec<String>,
    pub links: Vec<String>,
    pub excerpt: String,
    pub words: usize,
    pub mtime: f64,
    pub size: u64,
    pub meta: Map<String, Value>,
    pub body: String,
}

impl Note {
    /// 列表用的 JSON（不含正文）。
    pub fn list_json(&self) -> Value {
        serde_json::json!({
            "path": self.path,
            "title": self.title,
            "folder": self.folder,
            "kind": self.kind,
            "tags": self.tags,
            "links": self.links,
            "excerpt": self.excerpt,
            "words": self.words,
            "mtime": self.mtime,
            "size": self.size,
            "meta": self.meta,
            "status": self.meta.get("status").and_then(Value::as_str).unwrap_or("inbox"),
            "assets": self.meta.get("assets").cloned().unwrap_or_else(|| serde_json::json!([])),
        })
    }
}

// ---------------------------------------------------------------- 库定位

/// 从 Obsidian 自己的配置里读出最近使用的库路径。
pub fn detect_vault() -> Option<String> {
    let appdata = std::env::var("APPDATA").ok()?;
    let cfg = PathBuf::from(appdata).join("obsidian").join("obsidian.json");
    let text = fs::read_to_string(cfg).ok()?;
    let data: Value = serde_json::from_str(&text).ok()?;
    let vaults = data.get("vaults")?.as_object()?;
    let mut best: Option<(i64, String)> = None;
    for v in vaults.values() {
        let ts = v.get("ts").and_then(|x| x.as_i64()).unwrap_or(0);
        if let Some(p) = v.get("path").and_then(|x| x.as_str()) {
            if Path::new(p).is_dir() && best.as_ref().map(|(t, _)| ts > *t).unwrap_or(true) {
                best = Some((ts, p.to_string()));
            }
        }
    }
    best.map(|(_, p)| p)
}

// ---------------------------------------------------------------- frontmatter

fn scalar(v: &str) -> Value {
    let v = v.trim();
    let bytes = v.as_bytes();
    if v.chars().count() >= 2 {
        let first = v.chars().next().unwrap();
        let last = v.chars().last().unwrap();
        if first == last && (first == '"' || first == '\'') {
            let inner: String = v.chars().skip(1).take(v.chars().count() - 2).collect();
            return Value::String(inner);
        }
    }
    if v == "true" {
        return Value::Bool(true);
    }
    if v == "false" {
        return Value::Bool(false);
    }
    if !v.is_empty() && bytes.iter().all(|c| c.is_ascii_digit() || *c == b'-')
        && v != "-" && !v.starts_with("--")
    {
        if let Ok(n) = v.parse::<i64>() {
            return Value::from(n);
        }
    }
    if v.parse::<f64>().is_ok() && v.contains('.') && !v.starts_with("--") {
        if let Ok(f) = v.parse::<f64>() {
            return Value::from(f);
        }
    }
    Value::String(v.to_string())
}

/// 返回 (meta, body)。没有 frontmatter 时 meta 为空。
pub fn parse_frontmatter(text: &str) -> (Map<String, Value>, String) {
    let mut meta = Map::new();
    let m = match FM_RE.captures(text) {
        Some(m) => m,
        None => return (meta, text.to_string()),
    };
    let whole = m.get(0).unwrap();
    let body = text[whole.end()..].to_string();
    let block = m.get(1).map(|x| x.as_str()).unwrap_or("");
    let mut key: Option<String> = None;
    for line in block.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let trimmed = line.trim_start();
        if trimmed.starts_with("- ") {
            if let Some(k) = &key {
                let item = scalar(trimmed[1..].trim());
                match meta.get_mut(k) {
                    Some(Value::Array(arr)) => arr.push(item),
                    _ => {
                        meta.insert(k.clone(), Value::Array(vec![item]));
                    }
                }
            }
            continue;
        }
        if let Some(mm) = FM_LINE_RE.captures(line) {
            let k = mm.get(1).unwrap().as_str().to_string();
            let val = mm.get(2).unwrap().as_str().trim().to_string();
            let v = if val.starts_with('[') && val.ends_with(']') {
                let inner = &val[1..val.len() - 1];
                Value::Array(
                    inner
                        .split(',')
                        .filter(|x| !x.trim().is_empty())
                        .map(|x| scalar(x))
                        .collect(),
                )
            } else if val.is_empty() {
                Value::Array(vec![])
            } else {
                scalar(&val)
            };
            meta.insert(k.clone(), v);
            key = Some(k);
        }
    }
    (meta, body)
}

pub fn dump_frontmatter(meta: &Map<String, Value>, body: &str) -> String {
    let mut lines = vec!["---".to_string()];
    for (k, v) in meta.iter() {
        match v {
            Value::Array(arr) => {
                if arr.is_empty() {
                    lines.push(format!("{k}: []"));
                } else {
                    lines.push(format!("{k}:"));
                    for item in arr {
                        lines.push(format!("  - {}", scalar_str(item)));
                    }
                }
            }
            Value::Bool(b) => lines.push(format!("{k}: {}", if *b { "true" } else { "false" })),
            Value::Null => lines.push(format!("{k}:")),
            Value::Number(n) => lines.push(format!("{k}: {n}")),
            Value::String(s) => lines.push(format!("{k}: {s}")),
            _ => lines.push(format!("{k}: {}", scalar_str(v))),
        }
    }
    lines.push("---".to_string());
    format!("{}\n\n{}\n", lines.join("\n"), body.trim())
}

fn scalar_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

// ---------------------------------------------------------------- 解析

pub fn note_title(meta: &Map<String, Value>, body: &str, stem: &str) -> String {
    if let Some(Value::String(t)) = meta.get("title") {
        if !t.trim().is_empty() {
            return t.trim().to_string();
        }
    }
    if let Some(m) = H1_RE.captures(body) {
        return m.get(1).unwrap().as_str().trim().to_string();
    }
    stem.to_string()
}

pub fn note_tags(meta: &Map<String, Value>, body: &str) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();
    let raw = meta.get("tags").or_else(|| meta.get("tag"));
    match raw {
        Some(Value::String(s)) => {
            for part in s.split(|c: char| c == ',' || c == '，' || c.is_whitespace()) {
                let t = part.trim().trim_start_matches('#');
                if !t.is_empty() {
                    tags.push(t.to_string());
                }
            }
        }
        Some(Value::Array(arr)) => {
            for v in arr {
                let t = scalar_str(v).trim().trim_start_matches('#').to_string();
                if !t.is_empty() {
                    tags.push(t);
                }
            }
        }
        _ => {}
    }
    for cap in TAG_RE.captures_iter(body) {
        tags.push(cap.get(1).unwrap().as_str().to_string());
    }
    tags.sort();
    tags.dedup();
    tags
}

pub fn note_links(body: &str) -> Vec<String> {
    let mut out: Vec<String> = LINK_RE
        .captures_iter(body)
        .filter_map(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
        .filter(|s| !s.is_empty())
        .collect();
    out.sort();
    out.dedup();
    out
}

pub fn excerpt(body: &str, n: usize) -> String {
    let text = IMG_RE.replace_all(body, " ");
    let text = LINK_RE.replace_all(&text, |c: &regex::Captures| {
        c.get(2)
            .map(|m| m.as_str().to_string())
            .unwrap_or_else(|| c.get(1).unwrap().as_str().to_string())
    });
    let text = CODE_RE.replace_all(&text, " ");
    let text = LIST_RE.replace_all(&text, "");
    let text = PUNCT_RE.replace_all(&text, " ");
    let text = WS_RE.replace_all(&text, " ");
    text.trim().chars().take(n).collect()
}

pub fn word_count(body: &str) -> usize {
    CJK_RE.find_iter(body).count() + WORD_RE.find_iter(body).count()
}

// ---------------------------------------------------------------- 扫描

fn is_skipped_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name)
}

pub fn scan(root: &Path, with_body: bool) -> Vec<Note> {
    if !root.is_dir() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let walker = WalkDir::new(root)
        .sort_by_file_name()
        .into_iter()
        .filter_entry(|e| {
            if e.depth() == 0 {
                return true;
            }
            if e.file_type().is_dir() {
                let name = e.file_name().to_string_lossy().to_string();
                !is_skipped_dir(&name)
            } else {
                true
            }
        });
    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.to_lowercase().ends_with(".md") {
            continue;
        }
        let p = entry.path();
        let md = match fs::metadata(p) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if md.len() > MAX_SIZE {
            continue;
        }
        let text = match fs::read(p) {
            Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            Err(_) => continue,
        };
        let rel = match p.strip_prefix(root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        let (meta, body) = parse_frontmatter(&text);
        let folder = match rel.rsplit_once('/') {
            Some((dir, _)) => dir.to_string(),
            None => String::new(),
        };
        let kind = if rel.starts_with("灵感盒/想法/") {
            "idea"
        } else if rel.starts_with("灵感盒/整理/") {
            "digest"
        } else if rel.starts_with("灵感盒/任务/") {
            "task"
        } else {
            "note"
        };
        let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let title = note_title(&meta, &body, &stem);
        let tags = note_tags(&meta, &body);
        let links = note_links(&body);
        let ex = excerpt(&body, 180);
        let words = word_count(&body);
        let mut clean_meta = Map::new();
        for (k, v) in meta.iter() {
            if k != "title" && k != "tags" {
                clean_meta.insert(k.clone(), v.clone());
            }
        }
        out.push(Note {
            path: rel,
            title,
            folder,
            kind: kind.to_string(),
            tags,
            links,
            excerpt: ex,
            words,
            mtime: mtime_secs(&md),
            size: md.len(),
            meta: clean_meta,
            body: if with_body { body } else { String::new() },
        });
    }
    out
}

pub fn mtime_secs(md: &fs::Metadata) -> f64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

// ---------------------------------------------------------------- 读写

pub fn slugify(title: &str, fallback: &str) -> String {
    let s = ILLEGAL_RE.replace_all(title, " ");
    let s = WS_RE.replace_all(s.trim(), " ");
    let s = s.replace(' ', "-");
    let s = s.trim_matches(|c| c == '.' || c == '-');
    if s.is_empty() {
        fallback.to_string()
    } else {
        s.chars().take(60).collect()
    }
}

pub fn unique_path(folder: &Path, stem: &str, suffix: &str) -> PathBuf {
    let _ = fs::create_dir_all(folder);
    let mut p = folder.join(format!("{stem}{suffix}"));
    let mut i = 2;
    while p.exists() {
        p = folder.join(format!("{stem}-{i}{suffix}"));
        i += 1;
    }
    p
}

pub fn read_note(root: &Path, rel: &str) -> Option<Note> {
    let p = safe_join(root, rel)?;
    if !p.is_file() {
        return None;
    }
    let bytes = fs::read(&p).ok()?;
    let text = String::from_utf8_lossy(&bytes).to_string();
    let (meta, body) = parse_frontmatter(&text);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let md = fs::metadata(&p).ok()?;
    let title = note_title(&meta, &body, &stem);
    let tags = note_tags(&meta, &body);
    let links = note_links(&body);
    let folder = match rel.rsplit_once('/') {
        Some((dir, _)) => dir.to_string(),
        None => String::new(),
    };
    let kind = if rel.starts_with("灵感盒/想法/") {
        "idea"
    } else if rel.starts_with("灵感盒/整理/") {
        "digest"
    } else {
        "note"
    };
    Some(Note {
        path: rel.to_string(),
        title,
        folder,
        kind: kind.to_string(),
        tags,
        links,
        excerpt: excerpt(&body, 180),
        words: word_count(&body),
        mtime: mtime_secs(&md),
        size: md.len(),
        meta,
        body,
    })
}

pub fn write_note(root: &Path, rel: &str, meta: &Map<String, Value>, body: &str) -> std::io::Result<()> {
    use std::io::{Error, ErrorKind, Write};
    use std::path::Component;
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);

    let bad_path = || Error::new(ErrorKind::InvalidInput, "只能写入所选 Obsidian 库内的 Markdown 文件");
    let rel = Path::new(rel);
    if root.as_os_str().is_empty() || !root.is_absolute() || !root.is_dir()
        || rel.as_os_str().is_empty()
        || !rel.components().all(|c| matches!(c, Component::Normal(_)))
        || rel.extension().and_then(|s| s.to_str()) != Some("md")
    {
        return Err(bad_path());
    }
    let root = fs::canonicalize(root)?;
    let p = root.join(rel);
    // 检查现有祖先，防止 ../、绝对路径或指向库外的目录链接。
    let mut ancestor = p.parent().ok_or_else(bad_path)?;
    while !ancestor.exists() {
        ancestor = ancestor.parent().ok_or_else(bad_path)?;
    }
    if !fs::canonicalize(ancestor)?.starts_with(&root)
        || (p.exists() && !fs::canonicalize(&p)?.starts_with(&root))
    {
        return Err(bad_path());
    }
    let parent = p.parent().ok_or_else(bad_path)?;
    fs::create_dir_all(parent)?;
    let temp = parent.join(format!(".linganhe-{}-{}.tmp", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed)));
    let result = (|| {
        let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
        f.write_all(dump_frontmatter(meta, body).as_bytes())?;
        f.sync_all()?;
        drop(f);
        // 同一目录原子替换；写入失败时原文件保持不变。
        fs::rename(&temp, &p)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

pub fn delete_note(root: &Path, rel: &str) -> bool {
    match safe_join(root, rel) {
        Some(p) if p.is_file() => fs::remove_file(p).is_ok(),
        _ => false,
    }
}

/// 笔记当前的修改时间（秒，带小数）；文件不存在返回 None。
pub fn note_mtime(root: &Path, rel: &str) -> Option<f64> {
    let p = safe_join(root, rel)?;
    if !p.is_file() {
        return None;
    }
    fs::metadata(&p).ok().map(|m| mtime_secs(&m))
}

/// 删除不直接抹掉：挪进 `灵感盒/.trash/`，Obsidian 看不到（点开头的目录会被忽略），
/// 但文件管理器里还能找回来。返回移动后的绝对路径。
pub fn trash_note(root: &Path, rel: &str) -> Option<PathBuf> {
    crate::api::recovery::trash(root, rel, "note", Value::Null).ok()
}

/// 库的轻量指纹：所有 md 的路径 + 修改时间 + 大小。
/// 用来在后台发现「Obsidian 那边改动了」，不必每轮都重读正文。
pub fn signature(root: &Path) -> u64 {
    if !root.is_dir() {
        return 0;
    }
    const PRIME: u64 = 0x100_0000_01b3;
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut count: u64 = 0;
    let walker = WalkDir::new(root).into_iter().filter_entry(|e| {
        if e.depth() == 0 {
            return true;
        }
        if e.file_type().is_dir() {
            !is_skipped_dir(&e.file_name().to_string_lossy())
        } else {
            true
        }
    });
    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if !name.ends_with(".md") {
            continue;
        }
        let md = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mt = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        for b in entry.path().to_string_lossy().as_bytes() {
            h = (h ^ *b as u64).wrapping_mul(PRIME);
        }
        h = (h ^ mt).wrapping_mul(PRIME);
        h = (h ^ md.len()).wrapping_mul(PRIME);
        count += 1;
    }
    h ^ count.wrapping_mul(0x9e37_79b9_7f4a_7c15)
}

/// 防止 `../` 越界。
pub fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let root = fs::canonicalize(root).ok()?;
    let p = root.join(rel);
    let p = fs::canonicalize(&p).ok()?;
    if p.starts_with(&root) {
        Some(p)
    } else {
        None
    }
}

pub fn now_str() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M").to_string()
}
