# v0.4.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保持 Windows 可用，实现 macOS 基础支持、Codex 桌面端状态接入和角色独立配置。

**Architecture:** 保留 Electron 与现有 HTML。用 Agent 适配器隔离来源语义，用独立配置 / 包模块隔离角色，用平台路径模块区分内置资源与用户数据；共享接口见方案，计划不再复制一份。

**Tech Stack:** CommonJS、Node 内置模块与 `node:test`、现有 Electron / electron-builder、真实 Chromium / Electron 验证。

**Spec:** [design.md](design.md)，用户行为与出口条件见 [requirements.md](requirements.md)。

状态：**2026-10-15 用户批准按子代理流程开始开发**。先完成 Windows Codex 桌面端与 Windows 产物；Mac 兼容代码和验收步骤随版提供，真实 Mac 由用户后续补验。T1 的实际源映射由控制代理与子代理核实后继续 T5，不重复等待范围内开发授权。

## Global Constraints

- 保留此结构，只抽出本版需要稳定复用的边界。
- 新增模块为 CommonJS，优先使用 Node / Electron 内置 API；新增运行时依赖必须说明必要性和体积，不为未来需求预装。
- 用户已确认优先 Codex 桌面应用；CLI 测试不能替代桌面端验收。
- 内置图片与默认包来自只读资源目录。Mac 的用户配置、外部 packs、事件固定放 `app.getPath('userData')` 下；不以 `.app` 所在目录作为写入位置。
- 配置升级为 `schemaVersion:2`；配置迁移前原样备份，保留未知字段，失败停止写回。
- 同角色缺号回退：指定 ID → 当前角色该模式的默认 ID → 当前角色首个可用 ID。
- 所有文件 URL 使用 `pathToFileURL`，不手写 `file:///` 拼接。
- `scripts/state-core.js` 继续作为 WorkBuddy 解析唯一真源。
- 不上传对话与状态数据，不替用户批准请求；正式文档按本目录维护，不生成副本。

## Review Focus

1. 首次无 Agent 数据与已接入后的损坏文件应有不同表现；T4 测试健康状态，不把二者都画成任务失败。
2. Codex 重复、半行、乱序、旧回合与重放不应造成完成 / 等待状态倒退；T5 用合成事件并补真实桌面证据。
3. 快速角色切换期间晚到图片、语音和保存回调不能污染新角色；T3 与 T6 验证。
4. `.app` 只读和带中文 / 空格 / `#` 的用户目录仍须可用；T2 路径测试、T6 实机验证。
5. 旧配置、两种旧包布局、同名冲突及坏包不能悄悄丢数据；T3 测试迁移幂等、冲突优先级和回退。

## 任务依赖与交付划分

```text
T1 桌面事件可行性 ───────────────────┐
T4 Agent 契约 + WorkBuddy ───────────┴─ T5 Codex adapter ──┐
T2 平台路径 + 缩放 ── T3 角色与配置 ── T6 平台构建 / UI ──┴─ T7 联合验收
```

建议按 T2、T3、T4、T5、T6 分别形成可评审 PR；T1 结论更新本版文档，T7 汇总验证。每个 PR 保持 Windows 现有功能可运行；合入顺序按依赖执行，不依靠未合入的隐藏本地文件。

执行时先检查 `git status`，保存用户改动；功能开发另建 `codex/<topic>` 分支，按所选执行流程使用隔离工作区。每项功能测试先失败、再实现、再通过；只暂存本任务文件。以下代码路径均相对于仓库根，尚未创建的文件在任务中明确列出。

## Task 1: T1 验证真实 Codex 桌面事件入口

**文件：** 更新本版 `design.md`、`verification.md`；脱敏合成样本在实现 T5 时纳入测试，真实对话不入库。

**输入 / 输出：** 输入用户当前桌面端与官方接口；输出“桌面动作 → 源事件 → 字段 → kind / phase”映射表、支持版本、接入 / 恢复步骤、真实验证结果。使用方案 4.4 的自有事件协议。

- [ ] 记录桌面应用与本地 CLI 的各自版本，阅读当前官方 hooks / App Server 文档；不能混用版本或把 CLI 能力当作桌面能力。
- [ ] 用可恢复的最小测试接入验证桌面开始、正常结束、中断、失败、批准请求 / 解决、输入请求 / 解决；确认异步顺序及 session / turn / request 标识。
- [ ] 对关闭应用、重启桌宠、两个会话交错分别观察；确认已使用的桌面会话可被观察，不只是另起 App Server 创建的会话。
- [ ] 在验证文档逐行填写真实源映射与证据；不能获得的状态标缺口并评审，T5 在接口未成立时不继续猜测实现。
- [ ] 固化接入方式及最小原始字段白名单，更新方案；提交仅含脱敏文档的可行性结论。

**通过条件：** Codex 桌面核心状态有可重放来源，必要缺口已处理并记录范围评审。未通过时，Codex 交付不得标完成；T2 / T3 / T4 仍可独立推进。

## Task 2: T2 平台路径边界与缩放一致性

**文件：** 新增 `electron/platform-paths.js`、`tests/platform-paths.test.js`；修改 `electron/paths.js`、`electron/main.js`、`prototype/v2/index.html` 及必要静态检查。

**接口：** 消费方案 5 的路径入参；产出 `resolvePaths(...)` 以及宿主 / 页面统一的 0.5–5 缩放。路径结果供 T3、T5、T6 使用。

- [ ] 先写 `resolvePaths_mac_writes_only_user_data`、`windows_preserves_portable_pack_roots`、`file_url_roundtrips_special_characters`；断言 Mac 写入不在 appRoot，Windows 保留兼容根，URL 反解得到原路径。
- [ ] 在真实 Chromium 回归脚本中加入 `scale_5_is_applied_after_scale_2`；先重现当前页面仍停留 2 倍的失败。
- [ ] 运行 `node --test tests/platform-paths.test.js` 和对应浏览器用例，确认失败原因对应现有缺陷或未实现接口。
- [ ] 实现路径纯函数，接入配置 / 包根定位；改用 `pathToFileURL`，统一页面缩放上限。不改平台无关台本行为。
- [ ] 运行路径测试、浏览器缩放用例、`node scripts/check.js`、`node scripts/test-status.js`，结果写入验证记录；提交本任务 diff。

## Task 3: T3 统一角色包与配置迁移

**文件：** 新增 `electron/character-packs.js`、`electron/config-store.js`、`tests/characters.test.js`、`tests/config-store.test.js`；修改 `electron/main.js`、`prototype/v2/index.html`、`prototype/v2/settings.html`；合成夹具由测试写入临时目录。

**接口：** 消费 T2 的 packRoots / configDir；产出方案 6 的 `discoverPacks(roots)`、配置读写 / 迁移 / 角色合并接口；`packs-list` 与加载只用同一发现结果。preload 只按实际必要性扩展，不开放任意路径读写。

- [ ] 先写两种布局均可列出、同 ID 同模式优先级一致、label-only 兼容、坏 JSON / 越界路径拒绝和当前角色缺号回退测试。
- [ ] 写旧 series 非美代迁移、schema 2 迁移幂等、未知字段保留、原始备份一致、写失败原文件保留测试；合成 A / B 用不同台本与音频引用。
- [ ] 运行 `node --test tests/characters.test.js tests/config-store.test.js`，确认预期失败；实现最小模块和主进程接线。
- [ ] 页面切换前保存当前角色；目标验证成功才切换；取消旧播放并给异步加载 / 保存加代数检查。只读默认与用户覆盖分开，不复制美代默认给别的角色。
- [ ] 在真实浏览器验证 A → B → A、重启恢复、快速切换晚回调、缺号和无语音场景；断言无串图 / 串台词、最终活动角色和磁盘一致。
- [ ] 运行新增测试与现有两项检查；验证网页差分浏览器和预设未退化，更新验证记录并提交。

## Task 4: T4 Agent 契约、来源选择与 WorkBuddy 回归

**文件：** 新增 `scripts/agents/schema.js`、`scripts/agents/workbuddy.js`、`scripts/agents/hub.js`、`tests/agents.test.js`；修改 `electron/main.js`、`electron/preload.js`、两份 v2 HTML 及必要静态检查。原 `state-core.js` 仅按确实必要的兼容点修改。

**接口：** 按方案 4.1 / 4.2 实现 `AgentSnapshot`、adapter 生命周期、hub API、`toPetState(snapshot)`。来源开关存全局 agent 配置，不放入角色设置。

- [ ] 先写 `unconfigured_is_not_task_failure`、`read_failure_keeps_last_good_without_done`、`nullable_counts_are_not_tasks`、`provider_switch_never_reuses_completion`。
- [ ] 用 fake watcher / timer 写 `disabled_provider_stops_and_emits_nothing`、反复启停只创建一套监听、dispose 后无回调测试；避免用源代码字符串匹配充当生命周期测试。
- [ ] 运行 `node --test tests/agents.test.js` 确认预期失败；实现 wrapper / hub，主进程原监听改由适配器拥有。
- [ ] 页面显示来源和 health，来源数量未知时隐藏计数；区分 awaiting_input 与 WorkBuddy pending 文案；来源故障不进入任务失败表情。
- [ ] 运行新增测试和原 29 项状态断言，真实 Electron 验证关闭采集后无后续状态推送、再次开启恢复、无 WorkBuddy 纯摆宠正常；记录并提交。

## Task 5: T5 Codex 桌面 rollout 只读适配

**前置：** T1 同版本入口已核对，用户批准等待后续补齐；依赖 T2 路径和 T4 契约。

**文件：** 新增 `scripts/codex-event.js`、`scripts/agents/codex.js` 与专用测试；必要时修改主进程、设置页与用户接入说明。接口遵守方案 4.3 / 4.4，白名单解析不转发正文。

- [ ] 先写正常回合、error 非空失败、中断、nullable counts、能力声明、不支持版本测试，确认 RED 再实现。
- [ ] 写半行 / 无效 JSON / 行缓存上限、重复终态、终态后晚到 start、旧 turn、无 ID 中断、线程身份、结构化子 agent 排除测试。
- [ ] 写重启 / 重新启用旧 start 为 stale unknown、历史完成不重播、持久化失败不庆祝、截断 / 替换 / rollback / fork 历史恢复测试。
- [ ] 按线程 ID 文件名查找并核实元数据；只读用户源文件。游标和完成摘要写入 T2 eventDir。含 prompt / reply / tool arguments 的合成原始行证明白名单没有泄漏。
- [ ] 设置页提供 Codex 目录 / 桌面聊天 ID、版本与能力说明；未知数量隐藏，运行文案明确无法细分等待。全局来源设置不可归入角色。
- [ ] 在真实当前 Codex 桌面聊天核对读取和画面；记录观察到的状态及事件收到至 UI 时延。未触发的桌面失败 / 中断单列，不用合成测试冒充实测；禁用与重启通过 Electron 回归。
- [ ] 执行新增及现有检查，记录支持版本、实测限制，提交本任务。

## Task 6: T6 原生 Mac 启动、产物与桌面 UI 验证

**文件：** 修改 `electron/run.sh`、`electron/package.json`、`electron/electron-builder.yml`、必要的 `electron/main.js` 平台窗口 / 菜单逻辑；新增 `scripts/build-mac.js`、`tests/manual/v040-regression.js`；更新实际用户说明和构建说明。

**接口：** 消费 T2 / T3 的路径与配置；Mac 构建入口 `node scripts/build-mac.js --arch arm64` 或 `--arch x64`，内部不调用 `npm.cmd` / Windows electronDist。Windows 两种产物入口保持不变。

- [ ] 先用假文件系统 / 命令调用桩验证 Mac 启动 / 构建不会选择 `.exe`、`npm.cmd` 或写入资源目录；将平台测试扩展到这条命令选择。
- [ ] 实现原生 Mac 启动、分架构构建、菜单恢复入口及屏外可见性夹取；不增加自动穿透 / 全屏策略等后续功能。
- [ ] `tests/manual/v040-regression.js` 复用现有测试方式，用真实 Chromium + 模拟 petHost 验证缩放、角色与设置 UI；再用 Electron 验证透明窗口、拖动、音频、托盘 / 菜单。
- [ ] 提供 `sh electron/run.sh` 与 arm64 / x64 构建命令，Windows 以命令选择和路径测试验证；未运行的 Mac 构建标“未构建”，不能直接填构建通过。
- [ ] 将 Mac `.app` 的 userData、中文路径、重启、休眠 / 屏幕变化及 Codex 验收写成操作步骤；用户后续执行，本次不因待 Mac 实机停止 Windows 交付。
- [ ] Windows 构建目录版和 portable，验证外部 packs / 网页设置导出 / 用户原配置；运行全套检查，记录并提交。

## Task 7: T7 联合验收与发布准备

**文件：** 更新本版四份文档、`docs/requirements/roadmap.md`、根 `README.md`、`ARCHITECTURE.md`；只有确认发布编号后才修改 `electron/package.json` 版本及必要锁文件。

- [ ] 按验证矩阵完成 AC-01～AC-14 的证据回填，区分自动测试、模拟宿主、真实 Electron、Codex 桌面与 Mac 产物。
- [ ] 在最终代码提交执行现有检查和新增测试，检查 `git diff --check`；不拿早期某次通过覆盖后来的代码。
- [ ] 进行整体代码评审，特别检查适配器释放资源、配置恢复和角色异步切换；处理发现后重跑相关检查。
- [ ] 整理支持矩阵、已知限制、升级 / 回退说明；Windows Codex 桌面缺证据时明确缺口，Mac 待实机单列，不阻塞 Windows PR，不发布为 Mac 已验证。
- [ ] 经版本评审确定发布编号；通过个人 fork PR 合入上游后，由有权限的维护者决定正式发布。

## 执行记录

| 任务 | 状态 | 提交 / PR | 验证 |
| --- | --- | --- | --- |
| T1 | 未开始 | 无 | 桌面事件待实测 |
| T2 | 未开始 | 无 | 无本版实现 |
| T3 | 未开始 | 无 | 无本版实现 |
| T4 | 未开始 | 无 | 现有 29 项通过不代表新适配已验证 |
| T5 | 未开始 | 无 | 依赖 T1 |
| T6 | 未开始 | 无 | Mac 待实机 |
| T7 | 未开始 | 无 | 不满足发布条件 |
