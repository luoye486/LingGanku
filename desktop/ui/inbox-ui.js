/* Integration: render InboxUI.view() into #view, then InboxUI.bind(). No startup requests. */
(function (global) {
  'use strict';
  const state = { tab: 'ideas', query: '', order: 'oldest', selected: { ideas: new Set(), assets: new Set() }, busy: false };
  let modal = null;
  const text = value => String(value == null ? '' : value);
  const escape = value => esc(text(value));
  const statuses = [['inbox', '收集箱'], ['thinking', '思考中'], ['building', '进行中'], ['done', '已完成']];
  const tagsOf = item => Array.isArray(item.tags) ? item.tags : [];
  const statusOf = item => item.status || item.meta?.status || 'inbox';
  const queues = () => ({
    ideas: (S.ideas || []).filter(item => statusOf(item) === 'inbox'),
    assets: (S.assets || []).filter(item => !tagsOf(item).length && !text(item.ai_note).trim()),
  });
  function prune(queue) {
    for (const tab of ['ideas', 'assets']) {
      const present = new Set(queue[tab].map(item => item.path));
      for (const path of state.selected[tab]) if (!present.has(path)) state.selected[tab].delete(path);
    }
  }
  function stamp(item) {
    const value = item.created || item.ctime || item.mtime || item.modified || 0;
    return typeof value === 'number' ? value : Date.parse(value) || 0;
  }
  function date(item) {
    const value = stamp(item);
    if (!value) return '时间未知';
    const d = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(d.getTime()) ? '时间未知' : d.toLocaleDateString('zh-CN');
  }
  const labelOf = item => item.title || item.name || item.path;
  const errorText = error => text(error?.message || error || '操作失败');
  const action = (name, label, path) => `<button type="button" class="btn ghost" data-inbox-action="${name}" data-path="${escape(path)}" ${state.busy ? 'disabled' : ''}>${label}</button>`;
  function card(item) {
    const idea = state.tab === 'ideas';
    const context = idea ? item.excerpt || item.summary || item.preview || item.body || '' : [item.cat, item.ext, item.kind].filter(Boolean).join(' · ');
    return `<article class="inbox-card"><div class="inbox-card-main"><label class="inbox-check"><input type="checkbox" data-inbox-pick="${escape(item.path)}" aria-label="选择 ${escape(labelOf(item))}" ${state.selected[state.tab].has(item.path) ? 'checked' : ''} ${state.busy ? 'disabled' : ''}><span>选择</span></label><div class="inbox-card-copy"><h2>${escape(labelOf(item))}</h2><p class="inbox-path">${escape(item.path)}</p><p class="inbox-context">${escape(text(context).slice(0, 280) || (idea ? '打开阅读完整想法，再决定下一步。' : '暂无标签和素材说明，可手动整理或使用 AI。'))}</p><div class="inbox-card-meta"><span>${escape(date(item))}</span><span>${idea ? '待整理想法' : '无标签 · 无说明'}</span>${tagsOf(item).map(tag => `<span>#${escape(tag)}</span>`).join('')}</div></div></div><div class="inbox-card-actions">${action('open', idea ? '打开 / 阅读' : '打开素材', item.path)}${action('organize', '整理', item.path)}${action('ai', 'AI 整理', item.path)}${!idea && ['audio', 'video'].includes(item.kind) ? action('media', item.kind === 'audio' ? '音频转写' : '视频分析', item.path) : ''}${idea ? action('task', '生成任务', item.path) : ''}</div></article>`;
  }
  function view() {
    const queue = queues();
    prune(queue);
    const q = state.query.trim().toLocaleLowerCase();
    const list = queue[state.tab].filter(item => !q || [labelOf(item), item.path, item.excerpt, item.summary, item.body, ...tagsOf(item)].map(text).join(' ').toLocaleLowerCase().includes(q))
      .slice().sort((a, b) => (stamp(a) - stamp(b)) * (state.order === 'oldest' ? 1 : -1) || text(a.path).localeCompare(text(b.path)));
    const selected = state.selected[state.tab].size;
    return `<section class="wrap inbox-page" aria-label="收集箱"><header class="inbox-head"><div><p class="inbox-eyebrow">STUDIO / INBOX</p><h1>收集箱</h1><p class="inbox-description">给收集到的内容一个下一步。打开、生成预览或生成任务不会将它标为已整理。</p></div><button type="button" class="btn" data-inbox-refresh ${state.busy ? 'disabled' : ''}>${state.busy ? '处理中…' : '刷新队列'}</button></header><div class="inbox-tabs" role="group" aria-label="队列类型">${[['ideas', '想法'], ['assets', '素材']].map(([key, label]) => `<button type="button" data-inbox-tab="${key}" aria-pressed="${state.tab === key}" class="${state.tab === key ? 'on' : ''}" ${state.busy ? 'disabled' : ''}>${label}<span>${queue[key].length}</span></button>`).join('')}</div><p class="inbox-rule">${state.tab === 'ideas' ? '显示状态为「收集箱」或尚无状态的想法。保存为其他状态后才移出此队列。' : '仅按「没有标签且没有 ai_note 说明」筛选素材；这不代表所有素材都未审阅。任一项实际保存后才移出队列。'}</p><div class="inbox-tools"><label class="inbox-search"><span class="inbox-sr">搜索当前队列</span><input type="search" class="input" data-inbox-search placeholder="搜索标题、路径或内容…" value="${escape(state.query)}" ${state.busy ? 'disabled' : ''}></label><label class="inbox-sort">排序<select class="select" data-inbox-order ${state.busy ? 'disabled' : ''}><option value="oldest" ${state.order === 'oldest' ? 'selected' : ''}>最早优先</option><option value="newest" ${state.order === 'newest' ? 'selected' : ''}>最新优先</option></select></label></div><div class="inbox-batch"><span role="status">显示 ${list.length} / ${queue[state.tab].length} 项 · 已选 ${selected} / 8</span><button type="button" class="btn ghost" data-inbox-clear ${!selected || state.busy ? 'disabled' : ''}>清空选择</button><button type="button" class="btn" data-inbox-batch ${!selected || state.busy ? 'disabled' : ''}>${state.tab === 'ideas' && selected >= 2 ? 'AI 合成选中想法' : 'AI 整理选中项'}</button></div><div class="inbox-list">${list.map(card).join('') || `<div class="inbox-empty"><h2>${q ? '没有匹配的内容' : '当前队列为空'}</h2><p>${q ? '调整搜索词，或清空搜索查看整个队列。' : state.tab === 'ideas' ? '没有处于收集箱状态的想法。新收集或尚无状态的想法会显示在这里。' : '没有同时缺少标签和说明的素材。这是元数据筛选结果，不是全部素材的审阅记录。'}</p></div>`}</div></section>`;
  }
  function paint() {
    if (modal || document.querySelector('.aiwf-overlay, .media-overlay') || S.view !== 'inbox') return;
    const root = document.querySelector('#view');
    if (!root) return;
    root.innerHTML = view();
    bind(root);
  }
  async function refresh() { await reload(true); prune(queues()); paint(); }
  async function guarded(fn) {
    if (state.busy || modal) return;
    state.busy = true;
    paint();
    try { await fn(); } catch (error) { toast(errorText(error), 'err'); }
    finally { state.busy = false; paint(); }
  }
  async function prepare() {
    const doc = global.DocPage?.current();
    if (doc && !await doc.flush()) throw new Error('请先完成文档保存并处理冲突。');
    if (typeof closeDrawer === 'function' && (S.drawer || document.querySelector('#drawer.open'))) {
      if (!await closeDrawer()) throw new Error('请先完成侧栏保存并处理冲突。');
    }
  }
  function repaintAfterDialog(selector) {
    const shell = document.querySelector(selector);
    if (!shell || typeof MutationObserver !== 'function') return;
    const observer = new MutationObserver(() => {
      if (!shell.isConnected) { observer.disconnect(); prune(queues()); paint(); }
    });
    observer.observe(document.body, { childList: true });
  }
  async function openAI(paths, tab) {
    if (!paths.length) return;
    await prepare();
    if (tab === 'assets') {
      if (!global.AIWorkflows?.openAssets) throw new Error('AI 素材模块尚未加载');
      await global.AIWorkflows.openAssets(paths);
      repaintAfterDialog('.aiwf-overlay');
    } else if (paths.length >= 2) {
      if (!global.AIWorkflows?.openIdeas) throw new Error('AI 想法模块尚未加载');
      await global.AIWorkflows.openIdeas(paths);
      repaintAfterDialog('.aiwf-overlay');
    } else {
      if (S.ai.busy) throw new Error('AI 工作区正在生成，请稍后再试。');
      Object.assign(S.ai, { tab: 'notes', q: '', sel: new Set(paths), mode: 'expand', out: '', meta: null, lastResult: null });
      go('ai');
    }
  }
  function bind(root = document.querySelector('#view')) {
    if (!root) return;
    root.querySelectorAll('[data-inbox-tab]').forEach(el => { el.onclick = () => { state.tab = el.dataset.inboxTab; paint(); }; });
    const search = root.querySelector('[data-inbox-search]');
    if (search) search.oninput = () => {
      const start = search.selectionStart, end = search.selectionEnd;
      state.query = search.value; paint();
      const next = root.querySelector('[data-inbox-search]');
      next?.focus();
      if (next && start !== null) { try { next.setSelectionRange(start, end); } catch (_) { /* Search inputs vary across webviews. */ } }
    };
    const order = root.querySelector('[data-inbox-order]');
    if (order) order.onchange = () => { state.order = order.value === 'newest' ? 'newest' : 'oldest'; paint(); };
    root.querySelectorAll('[data-inbox-pick]').forEach(el => { el.onchange = () => {
      const selected = state.selected[state.tab];
      if (el.checked && selected.size >= 8) { el.checked = false; toast('一次最多选择 8 项', 'err'); return; }
      el.checked ? selected.add(el.dataset.inboxPick) : selected.delete(el.dataset.inboxPick);
      paint();
    }; });
    const clear = root.querySelector('[data-inbox-clear]');
    if (clear) clear.onclick = () => { state.selected[state.tab].clear(); paint(); };
    const batch = root.querySelector('[data-inbox-batch]');
    if (batch) batch.onclick = () => { const tab = state.tab, paths = [...state.selected[tab]]; void guarded(() => openAI(paths, tab)); };
    const refreshButton = root.querySelector('[data-inbox-refresh]');
    if (refreshButton) refreshButton.onclick = () => { void guarded(refresh); };
    root.querySelectorAll('[data-inbox-action]').forEach(el => { el.onclick = () => {
      const path = el.dataset.path, tab = state.tab, name = el.dataset.inboxAction;
      if (name === 'organize') { void guarded(async () => { await prepare(); await organize(path, tab); }); return; }
      void guarded(async () => {
        if (name === 'open') { await prepare(); if (tab === 'ideas') await openDocument(path, 'idea'); else await showAsset(path); }
        if (name === 'ai') await openAI([path], tab);
        if (name === 'media') {
          await prepare();
          if (!global.MediaUI?.open) throw new Error('媒体分析模块尚未加载');
          await global.MediaUI.open(path);
          repaintAfterDialog('.media-overlay');
        }
        if (name === 'task') {
          await prepare();
          const result = await api('/api/task/from-idea', { method: 'POST', body: { path } });
          toast('已生成任务：' + (result.title || path), 'ok');
          try { await refresh(); } catch (error) { toast('任务已创建，刷新失败：' + errorText(error), 'err'); }
        }
      });
    }; });
  }
  function make(tag, className, content) {
    const node = document.createElement(tag);
    node.className = className || '';
    if (content !== undefined) node.textContent = text(content);
    return node;
  }
  async function organize(path, tab) {
    if (modal) return;
    const source = Object.freeze({ path: text(path), tab });
    const previousFocus = document.activeElement;
    const shell = make('div', 'inbox-overlay');
    shell.innerHTML = `<section class="inbox-dialog" role="dialog" aria-modal="true" aria-labelledby="inbox-dialog-title" tabindex="-1"><header class="inbox-dialog-head"><h2 id="inbox-dialog-title">整理${tab === 'ideas' ? '想法' : '素材'}</h2><button type="button" class="btn ghost" data-close aria-label="关闭整理窗口">×</button></header><form class="inbox-form"><p class="inbox-path">${escape(source.path)}</p><p class="inbox-modal-hint">仅点击「保存」才写入磁盘。关闭窗口会放弃本次未保存修改。</p><div data-fields></div><p class="inbox-message" role="status" aria-live="polite"></p><div class="inbox-modal-actions"><button type="button" class="btn ghost" data-disk>重新载入磁盘版本（丢弃当前修改）</button><button type="button" class="btn ghost" data-cancel>取消</button><button type="submit" class="btn" data-save>保存</button></div></form></section>`;
    const get = selector => shell.querySelector(selector);
    const panel = get('.inbox-dialog'), fields = get('[data-fields]'), message = get('.inbox-message');
    let busy = false, snapshot = null, dirty = false, conflict = false, confirming = false;
    function report(value, error = false) { message.textContent = value; message.classList.toggle('error', error); }
    function lock(on) {
      busy = on; panel.setAttribute('aria-busy', String(on));
      shell.querySelectorAll('input,select,textarea,button').forEach(el => { el.disabled = on; });
      if (!on) get('[data-save]').disabled = !snapshot || conflict;
    }
    function close() {
      if (busy) return;
      shell.remove(); document.removeEventListener('keydown', onKey, true); modal = null;
      if (previousFocus?.isConnected) previousFocus.focus();
      paint();
    }
    function onKey(event) {
      if (confirming) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); }
      if (event.key === 'Tab') {
        const focusable = [...panel.querySelectorAll('button,input,textarea,select')].filter(el => !el.disabled && !el.hidden);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    }
    function field(label, name, value, multiline = false) {
      const wrapper = make('label', 'inbox-field', label);
      const input = make(multiline ? 'textarea' : 'input', 'input');
      input.name = name; input.value = text(value); if (!multiline) input.type = 'text';
      wrapper.appendChild(input); fields.appendChild(wrapper); return input;
    }
    function fill(note) {
      snapshot = note; fields.replaceChildren();
      if (source.tab === 'ideas') {
        field('标题', 'title', note.title);
        const wrapper = make('label', 'inbox-field', '状态'), select = make('select', 'select');
        select.name = 'status';
        const value = note.meta?.status || 'inbox';
        const options = statuses.some(([key]) => key === value) ? statuses : [...statuses, [value, value]];
        options.forEach(([key, label]) => { const option = make('option', '', label); option.value = key; option.selected = value === key; select.appendChild(option); });
        wrapper.appendChild(select); fields.appendChild(wrapper);
      }
      field('标签（逗号分隔）', 'tags', tagsOf(note).join(', '));
      if (source.tab === 'assets') {
        const noteInput = field('素材说明 ai_note', 'ai_note', note.ai_note, true);
        const counter = make('p', 'inbox-limit');
        const update = () => { counter.textContent = `标签最多 12 个；说明 ${Array.from(noteInput.value).length} / 400 个 Unicode 字符。超限无法保存。`; };
        noteInput.addEventListener('input', update); fields.appendChild(counter); update();
      }
      dirty = false; conflict = false;
    }
    async function load() {
      lock(true); report('正在载入磁盘版本…');
      try {
        if (source.tab === 'ideas') fill(await api('/api/note?path=' + encodeURIComponent(source.path) + '&fresh=1'));
        else {
          const result = await api('/api/assets');
          const asset = (result.items || []).find(item => item.path === source.path);
          if (!asset) throw new Error('素材已不存在');
          fill(asset);
        }
        report('已载入；修改后请点击保存。');
      } catch (error) { report('载入失败：' + errorText(error), true); }
      finally { lock(false); }
    }
    get('[data-close]').onclick = close; get('[data-cancel]').onclick = close;
    get('[data-disk]').onclick = async () => {
      if (busy || confirming) return;
      confirming = true;
      try {
        if (dirty && !await confirm('重新载入磁盘版本会丢弃本窗口尚未保存的修改。继续？')) return;
        if (!shell.isConnected || busy) return;
        await load();
      } catch (error) { report(errorText(error), true); }
      finally { confirming = false; }
    };
    fields.addEventListener('input', () => { dirty = true; });
    fields.addEventListener('change', () => { dirty = true; });
    get('form').onsubmit = async event => {
      event.preventDefault();
      if (busy || !snapshot || conflict) return;
      const read = name => fields.querySelector(`[name="${name}"]`).value;
      const tags = [...new Set(read('tags').split(/[,，\n]/).map(value => value.trim()).filter(Boolean))];
      if (source.tab === 'assets' && tags.length > 12) { report('素材最多 12 个标签，请减少后再保存。', true); return; }
      const note = source.tab === 'assets' ? read('ai_note') : '';
      if (source.tab === 'assets' && Array.from(note).length > 400) { report('素材说明最多 400 个 Unicode 字符，请缩短后再保存。', true); return; }
      if (source.tab === 'ideas' && typeof snapshot.mtime !== 'number') { report('缺少磁盘版本号，请重新载入后保存。', true); return; }
      lock(true); report('正在保存…');
      let saved = false;
      try {
        const body = source.tab === 'ideas' ? { path: source.path, title: read('title'), tags, status: read('status'), body: snapshot.body || '', assets: [...(snapshot.meta?.assets || [])], base_mtime: snapshot.mtime } : { path: source.path, tags, ai_note: note };
        await api(source.tab === 'ideas' ? '/api/idea/update' : '/api/asset/tags', { method: 'POST', body });
        saved = true; dirty = false;
        try { await reload(true); prune(queues()); } catch (error) { toast('已保存，队列刷新失败：' + errorText(error), 'err'); }
      } catch (error) {
        conflict = error?.code === 'E_CONFLICT' || errorText(error).includes('E_CONFLICT');
        report(conflict ? 'E_CONFLICT：磁盘版本已更改。当前修改已保留；请明确选择重新载入磁盘版本后再编辑，不能直接覆盖。' : '保存失败：' + errorText(error), true);
      } finally { lock(false); }
      if (saved) { close(); toast('已保存整理结果', 'ok'); }
    };
    modal = { shell };
    document.body.appendChild(shell); document.addEventListener('keydown', onKey, true);
    panel.focus(); await load();
    get('[name="title"]')?.focus();
  }
  global.InboxUI = Object.freeze({ view, bind });
})(window);
