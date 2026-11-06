/* Local Markdown preview. Load vendor/marked-18.1.3.umd.js first.
 * MarkdownView.render(source, { image(target, { alt, title, wiki }) => HTML })
 * The optional image callback resolves vault assets; its HTML is filtered in an
 * inert template. Without a browser DOM callback HTML is displayed as text.
 * Source HTML is always escaped; code is never preprocessed or substituted.
 */
(function (root) {
  'use strict';
  if (!root.marked || typeof root.marked.Marked !== 'function') {
    throw new Error('MarkdownView requires local marked-18.1.3.umd.js before markdown.js');
  }
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Resolve character references before scheme checking. The returned URL is
  // still attribute-escaped; percent-encoded schemes are rejected conservatively.
  function safeUrl(value, image) {
    const raw = String(value == null ? '' : value).trim();
    const probe = raw.replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (_, n) => {
      const point = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : parseInt(n, 10);
      return point <= 0x10ffff ? String.fromCodePoint(point) : '';
    }).replace(/&colon;/gi, ':').replace(/&(?:tab|newline);/gi, '').replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
    let decoded;
    try { decoded = decodeURIComponent(probe); } catch (_) { return null; }
    const scheme = /^([a-z][a-z\d+.-]*):/i.exec(decoded);
    if (scheme && !(image ? /^(https?)$/i : /^(https?|mailto|tel)$/i).test(scheme[1])) return null;
    // Backslash URLs can change interpretation under a browser URL parser.
    if (/\\/.test(probe) || /[<>"']/.test(raw)) return null;
    return raw;
  }
  function imageHtml(html) {
    if (!root.document || typeof root.document.createElement !== 'function') return escape(html);
    const template = root.document.createElement('template');
    template.innerHTML = String(html);
    const tags = new Set(['FIGURE', 'FIGCAPTION', 'IMG', 'SPAN', 'STRONG', 'EM', 'CODE', 'BR']);
    function clean(parent) {
      for (const node of Array.from(parent.childNodes)) {
        if (node.nodeType === 3) continue;
        if (node.nodeType !== 1 || !tags.has(node.tagName)) { node.remove(); continue; }
        for (const attr of Array.from(node.attributes)) {
          const name = attr.name.toLowerCase();
          const allowed = ['class', 'title', 'alt', 'data-open-asset'].includes(name) || (node.tagName === 'IMG' && name === 'src');
          if (!allowed || (name === 'src' && safeUrl(attr.value, true) === null)) node.removeAttribute(attr.name);
        }
        if (node.tagName === 'IMG') { node.setAttribute('loading', 'lazy'); node.setAttribute('decoding', 'async'); }
        clean(node);
      }
    }
    clean(template.content);
    return template.innerHTML;
  }
  function render(src, options) {
    const image = options && typeof options.image === 'function' ? options.image : null;
    function renderImage(target, alt, title, wiki) {
      const url = safeUrl(target, true);
      if (url === null) return '<span class="img-missing">' + escape(alt || target) + '</span>';
      if (image) return imageHtml(image(url, { alt: alt || '', title: title || '', wiki: !!wiki }));
      return '<img src="' + escape(url) + '" alt="' + escape(alt) + '"' + (title ? ' title="' + escape(title) + '"' : '') + ' loading="lazy" decoding="async">';
    }
    const parser = new root.marked.Marked({ gfm: true, breaks: false, async: false });
    parser.use({
      renderer: {
        html(token) { return escape(token.text); },
        link(token) {
          const label = this.parser.parseInline(token.tokens);
          const href = safeUrl(token.href, false);
          if (href === null) return label;
          return '<a href="' + escape(href) + '"' + (token.title ? ' title="' + escape(token.title) + '"' : '') + ' target="_blank" rel="noopener noreferrer">' + label + '</a>';
        },
        image(token) { return renderImage(token.href, token.text, token.title, false); }
      },
      extensions: [
        {
          name: 'vaultImage', level: 'inline',
          start(src) { return src.indexOf('![['); },
          tokenizer(src) {
            const match = /^!\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/.exec(src);
            if (match) return { type: 'vaultImage', raw: match[0], target: match[1].trim(), alt: match[2] || match[1] };
          },
          renderer(token) { return renderImage(token.target, token.alt, '', true); }
        },
        {
          name: 'wikiLink', level: 'inline',
          start(src) { return src.indexOf('[['); },
          tokenizer(src) {
            const match = /^\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/.exec(src);
            if (match) return { type: 'wikiLink', raw: match[0], target: match[1].trim(), label: match[2] || match[1] };
          },
          renderer(token) { return '<span class="wl" data-wiki="' + escape(token.target) + '" title="' + escape(token.target) + '">' + escape(token.label) + '</span>'; }
        },
        {
          name: 'highlight', level: 'inline', childTokens: ['tokens'],
          start(src) { return src.indexOf('=='); },
          tokenizer(src) {
            const match = /^==(?=\S)([^\n]+?\S|\S)==(?![=])/.exec(src);
            if (match) return { type: 'highlight', raw: match[0], tokens: this.lexer.inlineTokens(match[1]) };
          },
          renderer(token) { return '<mark>' + this.parser.parseInline(token.tokens) + '</mark>'; }
        }
      ]
    });
    return parser.parse(String(src == null ? '' : src));
  }
  root.MarkdownView = Object.freeze({ render, version: 'marked@18.1.3' });
})(typeof window !== 'undefined' ? window : globalThis);
