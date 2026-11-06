# 灵感坞

用于存放你的想法和素材，让想法变为任务的记事本。

本地优先的想法、笔记、素材与任务工作台。桌面版以你选择的 Obsidian 库为笔记事实来源：笔记和想法保存为普通 Markdown，可继续用 Obsidian 编辑、同步和备份。

当前桌面源码版本：**2.13.0**。项目同时保留 Rust/Tauri 桌面版和 Python 网页版；两者是独立实现，仅共享你选择的笔记库与素材文件，不共享配置、索引或运行记录。

## 下载与启动

Windows x64 便携版：[下载 LingGanWu 2.13.0](<desktop/LingGanWu-2.13.0-windows-x64.zip>)。解压后保持 `LingGanWu.exe` 与 `WebView2Loader.dll` 在同一目录，再启动程序。系统需要 Microsoft WebView2 Runtime；缺少时请从 [Microsoft 官方页面](https://developer.microsoft.com/microsoft-edge/webview2/#download-section)安装 Evergreen Runtime。当前程序未签名，不提供安装器或自动更新。使用成品不需要安装 Rust 或 Python。

首次启动后，在设置中选择 Obsidian 库，以及同时包含 `assets/`、`meta/` 的素材库根目录。完整操作、数据位置、隐私边界与排错步骤见[使用说明](<使用说明.md>)。

## 主要功能

- 在 Obsidian Markdown 库中记录想法、笔记和任务，支持自动保存与外部修改冲突保护。
- 按标签、关键词和关联关系浏览内容；提供月历与可编辑关系画布。
- 管理外部图片、音频、视频素材及其标签和说明。
- 提供离线规则整理，以及可选的 OpenAI 兼容接口；发送内容前需确认。
- 支持把想法拆成任务、整理收件箱、回收站恢复和本地备份。

AI 输出需要自行核对。远程接口会收到你确认发送的所选内容；图片视觉分析也会发送图片。API Key 保存在本机配置文件中且为明文，不要公开或提交配置文件。

## 界面

![灵感坞桌面界面](<docs/release-home.png>)

## 项目内容

| 路径 | 说明 |
| --- | --- |
| [desktop/](<desktop/>) | Rust/Tauri 桌面应用源码、构建脚本与 Windows 便携版 |
| [app/](<app/>) | 保留的 Python 网页版 |
| [使用说明.md](<使用说明.md>) | 桌面版完整操作指南、隐私说明与 Python 版说明 |
| [desktop/README.md](<desktop/README.md>) | 桌面版运行要求、源码构建与排错 |
| [docs/](<docs/>) | 当前版本说明与界面截图 |

## Python 网页版

需要 Python 3。在项目根目录运行 `start.bat`，然后访问 <http://127.0.0.1:8791/>。端口冲突时可运行 `start.bat --port 8792`。该版本使用独立的 `app/config.json` 和 SQLite 数据库，详细差异见[使用说明](<使用说明.md>)。

## 从源码构建桌面版

Windows 推荐使用 Rust MSVC 工具链、Visual Studio Build Tools（含“使用 C++ 的桌面开发”与 Windows SDK）及 WebView2 Runtime。详细环境要求和命令见[桌面构建说明](<desktop/README.md#源码构建>)。本仓库保留的 GNU 构建方案依赖本机工具链和 Cargo registry 修改，不是通用构建配方。
