# -*- coding: utf-8 -*-
"""AI 层：把零散笔记与素材整理成摘要 / 观点 / 大纲 / 关联。

两种模式
--------
* ``local``：纯本地分析（分词 → TF-IDF → 抽取式摘要 → 观点模板），不联网、不需要 key；
* ``openai``：任何 OpenAI 兼容的 /chat/completions 接口（DeepSeek、Moonshot、本地 Ollama 等）。

两种模式输出同样的 Markdown 结构，前端不需要区分。
"""
from __future__ import annotations

import json
import math
import re
import urllib.error
import urllib.request
from collections import Counter

CJK = re.compile(r"[\u4e00-\u9fa5]+")
LATIN = re.compile(r"[A-Za-z][A-Za-z0-9_\-]+")
SENT_SPLIT = re.compile(r"(?<=[。！？!?；;\n])")

STOP = set("""
的 了 和 是 在 我 有 就 不 人 都 一 一个 上 也 很 到 说 要 去 你 会 着 没有 看 好 自己 这
那 里 就是 还是 但是 因为 所以 如果 可以 这个 那个 什么 怎么 为什么 然后 而且 或者 以及
我们 你们 他们 它 被 把 给 对 从 向 与 及 等 让 使 得 地 之 其 中 后 前 时 时候 现在 已经
还 再 又 才 只 更 最 太 非常 比较 一些 这些 那些 这样 那样 感觉 觉得 应该 需要 可能 其实
那么 这么 一下 有点 有些 一直 一起 一样 不是 不能 不会 知道 看到 东西 事情 情况 地方
方面 方式 办法 时间 开始 继续 接着 另外 当然 虽然 不过 而是 于是 因此 并且 甚至 尤其
比如 例如 之类 等等 咱们 大家 别人 目前 现在 之后 之前 以后 以前 于是 同时 或者 以及
是什么 什么样 怎么样 什么样 为什么 因为 所以 但是 而且 或者 如果 然后
""".split())

CLAIM_WORDS = ("应该", "需要", "其实", "问题是", "关键是", "核心", "本质", "必须",
               "不能", "我更", "我想", "我认为", "感觉", "难点", "重点", "目标是",
               "决定", "打算", "倾向于", "不应该", "别", "千万不要")


# ------------------------------------------------------------------ 分词

# n-gram 会切出「个存档」「的了」这类半截词，按首尾字过滤
BAD_HEAD = set("个的了是在和就也都而并或与把被给对从向为这那他她它们我你您啥怎哪")
BAD_TAIL = set("个的了着过吗呢吧啊呀嘛哦哈之")


def _clean_token(t: str) -> bool:
    if len(t) <= 1:
        return False
    if t[0] in BAD_HEAD or t[-1] in BAD_TAIL:
        return False
    return True


def tokens(text: str) -> list[str]:
    """中文按 2-3 字滑窗 + 英文按词，够用且不依赖分词库。"""
    out: list[str] = []
    for run in CJK.findall(text):
        if len(run) == 1:
            continue
        if len(run) == 2:
            out.append(run)
            continue
        for n in (2, 3, 4):
            for i in range(len(run) - n + 1):
                g = run[i:i + n]
                if g not in STOP:
                    out.append(g)
    for w in LATIN.findall(text):
        w = w.lower()
        if len(w) > 2 and w not in STOP:
            out.append(w)
    return [t for t in out if t not in STOP and _clean_token(t)]


def keywords(docs: list[str], top: int = 14) -> list[tuple[str, float]]:
    """TF-IDF 关键词。docs 里每个元素是一篇文本。"""
    if not docs:
        return []
    df: Counter = Counter()
    tfs = []
    for d in docs:
        c = Counter(tokens(d))
        tfs.append(c)
        df.update(set(c))
    n = len(docs)
    score: Counter = Counter()
    for c in tfs:
        for t, f in c.items():
            score[t] += (1 + math.log(f)) * math.log(1 + n / (1 + df[t]))
    # 去掉被更长关键词包含的短词（“战斗”与“战斗系统”只留长的）
    # 同分时长词优先，避免「剑与魔」压过「剑与魔法」
    ranked = [t for t, _ in sorted(score.items(), key=lambda kv: (-kv[1], -len(kv[0])))[:top * 3]]
    keep = []
    for t in ranked:
        if any(t != o and t in o for o in ranked):
            continue
        # 3 字滑窗会切出「剑与魔 / 与魔法」这类重叠词，只留一个
        if any(len(t) >= 3 and len(o) >= 3 and (t[-2:] == o[:2] or o[-2:] == t[:2])
               for o in keep):
            continue
        keep.append(t)
        if len(keep) >= top:
            break
    return [(t, round(score[t], 2)) for t in keep]


def sentences(text: str) -> list[str]:
    parts = [s.strip() for s in SENT_SPLIT.split(text)]
    out = []
    for s in parts:
        s = s.strip().lstrip("-*+ ").strip()
        if len(s) < 10 or s.startswith(("---", "#", "|", ">", "```", "![", "[[")):
            continue
        if s.endswith(("？", "?")):
            continue
        out.append(s)
    return out


def summarize_local(items: list[dict], max_sent: int = 7) -> str:
    docs = [it.get("text", "") for it in items]
    kws = keywords(docs)
    kw = {k for k, _ in kws}
    scored = []
    for it in items:
        for s in sentences(it.get("text", "")):
            hit = sum(1 for t in tokens(s) if t in kw)
            pos_bonus = 1.0 if s.startswith(("#", "-", "*")) else 0.0
            scored.append((hit / (len(s) ** 0.35) + pos_bonus, s, it.get("title", "")))
    scored.sort(key=lambda x: -x[0])
    seen, picked = set(), []
    for sc, s, title in scored:
        key = s[:24]
        if key in seen:
            continue
        seen.add(key)
        picked.append((s, title))
        if len(picked) >= max_sent:
            break
    lines = ["## 摘要", ""]
    for s, title in picked:
        lines.append(f"- {s}（来源：{title}）")
    lines += ["", "## 关键词", "", "、".join(k for k, _ in kws[:12]) or "（材料太少）"]
    return "\n".join(lines)


def opinions_local(items: list[dict]) -> str:
    claims = []
    for it in items:
        for s in sentences(it.get("text", "")):
            if any(w in s for w in CLAIM_WORDS) and 10 <= len(s) <= 120:
                claims.append((len([w for w in CLAIM_WORDS if w in s]), s, it.get("title", "")))
    claims.sort(key=lambda x: -x[0])
    picked, seen = [], set()
    for _, s, title in claims:
        if s[:16] in seen:
            continue
        seen.add(s[:16])
        picked.append((s, title))
        if len(picked) >= 3:
            break

    kws = [k for k, _ in keywords([it.get("text", "") for it in items], 10)]
    out = ["## 我的判断", ""]
    if not picked:
        out.append("这批材料里还没有出现明确的判断句，先补几条「我觉得…」「问题是…」再来看。")
    for i, (s, title) in enumerate(picked, 1):
        out.append(f"**{i}. {s}**")
        out.append(f"　依据：{title} 里的原话。")
        out.append("")
    if kws:
        out += ["## 反复出现的词", "",
                "、".join(kws[:8]),
                "",
                "这些词说明你最近的注意力集中在这里；如果它们没有出现在你的项目目标里，"
                "要么是跑题，要么是目标写漏了。", ""]
    out += ["## 可以继续追问", ""]
    for k in kws[:4]:
        out.append(f"- 「{k}」现在最大的不确定性是什么？")
    out.append("- 如果只能保留一条，删掉哪条？为什么？")
    out.append("")
    out += ["## 可能的反例", "",
            "上面这些判断都来自你自己的笔记，缺少外部反证。"
            "建议找一篇立场相反的案例（竞品、失败复盘、论文），看看哪条判断会先站不住。"]
    return "\n".join(out)


def outline_local(items: list[dict]) -> str:
    kws = keywords([it.get("text", "") for it in items], 10)
    out = ["## 素材盘点", ""]
    for it in items:
        out.append(f"- **{it.get('title', '')}**（{len(it.get('text', ''))} 字）")
    out += ["", "## 建议结构", ""]
    for i, (k, _) in enumerate(kws[:6], 1):
        out.append(f"{i}. **{k}** —— 从上面材料里挑 1-2 段直接引用，再补一句你的判断。")
    out += ["", "## 还缺什么", ""]
    out.append("- 具体案例 / 数据：现在的材料以想法为主，缺可验证的事实。")
    out.append("- 反对意见：至少找一条能推翻主线的论据。")
    return "\n".join(out)


def connect_local(items: list[dict], top: int = 6) -> str:
    def vec(text: str) -> Counter:
        return Counter(tokens(text))

    def cos(a: Counter, b: Counter) -> float:
        if not a or not b:
            return 0.0
        common = set(a) & set(b)
        num = sum(a[t] * b[t] for t in common)
        den = math.sqrt(sum(v * v for v in a.values())) * math.sqrt(sum(v * v for v in b.values()))
        return num / den if den else 0.0

    vs = [vec(it.get("text", "")) for it in items]
    pairs = []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            pairs.append((cos(vs[i], vs[j]), i, j))
    pairs.sort(reverse=True)
    out = ["## 关联度最高的组合", ""]
    for sc, i, j in pairs[:top]:
        if sc <= 0:
            continue
        shared = [t for t in (set(tokens(items[i].get("text", ""))) &
                              set(tokens(items[j].get("text", "")))) if len(t) > 2][:5]
        out.append(f"- **{items[i].get('title', '')}** ↔ **{items[j].get('title', '')}**"
                   f"（相似度 {sc:.2f}）")
        if shared:
            out.append(f"　共同点：{'、'.join(shared)}")
    out += ["", "## 看起来无关但值得放一起的", ""]
    for sc, i, j in pairs[-3:]:
        out.append(f"- {items[i].get('title', '')} / {items[j].get('title', '')}"
                   f"（相似度 {sc:.2f}，几乎不重叠，适合做对照）")
    return "\n".join(out)


LOCAL_MODES = {
    "summarize": summarize_local,
    "opinion": opinions_local,
    "outline": outline_local,
    "connect": connect_local,
}


# ------------------------------------------------------------------ LLM

SYSTEM = (
    "你是一个中文写作与产品思考助手，服务于一个独立创作者。"
    "你会收到他的零散笔记与素材说明，需要做整理工作。要求：\n"
    "1. 只基于给定材料，不要编造材料里没有的事实；引用时用「材料名」标注；\n"
    "2. 观点要具体、可反驳，不要正确但空洞的话；\n"
    "3. 输出 Markdown，不要开场白、不要总结段、不要“希望对你有帮助”；\n"
    "4. 如果材料不足以支撑某个结论，直接说“材料不足以判断”。"
)

TASKS = {
    "summarize": (
        "请把下面的材料整理成结构化摘要：\n"
        "## 一句话结论\n## 关键信息（3-6 条，每条一句话）\n"
        "## 材料之间的分歧\n## 还没说清楚的地方"
    ),
    "opinion": (
        "请基于下面的材料，提出 3 条**你自己的判断**。每条按这个格式：\n"
        "**判断**：一句话。\n**依据**：引用材料里的具体内容（标注来源）。\n"
        "**可能的反驳**：什么情况下这条会错。\n**下一步**：怎么验证。\n"
        "最后加一节「## 我认为最值得做的一件事」，只写一件，并说明为什么是它。"
    ),
    "outline": (
        "请把这些材料整理成一篇 1500 字左右的文章大纲：\n"
        "## 标题（给 3 个备选）\n## 核心论点\n## 分节结构（每节一句话说明写什么、用哪份材料）\n"
        "## 需要补的材料"
    ),
    "connect": (
        "请找出这些材料之间的联系：\n"
        "## 强关联（互相印证的）\n## 张力（互相矛盾的）\n## 组合起来能产生的新想法"
    ),
    "expand": (
        "请把这条想法展开成可执行的方案：\n"
        "## 它在解决什么问题\n## 最小可行版本\n## 需要的前提\n## 三个风险\n## 本周可以做的第一步"
    ),
    "daily": (
        "请写一份今天的回顾：\n## 今天记了什么（2-3 句）\n## 反复出现的主题\n"
        "## 一个被忽略的点\n## 明天值得先做的一件事"
    ),
}


def _context(items: list[dict], budget: int = 14000) -> str:
    parts, used = [], 0
    for it in items:
        head = f"### 材料：{it.get('title', '未命名')}"
        if it.get("kind") == "asset":
            body = it.get("text", "")
        else:
            body = it.get("text", "")[:4000]
        chunk = head + "\n" + body.strip() + "\n"
        if used + len(chunk) > budget:
            break
        parts.append(chunk)
        used += len(chunk)
    return "\n".join(parts)


def call_llm(cfg: dict, mode: str, items: list[dict], extra: str = "") -> dict:
    base = (cfg.get("base_url") or "").rstrip("/")
    key = cfg.get("api_key") or ""
    model = cfg.get("model") or "deepseek-chat"
    if not base:
        raise ValueError("还没有配置 AI 接口地址")
    if not key:
        raise ValueError("还没有配置 API Key")
    user = TASKS.get(mode, TASKS["summarize"]) + "\n\n" + _context(items)
    if extra.strip():
        user += "\n\n补充要求：" + extra.strip()
    payload = {
        "model": model,
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": user}],
        "temperature": float(cfg.get("temperature", 0.7)),
        "max_tokens": int(cfg.get("max_tokens", 1800)),
        "stream": False,
    }
    req = urllib.request.Request(
        base + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {key}"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"接口返回 {e.code}：{body}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"连不上接口：{e.reason}") from e
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError):
        raise RuntimeError(f"返回格式不对：{str(data)[:300]}")
    usage = data.get("usage") or {}
    return {"text": text.strip(), "model": model, "usage": usage}


def run(mode: str, items: list[dict], cfg: dict, extra: str = "") -> dict:
    provider = (cfg.get("provider") or "local").lower()
    if provider == "openai":
        return call_llm(cfg, mode, items, extra)
    fn = LOCAL_MODES.get(mode, summarize_local)
    text = fn(items) if mode != "expand" else _expand_local(items, extra)
    return {"text": text, "model": "local", "usage": {}}


def _expand_local(items: list[dict], extra: str) -> str:
    it = items[0] if items else {"title": "", "text": ""}
    kws = [k for k, _ in keywords([it.get("text", "")], 6)]
    out = ["## 它在解决什么问题", "",
           f"从材料看，这条想法的核心是「{kws[0] if kws else it.get('title', '')}」。", "",
           "## 最小可行版本", ""]
    for i, k in enumerate(kws[:3], 1):
        out.append(f"{i}. 先只做「{k}」这一块，其他先不管。")
    out += ["", "## 需要的前提", "", "- 明确的验收标准（怎样算做完）",
            "- 一个能在一周内跑完的验证方式", "",
            "## 三个风险", "",
            "- 范围蔓延：想做的比能做的多", "- 反馈太晚：做完才给人看",
            "- 素材/信息不足：判断建立在猜测上", "",
            "## 本周可以做的第一步", "",
            f"把「{it.get('title', '这条想法')}」写成 200 字的需求说明，"
            "然后找一个人念给他听，看他能不能复述。"]
    return "\n".join(out)
