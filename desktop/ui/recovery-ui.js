/* Feature 2.12. Host integration: RecoveryUI.view(), then RecoveryUI.bind(root).
 * Classic script: host lexical api/confirm/reload are resolved only on invocation.
 * No requests on script load or view(); bind loads the active local list only.
 */
(function (global) {
  'use strict';
  const state = {
    tab: 'trash', busy: false, status: '', error: '',
    trash: { items: [], loaded: false, error: '' },
    backups: { items: [], loaded: false, error: '' }
  };
  const scopeNotice = '备份范围：笔记库非隐藏目录内的 Markdown、素材标签与说明，以及已有画布。不含原始素材、API 密钥、应用配置或隐藏目录。恢复只补回缺失文件，已有元数据文件不合并。';
  let mount = null;
  let page = null;
  const text = value => String(value == null ? '' : value);
  const escape = value => text(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const count = value => Array.isArray(value) ? value.length : Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.floor(Number(value)) : 0;
  const errorText = error => text(error && (error.message || error.error) || error || '操作失败');
  function bytes(value) {
    const size = Number(value);
    if (!Number.isFinite(size) || size < 0) return '大小未知';
    if (size < 1024) return size + ' B';
    if (size < 1048576) return (size / 1024).toFixed(1) + ' KB';
    return (size / 1048576).toFixed(1) + ' MB';
  }
  function date(value) {
    if (value == null || value === '') return '时间未知';
    const numeric = typeof value === 'number' ? value : NaN;
    const parsed = new Date(Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : value);
    return Number.isNaN(parsed.getTime()) ? text(value) : parsed.toLocaleString('zh-CN');
  }
  function scope(value) {
    if (Array.isArray(value)) return value.map(text).join('、');
    if (value && typeof value === 'object') {
      if (Array.isArray(value.included)) {
        const names = { 'vault/**/*.md (non-hidden directories)': '非隐藏目录内的 Markdown 笔记', 'library/.data/asset-tags.json': '素材标签', 'library/.data/asset-notes.json': '素材说明', 'app/canvas.json': '已有画布' };
        const included = value.included.map(item => names[item] || text(item)).join('、');
        const limits = value.limits || {};
        return included + '；只补回缺失文件' + (limits.file_bytes ? '；单文件上限 ' + bytes(limits.file_bytes) : '') + (limits.bytes ? '，单次上限 ' + bytes(limits.bytes) : '');
      }
      return Object.entries(value).map(([key, val]) => key + '：' + (Array.isArray(val) ? val.map(text).join('、') : val && typeof val === 'object' ? scope(val) : text(val))).join('；');
    }
    return text(value) || '以后端实际清单为准';
  }
  const validTrash = item => item && item.id != null && ['note', 'asset'].includes(item.kind);
  function card(item, index) {
    const trash = state.tab === 'trash';
    const title = trash ? item.name || item.original_path || item.id : item.id;
    const detail = trash
      ? `<p class="recovery-path">原路径：${escape(item.original_path || '未知')}</p><p class="recovery-meta">${item.kind === 'note' ? '笔记' : item.kind === 'asset' ? '素材' : '未知类型'} · ${escape(date(item.deleted_at))} · ${escape(bytes(item.size))}${item.legacy ? ' · 旧版回收项' : ''}</p>`
      : `<p class="recovery-meta">${escape(date(item.created_at))} · ${count(item.files)} 个文件 · ${escape(bytes(item.bytes))}</p><p class="recovery-path">后端范围：${escape(scope(item.scope))}</p>`;
    const available = trash ? validTrash(item) : item.id != null;
    return `<article class="recovery-card"><div class="recovery-card-copy"><h2>${escape(title || '未命名项')}</h2>${detail}</div><button type="button" class="btn ghost" data-recovery-restore="${index}" aria-label="${escape((trash ? '恢复回收项：' : '增量恢复备份：') + text(title))}" ${state.busy || !available ? 'disabled' : ''}>${trash ? '恢复原位置' : '恢复缺失文件'}</button></article>`;
  }
  function view() {
    const list = state[state.tab];
    return `<section class="wrap recovery-page" aria-label="恢复与本地备份" aria-busy="${state.busy}"><header class="recovery-head"><div><p class="recovery-eyebrow">STUDIO / RECOVERY</p><h1>恢复与本地备份</h1><p class="recovery-description">找回回收项，或从本机备份补回缺失文件。操作只读写本地磁盘，不自动发起外部网络请求。</p></div><button type="button" class="btn ghost" data-recovery-refresh ${state.busy ? 'disabled' : ''}>刷新列表</button></header><div class="recovery-tabs" role="tablist" aria-label="恢复类型">${[['trash', '回收站'], ['backups', '本地备份']].map(([key, label]) => `<button type="button" id="recovery-tab-${key}" role="tab" data-recovery-tab="${key}" aria-selected="${state.tab === key}" aria-controls="recovery-panel" tabindex="${state.tab === key ? 0 : -1}" ${state.busy ? 'disabled' : ''}>${label}<span>${state[key].loaded ? state[key].items.length : '—'}</span></button>`).join('')}</div><aside class="recovery-notice">${state.tab === 'trash' ? '<p>恢复到记录的原位置；如目标已存在，保留回收项且不覆盖目标。旧版回收项能否恢复取决于后端记录。</p>' : `<p>${scopeNotice}</p><p>恢复只补回缺失文件，绝不覆盖已有文件；冲突会跳过。备份与当前库位于本地磁盘，不保证完整灾难恢复，也无法替代原始素材的独立备份。</p><button type="button" class="btn" data-recovery-create ${state.busy ? 'disabled' : ''}>创建本地备份</button>`}</aside><div class="recovery-feedback" aria-live="polite" aria-atomic="true"><p class="recovery-status" role="status">${escape(state.status)}</p><p class="recovery-error" role="alert" ${state.error ? '' : 'hidden'}>${escape(state.error)}</p><p class="recovery-list-error" role="alert" ${list.error ? '' : 'hidden'}>${escape(list.error)}</p></div><section id="recovery-panel" role="tabpanel" aria-labelledby="recovery-tab-${state.tab}" tabindex="0"><p class="recovery-summary">${state.busy ? '处理中…' : list.loaded ? '共 ' + list.items.length + ' 项' : '等待读取本地列表'}</p><div class="recovery-list">${list.items.map(card).join('') || `<div class="recovery-empty">${!list.loaded ? '尚未读取列表。' : list.error ? '列表读取失败，可点击刷新重试。' : state.tab === 'trash' ? '回收站为空。' : '暂无本地备份。创建前请确认备份范围。'}</div>`}</div></section></section>`;
  }
  function active() { return mount && page && mount.contains(page); }
  function paint(focusSelector) {
    if (!active()) return;
    mount.innerHTML = view();
    page = mount.querySelector('.recovery-page');
    wire(mount);
    if (focusSelector) mount.querySelector(focusSelector)?.focus();
  }
  async function request(path, options) {
    if (typeof api !== 'function') throw new Error('恢复接口尚未加载，请检查主程序集成。');
    const result = await api(path, options);
    if (!result || result.error || result.ok === false) {
      const error = new Error(errorText(result && (result.error || result.message) || '接口未返回成功结果'));
      error.code = result && result.code;
      throw error;
    }
    return result;
  }
  async function load(tab) {
    const list = state[tab];
    try {
      const result = await request(tab === 'trash' ? '/api/recovery/trash' : '/api/backup/list');
      if (!Array.isArray(result.items)) throw new Error('列表响应缺少 items 数组');
      list.items = result.items.filter(item => item && typeof item === 'object');
      list.error = '';
    } catch (error) {
      list.error = '读取本地列表失败：' + errorText(error);
    } finally { list.loaded = true; }
  }
  async function guarded(operation, focusSelector) {
    if (state.busy) return;
    state.busy = true;
    paint();
    try { await operation(); }
    catch (error) {
      const code = text(error && (error.code || error.data && error.data.code));
      state.error = /E_RECOVERY_EXISTS/.test(code + ' ' + errorText(error))
        ? 'E_RECOVERY_EXISTS：原位置已有文件，未覆盖；回收项仍然保留。请先处理目标位置后重试。'
        : errorText(error);
    } finally {
      state.busy = false;
      paint(focusSelector);
    }
  }
  async function consent(message) {
    if (typeof confirm !== 'function') throw new Error('确认对话框不可用，操作未执行。');
    return Boolean(await confirm(message));
  }
  async function syncHost() {
    if (typeof reload !== 'function') return;
    try { await reload(true); }
    catch (error) { state.error = '磁盘操作已成功，但主界面数据刷新失败：' + errorText(error); }
  }
  async function create() {
    if (!await consent('创建本地备份？\n' + scopeNotice + '\n将把上述内容的副本写入当前后端配置的本地备份目录，占用本机磁盘空间；不会上传。此备份不保证完整灾难恢复。')) return;
    const result = await request('/api/backup/create', { method: 'POST', body: {} });
    if (result.ok !== true) throw new Error('创建接口未确认成功，请刷新列表核实磁盘结果后再操作。');
    state.error = '';
    state.status = '已创建本地备份 ' + text(result.id) + '；' + count(result.files) + ' 个文件，' + bytes(result.bytes) + '。位置：' + text(result.path || '以后端目录为准') + '。实际范围：' + scope(result.scope);
    await load('backups');
  }
  async function restore(item, tab) {
    if (tab === 'trash') {
      if (!validTrash(item)) throw new Error('回收项缺少有效 id 或 kind，无法恢复。');
      if (!await consent('恢复回收项「' + text(item.name || item.id) + '」？\n将从本地回收站移回原位置：' + text(item.original_path || '以后端记录为准') + '\n该操作会写入本地磁盘；原位置如已有文件将不覆盖，并保留回收项。不会上传。')) return;
      const result = await request('/api/recovery/restore', { method: 'POST', body: { id: item.id, kind: item.kind } });
      if (result.ok !== true) throw new Error('恢复接口未确认成功，请刷新列表核实磁盘结果后再操作。');
      state.error = '';
      state.status = '回收项已恢复至：' + text(result.path || item.original_path);
    } else {
      if (!item || item.id == null) throw new Error('备份缺少 id，无法恢复。');
      if (!await consent('从本地备份「' + text(item.id) + '」补回缺失文件？\n' + scopeNotice + '\n此备份后端记录范围：' + scope(item.scope) + '\n将读取本地备份并写入当前库，只创建缺失文件，绝不覆盖已有文件；已有文件和冲突将跳过。不会上传。不保证完整灾难恢复。')) return;
      const result = await request('/api/backup/restore', { method: 'POST', body: { id: item.id } });
      if (result.ok !== true) throw new Error('恢复接口未确认成功，请刷新列表核实磁盘结果后再操作。');
      state.error = '';
      state.status = '备份增量恢复完成：恢复 ' + count(result.restored) + ' 项，跳过 ' + count(result.skipped) + ' 项，冲突 ' + count(result.conflicts) + ' 项。已有文件未覆盖。';
    }
    await load(tab);
    await syncHost();
  }
  function switchTab(tab, focus = false) {
    if (state.busy || !['trash', 'backups'].includes(tab)) return;
    state.tab = tab;
    paint(focus ? '[data-recovery-tab="' + tab + '"]' : undefined);
    if (!state[tab].loaded) void guarded(() => load(tab), '[data-recovery-tab="' + tab + '"]');
  }
  function wire(root) {
    root.querySelectorAll('[data-recovery-tab]').forEach(button => {
      button.onclick = () => switchTab(button.dataset.recoveryTab, true);
      button.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        switchTab(event.key === 'Home' ? 'trash' : event.key === 'End' ? 'backups' : state.tab === 'trash' ? 'backups' : 'trash', true);
      };
    });
    const refresh = root.querySelector('[data-recovery-refresh]');
    if (refresh) refresh.onclick = () => { void guarded(() => load(state.tab), '[data-recovery-refresh]'); };
    const createButton = root.querySelector('[data-recovery-create]');
    if (createButton) createButton.onclick = () => { void guarded(create, '[data-recovery-create]'); };
    root.querySelectorAll('[data-recovery-restore]').forEach(button => {
      button.onclick = () => {
        const tab = state.tab;
        const item = state[tab].items[Number(button.dataset.recoveryRestore)];
        if (item) void guarded(() => restore(item, tab), '[data-recovery-refresh]');
      };
    });
  }
  function bind(root = document.querySelector('#view')) {
    if (!root) return;
    const nextPage = root.querySelector('.recovery-page');
    if (!nextPage) return;
    mount = root;
    page = nextPage;
    wire(root);
    if (!state.busy && !state[state.tab].loaded) void guarded(() => load(state.tab));
    else paint();
  }
  global.RecoveryUI = Object.freeze({ view, bind });
})(window);
