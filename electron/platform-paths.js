'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');

// No Electron or filesystem access: callers supply resource and writable roots.
function resolvePaths({ platform, userDataDir, appRoot, portableDir, exeDir, isPackaged = false }) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const packRoots = [];
  let presetDir;
  if (platform === 'win32') {
    if (portableDir) packRoots.push(join(portableDir, 'packs'));
    if (isPackaged && exeDir) packRoots.push(join(exeDir, 'packs'));
    presetDir = packRoots.length ? join(packRoots[0], 'settings') : join(appRoot, 'presets');
  } else {
    packRoots.push(join(userDataDir, 'packs'));
    presetDir = join(userDataDir, 'settings');
  }
  return {
    resourceRoot: appRoot,
    configDir: userDataDir,
    packRoots: [...new Set(packRoots)],
    presetDir,
    eventDir: join(userDataDir, 'agent-events')
  };
}

function fileUrlOf(file) { return pathToFileURL(file).href; }
function fileUrlOfDir(dir) {
  return pathToFileURL(path.resolve(dir) + path.sep).href;
}

module.exports = { resolvePaths, fileUrlOf, fileUrlOfDir };
