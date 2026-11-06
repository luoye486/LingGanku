/* Host loads after app.js: MediaUI.open(path). Requires api, S, reload, confirm. */
(function (global) {
  'use strict';
  let current = null;
  const string = value => value == null ? '' : String(value);
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = string(text);
    return node;
  };
  const button = (className, text) => {
    const node = element('button', className, text);
    node.type = 'button';
    return node;
  };
  const post = (url, body) => api(url, { method: 'POST', body });
  const first400 = text => Array.from(text).slice(0, 400).join('');
  function errorText(error) {
    return string(error && error.message || error || '未知错误');
  }
  async function refresh() {
    try { await reload(true); return true; }
    catch (_) { return false; } // A completed write must not become a retryable failure.
  }

  function open(path) {
    if (current) {
      if (current.busy) return;
      current.close();
    }
    const sourcePath = typeof path === 'string' ? path : '';
    const asset = (S.assets || []).find(item => item.path === sourcePath);
    const ext = string(asset && asset.ext || sourcePath.split('.').pop()).replace(/^\./, '').toLowerCase();
    const kind = asset && ['audio', 'video'].includes(asset.kind) ? asset.kind
      : /^(mp3|wav|ogg|flac|m4a|aac|opus|aiff|aif|wma)$/.test(ext) ? 'audio'
      : /^(mp4|webm|mov|mkv|avi|m4v|mpeg|mpg|wmv)$/.test(ext) ? 'video' : '';
    const ai = S.boot?.config?.ai || {};
    // Freeze primitives: reloads and subsequent selections cannot redirect a pending write.
    const source = Object.freeze({
      path: sourcePath,
      filename: sourcePath.split(/[\\/]/).pop() || '未命名',
      kind,
      mode: kind === 'audio' ? 'transcribe' : 'video',
      model: string(kind === 'audio' ? ai.transcription_model : ai.vision_model || ai.model).trim(),
      endpoint: string(kind === 'audio' ? ai.transcription_base_url || ai.base_url : ai.base_url).trim().replace(/\/+$/, '').replace(/\/(chat\/completions|audio\/transcriptions|models)$/, ''),
      vision: ai.vision === true,
      provider: ai.provider,
    });
    const previousFocus = document.activeElement;
    const shell = element('div', 'media-overlay');
    const panel = element('section', 'media-dialog');
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'media-title');
    panel.setAttribute('aria-describedby', 'media-disclosure');
    const head = element('header', 'media-head');
    const title = element('h2', '', kind === 'audio' ? '音频转写' : kind === 'video' ? '视频分析' : '媒体分析');
    title.id = 'media-title';
    const closeButton = button('media-close', '×');
    closeButton.setAttribute('aria-label', '关闭媒体分析');
    const content = element('div', 'media-content');
    const sourceLabel = element('p', 'media-source', source.filename);
    const sourceDetail = element('p', 'media-path', source.path);
    const disclosure = element('p', 'media-help', kind === 'audio'
      ? '转写会将完整音频文件上传到配置的 AI 接口，可能产生费用。结果仅供预览，不会自动写入。'
      : '视频分析仅发送 最多 3 张采样帧，不上传完整视频或音轨，不进行音频转写；无法代表全部视频内容，可能产生费用。结果不会自动写入。');
    disclosure.id = 'media-disclosure';
    const versioned = /\/v[a-z0-9]+$/i.test(source.endpoint) || /\/openai$/i.test(source.endpoint) || /\/(v1|v4|v1beta|api\/paas)\//i.test(source.endpoint);
    const endpoint = source.endpoint + (versioned ? '' : '/v1') + (kind === 'audio' ? '/audio/transcriptions' : '/chat/completions');
    const configLabel = element('p', 'media-config', '接口：' + (source.endpoint ? endpoint : '未配置 ai.base_url') + '\n模型：' + (source.model || '未配置'));
    const run = button('btn media-run', kind === 'audio' ? '转写并预览' : '分析视频并预览');
    const runActions = element('div', 'media-actions');
    runActions.append(run);
    const status = element('p', 'media-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const preview = element('div', 'media-preview');
    preview.hidden = true;
    const label = element('label', 'media-label', '预览内容（可编辑）');
    label.htmlFor = 'media-text';
    const editor = element('textarea', 'area media-text');
    editor.id = 'media-text';
    editor.rows = 14;
    const metadata = element('p', 'media-meta');
    const saveHelp = element('p', 'media-help', '“保存为想法”保留下方编辑后的完整内容，并关联当前素材。');
    const noteHelp = element('p', 'media-help');
    noteHelp.id = 'media-note-help';
    const save = button('btn primary media-save', '保存为想法');
    const note = button('btn media-note', '写入素材说明');
    note.setAttribute('aria-describedby', 'media-note-help');
    const saveActions = element('div', 'media-actions');
    saveActions.append(save, note);
    preview.append(label, editor, metadata, saveHelp, noteHelp, saveActions);
    content.append(sourceLabel, sourceDetail, disclosure, configLabel, runActions, status, preview);
    head.append(title, closeButton);
    panel.append(head, content);
    shell.append(panel);
    const d = { busy: false, close };
    let awaitingConsent = false;
    let hasPreview = false;
    let ideaSaved = false;
    let invalid = '';
    if (!asset || !source.path) invalid = '未找到来源素材，请刷新素材列表后重试。';
    else if (!kind) invalid = '此素材不是受支持的音频或视频。';
    else if (kind === 'video' && source.provider !== 'openai') invalid = '请在 AI 设置中选择 OpenAI 兼容接口模式。';
    else if (!source.endpoint) invalid = '请先配置 AI 接口地址（ai.base_url）。';
    else if (kind === 'audio' && !source.model) invalid = '请先配置音频转写模型（ai.transcription_model），普通对话模型不能替代转写模型。';
    else if (kind === 'video' && !source.vision) invalid = '请先启用视觉分析（ai.vision）。';
    else if (!source.model) invalid = '请先配置视觉模型（ai.vision_model 或 ai.model）。';

    function message(text, error) {
      status.textContent = text;
      status.classList.toggle('error', !!error);
    }
    function update() {
      panel.setAttribute('aria-busy', String(d.busy));
      shell.dataset.busy = String(d.busy);
      closeButton.disabled = d.busy;
      run.disabled = d.busy || !!invalid || ideaSaved;
      editor.disabled = d.busy;
      save.disabled = d.busy || !hasPreview || !editor.value.trim() || ideaSaved;
      note.disabled = d.busy || !hasPreview || !editor.value.trim();
      save.textContent = ideaSaved ? '已保存为想法' : '保存为想法';
      noteHelp.textContent = '“写入素材说明”会覆盖此素材的现有说明，仅写入编辑内容的前 400 个字符（按 Unicode 码点计算；当前将写入 ' + Array.from(first400(editor.value)).length + ' 个字符）。完整转写请保存为想法。';
    }
    function setBusy(value) {
      d.busy = value;
      update();
      if (value) panel.focus();
    }
    function close() {
      if (d.busy) return;
      shell.remove();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus, true);
      if (current === d) current = null;
      if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    }
    function onFocus(event) {
      if (!awaitingConsent && !shell.contains(event.target)) panel.focus();
    }
    function onKey(event) {
      // Let the host's awaited consent dialog own its keyboard and focus.
      if (awaitingConsent) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (event.key === 'Tab') {
        const controls = Array.from(panel.querySelectorAll('button:not(:disabled),textarea:not(:disabled)')).filter(node => !node.closest('[hidden]'));
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    }
    closeButton.onclick = close;
    shell.onclick = event => { if (event.target === shell) close(); };
    editor.oninput = update;
    run.onclick = async () => {
      if (d.busy || invalid || ideaSaved) return;
      setBusy(true);
      try {
        awaitingConsent = true;
        let approved;
        try {
          approved = await confirm((kind === 'audio'
            ? '即将上传完整音频文件进行转写。'
            : '即将发送视频的 最多 3 张采样帧进行分析；不上传完整视频或音轨，也不转写音频。采样帧不代表全部内容。')
            + '\n素材：' + source.path + '\n接口：' + endpoint + '\n模型：' + source.model
            + '\n服务提供方可能按用量收费。分析只生成预览，不会写入素材或想法。\n是否继续？取消将不发送请求。');
        } finally { awaitingConsent = false; }
        if (!approved) { message('已取消，未发送分析请求。'); return; }
        message(kind === 'audio' ? '正在转写完整音频…' : '正在分析 最多 3 张视频采样帧…');
        const result = await post('/api/media/analyze', { path: source.path, mode: source.mode });
        if (!result || result.path !== source.path || result.mode !== source.mode || typeof result.text !== 'string' || !result.text.trim()) {
          throw new Error('接口未返回与当前素材匹配的有效预览。');
        }
        editor.value = result.text;
        hasPreview = true;
        preview.hidden = false;
        metadata.textContent = '模型：' + string(result.model || source.model)
          + (kind === 'video' ? ' · 已分析 ' + (Array.isArray(result.frames) ? result.frames.length : 0) + ' 张采样帧，未分析音频或完整视频' : ' · 范围：音频转写')
          + (kind === 'video' && Array.isArray(result.frames) ? '\n采样时间：' + result.frames.map(frame => Number(frame.time_seconds) + ' 秒').join('、') : '');
        message('预览已生成，尚未保存。请核对并编辑内容。');
      } catch (error) { message('分析失败：' + errorText(error) + '\n已有预览仍保留，可继续编辑或保存。', true); }
      finally { setBusy(false); if (hasPreview) editor.focus(); else run.focus(); }
    };
    save.onclick = async () => {
      if (d.busy || ideaSaved || !hasPreview || !editor.value.trim()) return;
      const edited = editor.value;
      setBusy(true);
      message('正在保存完整内容为想法…');
      try {
        await post('/api/idea', { title: (kind === 'audio' ? '转写 · ' : '视频分析 · ') + source.filename, body: edited, assets: [source.path], tags: [] });
        ideaSaved = true; // Mark before refresh, so a refresh failure cannot cause duplicate writes.
        const refreshed = await refresh();
        message('想法已保存，完整内容和来源关联已保留。' + (refreshed ? '' : ' 列表刷新失败，请稍后手动刷新；无需重复保存。'));
      } catch (error) { message('保存想法失败：' + errorText(error) + '\n编辑内容仍保留，可重试。', true); }
      finally { setBusy(false); (ideaSaved ? editor : save).focus(); }
    };
    note.onclick = async () => {
      if (d.busy || !hasPreview || !editor.value.trim()) return;
      const aiNote = first400(editor.value);
      setBusy(true);
      message('正在写入素材说明（最多 400 个字符）…');
      try {
        await post('/api/asset/note', { path: source.path, ai_note: aiNote });
        const refreshed = await refresh();
        message('已将编辑内容的前 ' + Array.from(aiNote).length + ' 个字符写入素材说明。完整预览仍保留。' + (refreshed ? '' : ' 列表刷新失败，请稍后手动刷新。'));
      } catch (error) { message('写入素材说明失败：' + errorText(error) + '\n完整预览仍保留，可重试。', true); }
      finally { setBusy(false); note.focus(); }
    };
    document.body.append(shell);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    current = d;
    update();
    if (invalid) message(invalid, true);
    closeButton.focus();
  }
  global.MediaUI = Object.freeze({ open });
})(window);
