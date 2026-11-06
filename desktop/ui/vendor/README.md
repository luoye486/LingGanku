# Offline Markdown vendor

- Marked **18.1.3**, MIT: `marked-18.1.3.umd.js` is the unmodified browser UMD distribution from https://registry.npmjs.org/marked/-/marked-18.1.3.tgz (retrieved 2026-11-05). Upstream: https://github.com/markedjs/marked. Full original license: `marked-LICENSE`.
- Verified npm archive SHA512: `9ChMH8EVVgjgID49nsL6IWxWk5c6GtAsq/xw7U1ggkjkU5AGuv68oLTVlFRtvcUYZtpbNyjyvGo3YDu0fGapiw==`.
- jsDelivr was unavailable in this environment; the npm registry tarball supplied the same official release. No package install or runtime network dependency is used.
- The upstream sourceMappingURL is a developer-tools hint; the source map is not required or shipped. Normal execution never loads a CDN.

## Integration

Load local scripts in this order (normal ordered scripts, or all with `defer`; no `async`):

```html
<script src="vendor/marked-18.1.3.umd.js"></script>
<script src="markdown.js"></script>
<!-- existing bridge/doc-page/other scripts keep their dependency order -->
<script src="app.js"></script>
```

Load `markdown.css` after `style.css`. Existing preview containers with `.output` receive its rules; standalone previews can use `.markdown-view`.

Replace the host's Markdown function body with:

```js
return window.MarkdownView.render(src, { image: imgHtml });
```

`render(source, options?)` synchronously returns HTML and never changes source text. `image(target, {alt, title, wiki})` is optional; it receives the plain safe target of either Markdown images or Obsidian embeds. Its returned HTML is filtered in an inert browser template to figure/figcaption/img/span/strong/em/code/br and safe attributes. Events, style, SVG, srcset, and unsupported URL schemes are removed. Without a browser DOM callback output is escaped rather than trusted. Without a callback standard `<img>` output is generated. Failed URL validation does not call the callback.

Raw source HTML is always escaped. Link schemes are allowlisted to HTTP/HTTPS/mailto/tel; image schemes to HTTP/HTTPS; relative paths and fragments remain available. Wiki links retain `.wl[data-wiki]` for existing delegated navigation. Task checkboxes are disabled preview controls. Obsidian `![[target|width]]` resolves the unadorned target; sizing annotations are not applied. Non-image Obsidian embeds are delegated to the same image callback, matching existing behavior.

Run from the repository root:

```sh
node --test _verification/markdown.test.cjs
```

The suite has no npm dependencies. It also exercises callback sanitization in local headless Edge when installed at the standard Windows path; otherwise that one browser test is explicitly skipped. Set `MARKDOWN_TEST_BROWSER` to a Chromium executable to enable it elsewhere. Browser fixtures/profile are temporary, and no build is run.
