# -*- coding: utf-8 -*-
"""极简像素画工具箱。

设计原则（这一版的所有素材都按这套规则画）：
1. 统一光源在**左上**：左上受光、右下背光，靠 `bevel()` 自动补一层明暗边；
2. 每个材质至少 **3 个色阶**（亮 / 中 / 暗），不再用单色平涂；
3. 外轮廓统一用深蓝紫（而不是纯黑），并做 1px 描边，保证任何背景上都读得清；
4. 剪影优先：把图缩到 1× 还能认出是什么，才算过关；
5. 渐变用 4×4 有序抖动（Bayer），避免色带。
"""
from PIL import Image

# ---------------------------------------------------------------- 颜色

def hexc(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def C(s, a=255):
    r, g, b = hexc(s)
    return (r, g, b, a)


def shade(c, f):
    """f<1 变暗，f>1 变亮。"""
    r, g, b, a = c
    if f >= 1:
        return (min(255, int(r * f)), min(255, int(g * f)), min(255, int(b * f)), a)
    return (max(0, int(r * f)), max(0, int(g * f)), max(0, int(b * f)), a)


def mix(a, b, t):
    return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(4))


# ---------------------------------------------------------------- 画布

class Sprite:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.px = self.img.load()

    def put(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = c

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[x, y]
        return (0, 0, 0, 0)

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.put(x, y, c)

    def hline(self, x0, x1, y, c):
        self.rect(x0, y, x1, y, c)

    def vline(self, x, y0, y1, c):
        self.rect(x, y0, x, y1, c)

    def ellipse(self, cx, cy, rx, ry, c):
        for y in range(self.h):
            for x in range(self.w):
                dx = (x + 0.5 - cx) / max(rx, 0.01)
                dy = (y + 0.5 - cy) / max(ry, 0.01)
                if dx * dx + dy * dy <= 1.0:
                    self.put(x, y, c)

    def half(self, cx, cy, rx, ry, c, side="left"):
        """半个椭圆，用来做球体的受光面 / 背光面。"""
        for y in range(self.h):
            for x in range(self.w):
                dx = (x + 0.5 - cx) / max(rx, 0.01)
                dy = (y + 0.5 - cy) / max(ry, 0.01)
                if dx * dx + dy * dy > 1.0:
                    continue
                if side == "left" and x + 0.5 > cx:
                    continue
                if side == "right" and x + 0.5 < cx:
                    continue
                if side == "top" and y + 0.5 > cy:
                    continue
                if side == "bottom" and y + 0.5 < cy:
                    continue
                self.put(x, y, c)

    def blit(self, other, ox=0, oy=0):
        self.img.alpha_composite(other.img, (ox, oy))
        self.px = self.img.load()

    def copy(self):
        s = Sprite(self.w, self.h)
        s.img = self.img.copy()
        s.px = s.img.load()
        return s

    def flip(self):
        s = Sprite(self.w, self.h)
        s.img = self.img.transpose(Image.FLIP_LEFT_RIGHT)
        s.px = s.img.load()
        return s


# ---------------------------------------------------------------- 后期

def bevel(img, dark=0.72, light=1.22):
    """给不透明区域加“右下暗、左上亮”的自动明暗边，形成体积感。"""
    w, h = img.size
    base = img.copy()
    src = base.load()
    out = img.copy()
    q = out.load()

    def op(x, y):
        if 0 <= x < w and 0 <= y < h:
            return src[x, y][3] > 0
        return False

    for y in range(h):
        for x in range(w):
            c = src[x, y]
            if c[3] == 0:
                continue
            below, right = op(x, y + 1), op(x + 1, y)
            above, left = op(x, y - 1), op(x - 1, y)
            if not below or not right:
                q[x, y] = shade(c, dark)
            elif not above or not left:
                q[x, y] = shade(c, light)
    return out


def outline(img, color=(18, 16, 30, 255), diag=False):
    """在透明区域沿不透明像素补 1px 描边（画布四周各扩 1px）。"""
    w, h = img.size
    out = Image.new("RGBA", (w + 2, h + 2), (0, 0, 0, 0))
    out.alpha_composite(img, (1, 1))
    src = out.copy()
    sp = src.load()
    q = out.load()
    dirs = [(1, 0), (-1, 0), (0, 1), (0, -1)]
    if diag:
        dirs += [(1, 1), (1, -1), (-1, 1), (-1, -1)]
    for y in range(h + 2):
        for x in range(w + 2):
            if sp[x, y][3] > 0:
                continue
            for dx, dy in dirs:
                nx, ny = x + dx, y + dy
                if 0 <= nx < w + 2 and 0 <= ny < h + 2 and sp[nx, ny][3] > 0:
                    q[x, y] = color
                    break
    return out


def finish(sp, dark=0.72, light=1.22, edge=(18, 16, 30, 255)):
    """常用流水线：自动明暗 → 描边。"""
    return outline(bevel(sp.img, dark, light), edge)


# ---------------------------------------------------------------- 抖动

BAYER4 = [[0, 8, 2, 10],
          [12, 4, 14, 6],
          [3, 11, 1, 9],
          [15, 7, 13, 5]]


def dither_gradient(sp, x0, y0, x1, y1, c0, c1, levels=6, vertical=True):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            t = (y - y0) / max(1, y1 - y0) if vertical else (x - x0) / max(1, x1 - x0)
            v = t * (levels - 1)
            lo = int(v)
            frac = v - lo
            th = (BAYER4[y % 4][x % 4] + 0.5) / 16.0
            k = lo + (1 if frac > th else 0)
            k = max(0, min(levels - 1, k))
            sp.put(x, y, mix(c0, c1, k / (levels - 1)))


def dither_fill(sp, x0, y0, x1, y1, c, dens=0.5, other=None):
    """用 50% 棋盘抖动铺一层半透明感。"""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (x + y) % 2 == 0:
                sp.put(x, y, c)
            elif other is not None:
                sp.put(x, y, other)


# ---------------------------------------------------------------- 序列图

def strip(frames, gap=0):
    if not frames:
        raise ValueError("empty frames")
    w, h = frames[0].size
    out = Image.new("RGBA", (len(frames) * w + gap * (len(frames) - 1), h), (0, 0, 0, 0))
    x = 0
    for f in frames:
        out.alpha_composite(f, (x, 0))
        x += w + gap
    return out


def pad_to(img, w, h, ox=0, oy=0):
    """把一张图放进指定大小的透明画布（用于统一帧尺寸）。"""
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(img, (ox, oy))
    return out
