@echo off
rem ============================================================
rem  美代桌宠 · 启动器（Windows）
rem  作用：清掉 ELECTRON_RUN_AS_NODE（不清会让主进程拿不到 app/ipcMain），
rem        并在没有可用 GPU 的环境里走软件渲染。
rem  想让桌面壳用硬件加速：把下面的 MIYO_GPU 改成 on
rem ============================================================
set ELECTRON_RUN_AS_NODE=
set MIYO_GPU=off
set MIYO_NO_SANDBOX=1

cd /d "%~dp0"
"node_modules\electron\dist\electron.exe" . %*
