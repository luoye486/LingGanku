# -*- coding: utf-8 -*-
"""
从「可免费商用」的素材源采集素材，并记录署名/许可信息到 meta/credits.json。

当前可用的源（已在本机网络实测）：
  * Lorem Picsum  -> 图片（原图来自 Unsplash，Unsplash License）
  * Mixkit        -> 免费 BGM（Mixkit Free License）
  * Coverr        -> 免费视频（Coverr License）

用法：
  python tools/collect.py                 # 全部采集（图片 12 / BGM 3 / 视频 3）
  python tools/collect.py --only photos   # 只采图片
  python tools/collect.py --photos 20 --bgm 5 --videos 5
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "assets" / "images" / "photos"
BGM = ROOT / "assets" / "audio" / "bgm"
VID = ROOT / "assets" / "video" / "stock"
META = ROOT / "meta"
CREDITS = META / "credits.json"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
MAX_MB = 12.0

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass


def _get(url: str, referer: str | None = None, timeout: int = 60) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "*/*",
        **({"Referer": referer} if referer else {}),
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def _download(url: str, dest: Path, referer: str | None = None, retries: int = 2) -> int:
    """用 curl 下载：带速度下限，遇到卡死连接会快速失败并重试。"""
    if dest.exists() and dest.stat().st_size > 1024:
        print(f"  = 已存在 {dest.name} ({dest.stat().st_size / 1024:.0f} KB)")
        return dest.stat().st_size
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    last = None
    for i in range(retries + 1):
        cmd = [
            "curl", "-sS", "-L", "-f", "--max-time", "240",
            "--speed-time", "20", "--speed-limit", "20000",
            "--max-filesize", str(int(MAX_MB * 1024 * 1024)),
            "-A", UA, "-o", str(tmp),
        ]
        if referer:
            cmd += ["-H", f"Referer: {referer}"]
        cmd.append(url)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0 and tmp.exists() and tmp.stat().st_size > 1024:
            tmp.replace(dest)
            print(f"  + {dest.name}  {dest.stat().st_size / 1024:.0f} KB")
            return dest.stat().st_size
        last = (r.stderr or "").strip() or f"exit {r.returncode}"
        tmp.unlink(missing_ok=True)
        print(f"  ! 重试 {i + 1}/{retries + 1} {url.split('/')[-1]} -> {last[:120]}")
        time.sleep(1.0)
    raise RuntimeError(f"下载失败: {url} ({last})")


def _slug(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", s)
    return re.sub(r"-{2,}", "-", s).strip("-")[:60] or "untitled"


# --------------------------------------------------------------- 图片 ----
def collect_photos(n: int) -> list[dict]:
    print(f"\n[photos] Lorem Picsum / Unsplash  x{n}")
    IMG.mkdir(parents=True, exist_ok=True)
    listing = json.loads(_get("https://picsum.photos/v2/list?page=1&limit=60").decode("utf-8"))
    # 作者去重，保证图片风格多样
    picked, seen_authors = [], set()
    for item in listing:
        a = item.get("author", "unknown")
        if a in seen_authors:
            continue
        seen_authors.add(a)
        picked.append(item)
        if len(picked) >= n:
            break
    out = []
    for it in picked:
        pid = it["id"]
        author = it.get("author", "unknown")
        w, h = 1600, 1000
        url = f"https://picsum.photos/id/{pid}/{w}/{h}"
        dest = IMG / f"photo-{pid}-{_slug(author)}.jpg"
        try:
            _download(url, dest)
        except Exception as e:  # noqa: BLE001
            print(f"  ! 跳过 {pid}: {e}")
            continue
        out.append({
            "file": f"assets/images/photos/{dest.name}",
            "type": "image",
            "title": f"Photo #{pid}",
            "author": author,
            "source": "Lorem Picsum (原始图片来自 Unsplash)",
            "source_url": it.get("url", "https://picsum.photos/"),
            "license": "Unsplash License",
            "license_url": "https://unsplash.com/license",
            "note": "免费商用、无需授权，建议署名；不得用他人照片冒充本人创作。",
        })
    return out


# --------------------------------------------------------------- BGM ----
def collect_bgm(n: int) -> list[dict]:
    print(f"\n[bgm] Mixkit  x{n}")
    BGM.mkdir(parents=True, exist_ok=True)
    page_url = "https://mixkit.co/free-stock-music/"
    html = _get(page_url, timeout=90).decode("utf-8", "ignore")
    chunks = html.split('class="item-grid__item"')
    cands: list[tuple[str, str]] = []
    for ch in chunks:
        m = re.search(r'data-audio-player-preview-url-value="(https://assets\.mixkit\.co/music/\d+/\d+\.mp3)"', ch)
        if not m:
            continue
        t = re.search(r'item-grid-card__title[^>]*>\s*(?:<[^>]+>\s*)*([^<]{2,90})', ch)
        title = re.sub(r"\s+", " ", t.group(1)).strip() if t else "Untitled"
        cands.append((m.group(1), title))
    print(f"  页面解析到 {len(cands)} 首")
    out = []
    for url, title in cands:
        if len(out) >= n:
            break
        tid = re.search(r"/music/(\d+)/", url).group(1)
        dest = BGM / f"bgm-{tid}-{_slug(title)}.mp3"
        try:
            _download(url, dest, referer=page_url)
        except Exception as e:  # noqa: BLE001
            print(f"  ! 跳过 {title}: {e}")
            continue
        out.append({
            "file": f"assets/audio/bgm/{dest.name}",
            "type": "audio",
            "title": title,
            "author": "Mixkit",
            "source": "Mixkit Free Stock Music",
            "source_url": page_url,
            "license": "Mixkit Free License",
            "license_url": "https://mixkit.co/license/",
            "note": "可免费用于商业项目、无需署名；不可将音频单独转售或作为素材包再分发。",
        })
    return out


# --------------------------------------------------------------- 视频 ----
def collect_videos(n: int) -> list[dict]:
    print(f"\n[videos] Coverr  x{n}")
    VID.mkdir(parents=True, exist_ok=True)
    page_url = "https://coverr.co/"
    html = _get(page_url, timeout=120).decode("utf-8", "ignore")
    pat = re.compile(r"https://cdn\.coverr\.co/videos/(coverr-[a-z0-9\-]+?-\d+)/(\d+p)\.mp4")
    by_slug: dict[str, dict[str, str]] = {}
    for slug, res in pat.findall(html):
        by_slug.setdefault(slug, {})[res] = f"https://cdn.coverr.co/videos/{slug}/{res}.mp4"
    print(f"  页面解析到 {len(by_slug)} 条视频")
    out = []
    for slug, resmap in by_slug.items():
        if len(out) >= n:
            break
        res = "720p" if "720p" in resmap else ("360p" if "360p" in resmap else sorted(resmap)[0])
        url = resmap[res]
        name = re.sub(r"^coverr-", "", slug)
        name = re.sub(r"-\d+$", "", name)
        dest = VID / f"video-{_slug(name)}-{res}.mp4"
        try:
            _download(url, dest, referer=page_url)
        except Exception as e:  # noqa: BLE001
            print(f"  ! 跳过 {slug}: {e}")
            continue
        out.append({
            "file": f"assets/video/stock/{dest.name}",
            "type": "video",
            "title": name.replace("-", " "),
            "author": "Coverr",
            "source": "Coverr Free Stock Video",
            "source_url": f"https://coverr.co/videos/{name}",
            "license": "Coverr License",
            "license_url": "https://coverr.co/license",
            "note": "可免费商用、无需署名；不可将原片直接转售或作为素材包再分发。",
        })
    return out


# -------------------------------------------------------------- 主流程 ----
def load_credits() -> dict:
    if CREDITS.exists():
        try:
            return json.loads(CREDITS.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    return {"updated_at": None, "items": []}


def save_credits(cred: dict, new_items: list[dict]) -> None:
    by_file = {it["file"]: it for it in cred.get("items", [])}
    for it in new_items:
        by_file[it["file"]] = it
    cred["items"] = sorted(by_file.values(), key=lambda x: x["file"])
    cred["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    META.mkdir(parents=True, exist_ok=True)
    CREDITS.write_text(json.dumps(cred, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n已写入 {CREDITS.relative_to(ROOT)}  共 {len(cred['items'])} 条记录")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["photos", "bgm", "videos"], default=None)
    ap.add_argument("--photos", type=int, default=12)
    ap.add_argument("--bgm", type=int, default=3)
    ap.add_argument("--videos", type=int, default=3)
    a = ap.parse_args()

    cred = load_credits()
    got: list[dict] = []

    def flush() -> None:
        if got:
            save_credits(cred, list(got))

    if a.only in (None, "photos"):
        try:
            got += collect_photos(a.photos)
            flush()
        except Exception as e:  # noqa: BLE001
            print(f"  ! photos 采集失败: {e}")
    if a.only in (None, "bgm"):
        try:
            got += collect_bgm(a.bgm)
            flush()
        except Exception as e:  # noqa: BLE001
            print(f"  ! bgm 采集失败: {e}")
    if a.only in (None, "videos"):
        try:
            got += collect_videos(a.videos)
            flush()
        except Exception as e:  # noqa: BLE001
            print(f"  ! videos 采集失败: {e}")
    save_credits(cred, got)


if __name__ == "__main__":
    main()
