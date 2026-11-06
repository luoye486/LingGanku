# 灵感坞 MCP / CLI 接入

让 Claude Desktop、Cursor、Codex 这类 agent 直接读写你的 Obsidian 库：查任务、建任务、改状态、搜笔记，不用打开桌面窗口。

## 它做什么

- 读 `%APPDATA%\LingGanHe\config.json`（或 `LINGANWU_VAULT` / `LINGANHE_VAULT` 环境变量）里的 `vault` 路径；
- 任务写在 `灵感盒/任务/`，想法在 `灵感盒/想法/`，整理在 `灵感盒/整理/`，和桌面版共用同一套 Markdown + frontmatter；
- 不需要桌面进程在运行，改完 Obsidian 里立即可见。

## 在 Claude Desktop 里接入

编辑 `claude_desktop_config.json`（Windows：`%APPDATA%\Claude\claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "linganwu": {
      "command": "node",
      "args": ["D:\\测试\\test21\\mcp\\server.mjs"],
      "env": { "LINGANWU_VAULT": "D:\\ObSave\\img" }
    }
  }
}
```

不写 `LINGANWU_VAULT` 时会自动读桌面版的配置。

可用工具：

| 工具 | 作用 |
| --- | --- |
| `list_tasks` | 列任务，`status` 可选 `open/todo/doing/done/all` |
| `create_task` | 建任务：`title`、`priority`、`due`、`body`、`source` |
| `update_task` | 改标题 / 状态 / 优先级 / 截止日期 / 正文 |
| `complete_task` | 标记完成 |
| `list_ideas` | 最近的想法 |
| `search_notes` | 全库搜索 |
| `get_note` | 读一篇笔记全文 |

## 命令行用法

```bash
node mcp/server.mjs list
node mcp/server.mjs add "写开题报告" --due 2026-11-05 --priority high
node mcp/server.mjs doing "写开题报告"
node mcp/server.mjs done "写开题报告"
node mcp/server.mjs search "moss"
```

`list` / `search` 输出 JSON，方便再管道给别的脚本。

## 说明

- 只操作 Markdown 文件，不碰 `.data/` 数据库；删除请用桌面版（会移到 `灵感盒/.trash/`）。
- frontmatter 解析覆盖桌面版用到的子集：`key: value`、`[a, b]`、`- item` 列表。
- 与桌面版同时写同一篇笔记时，桌面版会按修改时间提示冲突，不会静默覆盖。
