/* 桌面桥：让网页版的前端原样跑在 Tauri 里。
 *
 * 1. fetch('/api/...')  → invoke('api_call')，保持同样的 JSON 与错误语义；
 * 2. /assets/... 的图片/音视频地址 → Tauri 的 asset:// 协议（不经过内存）；
 * 3. 上传文件 → base64 交给后端落盘。
 */
'use strict';

// Tauri 2 默认不注入 window.__TAURI__，但 __TAURI_INTERNALS__ 一直都在；
// 这里两种都兼容，省得因为配置漏了 withGlobalTauri 整个界面白屏。
const T = window.__TAURI__ || {};
const I = T.core || window.__TAURI_INTERNALS__ || {};
const invoke = I.invoke;
const convertFileSrc = I.convertFileSrc || ((p) => p);

let LIB = '';

function absUrl(rel) {
  if (!LIB) return rel;
  // app.js 的 URL 已逐段 encodeURIComponent；文件系统需要解码后的名字。
  // 不解码会把「测试 图片.png」找成字面量 %E6%B5... 的文件。
  const clean = String(rel).replace(/^\/+/, '').split('/').map((part) => {
    try { return decodeURIComponent(part); } catch { return part; }
  }).join('/');
  const full = LIB.replace(/\\/g, '/').replace(/\/+$/, '') + '/' + clean;
  return convertFileSrc(full);
}

function mapUrl(v) {
  return typeof v === 'string' && v.startsWith('/assets/') ? absUrl(v) : v;
}

const ATTRS = ['src', 'href', 'poster', 'style'];

// 序列图缩略图/图案/背景都是用内联 style 的 background-image 画的，
// 这些 URL 同样要换成 asset 协议，否则在 webview 里就是空白。
const STYLE_URL_RE = /url\((['\"]?)(\/assets\/[^'\")]+)\1\)/g;

function fixStyle(el) {
  const st = el.getAttribute && el.getAttribute('style');
  if (!st || st.indexOf('/assets/') === -1) return;
  const next = st.replace(STYLE_URL_RE, (_m, _q, p) => `url("${absUrl(p)}")`);
  if (next !== st) el.setAttribute('style', next);
}

function fixNode(el) {
  if (!el || el.nodeType !== 1) return;
  for (const a of ATTRS) {
    if (a === 'style') continue;
    const v = el.getAttribute && el.getAttribute(a);
    if (v && v.startsWith('/assets/')) el.setAttribute(a, absUrl(v));
  }
  fixStyle(el);
  if (el.querySelectorAll) {
    for (const child of el.querySelectorAll('[src^="/assets/"], [href^="/assets/"], [poster^="/assets/"]')) {
      for (const a of ['src', 'href', 'poster']) {
        const v = child.getAttribute(a);
        if (v && v.startsWith('/assets/')) child.setAttribute(a, absUrl(v));
      }
    }
    for (const child of el.querySelectorAll('[style*="/assets/"]')) fixStyle(child);
  }
}

function watchAssets() {
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') fixNode(r.target);
      else r.addedNodes.forEach(fixNode);
    }
  });
  mo.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

function installFetch() {  const orig = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = String(init.method || (input && input.method) || 'GET').toUpperCase();

    if (url.startsWith('/api/')) {
      try {
        let body = null;
        if (init.body instanceof ArrayBuffer || ArrayBuffer.isView(init.body)) {
          // 上传：原前端发的是原始字节 + X-Filename
          const name = decodeURIComponent((init.headers && (init.headers['X-Filename'] || init.headers['x-filename'])) || 'upload.bin');
          const data = await invoke('api_call', {
            method: 'POST',
            path: '/api/upload',
            body: { name, data: toBase64(init.body) },
          });
          return jsonResponse(data, 200);
        }
        if (typeof init.body === 'string' && init.body) {
          try { body = JSON.parse(init.body); } catch { body = { raw: init.body }; }
        }
        const data = await invoke('api_call', { method, path: url, body });
        if (method === 'PUT' && url === '/api/config' && data.library) LIB = data.library;
        return jsonResponse(data, 200);
      } catch (e) {
        return jsonResponse({ error: typeof e === 'string' ? e : (e && e.message) || String(e) }, 400);
      }
    }

    if (url.startsWith('/assets/')) {
      return orig(absUrl(url), init);
    }

    return orig(input, init);
  };
}

// 后端事件（库有变化 / 全局热键）转成普通的 DOM 事件，
// app.js 不依赖 Tauri 的 API，网页版里这两类事件永远不会出现。
function forwardEvents() {
  const ev = T.event || window.__TAURI_INTERNALS__?.event;
  if (!ev || !ev.listen) return;
  for (const name of ['vault-changed', 'quick-capture', 'ai-chunk']) {
    try {
      ev.listen(name, (e) => {
        window.dispatchEvent(new CustomEvent('linganhe:' + name, { detail: e && e.payload }));
      });
    } catch (err) {
      console.warn('事件订阅失败', name, err);
    }
  }
}

(async function boot() {
  try {
    const info = await invoke('app_info');
    LIB = info.library || '';
  } catch (e) {
    console.error('获取素材库路径失败', e);
  }
  installFetch();
  watchAssets();
  forwardEvents();
  fixNode(document.documentElement);
  // 等 __LIB 就绪后再加载前端，避免第一屏的图片地址算错
  const s = document.createElement('script');
  s.src = 'app.js';
  s.onerror = () => {
    document.body.insertAdjacentHTML('beforeend',
      '<div class="empty"><b>前端加载失败</b><p>app.js 没有找到</p></div>');
  };
  document.body.appendChild(s);
})();
