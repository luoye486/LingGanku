# 灵感坞桌面版

Rust + Tauri 2 桌面应用，当前源码版本 **2.13.0**。笔记与想法保存在用户选择的 Obsidian 库中，普通 Markdown 是唯一事实来源。Python 网页版位于项目根目录 `app/`，是独立实现；两版仅共享用户选择的笔记库和素材文件。

## 运行

推荐使用根目录 [README](<../README.md>) 链接的 Windows x64 便携包。完整解压后保持 `LingGanWu.exe` 与 `WebView2Loader.dll` 同目录，并确保已安装 Microsoft WebView2 Runtime。当前程序未签名，不提供安装器或自动更新。无需为运行成品安装 Python、Rust 或 Visual Studio。

首次运行后，在设置中选择 Obsidian 库和同时包含 `assets/`、`meta/` 的素材库根目录。详细操作、数据位置、备份范围和 AI 网络边界见[使用说明](<../使用说明.md>)。

## 源码构建

标准 Windows 构建使用 Rust MSVC 工具链、Visual Studio Build Tools（勾选“使用 C++ 的桌面开发”与 Windows SDK）和 WebView2 Runtime。Rust 版本须满足 [Cargo.toml](<Cargo.toml>) 中声明的最低版本。在仓库根目录执行：

```powershell
rustup show active-toolchain
.\desktop\build.bat
```

也可以直接运行 `powershell -NoProfile -File .\desktop\build.ps1`。构建脚本按激活的工具链选择分支，MSVC 是推荐配置。

仓库 `_toolchain/` 下的 GNU 工具及相关 Cargo registry 修改属于本机遗留兼容方案，不是通用、可移植的 GNU 构建配方；换机器请使用标准 MSVC 环境。构建产物由脚本归集到 `desktop/dist/`。

## 本地自检

```powershell
.\desktop\dist\LingGanWu.exe --selftest
```

自检不打开窗口，会扫描配置、笔记与素材并执行离线分析；可能重建素材库 `.data/assets.json` 缓存，不修改笔记正文。它不能替代窗口交互测试。当前版本的功能和验证范围见[2.13.0 发布说明](<../docs/release-2.13.0.md>)。

## 数据与隐私要点

- 笔记索引、运行记录和未保存的 AI 输出只存在内存中；重要结果需保存为笔记。
- API Key 存在 `%APPDATA%/LingGanHe/config.json`（或 `LINGANHE_CONFIG_DIR` 指定目录）中，当前为明文保存。不要公开或提交该文件。
- AI 远程模式只发送操作中选定且经用户确认的内容；图片视觉分析会发送图片。检查服务地址和发送内容，并核实服务商的隐私及计费政策。
- 不要将桌面版的配置、数据生命周期说明套用到 Python 网页版；两者配置、索引和运行记录互不共享。
