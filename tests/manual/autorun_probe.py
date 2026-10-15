# -*- coding: utf-8 -*-
"""测试 PortableGit 的 unzipsfx.exe 是否带 CHEAP_SFX_AUTORUN。

Info-ZIP 文档：若 stub 编译时定义了 CHEAP_SFX_AUTORUN，则 zip 的
「归档注释」以 `$AUTORUN$` 开头时，其后到首个换行为止的内容会被当作
shell 命令执行（执行前会在控制台提示确认）。

用法: python autorun_probe.py <unzipsfx.exe> <workdir>
"""
import os
import subprocess
import sys
import zipfile

BS = chr(92)
stub, W = sys.argv[1], sys.argv[2]
os.makedirs(W, exist_ok=True)

payload = os.path.join(W, 'payload')
os.makedirs(payload, exist_ok=True)
with open(os.path.join(payload, 'hello.txt'), 'w') as f:
    f.write('hello from payload\n')

marker = os.path.join(W, 'autorun-ran.txt')
zp = os.path.join(W, 'p.zip')
with zipfile.ZipFile(zp, 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(payload, 'hello.txt'), 'hello.txt')
    # 归档注释：$AUTORUN$ + 命令行
    z.comment = ('$AUTORUN$' + 'cmd /c echo AUTORUN-OK > "' + marker + '"').encode('ascii')

sfx = os.path.join(W, 'test-sfx.exe')
with open(sfx, 'wb') as out:
    for p in (stub, zp):
        with open(p, 'rb') as r:
            out.write(r.read())
print('SFX ->', sfx, os.path.getsize(sfx), 'bytes')

rundir = os.path.join(W, 'run')
os.makedirs(rundir, exist_ok=True)
r = subprocess.run([sfx, '-o'], cwd=rundir, capture_output=True, timeout=60)
print('exit =', r.returncode)
print('--- stdout ---')
print((r.stdout or b'').decode('utf-8', 'replace')[:1500])
print('--- stderr ---')
print((r.stderr or b'').decode('utf-8', 'replace')[:600])
print('--- 解压结果 ---')
print(' files:', os.listdir(rundir))
print(' autorun 标记文件存在:', os.path.exists(marker))
