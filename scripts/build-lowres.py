#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
build-lowres.py —— 生成 v2 立绘的低分辨率副本（0.3.1 省内存）
用法： python scripts/build-lowres.py
产物： prototype/v2/assets/full_low/*.png（宽 400px 等比、保留透明通道）

背景：原图 905×2477，解码后 ≈8.5MB/张 ×41 = 351MB，而显示宽度只有 196px
（约 4.6 倍超采样）→ Chromium 解码缓存是内存占用过高的主因。
400px 副本（≈2× 显示尺寸，HiDPI 留量）解码总量 351MB → 69MB（-80%）。
运行时开关：cfg.lowMem（设置页「省内存立绘」），桌宠页按开关选 full_low / full。
换素材后重跑本脚本即可。
"""
import glob
import os
import sys

try:
    from PIL import Image
except ImportError:
    print('需要 Pillow： pip install Pillow')
    sys.exit(1)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'prototype', 'v2', 'assets', 'full')
DST = os.path.join(ROOT, 'prototype', 'v2', 'assets', 'full_low')
TARGET_W = 400


def main():
    os.makedirs(DST, exist_ok=True)
    n = 0
    tot_old = tot_new = 0.0
    for f in sorted(glob.glob(os.path.join(SRC, '*.png'))):
        im = Image.open(f).convert('RGBA')
        w, h = im.size
        nw = min(TARGET_W, w)
        nh = round(h * nw / w)
        low = im.resize((nw, nh), Image.LANCZOS)
        low.save(os.path.join(DST, os.path.basename(f)), optimize=True)
        n += 1
        tot_old += w * h * 4 / 1048576.0
        tot_new += nw * nh * 4 / 1048576.0
    print('generated %d sprites -> %s' % (n, DST))
    print('decoded: %.0fMB -> %.0fMB (-%.0f%%)' % (tot_old, tot_new, 100 - tot_new / tot_old * 100))


if __name__ == '__main__':
    main()
