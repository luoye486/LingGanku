/* Object-specific menus; normal browser editing menus remain available in inputs. */
(function () {
  'use strict';
  let menu = null, origin = null;
  function close(restore = false) {
    if (!menu) return;
    menu.remove(); menu = null;
    if (restore && origin?.isConnected) origin.focus({ preventScroll: true });
  }
  async function prepare() {
    if (documentLoading) return false;
    const doc = window.DocPage?.current();
    if (doc && !await doc.leave()) return false;
    return await closeDrawer();
  }
  async function organize(path, kind) {
    if (!await prepare()) return;
    S.ai.sel = new Set([path]); S.ai.tab = 'notes';
    S.ai.mode = 'summarize'; S.ai.out = ''; S.ai.meta = null;
    go('ai');
  }
  const item = (id, label, run, danger = false) => ({ id, label, run, danger });
  function actions(target) {
    const taskEl = target.closest('[data-task], [data-tl-task]');
    const dayEl = target.closest('[data-tl-day]');
    if (taskEl) {
      const path = taskEl.dataset.task || taskEl.dataset.tlTask;
      const task = S.tasks.find(t => t.path === path);
      if (!task) return null;
      return { title: task.title, items: [
        item('edit', '编辑任务', async () => { if (await prepare()) await openTask(path); }),
        item('plan', '拆分执行计划', async () => { if (await prepare()) await TaskPlanUI.open(path); }),
        item('new-task', '添加任务', async () => { if (await prepare()) newTask(dayEl?.dataset.tlDay || task.due || ''); }),
        item('complete', task.status === 'done' ? '放回待办' : '标记完成', async () => { if (!await prepare()) return; await api('/api/task', { method: 'PUT', body: { path, status: task.status === 'done' ? 'todo' : 'done' } }); await reload(); }),
        item('postpone', '推迟一天', async () => { if (await prepare()) await postponeTask(path); }),
        item('delete', '删除任务…', async () => { if (!await prepare()) return; if (!await confirm('删除「' + task.title + '」？文件会移到库里的 .trash/。')) return; await api('/api/task?path=' + encodeURIComponent(path), { method: 'DELETE' }); await reload(); toast('任务已删除', 'ok'); }, true),
      ] };
    }
    const assetEl = target.closest('[data-asset], [data-open-asset]');
    if (assetEl) {
      const path = assetEl.dataset.asset || assetEl.dataset.openAsset;
      const asset = S.assets.find(a => a.path === path);
      if (!asset) return null;
      return { title: asset.name, items: [
        item('read', '预览素材', () => showAsset(path)),
        item('tags', '编辑标签', () => { showAsset(path); $('#a-tag-input')?.focus(); }),
        item('ai', 'AI 分析与整理', () => AIWorkflows.openAssets([path])),
        item('rename', '重命名', () => { showAsset(path); return $('#asset-rename').onclick(); }),
        item('copy', '复制素材路径', async () => { await navigator.clipboard.writeText(path); toast('路径已复制', 'ok'); }),
        item('reveal', '在文件夹中显示', () => revealAsset(path)),
        item('idea', '用素材创建想法', async () => { if (await prepare()) await newIdea(asset.name, '', [path]); }),
        item('delete', '删除素材…', () => deleteAssets([path]), true),
      ] };
    }
    const noteEl = target.closest('[data-note], [data-idea], [data-tl-idea]');
    if (noteEl) {
      const path = noteEl.dataset.note || noteEl.dataset.idea || noteEl.dataset.tlIdea;
      const note = (S.allNotes || []).find(n => n.path === path) || S.ideas.find(n => n.path === path);
      const kind = noteEl.dataset.idea || noteEl.dataset.tlIdea || note?.kind === 'idea' ? 'idea' : 'note';
      return { title: note?.title || path.split('/').pop(), items: [
        item('read', '全页阅读', async () => { if (await prepare()) await openDocument(path, kind); }),
        item('edit', '编辑 Markdown', async () => { if (!await prepare()) return; await openDocument(path, kind); $('.doc-modes [data-mode="edit"]')?.click(); }),
        item('ai', 'AI 整理', () => organize(path, kind)),
        ...(kind === 'idea' ? [item('plan', '拆分执行计划', async () => { if (await prepare()) await TaskPlanUI.open(path); }), item('synthesize', '连接并合成想法', () => AIWorkflows.openIdeas([path])), item('task', '转为任务', async () => { if (!await prepare()) return; const result = await api('/api/task/from-idea', { method: 'POST', body: { path } }); await reload(); toast('已生成任务：' + result.title, 'ok'); })] : []),
        item('delete', kind === 'idea' ? '删除想法…' : '删除笔记…', async () => { if (await prepare()) await deleteNoteFlow(path, note?.title || '这篇笔记'); }, true),
      ] };
    }
    if (dayEl) {
      const day = dayEl.dataset.tlDay;
      return { title: day, items: [item('new-task', '在这一天添加任务', async () => { if (await prepare()) newTask(day); }), item('view-day', '查看当天任务与想法', () => { S.tlDay = day; render(); })] };
    }
    return null;
  }
  function show(event, model) {
    close(); origin = document.activeElement;
    menu = document.createElement('div'); menu.className = 'context-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', model.title);
    const title = document.createElement('div'); title.className = 'context-menu-title'; title.textContent = model.title; menu.append(title);
    model.items.forEach(action => {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem'); button.dataset.action = action.id; button.textContent = action.label; button.classList.toggle('danger', action.danger);
      button.onclick = async () => { close(); try { await action.run(); } catch (err) { toast(err.message || String(err), 'err'); } };
      menu.append(button);
    });
    document.body.append(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(6, Math.min(event.clientX, innerWidth - rect.width - 6)) + 'px';
    menu.style.top = Math.max(6, Math.min(event.clientY, innerHeight - rect.height - 6)) + 'px';
    menu.querySelector('button')?.focus({ preventScroll: true });
  }
  document.addEventListener('contextmenu', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('input, textarea, [contenteditable="true"]')) { close(); return; }
    const model = actions(target);
    if (!model) { close(); return; }
    event.preventDefault(); event.stopPropagation(); show(event, model);
  });
  document.addEventListener('pointerdown', event => { if (menu && !menu.contains(event.target)) close(); }, true);
  document.addEventListener('keydown', event => {
    if (!menu) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); event.stopImmediatePropagation(); document.activeElement?.click(); return;
    }
    if (['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === 'Escape' || event.key === 'Tab') return close(true);
      const buttons = [...menu.querySelectorAll('button')]; const index = buttons.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }, true);
  window.addEventListener('blur', () => close());
  window.addEventListener('resize', () => close());
  document.addEventListener('scroll', () => close(), true);
})();
