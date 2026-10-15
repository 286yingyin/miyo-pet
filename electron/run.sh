#!/bin/bash
# ============================================================
#  美代桌宠 · 启动器（Git Bash / MSYS）
#  清掉 ELECTRON_RUN_AS_NODE，并在没有可用 GPU 的环境里走软件渲染。
#  想用硬件加速：把 MIYO_GPU 改成 on
# ============================================================
unset ELECTRON_RUN_AS_NODE
export MIYO_GPU=off
export MIYO_NO_SANDBOX=1

cd "$(dirname "$0")" || exit 1
exec ./node_modules/electron/dist/electron.exe . "$@"
