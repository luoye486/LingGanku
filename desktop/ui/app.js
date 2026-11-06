/* 灵感坞 · 前端（无框架，直接操作 DOM） */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const S = {
  boot: null,
  view: 'home',
  assets: [],
  assetCats: [],
  assetFilter: 'all',
  assetTag: null,
  assetQuery: '',
  assetSel: new Set(),
  assetPick: false,
  ideas: [],
  statusFilter: 'all',
  tasks: [],
  taskCounts: {},
  taskFilter: 'open',
  today: '',
  tlMonth: '',
  tlDay: '',
  cv: { k: 1, x: 0, y: 0, filter: 'related', rel: { task: true, wiki: true, tag: false, manual: true }, manual: [], pos: {}, selEdge: null },
  notes: [],
  tags: [],
  tag: null,
  folder: null,
  search: '',
  searchItems: [],
  searchBusy: false,
  searchError: '',
  drawer: null,
  ai: { tab: 'notes', q: '', sel: new Set(), mode: 'summarize', extra: '', out: '', meta: null, busy: false, runId: '', streaming: false },
  pal: { items: [], idx: 0 },
  assetSort: 'time',
  noteSort: 'time',
  scroll: {},
  version: '',
};

/* 本地偏好：主题与排序记忆（不依赖后端，换库也保留） */
const THEME_KEY = 'lg.theme';
const SORT_KEY = 'lg.sort';
try {
  const saved = JSON.parse(localStorage.getItem(SORT_KEY) || '{}') || {};
  if (saved.assets) S.assetSort = saved.assets;
  if (saved.notes) S.noteSort = saved.notes;
} catch (e) { /* 忽略损坏的本地偏好 */ }
function saveSort() {
  try { localStorage.setItem(SORT_KEY, JSON.stringify({ assets: S.assetSort, notes: S.noteSort })); } catch (e) {}
}
function currentTheme() { return document.documentElement.dataset.theme === 'paper' ? 'paper' : 'dark'; }
function applyTheme(name, persist = true) {
  const t = name === 'paper' ? 'paper' : 'dark';
  if (t === 'dark') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = 'paper';
  if (persist) { try { localStorage.setItem(THEME_KEY, t); } catch (e) {} }
  const btn = $('#ta-theme');
  if (btn) btn.classList.toggle('on', t === 'paper');
  $$('[data-theme-pick]').forEach(b => b.classList.toggle('on', b.dataset.themePick === t));
}
function toggleTheme() {
  applyTheme(currentTheme() === 'paper' ? 'dark' : 'paper');
  toast(currentTheme() === 'paper' ? '已切换到纸感浅色' : '已切换到深色');
}
function openHelp() { $('#help').classList.add('open'); $('#help').setAttribute('aria-hidden', 'false'); }
function closeHelp() { $('#help').classList.remove('open'); $('#help').setAttribute('aria-hidden', 'true'); }

const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-8 8"/><path d="M18 14v5H5V6h5"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  bulb: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.5.4.8 1 .8 1.6V16h5.6v-.6c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 4h11l5 5v11H4z"/><path d="M15 4v5h5"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5l2.6-1.5M17.2 9l2.6-1.5"/><circle cx="12" cy="12" r="4"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5h10"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  select: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/></svg>',
  palette: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 2 2-2 2M12 13h5"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 8.2 8.2 0 1 0 20 14.5z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.2 9a2.9 2.9 0 0 1 5.6 1c0 2-2.8 2.2-2.8 4"/><circle cx="12" cy="17.4" r=".7"/></svg>',
  sort: '<svg viewBox="0 0 24 24"><path d="M4 7h10M4 12h7M4 17h4M17 5v14M14 16l3 3 3-3"/></svg>',
  wand: '<svg viewBox="0 0 24 24"><path d="m4 20 9-9M14 4l1 3M19 9l-3 1M18 4l-2 2"/><path d="M13 10 4 19"/></svg>',
  task: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.2 2.6 2.6 4.6-5.4"/></svg>',
};

/* ------------------------------------------------------------ 工具 */
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function fmtSize(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10240 ? 1 : 0) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}
function timeAgo(ts) {
  if (!ts) return '';
  const d = Date.now() / 1000 - ts;
  if (d < 60) return '刚刚';
  if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
  if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
  if (d < 86400 * 7) return Math.floor(d / 86400) + ' 天前';
  return new Date(ts * 1000).toLocaleDateString('zh-CN');
}
function todayStr() {
  const d = new Date();
  const w = '日一二三四五六'[d.getDay()];
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${w}`;
}
function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '还没睡';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 19) return '下午好';
  return '晚上好';
}
function vaultName() {
  const v = (S.boot?.config?.vault || '').replace(/[\\/]+$/, '');
  return v.split(/[\\/]/).pop() || '';
}
function obsidianUrl(path) {
  return `obsidian://open?vault=${encodeURIComponent(vaultName())}&file=${encodeURIComponent(path.replace(/\.md$/, ''))}`;
}
function thumbOf(a) {
  if (a.kind === 'image') return `/assets/${a.path.split('/').slice(1).join('/')}`;
  return null;
}
function sprThumb(a) {
  const ratio = (a.fw || 16) / (a.fh || 16);
  return `<div class="spr" style="--ar:${ratio};background-image:url('${assetUrl(a.path)}');background-size:calc(${a.frames} * 100%) auto"></div>`;
}

function assetUrl(p) { return '/' + p.split('/').map(encodeURIComponent).join('/'); }

async function api(path, opt = {}) {
  const { method = 'GET', body } = opt;
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const error = new Error(data.error || ('请求失败 ' + res.status));
    error.data = data; error.items = data.items; error.code = data.code;
    throw error;
  }
  return data;
}

function recentNotes(limit) {
  const pick = list => (list || []).filter(n => n.kind !== 'task' && n.kind !== 'idea');
  const direct = pick(S.boot && S.boot.recent);
  const list = direct.length ? direct : pick(S.notes).slice().sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return list.slice(0, limit || 7);
}

function toast(msg, kind = '') {
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

/* ------------------------------------------------------------ Markdown */
function inlineMd(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/==([^=\n]+)==/g, '<span class="md-hl">$1</span>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) =>
      `<span class="wl" data-wiki="${a.trim()}" title="链接到「${a.trim()}」">${b || a}</span>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g,
      (_, t, u) => `<a href="${u}" target="_blank" rel="noreferrer">${t}</a>`);
}

// 把 ![[图片.png]] / ![alt](路径) 换成占位符，最后统一替换成图片节点。
function imgHtml(target) {
  const raw = String(target).trim();
  const name = raw.split(/[\\/]/).pop();
  const pool = S.assets || [];
  let item = pool.find(a => a.kind === 'image' && a.name.toLowerCase() === name.toLowerCase());
  if (!item) {
    const rel = raw.replace(/^\.\//, '');
    item = pool.find(a => a.path === rel || a.path === 'assets/' + rel);
  }
  if (item) {
    return `<figure class="md-fig"><img class="md-img" src="${assetUrl(item.path)}" alt="${esc(name)}"
      data-open-asset="${esc(item.path)}" loading="lazy"><figcaption>${esc(item.name)}</figcaption></figure>`;
  }
  if (/^https?:/i.test(raw)) {
    return `<figure class="md-fig"><img class="md-img" src="${esc(raw)}" alt="${esc(name)}" loading="lazy">
      <figcaption>${esc(name)}</figcaption></figure>`;
  }
  return `<span class="img-missing" title="${esc(raw)}">${ICON.image} 素材库里没有 ${esc(name)}</span>`;
}

function md(src = '') {
  if (window.MarkdownView) return window.MarkdownView.render(src, { image: imgHtml });
  const imgs = [];
  const stashed = String(src).replace(/\r/g, '')
    .replace(/!\[\[([^\]|]+?)(?:\|\d+)?\]\]/g, (_, n) => `\u0001IMG${imgs.push(n) - 1}\u0001`)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, _alt, u) => `\u0001IMG${imgs.push(u) - 1}\u0001`);
  const lines = stashed.split('\n');
  let out = '', i = 0, list = null, quote = false;
  const closeList = () => {
    if (list) { out += list === 'task' ? '</ul>' : `</${list}>`; list = null; }
  };
  const closeQuote = () => { if (quote) { out += '</blockquote>'; quote = false; } };
  while (i < lines.length) {
    let ln = lines[i];
    if (/^```/.test(ln)) {
      closeList(); closeQuote();
      const lang = ln.replace(/^```/, '').trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out += `<div class="md-code">${lang ? `<span class="lang">${esc(lang)}</span>` : ''}<pre><code>${esc(buf.join('\n'))}</code></pre></div>`;
      continue;
    }
    if (/^\s*$/.test(ln)) { closeList(); closeQuote(); i++; continue; }
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeList(); closeQuote();
      const lv = Math.min(h[1].length + 1, 4);
      out += `<h${lv}>${inlineMd(esc(h[2]))}</h${lv}>`;
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(ln)) { closeList(); closeQuote(); out += '<hr>'; i++; continue; }
    if (/^>\s?/.test(ln)) {
      closeList();
      if (!quote) { out += '<blockquote>'; quote = true; }
      out += `<p>${inlineMd(esc(ln.replace(/^>\s?/, '')))}</p>`;
      i++; continue;
    }
    const ul = ln.match(/^\s*[-*+]\s+(.*)$/);
    const ol = ln.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      closeQuote();
      const content = (ul || ol)[1];
      const task = ul && content.match(/^\[( |x|X)\]\s+(.*)$/);
      const want = task ? 'task' : (ul ? 'ul' : 'ol');
      if (list !== want) {
        closeList();
        out += want === 'task' ? '<ul class="md-task">' : `<${want}>`;
        list = want;
      }
      if (task) {
        const done = task[1].toLowerCase() === 'x';
        out += `<li class="${done ? 'done' : ''}"><span class="cb">${done ? '✓' : ''}</span><span>${inlineMd(esc(task[2]))}</span></li>`;
      } else {
        out += `<li>${inlineMd(esc(content))}</li>`;
      }
      i++; continue;
    }
    if (/^\|.*\|/.test(ln) && /^\|[\s:|-]+\|?$/.test(lines[i + 1] || '')) {
      closeList(); closeQuote();
      const cells = r => r.split('|').slice(1, -1).map(c => c.trim());
      const head = cells(ln);
      i += 2;
      let body = '';
      while (i < lines.length && /^\|.*\|/.test(lines[i])) {
        body += '<tr>' + cells(lines[i]).map(c => `<td>${inlineMd(esc(c))}</td>`).join('') + '</tr>';
        i++;
      }
      out += `<table><thead><tr>${head.map(c => `<th>${inlineMd(esc(c))}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
      continue;
    }
    closeList(); closeQuote();
    out += `<p>${inlineMd(esc(ln))}</p>`;
    i++;
  }
  closeList(); closeQuote();
  return out
    .replace(/\u0001IMG(\d+)\u0001/g, (_, n) => imgHtml(imgs[Number(n)] ?? ''))
    .replace(/<p>((?:<figure class="md-fig">[\s\S]*?<\/figure>)+)<\/p>/g, '$1');
}

function rememberScroll() {
  const v = $('#view');
  if (v && S.view) S.scroll[S.view] = v.scrollTop;
}
function restoreScroll(view) {
  const v = $('#view');
  if (v) v.scrollTop = S.scroll[view] || 0;
}

/* ------------------------------------------------------------ 路由 */
let docHash = '';
let documentLoading = false;
function go(view, arg) {
  if (documentLoading) return;
  const doc = window.DocPage?.current();
  if (doc) {
    void doc.leave().then(ok => { if (ok) go(view, arg); });
    return;
  }
  rememberScroll();
  S.view = view;
  if (view === 'notes' && arg !== undefined) S.folder = arg;
  if (view === 'assets' && arg !== undefined) S.assetFilter = arg;
  if (view === 'tags') S.tag = arg === undefined || arg === '__all' ? null : arg;
  let hash = '#/' + view;
  if (arg && (view === 'assets' || view === 'tags')) hash += '/' + encodeURIComponent(arg);
  if (location.hash !== hash) history.replaceState(null, '', hash);
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.view === view));
  render();
  restoreScroll(view);
  // 视图切换时给容器一次短促的淡入上浮，避免整页硬切；不影响滚动位置与固定层。
  const viewEl = $('#view');
  if (viewEl && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    viewEl.classList.remove('enter');
    void viewEl.offsetWidth;
    viewEl.classList.add('enter');
    clearTimeout(go._t);
    go._t = setTimeout(() => viewEl.classList.remove('enter'), 620);
  }
  if (view === 'search') void loadSearch(S.search);
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [v, ...rest] = h.split('/');
  return { view: v || 'home', arg: rest.length ? decodeURIComponent(rest.join('/')) : undefined };
}

async function routeFromHash() {
  if (documentLoading) { history.replaceState(null, '', docHash); return; }
  const { view, arg } = parseHash();
  const doc = window.DocPage?.current();
  if (doc && !await doc.leave()) { history.replaceState(null, '', docHash); return; }
  rememberScroll();
  if (['note', 'idea', 'asset'].includes(view) && arg) {
    S.view = view === 'note' ? 'notes' : view === 'idea' ? 'ideas' : 'assets';
    $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.view === S.view));
    render();
    if (view === 'note' || view === 'idea') return openDocument(arg, view, false);
    return showAsset(arg);
  }
  S.view = view;
  if (arg) {
    if (view === 'assets') S.assetFilter = arg;
    if (view === 'notes') S.folder = arg;
    if (view === 'tags') S.tag = arg;
  }
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.view === view));
  render();
  restoreScroll(view);
}

window.addEventListener('hashchange', () => { routeFromHash(); });
window.addEventListener('blur', () => { void flushIdeaEditor(); });
window.addEventListener('beforeunload', e => {
  if (activeEditor?.pending || activeEditor?.busy || window.DocPage?.current()?.hasUnsaved()) {
    void flushIdeaEditor();
    e.preventDefault(); e.returnValue = '';
  }
});

/* ------------------------------------------------------------ 渲染 */
function render() {
  if (documentLoading || window.DocPage?.current()) return;
  const v = $('#view');
  const map = { recovery: () => RecoveryUI.view(), inbox: () => InboxUI.view(), home: viewHome, ideas: viewIdeas, tasks: viewTasks, timeline: viewTimeline, canvas: viewCanvas, assets: viewAssets, notes: viewNotes, tags: viewTags, ai: viewAI, settings: viewSettings, search: viewSearch };
  v.innerHTML = (map[S.view] || viewHome)();
  if (S.view === 'recovery') RecoveryUI.bind();
  if (S.view === 'inbox') InboxUI.bind();
  if (S.view === 'ideas') bindIdeas();
  if (S.view === 'tasks') bindTasks();
  if (S.view === 'timeline') bindTimeline();
  if (S.view === 'canvas') bindCanvas();
  if (S.view === 'assets') bindAssets();
  if (S.view === 'notes') bindNotes();
  if (S.view === 'tags') bindTags();
  if (S.view === 'ai') bindAI();
  if (S.view === 'settings') bindSettings();
  if (S.view === 'home') bindHome();
  if (S.view === 'search') {
    $('#semantic-search').onclick = () => SemanticUI.search(S.search);
    $$('[data-note]').forEach(el => el.onclick = () => openNote(el.dataset.note));
    $$('[data-idea]').forEach(el => el.onclick = () => openIdea(el.dataset.idea));
    $$('[data-asset]').forEach(el => el.onclick = () => showAsset(el.dataset.asset));
  }
  updateCrumbs();
}

function updateCrumbs() {
  const names = { recovery: '恢复与备份', inbox: '整理收件箱', home: '首页', ideas: '想法', tasks: '任务', timeline: '时间', canvas: '画布', assets: '素材', notes: '笔记', tags: '标签', ai: 'AI 整理', settings: '设置', search: '搜索' };
  $('#crumbs').innerHTML = `<span>${names[S.view] || ''}</span>`;
}

/* ------------------------------------------------------------ 首页 */
function rhythmHtml() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let d = 6; d >= 0; d--) {
    const t = new Date(start); t.setDate(start.getDate() - d);
    buckets.push({ t, n: 0 });
  }
  const dayKey = x => {
    const ts = Number(x.mtime) || 0;
    if (!ts) return -1;
    const d = new Date(ts * 1000); d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  [...(S.notes || []), ...(S.ideas || [])].forEach(x => {
    const k = dayKey(x);
    const b = buckets.find(y => y.t.getTime() === k);
    if (b) b.n++;
  });
  const max = Math.max(1, ...buckets.map(b => b.n));
  return buckets.map(b => {
    const h = b.n ? Math.max(5, Math.round((b.n / max) * 48)) : 0;
    const w = '日一二三四五六'[b.t.getDay()];
    return `<div class="d ${b.n ? 'on' : ''}" title="${b.t.getMonth() + 1}/${b.t.getDate()} · ${b.n} 条记录">
      <div class="cn">${b.n || ''}</div>
      <div class="track"><div class="b" style="height:${h}px"></div></div>
      <div class="l">${w}</div></div>`;
  }).join('');
}

function viewHome() {
  const st = S.boot?.stats || {};
  const ideas = S.boot?.ideas || [];
  const cats = S.boot?.assets?.cats || [];
  const recent = recentNotes(5);
  const ideaRows = ideas.slice(0, 3).map(i => `
    <div class="idea-row s-${i.status}" data-idea="${esc(i.path)}">
      <div class="bar"></div>
      <div style="min-width:0;flex:1">
        <div class="t">${esc(i.title)}</div>
        <div class="x">${esc(i.excerpt || '（还没有正文）')}</div>
        <div class="m"><span>${timeAgo(i.mtime)}</span><span>${i.words || 0} 字</span></div>
      </div>
    </div>`).join('') || `<div class="empty compact">${ICON.bulb}<b>还没有想法</b>
      <p>想法会写进 Obsidian 库里<br>Obsidian 里也能接着改</p>
      <button class="btn primary" style="margin-top:14px" data-new>${ICON.plus} 记第一条</button></div>`;

  const featured = [
    ...S.assets.filter(a => a.cat === '像素 · 角色'),
    ...S.assets.filter(a => a.cat === '像素 · 道具'),
    ...S.assets.filter(a => a.cat === '照片'),
    ...S.assets.filter(a => a.kind === 'image'),
  ];
  const seen = new Set();
  const thumbs = featured.filter(a => !seen.has(a.path) && seen.add(a.path)).slice(0, 8).map(a => `
    <div class="tile ${a.cat === '图标' ? 'light' : ''}" data-asset="${esc(a.path)}">
      ${a.frames > 1 ? sprThumb(a) : `<img class="${a.cat.startsWith('像素') && a.w && a.w <= 64 ? 'big' : ''}" src="${assetUrl(a.path)}" alt="" loading="lazy">`}
      <span>${esc(a.name)}</span>
    </div>`).join('');

  const catRows = cats.slice(0, 8).map(c => `
    <div class="cat-row" data-cat="${esc(c.name)}">
      <span>${esc(c.name)}</span><span class="n">${c.count}</span>
    </div>`).join('') + (cats.length > 8 ? `
    <div class="cat-row" data-go="assets" style="color:var(--dim-2)">
      <span>还有 ${cats.length - 8} 个分类</span><span class="n">→</span></div>` : '');

  const noteCount = (S.notes || []).filter(n => n.kind !== 'task').length;
  const openTasks = (S.tasks || []).filter(t => t.status !== 'done');
  const pickTasks = openTasks
    .map(t => {
      let score = 0;
      if (t.status === 'doing') score += 100;
      if (t.due && S.today && t.due <= S.today) score += 60;
      if (t.priority === 'high') score += 30;
      else if (t.priority === 'mid') score += 10;
      return [score, t];
    })
    .sort((a, b) => b[0] - a[0])
    .slice(0, 3)
    .map(x => x[1]);
  const homeTasks = pickTasks.length
    ? pickTasks.map(taskRow).join('')
    : `<div class="task-empty"><span>今天还没有安排。把一条想法拆成下一步，从这里开始。</span>
        <button class="btn ghost" data-new-task>${ICON.plus} 新建任务</button></div>`;

  return `<div class="wrap">
    <div class="hero">
      <div class="hero-kicker">灵感坞 · ${todayStr()}</div>
      <h1>${greeting()}，<em>今天记点什么？</em></h1>
      <p>想法、素材、笔记都在一个地方，AI 负责把它们串起来。</p>
    </div>

    <div class="stats">
      <div class="stat"><div class="k">想法</div><div class="v">${ideas.length}<small>条</small></div></div>
      <div class="stat"><div class="k">笔记</div><div class="v">${noteCount}<small>篇</small></div></div>
      <div class="stat"><div class="k">素材</div><div class="v">${S.assets.length}<small>个</small></div></div>
      <div class="stat"><div class="k">累计字数</div><div class="v">${((st.words || 0) / 1000).toFixed(1)}<small>k</small></div></div>
    </div>

    <div class="section-title"><h2>这七天的记录节奏</h2><span class="sub">想法 + 笔记 · 按天统计</span></div>
    <div class="rhythm-wrap"><div class="rhythm">${rhythmHtml()}</div></div>

    <div class="section-title"><h2>今天的三件事</h2><span class="sub">TODAY · 3 THINGS</span>
      <a class="more" data-go="tasks">全部任务 →</a></div>
    <div class="task-list home-tasks">${homeTasks}</div>

    <div class="grid-2">
      <div>
        <div class="section-title"><h2>最近的想法</h2><span class="sub">${ideas.length} 条</span>
          <a class="more" data-go="ideas">全部 →</a></div>
        <div class="stack">${ideaRows}</div>

        <div class="section-title" style="margin-top:34px"><h2>最近的笔记</h2><span class="sub">来自 Obsidian</span>
          <a class="more" data-go="notes">全部 →</a></div>
        <div class="list">${recent.slice(0, 5).map(n => `
          <div class="note-row" data-note="${esc(n.path)}">
            <div class="t">${esc(n.title)}<span class="tag">${esc(n.folder || '根目录')}</span></div>
            <div class="x">${esc(n.excerpt || '')}</div>
            <div class="m"><span>${timeAgo(n.mtime)}</span><span>${n.words} 字</span></div>
          </div>`).join('') || '<div class="empty compact">还没有笔记</div>'}
        </div>
      </div>
      <div>
        <div class="section-title"><h2>素材库</h2><span class="sub">${S.assets.length} 个文件</span>
          <a class="more" data-go="assets">浏览 →</a></div>
        <div class="asset-strip">${thumbs}</div>
        <div class="section-title" style="margin-top:34px"><h2>分类</h2><span class="sub">${cats.length} 个</span>
          <a class="more" data-go="assets">管理 →</a></div>
        <div class="cat-list">${catRows}</div>
      </div>
    </div>
  </div>`;
}

function bindHome() {
  $$('[data-go]').forEach(el => el.onclick = () => go(el.dataset.go));
  $$('[data-idea]').forEach(el => el.onclick = () => openIdea(el.dataset.idea));
  $$('[data-note]').forEach(el => el.onclick = () => openNote(el.dataset.note));
  $$('[data-asset]').forEach(el => el.onclick = () => showAsset(el.dataset.asset));
  $$('[data-cat]').forEach(el => el.onclick = () => go('assets', el.dataset.cat));
  $$('[data-new]').forEach(el => el.onclick = () => newIdea());
  $$('[data-new-task]').forEach(el => el.onclick = () => newTask());
  bindTaskRows();
}


/* 页面头：英文眉标 + 中文大标题 + 说明 + 右侧操作，统一所有一级视图的层级 */
function pageHead(kicker, title, sub, actions) {
  return `<header class="page-head">
    <div class="ph-main">
      <div class="ph-kicker">${esc(kicker)}</div>
      <h1>${title}</h1>
      ${sub ? `<p class="ph-sub">${sub}</p>` : ''}
    </div>
    ${actions ? `<div class="ph-actions">${actions}</div>` : ''}
  </header>`;
}

/* ------------------------------------------------------------ 想法 */
function viewIdeas() {
  const list = S.ideas.filter(i => S.statusFilter === 'all' || i.status === S.statusFilter);
  const chips = [['all', '全部'], ['inbox', '收集箱'], ['thinking', '思考中'], ['building', '进行中'], ['done', '已完成']]
    .map(([k, n]) => `<button class="chip ${S.statusFilter === k ? 'on' : ''}" data-status="${k}">${n}
      <span style="opacity:.6">${k === 'all' ? S.ideas.length : S.ideas.filter(i => i.status === k).length}</span></button>`).join('');
  const cards = list.map(i => `
    <div class="card idea-card" data-idea="${esc(i.path)}">
      <div class="head">
        <span class="pill ${i.status}">${statusName(i.status)}</span>
        <span class="t">${esc(i.title)}</span>
      </div>
      <div class="x">${esc(i.excerpt || '（还没有正文）')}</div>
      <div class="foot">
        <span>${timeAgo(i.mtime)}</span><span>${i.words} 字</span>
        ${(i.tags || []).slice(0, 2).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
        <span class="assets">${(i.assets || []).slice(0, 3).map(a =>
          a.match(/\.(png|jpe?g|webp|svg|gif)$/i) ? `<img src="${assetUrl(a)}" alt="">` : '').join('')}</span>
      </div>
    </div>`).join('');
  return `<div class="wrap">
    ${pageHead('IDEAS / 想法', '想法', `${S.ideas.length} 条记录 · 按状态筛选`,
      `<button class="btn" data-synthesize>${ICON.spark} 合成想法</button><button class="btn primary" data-new>${ICON.plus} 新想法</button>`)}
    <div class="toolbar">${chips}</div>
    <div class="ideas-grid">${cards || `<div class="empty" style="grid-column:1/-1">${ICON.bulb}<b>这个状态下没有想法</b><p>换个筛选，或者新建一条</p></div>`}</div>
  </div>`;
}

function statusName(s) {
  return { inbox: '收集箱', thinking: '思考中', building: '进行中', done: '已完成' }[s] || s;
}

function bindIdeas() {
  $('[data-synthesize]').onclick = () => AIWorkflows.openIdeas();
  $$('[data-status]').forEach(el => el.onclick = () => { S.statusFilter = el.dataset.status; render(); });
  $$('[data-idea]').forEach(el => el.onclick = () => openIdea(el.dataset.idea));
  $$('[data-new]').forEach(el => el.onclick = () => newIdea());
}

/* ------------------------------------------------------------ 素材 */
function viewAssets() {
  const cats = ['all', ...(S.boot?.assets?.cats || []).map(c => c.name)];
  const chips = cats.map(c => {
    const n = c === 'all' ? S.assets.length : (S.boot.assets.cats.find(x => x.name === c)?.count || 0);
    return `<button class="chip ${S.assetFilter === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c === 'all' ? '全部' : c)} <span style="opacity:.6">${n}</span></button>`;
  }).join('');
  const tagCount = new Map();
  S.assets.forEach(a => (a.tags || []).forEach(t => tagCount.set(t, (tagCount.get(t) || 0) + 1)));
  const tagChips = [...tagCount.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'zh'))
    .map(([tag, n]) => `<button class="chip tag-chip ${S.assetTag === tag ? 'on' : ''}" data-tag-filter="${esc(tag)}">
      ${esc(tag)} <span style="opacity:.6">${n}</span></button>`).join('');
  const q = (S.assetQuery || '').toLowerCase();
  const items = S.assets.filter(a =>
    (S.assetFilter === 'all' || a.cat === S.assetFilter) &&
    (!S.assetTag || (a.tags || []).includes(S.assetTag)) &&
    (!q || (a.name + ' ' + a.cat + ' ' + (a.ai_note || '') + ' ' + (a.tags || []).join(' ')).toLowerCase().includes(q)));
  const assetOrder = {
    time: (a, b) => (Number(b.mtime) || 0) - (Number(a.mtime) || 0),
    name: (a, b) => a.name.localeCompare(b.name, 'zh'),
    size: (a, b) => (Number(b.size) || 0) - (Number(a.size) || 0),
  };
  items.sort(assetOrder[S.assetSort] || assetOrder.time);
  const sortBar = [['time', '最新'], ['name', '名称'], ['size', '大小']]
    .map(([k, n]) => `<button data-sort-asset="${k}" class="${S.assetSort === k ? 'on' : ''}">${n}</button>`).join('');
  return `<div class="wrap">
    ${pageHead('LIBRARY / 素材', '素材库', `${items.length} / ${S.assets.length} 个文件 · 拖进窗口即可上传`,
      `<span class="sortbar">${sortBar}</span>
       <button class="btn" data-upload>${ICON.upload} 上传</button>
       <button class="btn ghost" data-rescan>${ICON.refresh} 重建索引</button>
       <button class="btn ghost" data-pick-toggle>${ICON.select} ${S.assetPick ? '完成' : '选择'}</button>`)}
    ${S.assetPick ? `<div class="sel-bar">
      <span>已选 <b>${S.assetSel.size}</b> 项</span>
      <button class="btn ghost" data-pick-all>全选当前 ${items.length} 项</button>
      <button class="btn ghost" data-pick-none>取消选择</button>
      <span style="flex:1"></span>
      <button class="btn" data-pick-ai ${S.assetSel.size ? '' : 'disabled'}>${ICON.spark} AI 分析</button>
      <button class="btn danger" data-pick-del ${S.assetSel.size ? '' : 'disabled'}>${ICON.trash} 批量删除</button>
    </div>` : ''}
    <div class="assets-bar">${chips}</div>
    ${tagChips ? `<div class="assets-bar tag-bar">${tagChips}
      ${S.assetTag ? '<button class="chip" data-tag-clear-asset>清除标签筛选</button>' : ''}</div>` : ''}
    <div class="assets-grid">${items.map(assetCard).join('') || `<div class="empty" style="grid-column:1/-1">${ICON.image}<b>没有匹配的素材</b><p>换个分类或关键词</p></div>`}</div>
  </div>`;
}

function assetCard(a) {
  const isPx = /pixel/.test(a.path);
  let thumb;
  if (a.kind === 'image') {
    if (a.frames > 1) {
      thumb = sprThumb(a);
    } else {
      thumb = `<img class="${isPx ? 'px' : ''}${isPx && a.w && a.w <= 64 ? ' big' : ''}" src="${assetUrl(a.path)}" alt="" loading="lazy">`;
    }
  } else if (a.kind === 'audio') {
    thumb = `<div class="play">${ICON.play}</div>`;
  } else if (a.kind === 'video') {
    thumb = `<div class="play">${ICON.play}</div>`;
  } else {
    thumb = `<div style="color:var(--dim-2);font-size:11px">${esc(a.ext)}</div>`;
  }
  const meta = [a.ext.toUpperCase(), a.w ? `${a.w}×${a.h}` : '', a.dur ? `${a.dur}s` : '', a.frames ? `${a.frames} 帧` : '']
    .filter(Boolean).join(' · ');
  const picked = S.assetSel.has(a.path);
  return `<div class="asset-card ${picked ? 'sel' : ''} ${S.assetPick ? 'picking' : ''}" data-asset="${esc(a.path)}">
    <div class="thumb ${a.kind !== 'image' ? 'flat' : ''} ${a.kind === 'image' && a.cat === '图标' ? 'light' : ''}">${thumb}
      <label class="pick-box" title="选择">
        <input type="checkbox" data-asset-pick="${esc(a.path)}" ${picked ? 'checked' : ''}></label>
      <div class="hover-actions">
        <button data-copy="${esc(a.path)}" title="复制路径">${ICON.copy}</button>
        <button data-asset-reveal="${esc(a.path)}" title="在文件夹中显示">${ICON.folder}</button>
        <button data-asset-del="${esc(a.path)}" title="移到回收站">${ICON.trash}</button>
      </div>
    </div>
    <div class="meta"><div class="n" title="${esc(a.name)}">${esc(a.name)}</div>
      <div class="s"><span>${esc(a.cat)}</span><span>${meta}</span></div>
      ${(a.tags || []).length ? `<div class="atags">${a.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}</div>
  </div>`;
}

function bindAssets() {
  $$('[data-sort-asset]').forEach(el => el.onclick = () => {
    S.assetSort = el.dataset.sortAsset;
    saveSort();
    render();
  });
  $$('[data-cat]').forEach(el => el.onclick = () => { S.assetFilter = el.dataset.cat; render(); });
  $$('[data-tag-filter]').forEach(el => el.onclick = () => {
    S.assetTag = S.assetTag === el.dataset.tagFilter ? null : el.dataset.tagFilter;
    render();
  });
  const clearTag = $('[data-tag-clear-asset]');
  if (clearTag) clearTag.onclick = () => { S.assetTag = null; render(); };
  $$('[data-asset]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-copy],[data-asset-del],[data-asset-reveal],.pick-box')) return;
    if (S.assetPick) { togglePick(el.dataset.asset); return; }
    showAsset(el.dataset.asset);
  });
  $$('[data-asset-pick]').forEach(el => el.onchange = () => togglePick(el.dataset.assetPick));
  $$('[data-asset-del]').forEach(el => el.onclick = async e => {
    e.stopPropagation();
    await deleteAssets([el.dataset.assetDel]);
  });
  $$('[data-asset-reveal]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    revealAsset(el.dataset.assetReveal);
  });
  const pickToggle = $('[data-pick-toggle]');
  if (pickToggle) pickToggle.onclick = () => {
    S.assetPick = !S.assetPick;
    if (!S.assetPick) S.assetSel.clear();
    render();
  };
  const pickAll = $('[data-pick-all]');
  if (pickAll) pickAll.onclick = () => {
    const items = S.assets.filter(a =>
      (S.assetFilter === 'all' || a.cat === S.assetFilter) &&
      (!S.assetTag || (a.tags || []).includes(S.assetTag)));
    items.forEach(a => S.assetSel.add(a.path));
    render();
  };
  const pickNone = $('[data-pick-none]');
  if (pickNone) pickNone.onclick = () => { S.assetSel.clear(); render(); };
  const pickAi = $('[data-pick-ai]');
  if (pickAi) pickAi.onclick = () => AIWorkflows.openAssets([...S.assetSel]);
  const pickDel = $('[data-pick-del]');
  if (pickDel) pickDel.onclick = () => deleteAssets([...S.assetSel]);
  $$('[data-copy]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    navigator.clipboard?.writeText(el.dataset.copy);
    toast('路径已复制');
  });
  $$('[data-rescan]').forEach(el => el.onclick = async () => {
    el.disabled = true;
    try { await api('/api/rescan-assets', { method: 'POST' }); await reload(); toast('索引已重建', 'ok'); }
    finally { el.disabled = false; }
  });
  $$('[data-upload]').forEach(el => el.onclick = pickUpload);
}

function pickUpload() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  inp.onchange = () => uploadFiles([...inp.files]);
  inp.click();
}

async function uploadFiles(files) {
  if (!files || !files.length) return;
  let ok = 0;
  for (const f of files) {
    try {
      const buf = await f.arrayBuffer();
      const res = await fetch('/api/upload', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(f.name) }, body: buf });
      if (res.ok) ok++;
      else toast('上传失败：' + f.name, 'err');
    } catch (e) {
      toast('上传失败：' + f.name, 'err');
    }
  }
  await reload();
  if (ok) toast(`已上传 ${ok} 个素材`, 'ok');
}

/* ------------------------------------------------------------ 拖入文本 */
// 文本类文件（记事本、Markdown、日志…）不走素材库，直接落成一则想法。
const TEXT_DOC_EXT = new Set(['txt', 'md', 'markdown', 'mdown', 'text', 'log', 'org', 'rst', 'csv', 'tsv', 'json', 'yaml', 'yml']);
function isTextDoc(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  if (TEXT_DOC_EXT.has(ext)) return true;
  const mime = f.type || '';
  return /^text\//.test(mime) || /json|xml|csv/.test(mime);
}
// 记事本可能存成 UTF-8，也可能存成 GBK；先按 UTF-8 严格解码，失败再回退。
async function readTextSmart(file) {
  const buf = await file.arrayBuffer();
  const b = new Uint8Array(buf);
  // 记事本的「Unicode」选项会存成带 BOM 的 UTF-16，先认 BOM 再谈回退。
  if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) {
    try { return new TextDecoder('utf-16le').decode(buf); } catch {}
  }
  if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) {
    try { return new TextDecoder('utf-16be').decode(buf); } catch {}
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try { return new TextDecoder('gbk').decode(buf); }
    catch { return new TextDecoder('utf-8').decode(buf); }
  }
}
function splitFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  m[1].split(/\r?\n/).forEach(line => {
    const i = line.indexOf(':');
    if (i <= 0) return;
    const k = line.slice(0, i).trim().toLowerCase();
    let v = line.slice(i + 1).trim();
    if (!k) return;
    if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean);
    else v = v.replace(/^["']|["']$/g, '');
    meta[k] = v;
  });
  return { meta, body: text.slice(m[0].length) };
}
function docTitle(name, body, meta) {
  if (typeof meta.title === 'string' && meta.title.trim()) return meta.title.trim().slice(0, 80);
  const h = body.match(/^#\s+(.+)$/m);
  if (h) return h[1].trim().slice(0, 80);
  const stem = name.replace(/\.[^.]+$/, '').trim();
  return (stem || '拖入的文本').slice(0, 80);
}
function docTags(meta) {
  const t = meta.tags || meta.tag;
  if (Array.isArray(t)) return t.map(x => String(x).trim()).filter(Boolean);
  if (typeof t === 'string') return t.split(/[,\s]+/).map(x => x.replace(/^#/, '').trim()).filter(Boolean);
  return [];
}
async function importDocs(files) {
  if (!files || !files.length) return;
  let ok = 0, first = '';
  for (const f of files) {
    try {
      const raw = await readTextSmart(f);
      const { meta, body } = splitFrontmatter(raw);
      const text = body.replace(/\r\n/g, '\n').trim();
      // 空文件也保留：新建文本文档常常先存盘、后写字，先收进来再补内容。
      const res = await api('/api/idea', { method: 'POST', body: {
        title: docTitle(f.name, text, meta),
        body: text,
        tags: docTags(meta),
        status: 'inbox',
        source: f.name,
      }});
      if (res && res.ok !== false) { ok++; if (!first) first = res.path; }
      else toast(`导入失败：${f.name}`, 'err');
    } catch (e) {
      toast(`导入失败：${f.name}`, 'err');
    }
  }
  if (!ok) return;
  await reload();
  if (first) { go('ideas'); openIdea(first); }
  toast(`已把 ${ok} 个文本收进想法`, 'ok');
}
function pickImportDocs() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  inp.accept = '.txt,.md,.markdown,.text,.log,.org,.rst,.csv,.json,.yaml,.yml,text/plain,text/markdown';
  inp.onchange = () => importDocs([...inp.files]);
  inp.click();
}

function togglePick(path) {
  if (S.assetSel.has(path)) S.assetSel.delete(path);
  else S.assetSel.add(path);
  render();
}

async function deleteAssets(paths) {
  if (!paths.length) return;
  const one = paths.length === 1;
  const label = one ? `删除素材「${(paths[0].split('/').pop())}」？` : `删除选中的 ${paths.length} 个素材？`;
  if (!await confirm(`${label}\n文件会移到素材库的 .data/trash/，需要时还能找回。`)) return;
  try {
    const res = one
      ? await api('/api/asset/delete', { method: 'POST', body: { path: paths[0] } })
      : await api('/api/asset/delete-batch', { method: 'POST', body: { paths } });
    const n = one ? 1 : (res.trashed || []).length;
    const failed = (res.failed || []).length;
    S.assetSel.clear();
    if (one) $('#modal').classList.remove('open');
    await reload();
    render();
    toast(failed ? `已删除 ${n} 个，${failed} 个失败` : `已删除 ${n} 个素材（进 .data/trash）`, failed ? 'err' : 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function revealAsset(rel) {
  const lib = S.boot?.config?.library || '';
  if (!lib) return toast('还没有设置素材库目录', 'err');
  const abs = lib.replace(/[\\/]+$/, '') + '\\' + rel.replace(/\//g, '\\');
  try { await invoke('reveal_path', { path: abs }); }
  catch (e) { toast(String(e).replace(/^Error:\s*/, ''), 'err'); }
}

function showAsset(path) {
  const a = S.assets.find(x => x.path === path);
  if (!a) return;
  const box = $('#modal-box');
  const preview = a.kind === 'image'
    ? `<img class="modal-img" src="${assetUrl(a.path)}" alt="">`
    : a.kind === 'audio'
      ? `<audio controls autoplay style="width:100%" src="${assetUrl(a.path)}"></audio>`
      : a.kind === 'video'
        ? `<video controls autoplay style="width:100%;border-radius:4px" src="${assetUrl(a.path)}"></video>`
        : `<div class="hint">这类文件没有预览</div>`;
  box.innerHTML = `<h3>${esc(a.name)}</h3>
    <div class="sub">${esc(a.cat)} · ${fmtSize(a.size)}${a.w ? ` · ${a.w}×${a.h}` : ''}${a.dur ? ' · ' + a.dur + 's' : ''}${a.frames ? ' · ' + a.frames + ' 帧' : ''}</div>
    ${preview}
    <div class="field" style="margin-top:14px"><label>标签（回车添加，点 × 移除）</label>
      <div class="tag-edit" id="a-tag-edit">
        <span class="tag-chips" id="a-tags"></span>
        <input class="input" id="a-tag-input" placeholder="例如：地牢、待用、参考" style="flex:1;min-width:120px">
      </div>
    </div>
    <div style="margin-top:12px;font-size:12px;color:var(--dim);line-height:1.8">
      <div>路径：<code>${esc(a.path)}</code></div>
      ${a.note ? `<div>说明：${esc(a.note)}</div>` : ''}
      <div class="field"><label for="a-note">说明 / 用途 / 备注（最多400字，也用于检索）</label><textarea class="area" id="a-note" rows="3">${esc(a.ai_note || '')}</textarea><button class="btn" id="a-note-save">保存说明</button><span class="hint" id="a-note-status" role="status"></span></div>
      ${a.author ? `<div>来源：${esc(a.author)} · ${esc(a.license || '')}</div>` : ''}
    </div>
    <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn" id="asset-copy">${ICON.copy} 复制路径</button>
      <a class="btn" href="${assetUrl(a.path)}" download>下载</a>
      <button class="btn" id="asset-reveal">${ICON.folder} 在文件夹中显示</button>
      <button class="btn" id="asset-rename">重命名</button>
      <button class="btn" id="asset-idea">${ICON.plus} 用它写想法</button>
      <button class="btn" id="asset-related">相关内容</button>
      ${['audio', 'video'].includes(a.kind) ? '<button class="btn" id="asset-media">音视频内容分析</button>' : ''}
      <button class="btn ghost danger" id="asset-del" style="margin-left:auto">${ICON.trash} 删除</button>
    </div>`;
  $('#modal').classList.add('open');

  // 标签编辑：改完立即写回 .data/asset-tags.json
  let tags = [...(a.tags || [])];
  const paintTags = () => {
    $('#a-tags').innerHTML = tags.map((t, i) =>
      `<span class="tag">${esc(t)}<button data-tag-rm="${i}">×</button></span>`).join('')
      || '<span class="hint">还没有标签</span>';
    $$('#a-tags [data-tag-rm]').forEach(b => b.onclick = async () => {
      tags.splice(Number(b.dataset.tagRm), 1);
      await saveTags();
    });
  };
  const saveTags = async () => {
    try {
      const res = await api('/api/asset/tags', { method: 'POST', body: { path: a.path, tags } });
      tags = res.tags || [];
      const item = S.assets.find(x => x.path === a.path);
      if (item) item.tags = [...tags];
      paintTags();
      await reload(true);
      render();
    } catch (e) { toast(e.message, 'err'); }
  };
  paintTags();
  $('#a-tag-input').onkeydown = async e => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const v = e.target.value.trim().replace(/^#/, '');
    if (!v) return;
    if (!tags.includes(v)) { tags.push(v); await saveTags(); }
    e.target.value = '';
  };
  $('#a-note-save').onclick = async e => {
    const btn = e.currentTarget, text = $('#a-note').value;
    btn.disabled = true;
    const status = $('#a-note-status'); status.textContent = '保存中…';
    try {
      const res = await api('/api/asset/note', { method: 'POST', body: { path: a.path, ai_note: text } });
      a.ai_note = res.ai_note || ''; status.textContent = '已保存';
      await reload(true); render();
    } catch (err) { status.textContent = '保存失败：' + err.message; }
    finally { btn.disabled = false; }
  };
  $('#asset-copy').onclick = () => { navigator.clipboard?.writeText(a.path); toast('路径已复制'); };
  $('#asset-idea').onclick = async () => { $('#modal').classList.remove('open'); await newIdea(a.name, '', [a.path]); };
  $('#asset-related').onclick = () => { $('#modal').classList.remove('open'); SemanticUI.related(a.path); };
  if ($('#asset-media')) $('#asset-media').onclick = () => { $('#modal').classList.remove('open'); MediaUI.open(a.path); };
  $('#asset-reveal').onclick = () => revealAsset(a.path);
  $('#asset-rename').onclick = async () => {
    const name = prompt('新的文件名（可留原扩展名）', a.name);
    if (!name || name.trim() === a.name) return;
    try {
      const res = await api('/api/asset/rename', { method: 'POST', body: { path: a.path, name: name.trim() } });
      await reload();
      $('#modal').classList.remove('open');
      toast('已重命名为 ' + res.path.split('/').pop(), 'ok');
      showAsset(res.path);
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#asset-del').onclick = () => deleteAssets([a.path]);
}

/* ------------------------------------------------------------ 笔记 */
/* ------------------------------------------------------------ 任务 */
function statusLabel(s) { return s === 'doing' ? '进行中' : s === 'done' ? '已完成' : '待办'; }

function dueLabel(t) {
  if (!t.due) return '';
  if (t.due === S.today) return '今天';
  const d = new Date(t.due + 'T00:00:00');
  const n = new Date(); n.setHours(0, 0, 0, 0);
  const diff = Math.round((d - n) / 86400000);
  if (diff === 1) return '明天';
  if (diff === 0) return '今天';
  if (diff < 0) return `逾期 ${-diff} 天`;
  if (diff < 30) return `${diff} 天后`;
  return t.due.slice(5);
}

function taskRow(t) {
  const st = t.status || 'todo';
  const due = dueLabel(t);
  const over = t.due && S.today && t.due < S.today && st !== 'done';
  const meta = [];
  if (t.source) meta.push('<span class="tk-src">来自想法</span>');
  if (t.priority === 'high') meta.push('<span class="tk-pri">重要</span>');
  return `<div class="task-row s-${st}" data-task="${esc(t.path)}">
    <button class="tk-dot ${st}" data-cycle="${esc(t.path)}" title="切换状态：待办 / 进行中 / 已完成">${st === 'done' ? ICON.check : ''}</button>
    <div class="tk-main">
      <div class="tk-title">${esc(t.title)}</div>
      ${(meta.length || t.due) ? `<div class="tk-meta">${meta.join('')}${t.due ? `<span class="tk-date">${esc(t.due)}</span>` : ''}</div>` : ''}
    </div>
    ${due ? `<span class="tk-due ${over ? 'over' : ''}">${esc(due)}</span>` : ''}
    <div class="tk-acts">
      <button class="tk-act" data-postpone="${esc(t.path)}" title="推迟一天">+1</button>
      ${st !== 'done' ? `<button class="tk-act" data-complete="${esc(t.path)}" title="标记完成">${ICON.check}</button>` : ''}
    </div>
  </div>`;
}

function bindTaskRows() {
  $$('[data-task]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-cycle]') || e.target.closest('.tk-acts')) return;
    openTask(el.dataset.task);
  });
  $$('[data-cycle]').forEach(b => b.onclick = e => { e.stopPropagation(); cycleTask(b.dataset.cycle); });
  $$('[data-postpone]').forEach(b => b.onclick = e => { e.stopPropagation(); postponeTask(b.dataset.postpone); });
  $$('[data-complete]').forEach(b => b.onclick = e => { e.stopPropagation(); completeTask(b.dataset.complete); });
}

async function cycleTask(path) {
  const t = (S.tasks || []).find(x => x.path === path);
  if (!t) return;
  const next = t.status === 'todo' ? 'doing' : t.status === 'doing' ? 'done' : 'todo';
  try {
    await api('/api/task', { method: 'PUT', body: { path, status: next } });
    await reload(true);
    render();
    toast(next === 'done' ? '做完了一件' : next === 'doing' ? '开始做这件事' : '已放回待办', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function completeTask(path) {
  try {
    await api('/api/task', { method: 'PUT', body: { path, status: 'done' } });
    await reload(true);
    render();
    toast('做完了一件', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

async function postponeTask(path) {
  const t = (S.tasks || []).find(x => x.path === path);
  if (!t) return;
  const base = t.due ? new Date(t.due + 'T00:00:00') : new Date();
  const due = ymd(addDays(base, 1));
  try {
    await api('/api/task', { method: 'PUT', body: { path, due } });
    await reload(true);
    render();
    toast('已推迟到 ' + due, 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

function dayOf(value, mtime) {
  const m = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  if (m) return m[0];
  return mtime ? ymd(new Date(mtime * 1000)) : '';
}

function ideaDay(i) { return dayOf(i.meta && i.meta.created, i.mtime); }

function weekEnd() {
  const base = new Date((S.today || ymd(new Date())) + 'T00:00:00');
  const wd = (base.getDay() + 6) % 7;
  return ymd(addDays(base, 6 - wd));
}

function taskBucket(t) {
  if ((t.status || 'todo') === 'done') return 'done';
  if (!t.due) return 'none';
  if (t.due < S.today) return 'over';
  if (t.due === S.today) return 'today';
  if (t.due <= weekEnd()) return 'week';
  return 'later';
}

function taskGroupsHtml(items) {
  const order = [['over', '逾期'], ['today', '今天'], ['week', '本周'], ['later', '以后'], ['none', '没定日期'], ['done', '已完成']];
  return order.map(([k, label]) => {
    const arr = items.filter(t => taskBucket(t) === k);
    if (!arr.length) return '';
    return `<section class="task-group">
      <div class="tg-head"><span>${label}</span><em>${arr.length}</em></div>
      ${arr.map(t => taskRow(t)).join('')}
    </section>`;
  }).join('');
}

function viewTasks() {
  const all = S.tasks || [];
  const c = S.taskCounts || {};
  const f = S.taskFilter || 'open';
  const we = weekEnd();
  const tabs = [
    ['open', '未完成', (c.todo || 0) + (c.doing || 0)],
    ['today', '今天', all.filter(t => t.status !== 'done' && t.due === S.today).length],
    ['over', '逾期', all.filter(t => t.status !== 'done' && t.due && t.due < S.today).length],
    ['week', '本周', all.filter(t => t.status !== 'done' && t.due && t.due > S.today && t.due <= we).length],
    ['done', '已完成', c.done || 0],
    ['all', '全部', all.length],
  ];
  const chips = tabs.map(([k, l, n]) => `<button class="chip ${f === k ? 'on' : ''}" data-task-filter="${k}">${l}<em>${n}</em></button>`).join('');
  const items = all.filter(t => {
    if (f === 'all') return true;
    if (f === 'open') return t.status !== 'done';
    if (f === 'done') return t.status === 'done';
    if (f === 'today') return t.status !== 'done' && t.due === S.today;
    if (f === 'over') return t.status !== 'done' && t.due && t.due < S.today;
    if (f === 'week') return t.status !== 'done' && t.due && t.due > S.today && t.due <= we;
    return true;
  });
  const actions = `<button class="btn primary" data-new-task>${ICON.plus} 新建任务</button>`;
  const empty = `<div class="empty compact">${ICON.task}<b>这一栏是空的</b><p>换个筛选，或者把一条想法拆成下一步。</p></div>`;
  const body = items.length ? taskGroupsHtml(items) : empty;
  return `<div class="wrap">
    ${pageHead('TASKS', '任务', '把想法拆成下一步，再把下一步做完。', actions)}
    <div class="task-quick card">
      <span class="tq-plus">${ICON.plus}</span>
      <input id="qt-title" placeholder="加一件要做的事，回车创建" autocomplete="off">
      <input id="qt-due" class="input tq-date" type="date" value="${esc(S.today || '')}" title="截止日期">
      <button class="btn" data-quick-add>添加</button>
    </div>
    <div class="assets-bar task-bar">${chips}</div>
    <div class="task-groups">${body}</div>
  </div>`;
}

function bindTasks() {
  $$('[data-task-filter]').forEach(el => el.onclick = () => { S.taskFilter = el.dataset.taskFilter; render(); });
  $$('[data-new-task]').forEach(el => el.onclick = () => newTask());
  const add = async () => {
    const title = ($('#qt-title')?.value || '').trim();
    if (!title) { $('#qt-title')?.focus(); return; }
    try {
      await api('/api/task', { method: 'POST', body: { title, due: $('#qt-due')?.value || '' } });
      await reload(true);
      render();
      toast('任务已添加', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  const q = $('#qt-title');
  if (q) q.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  $$('[data-quick-add]').forEach(b => b.onclick = add);
  bindTaskRows();
}

/* ------------------------------------------------------------ 时间 */
function viewTimeline() {
  const ym = S.tlMonth || (S.today || ymd(new Date())).slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;
  const start = addDays(first, -lead);
  const today = S.today || ymd(new Date());
  if (!S.tlDay) S.tlDay = today;
  const ideaMap = {}, taskMap = {};
  (S.ideas || []).forEach(i => {
    const d = ideaDay(i);
    if (d) (ideaMap[d] = ideaMap[d] || []).push(i);
  });
  (S.tasks || []).forEach(t => {
    if (t.due) (taskMap[t.due] = taskMap[t.due] || []).push(t);
  });
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const key = ymd(d);
    const inMonth = d.getMonth() === m - 1;
    const ideas = ideaMap[key] || [];
    const tasks = (taskMap[key] || []).filter(t => t.status !== 'done');
    const shown = tasks.slice(0, 1);
    cells += `<div class="tl-cell ${inMonth ? '' : 'out'} ${key === today ? 'today' : ''} ${key === S.tlDay ? 'sel' : ''}" data-tl-day="${key}">
      <div class="tl-top"><span class="tl-num">${d.getDate()}</span>
        <span class="tl-marks">${ideas.length ? `<span class="tl-mark idea" title="${ideas.length} 条想法">${ideas.length}</span>` : ''}${tasks.length ? `<span class="tl-mark task" title="${tasks.length} 个任务">${tasks.length}</span>` : ''}</span></div>
      <div class="tl-chips">${shown.map(t => `<span class="tl-chip s-${t.status || 'todo'}" data-tl-task="${esc(t.path)}" title="${esc(t.title)}">${esc(t.title)}</span>`).join('')}${tasks.length > 1 ? `<span class="tl-more">+${tasks.length - 1}</span>` : ''}</div>
    </div>`;
  }
  const day = S.tlDay || today;
  const dayIdeas = ideaMap[day] || [];
  const dayTasks = (taskMap[day] || []).slice();
  const dayTasksHtml = dayTasks.length ? dayTasks.map(taskRow).join('') : '<div class="tl-none">这一天没有安排任务</div>';
  const dayIdeasHtml = dayIdeas.length ? dayIdeas.map(i => `<div class="tl-idea-row" data-tl-idea="${esc(i.path)}"><span class="tl-idot"></span><span class="tl-it">${esc(i.title)}</span><span class="tl-im">${esc((i.meta && i.meta.created) ? String(i.meta.created).slice(11, 16) : '')}</span></div>`).join('') : '<div class="tl-none">这一天没有记录想法</div>';
  const up = [];
  for (let i = 0; i < 14; i++) {
    const k = ymd(addDays(new Date(today + 'T00:00:00'), i));
    const ts = (taskMap[k] || []).filter(t => t.status !== 'done');
    if (ts.length) up.push(`<div class="tl-up-row"><span class="tl-up-day">${i === 0 ? '今天' : i === 1 ? '明天' : k.slice(5)}</span><span class="tl-up-t">${ts.map(t => `<a data-tl-task="${esc(t.path)}">${esc(t.title)}</a>`).join('')}</span></div>`);
  }
  const actions = `<div class="tl-nav"><button class="ta-btn" data-tl-month="-1" title="上个月">‹</button><button class="ta-btn" data-tl-month="0" title="回到今天">今天</button><button class="ta-btn" data-tl-month="1" title="下个月">›</button></div>`;
  return `<div class="wrap">
    ${pageHead('TIME', '时间', '想法在什么时候发生，任务落在哪一天。', actions)}
    <div class="tl-layout">
      <section class="tl-month card">
        <div class="tl-month-head"><b>${y} 年 ${m} 月</b><span class="tl-hint">点击某一天看当天的想法与任务</span></div>
        <div class="tl-week">${['一', '二', '三', '四', '五', '六', '日'].map(d => `<span>${d}</span>`).join('')}</div>
        <div class="tl-grid">${cells}</div>
      </section>
      <aside class="tl-side">
        <section class="card tl-day-card">
          <div class="tl-side-head"><b>${esc(day)}</b><button class="btn ghost sm" data-tl-new="${esc(day)}">${ICON.plus} 任务</button></div>
          <div class="tl-side-sec"><div class="tl-label">想法 ${dayIdeas.length}</div>${dayIdeasHtml}</div>
          <div class="tl-side-sec"><div class="tl-label">任务 ${dayTasks.length}</div>${dayTasksHtml}</div>
        </section>
        <section class="card tl-up">
          <div class="tl-side-head"><b>接下来 14 天</b></div>
          ${up.length ? up.join('') : '<div class="tl-none">没有排期</div>'}
        </section>
      </aside>
    </div>
  </div>`;
}

function bindTimeline() {
  $$('[data-tl-day]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-tl-task]')) return;
    S.tlDay = el.dataset.tlDay;
    render();
  });
  $$('[data-tl-task]').forEach(el => el.onclick = e => { e.stopPropagation(); openTask(el.dataset.tlTask); });
  $$('[data-tl-idea]').forEach(el => el.onclick = () => openIdea(el.dataset.tlIdea));
  $$('[data-tl-new]').forEach(el => el.onclick = () => newTask(el.dataset.tlNew));
  $$('[data-tl-month]').forEach(el => el.onclick = () => {
    const step = Number(el.dataset.tlMonth);
    if (step === 0) { const t = new Date(); S.tlMonth = ymd(t).slice(0, 7); S.tlDay = ymd(t); render(); return; }
    const [y, m] = (S.tlMonth || (S.today || ymd(new Date())).slice(0, 7)).split('-').map(Number);
    const d = new Date(y, m - 1 + step, 1);
    S.tlMonth = ymd(d).slice(0, 7);
    render();
  });
}

/* ------------------------------------------------------------ 画布 */
/* v13：按屏幕像素 1:1 绘制的节点编辑器。图不再塞进固定 viewBox 里整体缩放，
   文字始终是真实像素；缩放只改变 transform。 */
const CV_CARD_W = 208;
const CV_CARD_H = 56;
const CV_K_MIN = 0.18;
const CV_K_MAX = 2.2;
const CV_TYPE_ORDER = { task: 0, idea: 1, note: 2 };

function cvShort(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function cvBuild() {
  const nodes = [], byPath = new Map(), byId = new Map(), byTitle = new Map();
  const add = (type, path, title, sub, extra) => {
    if (!path || byPath.has(path)) return byPath.get(path);
    const node = { id: type[0] + ':' + path, type, path, title: title || '(无标题)', sub: sub || '', deg: 0, extra: extra || {}, w: CV_CARD_W, h: CV_CARD_H };
    nodes.push(node);
    byPath.set(path, node);
    byId.set(node.id, node);
    byTitle.set(String(node.title).toLowerCase(), node);
    return node;
  };
  (S.ideas || []).forEach(i => add('idea', i.path, i.title, '想法 · ' + statusLabel(i.status), { status: i.status, tags: i.tags || [] }));
  (S.tasks || []).forEach(t => add('task', t.path, t.title, '任务 · ' + (t.due || '没定日期'), { status: t.status, due: t.due, tags: t.tags || [] }));
  (S.notes || []).forEach(n => {
    if (n.kind === 'idea' || n.kind === 'task') return;
    const folder = String(n.folder || '').split('/').filter(Boolean).pop() || '根目录';
    add('note', n.path, n.title, '笔记 · ' + folder, { tags: n.tags || [] });
  });
  const edges = [], seen = new Set(), counts = { task: 0, wiki: 0, tag: 0, manual: 0 };
  const link = (a, b, kind) => {
    if (!a || !b || a === b) return;
    const k = kind + ':' + a.id + '>' + b.id;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ a: a.id, b: b.id, kind });
    counts[kind]++;
    a.deg++; b.deg++;
  };
  (S.tasks || []).forEach(t => { if (t.source) link(byPath.get(t.path), byPath.get(t.source), 'task'); });
  (S.notes || []).forEach(n => {
    const from = byPath.get(n.path);
    if (!from) return;
    (n.links || []).forEach(l => link(from, byTitle.get(String(l).toLowerCase()), 'wiki'));
  });
  // 同标签：每个标签以第一个节点为星心，避免两两连成毛线团
  const byTag = new Map();
  nodes.forEach(n => (n.extra.tags || []).forEach(t => {
    const tag = String(t).trim();
    if (!tag) return;
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag).push(n);
  }));
  let tagEdges = 0;
  Array.from(byTag.entries()).sort((a, b) => b[1].length - a[1].length).forEach(([, list]) => {
    if (list.length < 2 || list.length > 24 || tagEdges >= 220) return;
    for (let i = 1; i < list.length && tagEdges < 220; i++) { link(list[0], list[i], 'tag'); tagEdges++; }
  });
  // 手动连线
  (S.cv.manual || []).forEach((l, i) => {
    const a = byId.get(l.a), b = byId.get(l.b);
    if (!a || !b || a === b) return;
    a.deg++; b.deg++;
    edges.push({ a: a.id, b: b.id, kind: 'manual', mi: i });
    counts.manual++;
  });
  nodes.forEach((n, i) => { n.i = i; });
  return { nodes, edges, counts };
}

/* 网格排布：任务 → 想法 → 笔记 三类各自成片，列宽统一 */
function cvLayout(nodes) {
  const list = nodes.slice().sort((a, b) =>
    (CV_TYPE_ORDER[a.type] - CV_TYPE_ORDER[b.type]) || (b.deg - a.deg) || String(a.title).localeCompare(String(b.title), 'zh'));
  if (!list.length) return;
  const gapX = 30, gapY = 24;
  const { w: vw, h: vh } = cvSize();
  const { w: cw, h: ch } = { w: CV_CARD_W + gapX, h: CV_CARD_H + gapY };
  const cols = Math.max(2, Math.min(12, Math.round(Math.sqrt(list.length * ch * vw / (cw * Math.max(1, vh))))));
  list.forEach((node, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    node.x = 40 + CV_CARD_W / 2 + c * (CV_CARD_W + gapX);
    node.y = 40 + CV_CARD_H / 2 + r * (CV_CARD_H + gapY);
  });
}

function cvSize() {
  const svg = $('#cv-svg');
  return { w: (svg && svg.clientWidth) || 1100, h: (svg && svg.clientHeight) || 600 };
}

function cvTransform() {
  return `translate(${S.cv.x.toFixed(2)},${S.cv.y.toFixed(2)}) scale(${S.cv.k.toFixed(4)})`;
}

function cvVisible(f) {
  const mode = f || S.cv.filter || 'related';
  const all = (S.cvGraph && S.cvGraph.nodes) || [];
  return all.filter(node => {
    if (mode === 'all') return true;
    if (mode === 'related') return node.type !== 'note' || node.deg > 0;
    if (mode === 'linked') return node.deg > 0;
    if (mode === 'note') return node.type === 'note' && node.deg > 0;
    return node.type === mode;
  });
}

function cvFit(minK) {
  const nodes = cvVisible();
  const { w: vw, h: vh } = cvSize();
  if (!nodes.length) { S.cv.k = 1; S.cv.x = 0; S.cv.y = 0; return; }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    minX = Math.min(minX, n.x - n.w / 2); maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2); maxY = Math.max(maxY, n.y + n.h / 2);
  });
  const pad = 48;
  const k0 = Math.min((vw - pad * 2) / Math.max(1, maxX - minX), (vh - pad * 2) / Math.max(1, maxY - minY));
  S.cv.k = Math.max(minK == null ? 0.3 : minK, Math.min(1.12, k0));
  S.cv.x = vw / 2 - S.cv.k * ((minX + maxX) / 2);
  S.cv.y = vh / 2 - S.cv.k * ((minY + maxY) / 2);
}

/* reflow：重排网格。keep=1 时保持当前缩放，只把视野挪到新布局中间 */
function cvReflow(keep) {
  const vis = cvVisible();
  cvLayout(vis);
  // 用户拖过的位置优先，切筛选/回来时不会被网格覆盖
  vis.forEach(n => {
    const p = (S.cv.pos || {})[n.id];
    if (p && isFinite(p.x) && isFinite(p.y)) { n.x = p.x; n.y = p.y; }
  });
  if (keep && vis.length) {
    const { w: vw, h: vh } = cvSize();
    let cx = 0, cy = 0;
    vis.forEach(n => { cx += n.x; cy += n.y; });
    S.cv.x = vw / 2 - S.cv.k * (cx / vis.length);
    S.cv.y = vh / 2 - S.cv.k * (cy / vis.length);
  } else {
    cvHome();
  }
  cvDraw();
}

/* 打开时按 100% 显示，视野落在连得最多的那张卡片上，字始终清楚 */
function cvHome() {
  // 首屏尽量整图，但不小于 80%，保证卡片标题仍然清楚
  cvFit(0.8);
}

function cvApply() {
  const g = $('#cv-view');
  if (g) g.setAttribute('transform', cvTransform());
  cvHud();
}

function cvHud() {
  const z = $('#cv-zoom');
  if (z) z.textContent = Math.round(S.cv.k * 100) + '%';
}

/* 两个卡片端口之间的三次贝塞尔：按相对位置选边，线不会绕回头 */
function cvPath(a, b) {
  const dir = b.x >= a.x ? 1 : -1;
  const sx = a.x + dir * a.w / 2, sy = a.y;
  const tx = b.x - dir * b.w / 2, ty = b.y;
  const dx = Math.max(34, Math.abs(tx - sx) * 0.5);
  return `M${sx.toFixed(1)},${sy.toFixed(1)} C${(sx + dir * dx).toFixed(1)},${sy.toFixed(1)} ${(tx - dir * dx).toFixed(1)},${ty.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}`;
}

/* 拉线时的临时曲线：从卡片端口到鼠标 */
function cvWirePath(a, p) {
  const dir = p.x >= a.x ? 1 : -1;
  const sx = a.x + dir * a.w / 2, sy = a.y;
  const dx = Math.max(34, Math.abs(p.x - sx) * 0.5);
  return `M${sx.toFixed(1)},${sy.toFixed(1)} C${(sx + dir * dx).toFixed(1)},${sy.toFixed(1)} ${(p.x - dir * dx).toFixed(1)},${p.y.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
}

function cvDraw() {
  const svg = $('#cv-svg');
  if (!svg || !S.cvGraph) return;
  const vis = cvVisible();
  const ids = new Set(vis.map(n => n.id));
  const rel = (S.cv.rel = S.cv.rel || { task: true, wiki: true, tag: false, manual: true });
  const byId = new Map(S.cvGraph.nodes.map(n => [n.id, n]));
  const edges = S.cvGraph.edges.filter(e => ids.has(e.a) && ids.has(e.b) && rel[e.kind] !== false);
  const es = edges.map(e => {
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b) return '';
    const d = cvPath(a, b);
    const meta = `data-ai="${a.i}" data-bi="${b.i}"`;
    if (e.kind === 'manual') {
      const sel = S.cv.selEdge === e.mi ? ' sel' : '';
      return `<path class="cv-edge k-manual${sel}" ${meta} data-mi="${e.mi}" d="${d}"></path><path class="cv-edge-hit" ${meta} data-mi="${e.mi}" d="${d}"></path>`;
    }
    return `<path class="cv-edge k-${e.kind}" ${meta} d="${d}"></path>`;
  }).join('');
  const ns = vis.map(node => {
    const w = node.w, h = node.h, hub = node.deg >= 8;
    return `<g class="cv-node cv-${node.type}${hub ? ' hub' : ''}" data-i="${node.i}" data-node="${esc(node.id)}" data-title="${esc(String(node.title).toLowerCase())}" transform="translate(${node.x.toFixed(1)},${node.y.toFixed(1)})">
      <title>${esc(node.title)}${node.sub ? ' · ' + esc(node.sub) : ''}</title>
      <rect class="cv-card" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="7"></rect>
      <rect class="cv-bar" x="${-w / 2 + 1}" y="${-h / 2 + 11}" width="2.5" height="${h - 22}" rx="1.25"></rect>
      <text class="cv-title" x="${-w / 2 + 15}" y="-3">${esc(cvShort(node.title, 12))}</text>
      <text class="cv-sub" x="${-w / 2 + 15}" y="16">${esc(cvShort(node.sub, 17))}</text>
      <circle class="cv-port" cx="${-w / 2}" cy="0" r="4.5"></circle>
      <circle class="cv-port" cx="${w / 2}" cy="0" r="4.5"></circle>
      <circle class="cv-port-hit" cx="${-w / 2}" cy="0" r="14" data-port="in"></circle>
      <circle class="cv-port-hit" cx="${w / 2}" cy="0" r="14" data-port="out"></circle>
    </g>`;
  }).join('');
  svg.innerHTML = `<defs>
      <pattern id="cv-dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="1.3" cy="1.3" r="1.3"></circle></pattern>
    </defs>
    <g id="cv-view" transform="${cvTransform()}">
      <rect class="cv-dotfield" x="-10000" y="-10000" width="30000" height="30000" fill="url(#cv-dots)"></rect>
      <g class="cv-edges">${es}</g>
      <g class="cv-nodes">${ns}</g>
      <g class="cv-overlay"></g>
    </g>`;
  const empty = $('#cv-empty');
  if (empty) {
    empty.hidden = vis.length > 0;
    empty.textContent = (S.cvGraph.nodes.length ? '这个筛选下没有卡片' : '这里还没有可以连起来的卡片');
  }
  cvHud();
  cvStat();
  if (S.cv.selEdge != null) cvDelMark();
}

function cvStat() {
  const el = $('#cv-stat');
  if (!el) return;
  const vis = cvVisible();
  const ids = new Set(vis.map(n => n.id));
  const rel = S.cv.rel || {};
  const n = (S.cvGraph.edges || []).filter(e => ids.has(e.a) && ids.has(e.b) && rel[e.kind] !== false).length;
  el.textContent = `${vis.length} 张卡片 · ${n} 条连线`;
}

/* 选中的手动线中点放一个 × 按钮，比只记得按 Delete 好找 */
function cvDelMark() {
  const ov = $('#cv-view .cv-overlay');
  if (!ov) { return; }
  ov.innerHTML = '';
  const e = (S.cv.manual || [])[S.cv.selEdge];
  if (!e) return;
  const a = S.cvGraph.nodes.find(n => n.id === e.a), b = S.cvGraph.nodes.find(n => n.id === e.b);
  if (!a || !b) return;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - 16;
  ov.innerHTML = `<g class="cv-del" data-mi="${S.cv.selEdge}" transform="translate(${mx.toFixed(1)},${my.toFixed(1)})">
    <circle r="9.5"></circle><path d="M-3.2,-3.2 L3.2,3.2 M3.2,-3.2 L-3.2,3.2"></path></g>`;
}

/* 拖卡片时只挪这一张和它相关的线，不整图重建 */
function cvPatchNode(node) {
  const svg = $('#cv-svg');
  if (!svg) return;
  const g = svg.querySelector(`.cv-node[data-i="${node.i}"]`);
  if (g) g.setAttribute('transform', `translate(${node.x.toFixed(1)},${node.y.toFixed(1)})`);
  const byId = new Map(S.cvGraph.nodes.map(n => [n.id, n]));
  svg.querySelectorAll(`path[data-ai="${node.i}"], path[data-bi="${node.i}"]`).forEach(p => {
    const a = byId.get(S.cvGraph.nodes[+p.dataset.ai]?.id), b = byId.get(S.cvGraph.nodes[+p.dataset.bi]?.id);
    if (a && b) p.setAttribute('d', cvPath(a, b));
  });
  const ov = svg.querySelector('.cv-overlay');
  if (ov) ov.innerHTML = '';
}

/* 悬停卡片时，只有它的线保持高亮 */
function cvFocus(node) {
  const svg = $('#cv-svg');
  if (!svg) return;
  svg.querySelectorAll('path.cv-edge').forEach(p => {
    const on = !!node && (+p.dataset.ai === node.i || +p.dataset.bi === node.i);
    p.classList.toggle('lit', on);
    p.classList.toggle('mute', !!node && !on);
  });
}

let cvSaveTimer = null;
function saveCanvas() {
  clearTimeout(cvSaveTimer);
  cvSaveTimer = setTimeout(() => {
    const ids = new Set((((S.cvGraph || {}).nodes) || []).map(n => n.id));
    S.cv.manual = (S.cv.manual || []).filter(l => ids.has(l.a) && ids.has(l.b));
    api('/api/canvas', { method: 'PUT', body: { links: S.cv.manual, positions: S.cv.pos || {} } })
      .catch(() => toast('画布保存失败，稍后重试', 'err'));
  }, 400);
}

function removeManual(i) {
  if (i == null || !(S.cv.manual || [])[i]) return;
  S.cv.manual.splice(i, 1);
  S.cv.selEdge = null;
  S.cvGraph = cvBuild();
  cvReflow();
  saveCanvas();
  toast('连线已删除', 'ok');
}

function viewCanvas() {
  const rel = (S.cv && S.cv.rel) || { task: true, wiki: true, tag: false, manual: true };
  const relDefs = [['task', '任务来源', '#c8963a'], ['wiki', '双链', '#6e8bb5'], ['tag', '同标签', '#9a7fc0'], ['manual', '手动', '#4fae9e']];
  return `<div class="wrap">
    ${pageHead('CANVAS', '画布', '一张卡片一件事。拖动摆位置，从卡片两侧的圆点拉线连接。', `<button class="btn ghost" data-cv-tidy>整理卡片</button>`)}
    <div class="cv-toolbar">
      <label class="cv-search">${ICON.search}<input id="cv-q" placeholder="搜索卡片…" autocomplete="off"></label>
      <div class="cv-filters">
        ${[['related', '相关'], ['idea', '想法'], ['task', '任务'], ['note', '笔记'], ['all', '全部']].map(([k, l]) => `<button class="chip ${(S.cv.filter || 'related') === k ? 'on' : ''}" data-cv-filter="${k}">${l}</button>`).join('')}
      </div>
      <span class="cv-stat" id="cv-stat"></span>
    </div>
    <div class="cv-rels">
      <span class="cv-rels-lbl">关系</span>
      ${relDefs.map(([k, l, c]) => `<button class="chip rel ${rel[k] !== false ? 'on' : ''}" data-cv-rel="${k}" style="--rc:${c}"><i></i>${l}<em data-cv-count="${k}">0</em></button>`).join('')}
      <span class="cv-rels-hint">点亮哪类就画哪类线</span>
    </div>
    <div class="cv-stage">
      <svg id="cv-svg"></svg>
      <div class="cv-empty" id="cv-empty" hidden>这里还没有可以连起来的卡片</div>
      <div class="cv-hud">
        <button data-cv-zoom="out" title="缩小">−</button>
        <span id="cv-zoom">100%</span>
        <button data-cv-zoom="in" title="放大">+</button>
        <button data-cv-zoom="fit" title="适配视图">适配</button>
      </div>
    </div>
  </div>`;
}

function bindCanvas() {
  S.cvGraph = cvBuild();
  S.cv.rel = Object.assign({ task: true, wiki: true, tag: false, manual: true }, S.cv.rel || {});
  S.cv.selEdge = null;
  const refreshCounts = () => {
    const counts = S.cvGraph.counts || {};
    $$('[data-cv-count]').forEach(el => el.textContent = counts[el.dataset.cvCount] || 0);
  };
  cvReflow();
  refreshCounts();
  const svg = $('#cv-svg');
  if (!svg) return;
  const rebuild = () => { S.cvGraph = cvBuild(); refreshCounts(); cvReflow(); };
  const point = e => {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left - S.cv.x) / S.cv.k, y: (e.clientY - r.top - S.cv.y) / S.cv.k };
  };
  const nodeAt = el => {
    const g = el && el.closest ? el.closest('.cv-node') : null;
    return g ? S.cvGraph.nodes.find(n => n.id === g.dataset.node) : null;
  };
  let drag = null, wire = null, hoverId = null;

  svg.addEventListener('pointerdown', e => {
    const del = e.target.closest('.cv-del');
    if (del) { removeManual(+del.dataset.mi); e.preventDefault(); return; }
    const port = e.target.closest('.cv-port-hit');
    if (port) {
      const node = nodeAt(port);
      if (!node) return;
      wire = { from: node };
      const p = point(e);
      $('#cv-view .cv-overlay')?.insertAdjacentHTML('beforeend', `<path id="cv-wire" class="cv-wire" d="${cvWirePath(node, p)}"></path>`);
      try { svg.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
      return;
    }
    const node = nodeAt(e.target);
    if (node) {
      const p = point(e);
      drag = { node, dx: p.x - node.x, dy: p.y - node.y, moved: false };
      try { svg.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault();
      return;
    }
    const hit = e.target.closest('.cv-edge-hit');
    if (hit) {
      S.cv.selEdge = +hit.dataset.mi;
      cvDraw();
      e.preventDefault();
      return;
    }
    S.cv.selEdge = null;
    drag = { pan: true, x: e.clientX, y: e.clientY, ox: S.cv.x, oy: S.cv.y };
    try { svg.setPointerCapture(e.pointerId); } catch {}
    svg.classList.add('panning');
  });

  svg.addEventListener('pointermove', e => {
    if (wire) {
      const p = point(e);
      const w = $('#cv-wire');
      if (w) w.setAttribute('d', cvWirePath(wire.from, p));
      const over = nodeAt(document.elementFromPoint(e.clientX, e.clientY));
      $$('#cv-svg .cv-node').forEach(g => g.classList.toggle('drop', !!over && g.dataset.node === over.id && over !== wire.from));
      return;
    }
    if (drag && drag.pan) {
      S.cv.x = drag.ox + (e.clientX - drag.x);
      S.cv.y = drag.oy + (e.clientY - drag.y);
      cvApply();
      return;
    }
    if (drag && drag.node) {
      const p = point(e);
      const nx = p.x - drag.dx, ny = p.y - drag.dy;
      if (Math.abs(nx - drag.node.x) + Math.abs(ny - drag.node.y) > 1.5) {
        drag.moved = true;
        drag.node.x = nx; drag.node.y = ny;
        S.cv.pos[drag.node.id] = { x: Math.round(nx), y: Math.round(ny) };
        cvPatchNode(drag.node);
      }
      return;
    }
    const node = nodeAt(e.target);
    const id = node ? node.id : null;
    if (id !== hoverId) {
      hoverId = id;
      cvFocus(node);
      svg.classList.toggle('over-node', !!node);
    }
  });

  svg.addEventListener('pointerup', e => {
    if (wire) {
      const target = nodeAt(document.elementFromPoint(e.clientX, e.clientY));
      if (target && target !== wire.from) {
        const exists = (S.cv.manual || []).some(l => (l.a === wire.from.id && l.b === target.id) || (l.a === target.id && l.b === wire.from.id));
        if (exists) toast('这两张卡片已经连着了', 'ok');
        else {
          S.cv.manual.push({ a: wire.from.id, b: target.id, kind: 'manual' });
          rebuild();
          saveCanvas();
          toast('已连起来 · 点线可删除', 'ok');
        }
      }
      wire = null;
      $('#cv-wire')?.remove();
      $$('#cv-svg .cv-node.drop').forEach(g => g.classList.remove('drop'));
      return;
    }
    if (drag && drag.node) {
      const node = drag.node;
      const moved = drag.moved;
      drag = null;
      if (moved) {
        saveCanvas();
        cvDelMark();
      } else if (node.type === 'task') openTask(node.path);
      else if (node.type === 'idea') openIdea(node.path);
      else openNote(node.path);
      return;
    }
    drag = null;
    svg.classList.remove('panning');
  });

  const cancel = () => {
    drag = null; wire = null;
    $('#cv-wire')?.remove();
    svg.classList.remove('panning');
    $$('#cv-svg .cv-node.drop').forEach(g => g.classList.remove('drop'));
  };
  svg.addEventListener('pointercancel', cancel);
  svg.addEventListener('pointerleave', () => { hoverId = null; cvFocus(null); svg.classList.remove('over-node'); });

  svg.addEventListener('dblclick', e => {
    const hit = e.target.closest('.cv-edge-hit');
    if (hit) { e.preventDefault(); removeManual(+hit.dataset.mi); return; }
    if (!nodeAt(e.target)) { cvFit(); cvApply(); }
  });

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k2 = Math.min(CV_K_MAX, Math.max(CV_K_MIN, S.cv.k * (e.deltaY < 0 ? 1.1 : 0.91)));
    S.cv.x = mx - (mx - S.cv.x) * (k2 / S.cv.k);
    S.cv.y = my - (my - S.cv.y) * (k2 / S.cv.k);
    S.cv.k = k2;
    cvApply();
  }, { passive: false });

  svg.onclick = e => {
    if (nodeAt(e.target) || e.target.closest('.cv-edge-hit') || e.target.closest('.cv-del')) return;
    if (S.cv.selEdge != null) { S.cv.selEdge = null; cvDraw(); }
  };

  $$('[data-cv-filter]').forEach(el => el.onclick = () => {
    S.cv.filter = el.dataset.cvFilter;
    $$('[data-cv-filter]').forEach(x => x.classList.toggle('on', x === el));
    cvReflow();
  });
  $$('[data-cv-rel]').forEach(el => el.onclick = () => {
    const k = el.dataset.cvRel;
    S.cv.rel[k] = !(S.cv.rel[k] !== false);
    el.classList.toggle('on', S.cv.rel[k] !== false);
    cvDraw();
  });
  $$('[data-cv-zoom]').forEach(el => el.onclick = () => {
    const mode = el.dataset.cvZoom;
    if (mode === 'fit') { cvFit(); cvApply(); return; }
    const { w, h } = cvSize();
    const k2 = Math.min(CV_K_MAX, Math.max(CV_K_MIN, S.cv.k * (mode === 'in' ? 1.25 : 0.8)));
    S.cv.x = w / 2 - (w / 2 - S.cv.x) * (k2 / S.cv.k);
    S.cv.y = h / 2 - (h / 2 - S.cv.y) * (k2 / S.cv.k);
    S.cv.k = k2;
    cvApply();
  });
  $$('[data-cv-tidy]').forEach(el => el.onclick = () => {
    S.cv.pos = {};
    cvReflow();
    saveCanvas();
    toast('卡片已重新排好', 'ok');
  });
  const q = $('#cv-q');
  if (q) q.oninput = () => {
    const v = q.value.trim().toLowerCase();
    $$('#cv-svg .cv-node').forEach(g => {
      const hit = !v || (g.dataset.title || '').includes(v) || (g.textContent || '').toLowerCase().includes(v);
      g.classList.toggle('hit', !!v && hit);
      g.classList.toggle('dim', !!v && !hit);
    });
  };
  if (!bindCanvas._keys) {
    bindCanvas._keys = true;
    document.addEventListener('keydown', e => {
      if (S.view !== 'canvas' || S.cv.selEdge == null) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeManual(S.cv.selEdge);
      }
    });
  }
}

async function openTask(path) {
  return transitionDrawer(async () => {
    const note = await api('/api/note?path=' + encodeURIComponent(path) + '&fresh=1');
    activeEditor = null;
    S.drawer = { kind: 'task', path, note };
    $('#drawer-tabs').innerHTML = `<span class="pill task">任务</span>
      <span class="drawer-sub">自动保存</span>`;
    $('#drawer-actions').innerHTML = `
      <button class="btn ghost" id="t-plan" title="拆分执行计划">拆分计划</button>
      <button class="btn ghost" id="t-done" title="标记完成">${ICON.check}</button>
      <button class="btn ghost danger" id="t-del" title="删除任务">${ICON.trash}</button>
      <button class="btn ghost" id="t-close">${ICON.x}</button>`;
    openDrawer(`
      <input class="input title-input" id="t-title" value="${esc(note.title)}" placeholder="任务标题">
      <div class="row" style="margin:14px 0;gap:12px">
        <div><label>状态</label>
          <select class="select" id="t-status">${['todo', 'doing', 'done'].map(s => `<option value="${s}" ${(note.meta?.status || 'todo') === s ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}</select></div>
        <div><label>优先级</label>
          <select class="select" id="t-priority">${[['high', '重要'], ['mid', '普通'], ['low', '有空再说']].map(([v, l]) => `<option value="${v}" ${(note.meta?.priority || 'mid') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div><label>截止日期</label><input class="input" type="date" id="t-due" value="${esc(note.meta?.due || '')}"></div>
      </div>
      <div class="field"><label>说明（Markdown，自动保存）</label>
        <textarea class="area" id="t-body" placeholder="补充背景、下一步，或验收标准…" style="min-height:280px">${esc(note.body)}</textarea></div>
      ${note.meta?.source ? `<div class="task-src">来源想法：<a data-src="${esc(note.meta.source)}">${esc(String(note.meta.source).split('/').pop().replace(/\.md$/, ''))}</a></div>` : ''}
      <div><span class="saved" id="t-saved">已保存</span></div>`);
    const editor = { pending: null, busy: 0, error: null, queue: Promise.resolve(), timer: null };
    const payload = () => ({
      path,
      title: $('#t-title').value,
      status: $('#t-status').value,
      priority: $('#t-priority').value,
      due: $('#t-due').value,
      body: $('#t-body').value,
    });
    editor.flush = () => {
      clearTimeout(editor.timer);
      const snapshot = editor.pending;
      if (!snapshot) return editor.queue;
      editor.pending = null; editor.busy++;
      editor.queue = editor.queue.catch(() => {}).then(async () => {
        try {
          await api('/api/task', { method: 'PUT', body: snapshot });
          editor.error = null;
          if (activeEditor === editor) $('#t-saved').textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
          await reload(true);
        } catch (e) {
          editor.error = e;
          if (!editor.pending) editor.pending = snapshot;
          toast('任务保存失败：' + e.message, 'err');
        } finally { editor.busy--; }
      });
      return editor.queue;
    };
    activeEditor = editor;
    const doSave = () => { editor.pending = payload(); return editor.flush(); };
    const schedule = () => { editor.pending = payload(); clearTimeout(editor.timer); editor.timer = setTimeout(editor.flush, 700); };
    ['t-title', 't-body'].forEach(id => $('#' + id).oninput = schedule);
    ['t-status', 't-priority', 't-due'].forEach(id => $('#' + id).onchange = doSave);
    $('#t-close').onclick = () => closeDrawer();
    $('#t-plan').onclick = async () => { if (await closeDrawer()) await TaskPlanUI.open(path); };
    $('#t-done').onclick = async () => {
      const now = $('#t-status').value;
      $('#t-status').value = now === 'done' ? 'todo' : 'done';
      await doSave();
      toast(now === 'done' ? '已放回待办' : '这件事做完了', 'ok');
    };
    $('#t-del').onclick = async () => {
      if (!await confirm('删除这个任务？文件会移到库里的 .trash/，需要时还能找回。')) return;
      try {
        if (!await transitionDrawer(async () => {
          await api('/api/task?path=' + encodeURIComponent(path), { method: 'DELETE' });
          activeEditor = null;
        })) return;
        await closeDrawer();
        await reload(true);
        render();
        toast('任务已删除', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
    const src = $('[data-src]');
    if (src) src.onclick = async () => { if (await closeDrawer()) openIdea(src.dataset.src); };
  });
}

function newTask(due) {
  $('#modal-box').innerHTML = `<h3>新建任务</h3>
    <div class="field"><label>要做的下一步</label>
      <input class="input" id="nt-title" placeholder="例如：把首页的空白状态补完" autocomplete="off"></div>
    <div class="field"><label>截止日期（可以留空）</label>
      <input class="input" type="date" id="nt-due" value="${esc(due || '')}"></div>
    <div class="row" style="justify-content:flex-end;gap:8px;margin-top:6px">
      <button class="btn ghost" id="nt-cancel">取消</button>
      <button class="btn primary" id="nt-ok">创建</button>
    </div>`;
  $('#modal').classList.add('open');
  $('#modal').setAttribute('aria-hidden', 'false');
  const close = () => { $('#modal').classList.remove('open'); $('#modal').setAttribute('aria-hidden', 'true'); };
  $('#nt-cancel').onclick = close;
  const create = async () => {
    const title = $('#nt-title').value.trim();
    if (!title) { $('#nt-title').focus(); return; }
    try {
      const r = await api('/api/task', { method: 'POST', body: { title, due: $('#nt-due')?.value || '' } });
      close();
      await reload(true);
      render();
      toast('任务已创建', 'ok');
      openTask(r.path);
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#nt-ok').onclick = create;
  $('#nt-title').onkeydown = e => { if (e.key === 'Enter') create(); };
  setTimeout(() => $('#nt-title')?.focus(), 30);
}

function viewNotes() {
  const folders = S.boot?.folders || [];
  const total = folders.reduce((n, f) => n + f.count, 0);
  const tree = [`<div class="f ${S.folder === null || S.folder === '__all' ? 'on' : ''}" data-folder="__all" style="padding-left:10px">${ICON.book}<span class="nm">全部笔记</span><span class="n">${total}</span></div>`]
    .concat(folders.filter(f => f.folder).map(f => {
      const name = f.folder.split('/').filter(Boolean).pop() || f.folder;
      const depth = (f.folder.match(/\//g) || []).length;
      return `
      <div class="f ${S.folder === f.folder ? 'on' : ''}" data-folder="${esc(f.folder)}" title="${esc(f.folder)}" style="padding-left:${10 + depth * 14}px">
        <span class="nm">${esc(name)}</span><span class="n">${f.count}</span></div>`;
    }))
    .join('');
  const notes = S.notes.filter(n => n.kind !== 'task' && (S.folder === null || S.folder === '__all' || n.folder === S.folder));
  const noteOrder = {
    time: (a, b) => (Number(b.mtime) || 0) - (Number(a.mtime) || 0),
    name: (a, b) => a.title.localeCompare(b.title, 'zh'),
  };
  notes.sort(noteOrder[S.noteSort] || noteOrder.time);
  const noteSortBar = [['time', '最近'], ['name', '标题']]
    .map(([k, n]) => `<button data-sort-note="${k}" class="${S.noteSort === k ? 'on' : ''}">${n}</button>`).join('');
  const rows = notes.map(n => `
    <div class="note-row" data-note="${esc(n.path)}">
      <button class="row-del" data-del-note="${esc(n.path)}" title="移到回收站">${ICON.trash}</button>
      <div class="t">${esc(n.title)}${n.kind === 'idea' ? '<span class="pill inbox">想法</span>' : ''}</div>
      <div class="x">${esc(n.excerpt || '')}</div>
      <div class="m"><span>${timeAgo(n.mtime)}</span><span>${n.words} 字</span>
        ${(n.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    </div>`).join('');
  return `<div class="wrap">
    ${pageHead('NOTES / 笔记', '笔记', `${notes.length} 篇 · ${esc(vaultName() || '未连接 Obsidian')}`,
      `<span class="sortbar">${noteSortBar}</span>
       <button class="btn ghost" data-sync>${ICON.refresh} 重新扫描</button>`)}
    <div class="notes-layout">
      <div class="tree">${tree}</div>
      <div class="note-list">${rows || `<div class="empty">${ICON.book}<b>这个文件夹没有笔记</b></div>`}</div>
    </div>
  </div>`;
}

function bindNotes() {
  $$('[data-sort-note]').forEach(el => el.onclick = () => {
    S.noteSort = el.dataset.sortNote;
    saveSort();
    render();
  });
  $$('[data-folder]').forEach(el => el.onclick = () => {
    S.folder = el.dataset.folder === '__all' ? '__all' : el.dataset.folder;
    render();
  });
  bindNoteRows();
  $$('[data-sync]').forEach(el => el.onclick = async () => {
    el.disabled = true;
    try { await api('/api/sync', { method: 'POST' }); await reload(); toast('已同步', 'ok'); }
    finally { el.disabled = false; }
  });
}

async function deleteNoteFlow(path, title) {
  if (!await confirm(`把「${title}」移到库里的 .trash/？\n需要时可以从文件管理器找回。`)) return false;
  try {
    const res = await api('/api/note?path=' + encodeURIComponent(path), { method: 'DELETE' });
    await reload();
    toast(res.trashed ? '已移到 ' + res.trashed : '已删除', 'ok');
    return true;
  } catch (e) { toast(e.message, 'err'); return false; }
}

function bindNoteRows() {
  $$('[data-note]').forEach(el => el.onclick = () => openNote(el.dataset.note));
  $$('[data-del-note]').forEach(el => el.onclick = async e => {
    e.stopPropagation();
    await deleteNoteFlow(el.dataset.delNote, el.closest('.note-row')?.querySelector('.t')?.textContent?.trim() || '这篇笔记');
  });
}

/* ------------------------------------------------------------ 标签 */
function viewTags() {
  const tags = S.tags || [];
  const sel = S.tag;
  const cloud = tags.map(t => `<button class="tag-pill ${sel === t.tag ? 'on' : ''}" data-tag="${esc(t.tag)}">
      <span>${esc(t.tag)}</span><em>${t.count}</em></button>`).join('');
  const list = sel ? (S.allNotes || []).filter(n => (n.tags || []).includes(sel)) : [];
  const rows = list.map(n => `
    <div class="note-row" data-note="${esc(n.path)}">
      <button class="row-del" data-del-note="${esc(n.path)}" title="移到回收站">${ICON.trash}</button>
      <div class="t">${esc(n.title)}${n.kind === 'idea' ? '<span class="pill inbox">想法</span>' : ''}</div>
      <div class="x">${esc(n.excerpt || '')}</div>
      <div class="m"><span>${timeAgo(n.mtime)}</span><span>${n.words} 字</span>
        ${(n.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    </div>`).join('');
  return `<div class="wrap">
    ${pageHead('TAGS / 标签', '标签', `${tags.length} 个标签 · ${(S.allNotes || []).length} 篇笔记`)}
    ${cloud ? `<div class="tag-wall">${cloud}</div>` : `<div class="empty compact">${ICON.book}
      <b>还没有标签</b><p>在想法里写 #标签，这里会自动汇总</p></div>`}
    ${sel ? `<div class="section-title" style="margin-top:24px"><h2>#${esc(sel)}</h2>
        <span class="sub">${list.length} 篇</span>
        <span style="flex:1"></span>
        <button class="btn ghost" data-tag-clear>清除筛选</button></div>
      <div class="note-list">${rows || `<div class="empty compact">${ICON.book}<b>这个标签下没有笔记</b></div>`}</div>`
      : (cloud ? `<div class="empty compact" style="margin-top:24px">${ICON.book}
        <b>选一个标签</b><p>看它下面都有哪些想法和笔记</p></div>` : '')}
  </div>`;
}

function bindTags() {
  $$('[data-tag]').forEach(el => el.onclick = () => {
    const t = el.dataset.tag;
    S.tag = S.tag === t ? null : t;
    go('tags', S.tag || undefined);
  });
  const clear = $('[data-tag-clear]');
  if (clear) clear.onclick = () => { S.tag = null; go('tags'); };
  bindNoteRows();
}

/* ------------------------------------------------------------ AI */
function viewAI() {
  const tab = S.ai.tab;
  const pool = tab === 'notes' ? (S.allNotes || []) : S.assets;
  const q = S.ai.q.toLowerCase();
  const list = pool.filter(x => !q || (x.title || x.name).toLowerCase().includes(q)).slice(0, 300);
  const rows = list.map(x => {
    const key = tab === 'notes' ? x.path : x.path;
    const label = tab === 'notes' ? x.title : x.name;
    const sub = tab === 'notes' ? (x.folder || '根目录') : `${x.cat} · ${x.ext}`;
    return `<label class="pick"><input type="checkbox" data-pick="${esc(key)}" ${S.ai.sel.has(key) ? 'checked' : ''}>
      <span><span class="t">${esc(label)}</span><br><span class="s">${esc(sub)}</span></span></label>`;
  }).join('');
  const modes = [['summarize', '总结'], ['opinion', '提观点'], ['outline', '列大纲'], ['connect', '找关联'], ['expand', '展开'], ['daily', '今日回顾']]
    .map(([k, n]) => `<button class="chip ${S.ai.mode === k ? 'on' : ''}" data-mode="${k}">${n}</button>`).join('');
  const provider = S.boot?.config?.ai?.provider === 'openai' ? 'LLM' : '本地分析';
  return `<div class="wrap">
    ${pageHead('STUDIO / AI', 'AI 整理', '选材料 → 选动作 → 生成',
      `<span class="badge ${provider === 'LLM' ? 'llm' : 'local'}">${provider}</span>`)}
    <div class="ai-layout">
      <div class="picker">
        <div class="picker-head">${ICON.spark}<b>材料</b><span class="badge">已选 ${S.ai.sel.size}</span></div>
        <div class="picker-tabs">
          <button class="chip ${tab === 'notes' ? 'on' : ''}" data-tab="notes">笔记</button>
          <button class="chip ${tab === 'assets' ? 'on' : ''}" data-tab="assets">素材</button>
          <button class="chip" data-today title="选中今天日期的笔记">今天</button>
          <input class="input" id="pick-q" placeholder="筛选…" value="${esc(S.ai.q)}" style="margin-left:auto;width:110px;padding:4px 8px;font-size:12px">
        </div>
        <div class="picker-list">${rows || '<div class="empty" style="padding:24px 8px">没有可选项</div>'}</div>
        <div class="picker-foot"><button class="btn ghost" data-clear>清空</button><span style="margin-left:auto">${S.ai.sel.size} 项</span></div>
      </div>
      <div class="workbench">
        <div class="wb-head"><div class="mode-chips">${modes}</div>
          <span style="margin-left:auto;font-size:11.5px;color:var(--dim-2)" id="wb-meta">${S.ai.meta || ''}</span></div>
        <div class="wb-body">${S.ai.out ? `<div class="output${S.ai.streaming ? ' stream' : ''}">${S.ai.streaming ? esc(S.ai.out) : md(S.ai.out)}</div>` : `
          <div class="wb-empty">${ICON.spark}<b style="color:var(--dim)">左边选材料，上面选动作</b>
            <span>本地分析离线运行；可在设置中切换大模型接口</span></div>`}</div>
        <div class="wb-foot">
          <input class="input" id="ai-extra" placeholder="补充要求（可选）：比如“站在产品经理角度”“只保留可执行的”" value="${esc(S.ai.extra)}">
          <button class="btn primary" data-run ${S.ai.busy ? 'disabled' : ''}>${S.ai.busy ? '<span class="spin"></span> 生成中' : ICON.spark + ' 开始整理'}</button>
          ${S.ai.out ? `<button class="btn" data-save>${ICON.save} 存为笔记</button><button class="btn ghost" data-copy-out>${ICON.copy}</button>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

function bindAI() {
  $$('[data-tab]').forEach(el => el.onclick = () => { S.ai.tab = el.dataset.tab; S.ai.q = ''; render(); });
  $$('[data-pick]').forEach(el => el.onchange = () => {
    const k = el.dataset.pick;
    el.checked ? S.ai.sel.add(k) : S.ai.sel.delete(k);
    render();
  });
  const q = $('#pick-q');
  if (q) q.oninput = () => { S.ai.q = q.value; const v = q.value; render(); const n = $('#pick-q'); n.focus(); n.setSelectionRange(v.length, v.length); };
  $$('[data-mode]').forEach(el => el.onclick = () => { S.ai.mode = el.dataset.mode; render(); });
  $$('[data-today]').forEach(el => el.onclick = () => {
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    (S.allNotes || []).filter(n => n.path.includes(stamp) || n.title.includes(stamp))
      .forEach(n => S.ai.sel.add(n.path));
    S.ai.mode = 'daily';
    render();
  });
  $$('[data-clear]').forEach(el => el.onclick = () => { S.ai.sel.clear(); render(); });
  const extra = $('#ai-extra');
  if (extra) extra.oninput = () => { S.ai.extra = extra.value; };
  $$('[data-run]').forEach(el => el.onclick = runAI);
  $$('[data-save]').forEach(el => el.onclick = saveDigest);
  $$('[data-copy-out]').forEach(el => el.onclick = () => { navigator.clipboard?.writeText(S.ai.out); toast('已复制'); });
}

async function runAI() {
  if (S.ai.busy) return;
  if (!S.ai.sel.size) return toast('先选点材料', 'err');
  if (S.boot?.config?.ai?.provider === 'openai' && !await confirm('即将把选中的笔记正文、素材说明和补充要求发送到你配置的 AI 接口。图片、音视频文件本身不会发送。是否继续？')) return;
  const request = { mode: S.ai.mode, paths: [...S.ai.sel], extra: S.ai.extra };
  const runId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  S.ai.busy = true; S.ai.out = ''; S.ai.meta = ''; S.ai.lastResult = null;
  S.ai.runId = runId; S.ai.streaming = false;
  render();
  const t0 = performance.now();
  try {
    const res = await api('/api/ai', {
      method: 'POST',
      body: { ...request, run_id: runId, stream: true },
    });
    S.ai.out = res.text;
    const secs = Math.max(0.1, (performance.now() - t0) / 1000).toFixed(1);
    S.ai.meta = `${res.model === 'local' ? '本地分析' : res.model} · ${secs}s`;
    S.ai.lastResult = {
      mode: res.mode || request.mode, model: res.model || 'local',
      sources: res.sources || request.paths,
    };
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    S.ai.busy = false;
    S.ai.streaming = false;
    S.ai.runId = '';
    render();
  }
}

async function saveDigest() {
  if (!S.ai.out || S.ai.busy || !S.ai.lastResult) return;
  const title = prompt('笔记标题', '整理 · ' + new Date().toLocaleDateString('zh-CN'));
  if (!title) return;
  const result = { ...S.ai.lastResult, text: S.ai.out };
  try {
    await api('/api/digest', { method: 'POST', body: { title, ...result } });
    await reload();
    toast('已保存到 Obsidian 的整理目录', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

/* ------------------------------------------------------------ 设置 */
const FONT_SIZES = { small: 0.92, normal: 1, large: 1.08 };
function applyUi() {
  const ui = S.boot?.config?.ui || {};
  const z = FONT_SIZES[ui.font_size] || 1;
  document.documentElement.style.zoom = String(z);
  document.body.classList.toggle('dense', ui.density === 'compact');
  document.body.classList.toggle('no-motion', ui.motion === false);
}
const sw = (id, on, label, hint) => `<label class="sw-row"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}>
  <span class="sw"></span><span class="sw-t"><b>${label}</b>${hint ? `<i>${hint}</i>` : ''}</span></label>`;

function viewSettings() {
  const c = S.boot?.config || {};
  const ai = c.ai || {};
  const ui = c.ui || {};
  const b = c.behavior || {};
  const card = (title, desc, inner) => `<div class="card set-card">
      <h3>${title}</h3><p class="hint">${desc}</p>${inner}</div>`;
  return `<div class="wrap" style="max-width:820px">
    ${pageHead('SETTINGS / 设置', '设置', '改完点“保存设置”生效')}

    ${card('目录', 'Obsidian 库是笔记的唯一事实来源；素材库扫描其中的 <code>assets/</code>，上传也存到这里。', `
      <div class="field"><label>Obsidian 库</label>
        <div class="row"><input class="input" id="cfg-vault" value="${esc(c.vault || '')}" placeholder="D:\\你的库">
          <button class="btn" id="btn-vault" style="flex:none">选择</button>
          <button class="btn ghost" id="btn-open-vault" style="flex:none">打开</button></div></div>
      <div class="field"><label>素材库根目录</label>
        <div class="row"><input class="input" id="cfg-library" value="${esc(c.library || '')}" placeholder="包含 assets 子目录的文件夹">
          <button class="btn" id="btn-library" style="flex:none">选择</button>
          <button class="btn ghost" id="btn-open-lib" style="flex:none">打开</button></div>
        <p class="hint" style="margin:8px 0 0">选到 <code>assets</code> 目录本身也没关系，会自动回到上一级；新目录里没有 <code>assets/</code> 时会自动创建。</p></div>
      <div class="row" style="margin-top:4px">
        <button class="btn" id="btn-sync">${ICON.refresh} 重新扫描笔记</button>
        <button class="btn" id="btn-rescan">${ICON.refresh} 重新扫描素材</button>
        <span class="hint" id="sync-info" style="align-self:center">
          ${S.boot?.stats?.total || 0} 篇笔记 · ${(S.assets || []).length} 个素材</span>
      </div>`)}

    ${card('行为', '这些开关保存后立刻生效，不需要重启。', `
      ${sw('cfg-watch', b.watch !== false, '自动刷新', 'Obsidian 里改动文件后，界面自己更新')}
      <div class="field ind"><label>检查间隔（秒）</label>
        <input class="input" id="cfg-watch-interval" type="number" min="2" max="120" value="${b.watch_interval || 5}"></div>
      ${sw('cfg-hotkey-on', b.hotkey_enabled !== false, '全局热键', '在任何程序里都能唤出窗口并记一条想法')}
      <div class="field ind"><label>热键组合</label>
        <input class="input" id="cfg-hotkey" value="${esc(b.hotkey || 'Ctrl+Alt+N')}" placeholder="Ctrl+Alt+N"></div>
      ${sw('cfg-confirm', b.confirm_remote !== false, '发送前确认', '调用大模型接口前先弹确认，避免误发')}
      <div class="field" style="margin-top:12px;max-width:260px"><label>启动后打开</label>
        <select class="select" id="cfg-default-view">
          ${[['home', '首页'], ['ideas', '想法'], ['assets', '素材'], ['notes', '笔记'], ['tags', '标签'], ['ai', 'AI 整理']]
            .map(([v, n]) => `<option value="${v}" ${(ui.default_view || 'home') === v ? 'selected' : ''}>${n}</option>`).join('')}
        </select></div>`)}

    ${card('外观', '只影响界面显示，不改动任何文件。', `
      <div class="row">
        <div class="field"><label>字号</label><select class="select" id="cfg-font">
          ${[['small', '小'], ['normal', '标准'], ['large', '大']]
            .map(([v, n]) => `<option value="${v}" ${(ui.font_size || 'normal') === v ? 'selected' : ''}>${n}</option>`).join('')}
        </select></div>
        <div class="field"><label>密度</label><select class="select" id="cfg-density">
          ${[['comfortable', '舒适'], ['compact', '紧凑']]
            .map(([v, n]) => `<option value="${v}" ${(ui.density || 'comfortable') === v ? 'selected' : ''}>${n}</option>`).join('')}
        </select></div>
      </div>
      <div class="field" style="max-width:260px"><label>主题</label>
        <select class="select" id="cfg-theme">
          <option value="dark" ${currentTheme() === 'dark' ? 'selected' : ''}>深色线框</option>
          <option value="paper" ${currentTheme() === 'paper' ? 'selected' : ''}>纸感浅色</option>
        </select></div>
      ${sw('cfg-motion', ui.motion !== false, '界面动效', '关闭后切换视图不再淡入上移')}`)}

    ${card('AI', '本地分析不联网。使用兼容接口时，选中的文字和素材元数据会发送给服务提供方；启用图片分析后，图片也会被发送。音视频不会转写。API Key 明文保存在本地。', `
      <div class="row" style="margin-bottom:10px">
        <div class="field"><label>模式</label>
          <select class="select" id="cfg-provider">
            <option value="local" ${ai.provider !== 'openai' ? 'selected' : ''}>本地分析（无需联网）</option>
            <option value="openai" ${ai.provider === 'openai' ? 'selected' : ''}>大模型（OpenAI 兼容）</option>
          </select></div>
        <div class="field"><label>模型</label><input class="input" id="cfg-model" value="${esc(ai.model || '')}" placeholder="deepseek-chat"></div>
      </div>
      <div class="field" style="margin-bottom:10px"><label>接口预设</label>
        <select class="select" id="cfg-preset"><option value="">自定义</option><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="ollama">Ollama（本机）</option><option value="lmstudio">LM Studio（本机）</option></select></div>
      <div class="field" style="margin-bottom:10px"><label>接口地址</label>
        <input class="input" id="cfg-base" value="${esc(ai.base_url || '')}" placeholder="https://api.deepseek.com/v1"></div>
      <div class="field" style="margin-bottom:10px"><label>API Key（明文存在本地 config.json）</label>
        <input class="input" id="cfg-key" type="password" value="${esc(ai.api_key || '')}" placeholder="sk-..."></div>
      <div class="row">
        <div class="field"><label>温度（0–2）</label><input class="input" id="cfg-temp" type="number" step="0.1" min="0" max="2" value="${ai.temperature ?? 0.7}"></div>
        <div class="field"><label>最大 tokens</label><input class="input" id="cfg-max" type="number" min="128" max="8192" step="64" value="${ai.max_tokens || 1800}"></div>
      </div>
      <div class="row" style="margin-top:10px">
        <div class="field"><label>每篇最多字符</label><input class="input" id="cfg-per-note" type="number" min="500" max="20000" step="500" value="${ai.per_note_chars || 4000}"></div>
        <div class="field"><label>单次总预算（字符）</label><input class="input" id="cfg-budget" type="number" min="1000" max="60000" step="1000" value="${ai.total_budget || 14000}"></div>
      </div>
      ${sw('cfg-stream', ai.stream !== false, '流式输出', '大模型回复逐字显示；接口不支持时可关掉')}
      ${sw('cfg-vision', ai.vision === true, '发送图片进行视觉分析', '仅发送所选图片；请确认接口和模型支持视觉输入')}
      <div class="field"><label>视觉模型（留空使用上方模型）</label><input class="input" id="cfg-vision-model" value="${esc(ai.vision_model || '')}" placeholder="可选"></div>
      ${sw('cfg-embedding-enabled', ai.embedding_enabled === true, '启用语义检索模型', '仅点击语义搜索或查找相关时调用；不会自动上传内容')}
      <div class="field"><label>Embedding 模型（必须为向量模型）</label><input class="input" id="cfg-embedding-model" value="${esc(ai.embedding_model || '')}" placeholder="例如：nomic-embed-text / text-embedding-3-small"></div>
      <div class="field"><label>Embedding API 地址（留空沿用对话地址）</label><input class="input" id="cfg-embedding-base" value="${esc(ai.embedding_base_url || '')}" placeholder="http://localhost:11434/v1"></div>
      <div class="field"><label>Embedding API Key（独立地址请单独填写）</label><input class="input" type="password" id="cfg-embedding-key" value="${esc(ai.embedding_api_key || '')}" autocomplete="off"><p class="hint">留空仅在接口地址相同时沿用对话密钥。本地模型通常无需密钥。保存后生效。</p></div>
      <div class="field"><label>音频转写模型</label><input class="input" id="cfg-transcription-model" value="${esc(ai.transcription_model || '')}" placeholder="例如：whisper-1"></div>
      <div class="field"><label>转写 API 地址（留空沿用对话地址）</label><input class="input" id="cfg-transcription-base" value="${esc(ai.transcription_base_url || '')}" placeholder="https://api.openai.com/v1"></div>
      <div class="field"><label>转写 API Key</label><input class="input" type="password" id="cfg-transcription-key" value="${esc(ai.transcription_api_key || '')}" autocomplete="off"><p class="hint">独立地址请单独填写密钥。转写会发送完整音频，最多24MiB；视频分析只发送抽样画面。</p></div>
      <div class="field"><label>FFmpeg 可执行文件</label><input class="input" id="cfg-ffmpeg" value="${esc(ai.ffmpeg_path || 'ffmpeg')}" placeholder="ffmpeg 或完整程序路径"><p class="hint">视频抽帧需本机安装 FFmpeg；最多分析0、5、10秒的三帧，不能代替完整观看。</p></div>
      <div class="row" style="margin-top:12px"><button class="btn" id="btn-ai-test">测试连接</button><button class="btn" id="btn-ai-models">获取模型</button></div>
      <div class="field" id="ai-model-picker" hidden><label>可用模型</label><select class="select" id="cfg-model-list"></select></div>
      <p class="hint" id="ai-test-status" role="status"></p>`)}

    ${card('数据', '索引只存在内存里，随时可以重建；素材缓存位于素材库根目录的 <code>.data/assets.json</code>。', `
      <div class="row">
        <button class="btn" id="btn-rebuild">重建笔记索引</button>
        <button class="btn" id="btn-cache">打开素材目录</button>
        <button class="btn ghost" id="btn-config-dir">打开配置目录</button>
      </div>`)}

    <div style="display:flex;gap:10px;align-items:center">
      <button class="btn primary" id="btn-save">保存设置</button>
      <button class="btn ghost" id="btn-defaults">恢复默认</button>
      <button class="btn ghost" id="btn-restart-hint">关于</button>
    </div>
    <p class="hint" style="margin-top:18px">
      灵感坞 ${esc(S.version || '2.13.0')} · 本地运行，数据都在你自己的磁盘上 · 快捷键：Ctrl+K 命令面板 · Ctrl+N 新想法 · ? 速查</p>
  </div>`;
}

function bindSettings() {
  const pick = async id => {
    try {
      const path = await invoke('pick_vault');
      if (path) $(id).value = path;
    } catch (e) { toast('选择目录失败：' + e, 'err'); }
  };
  $('#btn-vault').onclick = () => pick('#cfg-vault');
  $('#btn-library').onclick = () => pick('#cfg-library');
  const openDir = async (el, fallback) => {
    const p = ($(el)?.value || fallback || '').trim();
    if (!p) return toast('还没有选择目录', 'err');
    try { await invoke('open_folder', { path: p }); } catch (e) { toast('打不开：' + e, 'err'); }
  };
  $('#btn-open-vault').onclick = () => openDir('#cfg-vault');
  $('#btn-open-lib').onclick = () => openDir('#cfg-library');
  const themeSel = $('#cfg-theme');
  if (themeSel) themeSel.onchange = () => applyTheme(themeSel.value);
  const presetValues = {
    deepseek: { base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    ollama: { base: 'http://localhost:11434/v1', model: 'llama3.2' },
    lmstudio: { base: 'http://localhost:1234/v1', model: 'local-model' },
  };
  $('#cfg-preset')?.addEventListener('change', e => {
    const p = presetValues[e.target.value];
    if (!p) return;
    $('#cfg-provider').value = 'openai';
    $('#cfg-base').value = p.base;
    $('#cfg-model').value = p.model;
  });
  const aiDraft = () => ({
    provider: $('#cfg-provider').value,
    model: $('#cfg-model').value.trim(),
    base_url: $('#cfg-base').value.trim(),
    api_key: $('#cfg-key').value.trim(),
    vision: $('#cfg-vision').checked,
    vision_model: $('#cfg-vision-model').value.trim(),
  });
  const status = $('#ai-test-status');
  const aiButtons = [$('#btn-ai-test'), $('#btn-ai-models')].filter(Boolean);
  let aiBusy = false;
  // Never render provider error bodies, notes, URLs or replies: they can echo credentials.
  const aiError = (err, modelsOnly) => {
    const raw = String(err?.message || err || '');
    const code = raw.match(/(?:HTTP\s*|接口返回\s*|请求失败\s*)(401|403|404|429)\b/i)?.[1]
      || raw.match(/\b(401|403|404|429)\b/)?.[1];
    const hints = {
      401: 'HTTP 401：认证失败，请检查 API Key 是否正确、有效，并确认接口地址属于该服务商。',
      403: 'HTTP 403：访问被拒绝，请检查密钥的模型权限、账户状态和服务商的访问限制。',
      404: modelsOnly ? 'HTTP 404：模型列表接口不存在，请核对接口地址；服务可能不支持 /models，可手动填写模型 ID 后测试连接。' : 'HTTP 404：请检查接口地址和模型 ID，确认服务支持 OpenAI 兼容的对话接口。',
      429: 'HTTP 429：请求过多或额度不足，请稍后重试，并检查账户余额、配额和限流设置。',
    };
    if (code) return hints[code];
    if (/network|fetch|timeout|timed?\s*out|connect|dns|socket|连不上|网络|超时|连接/i.test(raw)) return '网络连接失败：请检查接口地址、网络或代理，并确认本地模型服务已启动后重试。';
    if (/接口地址|base.?url|url|配置/i.test(raw)) return '请填写有效的接口地址，并核对 API Key 和模型 ID 后重试。';
    return modelsOnly ? '无法读取模型列表：请核对接口地址和权限；也可手动填写模型 ID 后测试连接。' : '测试未通过：请核对接口地址、API Key、模型 ID 和服务端的 OpenAI 兼容配置后重试。';
  };
  const runAiCheck = async modelsOnly => {
    if (aiBusy) return;
    aiBusy = true;
    aiButtons.forEach(button => { button.disabled = true; });
    const started = Date.now();
    const elapsed = () => ((Date.now() - started) / 1000).toFixed(1) + ' 秒';
    const label = modelsOnly ? '正在读取模型' : '正在测试连接';
    const progress = () => { status.textContent = `${label}… · 已用时 ${elapsed()}`; };
    progress();
    const timer = setInterval(progress, 250);
    status.setAttribute('aria-busy', 'true');
    try {
      const r = await api(modelsOnly ? '/api/ai/models' : '/api/ai/test', { method: 'POST', body: aiDraft() });
      let message;
      if (modelsOnly) {
        const models = Array.isArray(r.models) ? r.models.filter(model => typeof model === 'string') : [];
        const picker = $('#ai-model-picker');
        const select = $('#cfg-model-list');
        select.innerHTML = models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
        picker.hidden = !models.length;
        select.value = $('#cfg-model').value;
        select.onchange = () => { $('#cfg-model').value = select.value; };
        message = models.length ? `模型列表可访问 · 已读取 ${models.length} 个模型；尚未验证对话能力。` : '接口可达，但没有返回模型；可手动填写模型 ID 后测试连接。尚未验证对话能力。';
      } else if (r.via === 'models') {
        const count = Array.isArray(r.models) ? r.models.length : Number(r.count) || 0;
        message = `模型列表可访问 · 已读取 ${count} 个模型；尚未验证所填模型的对话能力。`;
      } else if (r.via === 'chat') {
        message = '对话测试通过 · 已通过对话接口验证当前模型。';
      } else {
        message = '接口已响应，但未返回测试方式；请确认服务配置后重试。';
      }
      status.textContent = `${message} · 用时 ${elapsed()}`;
    } catch (err) {
      status.textContent = `${modelsOnly ? '读取失败' : '连接测试失败'} · ${aiError(err, modelsOnly)} · 用时 ${elapsed()}`;
    } finally {
      clearInterval(timer);
      aiBusy = false;
      aiButtons.forEach(button => { button.disabled = false; });
      status.setAttribute('aria-busy', 'false');
    }
  };
  $('#btn-ai-test')?.addEventListener('click', () => runAiCheck(false));
  $('#btn-ai-models')?.addEventListener('click', () => runAiCheck(true));

  const currentBody = () => ({
    vault: $('#cfg-vault').value.trim(),
    library: $('#cfg-library').value.trim(),
  });
  const saveConfig = async extra => {
    const body = { ...currentBody(), ...extra };
    const cfg = await api('/api/config', { method: 'PUT', body });
    S.boot.config = cfg;
    await reload(true);
    return cfg;
  };

  $('#btn-sync').onclick = async () => {
    // 输入框改过路径就先落盘，否则扫描的还是旧目录 —— 之前“换了文件夹没反应”就出在这里
    const dirty = $('#cfg-vault').value.trim() !== (S.boot.config.vault || '')
      || $('#cfg-library').value.trim() !== (S.boot.config.library || '');
    if (dirty) {
      try { await saveConfig({}); } catch (e) { return toast(e.message, 'err'); }
    }
    const r = await api('/api/sync', { method: 'POST' });
    await reload();
    toast(`已扫描 ${r.total} 篇笔记`, 'ok');
  };
  $('#btn-rescan').onclick = async () => {
    const r = await api('/api/rescan-assets', { method: 'POST' });
    await reload();
    toast(`已扫描 ${r.total} 个素材`, 'ok');
  };
  $('#btn-rebuild').onclick = async () => {
    const r = await api('/api/sync', { method: 'POST' });
    await reload();
    toast(`索引已重建：${r.total} 篇`, 'ok');
  };
  $('#btn-cache').onclick = () => openDir('#cfg-library');
  $('#btn-config-dir').onclick = async () => {
    try {
      const info = await invoke('app_info');
      await invoke('open_folder', { path: info.config_dir || info.exe_dir });
    } catch (e) { toast('打不开：' + e, 'err'); }
  };

  $('#btn-save').onclick = async () => {
    const body = {
      ...currentBody(),
      behavior: {
        watch: $('#cfg-watch').checked,
        watch_interval: Number($('#cfg-watch-interval').value) || 5,
        hotkey_enabled: $('#cfg-hotkey-on').checked,
        hotkey: $('#cfg-hotkey').value.trim() || 'Ctrl+Alt+N',
        confirm_remote: $('#cfg-confirm').checked,
      },
      ui: {
        font_size: $('#cfg-font').value,
        density: $('#cfg-density').value,
        motion: $('#cfg-motion').checked,
        default_view: $('#cfg-default-view').value,
        theme: currentTheme(),
      },
      ai: {
        provider: $('#cfg-provider').value,
        model: $('#cfg-model').value.trim(),
        base_url: $('#cfg-base').value.trim(),
        api_key: $('#cfg-key').value.trim(),
        temperature: Number($('#cfg-temp').value),
        max_tokens: Number($('#cfg-max').value),
        per_note_chars: Number($('#cfg-per-note').value),
        total_budget: Number($('#cfg-budget').value),
        stream: $('#cfg-stream').checked,
        vision: $('#cfg-vision').checked,
        vision_model: $('#cfg-vision-model').value.trim(),
        embedding_enabled: $('#cfg-embedding-enabled').checked,
        embedding_model: $('#cfg-embedding-model').value.trim(),
        embedding_base_url: $('#cfg-embedding-base').value.trim(),
        embedding_api_key: $('#cfg-embedding-key').value.trim(),
        transcription_model: $('#cfg-transcription-model').value.trim(),
        transcription_base_url: $('#cfg-transcription-base').value.trim(),
        transcription_api_key: $('#cfg-transcription-key').value.trim(),
        ffmpeg_path: $('#cfg-ffmpeg').value.trim(),
      },
    };
    try {
      const cfg = await saveConfig(body);
      applyUi();
      let msg = '设置已保存';
      try {
        await invoke('apply_hotkey', { enabled: cfg.behavior.hotkey_enabled, combo: cfg.behavior.hotkey });
      } catch (e) {
        msg = '设置已保存，但热键没生效：' + String(e).replace(/^Error:\s*/, '');
      }
      await reload();
      toast(msg, msg === '设置已保存' ? 'ok' : 'err');
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#btn-defaults').onclick = async () => {
    if (!await confirm('把行为、外观、AI 参数恢复默认？目录不会变。')) return;
    try {
      await saveConfig({
        behavior: { watch: true, watch_interval: 5, hotkey_enabled: true, hotkey: 'Ctrl+Alt+N', confirm_remote: true },
        ui: { font_size: 'normal', density: 'comfortable', motion: true, default_view: 'home', theme: 'dark' },
        ai: { temperature: 0.7, max_tokens: 1800, per_note_chars: 4000, total_budget: 14000, stream: true },
      });
      applyUi();
      applyTheme('dark');
      await reload();
      toast('已恢复默认', 'ok');
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#btn-restart-hint').onclick = () => {
    $('#modal-box').innerHTML = `<h3>灵感坞 ${esc(S.version || '2.13.0')}</h3><p style="color:var(--dim);font-size:13px;line-height:1.8">
      一个本地优先的想法、素材与任务工作台：<br>
      · 想法和任务写在 Obsidian 库里，Obsidian 也能直接编辑<br>
      · 素材库自动索引 assets/ 下的图片、音频、视频<br>
      · 任务可以从想法一键生成，首页只看今天该做的三件事<br>
      · 时间轴看想法和任务落在哪一天，画布把想法、任务、笔记的关系摊开<br>
      · AI 可以总结、提观点、找关联；本地模式不联网<br>
      · 深色线框 / 纸感浅色两套主题；命令面板 Ctrl+K；快捷键速查 ?<br><br>
      配置：<code>%APPDATA%\\LingGanHe\\config.json</code>（便携模式用指定目录）。<br>
      素材缓存：素材库根目录的 <code>.data/assets.json</code>。<br>
      笔记索引和未保存的 AI 结果只保留在内存；重要产出请“存为笔记”。</p>`;
    $('#modal').classList.add('open');
  };
}

/* ------------------------------------------------------------ 搜索视图 */
let searchSeq = 0;
async function loadSearch(q) {
  const seq = ++searchSeq;
  S.searchBusy = true; S.searchError = ''; S.searchItems = [];
  if (S.view === 'search') render();
  try {
    const res = await api('/api/search?q=' + encodeURIComponent(q) + '&limit=200');
    if (seq !== searchSeq) return;
    S.searchItems = res.items || [];
  } catch (e) {
    if (seq !== searchSeq) return;
    S.searchError = e.message;
  } finally {
    if (seq === searchSeq) {
      S.searchBusy = false;
      if (S.view === 'search') render();
    }
  }
}

function viewSearch() {
  const q = S.search;
  const notes = S.searchItems;
  const assets = S.assets.filter(a => [a.name, ...(a.tags || []), a.ai_note || ''].join(' ').toLowerCase().includes(q.toLowerCase()));
  return `<div class="wrap">
    ${pageHead('SEARCH / 搜索', `搜索「${esc(q)}」`, `${notes.length + assets.length} 个结果`, `<button class="btn" id="semantic-search">${ICON.spark} 语义搜索</button>`)}
    <p class="hint">当前显示关键词结果。语义搜索可按含义查找笔记和素材，需先在设置中配置 Embedding 模型。</p>
    ${notes.length ? `<div class="section-title" style="margin-top:20px"><h2 style="font-size:13px">笔记</h2></div>
      ${notes.map(n => `<div class="note-row" ${n.kind === 'idea' ? 'data-idea' : 'data-note'}="${esc(n.path)}"><div class="t">${esc(n.title)}</div>
        <div class="x">${esc(n.snippet || n.excerpt)}</div><div class="m"><span>${esc(n.folder || '根目录')}</span><span>${timeAgo(n.mtime)}</span></div></div>`).join('')}` : ''}
    ${assets.length ? `<div class="section-title" style="margin-top:24px"><h2 style="font-size:13px">素材</h2></div>
      <div class="assets-grid">${assets.slice(0, 40).map(assetCard).join('')}</div>` : ''}
    ${S.searchBusy ? '<p class="sub">正在检索全部笔记…</p>' : ''}
    ${S.searchError ? `<p class="sub">搜索失败：${esc(S.searchError)}</p>` : ''}
    ${!S.searchBusy && !S.searchError && !notes.length && !assets.length ? `<div class="empty">${ICON.search}<b>没找到</b><p>换个关键词试试</p></div>` : ''}
  </div>`;
}

/* ------------------------------------------------------------ 抽屉：想法/笔记 */
function openDrawer(html) {
  $('#drawer-body').innerHTML = html;
  document.body.classList.add('drawer-open');
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
}
let activeEditor = null;

function flushIdeaEditor() {
  if (!activeEditor) return Promise.resolve();
  return activeEditor.flush();
}

// 快照在输入事件发生时读取，而不是 800ms 后再读共享 DOM。
// 每个编辑器有独立的顺序队列；切换笔记也不可能把 B 的正文写进 A。
// base 是「这份内容基于磁盘上的哪个版本」，保存时带给后端做冲突判断。
function ideaAutosave(path, note) {
  const editor = {
    timer: null, pending: null, queue: Promise.resolve(), busy: 0, error: null, revision: 0,
    base: typeof note.mtime === 'number' ? note.mtime : 0, conflict: false,
  };
  const saved = $('#d-saved');
  const update = (msg, cls = '') => {
    if (activeEditor !== editor || !saved.isConnected) return;
    saved.textContent = msg;
    saved.className = 'saved ' + cls;
  };
  const snapshotNow = () => ({
    revision: ++editor.revision,
    path,
    title: $('#d-title').value,
    status: $('#d-status').value,
    tags: $('#d-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    assets: [...(S.drawer?.assets || note.meta?.assets || [])],
    body: $('#d-body').value,
  });
  const send = (snap, force) => api('/api/idea/update', {
    method: 'POST',
    body: { ...snap, base_mtime: editor.base, force: !!force },
  });
  const hideConflict = () => {
    const bar = $('#d-conflict');
    if (bar) { bar.hidden = true; bar.innerHTML = ''; }
    editor.conflict = false;
    editor.error = null;
  };
  const showConflict = () => {
    editor.conflict = true;
    let bar = $('#d-conflict');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'd-conflict';
      bar.className = 'conflict';
      $('#drawer-body').insertBefore(bar, $('#drawer-body').firstChild);
    }
    bar.hidden = false;
    bar.innerHTML = `<b>这份文件在 Obsidian 里被改过了</b>
      <span>直接保存会盖掉那边的修改。你的编辑还在下面，选一个：</span>
      <div class="conflict-actions">
        <button class="btn ghost" id="c-load">载入磁盘上的版本</button>
        <button class="btn primary" id="c-force">用我的覆盖</button>
      </div>`;
    $('#c-load').onclick = async () => {
      if (!await confirm('载入磁盘版本会丢掉你刚才的修改，继续？')) return;
      try {
        const n = await api('/api/note?fresh=1&path=' + encodeURIComponent(path));
        $('#d-body').value = n.body || '';
        $('#d-title').value = n.title || '';
        editor.base = typeof n.mtime === 'number' ? n.mtime : 0;
        editor.pending = null;
        hideConflict();
        update('已载入磁盘版本', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    };
    $('#c-force').onclick = () => { void editor.forceSave(); };
  };
  editor.forceSave = async () => {
    const snap = snapshotNow();
    editor.pending = null;
    editor.busy++;
    update('保存中…');
    try {
      const res = await send(snap, true);
      editor.base = typeof res.mtime === 'number' ? res.mtime : editor.base;
      hideConflict();
      update('已保存（覆盖了磁盘版本）', 'ok');
      await reload(true);
      if (activeEditor !== editor) render();
    } catch (e) {
      editor.error = e;
      update('保存失败，点击重试', 'err');
      toast('保存失败：' + e.message, 'err');
    } finally {
      editor.busy--;
    }
  };
  editor.flush = () => {
    clearTimeout(editor.timer);
    const snapshot = editor.pending;
    if (!snapshot || editor.conflict) return editor.queue;
    editor.pending = null;
    editor.busy++;
    update('保存中…');
    editor.queue = editor.queue.catch(() => {}).then(async () => {
      try {
        const res = await send(snapshot, false);
        editor.base = typeof res.mtime === 'number' ? res.mtime : editor.base;
        editor.error = null;
        update('已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), 'ok');
        await reload(true);
        if (activeEditor !== editor) render();
      } catch (e) {
        editor.error = e;
        if (e.message === 'E_CONFLICT') {
          // 冲突不自动重试：正文留在编辑器里，等用户决定保留哪一份
          editor.pending = null;
          showConflict();
          update('有冲突，等你选择', 'err');
          toast('这条想法在 Obsidian 里被改过，选择保留哪一份', 'err');
        } else {
          if (snapshot.revision === editor.revision && !editor.pending) editor.pending = snapshot;
          update('保存失败，点击重试', 'err');
          toast('想法保存失败：' + e.message, 'err');
        }
      } finally {
        editor.busy--;
      }
    });
    return editor.queue;
  };
  editor.capture = () => {
    if (activeEditor !== editor) return;
    editor.pending = snapshotNow();
    update('等待保存…');
    clearTimeout(editor.timer);
    editor.timer = setTimeout(editor.flush, 800);
  };
  saved.onclick = () => editor.flush();
  activeEditor = editor;
  return editor;
}

let drawerChanging = false;
async function transitionDrawer(action) {
  if (drawerChanging) return false;
  drawerChanging = true;
  const controls = $$('#drawer input, #drawer textarea, #drawer select, #drawer button');
  const disabled = controls.map(el => el.disabled);
  controls.forEach(el => { el.disabled = true; });
  try {
    if (documentLoading) return false;
    const doc = window.DocPage?.current();
    if (doc) {
      if (!await doc.leave()) return false;
      docHash = '';
      history.replaceState(null, '', '#/' + S.view);
      render();
    }
    await flushIdeaEditor();
    if (activeEditor?.pending || activeEditor?.error) return false;
    await action();
    return true;
  } catch (e) {
    toast(e.message || String(e), 'err');
    return false;
  } finally {
    controls.forEach((el, i) => { el.disabled = disabled[i]; });
    drawerChanging = false;
  }
}

async function closeDrawer() {
  return transitionDrawer(async () => {
    activeEditor = null;
    document.body.classList.remove('drawer-open');
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    S.drawer = null;
  });
}

async function openDocument(path, kind, updateHash = true) {
  if (documentLoading) return;
  if ($('#drawer').classList.contains('open') && !await closeDrawer()) return;
  const previousHash = docHash;
  documentLoading = true;
  try {
    const doc = await DocPage.open({
      container: $('#view'), path, kind, api, markdown: md, markdownImage: imgHtml,
      onBack: () => go(kind === 'idea' ? 'ideas' : 'notes'),
      onSidebar: async () => {
        go(kind === 'idea' ? 'ideas' : 'notes');
        return kind === 'idea' ? openIdea(path, true) : openNote(path, true);
      },
      onSaved: () => reload(true),
    });
    if (!doc) { if (previousHash) history.replaceState(null, '', previousHash); return; }
    S.view = kind === 'idea' ? 'ideas' : 'notes';
    $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.view === S.view));
    updateCrumbs();
    docHash = '#/' + kind + '/' + encodeURIComponent(path);
    if (updateHash) history.replaceState(null, '', docHash);
  } catch (e) { toast('打开文档失败：' + e.message, 'err'); }
  finally { documentLoading = false; }
}

async function openIdea(path, sidebar = false) {
  if (!sidebar) return openDocument(path, 'idea');
  return transitionDrawer(async () => {
  const idea = S.ideas.find(i => i.path === path);
  const note = await api('/api/note?path=' + encodeURIComponent(path));
  activeEditor = null;
  S.drawer = { kind: 'idea', path, note, idea };
  const folder = path.split('/').slice(0, -1).join(' / ') || '根目录';
  $('#drawer-tabs').innerHTML = `<span class="pill ${note.meta?.status || 'inbox'}">${statusName(note.meta?.status || 'inbox')}</span>
    <span style="font-size:12px;color:var(--dim-2)">自动保存</span>`;
  $('#drawer-actions').innerHTML = `
    <div class="d-seg" id="d-seg"><button data-pv="0" class="on">编辑</button><button data-pv="1">预览</button></div>
    <button class="btn ghost" id="btn-full-idea" title="全页阅读和编辑">全页</button>
    <button class="btn ghost" id="btn-task" title="把这条想法变成任务">${ICON.task}</button>
    <button class="btn ghost" id="btn-ai" title="用 AI 展开这条想法">${ICON.spark}</button>
    <a class="btn ghost" href="${obsidianUrl(path)}" title="在 Obsidian 打开">${ICON.open}</a>
    <button class="btn ghost danger" id="btn-del" title="删除">${ICON.trash}</button>
    <button class="btn ghost" id="btn-close">${ICON.x}</button>`;
  const tags = (note.tags || []).join(', ');
  const assets = note.meta?.assets || [];
  const source = (note.meta?.source || '').trim();
  // 双向链接：整理稿的 frontmatter 里记了 sources，这里反查「哪些整理用到了这条想法」
  const related = (S.allNotes || []).filter(d => d.kind === 'digest' && (d.meta?.sources || []).includes(path));
  const relatedHtml = related.length ? `<div class="field"><label>相关整理（${related.length}）</label>
      <div class="rel-list">${related.map(d => `<a data-related="${esc(d.path)}">${esc(d.title)}</a>`).join('')}</div></div>` : '';
  openDrawer(`
    <input class="input title-input" id="d-title" value="${esc(note.title)}" placeholder="标题">
    <div class="row" style="margin:14px 0">
      <div><label>状态</label>
        <select class="select" id="d-status">
          ${['inbox', 'thinking', 'building', 'done'].map(s => `<option value="${s}" ${(note.meta?.status || 'inbox') === s ? 'selected' : ''}>${statusName(s)}</option>`).join('')}
        </select></div>
      <div><label>标签（逗号分隔）</label><input class="input" id="d-tags" value="${esc(tags)}"></div>
    </div>
    ${source ? `<div class="drawer-src">来源：${esc(source)}</div>` : ''}
    <div class="field"><label>关联素材</label>
      <div class="asset-chips" id="d-assets">
        ${assets.map(a => `<span class="asset-chip">${/\.(png|jpe?g|webp|svg|gif)$/i.test(a) ? `<img src="${assetUrl(a)}">` : ''}
          ${esc(a.split('/').pop())}<button data-rm-asset="${esc(a)}">×</button></span>`).join('')}
        <button class="btn ghost" id="d-add-asset" style="padding:3px 8px;font-size:11.5px">${ICON.plus} 添加</button>
      </div></div>
    <div class="field"><label>正文（Markdown，自动保存）</label>
      <div class="d-pv" id="d-preview" hidden></div>
      <textarea class="area" id="d-body" style="min-height:300px" placeholder="写点什么…">${esc(note.body)}</textarea></div>
    ${relatedHtml}
    <div style="display:flex;align-items:center;gap:10px">
      <span class="saved" id="d-saved">已保存</span>
      <span style="margin-left:auto;font-size:11px;color:var(--dim-2)">${esc(note.meta?.created || '')}</span>
    </div>`);
  const editor = ideaAutosave(path, note);
  const save = editor.capture;
  ['d-title', 'd-body', 'd-tags'].forEach(id => $('#' + id).oninput = save);
  $('#d-status').onchange = save;
  $('#d-seg').onclick = e => {
    const b = e.target.closest('[data-pv]');
    if (!b) return;
    const pv = b.dataset.pv === '1';
    $$('#d-seg button').forEach(x => x.classList.toggle('on', x === b));
    $('#d-body').hidden = pv;
    $('#d-preview').hidden = !pv;
    if (pv) $('#d-preview').innerHTML = md($('#d-body').value);
  };
  $$('[data-related]').forEach(a => a.onclick = async () => {
    const p = a.dataset.related;
    if (await closeDrawer()) void openNote(p);
  });
  $('#btn-close').onclick = closeDrawer;
  $('#btn-full-idea').onclick = () => openDocument(path, 'idea');
  $('#btn-task').onclick = async () => {
    try {
      const r = await api('/api/task/from-idea', { method: 'POST', body: { path } });
      await reload(true);
      toast('已生成任务：' + r.title, 'ok');
      if (await closeDrawer()) { S.taskFilter = 'open'; go('tasks'); }
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#btn-ai').onclick = async () => {
    if (!await closeDrawer()) return;
    S.ai.sel = new Set([path]);
    S.ai.mode = 'expand';
    S.ai.out = '';
    S.ai.meta = '';
    go('ai');
    void runAI();
  };
  $('#btn-del').onclick = async () => {
    if (!await confirm('删除这条想法？文件会移到库里的 .trash/，需要时还能找回。')) return;
    let trashed = '';
    const deleted = await transitionDrawer(async () => {
      const res = await api('/api/note?path=' + encodeURIComponent(path), { method: 'DELETE' });
      trashed = res.trashed || '';
      activeEditor = null;
    });
    if (deleted) {
      await closeDrawer();
      await reload();
      toast(trashed ? '已移到 ' + trashed : '已删除');
    }
  };
  S.drawer.assets = [...assets];
  const renderLinks = () => {
    $('#d-assets').innerHTML = S.drawer.assets.map(a => `<span class="asset-chip">${/\.(png|jpe?g|webp|svg|gif)$/i.test(a) ? `<img src="${assetUrl(a)}">` : ''}${esc(a.split('/').pop())}<button data-rm-asset="${esc(a)}">×</button></span>`).join('') + `<button class="btn ghost" id="d-add-asset" style="padding:3px 8px;font-size:11.5px">${ICON.plus} 添加</button>`;
  };
  $('#d-assets').onclick = e => {
    const rm = e.target.closest('[data-rm-asset]');
    if (rm) {
      S.drawer.assets = S.drawer.assets.filter(p => p !== rm.dataset.rmAsset);
      renderLinks(); save(); return;
    }
    if (e.target.closest('#d-add-asset')) pickAssets(S.drawer.assets, sel => {
      if (activeEditor !== editor) return;
      S.drawer.assets = sel;
      renderLinks(); save();
    });
  };
  });
}

function pickAssets(current, done) {
  const sel = new Set(current);
  const box = $('#modal-box');
  box.innerHTML = `<h3>选择素材</h3><div class="sub">点击切换选中</div>
    <div class="pick-grid" id="pg">${S.assets.filter(a => a.kind === 'image').map(a => `
      <div class="p ${sel.has(a.path) ? 'on' : ''}" data-p="${esc(a.path)}">
        <img src="${assetUrl(a.path)}" loading="lazy"><span>${esc(a.name)}</span></div>`).join('')}</div>
    <div style="margin-top:16px;display:flex;gap:8px"><button class="btn primary" id="pg-ok">确定</button>
      <button class="btn ghost" id="pg-cancel">取消</button></div>`;
  $('#modal').classList.add('open');
  $$('#pg .p').forEach(el => el.onclick = () => {
    el.classList.toggle('on');
    sel.has(el.dataset.p) ? sel.delete(el.dataset.p) : sel.add(el.dataset.p);
  });
  $('#pg-ok').onclick = () => { $('#modal').classList.remove('open'); done([...sel]); };
  $('#pg-cancel').onclick = () => $('#modal').classList.remove('open');
}

async function openNote(path, sidebar = false) {
  if (!sidebar) return openDocument(path, 'note');
  return transitionDrawer(async () => {
  const note = await api('/api/note?path=' + encodeURIComponent(path));
  activeEditor = null;
  $('#drawer-tabs').innerHTML = `<span style="font-size:12px;color:var(--dim-2)">${esc(path.split('/').pop())}</span>`;
  $('#drawer-actions').innerHTML = `
    <a class="btn ghost" href="${obsidianUrl(path)}" title="在 Obsidian 打开">${ICON.open}</a>
    <button class="btn ghost" id="btn-full-note" title="全页阅读和编辑">全页</button>
    <button class="btn ghost danger" id="btn-del-note" title="移到回收站">${ICON.trash}</button>
    <button class="btn ghost" id="btn-close">${ICON.x}</button>`;
  openDrawer(`
    <h2 style="margin:0 0 4px;font-size:20px">${esc(note.title)}</h2>
    <div style="color:var(--dim-2);font-size:11.5px;margin-bottom:16px">
      ${esc(note.path)} · ${(note.body || '').length} 字 · ${timeAgo(note.mtime)}</div>
    ${(note.tags || []).length ? `<div style="margin-bottom:16px">${note.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="output">${md(note.body)}</div>`);
  $('#btn-close').onclick = closeDrawer;
  $('#btn-full-note').onclick = () => openDocument(path, note.kind === 'idea' ? 'idea' : 'note');
  $('#btn-del-note').onclick = async () => {
    if (!await deleteNoteFlow(note.path, note.title)) return;
    if (await closeDrawer()) void 0;
  };
  });
}

async function newIdea(title = '', body = '', assets = []) {
  return transitionDrawer(async () => {
  activeEditor = null;
  S.drawer = { kind: 'new', assets };
  $('#drawer-tabs').innerHTML = `<span class="pill inbox">新想法</span>`;
  $('#drawer-actions').innerHTML = `<button class="btn ghost" id="btn-close">${ICON.x}</button>`;
  openDrawer(`
    <input class="input title-input" id="d-title" value="${esc(title)}" placeholder="一句话说清这个想法…">
    <div class="row" style="margin:14px 0">
      <div><label>状态</label><select class="select" id="d-status">
        <option value="inbox">收集箱</option><option value="thinking">思考中</option>
        <option value="building">进行中</option><option value="done">已完成</option></select></div>
      <div><label>标签</label><input class="input" id="d-tags" placeholder="玩法, 美术"></div>
    </div>
    <div class="field"><label>正文</label>
      <textarea class="area" id="d-body" placeholder="想到什么写什么，之后再整理。">${esc(body)}</textarea></div>
    <div style="display:flex;gap:8px"><button class="btn primary" id="btn-create">创建</button>
      <button class="btn ghost" id="btn-close2">取消</button>
      <span style="margin-left:auto;color:var(--dim-2);font-size:11px;align-self:center">Ctrl+↵ 快速创建</span></div>`);
  $('#d-title').focus();
  const create = async () => {
    const t = $('#d-title').value.trim();
    if (!t) return toast('先写个标题', 'err');
    let created;
    const ok = await transitionDrawer(async () => {
      created = await api('/api/idea', {
        method: 'POST',
        body: { title: t, body: $('#d-body').value, status: $('#d-status').value, tags: $('#d-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean), assets: S.drawer?.assets || [] },
      });
      await reload();
    });
    if (ok) { await openIdea(created.path); toast('已记下', 'ok'); }
  };
  $('#btn-create').onclick = create;
  $('#btn-close').onclick = closeDrawer;
  $('#btn-close2').onclick = closeDrawer;
  $('#d-title').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create(); };
  });
}

/* ------------------------------------------------------------ 命令面板 */
const PAL_KEY = 'lg.recent';
const PAL_CMDS = [
  { id: 'new-idea', t: '新建想法', s: 'Ctrl N', ic: 'plus', run: () => newIdea() },
  { id: 'new-task', t: '新建任务', s: '', ic: 'task', run: () => newTask() },
  { id: 'upload', t: '上传素材', s: '', ic: 'upload', run: () => pickUpload() },
  { id: 'import-doc', t: '导入文本', s: '拖进来也行', ic: 'book', run: () => pickImportDocs() },
  { id: 'rescan', t: '重建素材索引', s: '', ic: 'refresh', run: () => rescanAssets() },
  { id: 'theme', t: '切换主题', s: 'Ctrl Shift L', ic: 'moon', run: () => toggleTheme() },
  { id: 'help', t: '快捷键速查', s: '?', ic: 'help', run: () => openHelp() },
  { id: 'random', t: '随机翻一篇笔记', s: '', ic: 'book', run: () => randomNote() },
  { id: 'ai', t: 'AI 整理', s: '', ic: 'spark', run: () => go('ai') },
  { id: 'timeline', t: '时间', s: '看任务落在哪一天', ic: 'book', run: () => go('timeline') },
  { id: 'canvas', t: '画布', s: '把关系摊开看', ic: 'spark', run: () => go('canvas') },
  { id: 'assets', t: '浏览素材', s: '', ic: 'image', run: () => go('assets') },
  { id: 'copy-lib', t: '复制素材库路径', s: '', ic: 'copy', run: () => copyText(S.boot?.config?.library || '', '素材库路径已复制') },
  { id: 'open-vault', t: '打开 Obsidian 库', s: '', ic: 'open', run: () => openPath(S.boot?.config?.vault) },
  { id: 'recovery', t: '恢复与备份', s: '回收站与本地快照', ic: 'book', run: () => go('recovery') },
  { id: 'settings', t: '设置', s: '', ic: 'select', run: () => go('settings') },
];

function palRecentIds() {
  try { return JSON.parse(localStorage.getItem(PAL_KEY)) || []; } catch { return []; }
}
function palRemember(id) {
  try {
    const list = palRecentIds().filter(x => x !== id);
    list.unshift(id);
    localStorage.setItem(PAL_KEY, JSON.stringify(list.slice(0, 5)));
  } catch { /* 忽略 */ }
}
function runPalItem(it) {
  if (it.id) palRemember(it.id);
  it.run();
}
function palMark(t, q) {
  if (!q) return esc(t);
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
}

async function rescanAssets() {
  try {
    await api('/api/rescan-assets', { method: 'POST' });
    await reload(true);
    render();
    toast('素材索引已重建', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}
function randomNote() {
  const pool = (S.notes || []).filter(n => n.kind !== 'idea');
  if (!pool.length) return toast('还没有笔记', 'err');
  const n = pool[Math.floor(Math.random() * pool.length)];
  openNote(n.path);
}
function copyText(text, msg) {
  if (!text) return toast('还没有这个路径', 'err');
  navigator.clipboard?.writeText(text);
  toast(msg || '已复制');
}
async function openPath(p) {
  if (!p) return toast('还没有设置这个目录', 'err');
  try { await invoke('open_folder', { path: p }); }
  catch (e) { toast(String(e).replace(/^Error:\s*/, ''), 'err'); }
}

function openPalette() {
  $('#palette').classList.add('open');
  $('#palette-input').value = '';
  $('#palette-input').focus();
  renderPalette('');
}
function closePalette() { $('#palette').classList.remove('open'); }

let paletteSeq = 0;
async function renderPalette(q) {
  const seq = ++paletteSeq;
  const ql = q.toLowerCase();
  const groups = [];
  const cmds = q ? PAL_CMDS.filter(c => c.t.toLowerCase().includes(ql)) : PAL_CMDS.slice(0, 6);
  if (!q) {
    const rec = palRecentIds().map(id => PAL_CMDS.find(c => c.id === id)).filter(Boolean);
    if (rec.length) groups.push({ title: '最近使用', items: rec });
    groups.push({ title: '操作', items: cmds });
    const ideas = (S.boot?.ideas || []).slice(0, 4);
    if (ideas.length) groups.push({ title: '想法', items: ideas.map(i => ({ t: i.title, s: timeAgo(i.mtime), ic: 'bulb', run: () => openIdea(i.path) })) });
    const notes = recentNotes(4);
    if (notes.length) groups.push({ title: '笔记', items: notes.map(n => ({ t: n.title, s: n.folder || '根目录', ic: 'book', run: () => openNote(n.path) })) });
  } else {
    if (cmds.length) groups.push({ title: '命令', items: cmds });
    try {
      const res = await api('/api/search?q=' + encodeURIComponent(q) + '&limit=10');
      if (seq !== paletteSeq || !$('#palette').classList.contains('open')) return;
      const hits = (res.items || []).map(n => ({
        t: n.title, s: n.folder || '根目录', ic: n.kind === 'idea' ? 'bulb' : 'book',
        run: () => n.kind === 'idea' ? openIdea(n.path) : openNote(n.path),
      }));
      if (hits.length) groups.push({ title: '内容', items: hits });
    } catch (e) {
      if (seq === paletteSeq) toast(e.message, 'err');
    }
    const assets = S.assets.filter(a => a.name.toLowerCase().includes(ql)).slice(0, 5)
      .map(a => ({ t: a.name, s: a.cat, ic: 'image', run: () => showAsset(a.path) }));
    if (assets.length) groups.push({ title: '素材', items: assets });
    groups.push({ title: '搜索', items: [{ t: `在全部内容里搜「${q}」`, s: '↵', ic: 'search', run: () => { S.search = q; go('search'); } }] });
  }
  if (seq !== paletteSeq) return;
  const flat = [];
  let html = '';
  groups.forEach(g => {
    html += `<div class="pal-group">${esc(g.title)}</div>`;
    g.items.forEach(it => {
      const i = flat.length;
      flat.push(it);
      html += `<div class="pal-item" data-i="${i}"><span class="ic">${ICON[it.ic] || ''}</span><span class="t">${palMark(it.t, q)}</span>${it.s ? `<span class="s kb">${esc(it.s)}</span>` : ''}</div>`;
    });
  });
  S.pal.items = flat;
  S.pal.idx = 0;
  $('#palette-list').innerHTML = html || '<div class="pal-empty">没有匹配的命令</div>';
  $$('#palette-list .pal-item').forEach(el => {
    el.onclick = () => { const it = S.pal.items[+el.dataset.i]; closePalette(); runPalItem(it); };
    el.onmouseenter = () => { S.pal.idx = +el.dataset.i; highlightPal(); };
  });
  highlightPal();
}

function highlightPal() {
  $$('#palette-list .pal-item').forEach((el, i) => el.classList.toggle('on', i === S.pal.idx));
  const el = $$('#palette-list .pal-item')[S.pal.idx];
  el?.scrollIntoView({ block: 'nearest' });
}

/* ------------------------------------------------------------ 快捷键 & 事件 */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

document.addEventListener('click', e => {
  const w = e.target.closest('[data-wiki]');
  if (w) {
    const name = (w.dataset.wiki || '').trim().toLowerCase();
    const hit = (S.allNotes || []).find(n => (n.title || '').toLowerCase() === name)
      || (S.allNotes || []).find(n => (n.title || '').toLowerCase().includes(name));
    if (hit) openNote(hit.path);
    else toast('没找到「' + (w.dataset.wiki || '') + '」这篇笔记', 'err');
    return;
  }
  const el = e.target.closest('[data-open-asset]');
  if (el) { e.preventDefault(); showAsset(el.dataset.openAsset); }
});

$('#ta-pal').onclick = () => openPalette();
$('#ta-theme').onclick = () => toggleTheme();
$('#ta-help').onclick = () => openHelp();
$('#help').addEventListener('click', e => { if (e.target.id === 'help') closeHelp(); });
$$('#help [data-help-close]').forEach(b => b.onclick = closeHelp);

// 拖拽素材进窗口：直接上传到素材库
let dragDepth = 0;
const hasFiles = e => !!e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
document.addEventListener('dragenter', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add('dragging');
});
document.addEventListener('dragover', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
document.addEventListener('dragleave', e => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) document.body.classList.remove('dragging');
});
document.addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const files = [...e.dataTransfer.files];
  const docs = files.filter(isTextDoc);
  const media = files.filter(f => !isTextDoc(f));
  // 文本落成想法，图片 / 音频 / 视频还是进素材库；一次拖两种也各走各的。
  if (docs.length) importDocs(docs);
  if (media.length) uploadFiles(media);
});

document.addEventListener('keydown', e => {
  const meta = e.metaKey || e.ctrlKey;
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || !!document.activeElement?.isContentEditable;
  if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (meta && e.key.toLowerCase() === 'n') { e.preventDefault(); newIdea(); return; }
  if (meta && e.shiftKey && e.key.toLowerCase() === 'l') { e.preventDefault(); toggleTheme(); return; }
  if (meta && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (activeEditor) void flushIdeaEditor();
    if (window.DocPage?.current()) void DocPage.current().flush();
    return;
  }
  if (!typing && e.key === '?') { e.preventDefault(); openHelp(); return; }
  if (!typing && !meta && e.key === '/') { e.preventDefault(); $('#search').focus(); return; }
  if (e.key === 'Escape') {
    if ($('#help').classList.contains('open')) { closeHelp(); return; }
    if ($('#palette').classList.contains('open')) return closePalette();
    if ($('#modal').classList.contains('open')) return $('#modal').classList.remove('open');
    if ($('#lightbox').classList.contains('open')) return $('#lightbox').classList.remove('open');
    if ($('#drawer').classList.contains('open')) return closeDrawer();
  }
  if ($('#palette').classList.contains('open')) {
    const items = S.pal.items;
    if (e.key === 'ArrowDown') { e.preventDefault(); S.pal.idx = Math.min(S.pal.idx + 1, items.length - 1); highlightPal(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); S.pal.idx = Math.max(S.pal.idx - 1, 0); highlightPal(); }
    if (e.key === 'Enter') { e.preventDefault(); const it = items[S.pal.idx]; if (it) { closePalette(); runPalItem(it); } }
  }
});

$('#palette-input').addEventListener('input', e => renderPalette(e.target.value.trim()));
$('#palette').addEventListener('click', e => { if (e.target.id === 'palette') closePalette(); });
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') $('#modal').classList.remove('open'); });
$('#lightbox').addEventListener('click', () => $('#lightbox').classList.remove('open'));
$('#btn-capture').onclick = () => newIdea();
$('#nav').addEventListener('click', e => {
  const a = e.target.closest('a[data-view]');
  if (a) go(a.dataset.view);
});
document.addEventListener('click', e => {
  const f = e.target.closest('.foot-link[data-view]');
  if (f) go(f.dataset.view);
});

$('#search').addEventListener('input', debounce(e => {
  const q = e.target.value.trim();
  if (!q) { if (S.view === 'search') go('home'); return; }
  S.search = q;
  go('search');
}, 220));

/* ------------------------------------------------------------ 桌面事件 */
// 库被外部改动（Obsidian 保存、别的工具生成文件）：刷新列表；
// 如果当前打开的笔记是干净的，顺手把新内容载进来。
window.addEventListener('linganhe:vault-changed', async () => {
  if (drawerChanging) return;
  try {
    await reload(true);
    render();
  } catch (e) {
    return;
  }
  const ed = activeEditor;
  if (S.drawer?.kind === 'idea' && ed && !ed.pending && !ed.busy && !ed.conflict && !ed.error) {
    try {
      const n = await api('/api/note?fresh=1&path=' + encodeURIComponent(S.drawer.path));
      if (typeof n.mtime === 'number' && n.mtime !== ed.base) {
        $('#d-body').value = n.body || '';
        $('#d-title').value = n.title || '';
        ed.base = n.mtime;
        toast('这条想法已在 Obsidian 里更新，已载入新内容', 'ok');
        return;
      }
    } catch { /* 文件可能已被删除，保持现状 */ }
  }
  toast('Obsidian 库有变化，已刷新');
});

// 全局热键 Ctrl+Alt+N：直接开一条新想法
window.addEventListener('linganhe:quick-capture', () => {
  void newIdea();
});

// AI 流式输出：后端每解析出一段就推一次，这里只更新输出框，不整页重绘
window.addEventListener('linganhe:ai-chunk', e => {
  const d = e.detail || {};
  if (!S.ai.runId || d.id !== S.ai.runId) return;
  S.ai.out += d.delta || '';
  S.ai.streaming = true;
  paintStream();
});

function paintStream() {
  let box = document.querySelector('#view .wb-body .output');
  if (!box) { render(); box = document.querySelector('#view .wb-body .output'); }
  if (!box) return;
  box.classList.add('stream');
  box.textContent = S.ai.out;
  box.scrollTop = box.scrollHeight;
}

/* ------------------------------------------------------------ 启动 */
function skeletonHome() {
  return `<div class="sk-home">
    <div class="sk-hero"><div class="sk a"></div><div class="sk b"></div></div>
    <div class="sk-stats">${'<div class="sk sk-stat"></div>'.repeat(4)}</div>
    <div class="sk-cols"><div class="sk sk-block"></div><div class="sk sk-block"></div></div>
  </div>`;
}

async function reload(silent) {
  if (!silent && !S.boot) $('#view').innerHTML = skeletonHome();
  const [boot, assets, notes, tags, canvas] = await Promise.all([
    api('/api/bootstrap'), api('/api/assets'), api('/api/notes?limit=100000'), api('/api/tags'),
    api('/api/canvas').catch(() => ({ links: [], positions: {} }))]);
  S.boot = boot;
  S.assets = assets.items;
  S.ideas = boot.ideas;
  S.tasks = boot.tasks || [];
  S.taskCounts = boot.task_counts || {};
  S.today = boot.today || '';
  S.notes = notes.items;
  S.allNotes = notes.items;
  S.tags = tags.items || [];
  S.cv.manual = Array.isArray(canvas.links) ? canvas.links : [];
  S.cv.pos = (canvas.positions && typeof canvas.positions === 'object') ? canvas.positions : {};
  $('#n-ideas').textContent = boot.ideas.length;
  const nInbox = $('#n-inbox');
  if (nInbox) nInbox.textContent = (S.ideas.filter(i => !i.status || i.status === 'inbox').length + S.assets.filter(a => !(a.tags || []).length && !(a.ai_note || '').trim()).length) || '';
  const nTasks = $('#n-tasks');
  if (nTasks) nTasks.textContent = (S.taskCounts.open || 0) || '';
  $('#n-assets').textContent = assets.items.length;
  $('#n-notes').textContent = notes.items.filter(n => n.kind !== 'task').length;
  const nTags = $('#n-tags');
  if (nTags) nTags.textContent = S.tags.length;
  $('#vault-tag').textContent = boot.config.vault ? vaultName() : '未连接 Obsidian';
  $('#vault-tag').title = boot.config.vault || '';
  $('#recent').innerHTML = recentNotes(7).map(n =>
    `<a data-note="${esc(n.path)}">${esc(n.title)}</a>`).join('');
  $$('#recent a').forEach(a => a.onclick = () => openNote(a.dataset.note));
  if (!silent) render();
}

(async function init() {
  try {
    try {
      const info = await invoke('app_info');
      if (info?.version) S.version = info.version;
    } catch { /* 浏览器预览里没有 app_info */ }
    await reload();
    applyUi();
    const uiCfg = S.boot?.config?.ui || {};
    const qp = new URLSearchParams(location.search);
    if (qp.get('theme') === 'paper' || qp.get('theme') === 'dark') applyTheme(qp.get('theme'), false);
    else if (uiCfg.theme) applyTheme(uiCfg.theme, false);
    if (qp.get('panel') === 'palette') openPalette();
    if (qp.get('panel') === 'help') openHelp();
    const dv = uiCfg.default_view || 'home';
    const bare = !location.hash || location.hash === '#' || location.hash === '#/';
    if (bare && dv !== 'home') await go(dv); else await routeFromHash();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty"><b>加载失败</b><p>${esc(e.message)}</p></div>`;
  }
})();
