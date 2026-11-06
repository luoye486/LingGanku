/* Full-page document editor. Host integration contract:
 * DocPage.open({ container, path, kind, api, markdown, onBack, onSidebar, onSaved })
 * awaits loading and returns a controller; call controller.leave() before every
 * navigation or replacement. A false result means unsaved data is retained.
 * Optional onSidebar runs only after leave() succeeds; host opens legacy drawer.
 * kind is 'idea' or 'note'; the latter uses PUT /api/note with
 * the same base_mtime/force/mtime conflict contract as /api/idea/update.
 */
(function () {
  'use strict';
  let current = null;
  let opening = false;
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  async function open(options) {
    if (opening) return null;
    opening = true;
    try {
      if (current && !await current.leave()) return null;
      const { container, path, kind, api, markdown, markdownImage, onBack, onSidebar, onSaved } = options;
      if (!container || !path || !['idea', 'note'].includes(kind) || typeof api !== 'function' || typeof markdown !== 'function') throw new Error('DocPage: invalid options');
      container.innerHTML = '<div class="doc-page-loading" role="status">正在加载文档…</div>';
      let note;
      try { note = await api('/api/note?fresh=1&path=' + encodeURIComponent(path)); }
      catch (err) { container.innerHTML = '<div class="doc-page-loading" role="alert">文档加载失败</div>'; throw err; }
      const state = { base: note.mtime, pending: null, timer: null, queue: Promise.resolve(), conflict: false, error: null, busy: false, closed: false, revision: 0 };
      const isIdea = kind === 'idea';
      const statuses = [['inbox','收集箱'],['thinking','思考中'],['building','进行中'],['done','已完成']];
      container.innerHTML = `<article class="doc-page">
        <header class="doc-page-toolbar"><button type="button" class="btn ghost doc-back" aria-label="返回" title="返回">←</button><span class="doc-kind">${isIdea ? '想法' : '笔记'}</span><span class="doc-path">${escape(path)}</span><span class="doc-spacer"></span>${typeof onSidebar === 'function' ? '<button type="button" class="btn ghost doc-sidebar">侧栏</button>' : ''}${isIdea ? '<button type="button" class="btn ghost doc-plan">拆分计划</button>' : ''}<button type="button" class="btn ghost doc-related">相关内容</button><span class="doc-save" role="status" aria-live="polite">已保存</span><button type="button" class="btn ghost doc-retry" hidden>重试</button><div class="doc-modes" role="group" aria-label="阅读或编辑"><button type="button" data-mode="read" class="on" aria-pressed="true">阅读</button><button type="button" data-mode="edit" aria-pressed="false">编辑</button><button type="button" data-mode="split" aria-pressed="false">实时预览</button></div></header>
        <div class="doc-page-content"><div class="doc-conflict" role="alert" hidden><strong>磁盘上的文件已更改</strong><p>当前编辑仍保留在页面中。载入磁盘版本会丢弃当前修改。</p><div><button type="button" class="btn ghost doc-load">载入磁盘版本</button><button type="button" class="btn primary doc-force">用我的版本覆盖</button></div></div>
        <div class="doc-meta"><input class="doc-title" aria-label="标题" placeholder="未命名" value="${escape(note.title)}" ${isIdea ? '' : 'readonly'}>${isIdea ? `<div class="doc-fields"><label>状态<select class="select doc-status">${statuses.map(([key,label]) => `<option value="${key}" ${(note.meta?.status || 'inbox') === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>标签<input class="input doc-tags" value="${escape((note.tags || []).join(', '))}" placeholder="用逗号分隔"></label></div>` : `<div class="doc-tags-read">${(note.tags || []).map(t => `<span class="tag">${escape(t)}</span>`).join('')}</div>`}</div>
        <div class="doc-format" role="toolbar" aria-label="Markdown 格式" hidden>${[['heading','标题'],['bold','粗体'],['italic','斜体'],['strike','删除线'],['list','列表'],['task','待办'],['quote','引用'],['code','代码'],['link','链接'],['image','图片'],['table','表格']].map(([action,label]) => `<button type="button" class="btn ghost" data-format="${action}" title="插入${label}">${label}</button>`).join('')}<span class="doc-format-hint">Markdown · Ctrl+B 粗体 / Ctrl+I 斜体 / Tab 缩进</span></div>
        <div class="doc-workspace"><textarea class="doc-editor" aria-label="Markdown 正文" placeholder="使用 Markdown 记录内容…" spellcheck="false" hidden>${escape(note.body)}</textarea><div class="doc-reading output"></div></div></div></article>`;
      const root = container.querySelector('.doc-page');
      const get = selector => root.querySelector(selector);
      const title = get('.doc-title'), body = get('.doc-editor'), read = get('.doc-reading'), save = get('.doc-save'), retry = get('.doc-retry'), conflict = get('.doc-conflict');
      let assets = [...(note.meta?.assets || [])];
      const status = (text, error = false) => { save.textContent = text; save.classList.toggle('error', error); retry.hidden = !error || state.conflict; };
      const render = () => { read.innerHTML = (window.MarkdownView?.render ? window.MarkdownView.render(body.value, { image: markdownImage }) : markdown(body.value)); };
      const snapshot = () => ({ path, body: body.value, ...(isIdea ? { title: title.value, status: get('.doc-status').value, tags: get('.doc-tags').value.split(/[,，]/).map(x => x.trim()).filter(Boolean), assets: [...assets] } : {}), revision: ++state.revision });
      const capture = () => { if (state.closed) return; state.pending = snapshot(); status(state.conflict ? '有冲突，等待处理' : '等待保存…', state.conflict); clearTimeout(state.timer); if (!state.conflict) state.timer = setTimeout(() => { void flush(); }, 800); };
      const send = async (snap, force) => {
        const { revision, ...data } = snap;
        const result = await api(isIdea ? '/api/idea/update' : '/api/note', { method: isIdea ? 'POST' : 'PUT', body: { ...data, base_mtime: state.base, force } });
        if (typeof result.mtime !== 'number') throw new Error('保存接口未返回版本号');
        state.base = result.mtime;
        if (typeof onSaved === 'function') Promise.resolve().then(() => onSaved(result)).catch(console.error);
      };
      const flush = () => {
        clearTimeout(state.timer);
        state.queue = state.queue.then(async () => {
          while (state.pending && !state.conflict && !state.closed) {
            const snap = state.pending; state.pending = null; state.busy = true; status('保存中…');
            try { await send(snap, false); state.error = null; status(state.pending ? '等待保存…' : '已保存'); }
            catch (err) { state.pending = state.pending || snap; state.error = err; state.conflict = err.message === 'E_CONFLICT'; conflict.hidden = !state.conflict; status(state.conflict ? '有冲突，等待处理' : '保存失败', true); break; }
            finally { state.busy = false; }
          }
        });
        return state.queue;
      };
      const lockFields = locked => { root.querySelectorAll('.doc-title:not([readonly]), .doc-editor, .doc-status, .doc-tags, .doc-load, .doc-force').forEach(el => { el.disabled = locked; }); };
      get('.doc-load').onclick = async () => {
        if (!await confirm('载入磁盘版本会丢掉当前修改，继续？')) return;
        lockFields(true); state.busy = true;
        try {
          const fresh = await api('/api/note?fresh=1&path=' + encodeURIComponent(path));
          title.value = fresh.title || ''; body.value = fresh.body || ''; state.base = fresh.mtime;
          if (isIdea) { get('.doc-status').value = fresh.meta?.status || 'inbox'; get('.doc-tags').value = (fresh.tags || []).join(', '); assets = [...(fresh.meta?.assets || [])]; }
          state.pending = null; state.conflict = false; state.error = null; conflict.hidden = true; render(); status('已载入磁盘版本');
        } catch (err) { status('载入失败：' + err.message, true); }
        finally { state.busy = false; lockFields(false); }
      };
      get('.doc-force').onclick = async () => {
        if (!await confirm('确定用当前内容覆盖磁盘上的版本？')) return;
        lockFields(true);
        try {
          const snap = snapshot(); state.pending = null; state.busy = true; status('保存中…');
          await send(snap, true); state.conflict = false; state.error = null; conflict.hidden = true; status('已保存');
          if (state.pending) await flush();
        } catch (err) { state.pending = state.pending || snapshot(); state.error = err; status('覆盖失败：' + err.message, true); }
        finally { state.busy = false; lockFields(false); }
      };
      let mode = 'read', previewTimer;
      const setMode = next => {
        mode = next;
        const editing = mode !== 'read';
        root.querySelectorAll('[data-mode]').forEach(b => { const active = b.dataset.mode === mode; b.classList.toggle('on', active); b.setAttribute('aria-pressed', String(active)); });
        body.hidden = !editing; read.hidden = mode === 'edit'; root.classList.toggle('editing', editing); root.classList.toggle('split', mode === 'split');
        get('.doc-format').hidden = !editing;
        if (isIdea) { title.readOnly = !editing; get('.doc-status').disabled = !editing; get('.doc-tags').readOnly = !editing; }
        if (!read.hidden) render();
      };
      root.querySelectorAll('[data-mode]').forEach(button => button.onclick = () => setMode(button.dataset.mode));
      body.addEventListener('input', () => { capture(); clearTimeout(previewTimer); if (mode === 'split') previewTimer = setTimeout(render, 120); });
      const insert = action => {
        if (body.disabled || mode === 'read') return;
        const start = body.selectionStart, end = body.selectionEnd, selected = body.value.slice(start, end);
        let replacement, selectionStart = 0, selectionEnd;
        const wrap = { bold: ['**','**','粗体文字'], italic: ['*','*','斜体文字'], strike: ['~~','~~','删除线文字'], link: ['[','](https://example.com)','链接文字'], image: ['![','](assets/图片.png)','图片说明'] }[action];
        if (wrap) { const text = selected || wrap[2]; replacement = wrap[0] + text + wrap[1]; selectionStart = wrap[0].length; selectionEnd = selectionStart + text.length; }
        else if (['heading','list','task','quote'].includes(action)) {
          const prefix = {heading:'## ',list:'- ',task:'- [ ] ',quote:'> '}[action];
          const lineStart = body.value.lastIndexOf('\n', start - 1) + 1;
          const lineEnd = end === start ? (body.value.indexOf('\n', end) < 0 ? body.value.length : body.value.indexOf('\n', end)) : end;
          const text = body.value.slice(lineStart, lineEnd);
          replacement = text.split('\n').map(line => prefix + line).join('\n');
          body.setSelectionRange(lineStart, lineEnd); selectionStart = prefix.length; selectionEnd = replacement.length;
        } else {
          const pad = start && body.value[start - 1] !== '\n' ? '\n' : '';
          replacement = pad + (action === 'code' ? '```\n' + (selected || '代码内容') + '\n```\n' : '| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n');
          selectionStart = action === 'code' ? pad.length + 4 : pad.length; selectionEnd = action === 'code' ? selectionStart + (selected || '代码内容').length : replacement.length;
        }
        const insertionStart = body.selectionStart;
        body.setRangeText(replacement, body.selectionStart, body.selectionEnd, 'end');
        body.focus(); body.setSelectionRange(insertionStart + selectionStart, insertionStart + selectionEnd);
        body.dispatchEvent(new Event('input', { bubbles: true }));
      };
      root.querySelectorAll('[data-format]').forEach(button => { button.onmousedown = e => e.preventDefault(); button.onclick = () => insert(button.dataset.format); });
      body.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && ['b','i','k'].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopPropagation(); insert({b:'bold',i:'italic',k:'link'}[e.key.toLowerCase()]); }
        else if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); body.setRangeText('  ', body.selectionStart, body.selectionEnd, 'end'); body.dispatchEvent(new Event('input', { bubbles: true })); }
      });
      if (isIdea) { title.addEventListener('input', capture); get('.doc-status').addEventListener('change', capture); get('.doc-tags').addEventListener('input', capture); }
      retry.onclick = () => { void flush(); };
      const controller = {
        async flush() { await flush(); return !state.pending && !state.error && !state.conflict && !state.busy; },
        async leave() { await flush(); if (state.pending || state.error || state.conflict || state.busy) { status(state.conflict ? '请先处理冲突' : '请先完成保存', true); return false; } state.closed = true; clearTimeout(state.timer); clearTimeout(previewTimer); if (current === controller) current = null; return true; },
        hasUnsaved() { return !!(state.pending || state.busy || state.error || state.conflict); }
      };
      get('.doc-related').onclick = () => SemanticUI.related(path);
      if (isIdea) get('.doc-plan').onclick = async () => {
        if (await controller.flush()) await TaskPlanUI.open(path);
      };
      let navigating = false;
      const navigate = async callback => {
        if (navigating || typeof callback !== 'function') return;
        navigating = true;
        const buttons = [get('.doc-back'), get('.doc-sidebar')].filter(Boolean);
        buttons.forEach(button => { button.disabled = true; });
        lockFields(true);
        try { if (await controller.leave()) await callback(); }
        finally { navigating = false; buttons.forEach(button => { button.disabled = false; }); lockFields(false); setMode(mode); }
      };
      get('.doc-back').onclick = () => navigate(onBack);
      if (get('.doc-sidebar')) get('.doc-sidebar').onclick = () => navigate(onSidebar);
      if (isIdea) { title.readOnly = true; get('.doc-status').disabled = true; get('.doc-tags').readOnly = true; }
      render(); current = controller; return controller;
    } finally { opening = false; }
  }
  window.DocPage = { open, current: () => current };
})();
