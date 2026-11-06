//! Explicit, opt-in OpenAI-compatible embeddings. No background or lexical fallback.
//! Raw source text and vectors are memory-only; each POST may disclose bounded text
//! to the configured endpoint. The frontend owns per-request user consent.
use crate::config::AiConfig;
use crate::vault::Note;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub const PER_SOURCE_LIMIT: usize = 128;
const TEXT_CHARS: usize = 4000;
const QUERY_CHARS: usize = 2000;
const BATCH_SIZE: usize = 32;
const CACHE_LIMIT: usize = 512;
const MAX_DIMENSIONS: usize = 4096;
const RESPONSE_BYTES: u64 = 8 * 1024 * 1024;
const REQUEST_SECONDS: u64 = 60;

#[derive(Clone)]
pub struct Document {
    pub item: Value,
    text: String,
    // Full text fingerprint also invalidates when a change is beyond the excerpt.
    revision: u64,
}

fn fingerprint(text: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    h.finish()
}

pub fn note_document(note: &Note) -> Document {
    let mut item = note.list_json();
    item["source_type"] = json!("note");
    item["snippet"] = json!(note.body.chars().take(180).collect::<String>());
    let header = format!("{}\n{}\n", note.title, note.tags.join(" "));
    let text = header.chars().chain(note.body.chars()).take(TEXT_CHARS).collect();
    Document { item, text, revision: fingerprint(&note.body) }
}

pub fn asset_document(asset: &Value) -> Document {
    let mut item = asset.clone();
    item["source_type"] = json!("asset");
    item["title"] = json!(asset["name"].as_str().unwrap_or(""));
    let tags = asset["tags"].as_array().map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ")).unwrap_or_default();
    let description = asset["ai_note"].as_str().unwrap_or("");
    let text = format!("{}\n{}\n{}\n{}", asset["name"].as_str().unwrap_or(""), tags,
        description, asset["note"].as_str().unwrap_or(""));
    item["snippet"] = json!(description.chars().take(180).collect::<String>());
    Document { item, revision: fingerprint(&text), text: text.chars().take(TEXT_CHARS).collect() }
}

pub struct Connection {
    endpoint: String,
    model: String,
    key: String,
}

fn endpoint(base: &str) -> Result<String, String> {
    let base = base.trim().trim_end_matches('/');
    let base = base.strip_suffix("/embeddings").unwrap_or(base);
    let chat = crate::ai::chat_endpoint(base)
        .map_err(|_| "E_SEMANTIC_CONFIG: 请设置 Embedding 接口地址".to_string())?;
    let address = chat.trim_end_matches("/chat/completions").to_string() + "/embeddings";
    let parsed = reqwest::Url::parse(&address)
        .map_err(|_| "E_SEMANTIC_CONFIG: Embedding 接口地址无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none()
        || !parsed.username().is_empty() || parsed.password().is_some()
        || parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("E_SEMANTIC_CONFIG: 请使用不含用户名、密码、查询参数的 HTTP(S) 接口地址".into());
    }
    Ok(parsed.to_string())
}

impl Connection {
    pub fn from_config(ai: &AiConfig) -> Result<Self, String> {
        if !ai.embedding_enabled {
            return Err("E_SEMANTIC_DISABLED: 语义搜索尚未启用，请在设置中明确启用 Embedding".into());
        }
        let model = ai.embedding_model.trim();
        if model.is_empty() {
            return Err("E_SEMANTIC_CONFIG: 请单独设置 Embedding 模型（聊天模型不会自动代用）".into());
        }
        let base = if ai.embedding_base_url.trim().is_empty() { &ai.base_url } else { &ai.embedding_base_url };
        let effective_endpoint = endpoint(base)?;
        let same_base = endpoint(&ai.base_url).map(|v| v == effective_endpoint).unwrap_or(false);
        let key = if !ai.embedding_api_key.trim().is_empty() { &ai.embedding_api_key }
            else if same_base { &ai.api_key } else { "" };
        Ok(Self { endpoint: effective_endpoint, model: model.into(), key: key.trim().into() })
    }

    fn identity(&self) -> String {
        // Include auth changes, without retaining the plaintext secret in cache identity.
        format!("{}\n{}\n{}", self.endpoint, self.model, fingerprint(&self.key))
    }
}

#[derive(Default)]
struct Cache {
    identity: String,
    vectors: HashMap<String, Vec<f32>>,
    order: VecDeque<String>,
}

impl Cache {
    fn prepare(&mut self, identity: &str, active: &HashSet<String>) {
        if self.identity != identity {
            self.identity = identity.to_string();
            self.vectors.clear();
            self.order.clear();
        }
        // Remove deleted/edited documents immediately; queries remain FIFO-bounded.
        self.vectors.retain(|key, _| key.starts_with("q:") || active.contains(key));
        self.order.retain(|key| self.vectors.contains_key(key));
    }

    fn insert(&mut self, key: String, vector: Vec<f32>) {
        if !self.vectors.contains_key(&key) { self.order.push_back(key.clone()); }
        self.vectors.insert(key, vector);
        while self.vectors.len() > CACHE_LIMIT {
            if let Some(old) = self.order.pop_front() { self.vectors.remove(&old); } else { break; }
        }
    }
}

#[derive(Default)]
pub struct Engine {
    cache: Mutex<Cache>,
    busy: AtomicBool,
}

struct BusyGuard<'a>(&'a AtomicBool);
impl Drop for BusyGuard<'_> {
    fn drop(&mut self) { self.0.store(false, Ordering::Release); }
}

fn document_key(doc: &Document) -> String {
    format!("d:{}:{}:{}:{}", doc.item["source_type"].as_str().unwrap_or(""),
        doc.item["path"].as_str().unwrap_or(""), doc.revision, doc.text)
}

fn decode_vectors(value: &Value, count: usize) -> Result<Vec<Vec<f32>>, String> {
    let fail = || "E_SEMANTIC_RESPONSE: Embedding 返回的向量数量、索引或数值无效".to_string();
    let data = value["data"].as_array().ok_or_else(fail)?;
    if data.len() != count { return Err(fail()); }
    let mut out: Vec<Option<Vec<f32>>> = vec![None; count];
    let mut dimensions = None;
    for entry in data {
        let index = entry["index"].as_u64().ok_or_else(fail)? as usize;
        if index >= count || out[index].is_some() { return Err(fail()); }
        let values = entry["embedding"].as_array().ok_or_else(fail)?;
        if values.is_empty() || values.len() > MAX_DIMENSIONS { return Err(fail()); }
        if dimensions.map(|n| n != values.len()).unwrap_or(false) { return Err(fail()); }
        dimensions = Some(values.len());
        let mut vector = Vec::with_capacity(values.len());
        let mut norm = 0.0f64;
        for value in values {
            let value = value.as_f64().ok_or_else(fail)?;
            if !value.is_finite() || !(value as f32).is_finite() { return Err(fail()); }
            norm += value * value;
            vector.push(value as f32);
        }
        if !norm.is_finite() || norm <= 0.0 { return Err(fail()); }
        out[index] = Some(vector);
    }
    out.into_iter().map(|v| v.ok_or_else(fail)).collect()
}

fn cosine(a: &[f32], b: &[f32]) -> Result<f64, String> {
    if a.is_empty() || a.len() != b.len() {
        return Err("E_SEMANTIC_DIMENSIONS: 模型向量维度发生变化，请重试以重建缓存".into());
    }
    let (mut dot, mut aa, mut bb) = (0.0f64, 0.0f64, 0.0f64);
    for (&a, &b) in a.iter().zip(b) {
        let (a, b) = (a as f64, b as f64);
        dot += a * b;
        aa += a * a;
        bb += b * b;
    }
    let score = dot / (aa.sqrt() * bb.sqrt());
    if !score.is_finite() { return Err("E_SEMANTIC_RESPONSE: 无法计算向量相似度".into()); }
    Ok(score.clamp(-1.0, 1.0))
}

impl Engine {
    pub fn search(&self, connection: Connection, mut docs: Vec<Document>, query: &str,
        related: Option<&Document>, limit: usize, total: usize) -> Result<Value, String> {
        if self.busy.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed).is_err() {
            return Err("E_SEMANTIC_BUSY: 另一个语义请求正在处理，请稍后重试".into());
        }
        let _guard = BusyGuard(&self.busy);
        let started = Instant::now();
        let query = query.trim();
        if related.is_none() && (query.is_empty() || query.chars().count() > QUERY_CHARS) {
            return Err("E_SEMANTIC_QUERY: 请输入 1–2000 字的语义查询".into());
        }
        // Stable ordering and exact path exclusion; no lexical scoring is involved.
        if let Some(source) = related {
            docs.retain(|doc| doc.item["path"] != source.item["path"]);
        }
        let covered = docs.len();
        if docs.is_empty() {
            let mut cache = self.cache.lock().map_err(|_| "E_SEMANTIC_CACHE: 缓存不可用".to_string())?;
            cache.prepare(&connection.identity(), &HashSet::new());
            return Ok(json!({"items": [], "mode": "semantic", "model": connection.model,
                "coverage": {"searched": 0, "total": total.saturating_sub(usize::from(related.is_some())),
                    "truncated": false, "max_notes": PER_SOURCE_LIMIT, "max_assets": PER_SOURCE_LIMIT, "text_chars": TEXT_CHARS},
                "embedded": 0, "cached": 0}));
        }
        let mut keys: Vec<String> = docs.iter().map(document_key).collect();
        let mut texts: Vec<String> = docs.iter().map(|d| d.text.clone()).collect();
        let query_key = related.map(document_key).unwrap_or_else(|| format!("q:{query}"));
        keys.push(query_key);
        texts.push(related.map(|d| d.text.clone()).unwrap_or_else(|| query.to_string()));
        let identity = connection.identity();
        let active: HashSet<String> = keys.iter().cloned().collect();
        let mut vectors = {
            let mut cache = self.cache.lock().map_err(|_| "E_SEMANTIC_CACHE: 缓存不可用".to_string())?;
            cache.prepare(&identity, &active);
            keys.iter().map(|key| cache.vectors.get(key).cloned()).collect::<Vec<_>>()
        };
        let missing: Vec<usize> = vectors.iter().enumerate().filter_map(|(i, v)| if v.is_none() { Some(i) } else { None }).collect();
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build().map_err(|_| "E_SEMANTIC_NETWORK: 无法创建 Embedding HTTP 客户端".to_string())?;
        for batch in missing.chunks(BATCH_SIZE) {
            let remaining = Duration::from_secs(REQUEST_SECONDS).checked_sub(started.elapsed())
                .filter(|d| *d > Duration::from_millis(100))
                .ok_or_else(|| "E_SEMANTIC_TIMEOUT: 语义请求超过 60 秒预算，请重试（已完成批次保留在内存缓存）".to_string())?;
            let input: Vec<&str> = batch.iter().map(|&i| texts[i].as_str()).collect();
            let mut request = client.post(&connection.endpoint)
                .timeout(remaining.min(Duration::from_secs(15)))
                .json(&json!({"model": connection.model, "input": input, "encoding_format": "float"}));
            if !connection.key.is_empty() { request = request.bearer_auth(&connection.key); }
            // No application/cache/config/write locks are held across network calls.
            let response = request.send().map_err(|_| "E_SEMANTIC_NETWORK: Embedding 请求失败或超时，请检查接口、模型和网络".to_string())?;
            let status = response.status();
            if !status.is_success() {
                // Never echo provider response bodies, credentials or source material.
                return Err(format!("E_SEMANTIC_HTTP: Embedding 接口返回 HTTP {}，请检查模型与密钥", status.as_u16()));
            }
            let mut bytes = Vec::new();
            response.take(RESPONSE_BYTES + 1).read_to_end(&mut bytes)
                .map_err(|_| "E_SEMANTIC_RESPONSE: 无法读取 Embedding 响应".to_string())?;
            if bytes.len() as u64 > RESPONSE_BYTES {
                return Err("E_SEMANTIC_RESPONSE: Embedding 响应超过 8 MiB 上限".into());
            }
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| "E_SEMANTIC_RESPONSE: Embedding 响应不是有效 JSON".to_string())?;
            let decoded = decode_vectors(&value, batch.len())?;
            let mut cache = self.cache.lock().map_err(|_| "E_SEMANTIC_CACHE: 缓存不可用".to_string())?;
            for (&index, vector) in batch.iter().zip(decoded) {
                cache.insert(keys[index].clone(), vector.clone());
                vectors[index] = Some(vector);
            }
        }
        let query_vector = vectors.last().and_then(Option::as_ref).ok_or("E_SEMANTIC_RESPONSE: 缺少查询向量")?;
        let mut ranked = Vec::with_capacity(docs.len());
        for (doc, vector) in docs.into_iter().zip(vectors.iter()) {
            let score = match cosine(query_vector, vector.as_deref().ok_or("E_SEMANTIC_RESPONSE: 缺少内容向量")?) {
                Ok(score) => score,
                Err(error) => {
                    if let Ok(mut cache) = self.cache.lock() { *cache = Cache::default(); }
                    return Err(error);
                }
            };
            let mut item = doc.item;
            item["score"] = json!(score);
            item["reason"] = json!(format!("Embedding 余弦相似度 {:.3}{}", score,
                if related.is_some() { "（与当前内容比较）" } else { "（与查询比较）" }));
            ranked.push(item);
        }
        ranked.sort_by(|a, b| b["score"].as_f64().unwrap_or(0.0).total_cmp(&a["score"].as_f64().unwrap_or(0.0))
            .then_with(|| a["path"].as_str().cmp(&b["path"].as_str())));
        ranked.truncate(limit.clamp(1, 50));
        let available = total.saturating_sub(usize::from(related.is_some()));
        Ok(json!({"items": ranked, "mode": "semantic", "model": connection.model,
            "coverage": {"searched": covered, "total": available, "truncated": covered < available,
                "max_notes": PER_SOURCE_LIMIT, "max_assets": PER_SOURCE_LIMIT, "text_chars": TEXT_CHARS},
            "embedded": missing.len(), "cached": keys.len() - missing.len()}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cosine_uses_real_vector_direction() {
        assert!((cosine(&[1.0, 0.0], &[2.0, 0.0]).unwrap() - 1.0).abs() < 1e-9);
        assert_eq!(cosine(&[1.0, 0.0], &[0.0, 1.0]).unwrap(), 0.0);
        assert_eq!(cosine(&[1.0], &[-1.0]).unwrap(), -1.0);
        assert!(cosine(&[1.0], &[1.0, 0.0]).is_err());
    }

    #[test]
    fn opt_in_and_same_endpoint_credentials_only() {
        let mut cfg = AiConfig::default();
        assert!(Connection::from_config(&cfg).err().unwrap().starts_with("E_SEMANTIC_DISABLED"));
        cfg.embedding_enabled = true;
        cfg.embedding_model = "nomic-embed-text".into();
        cfg.base_url = "http://localhost:11434/v1".into();
        cfg.api_key = "chat-secret".into();
        let same = Connection::from_config(&cfg).unwrap();
        assert_eq!(same.endpoint, "http://localhost:11434/v1/embeddings");
        assert_eq!(same.key, "chat-secret");
        cfg.embedding_base_url = "https://different.example/v1".into();
        assert!(Connection::from_config(&cfg).unwrap().key.is_empty());
        cfg.embedding_api_key = "embedding-secret".into();
        assert_eq!(Connection::from_config(&cfg).unwrap().key, "embedding-secret");
    }

    #[test]
    fn empty_library_does_not_contact_endpoint() {
        let result = Engine::default().search(Connection {
            endpoint: "http://127.0.0.1:1/v1/embeddings".into(),
            model: "test".into(), key: String::new(),
        }, Vec::new(), "query", None, 12, 0).unwrap();
        assert_eq!(result["items"], json!([]));
        assert_eq!(result["embedded"], 0);
        assert_eq!(result["mode"], "semantic");
    }

    #[test]
    fn validates_and_reorders_provider_vectors() {
        let v = json!({"data":[{"index":1,"embedding":[0,1]},{"index":0,"embedding":[1,0]}]});
        assert_eq!(decode_vectors(&v, 2).unwrap()[0], vec![1.0, 0.0]);
        for v in [json!({"data":[]}), json!({"data":[{"index":0,"embedding":[0,0]}]}),
            json!({"data":[{"index":3,"embedding":[1]}]})] {
            assert!(decode_vectors(&v, 1).is_err());
        }
    }

    #[test]
    fn explicit_requests_rank_cache_invalidate_and_exclude_self() {
        use std::io::Write;
        use std::net::TcpListener;
        use std::sync::Arc;
        use std::sync::atomic::AtomicUsize;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let counted = calls.clone();
        let server = std::thread::spawn(move || {
            let started = Instant::now();
            while counted.load(Ordering::SeqCst) < 2 && started.elapsed() < Duration::from_secs(5) {
                let (mut stream, _) = match listener.accept() {
                    Ok(v) => v,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(e) => panic!("{e}"),
                };
                stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
                let mut bytes = Vec::new();
                let mut chunk = [0u8; 4096];
                let (header_end, length) = loop {
                    let n = stream.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&chunk[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                        assert!(headers.starts_with("post /v1/embeddings "));
                        let length = headers.lines().find_map(|line| line.strip_prefix("content-length:"))
                            .unwrap().trim().parse::<usize>().unwrap();
                        break (end + 4, length);
                    }
                };
                while bytes.len() < header_end + length {
                    let n = stream.read(&mut chunk).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&chunk[..n]);
                }
                let request: Value = serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap();
                let data: Vec<Value> = request["input"].as_array().unwrap().iter().enumerate()
                    .map(|(index, text)| json!({"index":index,"embedding":
                        if text.as_str().unwrap().contains("dog") { vec![0,1] } else { vec![1,0] }})).collect();
                let body = json!({"data":data}).to_string();
                counted.fetch_add(1, Ordering::SeqCst);
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            }
        });
        let mut config = AiConfig::default();
        config.embedding_enabled = true;
        config.embedding_model = "test-vectors".into();
        config.embedding_base_url = format!("http://{address}/v1");
        let engine = Engine::default();
        let cat = asset_document(&json!({"path":"cat.png","name":"cat","ai_note":"pet"}));
        let dog = asset_document(&json!({"path":"dog.png","name":"dog","ai_note":"pet"}));
        let first = engine.search(Connection::from_config(&config).unwrap(), vec![dog.clone(),cat.clone()], "feline", None, 10, 2).unwrap();
        assert_eq!(first["items"][0]["path"], "cat.png");
        assert_eq!(first["items"][0]["score"], 1.0);
        let cached = engine.search(Connection::from_config(&config).unwrap(), vec![cat.clone(),dog], "feline", None, 10, 2).unwrap();
        assert_eq!(cached["embedded"], 0);
        let changed = asset_document(&json!({"path":"dog.png","name":"dog","ai_note":"changed"}));
        let invalidated = engine.search(Connection::from_config(&config).unwrap(), vec![cat.clone(),changed.clone()], "feline", None, 10, 2).unwrap();
        assert_eq!(invalidated["embedded"], 1);
        let related = engine.search(Connection::from_config(&config).unwrap(), vec![cat.clone(),changed], "", Some(&cat), 10, 2).unwrap();
        assert_eq!(related["items"].as_array().unwrap().len(), 1);
        assert_eq!(related["items"][0]["path"], "dog.png");
        assert_eq!(related["embedded"], 0);
        server.join().unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn config_masks_and_preserves_embedding_secret() {
        let mut config = crate::config::Config::default();
        config.apply_patch(&json!({"ai":{"embedding_api_key":"s","embedding_enabled":true,"embedding_model":"embed"}}));
        let public = config.public_json();
        assert_eq!(public["ai"]["embedding_api_key"], "••••");
        assert_eq!(public["ai"]["embedding_api_key_set"], true);
        config.apply_patch(&public);
        assert_eq!(config.ai.embedding_api_key, "s");
        config.apply_patch(&json!({"ai":{"embedding_api_key":""}}));
        assert!(config.ai.embedding_api_key.is_empty());
    }

    #[test]
    fn cache_is_bounded_and_invalidates_config_and_text() {
        let mut cache = Cache::default();
        cache.prepare("model-a", &HashSet::new());
        for n in 0..CACHE_LIMIT + 10 { cache.insert(format!("q:{n}"), vec![1.0]); }
        assert_eq!(cache.vectors.len(), CACHE_LIMIT);
        cache.insert("d:old".into(), vec![1.0]);
        cache.prepare("model-a", &HashSet::from(["d:new".into()]));
        assert!(!cache.vectors.contains_key("d:old"));
        cache.prepare("model-b", &HashSet::new());
        assert!(cache.vectors.is_empty());
        let a = asset_document(&json!({"path":"a.png","name":"a","tags":["one"],"ai_note":"first"}));
        let b = asset_document(&json!({"path":"a.png","name":"a","tags":["one"],"ai_note":"second"}));
        assert_ne!(document_key(&a), document_key(&b));
    }
}
