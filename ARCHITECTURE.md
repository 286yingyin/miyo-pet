# ARCHITECTURE — 代码库导览

> **给 AI 助手**：本文件是代码库的结构化导览，目标是让不熟悉本仓库的人（人或大模型）
> 只读本文件即可准确理解模块划分、数据流与关键约定，避免误改。修改代码前请先通读本文件。

## 项目一句话

Electron 桌宠：读取 WorkBuddy 本地任务数据生成「状态快照」，驱动以《蔚蓝档案》
樱井美代（CH0317）为形象的差分立绘、台本台词、语音与互动；零 npm 运行时依赖，
Windows 优先。

## 目录与模块清单

| 路径 | 职责 | 关键点 |
|---|---|---|
| `electron\main.js`（约 1250 行） | 主进程：窗口/托盘/右键菜单/IPC/config 读写/状态接入/预设 | 单文件分大段：常量与默认配置 → 窗口/托盘 → IPC → config 规范化 → 预设 → 状态接入 |
| `electron\preload.js` | contextBridge 暴露 `window.petHost`（onState/onConfig/saveConfig/presets*/…） | 渲染进程唯一宿主接口 |
| `electron\paths.js` | 路径定位器：源码树 / 打包态（resources\app 与 app-root 两种布局）自动判断 | `page()` 恒返 v2（v1 页面仅浏览器预览壳） |
| `prototype\v2\index.html` | ★ 桌宠页（Electron 实际加载）：差分渲染、台本引擎、互动、整点、提醒、气泡、胶囊、闲置覆盖层 | 零依赖单文件；`window.MiyoPet` 暴露调试 API |
| `prototype\v2\settings.html` | 设置页（双形态）：exe 内 Electron 窗口（完整配置）；构建导出副本在浏览器打开 = 差分专用浏览页（WEB_ONLY） | 同一份 HTML 按 `WEB_MODE`/`WEB_ONLY` 切换 |
| `scripts\state-core.js` | ★ 状态内核（唯一真源）：扫 WorkBuddy 目录（tasks/sessions/audit-log）→ `PetSnapshot`；会话判定、粘性缓存（失败绝不归零）、rev 去重 | 被 main.js require；纯 Node 内置模块 |
| `scripts\approval-status.js` | 待批准配对器：audit-log 的 needs-approval/approved 事件按 toolCallId+requestId 配对 | 被 state-core 引用 |
| `scripts\change-log.js` | 状态变化 JSONL 记录（按天分文件、2MB 轮转、失败降级内存） | 被 main.js 引用 |
| `scripts\credits-query.js` | 「今日积分」sidecar：主进程 spawn 本机 Node22+ 读 workbuddy.db（node:sqlite） | 可选功能，缺失自动隐藏 |
| `scripts\status-provider.js` | 开发态工具：定时原子写 status.json（宿主模式下已停用该通道） | 被 npm script `provider` 引用 |
| `scripts\task-status.js` | **0.2.x 兼容层**：旧签名转发 state-core（被 status-provider 引用，勿删） | 文件头自述 |
| `scripts\check.js` | 静态自检：语法 / DOM 桩可执行 / 台本结构 / 素材完整性 / 跨文件一致性（petW 与 CSS --pet-w 等） | 交付前必跑 |
| `scripts\test-status.js` | 状态链路单测（tmpdir 造假树，29 项） | 交付前必跑 |
| `scripts\build-exe.js` | 绿色版打包：复用本地 Electron 运行时 → `dist\miyo-pet-win32-x64\`（零下载；locales 精简；packs 暂存-放回；导出网页端 settings.html + miyo-web 资源） | Windows（cmd rd / tar） |
| `scripts\build-portable.js` | 便携版打包：electron-builder NSIS portable → `dist-single\` | 依赖 npm.cmd |
| `prototype\v2\preview.html` / `render.html` / `prototype\v1\label-tool.html` | 开发工具页（立绘预览 / Spine 实验 / 表情标注），不参与运行时 | 相对路径依赖 ../assets，勿移目录 |

## 数据流（核心）

```
WorkBuddy 本地目录（%CODEBUDDY_CONFIG_DIR%，只读）
  tasks\<sessionId>\*.json  sessions\<pid>.json  audit-log\*.jsonl
        │
        ▼
scripts\state-core.js ──（approval-status 配对待批准、change-log 记录变化）
        │  每 2s 兜底轮询 + fs.watch；失败沿用 lastGood 绝不归零
        ▼
PetSnapshot { ok, processing, pending, approval, justDone, night, scope, … }
        │  electron\main.js（require state-core → IPC 'miyo-state' 推送）
        ▼
prototype\v2\index.html  window.MiyoPet.setState(snapshot)
        │
        ├─ resolveMode(snapshot) → 8 状态之一（idle/processing/pending/approval/…）
        ├─ 台本引擎：SCRIPTS[mode]（用户台本/台本0）按权重选台本 → 顺序播行
        │    （差分 setBaseSrc + 气泡文本 + 语音 voiceSrc；空台词行 = 只换差分）
        ├─ 闲置覆盖层：完全待机（quiet）时接管差分轮播（idleSprs）
        └─ 互动：react(kind) → 互动台本 → 播完进安静期 → 回落
```

## 状态机与差分体系

- **8 状态**：idle（含夜间变体）、processing、pending、approval、justDone、
  error、idle_5/15/30（空闲档位递进）
- **差分来源三级**：当前学生系列包（`packs\<学生>\{v1,v2}\`，主进程扫描产出
  `packIds` + `packFileUrl` 映射）→ 美代内置（`prototype\v*|miyo-web`）→ 00 号兜底
- **台本**：`cfg.scripts.v2[mode] = [{def,weight,voice,lines:[{text,spr,sec}]}]`；
  `def:1` 为台本0（默认循环台本，未修改不落盘）；配了台本的状态只走台本
- **闲置差分**：`cfg.idleSprs.v2[mode] = [sprId,…]`，完全待机（quiet：闲置族状态 +
  无提醒 + 无 kind 会话 + 没在说话）时接管差分轮播，间隔 `cfg.idleSprMs`

## 设置页双形态（settings.html）

| 形态 | 触发 | 宿主接口 | 功能 |
|---|---|---|---|
| exe 设置窗口 | Electron 打开 | `window.petHost`（preload IPC） | 全部配置 |
| 网页差分浏览器（WEB_ONLY） | 浏览器打开导出副本 | `petHost` localStorage 兼容层 + File System Access | 仅差分图库浏览（连接 packs 枚举、预览缩放/聚焦） |

构建时（build-exe / build-portable）导出 `settings.html` 到 exe 旁并注入
`__WEB_VERSION__`（版本号）与 `__WEB_ONLY__`（true）。

## 关键约定（改代码前必读）

1. **petW 与 CSS `--pet-w` 一致性**：窗口宽度由 `WIN_BY_MODE[ver].petW` 驱动，
   check.js 有跨文件断言——改窗口尺寸必须两处同步。
2. **`READ-ME-FIRST.txt` 文件名须纯 ASCII**：构建产物内的指令文件是 ANSI 文本。
3. **extraResources 不拍平**：electron-builder 的 from/to 保持层级，filter 排除
   `packs/**`（其他学生素材不入分发产物）与 `preview.html`。
4. **首行注释版本号 = 变更日志**：各文件顶部/注释里的 `0.3.x` 是历史日志标记，
   **不要全局替换**；唯一要改的是 `electron\package.json` 的 `version` 字段。
5. **input.list 是只读 IDL 属性**：严格模式下 `el.list = 'x'` 抛 TypeError
   （曾致设置页三模块全灭），关联 datalist 必须用 `setAttribute('list', 'x')`。
6. **透明窗口禁 setOpacity**：Windows 上对 `transparent:true` 窗口调 setOpacity
   会切 layered 模式，软件渲染下整窗永久停止绘制。
7. **异步收集函数必须 await 全部链**：曾因同步返回空结果导致「枚举 0 个系列」。
8. **网页端 UI 的失效类 bug 必须真机（真实 Chromium）诊断**：DOM 桩抓不到
   只读 IDL / 未定义函数等真实差异；标准工具 = `tests\manual\webtest3.js`
   （playwright-core + Chrome headless + http.server + OPFS mock）。
9. **`READ-ME-FIRST.txt` 与分发的 exe 保持同版本**：旧产物内嵌旧文本，重建覆盖。
10. **状态读取失败绝不归零**：state-core 失败时沿用 lastGood 快照（粘性缓存）。

## 构建与发布

- 绿色版：`node scripts\build-exe.js` —— 零下载（复用 electron\node_modules 的
  Electron 运行时）、locales 精简 55→4、`packs\` 暂存-放回（保护手动维护的差分）、
  导出 `settings.html` + `miyo-web\`（美代差分网页端副本）+ `packs\miyo\`（内置包）
- 便携版：`cd electron && npm run build:portable` —— electron-builder 单文件
- 产物内 `READ-ME-FIRST.txt`：版权声明与快速上手（文本由 build-exe.js 注入）

## 版本与文档

- 后续需求与迭代入口：[docs/README.md](docs/README.md)。需求、方案、开发计划、验证记录按版本维护，规划不代表当前行为。
- AI 维护文档须遵守 [docs/AGENTS.md](docs/AGENTS.md)；Superpowers 的 spec / plan 直接使用正式版本文档，不另建副本。
- 版本号：`electron\package.json` 的 `version`（当前 0.3.23）
- 迭代日志：`docs\archive\10-v2改造说明.md`（0.2.0 → 0.3.23，43+ 个版本节点）
- 状态机制权威描述：`docs\archive\08-状态捕捉与单文件打包.md`
