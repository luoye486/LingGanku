/* 灵感盒 · 前端（无框架，直接操作 DOM） */
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const S = {
  boot: null,
  view: 'home',
  assets: [],
  assetCats: [],
  assetFilter: 'all',
  assetQuery: '',
  ideas: [],
  statusFilter: 'all',
  notes: [],
  folder: null,
  search: '',
  drawer: null,
  ai: { tab: 'notes', q: '', sel: new Set(), mode: 'summarize', extra: '', out: '', meta: null, busy: false },
  pal: { items: [], idx: 0 },
};

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
  if (!res.ok || data.error) throw new Error(data.error || ('请求失败 ' + res.status));
  return data;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

/* ------------------------------------------------------------ Markdown */
function inlineMd(s) {
  return s
    .replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => `<span class="wl">${b || a}</span>`)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]+)\)/g,
      (_, t, u) => `<a href="${u}" target="_blank" rel="noreferrer">${t}</a>`);
}

function md(src = '') {
  const lines = String(src).replace(/\r/g, '').split('\n');
  let out = '', i = 0, list = null, quote = false;
  const closeList = () => { if (list) { out += `</${list}>`; list = null; } };
  const closeQuote = () => { if (quote) { out += '</blockquote>'; quote = false; } };
  while (i < lines.length) {
    let ln = lines[i];
    if (/^```/.test(ln)) {
      closeList(); closeQuote();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
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
      const want = ul ? 'ul' : 'ol';
      if (list !== want) { closeList(); out += `<${want}>`; list = want; }
      out += `<li>${inlineMd(esc((ul || ol)[1]))}</li>`;
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
  return out;
}

/* ------------------------------------------------------------ 路由 */
function go(view, arg) {
  S.view = view;
  if (view === 'notes' && arg !== undefined) S.folder = arg;
  if (view === 'assets' && arg !== undefined) S.assetFilter = arg;
  const hash = '#/' + view + (arg && view === 'assets' ? '/' + encodeURIComponent(arg) : '');
  if (location.hash !== hash) history.replaceState(null, '', hash);
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.view === view));
  render();
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [v, ...rest] = h.split('/');
  return { view: v || 'home', arg: rest.length ? decodeURIComponent(rest.join('/')) : undefined };
}

async function routeFromHash() {
  const { view, arg } = parseHash();
  if (['note', 'idea', 'asset'].includes(view) && arg) {
    S.view = view === 'note' ? 'notes' : view === 'idea' ? 'ideas' : 'assets';
    $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.view === S.view));
    render();
    if (view === 'note') return openNote(arg);
    if (view === 'idea') return openIdea(arg);
    return showAsset(arg);
  }
  S.view = view;
  if (arg) { if (view === 'assets') S.assetFilter = arg; if (view === 'notes') S.folder = arg; }
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.view === view));
  render();
}

window.addEventListener('hashchange', () => { routeFromHash(); });

/* ------------------------------------------------------------ 渲染 */
function render() {
  const v = $('#view');
  const map = { home: viewHome, ideas: viewIdeas, assets: viewAssets, notes: viewNotes, ai: viewAI, settings: viewSettings, search: viewSearch };
  v.innerHTML = (map[S.view] || viewHome)();
  if (S.view === 'ideas') bindIdeas();
  if (S.view === 'assets') bindAssets();
  if (S.view === 'notes') bindNotes();
  if (S.view === 'ai') bindAI();
  if (S.view === 'settings') bindSettings();
  if (S.view === 'home') bindHome();
  updateCrumbs();
}

function updateCrumbs() {
  const names = { home: '首页', ideas: '想法', assets: '素材', notes: '笔记', ai: 'AI 整理', settings: '设置', search: '搜索' };
  $('#crumbs').innerHTML = `<span>${names[S.view] || ''}</span>`;
}

/* ------------------------------------------------------------ 首页 */
function viewHome() {
  const st = S.boot?.stats || {};
  const ideas = S.boot?.ideas || [];
  const cats = S.boot?.assets?.cats || [];
  const recent = S.boot?.recent || [];
  const ideaRows = ideas.slice(0, 6).map(i => `
    <div class="idea-row s-${i.status}" data-idea="${esc(i.path)}">
      <div class="bar"></div>
      <div style="min-width:0;flex:1">
        <div class="t">${esc(i.title)}</div>
        <div class="x">${esc(i.excerpt || '（还没有正文）')}</div>
        <div class="m"><span>${timeAgo(i.mtime)}</span><span>${i.words || 0} 字</span></div>
      </div>
    </div>`).join('') || `<div class="empty compact">${ICON.bulb}<b>还没有想法</b>
      <p>想法会存进 Obsidian<br>灵感盒/想法/</p>
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

  return `<div class="wrap">
    <div class="hero">
      <div>
        <h1>${greeting()}，<span>今天记点什么？</span></h1>
        <p>想法、素材、笔记都在一个地方，AI 负责把它们串起来。</p>
      </div>
      <div class="today">${todayStr()}</div>
    </div>

    <div class="stats">
      <div class="stat"><div class="k">想法</div><div class="v">${ideas.length}<small>条</small></div></div>
      <div class="stat"><div class="k">笔记</div><div class="v">${st.total || 0}<small>篇</small></div></div>
      <div class="stat"><div class="k">素材</div><div class="v">${S.assets.length}<small>个</small></div></div>
      <div class="stat"><div class="k">累计字数</div><div class="v">${((st.words || 0) / 1000).toFixed(1)}<small>k</small></div></div>
    </div>

    <div class="grid-2">
      <div>
        <div class="section-title"><h2>最近的想法</h2><span class="sub">${ideas.length} 条</span>
          <a class="more" data-go="ideas">全部 →</a></div>
        <div>${ideaRows}</div>
      </div>
      <div>
        <div class="section-title"><h2>素材库</h2><span class="sub">${S.assets.length} 个文件</span>
          <a class="more" data-go="assets">浏览 →</a></div>
        <div class="asset-strip">${thumbs}</div>
        <div class="cat-list" style="margin-top:14px">${catRows}</div>
      </div>
    </div>

    <div style="margin-top:32px">
      <div class="section-title"><h2>最近的笔记</h2><span class="sub">来自 Obsidian</span>
        <a class="more" data-go="notes">全部 →</a></div>
      <div>${recent.slice(0, 6).map(n => `
        <div class="note-row" data-note="${esc(n.path)}">
          <div class="t">${esc(n.title)}<span class="tag">${esc(n.folder || '根目录')}</span></div>
          <div class="x">${esc(n.excerpt || '')}</div>
          <div class="m"><span>${timeAgo(n.mtime)}</span><span>${n.words} 字</span></div>
        </div>`).join('') || '<div class="empty">还没有笔记</div>'}
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
    <div class="section-title"><h2>想法</h2><span class="sub">${S.ideas.length} 条 · 按状态筛选</span></div>
    <div class="toolbar">${chips}<span class="grow"></span>
      <button class="btn primary" data-new>${ICON.plus} 新想法</button></div>
    <div class="ideas-grid">${cards || `<div class="empty" style="grid-column:1/-1">${ICON.bulb}<b>这个状态下没有想法</b><p>换个筛选，或者新建一条</p></div>`}</div>
  </div>`;
}

function statusName(s) {
  return { inbox: '收集箱', thinking: '思考中', building: '进行中', done: '已完成' }[s] || s;
}

function bindIdeas() {
  $$('[data-status]').forEach(el => el.onclick = () => { S.statusFilter = el.dataset.status; render(); });
  $$('[data-idea]').forEach(el => el.onclick = () => openIdea(el.dataset.idea));
  $$('[data-new]').forEach(el => el.onclick = newIdea);
}

/* ------------------------------------------------------------ 素材 */
function viewAssets() {
  const cats = ['all', ...(S.boot?.assets?.cats || []).map(c => c.name)];
  const chips = cats.map(c => {
    const n = c === 'all' ? S.assets.length : (S.boot.assets.cats.find(x => x.name === c)?.count || 0);
    return `<button class="chip ${S.assetFilter === c ? 'on' : ''}" data-cat="${esc(c)}">${esc(c === 'all' ? '全部' : c)} <span style="opacity:.6">${n}</span></button>`;
  }).join('');
  const items = S.assets.filter(a =>
    (S.assetFilter === 'all' || a.cat === S.assetFilter) &&
    (!S.assetQuery || (a.name + a.cat).toLowerCase().includes(S.assetQuery.toLowerCase())));
  return `<div class="wrap">
    <div class="section-title"><h2>素材</h2><span class="sub">${items.length} / ${S.assets.length} 个文件</span>
      <span class="grow" style="flex:1"></span>
      <button class="btn" data-upload>${ICON.upload} 上传</button>
      <button class="btn ghost" data-rescan>${ICON.refresh} 重建索引</button>
    </div>
    <div class="assets-bar">${chips}</div>
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
  return `<div class="asset-card" data-asset="${esc(a.path)}">
    <div class="thumb ${a.cat === '图标' ? 'light' : ''}">${thumb}
      <div class="hover-actions">
        <button data-copy="${esc(a.path)}" title="复制路径">${ICON.copy}</button>
      </div>
    </div>
    <div class="meta"><div class="n" title="${esc(a.name)}">${esc(a.name)}</div>
      <div class="s"><span>${esc(a.cat)}</span><span>${meta}</span></div></div>
  </div>`;
}

function bindAssets() {
  $$('[data-cat]').forEach(el => el.onclick = () => { S.assetFilter = el.dataset.cat; render(); });
  $$('[data-asset]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-copy]')) return;
    showAsset(el.dataset.asset);
  });
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
  inp.onchange = async () => {
    for (const f of inp.files) {
      const buf = await f.arrayBuffer();
      const res = await fetch('/api/upload', { method: 'POST', headers: { 'X-Filename': encodeURIComponent(f.name) }, body: buf });
      if (!res.ok) toast('上传失败：' + f.name, 'err');
    }
    await reload();
    toast('上传完成', 'ok');
  };
  inp.click();
}

function showAsset(path) {
  const a = S.assets.find(x => x.path === path);
  if (!a) return;
  if (a.kind === 'image') {
    $('#lightbox img').src = assetUrl(a.path);
    $('#lightbox').classList.add('open');
    return;
  }
  const box = $('#modal-box');
  box.innerHTML = `<h3>${esc(a.name)}</h3>
    <div class="sub">${esc(a.cat)} · ${fmtSize(a.size)}${a.dur ? ' · ' + a.dur + 's' : ''}</div>
    ${a.kind === 'audio' ? `<audio controls autoplay style="width:100%" src="${assetUrl(a.path)}"></audio>` : ''}
    ${a.kind === 'video' ? `<video controls autoplay style="width:100%;border-radius:8px" src="${assetUrl(a.path)}"></video>` : ''}
    <div style="margin-top:14px;font-size:12px;color:var(--dim)">
      <div>路径：<code>${esc(a.path)}</code></div>
      ${a.note ? `<div>说明：${esc(a.note)}</div>` : ''}
      ${a.author ? `<div>来源：${esc(a.author)} · ${esc(a.license || '')}</div>` : ''}
    </div>
    <div style="margin-top:16px;display:flex;gap:8px">
      <button class="btn" onclick="navigator.clipboard.writeText('${esc(a.path)}')">${ICON.copy} 复制路径</button>
      <a class="btn" href="${assetUrl(a.path)}" download>下载</a>
      <button class="btn" onclick="newIdea('${esc(a.name)}','',['${esc(a.path)}'])">${ICON.plus} 用它写想法</button>
    </div>`;
  $('#modal').classList.add('open');
}

/* ------------------------------------------------------------ 笔记 */
function viewNotes() {
  const folders = S.boot?.folders || [];
  const total = folders.reduce((n, f) => n + f.count, 0);
  const tree = [`<div class="f ${S.folder === null ? 'on' : ''}" data-folder="__all">${ICON.book}<span>全部笔记</span><span class="n">${total}</span></div>`]
    .concat(folders.filter(f => f.folder).map(f => `
      <div class="f ${S.folder === f.folder ? 'on' : ''}" data-folder="${esc(f.folder)}">
        <span style="opacity:.6">▸</span><span>${esc(f.folder)}</span><span class="n">${f.count}</span></div>`))
    .join('');
  const notes = S.notes.filter(n => S.folder === null || S.folder === '__all' || n.folder === S.folder);
  const rows = notes.map(n => `
    <div class="note-row" data-note="${esc(n.path)}">
      <div class="t">${esc(n.title)}${n.kind === 'idea' ? '<span class="pill inbox">想法</span>' : ''}</div>
      <div class="x">${esc(n.excerpt || '')}</div>
      <div class="m"><span>${timeAgo(n.mtime)}</span><span>${n.words} 字</span>
        ${(n.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    </div>`).join('');
  return `<div class="wrap">
    <div class="section-title"><h2>笔记</h2><span class="sub">${notes.length} 篇 · ${esc(vaultName() || '未连接 Obsidian')}</span>
      <span class="grow" style="flex:1"></span>
      <button class="btn ghost" data-sync>${ICON.refresh} 重新扫描</button></div>
    <div class="notes-layout">
      <div class="tree">${tree}</div>
      <div class="note-list">${rows || `<div class="empty">${ICON.book}<b>这个文件夹没有笔记</b></div>`}</div>
    </div>
  </div>`;
}

function bindNotes() {
  $$('[data-folder]').forEach(el => el.onclick = () => {
    S.folder = el.dataset.folder === '__all' ? '__all' : el.dataset.folder;
    render();
  });
  $$('[data-note]').forEach(el => el.onclick = () => openNote(el.dataset.note));
  $$('[data-sync]').forEach(el => el.onclick = async () => {
    el.disabled = true;
    try { await api('/api/sync', { method: 'POST' }); await reload(); toast('已同步', 'ok'); }
    finally { el.disabled = false; }
  });
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
    <div class="section-title"><h2>AI 整理</h2><span class="sub">选材料 → 选动作 → 生成</span>
      <span class="badge ${provider === 'LLM' ? 'llm' : 'local'}" style="margin-left:auto">${provider}</span></div>
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
        <div class="wb-body">${S.ai.out ? `<div class="output">${md(S.ai.out)}</div>` : `
          <div class="wb-empty">${ICON.spark}<b style="color:var(--dim)">左边选材料，上面选动作</b>
            <span>本地分析不需要联网；配置了 API Key 就走大模型</span></div>`}</div>
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
  if (!S.ai.sel.size && !S.ai.extra.trim()) return toast('先选点材料', 'err');
  S.ai.busy = true; S.ai.out = ''; S.ai.meta = '';
  render();
  try {
    const res = await api('/api/ai', {
      method: 'POST',
      body: { mode: S.ai.mode, paths: [...S.ai.sel], extra: S.ai.extra },
    });
    S.ai.out = res.text;
    S.ai.meta = `${res.model === 'local' ? '本地分析' : res.model} · ${res.elapsed}s`;
    S.ai.lastSources = res.sources || [];
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    S.ai.busy = false;
    render();
  }
}

async function saveDigest() {
  const title = prompt('笔记标题', '整理 · ' + new Date().toLocaleDateString('zh-CN'));
  if (!title) return;
  try {
    await api('/api/digest', { method: 'POST', body: { title, text: S.ai.out, mode: S.ai.mode, model: S.ai.meta, sources: S.ai.lastSources || [] } });
    await reload();
    toast('已保存到 Obsidian 的 灵感盒/整理', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

/* ------------------------------------------------------------ 设置 */
function viewSettings() {
  const c = S.boot?.config || {};
  const ai = c.ai || {};
  return `<div class="wrap" style="max-width:760px">
    <div class="section-title"><h2>设置</h2><span class="sub">改完记得保存</span></div>

    <div class="card" style="padding:18px 20px;margin-bottom:16px">
      <h3 style="margin:0 0 4px;font-size:14px">Obsidian 库</h3>
      <p style="margin:0 0 12px;color:var(--dim-2);font-size:12px">应用会读写这个目录下的 .md；新想法写在 <code>灵感盒/想法/</code>。</p>
      <div class="row">
        <input class="input" id="cfg-vault" value="${esc(c.vault || '')}" placeholder="D:\\你的库">
        <button class="btn" id="btn-detect" style="flex:none">检测</button>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn" id="btn-sync">${ICON.refresh} 重新扫描库</button>
        <span style="font-size:11.5px;color:var(--dim-2);align-self:center" id="sync-info">
          ${S.boot?.stats?.total || 0} 篇笔记 · ${S.boot?.stats?.words || 0} 字</span>
      </div>
    </div>

    <div class="card" style="padding:18px 20px;margin-bottom:16px">
      <h3 style="margin:0 0 4px;font-size:14px">AI</h3>
      <p style="margin:0 0 12px;color:var(--dim-2);font-size:12px">
        默认“本地分析”，不联网也能总结和提关键词。填了接口就走大模型（OpenAI 兼容：DeepSeek / Moonshot / Ollama 都行）。</p>
      <div class="row" style="margin-bottom:10px">
        <div><label>模式</label>
          <select class="select" id="cfg-provider">
            <option value="local" ${ai.provider !== 'openai' ? 'selected' : ''}>本地分析（无需联网）</option>
            <option value="openai" ${ai.provider === 'openai' ? 'selected' : ''}>大模型（OpenAI 兼容）</option>
          </select></div>
        <div><label>模型</label><input class="input" id="cfg-model" value="${esc(ai.model || '')}" placeholder="deepseek-chat"></div>
      </div>
      <div style="margin-bottom:10px"><label>接口地址</label>
        <input class="input" id="cfg-base" value="${esc(ai.base_url || '')}" placeholder="https://api.deepseek.com/v1"></div>
      <div><label>API Key（只存在本地 config.json）</label>
        <input class="input" id="cfg-key" type="password" value="${esc(ai.api_key || '')}" placeholder="sk-..."></div>
    </div>

    <div style="display:flex;gap:10px">
      <button class="btn primary" id="btn-save">保存设置</button>
      <button class="btn ghost" id="btn-restart-hint">关于</button>
    </div>
    <p style="color:var(--dim-2);font-size:11.5px;margin-top:18px">
      灵感盒 1.0 · 本地运行，数据都在你自己的磁盘上 · 快捷键：⌘K 搜索 · ⌘N 新想法</p>
  </div>`;
}

function bindSettings() {
  $('#btn-sync').onclick = async () => {
    const r = await api('/api/sync', { method: 'POST' });
    await reload();
    toast(`已扫描 ${r.total} 篇笔记`, 'ok');
  };
  $('#btn-detect').onclick = async () => {
    const r = await api('/api/config');
    if (r.vault) { $('#cfg-vault').value = r.vault; toast('检测到：' + r.vault, 'ok'); }
    else toast('没检测到 Obsidian 库，请手动填写', 'err');
  };
  $('#btn-save').onclick = async () => {
    const body = {
      vault: $('#cfg-vault').value.trim(),
      ai: {
        provider: $('#cfg-provider').value,
        model: $('#cfg-model').value.trim(),
        base_url: $('#cfg-base').value.trim(),
        api_key: $('#cfg-key').value.trim(),
      },
    };
    await api('/api/config', { method: 'PUT', body });
    await reload();
    toast('设置已保存', 'ok');
  };
  $('#btn-restart-hint').onclick = () => {
    $('#modal-box').innerHTML = `<h3>灵感盒</h3><p style="color:var(--dim);font-size:13px;line-height:1.8">
      一个本地优先的想法与素材工作台：<br>
      · 想法写在 Obsidian 库里，Obsidian 也能直接编辑<br>
      · 素材库自动索引 assets/ 下的图片、音频、视频<br>
      · AI 可以总结、提观点、找关联；本地模式不联网<br><br>
      数据位置：项目目录 <code>app/config.json</code> 与 <code>.data/app.db</code></p>`;
    $('#modal').classList.add('open');
  };
}

/* ------------------------------------------------------------ 搜索视图 */
function viewSearch() {
  const q = S.search;
  const notes = (S.boot?.recent || []).filter(n => (n.title + n.excerpt).toLowerCase().includes(q.toLowerCase()));
  const assets = S.assets.filter(a => a.name.toLowerCase().includes(q.toLowerCase()));
  return `<div class="wrap">
    <div class="section-title"><h2>搜索「${esc(q)}」</h2><span class="sub">${notes.length + assets.length} 个结果</span></div>
    ${notes.length ? `<div class="section-title" style="margin-top:20px"><h2 style="font-size:13px">笔记</h2></div>
      ${notes.map(n => `<div class="note-row" data-note="${esc(n.path)}"><div class="t">${esc(n.title)}</div>
        <div class="x">${esc(n.excerpt)}</div><div class="m"><span>${esc(n.folder || '根目录')}</span><span>${timeAgo(n.mtime)}</span></div></div>`).join('')}` : ''}
    ${assets.length ? `<div class="section-title" style="margin-top:24px"><h2 style="font-size:13px">素材</h2></div>
      <div class="assets-grid">${assets.slice(0, 40).map(assetCard).join('')}</div>` : ''}
    ${!notes.length && !assets.length ? `<div class="empty">${ICON.search}<b>没找到</b><p>换个关键词试试</p></div>` : ''}
  </div>`;
}

/* ------------------------------------------------------------ 抽屉：想法/笔记 */
function openDrawer(html) {
  $('#drawer-body').innerHTML = html;
  document.body.classList.add('drawer-open');
  $('#drawer').classList.add('open');
  $('#drawer').setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  document.body.classList.remove('drawer-open');
  $('#drawer').classList.remove('open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  S.drawer = null;
}

async function openIdea(path) {
  const idea = S.ideas.find(i => i.path === path);
  const note = await api('/api/note?path=' + encodeURIComponent(path));
  S.drawer = { kind: 'idea', path, note, idea };
  const folder = path.split('/').slice(0, -1).join(' / ') || '根目录';
  $('#drawer-tabs').innerHTML = `<span class="pill ${note.meta?.status || 'inbox'}">${statusName(note.meta?.status || 'inbox')}</span>
    <span style="font-size:12px;color:var(--dim-2)">${esc(folder)}</span>`;
  $('#drawer-actions').innerHTML = `
    <button class="btn ghost" id="btn-ai" title="用 AI 展开这条想法">${ICON.spark}</button>
    <a class="btn ghost" href="${obsidianUrl(path)}" title="在 Obsidian 打开">${ICON.open}</a>
    <button class="btn ghost danger" id="btn-del" title="删除">${ICON.trash}</button>
    <button class="btn ghost" id="btn-close">${ICON.x}</button>`;
  const tags = (note.tags || []).join(', ');
  const assets = note.meta?.assets || [];
  openDrawer(`
    <input class="input title-input" id="d-title" value="${esc(note.title)}" placeholder="标题">
    <div class="row" style="margin:14px 0">
      <div><label>状态</label>
        <select class="select" id="d-status">
          ${['inbox', 'thinking', 'building', 'done'].map(s => `<option value="${s}" ${(note.meta?.status || 'inbox') === s ? 'selected' : ''}>${statusName(s)}</option>`).join('')}
        </select></div>
      <div><label>标签（逗号分隔）</label><input class="input" id="d-tags" value="${esc(tags)}"></div>
    </div>
    <div class="field"><label>关联素材</label>
      <div class="asset-chips" id="d-assets">
        ${assets.map(a => `<span class="asset-chip">${/\.(png|jpe?g|webp|svg|gif)$/i.test(a) ? `<img src="${assetUrl(a)}">` : ''}
          ${esc(a.split('/').pop())}<button data-rm-asset="${esc(a)}">×</button></span>`).join('')}
        <button class="btn ghost" id="d-add-asset" style="padding:3px 8px;font-size:11.5px">${ICON.plus} 添加</button>
      </div></div>
    <div class="field"><label>正文（Markdown，自动保存）</label>
      <textarea class="area" id="d-body" style="min-height:300px">${esc(note.body)}</textarea></div>
    <div style="display:flex;align-items:center;gap:10px">
      <span class="saved" id="d-saved">已保存</span>
      <span style="margin-left:auto;font-size:11px;color:var(--dim-2)">${esc(note.meta?.created || '')}</span>
    </div>`);
  const save = debounce(async () => {
    const body = {
      path, title: $('#d-title').value, status: $('#d-status').value,
      tags: $('#d-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      assets: S.drawer?.assets || note.meta?.assets || [],
      body: $('#d-body').value,
    };
    try {
      await api('/api/note', { method: 'PUT', body });
      $('#d-saved').textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      $('#d-saved').className = 'saved ok';
      await reload(true);
    } catch (e) { toast(e.message, 'err'); }
  }, 800);
  ['d-title', 'd-body', 'd-tags'].forEach(id => $('#' + id).oninput = save);
  $('#d-status').onchange = save;
  $('#btn-close').onclick = closeDrawer;
  $('#btn-ai').onclick = () => {
    S.ai.sel = new Set([path]);
    S.ai.mode = 'expand';
    S.ai.out = '';
    S.ai.meta = '';
    closeDrawer();
    go('ai');
    setTimeout(runAI, 150);
  };
  $('#btn-del').onclick = async () => {
    if (!confirm('删除这条想法？文件会从 Obsidian 库中移除。')) return;
    await api('/api/note?path=' + encodeURIComponent(path), { method: 'DELETE' });
    closeDrawer(); await reload(); toast('已删除');
  };
  $('#d-add-asset').onclick = () => pickAssets(assets, (sel) => {
    S.drawer.assets = sel;
    $('#d-assets').innerHTML = sel.map(a => `<span class="asset-chip">${/\.(png|jpe?g|webp|svg|gif)$/i.test(a) ? `<img src="${assetUrl(a)}">` : ''}${esc(a.split('/').pop())}<button data-rm-asset="${esc(a)}">×</button></span>`).join('') + `<button class="btn ghost" id="d-add-asset" style="padding:3px 8px;font-size:11.5px">${ICON.plus} 添加</button>`;
    save();
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

async function openNote(path) {
  const note = await api('/api/note?path=' + encodeURIComponent(path));
  if (note.error) return toast(note.error, 'err');
  $('#drawer-tabs').innerHTML = `<span style="font-size:12px;color:var(--dim-2)">${esc(path.split('/').pop())}</span>`;
  $('#drawer-actions').innerHTML = `
    <a class="btn ghost" href="${obsidianUrl(path)}" title="在 Obsidian 打开">${ICON.open}</a>
    <button class="btn ghost" id="btn-close">${ICON.x}</button>`;
  openDrawer(`
    <h2 style="margin:0 0 4px;font-size:20px">${esc(note.title)}</h2>
    <div style="color:var(--dim-2);font-size:11.5px;margin-bottom:16px">
      ${esc(note.path)} · ${(note.body || '').length} 字 · ${timeAgo(note.mtime)}</div>
    ${(note.tags || []).length ? `<div style="margin-bottom:16px">${note.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="output">${md(note.body)}</div>`);
  $('#btn-close').onclick = closeDrawer;
}

function newIdea(title = '', body = '', assets = []) {
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
      <span style="margin-left:auto;color:var(--dim-2);font-size:11px;align-self:center">⌘↵ 快速创建</span></div>`);
  $('#d-title').focus();
  const create = async () => {
    const t = $('#d-title').value.trim();
    if (!t) return toast('先写个标题', 'err');
    const res = await api('/api/idea', {
      method: 'POST',
      body: { title: t, body: $('#d-body').value, status: $('#d-status').value, tags: $('#d-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean), assets: S.drawer?.assets || [] },
    });
    await reload();
    closeDrawer();
    toast('已记下', 'ok');
    openIdea(res.path);
  };
  $('#btn-create').onclick = create;
  $('#btn-close').onclick = closeDrawer;
  $('#btn-close2').onclick = closeDrawer;
  $('#d-title').onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create(); };
}

/* ------------------------------------------------------------ 命令面板 */
function openPalette() {
  $('#palette').classList.add('open');
  $('#palette-input').value = '';
  $('#palette-input').focus();
  renderPalette('');
}
function closePalette() { $('#palette').classList.remove('open'); }

function renderPalette(q) {
  const items = [];
  if (!q) {
    items.push({ k: '操作', t: '新建想法', s: '⌘N', run: () => newIdea() });
    items.push({ k: '操作', t: '打开 AI 整理', s: '', run: () => go('ai') });
    items.push({ k: '操作', t: '浏览素材', s: '', run: () => go('assets') });
    items.push({ k: '操作', t: '设置', s: '', run: () => go('settings') });
    (S.boot?.ideas || []).slice(0, 5).forEach(i => items.push({ k: '想法', t: i.title, s: timeAgo(i.mtime), run: () => openIdea(i.path) }));
    (S.boot?.recent || []).slice(0, 5).forEach(n => items.push({ k: '笔记', t: n.title, s: n.folder || '根目录', run: () => openNote(n.path) }));
  } else {
    const ql = q.toLowerCase();
    (S.boot?.ideas || []).filter(i => i.title.toLowerCase().includes(ql)).slice(0, 6)
      .forEach(i => items.push({ k: '想法', t: i.title, s: timeAgo(i.mtime), run: () => openIdea(i.path) }));
    (S.boot?.recent || []).filter(n => (n.title + n.excerpt).toLowerCase().includes(ql)).slice(0, 8)
      .forEach(n => items.push({ k: '笔记', t: n.title, s: n.folder || '根目录', run: () => openNote(n.path) }));
    S.assets.filter(a => a.name.toLowerCase().includes(ql)).slice(0, 6)
      .forEach(a => items.push({ k: '素材', t: a.name, s: a.cat, run: () => showAsset(a.path) }));
    items.push({ k: '搜索', t: `在全部内容里搜「${q}」`, s: '↵', run: () => { S.search = q; go('search'); } });
  }
  S.pal.items = items;
  S.pal.idx = 0;
  $('#palette-list').innerHTML = items.map((it, i) => `
    <div class="pal-item ${i === 0 ? 'on' : ''}" data-i="${i}">
      <span class="k">${it.k}</span><span class="t">${esc(it.t)}</span><span class="s">${esc(it.s || '')}</span></div>`).join('');
  $$('#palette-list .pal-item').forEach(el => {
    el.onclick = () => { const it = S.pal.items[+el.dataset.i]; closePalette(); it.run(); };
    el.onmouseenter = () => { S.pal.idx = +el.dataset.i; highlightPal(); };
  });
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

document.addEventListener('keydown', e => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (meta && e.key.toLowerCase() === 'n') { e.preventDefault(); newIdea(); return; }
  if (e.key === 'Escape') {
    if ($('#palette').classList.contains('open')) return closePalette();
    if ($('#modal').classList.contains('open')) return $('#modal').classList.remove('open');
    if ($('#lightbox').classList.contains('open')) return $('#lightbox').classList.remove('open');
    if ($('#drawer').classList.contains('open')) return closeDrawer();
  }
  if ($('#palette').classList.contains('open')) {
    const items = S.pal.items;
    if (e.key === 'ArrowDown') { e.preventDefault(); S.pal.idx = Math.min(S.pal.idx + 1, items.length - 1); highlightPal(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); S.pal.idx = Math.max(S.pal.idx - 1, 0); highlightPal(); }
    if (e.key === 'Enter') { e.preventDefault(); const it = items[S.pal.idx]; if (it) { closePalette(); it.run(); } }
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
  if (S.view !== 'search') { S.view = 'search'; $$('#nav a').forEach(a => a.classList.remove('on')); }
  render();
}, 220));

/* ------------------------------------------------------------ 启动 */
async function reload(silent) {
  const [boot, assets, notes] = await Promise.all([
    api('/api/bootstrap'), api('/api/assets'), api('/api/notes?limit=800')]);
  S.boot = boot;
  S.assets = assets.items;
  S.ideas = boot.ideas;
  S.notes = notes.items;
  S.allNotes = notes.items;
  $('#n-ideas').textContent = boot.ideas.length;
  $('#n-assets').textContent = assets.items.length;
  $('#n-notes').textContent = boot.stats.total || 0;
  $('#vault-tag').textContent = boot.config.vault ? vaultName() : '未连接 Obsidian';
  $('#vault-tag').title = boot.config.vault || '';
  $('#recent').innerHTML = boot.recent.filter(n => n.kind !== 'idea').slice(0, 9).map(n =>
    `<a data-note="${esc(n.path)}">${esc(n.title)}</a>`).join('');
  $$('#recent a').forEach(a => a.onclick = () => openNote(a.dataset.note));
  if (!silent) render();
}

(async function init() {
  try {
    await reload();
    await routeFromHash();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty"><b>加载失败</b><p>${esc(e.message)}</p></div>`;
  }
})();
