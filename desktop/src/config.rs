//! 配置与路径。
//!
//! - 配置放在 `%APPDATA%\LingGanHe\config.json`（重装/换版本不丢）；
//! - 素材库（`assets/` + `meta/`）由 `library` 指定，默认从可执行文件往上找，
//!   找不到就用当前目录 —— 这样开发时和打包后都能跑。
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AiConfig {
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_temperature")]
    pub temperature: f64,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    /// 大模型模式下是否用流式（SSE）接收
    #[serde(default = "default_true")]
    pub stream: bool,
    /// 单篇笔记送进上下文的字符上限
    #[serde(default = "default_per_note")]
    pub per_note_chars: u32,
    /// 一次请求的材料总预算（字符）
    #[serde(default = "default_budget")]
    pub total_budget: u32,
    /// 素材 AI 分析时是否把图片本身也发给模型（需要视觉模型）
    #[serde(default)]
    pub vision: bool,
    /// 视觉模型名；留空时沿用 model
    #[serde(default)]
    pub vision_model: String,
    /// 仅显式语义搜索/相关推荐请求可联网；默认关闭。
    #[serde(default)]
    pub embedding_enabled: bool,
    /// Embedding 模型独立于聊天模型，留空表示尚未配置。
    #[serde(default)]
    pub embedding_model: String,
    /// 留空沿用 base_url；支持本地 Ollama 的 OpenAI /v1 接口。
    #[serde(default)]
    pub embedding_base_url: String,
    /// 独立密钥；留空仅在相同接口地址时沿用 api_key。
    #[serde(default)]
    pub embedding_api_key: String,
    /// 显式媒体转写使用独立模型；留空时不允许转写。
    #[serde(default)]
    pub transcription_model: String,
    /// 留空沿用 base_url；独立接口不会自动携带聊天密钥。
    #[serde(default)]
    pub transcription_base_url: String,
    #[serde(default)]
    pub transcription_api_key: String,
    /// 本地 ffmpeg 可执行文件路径或 PATH 中的名称。
    #[serde(default = "default_ffmpeg_path")]
    pub ffmpeg_path: String,
}

fn default_ffmpeg_path() -> String { "ffmpeg".into() }

fn default_provider() -> String {
    "local".into()
}
fn default_model() -> String {
    "deepseek-chat".into()
}
fn default_temperature() -> f64 {
    0.7
}
fn default_max_tokens() -> u32 {
    1800
}
fn default_true() -> bool {
    true
}
fn default_per_note() -> u32 {
    4000
}
fn default_budget() -> u32 {
    14000
}
fn default_density() -> String {
    "comfortable".into()
}
fn default_font_size() -> String {
    "normal".into()
}
fn default_default_view() -> String {
    "home".into()
}
fn default_watch_interval() -> u32 {
    5
}
fn default_hotkey() -> String {
    "Ctrl+Alt+N".into()
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: default_provider(),
            base_url: String::new(),
            api_key: String::new(),
            model: default_model(),
            temperature: default_temperature(),
            max_tokens: default_max_tokens(),
            stream: true,
            per_note_chars: default_per_note(),
            total_budget: default_budget(),
            vision: false,
            vision_model: String::new(),
            embedding_enabled: false,
            embedding_model: String::new(),
            embedding_base_url: String::new(),
            embedding_api_key: String::new(),
            transcription_model: String::new(),
            transcription_base_url: String::new(),
            transcription_api_key: String::new(),
            ffmpeg_path: default_ffmpeg_path(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UiConfig {
    #[serde(default)]
    pub theme: String,
    #[serde(default)]
    pub last_view: String,
    /// comfortable | compact
    #[serde(default = "default_density")]
    pub density: String,
    /// small | normal | large
    #[serde(default = "default_font_size")]
    pub font_size: String,
    /// 界面过渡动效
    #[serde(default = "default_true")]
    pub motion: bool,
    /// 启动后默认打开的视图
    #[serde(default = "default_default_view")]
    pub default_view: String,
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            theme: String::new(),
            last_view: String::new(),
            density: default_density(),
            font_size: default_font_size(),
            motion: true,
            default_view: default_default_view(),
        }
    }
}

/// 行为与快捷键。
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BehaviorConfig {
    /// 后台监听库变化并自动刷新
    #[serde(default = "default_true")]
    pub watch: bool,
    /// 监听间隔（秒）
    #[serde(default = "default_watch_interval")]
    pub watch_interval: u32,
    /// 全局热键开关
    #[serde(default = "default_true")]
    pub hotkey_enabled: bool,
    /// 全局热键组合，例如 Ctrl+Alt+N
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    /// 发送到大模型前先确认
    #[serde(default = "default_true")]
    pub confirm_remote: bool,
}

impl Default for BehaviorConfig {
    fn default() -> Self {
        Self {
            watch: true,
            watch_interval: default_watch_interval(),
            hotkey_enabled: true,
            hotkey: default_hotkey(),
            confirm_remote: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Config {
    /// Obsidian 库根目录（笔记的唯一事实来源）
    #[serde(default)]
    pub vault: String,
    /// 素材库根目录（含 assets/ 与 meta/）
    #[serde(default)]
    pub library: String,
    #[serde(default)]
    pub ai: AiConfig,
    #[serde(default)]
    pub ui: UiConfig,
    #[serde(default)]
    pub behavior: BehaviorConfig,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            vault: String::new(),
            library: String::new(),
            ai: AiConfig::default(),
            ui: UiConfig::default(),
            behavior: BehaviorConfig::default(),
        }
    }
}

impl Config {
    pub fn load() -> Self {
        let p = config_path();
        let mut cfg: Config = match fs::read_to_string(&p) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
            Err(_) => Config::default(),
        };
        if cfg.library.trim().is_empty() {
            cfg.library = detect_library().to_string_lossy().to_string();
        }
        if cfg.vault.trim().is_empty() {
            if let Some(v) = crate::vault::detect_vault() {
                cfg.vault = v;
            }
        }
        cfg
    }

    pub fn save(&self) -> std::io::Result<()> {
        let p = config_path();
        if let Some(dir) = p.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::write(p, serde_json::to_string_pretty(self)?)
    }

    /// 前端看到的配置：API Key 打码。
    pub fn public_json(&self) -> Value {
        let mut ai = serde_json::to_value(&self.ai).unwrap_or_default();
        if let Some(obj) = ai.as_object_mut() {
            for (field, key) in [("api_key", &self.ai.api_key), ("embedding_api_key", &self.ai.embedding_api_key),
                ("transcription_api_key", &self.ai.transcription_api_key)] {
                // Never expose even a short secret in full.
                obj.insert(field.into(), Value::String(if key.is_empty() { String::new() } else { "••••".into() }));
                obj.insert(format!("{field}_set"), Value::Bool(!key.is_empty()));
            }
        }
        serde_json::json!({
            "vault": self.vault,
            "library": self.library,
            "ai": ai,
            "ui": self.ui,
            "behavior": self.behavior,
        })
    }

    /// 局部更新（设置页只传改动的字段）。
    pub fn apply_patch(&mut self, patch: &Value) {
        if let Some(v) = patch.get("vault").and_then(|x| x.as_str()) {
            self.vault = v.trim().to_string();
        }
        if let Some(v) = patch.get("library").and_then(|x| x.as_str()) {
            self.library = v.trim().to_string();
        }
        if let Some(ai) = patch.get("ai").and_then(|x| x.as_object()) {
            if let Some(v) = ai.get("provider").and_then(|x| x.as_str()) {
                self.ai.provider = v.to_string();
            }
            if let Some(v) = ai.get("base_url").and_then(|x| x.as_str()) {
                self.ai.base_url = v.trim().to_string();
            }
            if let Some(v) = ai.get("model").and_then(|x| x.as_str()) {
                self.ai.model = v.trim().to_string();
            }
            if let Some(v) = ai.get("api_key").and_then(|x| x.as_str()) {
                let v = v.trim();
                // 前端显示的是打码值，回传时不要覆盖真 Key
                if !v.starts_with("••••") {
                    self.ai.api_key = v.to_string();
                }
            }
            if let Some(v) = ai.get("temperature").and_then(|x| x.as_f64()) {
                self.ai.temperature = v.clamp(0.0, 2.0);
            }
            if let Some(v) = ai.get("max_tokens").and_then(|x| x.as_u64()) {
                self.ai.max_tokens = v.clamp(128, 8192) as u32;
            }
            if let Some(v) = ai.get("stream").and_then(|x| x.as_bool()) {
                self.ai.stream = v;
            }
            if let Some(v) = ai.get("per_note_chars").and_then(|x| x.as_u64()) {
                self.ai.per_note_chars = v.clamp(500, 20000) as u32;
            }
            if let Some(v) = ai.get("total_budget").and_then(|x| x.as_u64()) {
                self.ai.total_budget = v.clamp(1000, 60000) as u32;
            }
            if let Some(v) = ai.get("vision").and_then(|x| x.as_bool()) {
                self.ai.vision = v;
            }
            if let Some(v) = ai.get("vision_model").and_then(|x| x.as_str()) {
                self.ai.vision_model = v.trim().to_string();
            }
            if let Some(v) = ai.get("embedding_enabled").and_then(Value::as_bool) {
                self.ai.embedding_enabled = v;
            }
            if let Some(v) = ai.get("embedding_model").and_then(Value::as_str) {
                self.ai.embedding_model = v.trim().to_string();
            }
            if let Some(v) = ai.get("embedding_base_url").and_then(Value::as_str) {
                self.ai.embedding_base_url = v.trim().to_string();
            }
            if let Some(v) = ai.get("embedding_api_key").and_then(Value::as_str) {
                if !v.trim().starts_with("••••") {
                    self.ai.embedding_api_key = v.trim().to_string();
                }
            }
            if let Some(v) = ai.get("transcription_model").and_then(Value::as_str) {
                self.ai.transcription_model = v.trim().to_string();
            }
            if let Some(v) = ai.get("transcription_base_url").and_then(Value::as_str) {
                self.ai.transcription_base_url = v.trim().to_string();
            }
            if let Some(v) = ai.get("transcription_api_key").and_then(Value::as_str) {
                if !v.trim().starts_with("••••") {
                    self.ai.transcription_api_key = v.trim().to_string();
                }
            }
            if let Some(v) = ai.get("ffmpeg_path").and_then(Value::as_str) {
                self.ai.ffmpeg_path = if v.trim().is_empty() { default_ffmpeg_path() } else { v.trim().to_string() };
            }
        }
        if let Some(ui) = patch.get("ui").and_then(|x| x.as_object()) {
            if let Some(v) = ui.get("theme").and_then(|x| x.as_str()) {
                self.ui.theme = v.to_string();
            }
            if let Some(v) = ui.get("last_view").and_then(|x| x.as_str()) {
                self.ui.last_view = v.to_string();
            }
            if let Some(v) = ui.get("density").and_then(|x| x.as_str()) {
                if v == "compact" || v == "comfortable" {
                    self.ui.density = v.to_string();
                }
            }
            if let Some(v) = ui.get("font_size").and_then(|x| x.as_str()) {
                if v == "small" || v == "normal" || v == "large" {
                    self.ui.font_size = v.to_string();
                }
            }
            if let Some(v) = ui.get("motion").and_then(|x| x.as_bool()) {
                self.ui.motion = v;
            }
            if let Some(v) = ui.get("default_view").and_then(|x| x.as_str()) {
                self.ui.default_view = v.to_string();
            }
        }
        if let Some(b) = patch.get("behavior").and_then(|x| x.as_object()) {
            if let Some(v) = b.get("watch").and_then(|x| x.as_bool()) {
                self.behavior.watch = v;
            }
            if let Some(v) = b.get("watch_interval").and_then(|x| x.as_u64()) {
                self.behavior.watch_interval = v.clamp(2, 120) as u32;
            }
            if let Some(v) = b.get("hotkey_enabled").and_then(|x| x.as_bool()) {
                self.behavior.hotkey_enabled = v;
            }
            if let Some(v) = b.get("hotkey").and_then(|x| x.as_str()) {
                let v = v.trim();
                if !v.is_empty() {
                    self.behavior.hotkey = v.to_string();
                }
            }
            if let Some(v) = b.get("confirm_remote").and_then(|x| x.as_bool()) {
                self.behavior.confirm_remote = v;
            }
        }
    }
}

/// 可执行文件所在目录。
pub fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

/// 配置/缓存目录：%APPDATA%\LingGanHe
pub fn data_dir() -> PathBuf {
    // 便携模式：设了 LINGANHE_CONFIG_DIR 就把配置和缓存放那儿（U 盘、受限环境、测试都用得上）
    if let Ok(dir) = std::env::var("LINGANHE_CONFIG_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    let base = std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| exe_dir());
    base.join("LingGanHe")
}

pub fn config_path() -> PathBuf {
    data_dir().join("config.json")
}

/// 往上找带 `assets/` 的目录，作为素材库根。
pub fn detect_library() -> PathBuf {
    let mut cur = exe_dir();
    for _ in 0..6 {
        if cur.join("assets").is_dir() {
            return cur;
        }
        match cur.parent() {
            Some(p) => cur = p.to_path_buf(),
            None => break,
        }
    }
    // 开发时的兜底：cargo 从项目根跑，当前目录往往就是库根
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.join("assets").is_dir() {
        return cwd;
    }
    exe_dir()
}

pub fn ensure_dir(p: &Path) {
    let _ = fs::create_dir_all(p);
}
