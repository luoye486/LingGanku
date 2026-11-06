// 灵感盒 · 桌面版
//
// 一个 Obsidian 优先的个人灵感/素材库：
//   记想法 → 写进库里的 灵感盒/想法/，Obsidian 里能看到、能改；
//   收素材 → 扫描 assets/，显示尺寸/时长/署名；
//   找东西 → 全文子串搜索（几百到几万篇都在毫秒级）；
//   想清楚 → 本地分析或接大模型，产出整理稿再写回 灵感盒/整理/。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod api;
mod assets;
mod config;
mod index;
mod media;
mod semantic;
mod vault;

use api::AppState;
use std::path::Path;
use tauri::{Emitter, Manager};

/// 无界面自检：`linganhe.exe --selftest`
///
/// 不开窗口，把「认领库 → 建索引 → 搜索 → 扫素材 → 本地 AI」跑一遍并打印 JSON。
/// 用来在 CI 或排查问题时确认后端是好的。
fn selftest() {
    use serde_json::json;
    let cfg = config::Config::load();
    let mut report = json!({ "config": cfg.public_json() });

    let root = if cfg.vault.trim().is_empty() {
        vault::detect_vault().map(std::path::PathBuf::from).unwrap_or_default()
    } else {
        std::path::PathBuf::from(&cfg.vault)
    };
    report["vault"] = json!(root.to_string_lossy());

    let t0 = std::time::Instant::now();
    let mut idx = index::Index::new();
    report["sync"] = idx.sync(&root);
    report["stats"] = idx.stats();
    report["search"] = json!(idx
        .search("卡牌", 5)
        .iter()
        .map(|n| n["title"].clone())
        .collect::<Vec<_>>());
    report["index_ms"] = json!(t0.elapsed().as_millis());

    let lib = if cfg.library.trim().is_empty() {
        config::detect_library()
    } else {
        std::path::PathBuf::from(&cfg.library)
    };
    let t1 = std::time::Instant::now();
    let items = assets::scan(&lib, true);
    report["assets"] = assets::summary(&items);
    report["assets_ms"] = json!(t1.elapsed().as_millis());

    // 自检要拿带正文的笔记，否则 AI 的上下文是空的
    let notes: Vec<serde_json::Value> = idx
        .list(None, None, 3)
        .into_iter()
        .map(|n| {
            let path = n["path"].as_str().unwrap_or("").to_string();
            let body = idx.get(&path).map(|x| x.body.clone()).unwrap_or_default();
            json!({
                "title": n["title"].clone(),
                "kind": n["kind"].clone(),
                "path": path,
                "text": body,
            })
        })
        .collect();
    // 自检永远离线：即便保存的设置启用了远程模型，也不能发送库里的内容。
    let local_ai = config::AiConfig::default();
    report["ai"] = match ai::run("summarize", &notes, &local_ai, "") {
        Ok(v) => v,
        Err(e) => json!({ "error": e }),
    };

    println!("{}", serde_json::to_string_pretty(&report).unwrap());
}

fn main() {
    if std::env::args().any(|a| a == "--selftest") {
        selftest();
        return;
    }
    let cfg = config::Config::load();

    // 独立配置和 WebView 目录都显式指定时，允许隔离验收实例并行运行。
    let isolated = std::env::var("LINGANHE_ISOLATED_INSTANCE").as_deref() == Ok("1")
        && std::env::var_os("LINGANHE_CONFIG_DIR").is_some()
        && std::env::var_os("LINGANHE_DATA_DIR").is_some();
    let mut builder = tauri::Builder::default();
    if !isolated {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        return;
                    }
                    // 全局热键：不管当前在哪个程序，都把窗口叫到前面并直接开一条新想法
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.unminimize();
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                    let _ = app.emit("quick-capture", serde_json::json!({}));
                })
                .build(),
        )
        .manage(AppState::new(cfg))
        .setup(|app| {
            let state = app.state::<AppState>();
            // 流式输出要从后台线程往页面推事件，先把 AppHandle 存下来
            *state.handle.lock().unwrap() = Some(app.handle().clone());
            // 第一次运行：自动认领 Obsidian 最近打开的库，并把目录建好
            {
                let mut c = state.cfg.lock().unwrap();
                if c.vault.trim().is_empty() {
                    if let Some(v) = vault::detect_vault() {
                        c.vault = v;
                        let _ = c.save();
                    }
                }
                if !c.vault.trim().is_empty() {
                    let root = Path::new(&c.vault).to_path_buf();
                    for sub in ["灵感盒/想法", "灵感盒/整理", "灵感盒/任务"] {
                        let _ = std::fs::create_dir_all(root.join(sub));
                    }
                }
            }
            // 窗口自己建，这样能按需改 webview 的数据目录：
            // 默认跟随系统（%LOCALAPPDATA%\com.linganhe.desktop），
            // 设了 LINGANHE_DATA_DIR 就放到指定目录（便携版 / 受限环境用）。
            let mut wb = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("灵感坞")
            .inner_size(1440.0, 900.0)
            .min_inner_size(1080.0, 700.0)
            .disable_drag_drop_handler()
            .center();
            if let Ok(dir) = std::env::var("LINGANHE_DATA_DIR") {
                wb = wb.data_directory(std::path::PathBuf::from(dir));
            }
            wb.build()?;

            // 全局热键（默认 Ctrl+Alt+N，可在设置里改或关掉）：随时唤出「记一条想法」
            {
                let b = app.state::<AppState>().cfg.lock().unwrap().behavior.clone();
                if let Err(e) = api::apply_hotkey_impl(app.handle(), b.hotkey_enabled, &b.hotkey) {
                    eprintln!("{e}");
                }
            }
            // 后台盯着库：Obsidian 里改了文件，界面自己刷新
            api::spawn_watcher(app.handle().clone());

            // 后台把索引建起来，窗口先显示
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = handle.state::<AppState>();
                let root = {
                    let c = state.cfg.lock().unwrap();
                    std::path::PathBuf::from(&c.vault)
                };
                if root.is_dir() {
                    let mut idx = state.index.lock().unwrap();
                    let _ = idx.sync(&root);
                }
                let lib = {
                    let c = state.cfg.lock().unwrap();
                    if c.library.trim().is_empty() {
                        config::detect_library()
                    } else {
                        std::path::PathBuf::from(&c.library)
                    }
                };
                let items = assets::scan(&lib, false);
                let summary = assets::summary(&items);
                *state.assets.lock().unwrap() = items;
                *state.assets_summary.lock().unwrap() = summary;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api::api_call,
            api::open_asset,
            api::reveal_asset,
            api::open_in_obsidian,
            api::pick_vault,
            api::apply_hotkey,
            api::open_folder,
            api::reveal_path,
            api::app_info,
            api::asset_url,
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
