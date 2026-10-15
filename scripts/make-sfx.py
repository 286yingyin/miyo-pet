#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make-sfx.py —— 用 Info-ZIP 的 unzipsfx.exe 做「单文件自解压 exe」。

原理：unzipsfx.exe（PortableGit 自带，77KB）是 Info-ZIP 的自解压壳。
      把 zip 直接 cat 到它后面，unzipsfx 会在运行时自己算出「前缀长度」
      （extra_bytes），从而正确定位 archive —— 所以不需要 zip -A。

用法：
    python make-sfx.py --stub <unzipsfx.exe> --src <待打包目录> --out <输出.exe> [--probe]

    --probe   只做「拼接 + 自检」，额外把结果解压到临时目录核对（用于验证）

设计取舍：
- 用 Python 的 zipfile（stdlib）写 zip，压缩用 DEFLATE。
- 路径统一正斜杠、相对 src。
- 输出用「先写临时文件再改名」的方式，避免半截产物。
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

CHUNK = 1024 * 1024 * 4


def build_zip_from_dir(src, zip_path):
    """把 src 目录整体打成 zip，条目名相对 src。"""
    n = 0
    total = 0
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for root, dirs, files in os.walk(src):
            dirs.sort()
            for f in sorted(files):
                full = os.path.join(root, f)
                rel = os.path.relpath(full, src).replace(os.sep, '/')
                try:
                    z.write(full, rel)
                    n += 1
                    total += os.path.getsize(full)
                except OSError as e:
                    print('  跳过 %s: %s' % (rel, e))
    return n, total


def concat(stub, zip_path, out_path):
    """把 stub 和 zip 顺序拼成 out_path。"""
    tmp = out_path + '.part'
    written = 0
    with open(tmp, 'wb') as w:
        for p in (stub, zip_path):
            with open(p, 'rb') as r:
                while True:
                    b = r.read(CHUNK)
                    if not b:
                        break
                    w.write(b)
                    written += len(b)
    os.replace(tmp, out_path)
    return written


def human(n):
    for u in ('B', 'KB', 'MB', 'GB'):
        if n < 1024 or u == 'GB':
            return '%.1f %s' % (n, u)
        n /= 1024.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stub', required=True)
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--probe', action='store_true')
    a = ap.parse_args()

    if not os.path.isfile(a.stub):
        print('X 找不到 stub：' + a.stub)
        return 2
    if not os.path.isdir(a.src):
        print('X 找不到源目录：' + a.src)
        return 2

    work = tempfile.mkdtemp(prefix='miyo-sfx-')
    zip_path = os.path.join(work, 'payload.zip')
    try:
        print('--- 1. 打包 payload ---')
        n, raw = build_zip_from_dir(a.src, zip_path)
        zs = os.path.getsize(zip_path)
        print('  文件 %d 个，原始 %s → zip %s' % (n, human(raw), human(zs)))

        print('--- 2. 拼接 stub + zip ---')
        out = os.path.abspath(a.out)
        os.makedirs(os.path.dirname(out), exist_ok=True)
        total = concat(a.stub, zip_path, out)
        print('  stub %s + zip %s = %s' % (human(os.path.getsize(a.stub)), human(zs), human(total)))
        print('  产物：' + out)

        print('--- 3. 自检（EOCD 是否可被识别）---')
        with open(out, 'rb') as f:
            f.seek(max(0, total - 66000))
            tail = f.read()
        idx = tail.rfind(b'PK\x05\x06')
        print('  EOCD 签名位置（自尾部回退）：%s' % ('找到 @ -%d' % (len(tail) - idx) if idx >= 0 else '未找到'))

        if a.probe:
            print('--- 4. 试解压到临时目录核对 ---')
            dst = tempfile.mkdtemp(prefix='miyo-sfx-out-')
            r = subprocess.run([out, '-o', '-d', dst], capture_output=True)
            print('  退出码 %d' % r.returncode)
            for line in (r.stdout or b'').decode('utf-8', 'replace').splitlines()[:8]:
                print('    ' + line)
            for line in (r.stderr or b'').decode('utf-8', 'replace').splitlines()[:8]:
                print('    [err] ' + line)
            got = []
            for root, dirs, files in os.walk(dst):
                for f in files:
                    got.append(os.path.relpath(os.path.join(root, f), dst))
            print('  解出 %d 个文件，示例：%s' % (len(got), got[:5]))
            shutil.rmtree(dst, ignore_errors=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
