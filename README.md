# miyo-pet · 樱井美代桌宠

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
- **大小缩放**：0.5–5×；窗口始终贴屏幕右下角

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
