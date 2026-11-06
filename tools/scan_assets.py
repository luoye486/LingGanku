# -*- coding: utf-8 -*-
"""
扫描 assets/ 生成三份索引：
  meta/manifest.csv   机器可读清单（Excel 可直接打开）
  INDEX.md            人读清单
  preview.html        浏览器预览画廊（双击即可打开，离线可用）

运行： python tools/scan_assets.py
"""
from __future__ import annotations

import csv
import json
import re
import subprocess
import sys
import wave
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
META = ROOT / "meta"
CREDITS = META / "credits.json"

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

IMG_EXT = {".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif"}
AUD_EXT = {".wav", ".mp3", ".ogg", ".m4a", ".flac"}
VID_EXT = {".mp4", ".webm", ".mov", ".mkv"}

# 目录 -> (中文分类, 排序权重)
CATS = {
    "assets/images/icons": ("图标", 1),
    "assets/images/patterns": ("图案", 2),
    "assets/images/backgrounds": ("背景", 3),
    "assets/images/photos": ("图片", 4),
    "assets/audio/sfx": ("音效", 5),
    "assets/audio/bgm": ("BGM", 6),
    "assets/video/stock": ("视频", 7),
    "assets/video/placeholders": ("占位视频", 8),
}
# 像素素材按二级目录细分
PIXEL_CATS = {
    "characters": ("像素·角色", 4.1),
    "items": ("像素·道具", 4.2),
    "tiles": ("像素·瓦片", 4.3),
    "ui": ("像素·界面", 4.4),
    "backgrounds": ("像素·背景", 4.5),
    "audio": ("像素·音频", 4.6),
}
PIXEL_JSON = META / "pixel.json"


def cat_of(folder: str) -> tuple[str, float]:
    if folder in CATS:
        return CATS[folder]
    if folder.startswith("assets/pixel/"):
        seg = folder.split("/")[2]
        return PIXEL_CATS.get(seg, ("像素", 4.9))
    return ("其他", 99)


def load_pixel_meta() -> dict[str, dict]:
    """meta/pixel.json → {相对路径: 帧信息}"""
    if not PIXEL_JSON.exists():
        return {}
    try:
        d = json.loads(PIXEL_JSON.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}
    out = {}
    for s in d.get("sheets", []):
        out[s["file"]] = s
    return out


def _svg_size(p: Path) -> tuple[int, int] | None:
    head = p.read_text(encoding="utf-8", errors="ignore")[:600]
    m = re.search(r'width="(\d+)"\s+height="(\d+)"', head) or re.search(
        r"viewBox=\"0 0 (\d+) (\d+)\"", head
    )
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


def _image_size(p: Path) -> tuple[int, int] | None:
    if p.suffix.lower() == ".svg":
        return _svg_size(p)
    try:
        from PIL import Image

        with Image.open(p) as im:
            return im.width, im.height
    except Exception:  # noqa: BLE001
        return None


def _ffprobe(p: Path) -> dict:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format=duration:stream=width,height,codec_name", "-of", "json", str(p)],
            capture_output=True, text=True, timeout=30,
        )
        d = json.loads(r.stdout or "{}")
        dur = float(d.get("format", {}).get("duration") or 0)
        st = (d.get("streams") or [{}])[0]
        return {"duration": dur, "width": st.get("width"), "height": st.get("height")}
    except Exception:  # noqa: BLE001
        return {"duration": 0, "width": None, "height": None}


def _wav_duration(p: Path) -> float:
    try:
        with wave.open(str(p), "rb") as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:  # noqa: BLE001
        return _ffprobe(p)["duration"]


def load_credits() -> dict[str, dict]:
    if not CREDITS.exists():
        return {}
    try:
        data = json.loads(CREDITS.read_text(encoding="utf-8"))
        return {it["file"]: it for it in data.get("items", [])}
    except Exception:  # noqa: BLE001
        return {}


def scan() -> list[dict]:
    credits = load_credits()
    pixel = load_pixel_meta()
    rows: list[dict] = []
    for p in sorted(ASSETS.rglob("*")):
        if not p.is_file():
            continue
        parts = p.relative_to(ASSETS).parts
        if any(x.startswith(("_", ".")) for x in parts):
            continue  # 跳过 _frames / .DS_Store 之类临时文件
        ext = p.suffix.lower()
        rel = p.relative_to(ROOT).as_posix()
        folder = p.parent.relative_to(ROOT).as_posix()
        cat, order = cat_of(folder)
        row = {
            "path": rel,
            "cat": cat,
            "order": order,
            "name": p.name,
            "ext": ext.lstrip("."),
            "size_kb": round(p.stat().st_size / 1024, 1),
            "w": None, "h": None, "duration": 0.0,
            "frames": 0, "fps": 0, "fw": 0, "fh": 0,
            "title": p.stem, "author": "", "license": "", "license_url": "", "source_url": "",
        }
        if ext in IMG_EXT:
            wh = _image_size(p)
            if wh:
                row["w"], row["h"] = wh
        elif ext in AUD_EXT:
            row["duration"] = round(_wav_duration(p) if ext == ".wav" else _ffprobe(p)["duration"], 2)
        elif ext in VID_EXT:
            info = _ffprobe(p)
            row["duration"] = round(info["duration"], 2)
            row["w"], row["h"] = info["width"], info["height"]
        if rel in pixel:
            s = pixel[rel]
            row.update(frames=s["frames"], fps=s["fps"], fw=s["frame_w"], fh=s["frame_h"])
        c = credits.get(rel)
        if c:
            row.update(
                title=c.get("title") or row["title"],
                author=c.get("author") or "",
                license=c.get("license") or "",
                license_url=c.get("license_url") or "",
                source_url=c.get("source_url") or "",
            )
        elif cat in ("图标", "图案", "背景", "音效", "占位视频") or rel.startswith("assets/pixel/"):
            row["author"] = "本项目原创"
            row["license"] = "CC0-1.0（可自由使用，无需署名）"
            row["license_url"] = "https://creativecommons.org/publicdomain/zero/1.0/"
        rows.append(row)
    rows.sort(key=lambda r: (r["order"], r["name"]))
    return rows


def write_csv(rows: list[dict]) -> None:
    META.mkdir(parents=True, exist_ok=True)
    cols = ["path", "cat", "name", "ext", "size_kb", "w", "h", "duration",
            "title", "author", "license", "license_url", "source_url"]
    with (META / "manifest.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def _fmt_dur(s: float) -> str:
    if not s:
        return ""
    return f"{int(s // 60)}:{s % 60:04.1f}" if s >= 60 else f"{s:.2f}s"


def _fmt_size(kb: float) -> str:
    return f"{kb / 1024:.2f} MB" if kb >= 1024 else f"{kb:.1f} KB"


def write_index(rows: list[dict]) -> None:
    total_mb = sum(r["size_kb"] for r in rows) / 1024
    by_cat: dict[str, list[dict]] = {}
    for r in rows:
        by_cat.setdefault(r["cat"], []).append(r)

    L: list[str] = []
    L.append("# 素材清单\n")
    L.append(f"> 自动生成于 {datetime.now().strftime('%Y-%m-%d %H:%M')}　"
             f"共 **{len(rows)}** 个文件　**{total_mb:.1f} MB**\n")
    L.append("| 分类 | 数量 | 体积 |")
    L.append("| --- | ---: | ---: |")
    for cat, items in by_cat.items():
        L.append(f"| {cat} | {len(items)} | {_fmt_size(sum(i['size_kb'] for i in items))} |")
    L.append("")

    for cat, items in by_cat.items():
        L.append(f"## {cat}（{len(items)}）\n")
        L.append("| 文件 | 规格 | 大小 | 来源 / 说明 |")
        L.append("| --- | --- | ---: | --- |")
        for r in items:
            spec = []
            if r["frames"] > 1:
                spec.append(f"{r['fw']}×{r['fh']} ×{r['frames']} 帧 @{r['fps']}fps")
            elif r["w"] and r["h"]:
                spec.append(f"{r['w']}×{r['h']}")
            if r["duration"]:
                spec.append(_fmt_dur(r["duration"]))
            if r["author"] == "本项目原创":
                note = "原创 · CC0-1.0"
            elif r["author"]:
                note = f"{r['author']} · {r['license']}"
            else:
                note = r["title"] if r["title"] != Path(r["name"]).stem else ""
            L.append(f"| [`{r['name']}`]({quote(r['path'])}) | {' / '.join(spec)} | "
                     f"{_fmt_size(r['size_kb'])} | {note} |")
        L.append("")
    L.append("---\n")
    L.append("重新生成：`python tools/scan_assets.py`　·　"
             "预览：双击 `preview.html`　·　来源与许可：`meta/sources.md`、`meta/credits.json`\n")
    (ROOT / "INDEX.md").write_text("\n".join(L), encoding="utf-8")


HTML = r"""<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>素材库预览 · __COUNT__ 个素材</title>
<style>
  :root{--bg:#0b1020;--panel:#151b2e;--line:#25304b;--txt:#e6ebf5;--dim:#8b98b8;--accent:#6366f1}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(1200px 600px at 10% -10%,#1e2a52 0%,transparent 60%),var(--bg);
       color:var(--txt);font:14px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
  header{position:sticky;top:0;z-index:9;backdrop-filter:blur(12px);
         background:rgba(11,16,32,.82);border-bottom:1px solid var(--line);padding:16px 24px 12px}
  h1{margin:0 0 4px;font-size:18px;letter-spacing:.3px}
  .sub{color:var(--dim);font-size:12px}
  .bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px}
  .chip{border:1px solid var(--line);background:var(--panel);color:var(--txt);border-radius:999px;
        padding:5px 13px;font-size:12.5px;cursor:pointer;transition:.15s}
  .chip:hover{border-color:#3d4a70}
  .chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
  input[type=search]{margin-left:auto;min-width:210px;background:var(--panel);border:1px solid var(--line);
        color:var(--txt);border-radius:9px;padding:7px 12px;outline:none;font-size:13px}
  input[type=search]:focus{border-color:var(--accent)}
  main{padding:20px 24px 60px}
  h2{font-size:14px;color:var(--dim);font-weight:600;margin:26px 0 12px;letter-spacing:.5px}
  .grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(190px,1fr))}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden;
        display:flex;flex-direction:column;transition:.18s}
  .card:hover{border-color:#3d4a70;transform:translateY(-2px)}
  .thumb{height:132px;display:flex;align-items:center;justify-content:center;background:#0e1424;
         overflow:hidden;padding:8px}
  .thumb a{display:flex;align-items:center;justify-content:center;width:100%;height:100%}
  .thumb img{max-width:100%;max-height:100%;object-fit:contain}
  .thumb.cover{padding:0}
  .thumb.cover img{width:100%;height:100%;object-fit:cover}
  .meta{padding:9px 11px 11px}
  .nm{font-size:12px;line-height:1.35;overflow-wrap:anywhere;
      display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .tag{color:var(--dim);font-size:11px;margin-top:3px}
  audio{width:100%;height:34px;margin-top:6px}
  .wave{display:flex;align-items:flex-end;gap:3px;height:26px;opacity:.55}
  .wave i{width:3px;border-radius:2px;background:#7c8bb0}
  .wave b{color:#7c8bb0;font-size:20px;line-height:1;font-weight:400}
  video{width:100%;height:100%;object-fit:cover;background:#000}
  /* 图标：白底 + 固定小尺寸，保持 24px 线稿比例 */
  .sec-icons .grid{grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}
  .card--icon .thumb{height:88px;background:#fff;padding:0}
  .card--icon .thumb img{width:44px;height:44px}
  .card--icon .meta{padding:6px 8px 8px}
  .card--icon .nm{font-size:10.5px;text-align:center;color:#c7d0e6}
  /* 图案 / 背景：浅色底，整幅铺满 */
  .card--pattern .thumb,.card--bg .thumb{background:#f3f4f6;padding:0}
  .card--pattern .thumb img,.card--bg .thumb img{width:100%;height:100%;object-fit:cover}
  /* 像素素材：棋盘格底 + 最近邻放大，多帧只显示首帧 */
  .sec-px .grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
  .card--px .thumb{height:118px;padding:10px;
      background:repeating-conic-gradient(#1a2135 0% 25%,#141a2c 0% 50%) 50%/12px 12px}
  .card--px .thumb img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
  .card--px .nm{font-size:11px}
  .pxs{display:block;height:100%;aspect-ratio:var(--ar);background-repeat:no-repeat;
       background-position:0 0;background-size:calc(var(--n) * 100%) 100%;image-rendering:pixelated}
  .hide{display:none!important}
  footer{color:var(--dim);font-size:12px;padding:0 24px 40px}
  a{color:#8fa6ff}
</style></head><body>
<header>
  <h1>素材库预览</h1>
  <div class="sub">__COUNT__ 个文件 · __SIZE__ MB · 生成于 __TIME__ · 双击 preview.html 即可离线浏览</div>
  <div class="bar" id="bar">
    <button class="chip on" data-f="all">全部 __COUNT__</button>
    __CHIPS__
    <input type="search" id="q" placeholder="搜索文件名 / 标题 / 作者…">
  </div>
</header>
<main id="main"></main>
<footer>原创素材（图标 / 图案 / 背景 / 像素 / 音效 / 占位视频）为本项目生成，CC0-1.0；
像素序列图卡片只显示首帧，点开看完整帧序列（帧信息见 meta/pixel.json）。
采集素材的许可与署名见 meta/sources.md 与 meta/credits.json。</footer>
<script>
const DATA = __DATA__;
const IMG = ["svg","png","jpg","jpeg","webp","gif"], AUD = ["wav","mp3","ogg","m4a","flac"], VID = ["mp4","webm","mov","mkv"];
const ORIGINAL = ["图标","图案","背景","音效","占位视频"];
const kindOf = e => IMG.includes(e.ext) ? "img" : AUD.includes(e.ext) ? "aud" : VID.includes(e.ext) ? "vid" : "other";
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function card(it){
  const k = kindOf(it), src = encodeURI(it.path);
  const isIcon = it.cat === "图标", isPattern = it.cat === "图案", isBg = it.cat === "背景";
  const isPx = it.cat.startsWith("像素");
  const cardCls = isIcon ? "card--icon" : isPattern ? "card--pattern" : isBg ? "card--bg" : isPx ? "card--px" : "";
  const cover = (k === "vid") || (k === "img" && it.cat === "图片");
  let media = "";
  if (k === "img") {
    if (isPx && it.frames > 1) {
      media = `<a class="pxs" href="${src}" target="_blank" rel="noopener" title="共 ${it.frames} 帧，点击看完整序列图"
        style="--n:${it.frames};--ar:${it.fw}/${it.fh};background-image:url('${src}')"></a>`;
    } else {
      media = `<a href="${src}" target="_blank" rel="noopener"><img loading="lazy" src="${src}" alt=""></a>`;
    }
  }
  else if (k === "vid") media = `<video src="${src}#t=1" controls muted preload="metadata"></video>`;
  else if (k === "aud") media = `<div class="wave">${[9,17,25,13,21,7,15,11,19].map(h=>`<i style="height:${h}px"></i>`).join("")}</div>`;
  else media = `<div style="color:#8b98b8">?</div>`;
  const spec = [it.fw ? `${it.fw}×${it.fh}` : (it.w && it.h ? `${it.w}×${it.h}` : ""),
                it.frames > 1 ? `${it.frames} 帧` : "",
                it.duration ? `${(+it.duration).toFixed(2)}s` : "",
                `${it.size_kb} KB`].filter(Boolean).join(" · ");
  const showLic = !ORIGINAL.includes(it.cat) && !isPx && it.license;
  const label = isPx ? it.name.replace(/^pixel-/, "").replace(/\.(png|wav|mp3)$/i, "")
              : isIcon ? it.name.replace(/^icon-/, "").replace(/\.svg$/i, "") : it.name;
  return `<div class="card ${cardCls}" data-cat="${esc(it.cat)}" data-s="${esc((it.name+" "+it.title+" "+it.author).toLowerCase())}">
    <div class="thumb ${cover ? "cover" : ""}">${media}</div>
    <div class="meta">
      <div class="nm" title="${esc(it.path)}">${esc(label)}</div>
      <div class="tag">${esc(spec)}</div>
      ${k === "aud" ? `<audio controls preload="none" src="${src}"></audio>` : ""}
      ${showLic ? `<div class="tag">${esc(it.license)}</div>` : ""}
    </div></div>`;
}
const order = [...new Set(DATA.map(d => d.cat))];
let html = "";
for (const c of order){
  const items = DATA.filter(d => d.cat === c);
  const cls = c === "图标" ? "sec-icons" : c.startsWith("像素") ? "sec-px" : "";
  html += `<section class="sec ${cls}" data-cat="${esc(c)}"><h2>${esc(c)} · ${items.length}</h2>
           <div class="grid">${items.map(card).join("")}</div></section>`;
}
document.getElementById("main").innerHTML = html;
let cur = "all", q = "";
function apply(){
  document.querySelectorAll(".sec").forEach(sec=>{
    let shown = 0;
    sec.querySelectorAll(".card").forEach(c=>{
      const okCat = cur === "all" || c.dataset.cat === cur;
      const okQ = !q || c.dataset.s.includes(q);
      const ok = okCat && okQ;
      c.classList.toggle("hide", !ok); if (ok) shown++;
    });
    sec.classList.toggle("hide", shown === 0);
  });
}
document.querySelectorAll(".chip").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".chip").forEach(x=>x.classList.remove("on"));
  b.classList.add("on"); cur = b.dataset.f; apply();
});
document.getElementById("q").oninput = e => { q = e.target.value.trim().toLowerCase(); apply(); };
// 支持 preview.html#像素·角色 直接定位分类
const init = decodeURIComponent(location.hash.slice(1));
if (init) { const b = [...document.querySelectorAll(".chip")].find(x => x.dataset.f === init); if (b) b.click(); }
</script></body></html>
"""


def write_preview(rows: list[dict]) -> None:
    by_cat: dict[str, int] = {}
    for r in rows:
        by_cat[r["cat"]] = by_cat.get(r["cat"], 0) + 1
    chips = "".join(
        f'<button class="chip" data-f="{c}">{c} {n}</button>' for c, n in by_cat.items()
    )
    data = [
        {k: r[k] for k in ("path", "cat", "name", "ext", "size_kb", "w", "h", "duration",
                           "title", "author", "license", "frames", "fps", "fw", "fh")}
        for r in rows
    ]
    html = (
        HTML.replace("__CHIPS__", chips)
        .replace("__DATA__", json.dumps(data, ensure_ascii=False))
        .replace("__COUNT__", str(len(rows)))
        .replace("__SIZE__", f"{sum(r['size_kb'] for r in rows) / 1024:.1f}")
        .replace("__TIME__", datetime.now().strftime("%Y-%m-%d %H:%M"))
    )
    (ROOT / "preview.html").write_text(html, encoding="utf-8")


def main() -> None:
    rows = scan()
    write_csv(rows)
    write_index(rows)
    write_preview(rows)
    total = sum(r["size_kb"] for r in rows) / 1024
    print(f"扫描完成：{len(rows)} 个文件，{total:.2f} MB")
    for cat in dict.fromkeys(r["cat"] for r in rows):
        n = sum(1 for r in rows if r["cat"] == cat)
        print(f"  {cat:<6} {n:>3}")
    print("输出：meta/manifest.csv, INDEX.md, preview.html")


if __name__ == "__main__":
    main()
