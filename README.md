# miyo-pet · 樱井美代桌宠

> **v0.4.0 开发交接（WIP，2026-10-15）**：本分支已实现 Codex 桌面端可靠状态接入、角色独立配置和跨平台路径调整；平台构建收尾及联合验收尚未完成。最新完整测试 84/85，网页大图预览有已知缺陷，portable 重启与 Mac 实机待验证。接手先读 [开发计划与剩余工作](docs/iterations/v0.4.0/plan.md#接手顺序与剩余工作)和[验证记录](docs/iterations/v0.4.0/verification.md)。下方原有功能说明与架构文档的全面同步留待 T7；当前应用版本仍为 0.3.23。

基于 Electron 的桌面桌宠程序：以《蔚蓝档案》角色**樱井美代**（CH0317）为形象，
实时反映 [WorkBuddy](https://www.workbuddy.cn) 的任务状态（处理中 / 待办 / 待批准 /
完成 / 出错 / 空闲递进），配合台本台词、互动反应、整点播报与待办提醒。
没有 WorkBuddy 时也可以作为纯桌面摆宠使用（自动降级到待机态）。

> **版权分层**：程序代码以 [MIT](LICENSE) 授权；立绘 / 语音等游戏素材
> © NEXON Games 及官方所有，仅供个人使用、请勿用于商业目的——详见 [NOTICE.md](NOTICE.md)。

## 功能列表

### 状态与显示
- **8 状态实时映射**：处理中 / 待办 / 待批准 / 全部完成 / 出错 / 待机 / 空闲 5–15 分 / 15–30 分 / 30 分以上，
  由 WorkBuddy 本地数据驱动（fs.watch + 2 秒兜底轮询，纯只读）
- **台本系统**：每个状态可配置「差分 + 台词 + 语音 + 每行秒数」的台本，按权重随机选台本、顺序播行；
  台本0（默认待机台本）无缝循环；v1/v2 统一沿用 v2 配置
- **互动反应**：单击 8 档递进、双击、长按、拖动、松手、悬停，各自独立台本；播放完自动回落待机
- **整点播报**：24 小时逐时配置，台本化
- **待办提醒**：到点弹出提醒台本，单击确认
- **闲置差分**：完全待机时切换到专属差分轮播（与台本引擎互斥），空闲档位自动继承
- **显示胶囊**：处理中 / 待办 / 待批准 / 对话数指标胶囊，位置 / 大小 / 显隐可调
- **气泡自定义**：底色 / 透明度 / 边框 / 字体 / 缩放
- **大小缩放**：0.5–5×；缩放保留右下角锚点，屏幕变化后恢复可见位置

### 多学生差分包（packs）
- exe 旁 `packs\<学生>\{v1,v2}\` 放差分图 + `manifest.json` 即自动识别（支持中文目录名、
  原始 `XX_spr_NN.png` 命名、根级包、zip 自动解压）
- 缺号三级回退：系列包缺号 → 美代同号 → 00 号
- 构建时自动内置美代差分包（`packs\miyo\`）

### 设置页双形态（同一份 HTML）
- **exe 设置窗口**（右键菜单打开）：全部配置 + 差分浏览已精简移除（保流畅）
- **网页差分浏览器**：构建时导出 `settings.html` 到 exe 旁，浏览器直接打开——
  仅差分图库浏览：连接本地 `packs` 文件夹后枚举全部学生，预览支持缩放（1–5×）与聚焦位置调节
- **预设**：整套配置保存 / 应用；宿主与网页端共用 `packs\settings\` 文件夹

## 运行方法

### 环境要求
- Windows 10/11 x64（macOS/Linux 未验证）
- Node.js 18+（仅开发与构建需要；绿色版 exe 运行不需要）

### 开发态运行
```cmd
cd electron
npm install
run.cmd        :: Windows（清 ELECTRON_RUN_AS_NODE、软件渲染等环境已配好）
:: 或 npm start
```

### 构建绿色版（推荐，免安装目录）
```cmd
node scripts\build-exe.js
:: 产物 dist\miyo-pet-win32-x64\miyo-pet.exe
```

### 构建便携版（单文件 exe）
```cmd
cd electron
npm run build:portable
:: 产物 dist-single\miyo-pet-portable.exe
```

也可在仓库根目录执行 `node scripts/build-portable.js`。两种 Windows 构建均先准备完整产物，
成功后才替换输出；失败保留原产物与用户 packs。重建前退出该输出目录中运行的桌宠。
若系统占用导致恢复失败，错误会给出唯一备份目录，请保留它。已有 `packs/miyo` 不会被内置导出覆盖。

构建仅自动分发 `prototype/voices` 中仓库自带的三条语音，不自动打包根目录私人 `voice/`、`packs/`。
美代本地语音放在 exe 旁 `packs/voice/`，角色专属语音放在对应包的模式目录 `voice/` 或 manifest 引用路径；
设置也支持明确的绝对路径 / file URL。默认配置保存在 `%APPDATA%/miyo-pet/config.json`，与 exe 输出分离。

### macOS 原生入口（实机待验证）

在 Mac 上安装 Node 与项目开发依赖，仓库根目录执行：

```sh
(cd electron && npm ci)
sh electron/run.sh
# Apple Silicon 与 Intel 分开构建；锁定 Electron 33.4.11
node scripts/build-mac.js --arch arm64
node scripts/build-mac.js --arch x64
```

分别输出到 `dist-mac/arm64/`、`dist-mac/x64/`，包含 `miyo-pet.app` 与 zip。
构建使用相应架构的 Mac Electron，不复用 Windows 运行时。`MIYO_GPU=on sh electron/run.sh` 可选择硬件加速；
Mac 启动器不默认禁用 sandbox。菜单“找回桌宠”和重新激活应用会显示并移回可见范围。

**当前 Mac arm64 / x64 均未构建、未运行**；本次只有 Windows 上的命令选择、配置与路径模拟测试。
签名和公证均未完成，公开分发前另行处理。Mac 用户后续按以下步骤补验：

1. 将 `.app` 放到含中文的目录后启动，确认立绘透明、拖动、音频和设置窗口正常；尝试 0.5 / 1 / 5 倍。
2. 核对配置位于 `~/Library/Application Support/miyo-pet/config.json`；外部包在其 `packs/`，
   预设在 `settings/`，Agent 摘要在 `agent-events/`，均不写入 `.app`。放入中文角色目录，切换并保存。
3. 退出后重新启动，确认配置与角色保持。隐藏后从菜单找回；休眠唤醒、切换分辨率、断开外接屏后确认仍可见。
4. 自愿接入 Codex 时使用下文的明确聊天绑定与支持版本，确认初始历史静默、新回合开始 / 完成可见；
   不支持的版本应显示错误，不能绕过白名单。另行记录真实失败 / 中断，以及 Mac 上实际源到画面的延迟。

可用 `MIYO_USERDATA` 指定独立测试目录，例如 `MIYO_USERDATA="$HOME/桌宠测试数据" sh electron/run.sh`。
测试打包应用时直接运行其 `Contents/MacOS/miyo-pet` 并设置相同变量；这样与日常配置隔离。

### 网页差分浏览器
构建后 exe 旁有 `settings.html`，浏览器直接打开 → 点「📁 连接差分文件夹」选择
`packs` 文件夹并授权，即可浏览全部学生差分（缩放 / 聚焦调节）。

## 目录结构

```
├── electron\               Electron 主进程
│   ├── main.js             主进程（窗口/菜单/托盘/IPC/config/状态接入）
│   ├── preload.js          contextBridge 暴露 petHost API
│   ├── paths.js            路径定位器（源码树 / 打包态）
│   └── package.json        依赖（electron、electron-builder）
├── prototype\
│   ├── v1\index.html       v1 半身差分页（浏览器预览壳，Electron 用 v2 单页）
│   ├── v2\index.html       ★ 桌宠页面（Electron 实际加载，2642 行零依赖单文件）
│   ├── v2\settings.html    ★ 设置页（exe 窗口与网页差分浏览器双形态）
│   ├── v2\preview.html     立绘预览（开发工具）
│   ├── v2\render.html      自建 Spine 渲染实验（已暂缓，开发工具）
│   ├── v1\label-tool.html  表情标注工具（开发工具）
│   ├── v1\assets\spr\      美代半身差分 40 张
│   └── v2\assets\          美代全身立绘 full/（原画质）+ full_low/（400px 副本）
├── scripts\
│   ├── state-core.js       ★ 状态内核：WorkBuddy 目录 → PetSnapshot（唯一真源）
│   ├── approval-status.js  待批准配对器（audit-log 事件配对）
│   ├── change-log.js       变化记录 JSONL（轮转 / 降级）
│   ├── task-status.js      0.2.x 兼容层（旧签名转发 state-core）
│   ├── credits-query.js    今日积分 sidecar（Node22+ sqlite，可选）
│   ├── status-provider.js  开发态：定时原子写 status.json
│   ├── check.js            静态自检（语法/DOM/台本/素材/一致性断言）
│   ├── test-status.js      状态链路单测（29 项）
│   ├── build-exe.js        绿色版打包（零下载）
│   ├── build-portable.js   便携版打包（electron-builder）
│   └── make-baseline.js    基线快照工具
├── docs\archive\           0.2.x→0.3.x 迭代日志与决策存档
├── tests\manual\           真机浏览器测试脚本（playwright-core）
├── LICENSE                 代码协议（MIT）
└── NOTICE.md               素材与第三方组件版权分层声明
```

## 素材说明

仓库随附的立绘 / 语音为《蔚蓝档案》游戏素材（见 [NOTICE.md](NOTICE.md)），
仅供个人使用、请勿用于商业目的。如需完整体验其他角色的差分：

1. 从游戏素材站点（如 [kivo.wiki](https://kivo.wiki)）获取角色差分图；
2. 在 exe 旁建 `packs\v1\<学生名>\`（半身 948×948）与 `packs\v2\<学生名>\`（全身 905×2477）；
3. 差分文件按编号命名（`00.png` `01.png` …，`XX_spr_NN.png` 原始命名也可），
   可选 `manifest.json`：`{ "label": "显示名" }`；
4. 重启设置页即自动识别（zip 直接丢进 packs 也会自动解压）。

## WorkBuddy 集成（可选）

程序只读扫描 WorkBuddy 的本地数据目录（默认 `~\.workbuddy`，可用环境变量
`CODEBUDDY_CONFIG_DIR` / `WORKBUDDY_TASKS_DIR` 覆盖）来获取任务状态：

- **纯只读**，不写 WorkBuddy 任何文件；
- 没有 WorkBuddy 时自动降级：桌宠以待机态正常运行，所有本地功能不受影响；
- 「今日积分」胶囊需要 Node.js 22+（sqlite 读取），缺失时自动隐藏；
- 设置页可整体关闭状态检测。

## Codex 桌面接入（v0.4.0 实验性）

设置页选择全局 Agent 来源 **Codex**，填写 Codex 目录（留空为用户目录下 `.codex`）和桌面聊天 ID。
可在 Codex 的「聊天操作 → 复制 → 复制深度链接」取得本地链接（Windows 默认 `Ctrl+Alt+L`），
直接粘贴 `codex://threads/<UUID>` 或 UUID，再点「保存 Codex 接入」。只保存 UUID；远程主机或携带访问参数的链接会被拒绝。

解析白名单限定 CLI `0.162.0-alpha.17.2`（已核对 Windows 桌面 `26.1007.9446.0`），未知版本停止解析。
仅支持回合开始、完成、失败、中断；“回合进行中”不能细分等待批准或输入，任务数量与会话关闭状态不受支持。
启动、重新启用、回退分支切换时只恢复历史，不重播完成；历史未结束回合显示“状态未知”，等监听后的新事件。

程序只读所选聊天的 rollout 文件，原文件包含对话，解析后仅输出生命周期白名单字段；不修改 hooks、信任或认证设置。
当前使用该版本官方的文件名回退规则：按线程 UUID 识别原始及回退文件，按文件名时间与 rollout UUID 选择最近候选，
不按修改时间选择。当前分支只有 `.jsonl.zst` 压缩文件时明确提示不支持；不会改读旧分支。
此规则不是 SQLite 中已选择分支路径的权威查询；特殊分支选择可能不同。格式和支持边界见[版本方案](docs/iterations/v0.4.0/design.md)。
真实当前聊天的历史读取，以及授权测试聊天的新回合开始 / 完成至桌宠画面均已核对；
真实失败 / 中断至画面仍待现场补验，这两种分支已有合成回归覆盖。

## 常见问题

- **启动黑屏 / 渲染异常**：启动器默认 `MIYO_GPU=off`（软件渲染）；独显环境可删掉
  run.cmd 中该变量试试硬件加速。
- **首次启动没有其他学生差分**：仓库仅随附美代素材，其他学生按「素材说明」添加。
- **没有 WorkBuddy 数据**：正常现象，桌宠走待机态；本地功能（互动/整点/台本）不受影响。
- **打包失败**：electron-builder 输出目录需可写且无进程占用；中文路径下建议先关闭
  正在运行的桌宠实例。

## 开发

- 静态自检：`node scripts\check.js`（语法 / DOM / 台本 / 素材 / 跨文件一致性断言）
- 状态链路单测：`node scripts\test-status.js`（29 项）
- 场景回归：`SMOKE2=1`（台本秒数）、`SMOKE13=1`（闲置覆盖层）配合 domstub；
  完整真机浏览器测试见 `tests\manual\`
- 架构与模块说明：[ARCHITECTURE.md](ARCHITECTURE.md)（含「给 AI 助手」的代码库导览）
- 后续需求、版本方案、开发计划与验证记录：[文档索引](docs/README.md)；开源协作流程见[协作规范](docs/contributing/workflow.md)。规划中的功能不代表当前版本已实现。
