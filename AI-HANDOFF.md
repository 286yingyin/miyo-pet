# AI-HANDOFF — 给 AI 助手的对接说明

> 本文档写给**将要读取本项目归档（miyo-pet-archive-*.zip）或仓库**的 AI 助手。
> 目标：让你在不询问原作者的情况下，正确理解、安全修改、可靠验证本项目。
> 阅读顺序：本文 → `README.md` → `ARCHITECTURE.md` → 按任务读代码。

## 1. 项目身份卡

- **名称**：miyo-pet（美代桌宠）——基于 Electron 的桌面桌宠
- **形象**：《蔚蓝档案》樱井美代（CH0317）；代码中亦支持其他学生差分包
- **版本**：0.3.23（见 `electron\package.json` 的 `version`；各文件注释里的 0.3.x 是历史日志标记，**不是**待更新的版本号）
- **平台**：Windows 10/11 x64 优先；应用运行时零 npm 依赖；开发/构建需 Node 18+
- **运行方式**：便携 exe 双击即用；开发态 `cd electron && npm install && run.cmd`
- **代码协议**：MIT；**素材另算**（见第 5 节版权红线）

## 2. 归档包结构与读取顺序

```
miyo-pet-archive-*.zip（约 265MB）
├── README.md                 ← 归档说明 + 素材→目录恢复映射
├── 01-需求与上下文\
│   ├── ARCHITECTURE.md       ← ★ 模块清单 / 数据流 / 10 条关键约定（必读）
│   ├── LICENSE / NOTICE.md   ← 三层版权声明（必读第 5 节）
│   └── docs-archive\         ← 历史文档 10 份；其中
│       └── 10-v2改造说明.md   ← ★ 0.2.0→0.3.23 全部迭代日志（43+ 节，含每个坑）
├── 02-代码\
│   ├── electron\             ← 主进程（main.js 1250 行 / preload.js / paths.js）
│   ├── scripts\              ← state-core 状态内核 / check 自检 / test-status 单测 / build-*
│   ├── prototype\            ← 桌宠页 index.html、设置页 settings.html、工具页
│   └── tests\manual\         ← 真机浏览器测试脚本（playwright-core）
├── 03-程序\
│   ├── miyo-pet-portable.exe ← 便携版（双击即用）
│   └── settings.html         ← 网页差分浏览器（浏览器直接开）
└── 04-素材\                  ← 美代差分/语音/图标（恢复映射见包内 README）
```

**推荐读取顺序**：
1. `ARCHITECTURE.md`（10 分钟能建立全貌，含数据流图）
2. 本文档第 4 节「术语词典」与第 5 节「红线」
3. 按任务读对应模块（改台本→settings.html；改状态→state-core.js；改窗口→main.js）
4. 历史疑点先查 `docs-archive\10-v2改造说明.md` 对应章节，**很多"为什么这么写"在那里有答案**

## 3. 解压与恢复运行

- 便携程序：解压后双击 `03-程序\miyo-pet-portable.exe`，无需安装；
- 恢复开发环境：把 `02-代码\` 作为工作区；`04-素材\` 按包内 README 的映射表放回
  `prototype\v*|electron\` 对应目录；`cd electron && npm install`；
- 自检基线：`node scripts\check.js` 全绿 + `node scripts\test-status.js` 29 项全绿——
  **任何改动之后这两个必须仍然全绿**；
- 真机回归：`tests\manual\webtest3.js`（playwright-core + Chrome headless），
  覆盖网页差分浏览器全链路。

## 4. 术语词典（LLM 最容易误读的部分）

| 术语 | 含义 |
|---|---|
| 状态（mode） | 8 种：idle / processing / pending / approval / justDone / error / idle_5 / idle_15 / idle_30 |
| 台本（script） | 某状态的一组「差分+台词+语音+秒数」行；`cfg.scripts.v2[mode] = [{def,weight,voice,lines}]` |
| 台本0 | `def:1` 的默认待机台本；未修改不落盘（虚拟存在 `_virt`）；配了台本的状态只走台本 |
| 空台词行 | `text:''` 的行 = 只换差分不出台词，气泡静默（0.3.19 起不再回落内置台词） |
| quiet | 完全待机判定：闲置族状态 + 无提醒 + 无 kind 会话 + 没在说话；驱动闲置覆盖层/眨眼/摇晃/呼吸 |
| 闲置覆盖层 | quiet 时接管差分轮播（`cfg.idleSprs`），挂起台本引擎；醒来由各触发源自行重启 |
| packs | 多学生差分包：exe 旁 `packs\<学生>\{v1,v2}\` + manifest.json；`packs\miyo\` 为构建内置 |
| 三级回退 | 差分缺号：系列包 → 美代同号 → 00 号（error 链，运行时自动） |
| 胶囊（pill） | 状态指标浮条（处理中/待办/待批准数），文案含 {n} 变量 |
| voiceMap | 语音文件名 → 完整 URL 的映射（免后缀，仅 ogg），主进程启动时扫描生成 |
| WEB_ONLY / WEB_MODE | settings.html 双形态开关：导出副本注入 WEB_ONLY=true = 纯差分浏览页 |
| PetSnapshot | state-core.js 产出的状态快照对象（ok/processing/pending/approval/justDone/…） |
| petHost | preload 暴露给渲染进程的宿主 API（onState/onConfig/presets* 等） |
| SMOKE | domstub.js 里的场景回归分支（SMOKE2=1 台本秒数、SMOKE13=1 闲置覆盖层） |

## 5. 红线（违反会出真实故障，均已踩过坑）

1. **版权**：立绘/语音素材 © NEXON Games 及官方所有，仅供个人使用，**请勿用于商业目的**；
   不得将其他学生素材加入分发产物（构建脚本已排除 `packs/**`，勿移除该过滤）；
   **不得修改/删除 NOTICE.md 与各页面的版权声明**。
2. **`input.list` 是只读 IDL 属性**：严格模式下 `el.list = 'x'` 抛 TypeError（曾致设置页
   三模块全灭）。关联 datalist 必须写 `el.setAttribute('list', 'x')`。
3. **透明窗口禁 `setOpacity`**：Windows 上会切 layered 模式，软件渲染下整窗永久停止绘制。
4. **异步收集必须 await 全部链**：`return Promise.resolve(out)` 式同步返回空结果
   曾导致「枚举 0 个系列」。
5. **网页端 UI 的「失效类」bug 必须真机（真实 Chromium）诊断**——DOM 桩抓不到
   只读 IDL / 未定义函数等差异；标准工具 = `tests\manual\webtest3.js`。
6. **改窗口尺寸**：`WIN_BY_MODE[ver].petW` 与 CSS `--pet-w` 必须同步（check.js 有断言）。
7. **版本号**：只改 `electron\package.json` 的 `version`；源码注释里的 0.3.x 是历史日志，
   **禁止全局替换**。
8. **`READ-ME-FIRST.txt` 文件名须纯 ASCII**（构建产物内的 ANSI 指令文件）。
9. **状态读取失败绝不归零**：state-core 失败沿用 lastGood 快照——不要加"失败时清零"的
   "修复"。
10. **extraResources 不拍平**：electron-builder 的 from/to 层级不能压平，`packs/**` 与
    `preview.html` 的 filter 排除必须保留。

## 6. 常见任务操作指引

| 任务 | 步骤 |
|---|---|
| 跑起来看效果 | `03-程序\miyo-pet-portable.exe` 双击；或开发态 `cd electron && npm install && run.cmd` |
| 改某状态的台词/差分 | exe 设置窗口 →「表情·台词·语音」；数据在 `cfg.scripts.v2[mode]` |
| 添加其他学生差分 | exe 旁建 `packs\v1|v2\<学生>\` 放编号命名 png + 可选 manifest.json（`{"label":"名"}`） |
| 改默认待机表现 | 改台本0（settings 页「台本0」）或 `cfg.idleSprs`（闲置差分） |
| 构建绿色版 | `node scripts\build-exe.js` → `dist\miyo-pet-win32-x64\` |
| 构建便携版 | `cd electron && npm run build:portable` → `dist-single\miyo-pet-portable.exe` |
| 发布前回归 | `node scripts\check.js` → `node scripts\test-status.js` → SMOKE2/13 → `tests\manual\webtest3.js` |
| 诊断设置页异常 | 打开浏览器 DevTools 看控制台；或页面底部红色状态栏（全局错误浮窗） |

## 7. 已知限制

- Windows 专用（构建脚本用 cmd / npm.cmd）；macOS/Linux 未验证；
- WorkBuddy 集成为**软依赖**：无数据时 idle 降级，属正常而非故障；
- 「今日积分」胶囊需要本机 Node.js 22+（sqlite sidecar），缺失时自动隐藏；
- SMOKE 回归在 0.3.23 清理中精简为 SMOKE2/13 两个分支，其余场景用真机脚本替代；
- 网页端（浏览器）功能仅限差分浏览与（localStorage）配置试验，正式配置以
  exe 设置窗口为准。
