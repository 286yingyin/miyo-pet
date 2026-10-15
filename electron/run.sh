#!/bin/sh
# Native macOS / Linux and Windows Git Bash launcher. Keep user GPU preference.
unset ELECTRON_RUN_AS_NODE
: "${MIYO_GPU:=off}"
export MIYO_GPU
cd "$(dirname "$0")" || exit 1
case "$(uname -s)" in
  Darwin*) executable='./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron' ;;
  MINGW*|MSYS*|CYGWIN*)
    executable='./node_modules/electron/dist/electron.exe'
    : "${MIYO_NO_SANDBOX:=1}"
    export MIYO_NO_SANDBOX
    ;;
  *) executable='./node_modules/electron/dist/electron' ;;
esac
exec "$executable" . "$@"
