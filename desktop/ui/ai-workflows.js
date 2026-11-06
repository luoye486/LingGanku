/* Independent AI workflow dialogs. Host integration: AIWorkflows.openAssets(paths), openIdeas(). */
(function (global) {
  'use strict';
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const post = (url, body) => api(url, { method: 'POST', body });
  let current = null;

  function dialog(title) {
    if (current && (current.dataset.busy === 'true' || current.dataset.confirming === 'true')) return null;
    if (current) current.aiwfClose();
    const shell = document.createElement('div');
    shell.className = 'aiwf-overlay';
    shell.innerHTML = `<section class="aiwf-dialog" role="dialog" aria-modal="true" aria-labelledby="aiwf-title"><header class="aiwf-head"><h2 id="aiwf-title">${escape(title)}</h2><button type="button" class="aiwf-close" aria-label="关闭" title="关闭">×</button></header><div class="aiwf-content"></div></section>`;
    document.body.appendChild(shell);
    const previousFocus = document.activeElement;
    const close = () => { if (shell.dataset.busy === 'true' || shell.dataset.confirming === 'true') return; shell.remove(); if (current === shell) current = null; document.removeEventListener('keydown', onKey); if (previousFocus && previousFocus.isConnected) previousFocus.focus(); };
    shell.aiwfClose = close;
    const onKey = e => { if (e.key === 'Escape') close(); };
    shell.querySelector('.aiwf-close').onclick = close;
    shell.onclick = e => { if (e.target === shell) close(); };
    document.addEventListener('keydown', onKey);
    current = shell;
    shell.querySelector('.aiwf-close').focus();
    return { shell, content: shell.querySelector('.aiwf-content'), close };
  }
  function busy(d, on) {
    d.shell.dataset.busy = String(on);
    d.shell.querySelectorAll('button,input,textarea').forEach(el => { if (on) { el.dataset.wasDisabled = String(el.disabled); el.disabled = true; } else if ('wasDisabled' in el.dataset) { el.disabled = el.dataset.wasDisabled === 'true'; delete el.dataset.wasDisabled; } });
  }
  function message(root, text, error) {
    const el = root.querySelector('.aiwf-message');
    el.textContent = text || '';
    el.classList.toggle('error', !!error);
  }
  function problems(failed) {
    if (!failed || !failed.length) return '';
    return `<div class="aiwf-fail" role="alert"><b>未完成 ${failed.length} 项</b><ul>${failed.map(f => `<li>${escape(f.path)}：${escape(f.error || '未知错误')}</li>`).join('')}</ul></div>`;
  }
  async function refresh() {
    try { await reload(true); } catch (_) { /* The write succeeded; host can refresh later. */ }
  }

  function openAssets(paths) {
    const chosen = [...new Set(Array.from(paths || []))];
    const d = dialog('AI 素材分析');
    if (!d) return;
    let items = [];
    const applied = new Set();
    const unchecked = new Set();
    const attempted = new Set();
    let applyFailures = [];
    let analysisFailures = [];
    let active = false;
    let stopRequested = false;
    let progress = { completed: 0, total: 0, path: '', phase: '分析' };
    d.content.innerHTML = `<p class="aiwf-muted">已选 ${chosen.length} 个素材，每次最多 8 个。逐项分析，预览不会自动应用标签。图片仅在启用并支持视觉时发送图像；其他情况仅依据文件信息分析，结果需人工核对。</p><div class="aiwf-selected">${chosen.map(p => `<div>${escape(p)}</div>`).join('') || '未选择素材'}</div><div class="aiwf-actions"><button class="btn primary" data-run ${!chosen.length || chosen.length > 8 ? 'disabled' : ''}>分析并预览</button><button class="btn" data-retry-failed hidden>仅重试失败项</button><button class="btn" data-stop-after-current hidden>完成当前项后停止</button></div><div class="aiwf-progress" hidden><progress data-progress value="0" max="1" aria-label="已完成项数"></progress><span data-progress-count></span><div class="aiwf-path" data-current-file></div></div><p class="aiwf-message" role="status" aria-live="polite"></p><div class="aiwf-results"></div>`;
    const results = d.content.querySelector('.aiwf-results');
    const runButton = d.content.querySelector('[data-run]');
    const retryButton = d.content.querySelector('[data-retry-failed]');
    const stopButton = d.content.querySelector('[data-stop-after-current]');
    function showProgress() {
      d.content.querySelector('.aiwf-progress').hidden = false;
      const bar = d.content.querySelector('[data-progress]');
      bar.max = Math.max(1, progress.total); bar.value = progress.completed;
      d.content.querySelector('[data-progress-count]').textContent = `${progress.phase}已完成 ${progress.completed} / ${progress.total}`;
      d.content.querySelector('[data-current-file]').textContent = progress.path ? `当前文件：${progress.path}` : '';
      message(d.content, stopRequested ? '已请求停止，当前请求仍在进行；完成当前项后停止，不会发送下一项。' : `${progress.phase}中：已完成 ${progress.completed} / ${progress.total}${progress.path ? ' · ' + progress.path : ''}`);
    }
    function syncControls() {
      runButton.hidden = chosen.length > 0 && chosen.every(p => attempted.has(p));
      runButton.textContent = attempted.size ? '继续未分析项' : '分析并预览';
      runButton.disabled = active || !chosen.length || chosen.length > 8;
      retryButton.hidden = !analysisFailures.length;
      retryButton.disabled = active;
      stopButton.hidden = !active;
      stopButton.disabled = stopRequested;
      stopButton.textContent = stopRequested ? '等待当前项完成…' : '完成当前项后停止';
      results.querySelectorAll('[data-apply]').forEach(el => { el.disabled = active || applied.has(items[Number(el.dataset.apply)].path); });
      const applyButton = results.querySelector('[data-apply-selected]');
      if (applyButton) applyButton.disabled = active;
    }
    function renderResults() {
      results.innerHTML = `${items.length ? '<h3>分析结果</h3><p class="aiwf-muted">应用会保留现有标签并追加预览标签；摘要与用途将一并保存，方便后续查找。标签最多 12 个。</p>' : ''}${items.map((it, i) => `<article class="aiwf-result"><div class="aiwf-result-head"><b>${escape(it.name || it.path)}</b><span>${applied.has(it.path) ? '已应用' : (it.vision ? '视觉分析' : '仅文件信息')}</span></div><div class="aiwf-path">${escape(it.path)}</div>${it.vision_error ? `<p class="aiwf-warning">视觉分析失败，已回退到文件信息：${escape(it.vision_error)}</p>` : ''}<p>${escape(it.summary || '无摘要')}</p>${it.use ? `<p class="aiwf-muted">用途：${escape(it.use)}</p>` : ''}<div class="aiwf-tags">${(it.tags || []).map(t => `<span>${escape(t)}</span>`).join('') || '<span>没有建议标签</span>'}</div><label><input type="checkbox" data-apply="${i}" ${applied.has(it.path) || unchecked.has(it.path) ? '' : 'checked'}> 应用此项标签</label></article>`).join('')}${problems(analysisFailures)}${problems(applyFailures)}${items.some(it => !applied.has(it.path)) ? '<div class="aiwf-actions"><button class="btn primary" data-apply-selected>应用勾选标签</button></div>' : ''}`;
      results.querySelectorAll('[data-apply]').forEach(el => { el.onchange = () => { const path = items[Number(el.dataset.apply)].path; if (el.checked) unchecked.delete(path); else unchecked.add(path); }; });
      const btn = results.querySelector('[data-apply-selected]');
      if (btn) btn.onclick = applySelected;
      syncControls();
    }
    stopButton.onclick = () => { if (!active) return; stopRequested = true; syncControls(); showProgress(); };
    runButton.onclick = () => analyze(chosen.filter(p => !attempted.has(p)));
    retryButton.onclick = () => analyze(analysisFailures.map(f => f.path));
    async function analyze(queue) {
      // Lock before asynchronous consent, without presenting analysis as already running.
      if (active || !queue.length || chosen.length > 8) return;
      active = true; d.shell.dataset.confirming = 'true'; syncControls(); stopButton.hidden = true;
      try {
        if (S.boot?.config?.ai?.provider === 'openai' && !await confirm('将所选素材的文件信息发送到已配置的 AI 接口。启用视觉分析时，图片也会发送。是否继续？')) return;
        d.shell.dataset.confirming = 'false'; busy(d, true); stopRequested = false;
        progress = { completed: 0, total: queue.length, path: '', phase: '分析' }; syncControls();
        for (const path of queue) {
          if (stopRequested) break;
          progress.path = path; showProgress();
          try {
            const res = await post('/api/asset/ai-tags', { paths: [path], apply: false });
            const item = Array.isArray(res.items) && res.items.find(it => it.path === path);
            const failure = Array.isArray(res.failed) && res.failed.find(it => it.path === path);
            if (!item) throw new Error(failure?.error || '接口未返回此素材的可用结果');
            items = items.filter(it => it.path !== path).concat(item);
            analysisFailures = analysisFailures.filter(it => it.path !== path);
          } catch (e) {
            analysisFailures = analysisFailures.filter(it => it.path !== path).concat({ path, error: e.message || '分析失败' });
          }
          attempted.add(path); progress.completed++; renderResults(); showProgress();
        }
        progress.path = ''; showProgress();
        message(d.content, `${stopRequested ? '已停止；' : ''}分析已完成 ${progress.completed} / ${progress.total}，成功预览 ${items.length} 项，失败 ${analysisFailures.length} 项。尚未自动应用标签。${chosen.some(p => !attempted.has(p)) ? '可继续未分析项。' : ''}`, !!analysisFailures.length);
      } catch (e) { message(d.content, '分析未开始或意外中断：' + e.message, true); }
      finally { d.shell.dataset.confirming = 'false'; busy(d, false); active = false; syncControls(); }
    }
    async function applySelected() {
      if (active) return;
      const selected = [...results.querySelectorAll('[data-apply]:checked')].map(el => items[Number(el.dataset.apply)]).filter(it => it && !applied.has(it.path));
      if (!selected.length) { message(d.content, '请选择要应用的素材。', true); return; }
      active = true; stopRequested = false; busy(d, true); applyFailures = [];
      progress = { completed: 0, total: selected.length, path: '', phase: '应用' }; syncControls(); showProgress();
      try {
        await reload(true);
        for (const it of selected) {
          if (stopRequested) break;
          progress.path = it.path; showProgress();
          try {
            const latest = S.assets.find(a => a.path === it.path);
            if (!latest) throw new Error('素材不存在或已变更');
            const merged = [...new Set([...(latest.tags || []), ...(it.tags || [])])];
            if (merged.length > 12) throw new Error('合并后超过 12 个标签，请先整理现有标签');
            await post('/api/asset/tags', { path: it.path, tags: merged, ai_note: [it.summary, it.use ? '适用：' + it.use : ''].filter(Boolean).join('｜') }); applied.add(it.path);
          } catch (e) { applyFailures.push({ path: it.path, error: e.message || '应用失败' }); }
          progress.completed++; renderResults(); showProgress();
        }
        await refresh(); progress.path = ''; showProgress();
        message(d.content, `${stopRequested ? '已停止；' : ''}应用已完成 ${progress.completed} / ${progress.total}，失败 ${applyFailures.length} 项。${applyFailures.length ? '请查看失败项。' : ''}`, !!applyFailures.length);
      } catch (e) { message(d.content, '读取最新素材失败，未应用标签：' + e.message, true); }
      finally { busy(d, false); active = false; renderResults(); }
    }
    if (chosen.length > 8) message(d.content, '一次最多分析 8 个素材，请返回调整选择。', true);
  }

  function openIdeas(initialPaths) {
    const d = dialog('合成想法');
    if (!d) return;
    let previewPending = false;
    const chosen = new Set(Array.from(initialPaths || []).filter(p => S.ideas.some(i => i.path === p)));
    let preview = null;
    let saved = null;
    let task = null;
    d.content.innerHTML = `<p class="aiwf-muted">选择 2–8 条想法。预览不会保存，确认后才会新建想法。</p><div class="aiwf-list">${S.ideas.map((idea, i) => `<label class="aiwf-choice"><input type="checkbox" data-idea-index="${i}" ${chosen.has(idea.path) ? 'checked' : ''}><span><b>${escape(idea.title || idea.path)}</b><small>${escape(idea.excerpt || idea.path)}</small></span></label>`).join('') || '<p>还没有想法</p>'}</div><div class="aiwf-row"><label for="aiwf-extra">合成方向（可选）</label><input id="aiwf-extra" class="input" type="text" placeholder="例如：偏产品方向"></div><div class="aiwf-actions"><span class="aiwf-count"></span><button class="btn primary" data-preview>生成预览</button></div><p class="aiwf-message" role="status" aria-live="polite"></p><div class="aiwf-results"></div>`;
    const result = d.content.querySelector('.aiwf-results');
    const extra = d.content.querySelector('#aiwf-extra');
    const previewButton = d.content.querySelector('[data-preview]');
    function update() {
      d.content.querySelector('.aiwf-count').textContent = `已选 ${chosen.size} / 8`;
      previewButton.disabled = previewPending || d.shell.dataset.busy === 'true' || chosen.size < 2 || chosen.size > 8 || !!saved;
    }
    d.content.querySelectorAll('[data-idea-index]').forEach(el => el.onchange = () => {
      const path = S.ideas[Number(el.dataset.ideaIndex)].path;
      if (el.checked) chosen.add(path); else chosen.delete(path);
      preview = null; result.innerHTML = ''; message(d.content, ''); update();
    });
    extra.oninput = () => { preview = null; result.innerHTML = ''; message(d.content, ''); };
    function showPreview() {
      result.innerHTML = `<div class="aiwf-preview"><div class="aiwf-row"><label for="aiwf-title-input">标题</label><input class="input" id="aiwf-title-input" value="${escape(preview.title)}"></div><div class="aiwf-row"><label for="aiwf-text">合成内容</label><textarea class="area" id="aiwf-text" rows="12">${escape(preview.text)}</textarea></div><p class="aiwf-muted">模型：${escape(preview.model || '未知')} · 保存时会保留所选来源。</p><div class="aiwf-actions"><button class="btn primary" data-save>保存为新想法</button></div></div>`;
      result.querySelector('[data-save]').onclick = save;
    }
    function showSaved() {
      result.innerHTML = `<div class="aiwf-success"><b>已保存：${escape(saved.idea.title || saved.title)}</b><div class="aiwf-path">${escape(saved.idea.path)}</div>${task ? `<p>已创建任务：${escape(task.title || task.path || '')}</p>` : '<div class="aiwf-actions"><button class="btn" data-task>转为任务</button></div>'}</div>`;
      const btn = result.querySelector('[data-task]');
      if (btn) btn.onclick = createTask;
    }
    previewButton.onclick = async () => {
      if (previewPending || d.shell.dataset.busy === 'true' || saved || chosen.size < 2 || chosen.size > 8) return;
      previewPending = true; d.shell.dataset.confirming = 'true'; update();
      const selectedPaths = [...chosen];
      const direction = extra.value.trim();
      try {
        if (S.boot?.config?.ai?.provider === 'openai' && !await confirm('将所选想法的内容和合成方向发送到已配置的 AI 接口。是否继续？')) return;
        d.shell.dataset.confirming = 'false';
        busy(d, true); message(d.content, '正在合成…'); result.innerHTML = ''; preview = null;
        const response = await post('/api/idea/synthesize', { paths: selectedPaths, extra: direction, save: false });
        if (response.saved || !response.text) throw new Error('接口未返回可用预览');
        preview = { title: response.title || '', text: response.text, model: response.model, paths: selectedPaths };
        showPreview(); message(d.content, '预览已生成，尚未保存。');
      } catch (e) { message(d.content, '合成失败：' + e.message, true); }
      finally { previewPending = false; d.shell.dataset.confirming = 'false'; busy(d, false); update(); }
    };
    async function save() {
      if (previewPending || d.shell.dataset.busy === 'true' || saved || !preview) return;
      const title = result.querySelector('#aiwf-title-input').value.trim();
      const text = result.querySelector('#aiwf-text').value.trim();
      if (!title || !text) { message(d.content, '标题和内容不能为空。', true); return; }
      busy(d, true); message(d.content, '正在保存…');
      try {
        const response = await post('/api/idea/synthesize', { paths: preview.paths, title, text, save: true, create_task: false });
        if (!response.saved || !response.idea || !response.idea.path) throw new Error('未收到已保存的想法路径，请刷新列表核对后再试');
        saved = response;
        await refresh(); showSaved(); message(d.content, '想法已保存。');
      } catch (e) { message(d.content, '保存失败：' + e.message, true); }
      finally { busy(d, false); update(); if (saved) { d.content.querySelectorAll('[data-idea-index]').forEach(el => { el.disabled = true; }); extra.disabled = true; } }
    }
    async function createTask() {
      if (previewPending || d.shell.dataset.busy === 'true' || task || !saved) return;
      busy(d, true); message(d.content, '正在创建任务…');
      try {
        task = await post('/api/task/from-idea', { path: saved.idea.path });
        await refresh(); showSaved(); message(d.content, '任务已创建。');
      } catch (e) { message(d.content, '任务创建失败，已保存的想法不受影响：' + e.message, true); }
      finally { busy(d, false); }
    }
    update();
  }
  global.AIWorkflows = Object.freeze({ openAssets, openIdeas });
})(window);
