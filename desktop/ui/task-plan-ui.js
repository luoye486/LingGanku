/* Integration: load after app.js; TaskPlanUI.open(path) opens without network traffic. */
(function (global) {
  'use strict';
  let current = null;
  const text = value => value == null ? '' : String(value);
  const node = (tag, cls, value) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (value !== undefined) el.textContent = text(value);
    return el;
  };
  const button = (cls, label, action) => {
    const el = node('button', cls, label);
    el.type = 'button'; el.onclick = action;
    return el;
  };
  function uuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (!global.crypto || !global.crypto.getRandomValues) throw new Error('无法生成安全请求编号，请使用安全上下文后重试。');
    global.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  }
  function open(path) {
    if (current) {
      if (current.busy) return;
      // Keep a pending idempotent request reachable; do not discard it by reopening.
      if (current.pending) { current.panel.focus(); return; }
      current.close();
    }
    const sourcePath = text(path);
    const source = [...(S.ideas || []), ...(S.tasks || []), ...(S.notes || []), ...(S.boot?.recent || [])].find(item => item.path === sourcePath);
    const sourceTitle = text(source?.title || (S.drawer?.path === sourcePath && S.drawer?.note?.title) || sourcePath);
    const previousFocus = document.activeElement;
    let preview = null, steps = [], edited = false, frozen = null, succeeded = false, conflict = false;
    let created = [];
    const shell = node('div', 'taskplan-overlay');
    const panel = node('section', 'taskplan-dialog');
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'taskplan-heading');
    panel.setAttribute('aria-describedby', 'taskplan-help');
    const heading = node('h2', '', '拆解为任务'); heading.id = 'taskplan-heading';
    const closeButton = button('taskplan-close', '×', close);
    closeButton.setAttribute('aria-label', '关闭任务拆解');
    const head = node('header', 'taskplan-head'); head.append(heading, closeButton);
    const content = node('div', 'taskplan-content');
    const help = node('p', 'taskplan-help', '生成仅预览，不写入来源。点击“创建全部任务”后才会新建任务，并保留来源链接；来源内容保持不变。');
    help.id = 'taskplan-help';
    const sourceBox = node('div', 'taskplan-source');
    sourceBox.append(node('strong', '', sourceTitle), node('div', 'taskplan-path', sourcePath));
    const mode = node('p', 'taskplan-help');
    const extra = node('textarea', 'area taskplan-extra'); extra.rows = 2;
    extra.placeholder = '例如：先做最小可用版本（可留空）'; extra.id = 'taskplan-extra';
    const extraLabel = node('label', 'taskplan-field', '补充要求（可选）'); extraLabel.htmlFor = extra.id;
    extraLabel.append(extra);
    const generate = button('btn taskplan-generate', '生成预览', generatePreview);
    const status = node('p', 'taskplan-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const model = node('p', 'taskplan-help');
    const list = node('div', 'taskplan-steps');
    const add = button('btn taskplan-add', '添加步骤', () => {
      if (d.busy || frozen || steps.length >= 12) return;
      steps.push({ title: '', body: '', priority: 'mid', due: '' }); edited = true;
      renderSteps(); list.lastElementChild.querySelector('input').focus();
    });
    const count = node('span', 'taskplan-count');
    const apply = button('btn primary taskplan-apply', '创建全部任务', applyPreview);
    const actions = node('div', 'taskplan-actions'); actions.append(count, add, apply);
    const results = node('div', 'taskplan-created');
    content.append(help, sourceBox, mode, extraLabel, generate, status, model, list, actions, results);
    panel.append(head, content); shell.append(panel);
    const d = { shell, panel, busy: false, pending: false, close };
    current = d;
    function update() {
      const locked = !!frozen || succeeded;
      closeButton.disabled = d.busy;
      generate.disabled = d.busy || !sourcePath || succeeded || (!!frozen && !conflict);
      extra.disabled = d.busy || locked;
      add.hidden = !preview; apply.hidden = !preview;
      add.disabled = d.busy || locked || steps.length >= 12;
      apply.disabled = d.busy || succeeded || conflict || !preview || !steps.length;
      apply.textContent = succeeded ? '已创建任务' : frozen ? '重试同一创建请求' : '创建全部任务';
      count.textContent = preview ? '将保存全部 ' + steps.length + ' 个步骤（1–12 个，可移除）' : '';
      list.querySelectorAll('input,textarea,select,button').forEach(el => { el.disabled = d.busy || locked; });
      panel.setAttribute('aria-busy', String(d.busy));
      shell.dataset.busy = String(d.busy);
    }
    function setBusy(on) { d.busy = on; update(); if (on) panel.focus(); }
    function message(value, error) { status.textContent = value; status.classList.toggle('error', !!error); }
    function close() {
      if (d.busy) return;
      // Keep retry identity and payload when dismissed and reopened.
      shell.remove(); document.removeEventListener('keydown', onKey, true);
      if (current === d && !d.pending) current = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    }
    function onKey(event) {
      // Host confirm owns its own focus trap while our request is waiting for consent.
      if (d.busy && !shell.contains(document.activeElement)) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation(); close();
      } else if (event.key === 'Tab') {
        const controls = [...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')].filter(el => !el.hidden && el.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    }
    function renderSteps() {
      list.replaceChildren();
      steps.forEach((step, index) => {
        const card = node('fieldset', 'taskplan-step');
        card.append(node('legend', '', '步骤 ' + (index + 1)));
        function field(label, key, tag, type) {
          const wrapper = node('label', 'taskplan-field', label);
          const input = node(tag || 'input', tag === 'textarea' ? 'area' : 'input');
          if (type) input.type = type;
          if (tag === 'textarea') input.rows = 3;
          input.value = step[key];
          input.oninput = () => { step[key] = input.value; edited = true; };
          wrapper.append(input); card.append(wrapper); return input;
        }
        const title = field('标题（必填）', 'title'); title.required = true;
        field('内容', 'body', 'textarea');
        const row = node('div', 'taskplan-step-meta');
        const priorityLabel = node('label', 'taskplan-field', '优先级');
        const priority = node('select', 'select');
        [['high', '重要'], ['mid', '普通'], ['low', '有空再说']].forEach(([value, label]) => {
          const option = node('option', '', label); option.value = value; priority.append(option);
        });
        priority.value = step.priority;
        priority.onchange = () => { step.priority = priority.value; edited = true; };
        priorityLabel.append(priority); row.append(priorityLabel);
        const dueLabel = node('label', 'taskplan-field', '截止日期（可选）');
        const due = node('input', 'input'); due.type = 'date'; due.value = step.due;
        due.oninput = () => { step.due = due.value; edited = true; };
        dueLabel.append(due); row.append(dueLabel);
        const remove = button('btn taskplan-remove', '移除步骤 ' + (index + 1), () => {
          if (d.busy || frozen) return;
          steps.splice(index, 1); edited = true; renderSteps();
          (list.children[Math.min(index, steps.length - 1)]?.querySelector('input') || add).focus();
        });
        card.append(row, remove); list.append(card);
      });
      update();
    }
    function showCreated(items) {
      const known = new Map(created.map(item => [item.path, item]));
      (Array.isArray(items) ? items : []).forEach(item => { if (item && typeof item.path === 'string') known.set(item.path, { path: item.path, title: text(item.title || item.path) }); });
      created = [...known.values()]; results.replaceChildren();
      if (!created.length) return;
      results.append(node('h3', '', '已创建 ' + created.length + ' 个任务'));
      const ul = node('ul');
      created.forEach(item => {
        const li = node('li');
        if (typeof openTask === 'function') {
          li.append(button('taskplan-open-task', item.title, async () => {
            if (d.busy) return;
            close();
            try { await openTask(item.path); } catch (e) { if (typeof toast === 'function') toast('打开任务失败：' + text(e.message), 'error'); }
          }));
        } else li.append(node('strong', '', item.title));
        li.append(node('div', 'taskplan-path', item.path)); ul.append(li);
      });
      results.append(ul);
    }
    async function generatePreview() {
      if (generate.disabled || d.busy) return;
      setBusy(true);
      const requestedExtra = extra.value.trim();
      try {
        if (conflict && created.length && !await confirm('此前已创建 ' + created.length + ' 个任务。重新生成会开启一个新的创建请求，已有任务会保留；请核对并移除重复步骤。是否继续重新生成？')) return;
        if (edited && !await confirm('重新生成将替换已编辑的步骤预览，是否继续？')) return;
        const ai = S.boot?.config?.ai || {};
        if (ai.provider === 'openai') {
          message('等待本次远程发送授权…');
          if (!await confirm('将读取来源“' + sourceTitle + '”（' + sourcePath + '）的标题和正文，并将来源文本及补充要求发送到配置的 AI 地址与模型。\n地址：' + text(ai.base_url || '未配置') + '\n模型：' + text(ai.model || '未配置') + '\n补充要求：' + (requestedExtra || '无') + '\n本次仅生成预览，不写入来源。是否同意本次发送？')) { message('已取消，未发送生成请求。'); return; }
        }
        message('正在生成预览…');
        const data = await api('/api/task/plan', { method: 'POST', body: { path: sourcePath, extra: requestedExtra } });
        if (!data || data.path !== sourcePath || data.base_mtime == null || !Array.isArray(data.steps) || data.steps.length < 1 || data.steps.length > 12) throw new Error('接口返回的预览无效（需要同一来源和 1–12 个步骤）。');
        const next = data.steps.map(step => {
          if (!step || typeof step.title !== 'string') throw new Error('接口返回的步骤无效。');
          return { title: step.title, body: text(step.body), priority: ['high', 'mid', 'low'].includes(step.priority) ? step.priority : 'mid', due: /^\d{4}-\d{2}-\d{2}$/.test(text(step.due)) ? step.due : '' };
        });
        preview = { path: sourcePath, base_mtime: data.base_mtime };
        steps = next; edited = false; frozen = null; d.pending = false; conflict = false; created = [];
        results.replaceChildren();
        model.textContent = '生成方式：' + (ai.provider === 'openai' ? '远程 AI' : '本地规则（非远程 AI）') + ' · 模型：' + text(data.model || '本地规则');
        renderSteps(); message('预览已生成，尚未创建任务。可编辑、添加或移除步骤；未指定的日期保持为空。');
      } catch (e) { message('生成失败，现有预览已保留：' + text(e.message || e), true); }
      finally { setBusy(false); }
    }
    async function applyPreview() {
      if (apply.disabled || d.busy || !preview) return;
      if (!frozen) {
        if (steps.length < 1 || steps.length > 12 || steps.some(step => !step.title.trim() || !step.body.trim())) { message('请保留 1–12 个步骤，并填写每个步骤的标题和内容。', true); return; }
        const invalid = [...list.querySelectorAll('input')].find(input => !input.checkValidity());
        if (invalid) { invalid.reportValidity(); invalid.focus(); return; }
        try {
          frozen = Object.freeze({ path: preview.path, base_mtime: preview.base_mtime, steps: Object.freeze(steps.map(step => Object.freeze({ title: step.title.trim(), body: step.body, priority: step.priority, due: step.due }))), request_id: uuid() });
          d.pending = true;
        } catch (e) { message(text(e.message), true); return; }
      }
      setBusy(true); message('正在创建任务…');
      try {
        const data = await api('/api/task/plan/apply', { method: 'POST', body: frozen });
        showCreated(data?.items);
        if (data?.ok !== true) { const error = new Error(text(data?.error || '创建尚未全部完成')); error.data = data; throw error; }
        succeeded = true; d.pending = false;
        message('已创建 ' + created.length + ' 个任务' + (data.reused ? '（已恢复同一请求的结果）' : '') + '。来源保持不变。');
        try { await reload(true); } catch (_) { message('任务已创建，但列表刷新失败，请手动刷新。'); }
      } catch (e) {
        const detail = e.data || e.details || e.response || e;
        showCreated(detail.items || e.items);
        conflict = /E_CONFLICT/.test(text(detail.code || e.code) + ' ' + text(detail.error || e.message));
        const prefix = created.length ? '已创建 ' + created.length + ' / ' + frozen.steps.length + ' 个任务。' : '尚未确认已创建的任务数量。';
        message(prefix + (conflict ? '来源已变更（E_CONFLICT），不能强制应用。请重新生成预览后再创建。' + (created.length ? '已有部分任务，请先核对；当前请求已保留。' : '') : '本次请求编号和内容已锁定。请点击“重试同一创建请求”，系统将复用编号避免重复创建。') + '\n' + text(e.message || e), true);
        if (created.length) { try { await reload(true); } catch (_) { /* Preserve the retry state. */ } }
      } finally { setBusy(false); }
    }
    // Reattach a dismissed pending modal, retaining the exact request and editor state.
    d.restore = () => { document.body.append(shell); document.addEventListener('keydown', onKey, true); panel.focus(); };
    const ai = S.boot?.config?.ai || {};
    mode.textContent = ai.provider === 'openai' ? '远程 AI：生成前将询问是否发送来源正文与补充要求。' : '本地规则：仅在本机拆解，不调用远程 AI。';
    shell.onclick = event => { if (event.target === shell) close(); };
    document.body.append(shell); document.addEventListener('keydown', onKey, true);
    update(); closeButton.focus();
  }
  global.TaskPlanUI = Object.freeze({ open(path) {
    if (current?.pending && !current.shell.isConnected) { current.restore(); return; }
    return open(path);
  } });
})(window);
