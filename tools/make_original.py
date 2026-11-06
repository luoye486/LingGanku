# -*- coding: utf-8 -*-
"""
生成"原创"素材（无第三方版权问题）：
  1. 线性风格 SVG 图标集          -> assets/images/icons/
  2. 可平铺 SVG 图案              -> assets/images/patterns/
  3. SVG 渐变背景                 -> assets/images/backgrounds/
  4. 合成音效 / 循环 pad          -> assets/audio/sfx/
  5. 占位视频（渐变 / 网格）      -> assets/video/placeholders/

运行： python tools/make_original.py
依赖： Pillow + numpy（DSH 运行时自带）；ffmpeg 需在 PATH 中（仅占位视频用到）
"""
from __future__ import annotations

import math
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "assets" / "images"
SFX = ROOT / "assets" / "audio" / "sfx"
PHV = ROOT / "assets" / "video" / "placeholders"

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

SVG_HEAD = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" '
    'fill="none" stroke="#1f2937" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'
)

# ---------------------------------------------------------------- 图标 ----
# 每个图标只写内部图元；stroke 风格，24x24 网格。
ICONS: dict[str, str] = {
    "home": '<path d="M4 10.5 12 4l8 6.5"/><path d="M6.5 9.8V20h11V9.8"/>',
    "search": '<circle cx="10.8" cy="10.8" r="5.6"/><path d="M15 15l4.5 4.5"/>',
    "user": '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>',
    "users": '<circle cx="9.2" cy="8.4" r="3.2"/><path d="M3 19.5c0-3.2 2.8-5.4 6.2-5.4s6.2 2.2 6.2 5.4"/>'
             '<path d="M16.4 5.6a3.2 3.2 0 0 1 0 5.9"/><path d="M18 14.6c2 .7 3.3 2.4 3.3 4.9"/>',
    "settings": '<path d="M4 7.6h3.4M12.2 7.6H20"/><circle cx="9.8" cy="7.6" r="2.1"/>'
                '<path d="M4 16.4h7.8M16.6 16.4H20"/><circle cx="14.2" cy="16.4" r="2.1"/>',
    "heart": '<path d="M12 20.2S4.6 15.6 4.6 10.6A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.4 3'
             'c0 5-7.4 9.6-7.4 9.6Z"/>',
    "star": '<path d="M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.8-5.1 2.8 1-5.7-4.1-4 5.7-.8Z"/>',
    "bell": '<path d="M6.4 17h11.2l-1.3-2.3V11a4.3 4.3 0 0 0-8.6 0v3.7Z"/>'
            '<path d="M10.3 19.8a1.9 1.9 0 0 0 3.4 0"/>',
    "mail": '<rect x="3.4" y="5.8" width="17.2" height="12.4" rx="2"/>'
            '<path d="M4 7.4l8 5.6 8-5.6"/>',
    "calendar": '<rect x="3.4" y="5.4" width="17.2" height="14.2" rx="2"/><path d="M3.4 10h17.2"/>'
                '<path d="M8 3.4v4M16 3.4v4"/>',
    "clock": '<circle cx="12" cy="12" r="8"/><path d="M12 7.8v4.6l3.2 1.9"/>',
    "camera": '<path d="M3.4 8.6h3.1L8 6.1h8l1.5 2.5h3.1v10.3H3.4Z"/>'
              '<circle cx="12" cy="13.4" r="3.3"/>',
    "image": '<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="2"/>'
             '<circle cx="8.6" cy="9.6" r="1.6"/><path d="M4.2 17l4.6-4.6 3.6 3.6 3-3 4.6 4.6"/>',
    "video": '<rect x="3.2" y="6.4" width="12.2" height="11.2" rx="2"/>'
             '<path d="M15.4 11.4l5.4-3.2v7.6l-5.4-3.2Z"/>',
    "music": '<path d="M9 17.4V6.9l8-1.8v9.8"/><circle cx="6.8" cy="17.6" r="2.2"/>'
             '<circle cx="14.8" cy="15.8" r="2.2"/>',
    "play": '<path d="M8 5.2l10.5 6.8L8 18.8Z"/>',
    "pause": '<path d="M9 5.4v13.2M15 5.4v13.2"/>',
    "download": '<path d="M12 3.8v10.4"/><path d="M7.6 10 12 14.4 16.4 10"/><path d="M4.4 19.6h15.2"/>',
    "upload": '<path d="M12 14.8V4.4"/><path d="M7.6 8.8 12 4.4l4.4 4.4"/><path d="M4.4 19.6h15.2"/>',
    "share": '<circle cx="6" cy="12" r="2.2"/><circle cx="17.6" cy="6.4" r="2.2"/>'
             '<circle cx="17.6" cy="17.6" r="2.2"/><path d="M8 11l7.7-3.4M8 13l7.7 3.4"/>',
    "link": '<path d="M10.2 13.8a4.1 4.1 0 0 0 5.8 0l2.3-2.3a4.1 4.1 0 0 0-5.8-5.8L11.2 7"/>'
            '<path d="M13.8 10.2a4.1 4.1 0 0 0-5.8 0l-2.3 2.3a4.1 4.1 0 0 0 5.8 5.8l1.3-1.3"/>',
    "folder": '<path d="M3.4 7.2h6l1.9 2.3h9.3v9.1H3.4Z"/>',
    "file": '<path d="M6.4 3.6h7.1l4.5 4.5v12.3H6.4Z"/><path d="M13.5 3.6v4.5h4.5"/>',
    "trash": '<path d="M4.4 6.9h15.2"/><path d="M9.4 6.9V4.4h5.2v2.5"/>'
             '<path d="M6.4 6.9l1 12.7h9.2l1-12.7"/><path d="M10.4 10.4v6M13.6 10.4v6"/>',
    "edit": '<path d="M4.4 19.6l1-4.2 9.9-9.9 3.2 3.2-9.9 9.9Z"/><path d="M13.8 6l3.2 3.2"/>',
    "plus": '<path d="M12 4.8v14.4M4.8 12h14.4"/>',
    "check": '<path d="M4.8 12.4 9.4 17 19.2 6.6"/>',
    "close": '<path d="M6 6l12 12M18 6 6 18"/>',
    "arrow-right": '<path d="M4.4 12h15.2"/><path d="M13.6 6l6 6-6 6"/>',
    "arrow-left": '<path d="M19.6 12H4.4"/><path d="M10.4 6l-6 6 6 6"/>',
    "chevron-down": '<path d="M6 9.4l6 6 6-6"/>',
    "menu": '<path d="M4.4 7h15.2M4.4 12h15.2M4.4 17h15.2"/>',
    "grid": '<rect x="3.8" y="3.8" width="6.6" height="6.6" rx="1.4"/>'
            '<rect x="13.6" y="3.8" width="6.6" height="6.6" rx="1.4"/>'
            '<rect x="3.8" y="13.6" width="6.6" height="6.6" rx="1.4"/>'
            '<rect x="13.6" y="13.6" width="6.6" height="6.6" rx="1.4"/>',
    "list": '<path d="M8.4 6.4h11.2M8.4 12h11.2M8.4 17.6h11.2"/>'
            '<circle cx="4.6" cy="6.4" r="1.1" fill="#1f2937" stroke="none"/>'
            '<circle cx="4.6" cy="12" r="1.1" fill="#1f2937" stroke="none"/>'
            '<circle cx="4.6" cy="17.6" r="1.1" fill="#1f2937" stroke="none"/>',
    "lock": '<rect x="4.6" y="10.4" width="14.8" height="9.4" rx="2"/>'
            '<path d="M8.2 10.4V7.9a3.8 3.8 0 0 1 7.6 0v2.5"/>',
    "eye": '<path d="M2.6 12S6.2 6.6 12 6.6 21.4 12 21.4 12 17.8 17.4 12 17.4 2.6 12 2.6 12Z"/>'
           '<circle cx="12" cy="12" r="2.7"/>',
    "tag": '<path d="M4.2 11.4V4.2h7.2l8.8 8.8-7.2 7.2Z"/><circle cx="7.8" cy="7.8" r="1.4"/>',
    "bookmark": '<path d="M6.6 4.4h10.8v15.2L12 15.4l-5.4 4.2Z"/>',
    "cloud": '<path d="M7.6 18.2a4.1 4.1 0 0 1 .4-8.2 5.6 5.6 0 0 1 10.2 1.4 3.5 3.5 0 0 1-.7 6.8Z"/>',
    "sun": '<circle cx="12" cy="12" r="4"/>'
           '<path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4'
           'M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3 17 7M7 17l-1.7 1.7"/>',
    "moon": '<path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8Z"/>',
    "map-pin": '<path d="M12 21s6.6-6.3 6.6-11.1A6.6 6.6 0 0 0 5.4 9.9C5.4 14.7 12 21 12 21Z"/>'
               '<circle cx="12" cy="9.9" r="2.4"/>',
    "send": '<path d="M20.6 3.4 3.4 10.6l7.1 2.5 2.5 7.1Z"/><path d="M10.5 13.1 20.6 3.4"/>',
    "refresh": '<path d="M20 12a8 8 0 1 1-2.7-6"/><path d="M20 4.2V9h-4.8"/>',
    "filter": '<path d="M3.4 6h17.2M6.4 12h11.2M10 18h4"/>',
    "copy": '<rect x="8.4" y="8.4" width="11.4" height="11.4" rx="2"/>'
            '<path d="M15.6 8.4V6.2a2 2 0 0 0-2-2H6.2a2 2 0 0 0-2 2v7.4a2 2 0 0 0 2 2h2.2"/>',
    "external-link": '<path d="M13.4 4.6h6v6"/><path d="M19.4 4.6 11 13"/>'
                     '<path d="M18 14.4v4.2a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8V7.2'
                     'a1.8 1.8 0 0 1 1.8-1.8h4.2"/>',
}

FILLED = {"play", "star", "bookmark", "send"}  # 实心更适合这几个


def write_icons() -> int:
    out = IMG / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for name, inner in ICONS.items():
        if name in FILLED:
            head = SVG_HEAD.replace('fill="none"', 'fill="#1f2937"').replace(
                ' stroke="#1f2937" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"',
                ' stroke="none"',
            )
        else:
            head = SVG_HEAD
        (out / f"icon-{name}.svg").write_text(head + inner + "</svg>", encoding="utf-8")
    return len(ICONS)


# ---------------------------------------------------------------- 图案 ----
PATTERNS = {
    "dots": dict(w=24, h=24, defs='<circle cx="6" cy="6" r="1.7" fill="#1f2937" fill-opacity="0.34"/>'
                                    '<circle cx="18" cy="18" r="1.7" fill="#1f2937" fill-opacity="0.34"/>'),
    "grid": dict(w=32, h=32, defs='<path d="M0 0H32M0 0V32" stroke="#1f2937" stroke-opacity="0.26" '
                                   'stroke-width="1" fill="none"/>'),
    "diagonal": dict(w=18, h=18, defs='<path d="M-4 4 4 -4M0 18 18 0M14 22 22 14" stroke="#1f2937" '
                                       'stroke-opacity="0.26" stroke-width="1.4" fill="none"/>'),
    "waves": dict(w=48, h=24, defs='<path d="M0 16C6 16 6 8 12 8s6 8 12 8 6-8 12-8 6 8 12 8" '
                                    'stroke="#1f2937" stroke-opacity="0.30" stroke-width="1.4" fill="none"/>'),
    "cross": dict(w=28, h=28, defs='<path d="M14 9v10M9 14h10" stroke="#1f2937" stroke-opacity="0.30" '
                                    'stroke-width="1.4" stroke-linecap="round" fill="none"/>'),
    "triangle": dict(w=26, h=26, defs='<path d="M13 6 20 19H6Z" stroke="#1f2937" stroke-opacity="0.24" '
                                       'stroke-width="1.2" fill="none"/>'),
}


def write_patterns() -> int:
    out = IMG / "patterns"
    out.mkdir(parents=True, exist_ok=True)
    for name, p in PATTERNS.items():
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" '
            f'viewBox="0 0 1200 800">\n'
            f'  <defs><pattern id="p" width="{p["w"]}" height="{p["h"]}" patternUnits="userSpaceOnUse">'
            f'{p["defs"]}</pattern></defs>\n'
            f'  <rect width="1200" height="800" fill="#ffffff"/>\n'
            f'  <rect width="1200" height="800" fill="url(#p)"/>\n'
            f'</svg>\n'
        )
        (out / f"pattern-{name}.svg").write_text(svg, encoding="utf-8")
    return len(PATTERNS)


# ---------------------------------------------------------------- 背景 ----
BACKGROUNDS = {
    "aurora": [("#eef2ff", "#c7d2fe", "#a5b4fc"), ("#f0f9ff", "#bae6fd", "#7dd3fc")],
    "sunset": [("#fff7ed", "#fed7aa", "#fdba74"), ("#fef2f2", "#fecaca", "#fca5a5")],
    "mint": [("#ecfdf5", "#a7f3d0", "#6ee7b7"), ("#eff6ff", "#bfdbfe", "#93c5fd")],
    "graphite": [("#111827", "#1f2937", "#374151"), ("#0f172a", "#1e293b", "#334155")],
}


def write_backgrounds() -> int:
    out = IMG / "backgrounds"
    out.mkdir(parents=True, exist_ok=True)
    n = 0
    for name, layers in BACKGROUNDS.items():
        blobs = []
        for i, (c0, c1, c2) in enumerate(layers):
            cx = 220 + i * 780
            cy = 180 + i * 300
            blobs.append(
                f'<radialGradient id="g{i}" cx="50%" cy="50%" r="50%">'
                f'<stop offset="0%" stop-color="{c1}" stop-opacity="0.95"/>'
                f'<stop offset="100%" stop-color="{c2}" stop-opacity="0"/></radialGradient>'
                f'<circle cx="{cx}" cy="{cy}" r="620" fill="url(#g{i})"/>'
            )
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" '
            'viewBox="0 0 1920 1080">\n  <defs>\n    '
            + "\n    ".join(blobs)
            + f'\n  </defs>\n  <rect width="1920" height="1080" fill="{layers[0][0]}"/>\n'
            + "".join(f'  <circle cx="{220 + i * 780}" cy="{180 + i * 300}" r="620" fill="url(#g{i})"/>\n'
                      for i in range(len(layers)))
            + '</svg>\n'
        )
        (out / f"bg-{name}.svg").write_text(svg, encoding="utf-8")
        n += 1
    return n


# ---------------------------------------------------------------- 音效 ----
SR = 44100


def _t(dur: float) -> np.ndarray:
    return np.arange(int(SR * dur)) / SR


def _save_wav(path: Path, x: np.ndarray) -> None:
    x = np.clip(x, -1.0, 1.0)
    pcm = (x * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def _exp_env(n: int, tau: float) -> np.ndarray:
    return np.exp(-np.arange(n) / (SR * tau))


def _attack(x: np.ndarray, ms: float) -> np.ndarray:
    k = max(1, int(SR * ms / 1000))
    if k >= len(x):
        return x
    ramp = np.linspace(0.0, 1.0, k)
    x = x.copy()
    x[:k] *= ramp
    return x


def _sine(f: float, dur: float, detune: float = 0.0) -> np.ndarray:
    t = _t(dur)
    return np.sin(2 * math.pi * f * t) + (0.5 * np.sin(2 * math.pi * (f + detune) * t) if detune else 0)


def make_sfx() -> list[tuple[str, float]]:
    SFX.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(7)
    made: list[tuple[str, float]] = []

    # 1) UI 点击：短噪声脉冲 + 高频 blip
    d = 0.09
    n = int(SR * d)
    noise = rng.normal(0, 1, n) * _exp_env(n, 0.008)
    blip = np.sin(2 * math.pi * 1400 * _t(d)) * _exp_env(n, 0.012) * 0.5
    x = _attack(noise * 0.55 + blip, 1)
    x /= max(1e-9, np.abs(x).max())
    _save_wav(SFX / "sfx-click.wav", x * 0.75)
    made.append(("sfx-click.wav", d))

    # 2) 开关切换：两声短促
    parts = []
    for f, tau in ((660, 0.05), (990, 0.06)):
        seg = np.sin(2 * math.pi * f * _t(0.07)) * _exp_env(int(SR * 0.07), tau)
        parts.append(_attack(seg, 2))
    x = np.concatenate(parts)
    x /= max(1e-9, np.abs(x).max())
    _save_wav(SFX / "sfx-toggle.wav", x * 0.7)
    made.append(("sfx-toggle.wav", len(x) / SR))

    # 3) 成功提示：C5-E5-G5 琶音
    total = np.zeros(int(SR * 0.85))
    for i, f in enumerate((523.25, 659.25, 783.99)):
        seg = _sine(f, 0.5, detune=1.2) * _exp_env(int(SR * 0.5), 0.16) * 0.5
        seg = _attack(seg, 8)
        s = int(SR * 0.11 * i)
        total[s:s + len(seg)] += seg
    total /= max(1e-9, np.abs(total).max())
    _save_wav(SFX / "sfx-success.wav", total * 0.8)
    made.append(("sfx-success.wav", len(total) / SR))

    # 4) 错误提示：两声下行
    total = np.zeros(int(SR * 0.62))
    for i, f in enumerate((392.0, 311.13)):
        seg = _sine(f, 0.3) * _exp_env(int(SR * 0.3), 0.1) * 0.45
        seg = _attack(seg, 6)
        s = int(SR * 0.2 * i)
        total[s:s + len(seg)] += seg
    total /= max(1e-9, np.abs(total).max())
    _save_wav(SFX / "sfx-error.wav", total * 0.8)
    made.append(("sfx-error.wav", len(total) / SR))

    # 5) 转场 whoosh：噪声 + 扫频低通
    d = 0.75
    n = int(SR * d)
    noise = rng.normal(0, 1, n)
    # 一阶低通，系数随时间从 0.02 扫到 0.6 再回落
    cut = np.concatenate([np.linspace(0.02, 0.6, n // 2), np.linspace(0.6, 0.05, n - n // 2)])
    out = np.zeros(n)
    y = 0.0
    for i in range(n):
        y += cut[i] * (noise[i] - y)
        out[i] = y
    envl = np.sin(np.linspace(0, math.pi, n)) ** 1.6
    out *= envl
    out /= max(1e-9, np.abs(out).max())
    _save_wav(SFX / "sfx-whoosh.wav", out * 0.7)
    made.append(("sfx-whoosh.wav", d))

    # 6) 弹出 pop：上滑正弦
    d = 0.16
    t = _t(d)
    f = np.linspace(300, 900, len(t))
    x = np.sin(2 * math.pi * np.cumsum(f) / SR) * _exp_env(len(t), 0.05)
    x = _attack(x, 3)
    x /= max(1e-9, np.abs(x).max())
    _save_wav(SFX / "sfx-pop.wav", x * 0.7)
    made.append(("sfx-pop.wav", d))

    # 7) 通知双音
    total = np.zeros(int(SR * 0.7))
    for i, f in enumerate((880.0, 1174.66)):
        seg = _sine(f, 0.4) * _exp_env(int(SR * 0.4), 0.13) * 0.4
        seg = _attack(seg, 5)
        s = int(SR * 0.16 * i)
        total[s:s + len(seg)] += seg
    total /= max(1e-9, np.abs(total).max())
    _save_wav(SFX / "sfx-notify.wav", total * 0.75)
    made.append(("sfx-notify.wav", len(total) / SR))

    # 8) 循环 pad（8s，频率对齐 0.125Hz 网格 -> 无缝循环）
    d = 8.0
    t = _t(d)
    chord = (110.0, 164.81, 220.0, 277.18, 329.63)
    x = np.zeros(len(t))
    for k, f in enumerate(chord):
        fq = round(f / 0.125) * 0.125
        x += np.sin(2 * math.pi * fq * t + k) / (k + 1.6)
    lfo = 0.85 + 0.15 * np.sin(2 * math.pi * 0.125 * t)
    x *= lfo
    x /= max(1e-9, np.abs(x).max())
    _save_wav(SFX / "sfx-pad-loop.wav", x * 0.55)
    made.append(("sfx-pad-loop.wav", d))
    return made


# ------------------------------------------------------------ 占位视频 ----
def _frame_gradient(w: int, h: int, t: float) -> Image.Image:
    yy, xx = np.mgrid[0:h, 0:w]
    x = xx / w
    y = yy / h
    a = np.sin(2 * math.pi * (x * 0.6 + t * 0.18))
    b = np.cos(2 * math.pi * (y * 0.5 - t * 0.13))
    m = (a + b + 2) / 4
    c0 = np.array([79, 70, 229], dtype=float)
    c1 = np.array([6, 182, 212], dtype=float)
    img = c0[None, None, :] * (1 - m[..., None]) + c1[None, None, :] * m[..., None]
    return Image.fromarray(img.astype(np.uint8), "RGB")


def _frame_grid(w: int, h: int, t: float) -> Image.Image:
    yy, xx = np.mgrid[0:h, 0:w]
    base = np.zeros((h, w, 3), dtype=float)
    base[..., :] = np.array([15, 23, 42])
    step = 64
    grid = ((xx % step) < 1.2) | ((yy % step) < 1.2)
    base[grid] = np.array([51, 65, 85])
    cx = w / 2 + math.cos(t * 2 * math.pi * 0.5) * w * 0.28
    cy = h / 2 + math.sin(t * 2 * math.pi * 0.5) * h * 0.22
    r = 90.0
    d2 = (xx - cx) ** 2 + (yy - cy) ** 2
    glow = np.exp(-d2 / (2 * r * r))
    base += glow[..., None] * np.array([99, 102, 241]) * 1.15
    return Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")


def make_placeholder_videos() -> list[str]:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        print("  ! 未找到 ffmpeg，跳过占位视频")
        return []
    PHV.mkdir(parents=True, exist_ok=True)
    w, h, fps, secs = 1280, 720, 24, 6
    out: list[str] = []
    for name, fn in (("placeholder-gradient-1280x720", _frame_gradient),
                     ("placeholder-grid-1280x720", _frame_grid)):
        # 帧序列写到系统临时目录，避免污染素材库
        tmp = Path(tempfile.mkdtemp(prefix="dsh_frames_"))
        try:
            for i in range(fps * secs):
                fn(w, h, i / fps).save(tmp / f"f_{i:04d}.png")
            dst = PHV / f"{name}.mp4"
            cmd = [
                ffmpeg, "-y", "-loglevel", "error", "-framerate", str(fps),
                "-i", str(tmp / "f_%04d.png"),
                "-c:v", "libx264", "-preset", "medium", "-crf", "30",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(dst),
            ]
            subprocess.run(cmd, check=True)
            out.append(dst.name)
            print(f"  + {dst.name}  {dst.stat().st_size / 1024:.0f} KB")
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    return out


def main() -> None:
    print("生成原创素材 ...")
    print(f"  图标 {write_icons()} 个")
    print(f"  图案 {write_patterns()} 个")
    print(f"  背景 {write_backgrounds()} 个")
    sfx = make_sfx()
    print(f"  音效 {len(sfx)} 个")
    for name, dur in sfx:
        print(f"    + {name}  {dur:.2f}s  {(SFX / name).stat().st_size / 1024:.0f} KB")
    vids = make_placeholder_videos()
    print(f"  占位视频 {len(vids)} 个")


if __name__ == "__main__":
    main()
