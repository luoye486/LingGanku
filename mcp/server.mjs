#!/usr/bin/env node
/**
 * 灵感坞 MCP server / CLI
 * 直接读写 Obsidian 库里的 Markdown（frontmatter 为元数据），不依赖桌面进程。
 *
 * MCP:  node mcp/server.mjs            （stdio JSON-RPC，供 Claude Desktop / Cursor 等接入）
 * CLI:  node mcp/server.mjs list
 *       node mcp/server.mjs add "写开题报告" --due 2026-11-05 --priority high
 *       node mcp/server.mjs done "灵感盒/任务/写开题报告.md"
 *       node mcp/server.mjs search "moss"
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

const TASK_DIR = '灵感盒/任务';
const IDEA_DIR = '灵感盒/想法';
const DIGEST_DIR = '灵感盒/整理';
const VERSION = '2.0.0';

function configPath() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  for (const name of ['LingGanWu', 'LingGanHe']) {
    const p = path.join(appData, name, 'config.json');
    if (fs.existsSync(p)) return p;
  }
  return path.join(appData, 'LingGanHe', 'config.json');
}

function vaultRoot() {
  const fromEnv = process.env.LINGANWU_VAULT || process.env.LINGANHE_VAULT;
  if (fromEnv) return path.resolve(fromEnv);
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (cfg.vault) return path.resolve(cfg.vault);
  } catch {}
  throw new Error('找不到 Obsidian 库：请设置 LINGANWU_VAULT 或在桌面版里选择目录');
}

const ROOT = vaultRoot();
const rel = (p) => p.split(path.sep).join('/');
const abs = (p) => path.join(ROOT, ...String(p).split('/'));

function parseFront(text) {
  if (!text.startsWith('---')) return [{}, text];
  const end = text.indexOf('\n---', 3);
  if (end < 0) return [{}, text];
  const head = text.slice(3, end).split(/\r?\n/);
  const meta = {};
  let lastKey = null;
  for (const line of head) {
    if (!line.trim()) continue;
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) {
      const k = m[1], v = m[2].trim();
      lastKey = k;
      if (v === '') meta[k] = [];
      else if (v.startsWith('[') && v.endsWith(']')) {
        meta[k] = v.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      } else meta[k] = v.replace(/^['"]|['"]$/g, '');
    } else if (lastKey && line.trim().startsWith('- ')) {
      if (!Array.isArray(meta[lastKey])) meta[lastKey] = [];
      meta[lastKey].push(line.trim().slice(2).trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return [meta, text.slice(end + 4).replace(/^\r?\n/, '')];
}

function dumpFront(meta, body) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) lines.push(`${k}: [${v.join(', ')}]`);
    } else lines.push(`${k}: ${v}`);
  }
  lines.push('---', '');
  return lines.join('\n') + (body || '');
}

const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function slug(title) {
  return String(title || '无标题').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || '无标题';
}

function uniquePath(dir, name) {
  let p = path.join(ROOT, ...dir.split('/'), name + '.md');
  let i = 2;
  while (fs.existsSync(p)) p = path.join(ROOT, ...dir.split('/'), `${name}-${i++}.md`);
  return p;
}

function writeNote(file, meta, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, dumpFront(meta, body), 'utf8');
  return rel(path.relative(ROOT, file));
}

function readNote(relPath) {
  const file = abs(relPath);
  if (!file.startsWith(ROOT)) throw new Error('路径不在库内');
  if (!fs.existsSync(file)) throw new Error('文件不存在：' + relPath);
  const raw = fs.readFileSync(file, 'utf8');
  const [meta, body] = parseFront(raw);
  const st = fs.statSync(file);
  const p = rel(path.relative(ROOT, file));
  return {
    path: p,
    title: meta.title || body.split(/\r?\n/).find(l => l.trim())?.replace(/^#+\s*/, '') || path.basename(file, '.md'),
    kind: p.startsWith(IDEA_DIR + '/') ? 'idea'
      : p.startsWith(TASK_DIR + '/') ? 'task'
      : p.startsWith(DIGEST_DIR + '/') ? 'digest' : 'note',
    meta, body: body.trim(), mtime: Math.floor(st.mtimeMs / 1000), words: body.replace(/\s/g, '').length,
  };
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function listTasks(status = 'open') {
  const dir = path.join(ROOT, ...TASK_DIR.split('/'));
  if (!fs.existsSync(dir)) return [];
  const rank = { doing: 0, todo: 1, done: 3 };
  return walk(dir).map(f => readNote(rel(path.relative(ROOT, f))))
    .filter(n => status === 'all' || (status === 'open' ? n.meta.status !== 'done' : n.meta.status === status))
    .sort((a, b) => (rank[a.meta.status] ?? 2) - (rank[b.meta.status] ?? 2)
      || String(a.meta.due || '9999').localeCompare(String(b.meta.due || '9999'))
      || b.mtime - a.mtime)
    .map(n => ({
      path: n.path, title: n.title, status: n.meta.status || 'todo', priority: n.meta.priority || 'mid',
      due: n.meta.due || '', source: n.meta.source || '', tags: n.meta.tags || [], mtime: n.mtime,
    }));
}

function listIdeas(limit = 20) {
  const dir = path.join(ROOT, ...IDEA_DIR.split('/'));
  if (!fs.existsSync(dir)) return [];
  return walk(dir).map(f => readNote(rel(path.relative(ROOT, f))))
    .sort((a, b) => b.mtime - a.mtime).slice(0, limit)
    .map(n => ({ path: n.path, title: n.title, status: n.meta.status || 'inbox', tags: n.meta.tags || [], mtime: n.mtime }));
}

function createTask({ title, status = 'todo', priority = 'mid', due = '', body = '', source = '', tags = [] }) {
  const t = String(title || body.split(/\r?\n/).find(Boolean) || '').trim();
  if (!t) throw new Error('任务需要一个标题');
  const file = uniquePath(TASK_DIR, slug(t));
  const meta = { title: t, type: 'task', status: ['todo', 'doing', 'done'].includes(status) ? status : 'todo', priority: ['high', 'mid', 'low'].includes(priority) ? priority : 'mid' };
  if (due) meta.due = due;
  if (source) meta.source = source;
  if (tags && tags.length) meta.tags = tags;
  meta.created = now(); meta.updated = meta.created;
  return { ok: true, path: writeNote(file, meta, body), title: t };
}

function updateTask(relPath, patch = {}) {
  const n = readNote(relPath);
  if (!n.path.startsWith(TASK_DIR + '/')) throw new Error('不是任务文件');
  const meta = { ...n.meta };
  for (const k of ['title', 'status', 'priority', 'due', 'source']) {
    if (patch[k] !== undefined) {
      if (patch[k] === '' && k === 'due') delete meta.due; else meta[k] = patch[k];
    }
  }
  if (patch.tags !== undefined) meta.tags = patch.tags;
  if (patch.status === 'done') meta.completed = now(); else delete meta.completed;
  meta.updated = now();
  writeNote(abs(n.path), meta, patch.body !== undefined ? patch.body : n.body);
  return { ok: true, path: n.path, status: meta.status || 'todo' };
}

function searchNotes(query, limit = 20) {
  const q = String(query || '').toLowerCase();
  if (!q) return [];
  return walk(ROOT).map(f => readNote(rel(path.relative(ROOT, f))))
    .filter(n => (n.title + '\n' + n.body).toLowerCase().includes(q))
    .sort((a, b) => b.mtime - a.mtime).slice(0, limit)
    .map(n => ({ path: n.path, title: n.title, kind: n.kind, excerpt: n.body.replace(/\s+/g, ' ').slice(0, 120), mtime: n.mtime }));
}

/* ---------------- MCP ---------------- */
const tools = [
  { name: 'list_tasks', description: '列出灵感坞任务，可按状态过滤', inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'todo', 'doing', 'done', 'all'] } } } },
  { name: 'create_task', description: '新建任务（写入 Obsidian 的 灵感盒/任务）', inputSchema: { type: 'object', properties: { title: { type: 'string' }, status: { type: 'string' }, priority: { type: 'string', enum: ['high', 'mid', 'low'] }, due: { type: 'string' }, body: { type: 'string' }, source: { type: 'string' } }, required: ['title'] } },
  { name: 'update_task', description: '更新任务字段（标题/状态/优先级/截止日期/正文）', inputSchema: { type: 'object', properties: { path: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' }, priority: { type: 'string' }, due: { type: 'string' }, body: { type: 'string' } }, required: ['path'] } },
  { name: 'complete_task', description: '把任务标记为完成', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'list_ideas', description: '列出最近的想法', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'search_notes', description: '在 Obsidian 库里全文搜索', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } },
  { name: 'get_note', description: '读取一篇笔记/任务/想法的全文', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
];

function callTool(name, args = {}) {
  switch (name) {
    case 'list_tasks': return listTasks(args.status || 'open');
    case 'create_task': return createTask(args);
    case 'update_task': return updateTask(args.path, args);
    case 'complete_task': return updateTask(args.path, { status: 'done' });
    case 'list_ideas': return listIdeas(args.limit || 20);
    case 'search_notes': return searchNotes(args.query, args.limit || 20);
    case 'get_note': return readNote(args.path);
    default: throw new Error('未知工具：' + name);
  }
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

function serve() {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    let req;
    try { req = JSON.parse(line); } catch { return; }
    if (req.method === 'notifications/initialized') return;
    const id = req.id;
    try {
      if (req.method === 'initialize') {
        send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'linganwu', version: VERSION } } });
      } else if (req.method === 'tools/list') {
        send({ jsonrpc: '2.0', id, result: { tools } });
      } else if (req.method === 'tools/call') {
        const { name, arguments: args } = req.params || {};
        const result = callTool(name, args || {});
        send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } });
      } else if (req.method === 'ping') {
        send({ jsonrpc: '2.0', id, result: {} });
      } else {
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + req.method } });
      }
    } catch (e) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: String(e.message || e) }], isError: true } });
    }
  });
}

/* ---------------- CLI ---------------- */
function cli(argv) {
  const [cmd, ...rest] = argv;
  const flag = (n) => { const i = rest.indexOf('--' + n); return i >= 0 ? rest[i + 1] : ''; };
  const positional = rest.filter((a, i) => !a.startsWith('--') && !String(rest[i - 1] || '').startsWith('--'));
  const arg = positional.join(' ');
  if (cmd === 'list') return listTasks(flag('status') || 'open');
  if (cmd === 'ideas') return listIdeas(Number(flag('limit')) || 20);
  if (cmd === 'add') return createTask({ title: arg, due: flag('due'), priority: flag('priority') || 'mid', body: flag('body') });
  if (cmd === 'done') return updateTask(arg.includes('/') ? arg : '灵感盒/任务/' + arg + '.md', { status: 'done' });
  if (cmd === 'doing') return updateTask(arg.includes('/') ? arg : '灵感盒/任务/' + arg + '.md', { status: 'doing' });
  if (cmd === 'search') return searchNotes(arg, Number(flag('limit')) || 20);
  if (cmd === 'get') return readNote(arg);
  return { usage: ['list [--status open|todo|doing|done|all]', 'ideas', 'add <标题> [--due YYYY-MM-DD] [--priority high|mid|low]', 'done <路径或标题>', 'doing <路径或标题>', 'search <关键词>', 'get <路径>'] };
}

if (process.argv.length > 2) {
  try { console.log(JSON.stringify(cli(process.argv.slice(2)), null, 2)); }
  catch (e) { console.error('错误：' + (e.message || e)); process.exit(1); }
} else {
  serve();
}
