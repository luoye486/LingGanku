# -*- coding: utf-8 -*-
"""生成像素游戏素材（v2，全部原创 / CC0-1.0）。

用法：python tools/make_pixel.py
产物：assets/pixel/**  与  meta/pixel.json（帧信息 / 色板 / 瓦片索引）

美术规则见 tools/pixelart.py 顶部说明：左上光源、三级明暗、1px 深色描边、抖动渐变。
"""
import json
import math
import random
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from pixelart import (C, Sprite, bevel, dither_fill, dither_gradient, finish,
                      mix, outline, pad_to, shade, strip)

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "pixel"
META = ROOT / "meta" / "pixel.json"

SHEETS = []          # 序列图元数据
TILESET = {"tile": 16, "cols": 7, "rows": 4, "cells": []}
EDGE = (18, 16, 30, 255)

# ------------------------------------------------------------------ 色板

PAL = {
    # 轮廓 / 中性
    "k": C("#12101e"), "d": C("#25243a"), "w": C("#f6f6fb"), "g": C("#a9b0c7"),
    "G": C("#666e8c"), "D": C("#3c4159"),
    # 红
    "r": C("#e04848"), "R": C("#9d2740"), "q": C("#ff8f8f"),
    # 橙 / 黄 / 金
    "o": C("#e8883a"), "y": C("#f5c542"), "Y": C("#b8862a"), "z": C("#fff2b0"),
    # 绿
    "n": C("#6abe30"), "N": C("#3d7a22"), "m": C("#a8e05f"),
    # 蓝
    "b": C("#4a7bd6"), "B": C("#2a4a8c"), "v": C("#7fa8ee"),
    # 青
    "c": C("#63d9e8"), "C": C("#28848f"),
    # 肤
    "s": C("#f2c48d"), "S": C("#c98f5a"), "h": C("#ffe6c0"),
    # 紫
    "p": C("#8b5cf6"), "P": C("#553ba0"),
    # 棕 / 木
    "t": C("#8a5a3b"), "T": C("#573524"), "u": C("#c08a5a"),
    # 石板
    "e": C("#9aa3b8"), "E": C("#5d6478"),
}


# ------------------------------------------------------------------ 通用小件

def shadow_ellipse(sp, cx, cy, rx, ry, alpha=70):
    sp.ellipse(cx, cy, rx, ry, (10, 10, 20, alpha))


def sparkle(sp, x, y, c=(255, 255, 255, 255)):
    sp.put(x, y, c)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sp.put(x + dx, y + dy, c)


def save_sheet(rel, frames, fps=8, loop=True, note="", size=None):
    frames = [pad_to(f, size[0], size[1]) if size else f for f in frames]
    img = strip(frames)
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    w, h = frames[0].size
    SHEETS.append({
        "file": str(path.relative_to(ROOT)).replace("\\", "/"),
        "frame_w": w, "frame_h": h, "frames": len(frames),
        "fps": fps, "loop": loop, "note": note,
    })
    return img


def save_img(rel, img):
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    return img


# ================================================================== 主角

HERO = 24


def hero_head(sp, y0=2, blink=False):
    """帽子 + 脸。y0 是帽子顶。"""
    b, B, v = PAL["b"], PAL["B"], PAL["v"]
    s, S, h = PAL["s"], PAL["S"], PAL["h"]
    # 帽冠
    sp.rect(7, y0, 16, y0, B)
    sp.rect(7, y0 + 1, 16, y0 + 3, b)
    sp.rect(8, y0 + 1, 9, y0 + 2, v)          # 左上受光
    sp.rect(15, y0 + 1, 16, y0 + 3, B)        # 右侧背光
    sp.hline(6, 17, y0 + 4, B)                # 帽带
    sp.hline(5, 18, y0 + 5, B)                # 帽檐
    sp.put(5, y0 + 5, C("#1b2f5e"))
    sp.put(18, y0 + 5, C("#1b2f5e"))
    # 脸
    fy = y0 + 6
    sp.rect(7, fy, 16, fy + 4, s)
    sp.rect(7, fy, 8, fy + 2, h)              # 额头受光
    sp.rect(15, fy + 1, 16, fy + 4, S)        # 右侧阴影
    sp.rect(7, fy + 4, 16, fy + 4, S)         # 下巴阴影
    # 眼睛（2×2 + 高光）
    if blink:
        sp.rect(9, fy + 2, 10, fy + 2, PAL["k"])
        sp.rect(13, fy + 2, 14, fy + 2, PAL["k"])
    else:
        sp.rect(9, fy + 2, 10, fy + 3, PAL["k"])
        sp.rect(13, fy + 2, 14, fy + 3, PAL["k"])
        sp.put(9, fy + 2, PAL["w"])
        sp.put(13, fy + 2, PAL["w"])
    # 嘴 + 腮红
    sp.hline(11, 12, fy + 4, C("#b8635a"))
    sp.put(8, fy + 3, C("#e8a07a"))
    sp.put(15, fy + 3, C("#e8a07a"))


def hero_body(sp, y0, legs="stand", arm_l=0, arm_r=0, scarf=0):
    """y0 = 围巾第一行。"""
    b, B, v = PAL["b"], PAL["B"], PAL["v"]
    s, S = PAL["s"], PAL["S"]
    r, R = PAL["r"], PAL["R"]
    t, T, y = PAL["t"], PAL["T"], PAL["y"]

    # 脖子
    sp.rect(10, y0 - 1, 13, y0 - 1, S)
    # 围巾
    sp.rect(6, y0, 17, y0, r)
    sp.rect(6, y0 + 1, 17, y0 + 1, R)
    sp.rect(7, y0, 9, y0, C("#ff6a6a"))
    # 围巾尾巴（随风摆动）
    tx = 17 + scarf
    sp.rect(tx, y0 + 1, tx + 2, y0 + 1, r)
    sp.rect(tx + 1, y0 + 2, tx + 3, y0 + 2, R)

    # 躯干
    ty = y0 + 2
    sp.rect(7, ty, 16, ty + 4, b)
    sp.rect(7, ty, 8, ty + 3, v)              # 左侧受光
    sp.rect(15, ty, 16, ty + 4, B)            # 右侧背光
    sp.rect(7, ty + 4, 16, ty + 4, B)
    # 衣领
    sp.hline(9, 14, ty, B)

    # 手臂
    for side, off in (("l", arm_l), ("r", arm_r)):
        ax = 5 if side == "l" else 17
        ay = ty + off
        sp.rect(ax, ay, ax + 1, ay + 3, b if side == "l" else B)
        sp.rect(ax, ay + 4, ax + 1, ay + 4, s)      # 手
        if side == "l":
            sp.put(ax, ay, v)

    # 腰带
    by = ty + 5
    sp.rect(6, by, 17, by, t)
    sp.rect(6, by, 17, by, t)
    sp.rect(11, by, 12, by, y)
    sp.hline(6, 17, by + 1, T)

    # 腿
    ly = by + 1
    poses = {
        "stand":  [(8, 10), (13, 15)],
        "run_a":  [(7, 9), (14, 16)],
        "run_b":  [(9, 11), (12, 14)],
        "run_c":  [(6, 8), (15, 17)],
        "tuck":   [(8, 10), (13, 15)],
        "spread": [(7, 9), (14, 16)],
    }[legs]
    (l0, l1), (r0, r1) = poses
    for x0, x1 in ((l0, l1), (r0, r1)):
        sp.rect(x0, ly, x1, ly + 1, B)
        sp.rect(x0, ly, x0, ly + 1, b)
    # 靴子
    by2 = ly + 2
    if legs == "tuck":
        sp.rect(l0, by2 - 1, l1, by2 - 1, t)
        sp.rect(r0, by2 - 1, r1, by2 - 1, t)
    elif legs == "spread":
        sp.rect(l0 - 1, by2, l1, by2, t)
        sp.rect(r0, by2, r1 + 1, by2, t)
    else:
        sp.rect(l0, by2, l1, by2, t)
        sp.rect(r0, by2, r1, by2, t)
    sp.hline(l0, l1, by2 + 1, T) if legs != "tuck" else None


def hero(pose="idle", i=0, size=HERO):
    sp = Sprite(size, size)
    if pose == "idle":
        bob = [0, 0, 1, 1, 1, 0][i % 6]
        scarf = [0, 0, 1, 1, 0, 0][i % 6]
        hero_head(sp, 2 + bob, blink=(i % 6 == 4))
        hero_body(sp, 13 + bob, "stand", arm_l=0, arm_r=0, scarf=scarf)
    elif pose == "run":
        bob = [0, 1, 0, 1, 0, 1, 0, 1][i % 8]
        legs = ["run_a", "run_b", "run_c", "run_b"][i % 4]
        arm = [0, -1, 0, 1][i % 4]
        scarf = [1, 1, 2, 2, 1, 1, 0, 0][i % 8]
        hero_head(sp, 2 + bob)
        hero_body(sp, 13 + bob, legs, arm_l=arm, arm_r=-arm, scarf=scarf)
    elif pose == "jump":
        cfg = [(0, "stand", 0, 0), (1, "tuck", -1, -1), (0, "tuck", -1, 1), (-1, "spread", 1, 1)][i % 4]
        bob, legs, al, ar = cfg
        hero_head(sp, 2 + bob)
        hero_body(sp, 13 + bob, legs, arm_l=al, arm_r=ar, scarf=1)
    elif pose == "attack":
        # 挥剑：剑刃用 3 个角度的亮弧表示
        bob = [0, 0, 1, 1, 0][i % 5]
        hero_head(sp, 2 + bob)
        hero_body(sp, 13 + bob, "run_a" if i in (2, 3) else "stand",
                  arm_l=0, arm_r=[0, -1, -2, -1, 0][i % 5], scarf=1)
        # 剑
        sx, sy = 17, 14 + bob
        if i == 0:
            sp.rect(sx, sy, sx, sy + 5, PAL["g"])
            sp.rect(sx, sy + 5, sx, sy + 6, PAL["y"])
        elif i == 1:
            for k in range(6):
                sp.put(sx + k, sy + 5 - k, PAL["w"])
            sp.put(sx + 6, sy - 1, PAL["w"])
        elif i == 2:
            for k in range(8):
                sp.put(sx + k - 1, sy + 2, PAL["w"])
            for k in range(4):
                sp.put(sx + k, sy + 1, PAL["q"])
        elif i == 3:
            for k in range(6):
                sp.put(sx + k - 2, sy - 2 + k, PAL["w"])
        else:
            sp.rect(sx, sy, sx, sy + 4, PAL["g"])
    return finish(sp, edge=EDGE)


def build_hero():
    save_sheet("characters/pixel-hero-idle.png", [hero("idle", i) for i in range(6)],
               fps=6, note="待机 6 帧（含眨眼）", size=(26, 26))
    save_sheet("characters/pixel-hero-run.png", [hero("run", i) for i in range(8)],
               fps=12, note="奔跑 8 帧（接触/过渡/伸展）", size=(26, 26))
    save_sheet("characters/pixel-hero-jump.png", [hero("jump", i) for i in range(4)],
               fps=8, loop=False, note="跳跃 4 帧（起跳/收腿/滞空/下落）", size=(26, 26))
    save_sheet("characters/pixel-hero-attack.png", [hero("attack", i) for i in range(5)],
               fps=12, loop=False, note="挥剑 5 帧（举剑/上挑/横斩/收势）", size=(26, 26))


# ================================================================== 敌人

def slime(i=0):
    sp = Sprite(26, 26)
    n, N, m = PAL["n"], PAL["N"], PAL["m"]
    sq = [(1.00, 1.00), (1.08, 0.92), (1.14, 0.86), (1.08, 0.92),
          (0.94, 1.06), (0.96, 1.04)][i % 6]
    cx, cy = 13, 17
    rx, ry = 8.0 * sq[0], 7.5 * sq[1]
    sp.ellipse(cx, cy, rx, ry, n)
    sp.half(cx, cy, rx, ry, N, "bottom")            # 底部阴影
    sp.half(cx - 1, cy - 1, rx * 0.75, ry * 0.7, m, "top")   # 顶部受光
    # 高光
    sp.rect(8, 12, 9, 13, PAL["w"])
    sp.put(10, 12, PAL["w"])
    # 眼睛
    ex, ey = 10, 15
    for dx in (0, 6):
        sp.rect(ex + dx, ey, ex + dx + 1, ey + 2, PAL["w"])
        sp.rect(ex + dx, ey + 1, ex + dx + 1, ey + 2, PAL["k"])
        sp.put(ex + dx, ey + 1, PAL["w"])
    # 嘴
    sp.hline(12, 14, ey + 3, PAL["k"])
    sp.put(12, ey + 4, PAL["k"])
    if i % 6 == 4:                                   # 眨眼
        for dx in (0, 6):
            sp.rect(ex + dx, ey + 1, ex + dx + 1, ey + 2, n)
            sp.hline(ex + dx, ex + dx + 1, ey + 2, PAL["k"])
    return finish(sp, edge=EDGE)


def bat(i=0):
    sp = Sprite(26, 26)
    p, P = PAL["p"], PAL["P"]
    flap = [(0, -3), (0, 0), (0, 3), (0, 0), (0, -3), (0, 0)][i % 6]
    # 翅膀（先画，身体盖在上面）
    for side in (-1, 1):
        bx = 13 + side * 4
        tip = 13 + side * 11
        for seg in range(4):
            x = bx + side * (seg * 2)
            y = 11 + flap[1] + (0 if seg == 0 else (1 if seg == 1 else 2))
            sp.rect(min(x, x + side * 1), y, max(x, x + side * 1), y + 1, p if seg % 2 == 0 else P)
        # 翼膜锯齿
        for seg in range(3):
            x = bx + side * (2 + seg * 2)
            sp.put(x, 11 + flap[1] + 3, P)
    # 身体
    sp.ellipse(13, 14, 3.6, 4.6, p)
    sp.half(13, 14, 3.6, 4.6, P, "bottom")
    # 头
    sp.ellipse(13, 10, 4.0, 3.8, p)
    sp.half(13, 10, 4.0, 3.8, shade(p, 1.2), "top")
    # 耳朵
    for dx in (-2, 2):
        sp.put(13 + dx, 6, p)
        sp.put(13 + dx, 5, p)
        sp.put(13 + dx + (1 if dx > 0 else -1), 6, P)
    # 眼睛
    for dx in (-2, 2):
        sp.rect(13 + dx, 9, 13 + dx, 10, PAL["r"])
        sp.put(13 + dx, 9, C("#ffb0b0"))
    # 尖牙
    sp.put(12, 12, PAL["w"])
    sp.put(14, 12, PAL["w"])
    return finish(sp, edge=EDGE)


def ghost(i=0):
    sp = Sprite(26, 26)
    w, g, G = C("#e6eefc"), C("#b6c6e6"), C("#7f92b8")
    bob = [0, 0, 1, 1, 0, 0][i % 6]
    top = 5 + bob
    sp.ellipse(13, top + 5, 7.0, 6.0, w)
    sp.rect(6, top + 5, 20, top + 11, w)
    # 底部波浪
    phase = i % 4
    for x in range(6, 21):
        wave = 1 if (x + phase) % 4 in (0, 1) else 0
        sp.rect(x, top + 12, x, top + 12 + wave, w)
    # 明暗
    sp.half(13, top + 5, 7.0, 6.0, G, "right")
    sp.rect(16, top + 6, 20, top + 11, G)
    sp.rect(6, top + 11, 20, top + 11, G)
    sp.half(12, top + 4, 5.5, 4.5, C("#ffffff"), "top")
    # 眼睛
    for dx in (-3, 3):
        sp.rect(13 + dx, top + 5, 13 + dx, top + 7, PAL["k"])
        sp.put(13 + dx, top + 5, PAL["c"])
    # 嘴
    sp.hline(12, 14, top + 9, PAL["k"])
    if i % 6 == 3:
        sp.rect(10, top + 5, 11, top + 7, w)
        sp.rect(15, top + 5, 16, top + 7, w)
    return finish(sp, edge=EDGE)


def build_enemies():
    save_sheet("characters/pixel-slime.png", [slime(i) for i in range(6)],
               fps=8, note="史莱姆 6 帧（挤压回弹 + 眨眼）", size=(28, 28))
    save_sheet("characters/pixel-bat.png", [bat(i) for i in range(6)],
               fps=14, note="蝙蝠 6 帧（振翅）", size=(28, 28))
    save_sheet("characters/pixel-ghost.png", [ghost(i) for i in range(6)],
               fps=6, note="幽灵 6 帧（漂浮 + 眨眼）", size=(28, 28))


# ================================================================== 道具

def coin(i=0):
    sp = Sprite(18, 18)
    y, Y, z = PAL["y"], PAL["Y"], PAL["z"]
    sq = [1.0, 0.75, 0.45, 0.16, 0.45, 0.75, 1.0, 0.9][i % 8]
    rx = 6.4 * sq
    sp.ellipse(9, 9, max(rx, 0.6), 6.4, Y)
    if rx > 1.2:
        sp.ellipse(9, 9, rx - 1.2, 5.2, y)
        sp.half(8, 7, rx - 1.6, 3.6, z, "top")
        sp.rect(7, 6, 8, 7, PAL["w"])
    return finish(sp, edge=EDGE)


def gem(i=0):
    sp = Sprite(18, 18)
    c, Cc, v = PAL["c"], PAL["C"], PAL["v"]
    # 菱形
    for y in range(3, 15):
        half = 6 - abs(y - 9)
        sp.hline(9 - half, 9 + half, y, c)
    sp.hline(4, 14, 9, c)
    sp.half(9, 8, 6.5, 6.5, C("#b6f5ff"), "top")
    sp.half(9, 10, 6.5, 6.5, Cc, "bottom")
    sp.rect(6, 6, 7, 7, PAL["w"])
    if i % 6 in (1, 2):
        sparkle(sp, 13, 5, PAL["w"])
    if i % 6 in (3, 4):
        sparkle(sp, 5, 12, PAL["w"])
    return finish(sp, edge=EDGE)


def heart(state=0):
    sp = Sprite(18, 18)
    r, R, q = PAL["r"], PAL["R"], PAL["q"]
    base = r if state < 2 else C("#4a4a63")
    dark = R if state < 2 else C("#33334a")
    sp.ellipse(6, 7, 3.6, 3.4, base)
    sp.ellipse(12, 7, 3.6, 3.4, base)
    for y in range(7, 16):
        half = max(0, int((16 - y) * 0.62))
        sp.hline(9 - half, 9 + half, y, base)
    sp.half(6, 6, 3.6, 3.4, q, "top")
    sp.half(9, 12, 5, 5, dark, "bottom")
    sp.rect(5, 5, 6, 6, PAL["w"])
    if state == 1:                      # 半血：只把右半边换成空槽颜色
        for y in range(18):
            for x in range(9, 18):
                c = sp.get(x, y)
                if c[3] > 0:
                    sp.put(x, y, C("#4a4a63") if c[:3] == r[:3] or c[:3] == q[:3] else C("#33334a"))
    return finish(sp, edge=EDGE)


def key():
    sp = Sprite(18, 18)
    y, Y, z = PAL["y"], PAL["Y"], PAL["z"]
    sp.ellipse(6, 6, 3.4, 3.4, y)
    sp.ellipse(6, 6, 1.8, 1.8, (0, 0, 0, 0))
    sp.rect(8, 5, 14, 6, y)
    sp.rect(12, 7, 13, 9, y)
    sp.rect(9, 7, 10, 9, y)
    sp.hline(8, 14, 5, z)
    sp.hline(8, 14, 6, Y)
    return finish(sp, edge=EDGE)


def potion():
    sp = Sprite(18, 20)
    t, T, c, Cc = PAL["t"], PAL["T"], PAL["c"], PAL["C"]
    sp.rect(7, 2, 10, 4, t)
    sp.hline(7, 10, 4, T)
    sp.rect(7, 5, 10, 6, Cc)
    sp.rect(5, 7, 12, 15, Cc)
    sp.rect(6, 8, 11, 14, c)
    sp.rect(6, 10, 11, 14, PAL["r"])
    sp.hline(6, 11, 10, PAL["q"])
    sp.rect(7, 9, 8, 12, PAL["w"])
    sp.rect(5, 7, 5, 15, Cc)
    sp.hline(5, 12, 15, Cc)
    return finish(sp, edge=EDGE)


def chest(open_=False):
    sp = Sprite(20, 18)
    t, T, u, y, Y = PAL["t"], PAL["T"], PAL["u"], PAL["y"], PAL["Y"]
    sp.rect(2, 8, 17, 16, t)
    sp.hline(2, 17, 8, u)
    sp.rect(2, 15, 17, 16, T)
    sp.rect(2, 8, 3, 16, u)
    if not open_:
        sp.rect(2, 4, 17, 7, t)
        sp.hline(2, 17, 4, u)
        sp.rect(2, 4, 17, 4, u)
        sp.rect(2, 4, 3, 7, u)
    else:
        sp.rect(2, 2, 17, 5, t)
        sp.hline(2, 17, 2, u)
        sp.rect(2, 2, 17, 2, u)
        sp.rect(4, 6, 15, 7, C("#2b1a12"))     # 内部
        sp.rect(6, 6, 7, 6, y)
        sp.rect(11, 6, 12, 6, y)
    # 金属包边 + 锁
    sp.rect(8, 4 if not open_ else 2, 11, 7, y)
    sp.rect(8, 8, 11, 9, y)
    sp.put(9, 9, PAL["k"])
    sp.put(10, 9, PAL["k"])
    sp.hline(2, 17, 7, Y)
    return finish(sp, edge=EDGE)


def star(i=0):
    sp = Sprite(18, 18)
    y, Y, z = PAL["y"], PAL["Y"], PAL["z"]
    pts = []
    for k in range(10):
        ang = -math.pi / 2 + k * math.pi / 5
        rad = 6.6 if k % 2 == 0 else 3.0
        pts.append((9 + math.cos(ang) * rad, 9 + math.sin(ang) * rad))
    from PIL import ImageDraw
    mask = Image.new("L", (18, 18), 0)
    ImageDraw.Draw(mask).polygon(pts, fill=255)
    for y2 in range(18):
        for x2 in range(18):
            if mask.getpixel((x2, y2)):
                sp.put(x2, y2, y)
    sp.half(9, 8, 7, 7, z, "top")
    sp.half(9, 10, 7, 7, Y, "bottom")
    if i % 6 in (0, 1):
        sparkle(sp, 14, 4, PAL["w"])
    if i % 6 in (2, 3):
        sparkle(sp, 4, 6, PAL["w"])
    return finish(sp, edge=EDGE)


def sword():
    sp = Sprite(20, 20)
    w, g, y, Y, t = PAL["w"], PAL["g"], PAL["y"], PAL["Y"], PAL["t"]
    for k in range(11):
        sp.put(9 + k, 14 - k, w)
        sp.put(10 + k, 14 - k, g)
    sp.rect(8, 14, 11, 15, Y)          # 护手
    sp.rect(9, 15, 10, 18, t)          # 柄
    sp.rect(8, 18, 11, 19, y)          # 柄头
    return finish(sp, edge=EDGE)


def shield():
    sp = Sprite(18, 20)
    b, B, v, y, Y = PAL["b"], PAL["B"], PAL["v"], PAL["y"], PAL["Y"]
    sp.rect(4, 3, 13, 12, b)
    sp.rect(4, 3, 4, 12, v)
    sp.rect(12, 3, 13, 12, B)
    for y2 in range(13, 18):
        half = max(0, 4 - (y2 - 13))
        sp.hline(9 - half, 9 + half, y2, b if half else B)
    sp.hline(4, 13, 3, y)
    sp.hline(4, 13, 12, Y)
    sp.rect(8, 6, 9, 10, y)            # 十字
    sp.rect(6, 7, 11, 8, y)
    return finish(sp, edge=EDGE)


def build_items():
    save_sheet("items/pixel-coin.png", [coin(i) for i in range(8)],
               fps=12, note="金币 8 帧旋转", size=(20, 20))
    save_sheet("items/pixel-gem.png", [gem(i) for i in range(6)],
               fps=6, note="宝石 6 帧闪光", size=(20, 20))
    save_sheet("items/pixel-heart.png", [heart(s) for s in (0, 1, 2)],
               fps=1, loop=False, note="血量 3 态（满/半/空）", size=(20, 20))
    save_sheet("items/pixel-star.png", [star(i) for i in range(6)],
               fps=6, note="星星 6 帧闪烁", size=(20, 20))
    save_sheet("items/pixel-chest.png", [chest(False), chest(True)],
               fps=2, loop=False, note="宝箱 2 态（关/开）", size=(22, 20))
    save_img("items/pixel-key.png", key())
    save_img("items/pixel-potion.png", potion())
    save_img("items/pixel-sword.png", sword())
    save_img("items/pixel-shield.png", shield())


# ================================================================== 瓦片

TS = 16


def tile(name, fn):
    sp = Sprite(TS, TS)
    fn(sp)
    # 瓦片必须保持 16×16，所以只做明暗、不描边
    img = bevel(sp.img, dark=0.78, light=1.16)
    TILESET["cells"].append({"name": name, "col": len(TILESET["cells"]) % TILESET["cols"],
                             "row": len(TILESET["cells"]) // TILESET["cols"]})
    return img


def _dirt(sp, seed=0):
    t, T, u = PAL["t"], PAL["T"], PAL["u"]
    sp.rect(0, 0, 15, 15, shade(t, 0.92))
    rnd = random.Random(seed)
    for _ in range(16):
        x, y = rnd.randrange(16), rnd.randrange(16)
        sp.put(x, y, shade(T, 1.05) if (x + y) % 3 else u)
    sp.hline(0, 15, 15, T)
    sp.vline(15, 0, 15, shade(T, 1.05))


def _grass(sp, seed=0):
    n, N, m = PAL["n"], PAL["N"], PAL["m"]
    _dirt(sp, seed)
    sp.rect(0, 0, 15, 4, n)
    sp.hline(0, 15, 0, m)
    sp.hline(0, 15, 1, m)
    sp.hline(0, 15, 4, N)
    # 草土交界的锯齿
    for x in range(0, 16, 2):
        sp.put(x, 5, n if (x // 2) % 2 == 0 else N)


def build_tiles():
    cells = []
    # 草地自动拼接 3×3（左上/上/右上/左/中/右/左下/下/右下）
    for i, nm in enumerate(["grass_tl", "grass_t", "grass_tr",
                            "grass_l", "grass_c", "grass_r",
                            "grass_bl", "grass_b", "grass_br"]):
        cells.append(tile(nm, lambda s, i=i: _grass(s, seed=i)))

    def stone(sp):
        e, E = PAL["e"], PAL["E"]
        sp.rect(0, 0, 15, 15, e)
        sp.rect(0, 0, 15, 0, shade(e, 1.12))
        sp.rect(0, 0, 0, 15, shade(e, 1.06))
        sp.rect(0, 15, 15, 15, E)
        sp.rect(15, 0, 15, 15, E)
        sp.hline(0, 15, 7, E)
        sp.hline(0, 15, 8, shade(e, 0.95))
        sp.put(3, 11, shade(E, 1.05))
        sp.put(11, 3, shade(E, 1.05))
        sp.put(4, 4, shade(e, 1.1))

    def brick(sp):
        r, R = C("#b4593f"), C("#7d3626")
        sp.rect(0, 0, 15, 15, r)
        sp.rect(0, 0, 15, 0, C("#d17050"))
        for y in (0, 5, 10, 15):
            sp.hline(0, 15, y, R)
        for y0 in (1, 6, 11):
            off = 0 if y0 == 1 else 8
            for x in range(off, 16, 8):
                sp.vline(x, y0, y0 + 3, R)

    def sand(sp):
        y = C("#e8d49a")
        sp.rect(0, 0, 15, 15, y)
        sp.hline(0, 15, 0, C("#f5e6bc"))
        sp.hline(0, 15, 15, C("#c0a870"))
        rnd = random.Random(7)
        for _ in range(12):
            sp.put(rnd.randrange(16), rnd.randrange(16), C("#cfb781"))

    def wood(sp):
        t, T, u = PAL["t"], PAL["T"], PAL["u"]
        sp.rect(0, 0, 15, 15, u)
        for y in (3, 7, 11, 15):
            sp.hline(0, 15, y, T)
        sp.hline(0, 15, 0, shade(u, 1.15))
        sp.put(5, 5, T)
        sp.put(11, 9, T)

    def platform(sp):
        y, Y, t, T = PAL["y"], PAL["Y"], PAL["t"], PAL["T"]
        sp.rect(0, 0, 15, 5, y)
        sp.hline(0, 15, 0, PAL["z"])
        sp.rect(0, 4, 15, 5, Y)
        sp.rect(0, 6, 15, 15, t)
        sp.hline(0, 15, 6, shade(t, 1.2))
        for x in (2, 7, 12):
            sp.vline(x, 7, 14, T)

    def ladder(sp):
        t, T = PAL["t"], PAL["T"]
        sp.vline(3, 0, 15, t)
        sp.vline(12, 0, 15, t)
        sp.vline(3, 0, 15, shade(t, 1.15))
        for y in (2, 7, 12):
            sp.hline(3, 12, y, t)
            sp.hline(3, 12, y + 1, T)

    def spikes(sp):
        g, G = PAL["g"], PAL["G"]
        sp.rect(0, 12, 15, 15, G)
        for x0 in range(0, 16, 4):
            for k in range(5):
                w = 2 if k < 4 else 0
                sp.hline(x0 + 1 - w, x0 + 2 + w, 12 - k, g if k < 4 else PAL["w"])
        for x0 in range(0, 16, 4):
            sp.put(x0 + 1, 8, PAL["w"])

    def water(sp, a=True):
        c, Cc = PAL["c"], PAL["C"]
        sp.rect(0, 0, 15, 15, Cc)
        sp.rect(0, 2, 15, 13, c)
        sp.hline(0, 15, 2, C("#b6f5ff"))
        for x in range(0, 16, 4):
            y = 5 if (x // 4 + (0 if a else 1)) % 2 == 0 else 7
            sp.hline(x, x + 2, y, C("#b6f5ff"))
            sp.hline(x, x + 2, y + 4, Cc)

    def lava(sp, a=True):
        o, y, R = PAL["o"], PAL["y"], C("#7d2018")
        sp.rect(0, 0, 15, 15, R)
        sp.rect(0, 2, 15, 13, o)
        for x in range(0, 16, 4):
            y2 = 5 if (x // 4 + (0 if a else 1)) % 2 == 0 else 8
            sp.hline(x, x + 2, y2, y)

    def bush(sp):
        n, N, m = PAL["n"], PAL["N"], PAL["m"]
        sp.ellipse(8, 11, 7, 5, n)
        sp.half(8, 9, 7, 5, m, "top")
        sp.half(8, 12, 7, 5, N, "bottom")
        sp.put(5, 9, PAL["w"])

    def flower(sp):
        n, N, m = PAL["n"], PAL["N"], PAL["m"]
        sp.vline(7, 8, 14, n)
        sp.put(6, 11, m)
        sp.put(8, 9, m)
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            sp.put(7 + dx, 5 + dy, C("#ff9ad5"))
        sp.put(7, 5, PAL["w"])

    cells += [tile("stone", stone), tile("brick", brick), tile("sand", sand),
              tile("wood", wood), tile("platform", platform), tile("ladder", ladder),
              tile("spikes", spikes), tile("water_a", lambda s: water(s, True)),
              tile("water_b", lambda s: water(s, False)), tile("lava_a", lambda s: lava(s, True)),
              tile("lava_b", lambda s: lava(s, False)), tile("bush", bush), tile("flower", flower)]

    cols, rows = TILESET["cols"], TILESET["rows"]
    sheet = Sprite(cols * TS, rows * TS)
    for i, img in enumerate(cells):
        sheet.blit(_img_sprite(img), (i % cols) * TS, (i // cols) * TS)
    save_img("tiles/pixel-tileset.png", sheet.img)
    TILESET["cells"] = TILESET["cells"][:len(cells)]
    return [(c["name"], img) for c, img in zip(TILESET["cells"], cells)]


def _img_sprite(img):
    sp = Sprite(img.size[0], img.size[1])
    sp.img = img
    sp.px = img.load()
    return sp


# ================================================================== 示例地图

def build_map(cells):
    W, H = 20, 11
    idx = {name: i for i, (name, _) in enumerate(cells)}
    cols = TILESET["cols"]
    rows = [
        "....gggggggggggggggg",
        "...ggggggggggggggggg",
        "..ggg..ggg..gggggggg",
        ".ggg....gg....gggggg",
        ".gg......g.....ggggg",
        ".gg.w..ppppp..pppp..",
        ".gg.w.....g..........",
        "..ggw.....g...ssss...",
        "...ggggggggggggggggg",
        "...ggggggggggggggggg",
        "....gggggggggggggggg",
    ]
    # 简化：用名字写地图，g=草 w=水 p=平台 l=梯 s=沙
    name_map = {"g": "grass_c", "w": "water_a", "p": "platform", "l": "ladder",
                "s": "sand", "b": "brick", "k": "stone", ".": None}
    img = Sprite(W * TS, H * TS)
    # 天空
    dither_gradient(img, 0, 0, W * TS - 1, H * TS - 1, C("#2b2b52"), C("#6b4a7a"), levels=5)
    for r, line in enumerate(rows):
        for c, ch in enumerate(line):
            nm = name_map.get(ch)
            if not nm:
                continue
            i = idx.get(nm)
            if i is None:
                continue
            src = _img_sprite(cells[i][1])
            img.blit(src, c * TS, r * TS)
    # 装饰：金币 + 主角
    img.blit(_img_sprite(coin(0)), 6 * TS + 2, 3 * TS)
    img.blit(_img_sprite(coin(0)), 13 * TS + 2, 3 * TS)
    img.blit(_img_sprite(hero("idle", 0, 26)), 1 * TS, 8 * TS - 4)
    save_img("tiles/pixel-map-demo.png", img.img)


# ================================================================== 背景

def build_backgrounds():
    W, H = 480, 270
    # 天空：抖动渐变 + 星星 + 月亮 + 远山
    sky = Sprite(W, H)
    dither_gradient(sky, 0, 0, W - 1, H - 1, C("#0f1030"), C("#4a3a6b"), levels=7)
    rnd = random.Random(3)
    for _ in range(120):
        x, y = rnd.randrange(W), rnd.randrange(H - 90)
        c = C("#ffffff") if rnd.random() > 0.3 else C("#b9c7ff")
        sky.put(x, y, c)
        if rnd.random() > 0.85:
            sparkle(sky, x, y, c)
    # 月亮
    sky.ellipse(380, 60, 22, 22, C("#f7f0d0"))
    sky.ellipse(374, 54, 16, 16, C("#fffbe8"))
    sky.ellipse(392, 66, 5, 5, C("#e8dfb8"))
    sky.ellipse(370, 70, 3, 3, C("#e8dfb8"))
    # 远山（大气透视：更暗更蓝）
    for x in range(W):
        h1 = 40 + int(14 * math.sin(x / 47.0) + 8 * math.sin(x / 19.0 + 1.2))
        sky.rect(x, H - 60 - h1, x, H - 1, C("#2a2b4e"))
        h2 = 26 + int(10 * math.sin(x / 31.0 + 2.1) + 6 * math.sin(x / 13.0))
        sky.rect(x, H - 40 - h2, x, H - 1, C("#1d1e3a"))
    save_img("backgrounds/pixel-bg-sky.png", sky.img)

    # 云
    cloud = Sprite(W, 96)
    rnd = random.Random(11)
    for cx in range(30, W, 96):
        for k in range(3):
            x = cx + rnd.randrange(-14, 14)
            y = 40 + rnd.randrange(-8, 10)
            r = 14 + rnd.randrange(0, 8)
            cloud.ellipse(x, y, r, r * 0.62, C("#d8d2ec"))
            cloud.ellipse(x - 2, y - 2, r * 0.7, r * 0.45, C("#efe9ff"))
        cloud.rect(cx - 30, 62, cx + 30, 66, C("#c3bcdc"))
    save_img("backgrounds/pixel-bg-clouds.png", cloud.img)

    # 山（近景，两层）
    mtn = Sprite(W, 160)
    for x in range(W):
        h1 = 70 + int(26 * math.sin(x / 61.0) + 14 * math.sin(x / 23.0 + 0.7))
        mtn.rect(x, 160 - h1, x, 159, C("#3b3b63"))
        h2 = 40 + int(18 * math.sin(x / 37.0 + 2.4) + 10 * math.sin(x / 17.0))
        mtn.rect(x, 160 - h2, x, 159, C("#2a2a4d"))
    # 雪顶
    for x in range(W):
        h1 = 70 + int(26 * math.sin(x / 61.0) + 14 * math.sin(x / 23.0 + 0.7))
        top = 160 - h1
        if h1 > 88:
            mtn.put(x, top, C("#cfd6f2"))
            mtn.put(x, top + 1, C("#a8b2d8"))
    save_img("backgrounds/pixel-bg-mountains.png", mtn.img)

    # 树林（三层剪影）
    trees = Sprite(W, 140)
    rnd = random.Random(5)
    for layer, (col, base, scale) in enumerate([(C("#232442"), 140, 1.0),
                                                (C("#1a1b33"), 140, 1.25)]):
        for x in range(-10, W + 10, 26):
            h = int((40 + rnd.randrange(0, 18)) * scale)
            cx = x + rnd.randrange(-4, 4)
            trees.rect(cx - 1, 140 - h // 3, cx + 1, 139, col)
            for k in range(3):
                trees.ellipse(cx, 140 - h // 3 - k * 9, 9 - k * 2, 7 - k, col)
    save_img("backgrounds/pixel-bg-trees.png", trees.img)


# ================================================================== UI

def build_ui():
    # 九宫格面板 32×32（角 8）
    p = Sprite(32, 32)
    base, light, dark = C("#2c3250"), C("#4a5480"), C("#1a1d30")
    p.rect(0, 0, 31, 31, base)
    p.rect(0, 0, 31, 1, light)
    p.rect(0, 0, 1, 31, light)
    p.rect(0, 30, 31, 31, dark)
    p.rect(30, 0, 31, 31, dark)
    p.rect(2, 2, 29, 29, C("#232841"))
    p.rect(3, 3, 28, 4, C("#2f3557"))
    for x, y in ((0, 0), (28, 0), (0, 28), (28, 28)):
        p.rect(x + 1, y + 1, x + 3, y + 3, C("#5c68a0"))
    save_img("ui/pixel-ui-panel.png", p.img)

    # 按钮 64×20 三态
    states = []
    for st in range(3):
        b = Sprite(64, 20)
        top = C("#5a68a8") if st == 1 else C("#46527f")
        mid = C("#39446c") if st == 1 else C("#2b3352")
        bot = C("#1c2138")
        off = 1 if st == 2 else 0
        b.rect(1, 1 + off, 62, 17 + off, mid)
        b.rect(1, 1 + off, 62, 3 + off, top)
        b.rect(1, 16 + off, 62, 17 + off, bot)
        b.rect(1, 1 + off, 2, 17 + off, top)
        b.rect(61, 1 + off, 62, 17 + off, bot)
        for x in range(22, 42, 6):
            b.rect(x, 8 + off, x + 3, 10 + off, C("#c8d2f0"))
        states.append(b.img)
    save_img("ui/pixel-ui-button.png", strip(states))

    # 血条框 + 填充
    f = Sprite(64, 12)
    f.rect(0, 0, 63, 11, C("#1a1d30"))
    f.rect(1, 1, 62, 10, C("#0d0f1c"))
    f.rect(1, 1, 62, 2, C("#3a4268"))
    save_img("ui/pixel-ui-bar-frame.png", f.img)
    for name, c1, c2 in (("hp", C("#5bd75b"), C("#2f8f2f")),
                         ("mp", C("#5aa8f0"), C("#2b5f9e")),
                         ("exp", C("#f5c542"), C("#a87f1e"))):
        b = Sprite(60, 8)
        b.rect(0, 0, 59, 7, c2)
        b.rect(0, 0, 59, 4, c1)
        b.hline(0, 59, 0, shade(c1, 1.25))
        b.hline(0, 59, 7, shade(c2, 0.8))
        save_img(f"ui/pixel-ui-bar-{name}.png", b.img)


# ================================================================== 音频

SR = 22050


def env(n, a=0.005, d=0.05, s=0.6, r=0.08):
    a = max(1, int(a * SR))
    d = max(1, int(d * SR))
    r = max(1, int(r * SR))
    n = max(a + d + r + 1, n)
    e = np.zeros(n)
    e[:a] = np.linspace(0, 1, a)
    e[a:a + d] = np.linspace(1, s, d)
    e[a + d:n - r] = s
    e[n - r:] = np.linspace(s, 0, r)
    return e


def osc(freq, n, wave="square", duty=0.5, vib=0.0, vib_rate=6.0):
    t = np.arange(n) / SR
    f = freq * (1.0 + vib * np.sin(2 * np.pi * vib_rate * t))
    phase = np.cumsum(f) / SR
    ph = phase % 1.0
    if wave == "square":
        return np.where(ph < duty, 1.0, -1.0)
    if wave == "tri":
        return 4.0 * np.abs(ph - 0.5) - 1.0
    if wave == "saw":
        return 2.0 * ph - 1.0
    if wave == "sine":
        return np.sin(2 * np.pi * ph)
    if wave == "noise":
        rnd = np.random.RandomState(1234)
        return rnd.uniform(-1, 1, n)
    raise ValueError(wave)


def note(freq, dur, wave="square", duty=0.5, vol=0.3, a=0.005, d=0.06, s=0.6, r=0.08, vib=0.0):
    n = int(dur * SR)
    sig = osc(freq, n, wave, duty, vib) * env(n, a, d, s, r)[:n]
    return sig * vol


def sweep(f0, f1, dur, wave="square", duty=0.5, vol=0.3, a=0.004, r=0.05):
    n = int(dur * SR)
    t = np.arange(n) / n
    f = f0 * (f1 / f0) ** t
    phase = np.cumsum(f) / SR
    ph = phase % 1.0
    sig = np.where(ph < duty, 1.0, -1.0) if wave == "square" else 4.0 * np.abs(ph - 0.5) - 1.0
    return sig * env(n, a, dur * 0.2, 0.5, r)[:n] * vol


def noise_hit(dur, vol=0.3, decay=6.0):
    n = int(dur * SR)
    rnd = np.random.RandomState(7)
    sig = rnd.uniform(-1, 1, n)
    # 一阶低通
    out = np.zeros(n)
    a = 0.55
    prev = 0.0
    for i in range(n):
        prev = prev * a + sig[i] * (1 - a)
        out[i] = prev
    t = np.arange(n) / SR
    return out * np.exp(-decay * t) * vol


def place(buf, start, sig, vol=1.0):
    s = int(start * SR)
    e = min(len(buf), s + len(sig))
    if e > s:
        buf[s:e] += sig[:e - s] * vol


def write_wav(rel, buf, sr=SR):
    buf = np.clip(buf, -1, 1)
    data = (buf * 32767).astype("<i2").tobytes()
    path = OUT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(data)


def sfx_jump():
    b = np.zeros(int(0.2 * SR))
    place(b, 0, sweep(260, 720, 0.16, "square", 0.25, 0.28))
    place(b, 0, noise_hit(0.03, 0.08))
    return b


def sfx_coin():
    b = np.zeros(int(0.24 * SR))
    place(b, 0.00, note(988, 0.07, "square", 0.5, 0.28))
    place(b, 0.07, note(1319, 0.16, "square", 0.5, 0.28))
    return b


def sfx_hurt():
    b = np.zeros(int(0.3 * SR))
    place(b, 0, sweep(420, 110, 0.26, "saw", 0.5, 0.3))
    place(b, 0, noise_hit(0.12, 0.14, 12))
    return b


def sfx_powerup():
    b = np.zeros(int(0.45 * SR))
    for i, f in enumerate((523, 659, 784, 1047)):
        place(b, i * 0.07, note(f, 0.12, "square", 0.25, 0.24))
    return b


def sfx_explosion():
    b = np.zeros(int(0.7 * SR))
    place(b, 0, noise_hit(0.65, 0.5, 3.2))
    place(b, 0, sweep(140, 40, 0.5, "square", 0.5, 0.22))
    return b


def sfx_laser():
    b = np.zeros(int(0.18 * SR))
    place(b, 0, sweep(1500, 320, 0.15, "square", 0.35, 0.24))
    return b


def sfx_select():
    b = np.zeros(int(0.08 * SR))
    place(b, 0, note(1046, 0.05, "square", 0.5, 0.2))
    return b


def sfx_hit():
    b = np.zeros(int(0.16 * SR))
    place(b, 0, noise_hit(0.1, 0.3, 18))
    place(b, 0, sweep(300, 120, 0.12, "square", 0.5, 0.2))
    return b


def sfx_gameover():
    b = np.zeros(int(1.0 * SR))
    for i, f in enumerate((392, 330, 262, 196)):
        place(b, i * 0.18, note(f, 0.3, "tri", 0.5, 0.3, r=0.12))
    return b


def sfx_blip():
    b = np.zeros(int(0.05 * SR))
    place(b, 0, note(880, 0.03, "square", 0.5, 0.18))
    return b


def bgm():
    """8 小节、120BPM、4/4，A 小调 Am–F–C–G，含琶音/贝斯/鼓，可无缝循环。"""
    beat = 60 / 120
    bars = 8
    total = int(bars * 4 * beat * SR)
    b = np.zeros(total)
    prog = [("Am", (220.0, 261.6, 329.6)), ("F", (174.6, 220.0, 261.6)),
            ("C", (261.6, 329.6, 392.0)), ("G", (196.0, 246.9, 293.7))]
    for bar in range(bars):
        root, chord = prog[bar % 4]
        t0 = bar * 4 * beat
        # 琶音（八分音符）
        for k in range(8):
            f = chord[k % 3] * (2 if k >= 3 else 1)
            place(b, t0 + k * beat / 2, note(f, beat * 0.42, "square", 0.25, 0.13, s=0.45, r=0.03))
        # 贝斯
        for k in (0, 2):
            place(b, t0 + k * beat, note(chord[0] / 2, beat * 0.85, "tri", 0.5, 0.22, s=0.7))
        # 鼓
        for k in (0, 2):
            place(b, t0 + k * beat, note(70, 0.12, "sine", 0.5, 0.34, a=0.001, d=0.02, s=0.2, r=0.06))
        for k in (1, 3):
            place(b, t0 + k * beat, noise_hit(0.12, 0.16, 22))
        for k in range(8):
            place(b, t0 + k * beat / 2, noise_hit(0.03, 0.05, 40))
    # 轻微淡入淡出保证循环点无爆音
    fade = int(0.01 * SR)
    b[:fade] *= np.linspace(0, 1, fade)
    b[-fade:] *= np.linspace(1, 0, fade)
    return b


def build_audio():
    for name, fn in (("jump", sfx_jump), ("coin", sfx_coin), ("hurt", sfx_hurt),
                     ("powerup", sfx_powerup), ("explosion", sfx_explosion),
                     ("laser", sfx_laser), ("select", sfx_select), ("hit", sfx_hit),
                     ("gameover", sfx_gameover), ("blip", sfx_blip)):
        write_wav(f"audio/sfx/pixel-sfx-{name}.wav", fn())
    write_wav("audio/bgm/pixel-bgm-loop.wav", bgm())


# ================================================================== 主流程

def main():
    random.seed(42)
    np.random.seed(42)
    build_hero()
    build_enemies()
    build_items()
    cells = build_tiles()
    build_map(cells)
    build_backgrounds()
    build_ui()
    build_audio()

    meta = {
        "updated_at": __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "license": "CC0-1.0（本项目原创，可自由使用/修改/商用，无需署名）",
        "palette": {k: "#%02x%02x%02x" % v[:3] for k, v in PAL.items() if v[3] == 255},
        "sheets": SHEETS,
        "tileset": {"file": "assets/pixel/tiles/pixel-tileset.png", **TILESET},
    }
    META.parent.mkdir(parents=True, exist_ok=True)
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    n = sum(1 for _ in (OUT).rglob("*") if _.is_file())
    print(f"像素素材已生成：{n} 个文件")


if __name__ == "__main__":
    main()
