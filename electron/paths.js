/**
 * 美代桌宠 · 路径解析（三种布局通用）
 * ---------------------------------------------------------------------------
 * 应用资源根 appRoot() 的判定顺序：
 *   1) <resources>/app-root        ← electron-builder 打包时用 extraResources 放这里
 *   2) __dirname/..                ← 开发态、以及「资源放在 resources/app/ 下」的绿色目录版
 *
 * 于是同一份 main.js 同时适配：
 *   · 开发态         electron/main.js        → appRoot = 项目根
 *   · 绿色目录版     resources/app/electron/ → appRoot = resources/app
 *   · 单文件/asar    resources/app-root/     → appRoot = resources/app-root
 *
 * 只有 Electron 里才有 process.resourcesPath；纯 Node（测试）下自动走第 2 条。
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');

function appRoot() {
  if (process.resourcesPath) {
    const cand = path.join(process.resourcesPath, 'app-root');
    try { if (fs.existsSync(cand)) return cand; } catch (e) { /* next */ }
  }
  return path.resolve(__dirname, '..');
}

const api = {
  appRoot: appRoot,
  scriptsDir: function () { return path.join(appRoot(), 'scripts'); },
  stateCore: function () { return path.join(api.scriptsDir(), 'state-core.js'); },
  taskStatus: function () { return path.join(api.scriptsDir(), 'task-status.js'); },
  changeLog: function () { return path.join(api.scriptsDir(), 'change-log.js'); },
  prototypeDir: function () { return path.join(appRoot(), 'prototype'); },
  /* 单页双模式（0.2.1）：v1/v2 都加载这一页，版本由页面按 cfg.mode 热切换。
     mode 形参保留以兼容调用方；v1/index.html 保留为浏览器预览壳，Electron 不再加载。 */
  page: function (mode) { return path.join(api.prototypeDir(), 'v2', 'index.html'); },
  settingsPage: function () { return path.join(api.prototypeDir(), 'v2', 'settings.html'); },
  icon: function () { return path.join(__dirname, 'icon.png'); }
};

module.exports = api;
