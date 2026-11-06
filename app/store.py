# -*- coding: utf-8 -*-
"""SQLite 索引：笔记全文检索、AI 运行记录。

笔记本身仍然以 Obsidian 里的 `.md` 为准，这里只是可重建的缓存。
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

import vault

SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    path    TEXT PRIMARY KEY,
    title   TEXT NOT NULL,
    folder  TEXT,
    kind    TEXT,
    tags    TEXT,
    links   TEXT,
    excerpt TEXT,
    body    TEXT,
    words   INTEGER DEFAULT 0,
    mtime   REAL,
    size    INTEGER,
    meta    TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_kind ON notes(kind);
CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder);
CREATE INDEX IF NOT EXISTS idx_notes_mtime ON notes(mtime);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    path UNINDEXED, title, body, tags, tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS runs (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    kind    TEXT,
    prompt  TEXT,
    output  TEXT,
    model   TEXT,
    sources TEXT,
    created REAL
);

CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT
);
"""


class Store:
    def __init__(self, db_path: str | Path):
        db_path = Path(db_path)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.executescript(SCHEMA)
        self.lock = threading.RLock()

    # ------------------------------------------------------------ 同步

    def sync(self, vault_root: str) -> dict:
        notes = vault.scan(vault_root, with_body=True)
        with self.lock:
            cur = self.db.cursor()
            cur.execute("SELECT path FROM notes")
            old = {r["path"] for r in cur.fetchall()}
            new = {n["path"] for n in notes}
            for n in notes:
                cur.execute(
                    """INSERT INTO notes(path,title,folder,kind,tags,links,excerpt,body,words,mtime,size,meta)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(path) DO UPDATE SET
                         title=excluded.title, folder=excluded.folder, kind=excluded.kind,
                         tags=excluded.tags, links=excluded.links, excerpt=excluded.excerpt,
                         body=excluded.body, words=excluded.words, mtime=excluded.mtime,
                         size=excluded.size, meta=excluded.meta""",
                    (n["path"], n["title"], n["folder"], n["kind"],
                     json.dumps(n["tags"], ensure_ascii=False),
                     json.dumps(n["links"], ensure_ascii=False),
                     n["excerpt"], n["body"], n["words"], n["mtime"], n["size"],
                     json.dumps(n["meta"], ensure_ascii=False, default=str)))
            for p in old - new:
                cur.execute("DELETE FROM notes WHERE path=?", (p,))
            cur.execute("DELETE FROM notes_fts")
            cur.execute("INSERT INTO notes_fts(path,title,body,tags) "
                        "SELECT path,title,body,tags FROM notes")
            self.db.commit()
        return {"total": len(notes), "added": len(new - old), "removed": len(old - new)}

    # ------------------------------------------------------------ 查询

    @staticmethod
    def _row(r: sqlite3.Row) -> dict:
        d = dict(r)
        d["tags"] = json.loads(d.get("tags") or "[]")
        d["links"] = json.loads(d.get("links") or "[]")
        d["meta"] = json.loads(d.get("meta") or "{}")
        d.pop("body", None) if d.get("body") is None else None
        return d

    def get(self, path: str) -> dict | None:
        with self.lock:
            r = self.db.execute("SELECT * FROM notes WHERE path=?", (path,)).fetchone()
        return self._row(r) if r else None

    def list(self, kind: str | None = None, folder: str | None = None,
             limit: int = 500, offset: int = 0) -> list[dict]:
        sql = "SELECT path,title,folder,kind,tags,links,excerpt,words,mtime,size,meta FROM notes"
        args, where = [], []
        if kind:
            where.append("kind=?")
            args.append(kind)
        if folder is not None:
            where.append("folder=?")
            args.append(folder)
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += " ORDER BY mtime DESC LIMIT ? OFFSET ?"
        args += [limit, offset]
        with self.lock:
            rows = self.db.execute(sql, args).fetchall()
        return [self._row(r) for r in rows]

    def folders(self) -> list[dict]:
        with self.lock:
            rows = self.db.execute(
                "SELECT folder, kind, COUNT(*) n, MAX(mtime) m FROM notes GROUP BY folder, kind"
            ).fetchall()
        agg: dict[str, dict] = {}
        for r in rows:
            f = r["folder"] or ""
            a = agg.setdefault(f, {"folder": f, "count": 0, "mtime": 0, "kinds": {}})
            a["count"] += r["n"]
            a["mtime"] = max(a["mtime"], r["m"] or 0)
            a["kinds"][r["kind"]] = r["n"]
        return sorted(agg.values(), key=lambda x: x["folder"])

    def search(self, q: str, kinds: list[str] | None = None, limit: int = 40) -> list[dict]:
        q = (q or "").strip()
        if not q:
            return []
        out: list[dict] = []
        with self.lock:
            if len(q) >= 3:
                try:
                    expr = '"' + q.replace('"', '""') + '"'
                    rows = self.db.execute(
                        """SELECT path,title,folder,kind,tags,excerpt,
                                  snippet(notes_fts, 2, '«', '»', '…', 14) AS snip
                           FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?""",
                        (expr, limit)).fetchall()
                    for r in rows:
                        d = self._row(r)
                        d["snippet"] = d.pop("snip", "")
                        out.append(d)
                except sqlite3.Error:
                    out = []
            if not out:
                like = f"%{q}%"
                rows = self.db.execute(
                    """SELECT path,title,folder,kind,tags,excerpt FROM notes
                       WHERE title LIKE ? OR body LIKE ? OR tags LIKE ?
                       ORDER BY mtime DESC LIMIT ?""", (like, like, like, limit)).fetchall()
                out = [self._row(r) for r in rows]
        if kinds:
            out = [d for d in out if d.get("kind") in kinds]
        return out

    def stats(self) -> dict:
        with self.lock:
            total = self.db.execute("SELECT COUNT(*) c FROM notes").fetchone()["c"]
            words = self.db.execute("SELECT COALESCE(SUM(words),0) w FROM notes").fetchone()["w"]
            kinds = {r["kind"]: r["n"] for r in self.db.execute(
                "SELECT kind, COUNT(*) n FROM notes GROUP BY kind").fetchall()}
            last = self.db.execute("SELECT MAX(mtime) m FROM notes").fetchone()["m"]
        return {"total": total, "words": words, "kinds": kinds,
                "last_mtime": last, "last_sync": self.kv_get("last_sync")}

    # ------------------------------------------------------------ 运行记录

    def save_run(self, kind: str, prompt: str, output: str, model: str,
                 sources: list[str]) -> int:
        with self.lock:
            cur = self.db.execute(
                "INSERT INTO runs(kind,prompt,output,model,sources,created) VALUES(?,?,?,?,?,?)",
                (kind, prompt, output, model, json.dumps(sources, ensure_ascii=False), time.time()))
            self.db.commit()
            return int(cur.lastrowid)

    def runs(self, limit: int = 30) -> list[dict]:
        with self.lock:
            rows = self.db.execute(
                "SELECT id,kind,prompt,output,model,sources,created FROM runs "
                "ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["sources"] = json.loads(d["sources"] or "[]")
            out.append(d)
        return out

    # ------------------------------------------------------------ KV

    def kv_get(self, k: str, default=None):
        with self.lock:
            r = self.db.execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
        if not r:
            return default
        try:
            return json.loads(r["v"])
        except Exception:
            return r["v"]

    def kv_set(self, k: str, v) -> None:
        with self.lock:
            self.db.execute("INSERT INTO kv(k,v) VALUES(?,?) "
                            "ON CONFLICT(k) DO UPDATE SET v=excluded.v",
                            (k, json.dumps(v, ensure_ascii=False)))
            self.db.commit()
