# -*- coding: utf-8 -*-
"""Obsidian 库：frontmatter 解析、标签/双链提取、笔记扫描与读写。

设计约定
--------
* Obsidian 库里的 `.md` 是**唯一事实来源**，应用只做索引与展示；
* 应用写入的笔记放在 `灵感盒/` 下（`想法/` 与 `整理/`），带 frontmatter，
  Obsidian 里能正常看到标签与双链；
* 不修改用户已有笔记的结构，除非用户显式编辑。
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from pathlib import Path

SKIP_DIRS = {".obsidian", ".trash", ".git", "node_modules", "__pycache__"}
MAX_SIZE = 4 * 1024 * 1024

FM_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---[ \t]*\r?\n?", re.S)
TAG_RE = re.compile(r"(?<![\w#/])#([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5/\-]{0,39})")
LINK_RE = re.compile(r"\[\[([^\]\|#]+)(?:#[^\]\|]*)?(?:\|([^\]]*))?\]\]")
H1_RE = re.compile(r"^#[ \t]+(.+)$", re.M)
IMG_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")


# ------------------------------------------------------------------ 库定位

def detect_vault() -> str | None:
    """从 Obsidian 自己的配置里读出最近使用的库路径。"""
    appdata = os.environ.get("APPDATA")
    if not appdata:
        return None
    cfg = Path(appdata) / "obsidian" / "obsidian.json"
    try:
        data = json.loads(cfg.read_text(encoding="utf-8"))
    except Exception:
        return None
    vaults = (data.get("vaults") or {}).values()
    for v in sorted(vaults, key=lambda x: x.get("ts", 0), reverse=True):
        p = v.get("path")
        if p and Path(p).is_dir():
            return str(Path(p))
    return None


# ------------------------------------------------------------------ frontmatter

def _scalar(v: str):
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    if v in ("true", "false"):
        return v == "true"
    if re.fullmatch(r"-?\d+", v):
        return int(v)
    if re.fullmatch(r"-?\d+\.\d+", v):
        return float(v)
    return v


def parse_frontmatter(text: str):
    """返回 (meta, body)。没有 frontmatter 时 meta 为空字典。"""
    meta: dict = {}
    m = FM_RE.match(text)
    if not m:
        return meta, text
    body = text[m.end():]
    key = None
    for line in m.group(1).splitlines():
        if not line.strip():
            continue
        if re.match(r"^\s*-\s+", line) or line.startswith("- "):
            if key is not None:
                if not isinstance(meta.get(key), list):
                    meta[key] = []
                meta[key].append(_scalar(line.split("-", 1)[1]))
            continue
        mm = re.match(r"^([\w\u4e00-\u9fa5\-]+)\s*:\s*(.*)$", line)
        if not mm:
            continue
        key, val = mm.group(1), mm.group(2).strip()
        if val.startswith("[") and val.endswith("]"):
            meta[key] = [_scalar(x) for x in val[1:-1].split(",") if x.strip()]
        elif val == "":
            meta[key] = []
        else:
            meta[key] = _scalar(val)
    return meta, body


def dump_frontmatter(meta: dict, body: str) -> str:
    lines = ["---"]
    for k, v in meta.items():
        if isinstance(v, list):
            if not v:
                lines.append(f"{k}: []")
            else:
                lines.append(f"{k}:")
                for item in v:
                    lines.append(f"  - {item}")
        elif isinstance(v, bool):
            lines.append(f"{k}: {'true' if v else 'false'}")
        elif v is None:
            lines.append(f"{k}:")
        else:
            lines.append(f"{k}: {v}")
    lines.append("---")
    return "\n".join(lines) + "\n\n" + body.strip() + "\n"


# ------------------------------------------------------------------ 解析

def note_title(meta: dict, body: str, stem: str) -> str:
    t = meta.get("title")
    if isinstance(t, str) and t.strip():
        return t.strip()
    m = H1_RE.search(body)
    if m:
        return m.group(1).strip()
    return stem


def note_tags(meta: dict, body: str) -> list[str]:
    tags: set[str] = set()
    raw = meta.get("tags") or meta.get("tag") or []
    if isinstance(raw, str):
        tags.update(x.strip().lstrip("#") for x in re.split(r"[,，\s]+", raw) if x.strip())
    elif isinstance(raw, list):
        tags.update(str(x).strip().lstrip("#") for x in raw if str(x).strip())
    for m in TAG_RE.finditer(body):
        tags.add(m.group(1))
    return sorted(t for t in tags if t)


def note_links(body: str) -> list[str]:
    return sorted({m.group(1).strip() for m in LINK_RE.finditer(body) if m.group(1).strip()})


def excerpt(body: str, n: int = 180) -> str:
    text = IMG_RE.sub(" ", body)
    text = LINK_RE.sub(lambda m: m.group(2) or m.group(1), text)
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"^[ \t]*[-*+]\s+", "", text, flags=re.M)
    text = re.sub(r"[#>*_`~\[\]()]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:n]


def word_count(body: str) -> int:
    """中英混排的粗略字数（汉字按 1 个算）。"""
    cjk = len(re.findall(r"[\u4e00-\u9fa5]", body))
    words = len(re.findall(r"[A-Za-z0-9_]+", body))
    return cjk + words


# ------------------------------------------------------------------ 扫描

def scan(root: str | Path, with_body: bool = True) -> list[dict]:
    root = Path(root)
    if not root.is_dir():
        return []
    out: list[dict] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames
                             if d not in SKIP_DIRS and not d.startswith("."))
        for fn in sorted(filenames):
            if not fn.lower().endswith(".md"):
                continue
            p = Path(dirpath) / fn
            try:
                st = p.stat()
                if st.st_size > MAX_SIZE:
                    continue
                text = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            meta, body = parse_frontmatter(text)
            rel = p.relative_to(root).as_posix()
            folder = str(Path(rel).parent.as_posix())
            if folder == ".":
                folder = ""
            kind = "note"
            if rel.startswith("灵感盒/想法/"):
                kind = "idea"
            elif rel.startswith("灵感盒/整理/"):
                kind = "digest"
            out.append({
                "path": rel,
                "title": note_title(meta, body, p.stem),
                "folder": folder,
                "kind": kind,
                "tags": note_tags(meta, body),
                "links": note_links(body),
                "excerpt": excerpt(body),
                "words": word_count(body),
                "mtime": st.st_mtime,
                "size": st.st_size,
                "meta": {k: v for k, v in meta.items()
                         if k not in ("title", "tags")},
                "body": body if with_body else "",
            })
    return out


# ------------------------------------------------------------------ 读写

ILLEGAL = re.compile(r'[\\/:*?"<>|\r\n\t]')


def slugify(title: str, fallback: str = "未命名") -> str:
    s = ILLEGAL.sub(" ", title).strip()
    s = re.sub(r"\s+", " ", s)
    s = s.replace(" ", "-")
    s = s.strip(".-")
    return s[:60] or fallback


def unique_path(folder: Path, stem: str, suffix: str = ".md") -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    p = folder / f"{stem}{suffix}"
    i = 2
    while p.exists():
        p = folder / f"{stem}-{i}{suffix}"
        i += 1
    return p


def read_note(root: str | Path, rel: str) -> dict | None:
    root = Path(root)
    p = (root / rel).resolve()
    if not str(p).startswith(str(root.resolve())) or not p.is_file():
        return None
    text = p.read_text(encoding="utf-8", errors="replace")
    meta, body = parse_frontmatter(text)
    return {
        "path": rel,
        "title": note_title(meta, body, p.stem),
        "meta": meta,
        "body": body,
        "tags": note_tags(meta, body),
        "links": note_links(body),
        "mtime": p.stat().st_mtime,
        "size": p.stat().st_size,
    }


def write_note(root: str | Path, rel: str, meta: dict, body: str) -> str:
    root = Path(root)
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(dump_frontmatter(meta, body), encoding="utf-8")
    return rel


def append_note(root: str | Path, rel: str, text: str) -> None:
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(text)


def delete_note(root: str | Path, rel: str) -> bool:
    p = (Path(root) / rel).resolve()
    if p.is_file() and str(p).startswith(str(Path(root).resolve())):
        p.unlink()
        return True
    return False


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")
