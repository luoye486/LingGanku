//! 索引与搜索：替代 Python 版的 SQLite + FTS5。
//!
//! 笔记量级是几百到几万，直接放内存里做子串匹配足够快（213 篇约 2ms），
//! 好处是不用带 SQLite 的 C 依赖，整个程序是纯 Rust 单文件。
use crate::vault::{self, Note};
use serde_json::{json, Value};
use std::path::Path;

#[derive(Clone, Debug)]
pub struct Run {
    pub id: i64,
    pub kind: String,
    pub prompt: String,
    pub output: String,
    pub model: String,
    pub sources: Vec<String>,
    pub created: f64,
}

pub struct Index {
    pub notes: Vec<Note>,
    pub runs: Vec<Run>,
    pub last_sync: f64,
    next_run_id: i64,
}

impl Index {
    pub fn new() -> Self {
        Self { notes: Vec::new(), runs: Vec::new(), last_sync: 0.0, next_run_id: 1 }
    }

    pub fn sync(&mut self, root: &Path) -> Value {
        let fresh = vault::scan(root, true);
        let old: Vec<String> = self.notes.iter().map(|n| n.path.clone()).collect();
        let new: Vec<String> = fresh.iter().map(|n| n.path.clone()).collect();
        let added = new.iter().filter(|p| !old.contains(p)).count();
        let removed = old.iter().filter(|p| !new.contains(p)).count();
        let total = fresh.len();
        self.notes = fresh;
        self.last_sync = now();
        json!({ "total": total, "added": added, "removed": removed })
    }

    pub fn get(&self, path: &str) -> Option<&Note> {
        self.notes.iter().find(|n| n.path == path)
    }

    pub fn list(&self, kind: Option<&str>, folder: Option<&str>, limit: usize) -> Vec<Value> {
        let mut items: Vec<&Note> = self
            .notes
            .iter()
            .filter(|n| kind.map(|k| n.kind == k).unwrap_or(true))
            .filter(|n| folder.map(|f| n.folder == f).unwrap_or(true))
            .collect();
        items.sort_by(|a, b| b.mtime.partial_cmp(&a.mtime).unwrap_or(std::cmp::Ordering::Equal));
        items.into_iter().take(limit).map(|n| n.list_json()).collect()
    }

    /// 全库标签统计：按出现次数降序，同次数按名字排，方便做成标签墙。
    pub fn tags(&self) -> Vec<Value> {
        let mut agg: std::collections::BTreeMap<String, (usize, usize, usize)> = Default::default();
        for n in &self.notes {
            for t in &n.tags {
                let t = t.trim();
                if t.is_empty() {
                    continue;
                }
                let e = agg.entry(t.to_string()).or_insert((0, 0, 0));
                e.0 += 1;
                if n.kind == "idea" {
                    e.1 += 1;
                } else {
                    e.2 += 1;
                }
            }
        }
        let mut out: Vec<Value> = agg
            .into_iter()
            .map(|(tag, (count, ideas, notes))| json!({ "tag": tag, "count": count, "ideas": ideas, "notes": notes }))
            .collect();
        out.sort_by(|a, b| {
            b["count"]
                .as_u64()
                .cmp(&a["count"].as_u64())
                .then_with(|| a["tag"].as_str().cmp(&b["tag"].as_str()))
        });
        out
    }

    pub fn stats(&self) -> Value {
        let mut kinds = serde_json::Map::new();
        for n in &self.notes {
            let c = kinds.get(&n.kind).and_then(|v| v.as_i64()).unwrap_or(0) + 1;
            kinds.insert(n.kind.clone(), json!(c));
        }
        let words: usize = self.notes.iter().map(|n| n.words).sum();
        let last_mtime = self
            .notes
            .iter()
            .map(|n| n.mtime)
            .fold(0.0f64, |a, b| a.max(b));
        json!({
            "total": self.notes.len(),
            "words": words,
            "kinds": kinds,
            "last_mtime": last_mtime,
            "last_sync": self.last_sync,
        })
    }

    pub fn folders(&self) -> Vec<Value> {
        let mut agg: std::collections::BTreeMap<String, (usize, f64, serde_json::Map<String, Value>)> =
            Default::default();
        for n in &self.notes {
            let e = agg.entry(n.folder.clone()).or_insert_with(|| (0, 0.0, serde_json::Map::new()));
            e.0 += 1;
            if n.mtime > e.1 {
                e.1 = n.mtime;
            }
            let c = e.2.get(&n.kind).and_then(|v| v.as_i64()).unwrap_or(0) + 1;
            e.2.insert(n.kind.clone(), json!(c));
        }
        agg.into_iter()
            .map(|(folder, (count, mtime, kinds))| {
                json!({ "folder": folder, "count": count, "mtime": mtime, "kinds": kinds })
            })
            .collect()
    }

    /// 子串搜索（大小写不敏感），标题命中权重最高。
    pub fn search(&self, q: &str, limit: usize) -> Vec<Value> {
        let q = q.trim();
        if q.is_empty() {
            return Vec::new();
        }
        let needle = q.to_lowercase();
        let mut hits: Vec<(i64, f64, &Note, String)> = Vec::new();
        for n in &self.notes {
            let title_l = n.title.to_lowercase();
            let body_l = n.body.to_lowercase();
            let tags_l = n.tags.join(" ").to_lowercase();
            let in_title = title_l.contains(&needle);
            let body_count = body_l.matches(&needle).count();
            let in_tags = tags_l.contains(&needle);
            if !in_title && body_count == 0 && !in_tags {
                continue;
            }
            let mut score = 0i64;
            if in_title {
                score += 100;
            }
            if in_tags {
                score += 20;
            }
            score += body_count.min(30) as i64;
            let snippet = if body_count > 0 { snippet_of(&n.body, q, 26) } else { n.excerpt.clone() };
            hits.push((score, n.mtime, n, snippet));
        }
        hits.sort_by(|a, b| {
            b.0.cmp(&a.0)
                .then(b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal))
        });
        hits.into_iter()
            .take(limit)
            .map(|(_, _, n, snip)| {
                let mut v = n.list_json();
                v["snippet"] = json!(snip);
                v
            })
            .collect()
    }

    pub fn save_run(&mut self, kind: &str, prompt: &str, output: &str, model: &str, sources: &[String]) {
        let id = self.next_run_id;
        self.next_run_id += 1;
        self.runs.insert(
            0,
            Run {
                id,
                kind: kind.to_string(),
                prompt: prompt.to_string(),
                output: output.to_string(),
                model: model.to_string(),
                sources: sources.to_vec(),
                created: now(),
            },
        );
        if self.runs.len() > 200 {
            self.runs.truncate(200);
        }
    }

    pub fn runs_json(&self, limit: usize) -> Vec<Value> {
        self.runs
            .iter()
            .take(limit)
            .map(|r| {
                json!({
                    "id": r.id, "kind": r.kind, "prompt": r.prompt,
                    "output": r.output, "model": r.model,
                    "sources": r.sources, "created": r.created,
                })
            })
            .collect()
    }
}

fn now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

/// 取命中位置前后若干字，命中词用 «» 包起来。
fn snippet_of(body: &str, q: &str, span: usize) -> String {
    let lower = body.to_lowercase();
    let needle = q.to_lowercase();
    let pos = match lower.find(&needle) {
        Some(p) => p,
        None => return body.chars().take(span * 2).collect(),
    };
    // 字节位置 → 字符位置
    let char_pos = lower[..pos].chars().count();
    let chars: Vec<char> = body.chars().collect();
    let start = char_pos.saturating_sub(span);
    let end = (char_pos + needle.chars().count() + span).min(chars.len());
    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    for (i, c) in chars[start..end].iter().enumerate() {
        if i == char_pos - start {
            out.push('«');
        }
        out.push(*c);
        if i + 1 == char_pos - start + needle.chars().count() {
            out.push('»');
        }
    }
    if end < chars.len() {
        out.push('…');
    }
    out
}
