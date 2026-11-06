# -*- coding: utf-8 -*-
"""灵感盒 · 本地服务（只用标准库，双击 start.bat 即可运行）。

    python app/server.py            # 默认 http://127.0.0.1:8791
    python app/server.py --port 9000
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import shutil
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
WEB = APP / "web"
CONFIG = APP / "config.json"
DATA = ROOT / ".data"

sys.path.insert(0, str(APP))

import ai  # noqa: E402
import assets as assets_mod  # noqa: E402
import vault  # noqa: E402
from store import Store  # noqa: E402

DEFAULT_CONFIG = {
    "port": 8791,
    "vault": "",
    "ai": {
        "provider": "local",
        "base_url": "https://api.deepseek.com/v1",
        "api_key": "",
        "model": "deepseek-chat",
        "temperature": 0.7,
        "max_tokens": 1800,
    },
    "ui": {"density": "cozy"},
}

IDEA_FOLDER = "灵感盒/想法"
DIGEST_FOLDER = "灵感盒/整理"
STATUSES = ["inbox", "thinking", "building", "done"]

STATE_LOCK = threading.RLock()
CFG: dict = {}
STORE: Store | None = None
ASSET_CACHE: list[dict] = []
ASSET_TS = 0.0


# ------------------------------------------------------------------ 配置

def load_config() -> dict:
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    if CONFIG.exists():
        try:
            user = json.loads(CONFIG.read_text(encoding="utf-8"))
            deep_merge(cfg, user)
        except Exception:
            traceback.print_exc()
    if not cfg.get("vault"):
        cfg["vault"] = vault.detect_vault() or ""
    return cfg


def deep_merge(dst: dict, src: dict) -> dict:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            deep_merge(dst[k], v)
        else:
            dst[k] = v
    return dst


def save_config(cfg: dict) -> None:
    CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CONFIG.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


def get_store() -> Store:
    global STORE
    if STORE is None:
        STORE = Store(DATA / "app.db")
    return STORE


def get_assets(force: bool = False) -> list[dict]:
    global ASSET_CACHE, ASSET_TS
    with STATE_LOCK:
        if force or not ASSET_CACHE or time.time() - ASSET_TS > 30:
            ASSET_CACHE = assets_mod.scan(force=force)
            ASSET_TS = time.time()
        return ASSET_CACHE


def sync_vault() -> dict:
    st = get_store()
    v = CFG.get("vault") or ""
    if not v or not Path(v).is_dir():
        return {"total": 0, "error": "还没有设置 Obsidian 库路径"}
    info = st.sync(v)
    st.kv_set("last_sync", time.time())
    return info


# ------------------------------------------------------------------ 业务

def idea_from_note(n: dict) -> dict:
    meta = n.get("meta") or {}
    return {
        "path": n["path"],
        "title": n["title"],
        "status": meta.get("status") or "inbox",
        "tags": n.get("tags", []),
        "assets": meta.get("assets") or [],
        "created": meta.get("created") or "",
        "updated": meta.get("updated") or "",
        "excerpt": n.get("excerpt", ""),
        "words": n.get("words", 0),
        "mtime": n.get("mtime", 0),
    }


def create_idea(payload: dict) -> dict:
    title = (payload.get("title") or "").strip() or "未命名想法"
    body = payload.get("body") or ""
    tags = payload.get("tags") or []
    asset_list = payload.get("assets") or []
    status = payload.get("status") or "inbox"
    if status not in STATUSES:
        status = "inbox"
    stem = vault.slugify(title)
    path = vault.unique_path(Path(CFG["vault"]) / IDEA_FOLDER, stem)
    rel = path.relative_to(Path(CFG["vault"])).as_posix()
    meta = {
        "title": title,
        "type": "idea",
        "status": status,
        "tags": tags,
        "assets": asset_list,
        "created": vault.now_str(),
        "updated": vault.now_str(),
    }
    source = (payload.get("source") or "").strip()
    if source:
        meta["source"] = source
    vault.write_note(CFG["vault"], rel, meta, body)
    sync_vault()
    return {"path": rel}


def update_idea(rel: str, payload: dict) -> dict:
    note = vault.read_note(CFG["vault"], rel)
    if not note:
        return {"error": "笔记不存在"}
    meta = note["meta"]
    meta["title"] = (payload.get("title") or note["title"]).strip()
    meta["status"] = payload.get("status", meta.get("status", "inbox"))
    meta["tags"] = payload.get("tags", note.get("tags", []))
    meta["assets"] = payload.get("assets", meta.get("assets", []))
    meta["type"] = meta.get("type") or "idea"
    meta["updated"] = vault.now_str()
    meta.setdefault("created", vault.now_str())
    body = payload.get("body", note["body"])
    vault.write_note(CFG["vault"], rel, meta, body)
    sync_vault()
    return {"path": rel}


def save_digest(payload: dict) -> dict:
    title = (payload.get("title") or "AI 整理").strip()
    text = payload.get("text") or ""
    sources = payload.get("sources") or []
    mode = payload.get("mode") or "summarize"
    path = vault.unique_path(Path(CFG["vault"]) / DIGEST_FOLDER, vault.slugify(title))
    rel = path.relative_to(Path(CFG["vault"])).as_posix()
    meta = {
        "title": title,
        "type": "digest",
        "mode": mode,
        "model": payload.get("model") or "local",
        "sources": sources,
        "created": vault.now_str(),
    }
    vault.write_note(CFG["vault"], rel, meta, text)
    sync_vault()
    return {"path": rel}


def collect_items(paths: list[str], extra_text: str = "") -> list[dict]:
    """把选中的笔记/素材拼成 AI 上下文。"""
    items = []
    for p in paths[:24]:
        if p.startswith("assets/"):
            a = next((x for x in get_assets() if x["path"] == p), None)
            if not a:
                continue
            desc = [f"素材：{a['name']}（{a['cat']}，{a['ext']}）"]
            if a.get("frames"):
                desc.append(f"序列图 {a['frames']} 帧，每帧 {a.get('fw')}×{a.get('fh')}，{a.get('fps')}fps")
            if a.get("w"):
                desc.append(f"尺寸 {a['w']}×{a['h']}")
            if a.get("note"):
                desc.append(a["note"])
            if a.get("author"):
                desc.append(f"来源 {a['author']} / {a.get('license', '')}")
            items.append({"title": a["name"], "kind": "asset", "path": p,
                          "text": "；".join(desc)})
        else:
            n = vault.read_note(CFG["vault"], p)
            if not n:
                continue
            items.append({"title": n["title"], "kind": "note", "path": p,
                          "text": n["body"]})
    if extra_text.strip():
        items.append({"title": "临时输入", "kind": "note", "path": "",
                      "text": extra_text.strip()})
    return items


# ------------------------------------------------------------------ HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "LingGanHe/1.0"

    def log_message(self, fmt, *args):
        if os.environ.get("LGH_DEBUG"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -------------------------------------------------- 工具
    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _err(self, msg, status=400):
        self._json({"error": str(msg)}, status)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _file(self, path: Path, download=False, cache=True):
        if not path.is_file():
            self._err("文件不存在", 404)
            return
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        size = path.stat().st_size
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        partial = False
        if rng and rng.startswith("bytes="):
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                if m.group(2):
                    end = min(int(m.group(2)), size - 1)
                partial = True
        length = max(0, end - start + 1)
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if download:
            self.send_header("Content-Disposition",
                             f'attachment; filename="{path.name}"')
        self.send_header("Cache-Control", "public, max-age=3600" if cache else "no-cache")
        self.end_headers()
        with path.open("rb") as f:
            f.seek(start)
            left = length
            while left > 0:
                chunk = f.read(min(65536, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)

    # -------------------------------------------------- GET
    def do_GET(self):
        try:
            u = urlparse(self.path)
            p = unquote(u.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            if p == "/" or p == "/index.html":
                return self._file(WEB / "index.html", cache=False)
            if p.startswith("/static/"):
                return self._file(WEB / p[len("/static/"):], cache=False)
            if p.startswith("/assets/"):
                f = assets_mod.resolve(p.lstrip("/"))
                return self._file(f) if f else self._err("非法路径", 403)
            if p.startswith("/api/"):
                return self.api_get(p, q)
            return self._err("未找到", 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            traceback.print_exc()
            self._err("服务器内部错误", 500)

    def api_get(self, p: str, q: dict):
        if p == "/api/bootstrap":
            return self._json(self.bootstrap())
        if p == "/api/notes":
            kind = q.get("kind") or None
            folder = q.get("folder")
            limit = int(q.get("limit") or 200)
            return self._json({"items": get_store().list(kind=kind, folder=folder, limit=limit)})
        if p == "/api/note":
            n = vault.read_note(CFG["vault"], q.get("path", ""))
            return self._json(n or {"error": "不存在"})
        if p == "/api/search":
            return self._json({"items": get_store().search(q.get("q", ""))})
        if p == "/api/assets":
            items = get_assets()
            cat = q.get("cat")
            kw = (q.get("q") or "").lower()
            if cat and cat != "all":
                items = [i for i in items if i["cat"] == cat]
            if kw:
                items = [i for i in items if kw in i["name"].lower() or kw in i["cat"].lower()]
            return self._json({"items": items, "summary": assets_mod.summary(get_assets())})
        if p == "/api/runs":
            return self._json({"items": get_store().runs()})
        if p == "/api/canvas":
            f = APP / "canvas.json"
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                data = {"version": 1, "links": [], "positions": {}}
            return self._json(data)
        if p == "/api/config":
            cfg = json.loads(json.dumps(CFG))
            if cfg["ai"].get("api_key"):
                cfg["ai"]["api_key_set"] = True
                cfg["ai"]["api_key"] = "••••••" + cfg["ai"]["api_key"][-4:]
            return self._json(cfg)
        return self._err("未找到", 404)

    # -------------------------------------------------- POST/PUT/DELETE
    def do_POST(self):
        try:
            u = urlparse(self.path)
            p = unquote(u.path)
            if p == "/api/upload":
                return self.api_upload()
            if p.startswith("/api/"):
                return self.api_post(p, self._body())
            return self._err("未找到", 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            traceback.print_exc()
            self._err(f"服务器内部错误：{e}", 500)

    def do_PUT(self):
        try:
            p = unquote(urlparse(self.path).path)
            body = self._body()
            if p == "/api/note":
                rel = body.get("path") or ""
                note = vault.read_note(CFG["vault"], rel)
                if not note:
                    return self._err("笔记不存在", 404)
                meta = note["meta"]
                meta["title"] = (body.get("title") or note["title"]).strip()
                meta["updated"] = vault.now_str()
                if "status" in body:
                    meta["status"] = body["status"]
                if "tags" in body:
                    meta["tags"] = body["tags"]
                if "assets" in body:
                    meta["assets"] = body["assets"]
                vault.write_note(CFG["vault"], rel, meta, body.get("body", note["body"]))
                sync_vault()
                return self._json({"ok": True, "path": rel})
            if p == "/api/canvas":
                links = body.get("links", [])
                positions = body.get("positions", {})
                if not isinstance(links, list) or not isinstance(positions, dict):
                    return self._err("画布数据格式不正确", 400)
                (APP / "canvas.json").write_text(
                    json.dumps({"version": 1, "links": links, "positions": positions}, ensure_ascii=False),
                    encoding="utf-8")
                return self._json({"ok": True})
            if p == "/api/config":
                cfg = json.loads(json.dumps(CFG))
                incoming = body or {}
                if "vault" in incoming:
                    cfg["vault"] = incoming["vault"]
                if "ai" in incoming:
                    new_ai = incoming["ai"]
                    if new_ai.get("api_key", "").startswith("••"):
                        new_ai.pop("api_key", None)
                    deep_merge(cfg["ai"], new_ai)
                if "ui" in incoming:
                    deep_merge(cfg["ui"], incoming["ui"])
                CFG.update(cfg)
                save_config(CFG)
                sync_vault()
                return self._json({"ok": True})
            return self._err("未找到", 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            traceback.print_exc()
            self._err(f"服务器内部错误：{e}", 500)

    def do_DELETE(self):
        try:
            p = unquote(urlparse(self.path).path)
            q = {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}
            if p == "/api/note":
                ok = vault.delete_note(CFG["vault"], q.get("path", ""))
                if ok:
                    sync_vault()
                return self._json({"ok": ok})
            return self._err("未找到", 404)
        except Exception as e:
            self._err(str(e), 500)

    def api_upload(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0 or n > 80 * 1024 * 1024:
            return self._err("文件过大或为空", 413)
        name = unquote(self.headers.get("X-Filename") or "") or "upload.bin"
        data = self.rfile.read(n)
        info = assets_mod.save_upload(name, data)
        get_assets(force=True)
        return self._json(info)

    def api_post(self, p: str, body: dict):
        if p == "/api/sync":
            return self._json(sync_vault())
        if p == "/api/idea":
            return self._json(create_idea(body))
        if p == "/api/idea/update":
            return self._json(update_idea(body.get("path", ""), body))
        if p == "/api/digest":
            return self._json(save_digest(body))
        if p == "/api/ai":
            mode = body.get("mode") or "summarize"
            paths = body.get("paths") or []
            extra = body.get("extra") or ""
            items = collect_items(paths, extra)
            if not items:
                return self._err("没有选中任何材料")
            t0 = time.time()
            try:
                res = ai.run(mode, items, CFG.get("ai") or {}, extra)
            except Exception as e:
                return self._json({"error": str(e)}, 400)
            res["elapsed"] = round(time.time() - t0, 1)
            res["sources"] = [i["path"] for i in items if i.get("path")]
            get_store().save_run(mode, json.dumps(paths, ensure_ascii=False),
                                 res.get("text", ""), res.get("model", ""),
                                 res.get("sources", []))
            return self._json(res)
        if p == "/api/rescan-assets":
            items = get_assets(force=True)
            return self._json(assets_mod.summary(items))
        return self._err("未找到", 404)

    # -------------------------------------------------- 引导数据
    def bootstrap(self) -> dict:
        st = get_store()
        stats = st.stats()
        ideas = [idea_from_note(n) for n in st.list(kind="idea", limit=300)]
        digests = st.list(kind="digest", limit=40)
        recent = st.list(limit=24)
        folders = st.folders()
        items = get_assets()
        cfg = json.loads(json.dumps(CFG))
        return {
            "config": {"vault": cfg["vault"], "port": cfg["port"],
                       "ai": {k: (("••••" + v[-4:]) if k == "api_key" and v else v)
                              for k, v in cfg["ai"].items()},
                       "ui": cfg.get("ui", {})},
            "stats": stats,
            "ideas": ideas,
            "digests": digests,
            "recent": recent,
            "folders": folders,
            "assets": assets_mod.summary(items),
            "statuses": STATUSES,
            "time": time.time(),
        }


def main():
    global CFG
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    CFG = load_config()
    port = args.port or int(CFG.get("port") or 8791)
    DATA.mkdir(parents=True, exist_ok=True)
    if CFG.get("vault"):
        sync_vault()
    else:
        print("！ 没有找到 Obsidian 库，请在设置里填写路径")

    try:
        srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError as e:
        print(f"！ 端口 {port} 打不开（可能已被占用）：{e}")
        print(f"   换个端口：python app/server.py --port {port + 1}")
        sys.exit(1)
    url = f"http://127.0.0.1:{port}/"
    print(f"灵感盒已启动：{url}")
    print(f"Obsidian 库：{CFG.get('vault') or '（未设置）'}")
    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
