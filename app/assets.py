# -*- coding: utf-8 -*-
"""素材库：扫描 assets/、读取署名与像素元数据、处理上传。

对外统一返回：
    {path, name, cat, kind, ext, size, mtime, w, h, dur, note, author, license}
其中 path 是相对项目根目录的 POSIX 路径（前端直接用 /<path> 访问）。
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
META = ROOT / "meta"
CACHE = ROOT / ".data" / "assets.json"

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"}
AUDIO_EXT = {".wav", ".mp3", ".ogg", ".m4a", ".flac"}
VIDEO_EXT = {".mp4", ".webm", ".mov", ".mkv"}

# 目录 → 中文分类（顺序即展示顺序）
CATS: list[tuple[str, str]] = [
    ("assets/pixel/characters", "像素 · 角色"),
    ("assets/pixel/items", "像素 · 道具"),
    ("assets/pixel/tiles", "像素 · 瓦片"),
    ("assets/pixel/ui", "像素 · 界面"),
    ("assets/pixel/backgrounds", "像素 · 背景"),
    ("assets/pixel/audio/bgm", "像素 · 配乐"),
    ("assets/pixel/audio/sfx", "像素 · 音效"),
    ("assets/images/icons", "图标"),
    ("assets/images/patterns", "图案"),
    ("assets/images/backgrounds", "背景图"),
    ("assets/images/photos", "照片"),
    ("assets/audio/bgm", "配乐"),
    ("assets/audio/sfx", "音效"),
    ("assets/video/stock", "视频"),
    ("assets/video/placeholders", "占位视频"),
    ("assets/uploads", "我的上传"),
]
CAT_NAMES = {p: n for p, n in CATS}


def cat_of(rel: str) -> str:
    for prefix, name in CATS:
        if rel.startswith(prefix + "/"):
            return name
    parent = rel.rsplit("/", 1)[0] if "/" in rel else rel
    return CAT_NAMES.get(parent, "其他")


def kind_of(ext: str) -> str:
    ext = ext.lower()
    if ext in IMAGE_EXT:
        return "image"
    if ext in AUDIO_EXT:
        return "audio"
    if ext in VIDEO_EXT:
        return "video"
    return "file"


def _load_json(p: Path, default):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return default


def _credits() -> dict:
    data = _load_json(META / "credits.json", {})
    out = {}
    for it in data.get("items", []) if isinstance(data, dict) else []:
        if it.get("path"):
            out[it["path"]] = it
    return out


def _pixel_meta() -> dict:
    data = _load_json(META / "pixel.json", {})
    sheets = {}
    for s in data.get("sheets", []):
        sheets[s["file"]] = s
    return {"sheets": sheets, "tileset": data.get("tileset"), "license": data.get("license", "")}


def _img_size_raw(p: Path) -> tuple[int, int] | None:
    """不依赖 Pillow 的尺寸读取（PNG / JPEG / GIF）。"""
    import struct
    try:
        with p.open("rb") as f:
            head = f.read(32)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                w, h = struct.unpack(">II", head[16:24])
                return w, h
            if head[:6] in (b"GIF87a", b"GIF89a"):
                w, h = struct.unpack("<HH", head[6:10])
                return w, h
            if head[:2] == b"\xff\xd8":
                f.seek(2)
                while True:
                    b = f.read(2)
                    if len(b) < 2 or b[0] != 0xFF:
                        return None
                    marker = b[1]
                    if marker in (0xC0, 0xC1, 0xC2, 0xC3):
                        f.read(3)
                        h, w = struct.unpack(">HH", f.read(4))
                        return w, h
                    ln = struct.unpack(">H", f.read(2))[0]
                    f.seek(ln - 2, 1)
    except Exception:
        return None


def _probe(path: Path) -> dict:
    """尺寸 / 时长。失败就留空，不影响列表。"""
    info: dict = {}
    ext = path.suffix.lower()
    try:
        if ext == ".svg":
            head = path.read_text(encoding="utf-8", errors="replace")[:800]
            m = re.search(r'viewBox="([\d.\-]+) ([\d.\-]+) ([\d.]+) ([\d.]+)"', head)
            if m:
                info["w"], info["h"] = round(float(m.group(3))), round(float(m.group(4)))
            else:
                m = re.search(r'width="([\d.]+)"', head)
                if m:
                    info["w"] = round(float(m.group(1)))
        elif ext in IMAGE_EXT:
            size = _img_size_raw(path)
            if size:
                info["w"], info["h"] = size
        elif ext == ".wav":
            import wave
            with wave.open(str(path), "rb") as w:
                info["dur"] = round(w.getnframes() / float(w.getframerate()), 2)
        elif ext in AUDIO_EXT | VIDEO_EXT:
            r = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=nw=1:nk=1", str(path)],
                capture_output=True, text=True, timeout=20)
            if r.returncode == 0 and r.stdout.strip():
                info["dur"] = round(float(r.stdout.strip()), 2)
            if ext in VIDEO_EXT:
                r2 = subprocess.run(
                    ["ffprobe", "-v", "error", "-select_streams", "v:0",
                     "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path)],
                    capture_output=True, text=True, timeout=20)
                if r2.returncode == 0 and "x" in r2.stdout:
                    w, h = r2.stdout.strip().split("x")[:2]
                    info["w"], info["h"] = int(w), int(h)
    except Exception:
        pass
    return info


def scan(force: bool = False) -> list[dict]:
    cache = _load_json(CACHE, {"version": 1, "items": {}}) if not force else {"items": {}}
    cached: dict = cache.get("items", {})
    credits = _credits()
    pix = _pixel_meta()
    items = []
    new_cache: dict = {}
    for p in sorted(ASSETS.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(ROOT).as_posix()
        if any(part.startswith("_") or part.startswith(".") for part in Path(rel).parts):
            continue
        st = p.stat()
        key = f"{st.st_mtime_ns}:{st.st_size}"
        c = cached.get(rel)
        if c and c.get("key") == key:
            info = c["info"]
        else:
            info = _probe(p)
        new_cache[rel] = {"key": key, "info": info}
        ext = p.suffix.lower()
        item = {
            "path": rel,
            "name": p.name,
            "cat": cat_of(rel),
            "kind": kind_of(ext),
            "ext": ext.lstrip("."),
            "size": st.st_size,
            "mtime": st.st_mtime,
            **info,
        }
        cr = credits.get(rel)
        if cr:
            item["author"] = cr.get("author") or ""
            item["license"] = cr.get("license") or ""
            item["source"] = cr.get("source") or ""
        sh = pix["sheets"].get(rel)
        if sh:
            item["frames"] = sh.get("frames")
            item["fps"] = sh.get("fps")
            item["fw"], item["fh"] = sh.get("frame_w"), sh.get("frame_h")
            item["note"] = sh.get("note") or ""
        items.append(item)
    try:
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps({"version": 1, "items": new_cache},
                                    ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    order = {n: i for i, (_, n) in enumerate(CATS)}
    items.sort(key=lambda it: (order.get(it["cat"], 99), it["name"]))
    return items


def summary(items: list[dict]) -> dict:
    cats: dict[str, dict] = {}
    for it in items:
        c = cats.setdefault(it["cat"], {"name": it["cat"], "count": 0, "size": 0})
        c["count"] += 1
        c["size"] += it["size"]
    order = [n for _, n in CATS] + ["其他"]
    out = sorted(cats.values(), key=lambda c: order.index(c["name"]) if c["name"] in order else 99)
    return {
        "total": len(items),
        "size": sum(i["size"] for i in items),
        "cats": out,
    }


def save_upload(filename: str, data: bytes) -> dict:
    safe = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", filename).strip() or "upload.bin"
    folder = ASSETS / "uploads"
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / safe
    i = 2
    while p.exists():
        p = folder / f"{p.stem}-{i}{p.suffix}"
        i += 1
    p.write_bytes(data)
    return {"path": p.relative_to(ROOT).as_posix(), "name": p.name, "size": len(data)}


def resolve(rel: str) -> Path | None:
    """把相对路径安全地解析成 assets 下的真实文件。"""
    p = (ROOT / rel).resolve()
    if not str(p).startswith(str(ASSETS.resolve())):
        return None
    return p if p.is_file() else None
