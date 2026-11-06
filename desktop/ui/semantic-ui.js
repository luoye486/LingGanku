/* Host loads after app.js. Public API: SemanticUI.search(q), SemanticUI.related(path). */
(function (global) {
  'use strict';
  const LIMIT = 12;
  let current = null;
  const text = value => value == null ? '' : String(value);
  const element = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = text(value);
    return node;
  };

  function dialog(title) {
    if (current) {
      if (current.busy) return null;
      current.close();
    }
    const previousFocus = document.activeElement;
    const shell = element('div', 'semantic-overlay');
    const panel = element('section', 'semantic-dialog');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'semantic-dialog-title');
    panel.tabIndex = -1;
    const head = element('header', 'semantic-head');
    const heading = element('h2', '', title);
    heading.id = 'semantic-dialog-title';
    const closeButton = element('button', 'semantic-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '关闭语义搜索');
    const content = element('div', 'semantic-content');
    const status = element('p', 'semantic-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    head.append(heading, closeButton);
    panel.append(head, status, content);
    shell.append(panel);
    const d = { shell, panel, content, status, busy: false, close };
    function close() {
      if (d.busy) return;
      shell.remove();
      document.removeEventListener('keydown', onKey, true);
      if (current === d) current = null;
      if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    }
    function onKey(event) {
      // An asynchronous host consent dialog may have focus outside this dialog.
      if (d.busy && !shell.contains(document.activeElement)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
      } else if (event.key === 'Tab') {
        const controls = Array.from(panel.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]'));
        const first = controls[0], last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    }
    closeButton.onclick = close;
    shell.onclick = event => { if (event.target === shell) close(); };
    document.body.append(shell);
    document.addEventListener('keydown', onKey, true);
    current = d;
    closeButton.focus();
    return d;
  }

  function busy(d, enabled) {
    d.busy = enabled;
    d.panel.setAttribute('aria-busy', String(enabled));
    d.shell.querySelectorAll('button').forEach(button => { button.disabled = enabled; });
    if (enabled) d.panel.focus();
  }

  function settings(d) {
    const button = element('button', 'semantic-settings', '打开 AI 设置');
    button.type = 'button';
    button.onclick = () => { d.close(); go('settings'); };
    d.content.append(button);
  }

  function errorMessage(error) {
    const raw = text(error && error.message || error);
    const code = raw.match(/E_SEMANTIC_[A-Z_]+/);
    if (!code) return '语义请求未完成。请检查网络、嵌入接口地址、模型和凭据后重试。' + (raw ? '\n' + raw : '');
    let action = '请检查 AI 设置中的嵌入模型、接口地址和凭据，再重试。';
    if (/DISABLED|CONFIG|MODEL|KEY|AUTH/.test(code[0])) action = '请在 AI 设置中启用嵌入，并检查模型、接口地址和凭据。';
    else if (/EMPTY|INDEX|COVERAGE|SOURCE|NOT_FOUND/.test(code[0])) action = '请确认当前库有可索引的笔记或素材元数据，并检查来源路径后重试。';
    else if (/RATE|LIMIT|QUOTA/.test(code[0])) action = '请检查接口额度或速率限制，稍后重试。';
    else if (/NETWORK|TIMEOUT|UPSTREAM|PROVIDER/.test(code[0])) action = '请检查嵌入服务是否可访问，稍后重试。';
    return code[0] + '：' + action + '\n' + raw;
  }

  function coverageNotice(data) {
    // Do not infer full-library coverage from a successful request or result count.
    const coverage = data && data.coverage;
    if (!coverage || typeof coverage !== 'object') return '搜索范围以接口返回的已索引内容为准';
    const details = [];
    if (Number.isFinite(coverage.searched)) details.push('本次检索 ' + coverage.searched + ' 项');
    if (Number.isFinite(coverage.indexed)) details.push('已索引 ' + coverage.indexed + ' 项');
    if (Number.isFinite(coverage.total)) details.push('候选 ' + coverage.total + ' 项');
    if (Number.isFinite(coverage.scanned)) details.push('已扫描 ' + coverage.scanned + ' 项');
    if (coverage.limited === true || coverage.truncated === true) details.push('本次覆盖范围有限');
    return details.length ? details.join(' · ') + '。搜索范围以接口返回的已索引内容为准' : '搜索范围以接口返回的已索引内容为准';
  }

  function results(d, data) {
    d.content.replaceChildren();
    d.content.append(element('p', 'semantic-coverage', coverageNotice(data)));
    d.content.append(element('p', 'semantic-help', '相似度分数用于排序，不代表正确概率。素材按名称、标签和摘要匹配。'));
    if (!data || data.mode !== 'semantic' || !Array.isArray(data.items)) {
      throw new Error('E_SEMANTIC_RESPONSE：接口未返回有效的语义结果，请检查服务版本。');
    }
    const items = data.items.slice(0, LIMIT);
    if (!items.length) {
      d.status.textContent = '没有找到语义相关内容。可换一种描述后重试。';
      return;
    }
    d.status.textContent = '语义结果 ' + items.length + ' 项（最多 ' + LIMIT + ' 项）';
    const list = element('ul', 'semantic-results');
    items.forEach(item => {
      const row = element('li', 'semantic-result');
      const button = element('button', 'semantic-result-open');
      button.type = 'button';
      const source = item.source_type === 'asset' ? '素材' : item.kind === 'idea' ? '想法 · 笔记' : '笔记';
      const score = typeof item.score === 'number' && Number.isFinite(item.score) ? item.score.toFixed(4) : '未提供';
      button.append(element('span', 'semantic-source', source), element('strong', 'semantic-title', item.title || item.name || item.path || '未命名'));
      button.append(element('span', 'semantic-path', item.path));
      button.append(element('span', 'semantic-snippet', item.snippet || item.summary || '无摘要'));
      button.append(element('span', 'semantic-reason', '相关原因：' + (item.reason || '接口未提供相关原因')));
      button.append(element('span', 'semantic-score', '相似度分数：' + score));
      if (typeof item.path !== 'string' || !item.path || !['note', 'asset'].includes(item.source_type)) {
        button.disabled = true;
      } else {
        button.onclick = () => {
          d.close();
          if (item.source_type === 'asset') showAsset(item.path);
          else openDocument(item.path, item.kind === 'idea' ? 'idea' : 'note');
        };
      }
      row.append(button);
      list.append(row);
    });
    d.content.append(list);
  }

  async function run(type, value) {
    const query = text(value).trim();
    const d = dialog(type === 'search' ? '语义搜索' : '相关内容');
    if (!d) return;
    const ai = S.boot?.config?.ai || {};
    if (ai.embedding_enabled !== true || !text(ai.embedding_model).trim() || !text(ai.embedding_base_url || ai.base_url).trim()) {
      d.status.textContent = '语义搜索尚未配置。请先在 AI 设置中启用嵌入，填写嵌入模型和接口地址。';
      settings(d);
      return;
    }
    if (!query) {
      d.status.textContent = type === 'search' ? '请输入搜索内容后再次运行语义搜索。' : '缺少来源路径，请先打开一条笔记或素材。';
      return;
    }
    d.content.append(element('p', 'semantic-query', (type === 'search' ? '搜索内容：' : '来源路径：') + query));
    const endpoint = text(ai.embedding_base_url || ai.base_url);
    const consent = '即将执行' + (type === 'search' ? '语义搜索' : '相关内容查找') + '。\n' +
      (type === 'search' ? '查询内容：' : '来源路径（将用于读取查询元数据）：') + query + '\n' +
      '查询内容、笔记标题/标签/正文（每篇最多4000字符）以及素材名称/标签/说明会发送到你配置的嵌入（embeddings）接口。相关内容查找也会使用来源正文或说明。\n' +
      '接口：' + endpoint + '\n模型：' + text(ai.embedding_model) + '\n' +
      '接口服务可能收费；索引范围有限，素材文件本身不会发送。是否同意本次发送并继续？';
    busy(d, true);
    d.status.textContent = '等待本次发送授权…';
    try {
      if (!await confirm(consent)) {
        d.status.textContent = '已取消，未发送语义请求。';
        return;
      }
      d.status.textContent = '正在查询语义索引，请稍候…';
      const data = await api(type === 'search' ? '/api/search/semantic' : '/api/related', {
        method: 'POST', body: type === 'search' ? { q: query, limit: LIMIT } : { path: query, limit: LIMIT },
      });
      results(d, data);
    } catch (error) {
      d.content.replaceChildren();
      d.status.textContent = errorMessage(error);
      settings(d);
    } finally {
      busy(d, false);
      // Keep malformed result rows disabled after restoring the dialog controls.
      d.content.querySelectorAll('.semantic-result-open').forEach(button => {
        if (!button.onclick) button.disabled = true;
      });
      d.shell.querySelector('.semantic-close').focus();
    }
  }

  global.SemanticUI = Object.freeze({
    search(q) { return run('search', q); },
    related(path) { return run('related', path); },
  });
})(window);
