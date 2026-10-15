/**
 * 美代桌宠 · Electron 预加载脚本
 * ---------------------------------------------------------------------------
 * 只暴露一个最小桥： window.petHost
 *
 *   — 状态 —
 *   onState(cb)           接收 AgentSnapshot + toPetState 兼容字段（nullable counts 保留）
 *   getState()            读取缓存快照（Promise，不扫描来源）
 *   refreshState()        刷新已启用来源后读快照（Promise）
 *   onConfig(cb)          接收配置（映射 / 大小 / 置顶 / 版本 / 统计范围）
 *   getConfig()           读当前配置（Promise）
 *   saveConfig(request)   按 characterId/baseRevision/patch 保存（Promise）
 *   resetConfig(request)  按 characterId/baseRevision 恢复当前角色默认（Promise）
 *
 *   — 界面 —
 *   move(dx, dy)          拖动桌宠时移动窗口（增量，主进程按屏幕坐标累计）
 *   menu()                在鼠标位置弹出原生右键菜单
 *   openSettings()        打开设置窗口
 *   setMode('v1'|'v2')    切换半身 / 全身版
 *   setAlwaysOnTop(bool)
 *   setScope('current'|'all')   统计范围
 *
 *   — 变化记录 —
 *   getHistory(n)         读最近 n 条变化（Promise，新→旧）
 *   historyStats()        历史文件统计（Promise）
 *   openHistory()         在资源管理器里打开历史目录
 *
 *   — 整点播报 / 语音 —
 *   onChime(cb)           接收整点播报 { hour, lines[], sprs[], voice, ms }
 *   playChime(payload)    试播一次（设置页用）
 *   speak(payload)        语音通道（预留：主进程当前只记日志，不播放）
 *   fileUrlOf(path)       绝对路径转标准 file URL（纯转换，不读写文件）
 *
 * 页面在存在 window.petHost 时会自动切到「只显示桌宠」的宿主模式。
 * ---------------------------------------------------------------------------
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function on(channel, cb) {
  if (typeof cb !== 'function') return;
  ipcRenderer.on(channel, (_e, payload) => cb(payload));
}

contextBridge.exposeInMainWorld('petHost', {
  platform: process.platform,

  /* 状态 */
  onState(cb) { on('miyo-state', cb); },
  getState() { return ipcRenderer.invoke('state-get'); },
  refreshState() { return ipcRenderer.invoke('state-refresh'); },
  onConfig(cb) { on('miyo-config', cb); },
  getConfig() { return ipcRenderer.invoke('config-get'); },
  saveConfig(cfg) { return ipcRenderer.invoke('config-save', cfg); },
  resetConfig(request) { return ipcRenderer.invoke('config-reset', request); },
  switchCharacter(request) { return ipcRenderer.invoke('character-switch', request); },
  /* 应用版本（0.2.10）：设置页核对「跑的是哪个包」用 */
  getAppVersion() { return ipcRenderer.invoke('app-version'); },

  /* 界面 */
  move(dx, dy) { ipcRenderer.send('pet-move', { dx: dx, dy: dy }); },
  menu() { ipcRenderer.send('pet-menu'); },
  openSettings() { ipcRenderer.send('open-settings'); },
  setMode(mode) { ipcRenderer.send('mode-set', mode); },
  setAlwaysOnTop(flag) { ipcRenderer.send('top-set', !!flag); },
  setScope(scope) { ipcRenderer.send('scope-set', scope); },

  /* 变化记录 */
  getHistory(n) { return ipcRenderer.invoke('history-tail', n || 100); },
  historyStats() { return ipcRenderer.invoke('history-stats'); },
  openHistory() { ipcRenderer.send('history-open'); },

  /* 整点播报：主进程到点推 { hour, lines[], sprs[], voice, ms } */
  onChime(cb) { on('miyo-chime', cb); },
  /* 设置页「试播一次」（把一条播报直接推给桌宠） */
  playChime(payload) { ipcRenderer.send('chime-test', payload || {}); },

  /* 今日消耗积分（0.2.14）：主进程每 60s 推 { ok, today, total, day } 或 { ok:false, note } */
  onCredits(cb) { on('miyo-credits', cb); },

  /* 差分系列包清单（0.3.2）：{ v1: [{dir,label}], v2: [...] }（含内置「美代」） */
  packsList() { return ipcRenderer.invoke('packs-list'); },

  /* 表情·台词·语音：测试预览与内置台词对照 */
  onTest(cb) { on('miyo-test', cb); },
  testExpr(payload) { ipcRenderer.send('expr-test', payload || {}); },
  reportBuiltins(obj) { ipcRenderer.send('builtins-report', obj || {}); },
  getBuiltins() { return ipcRenderer.invoke('builtins-get'); },

  /* 设置预设：userData/presets/<名字>.json，整套 cfg */
  presetsList() { return ipcRenderer.invoke('presets-list'); },
  presetsSave(p) { return ipcRenderer.invoke('presets-save', p || {}); },
  presetsApply(request) { return ipcRenderer.invoke('presets-apply', request); },
  presetsLoad(name) { return ipcRenderer.invoke('presets-load', name); },
  presetsDelete(name) { return ipcRenderer.invoke('presets-delete', name); },
  presetsOpen() { ipcRenderer.send('presets-open'); },

  /* Pure path -> URL conversion; no file reads or directory access. */
  fileUrlOf(file) { return ipcRenderer.sendSync('file-url', file); },
  /* 语音通道（预留）：现在主进程只记日志，不做播放 */
  speak(payload) { ipcRenderer.send('pet-speak', payload || {}); }
});
