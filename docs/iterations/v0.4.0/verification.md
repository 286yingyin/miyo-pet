# v0.4.0 测试方案与验证记录

状态：2026-10-15 用户批准开发，Windows 先验收，Mac 实机用户后续补验；下表仅实测项可标通过。

关联：[需求](requirements.md) · [方案](design.md) · [开发计划](plan.md)

## 1. 现状调研基线：已经执行

日期：2026-10-15。代码：`9ff3645`，应用 `0.3.23`。环境：Windows / PowerShell，Node `v24.12.0`，本地 Codex CLI `0.162.0-alpha.17.2`。测试使用合成目录和模拟宿主；没有读取真实 Agent 对话。

| 检查 | 结果 | 证明范围与限制 |
| --- | --- | --- |
| `node scripts/check.js` | 通过 | 现有语法、符号和结构检查；不能替代行为 / 实机验收 |
| `node scripts/test-status.js` | 29/29 通过 | 原 WorkBuddy 状态逻辑覆盖通过；不包括新来源和配置迁移 |
| 缺失 WorkBuddy，合成目录连续采样 | 第三次进入 error，缺陷确认 | 证明“未接入”当前可能被误当故障；不是新功能已修复 |
| 包根含 `<角色>/v2/00.png`，临时目录 + main 沙箱 | 扫描可发现，packs-list 未列出，缺陷确认 | 覆盖一种列表 / 扫描不一致场景 |
| 真实 Chromium + 模拟 petHost，先 2 倍再 5 倍 | 页面保持 2 倍，缺陷确认 | 不是真实 Electron 窗口缩放测试 |
| Chromium 设置页与图片 | 41 个缩略图无坏图，模拟宿主设置初始化无页面异常 | 仅现有 UI 冒烟，不证明角色隔离 |
| 本地 CLI 能力检查 | 可运行 `codex --version` / `app-server --help` | 不是 Codex 桌面集成测试 |
| 本地 DSH 命令 | 未安装 | 未进行 DSH 实测，不影响首版范围 |

调研临时服务已关闭，工具生成的日志 / 截图已移至工作区外，产品源文件在调研时未改动。以上为一次性调查记录，并非可重复执行的回归脚本；实施时必须把对应缺陷固化成 T2～T5 的正式用例。

## 2. 验证分层与命令

| 层级 | 手段 | 适用内容 |
| --- | --- | --- |
| 静态 / 原逻辑 | `node scripts/check.js`、`node scripts/test-status.js` | 保留现有约束与 29 项状态断言 |
| 新增 Node 行为测试 | `node --test tests/platform-paths.test.js tests/characters.test.js tests/config-store.test.js tests/agents.test.js` | 路径、包、迁移、归一与适配生命周期 |
| 真实浏览器 | 计划新增 `node tests/manual/v040-regression.js` | 模拟 petHost 的 UI、图片、缩放与切换竞态 |
| 真实 Electron | 开发态与实际构建产物操作 | 透明窗口、拖动、托盘 / 菜单、音频、落盘 |
| 真实 Agent | 从 Codex 桌面应用和 WorkBuddy 实际操作 | 源事件、等待与恢复、端到端时延 |
| 平台产物 | Windows 目录 / portable；Mac `.app` | 打包资源、可写目录、首次启动、升级 / 回退 |

新增命令随各阶段实现；只有下列执行记录中的命令可视为已运行。浏览器测试通过 MIYO_PLAYWRIGHT_MODULE 使用已有 Playwright，不加入产品运行依赖。

## 3. 用例矩阵：按实施阶段回填

| 用例 ID | 关联验收 | 场景 / 关键断言 | 负责阶段 | 当前结果 |
| --- | --- | --- | --- | --- |
| WIN-01 | AC-01、AC-14 | Windows 目录版 / portable 启动、互动、台本、语音、整点、提醒、预设、网页导出 | T6 / T7 | WIP：目录版构建 / 启动 / 重启已测；portable 构建与外层首次界面有证据，重启未验；网页大图预览缺资源 |
| WB-01 | AC-01、AC-02 | 原 29 项；无数据不报任务错，已有数据读失败不归零 / 不完成 | T4 | 原 29 项与新增 Node / Electron 回归通过；任务评审通过 |
| UI-01 | AC-03 | 0.5、2、5 倍；重复应用配置后显示 / 窗口一致 | T2 / T6 | Chromium 回归通过；实际窗口联合验证待 T6 |
| AG-01 | AC-04、AC-05 | 来源独立启停，关闭后 watcher / timer 释放且不 emit；反复开关不重复注册 | T4 | 单元与真实 Electron 合成回归通过；任务评审通过 |
| AG-02 | AC-02、AC-05 | 无来源、来源异常、任务失败分开；未知数量隐藏；切换来源不重放完成 | T4 | Node 与真实 Electron 渲染回归通过；任务评审通过 |
| CX-01 | AC-06 | 桌面端真实开始 / 运行 / 完成 / 中断 / 失败，记录版本和源事件 | T1 / T5 | 真实桌面新回合开始 / 完成至画面通过；中断有历史源记录，失败 / 中断至画面仅合成回归；任务评审通过 |
| CX-02 | AC-06 | 桌面批准 / 输入等待及恢复；不通过桌宠执行批准 | 后续 | 当前入口不支持；用户批准首版排除，界面必须说明 |
| CX-03 | AC-07 | 重复、半行、乱序、旧 turn / request、重放与多会话不串状态；完成只提示一次 | T5 | Node 与真实 Electron 合成回归通过，含回退分支选择 / 静默恢复；任务评审通过 |
| CX-04 | AC-04、AC-07 | 禁用、断连、桌宠 / Codex 重启；事件收到至 UI ≤5 秒，长待机不误判断连 | T5 / T6 | Electron 禁用 / 重新启用 / 重启回归通过；真实桌面开始 / 完成至页面 38 / 30 ms；最终产物待验 |
| CX-05 | AC-06、AC-14 | rollout 白名单不泄漏正文；线程身份 / 路径校验；仅保存读取摘要，不修改 hooks | T5 | 合成敏感字段、身份 / 版本门槛与最小摘要回归通过；用户源只读，无 hooks 修改；任务评审通过 |
| PATH-01 | AC-10 | Mac 不写 `.app`；Windows 保留旧根；中文 / 空格 / `#` / `%` 路径 URL 正确 | T2 / T6 | 路径 / 配置测试与真实 Windows 音频通过；Mac 实机待补验 |
| MAC-01 | AC-08、AC-09 | 真实 Mac 开发态与 `.app`：显示、拖动、菜单 / 设置、音频、保存、重启 | T6 | 未执行，待实机 |
| MAC-02 | AC-09 | 休眠恢复、显示器变化后可找回，负坐标屏幕不会使窗口丢失 | T6 | 未执行，待实机 |
| BUILD-01 | AC-08、AC-14 | Mac arm64 / x64 分别构建，签名状态可辨；至少一个架构实机端到端通过 | T6 / T7 | 未执行 |
| CHAR-01 | AC-03、AC-11 | 两种包布局、label-only、同 ID 冲突；扫描列表与实际加载一致 | T3 | 自动及 Electron 合成测试通过；任务评审通过 |
| CHAR-02 | AC-11 | A → B → A 与重启后，各自映射、台本、语音、互动、整点、闲置、显示配置保留 | T3 / T6 | 真实 Electron 合成测试通过；最终产物待验 |
| CHAR-03 | AC-11、AC-12 | 快速切换时旧图片 / 音频 / 保存回调晚到，不覆盖最终活动角色 | T3 / T6 | Chrome 迟到图片与 Electron 快速切换 / 旧保存通过；任务评审通过 |
| CHAR-04 | AC-12 | 差分缺失只在当前角色回退；无素材 / 无语音不借用美代；坏包不破坏当前包 | T3 | Node / 真实浏览器 / Electron 合成测试通过；任务评审通过 |
| CFG-01 | AC-13 | 非美代旧 series 归属正确；schema 2 幂等；未知字段保留；原始备份可恢复 | T3 | 迁移和真实 Electron 预设回归通过；任务评审通过 |
| CFG-02 | AC-13 | 损坏配置、迁移 / 写入失败、写入期间退出，原文件和上一个有效配置可恢复 | T3 / T6 | 配置损坏 / rename 失败保留原文件通过；最终产物退出恢复待验 |

AC-01～AC-14 全部映射到上表；“原测试通过”不能替代对应新增行为的验证。

## 4. Codex 桌面事件映射记录

T1 已核对当前 Windows 桌面本地文件与同版本官方源码。下表区分真实观察与源码证明，不能把后者当成桌面动作已实测。

| 桌面动作 | 桌宠自有 kind | 源入口 / 原生事件 / 必要字段 | 当前证据 |
| --- | --- | --- | --- |
| 提交后开始工作 | turn_started | rollout event_msg/task_started；turn_id、timestamp、ordinal | 指定桌面聊天观察到 3 次 start |
| 正常完成 | turn_completed | task_complete；turn_id、error 缺失/null | 同一桌面聊天观察到 2 次 complete |
| 用户中断 | turn_interrupted | turn_aborted；可选 turn_id、受控 reason | 同版本源码持久化；本线程未实测 |
| 回合失败 | turn_failed | task_complete.error 非空 | 同版本源码确认；本线程未实测 |
| 请求批准 / 解决 | 不支持 | 请求事件不持久化，hooks 配对也不完整 | 用户确认首版后续补齐 |
| 请求输入 / 解决 | 不支持 | 请求事件不持久化 | 用户确认首版后续补齐 |
| 会话结束 | 不支持 | shutdown_complete 不持久化 | 不从无事件推测关闭 |

无法获得某项时记录操作复现、缺失原因、受影响验收项、备选方案及评审决定；不能填入推测的 hooks 名称后标通过。

### 2026-10-15：T1 只读调查与范围评审

本机 Windows MSIX 应用版本 `26.1007.9446.0`，Electron 包版本 `26.1007.71326`，实际内嵌 CLI `0.162.0-alpha.17.2`。桌面启动的 App Server 通过内部 stdio 工作；未启动独立服务替代当前桌面。调查未注册 hooks、未修改信任或用户配置。

只核查用户授权的当前桌面聊天文件，输出字段限于事件种类、ID、时间、ordinal 和 error 是否非空；没有保存标题、工作目录、提示词、回复或工具参数。meta.id 对应当前 root，source=vscode、thread_source=user、history_mode=paginated，无 parent；source=vscode 本身不能证明是桌面。已见 start ordinal 1/257/449、complete 255/446，证明真实桌面入口及正常生命周期；不证明失败 / 中断已实际触发。

依据为与实际 CLI 完全一致的 [rust-v0.162.0-alpha.17.2 持久化策略](https://github.com/openai/codex/blob/rust-v0.162.0-alpha.17.2/codex-rs/rollout/src/policy.rs#L127)、[事件定义](https://github.com/openai/codex/blob/rust-v0.162.0-alpha.17.2/codex-rs/protocol/src/protocol.rs#L2133)、[失败终态写入](https://github.com/openai/codex/blob/rust-v0.162.0-alpha.17.2/codex-rs/core/src/tasks/mod.rs#L814)。中断、失败分支后续先作合成回归，真实桌面操作仍分别记录。用户已批准首版等待信号不支持；设置 / UI 须明确说明。此阶段未运行产品新适配器，尚不能声称端到端完成。

## 5. 支持矩阵

T5 文件发现调查：旧匹配规则漏掉线程回退后带 `_rolloutId` 后缀的日志，导致读到旧中断状态。只读核对指定线程的数据库指针与对应日志后，已定位当前回合 start；同版本官方源码确认这是保留 thread ID 的新分支。a7f0ce7 已采用官方文件系统回退排序并增加回归；重新接入的未结束历史回合显示状态未确认，未把调查工具知道的运行状态注入产品。

T5 实时验收：用户明确允许新建临时聊天、两条无文件改动指令和完成后归档。应用工具创建的本地根聊天使用 `agent_created_thread` 标签；同版本协议把它归为 Feature 字符串，与 subagent 区分。方案据此精确增加该标签，仍要求显式绑定、根线程、来源 / 版本校验；不能放行其他 Feature。标签正反例回归和实际新回合至画面已通过，临时聊天已归档；详细测量见执行记录。

| 系统 / 端 | 基线调查 | v0.4.0 构建 | v0.4.0 实际运行 |
| --- | --- | --- | --- |
| Windows x64 | Node 与浏览器基线已检查 | 目录版与 portable 已构建，portable 结构校验通过 | 目录版启动 / 重启通过；portable 首次界面部分通过，重启及最终联合验收未完成 |
| macOS arm64 | 无实机证据 | 未执行 | 未执行 |
| macOS x64 | 无实机证据 | 未执行 | 未执行 |
| WorkBuddy | 合成状态测试 29 项通过 | 不适用 | 新适配 Node / Electron 合成回归通过，任务评审通过；最终产物待验 |
| Codex 桌面端 | 已核对指定桌面聊天真实 start / complete 与同版本源码 | 不适用 | 开发态真实新回合开始 / 完成至 Electron 通过；失败 / 中断至画面仅合成回归；最终产物待验 |
| Codex CLI | 版本 / help 已检查 | 不适用 | 集成未验证，非桌面替代 |

每次更新矩阵应补实际 OS / 架构 / 应用版本；仅编译成功不能写成运行支持。

## 6. 执行记录格式

每个阶段复用下面的小表追加结果，不另建逐次测试文档：

| 字段 | 填写内容 |
| --- | --- |
| 日期 / 执行者 | 实际日期与角色 |
| 代码 | 完整提交 SHA，或基础 SHA + 未提交文件范围 |
| 环境 | OS 版本、架构、Node / Electron / Codex 桌面版本 |
| 命令 / 操作 | 可重复的命令或最短操作步骤 |
| 用例 | 上表用例 ID |
| 结果 | 通过 / 失败 / 未执行 / 受阻，附实际计数或现象 |
| 证据 | 小型脱敏摘要；大型产物 / 日志仅引用，不含真实对话 |
| 限制 / 后续 | 缺失设备、未覆盖架构、缺陷及负责阶段 |

### 2026-10-15：文档建立检查

代码仍为 `9ff3645`，本次仅新增 / 修改文档。已检查本次 10 份 Markdown 的本地链接、代码块闭合、UTF-8 替换字符、需求 ID 唯一性与验收覆盖：23 项需求无重复，14 条验收均有用例对应，无缺失链接；`git diff --check` 通过。

此项证明文档结构和追踪关系有效。产品测试结果沿用第 1 节所记录的调研基线，本次纯文档变更不重复运行产品测试；没有新增功能通过声明。

### 2026-10-15：T2 路径 / 缩放实施与复审

提交 7e249df、57fbf37。Windows / Node v24.12.0 / 锁定 Electron。先复现缺少路径接口、页面 2→5 倍不更新、两页面语音绝对路径截断 / file URL 二次编码、目录版遗漏新模块，以及 Mac 配置环境变量绕过 userData 的失败；修复后正式 tests/*.test.js 15/15、状态断言 29/29、check.js 和 diff 检查通过。真实 Chrome 覆盖 0.5 / 2 / 5 倍，真实 Electron 覆盖桌宠及设置试听共 8 种音频路径，目录版构建与新模块 require 通过。独立评审发现的 Mac 配置入口绕过已修复并复审通过。Mac 路径 / 配置为纯函数与真实临时文件测试，不是 Mac 实机运行。

### 2026-10-15：T3 角色与配置实施，任务评审通过

提交 9772686。Windows / Node v24.12.0 / 真实 Electron 与 Chrome。正式 node --test tests/*.test.js 30/30、node scripts/test-status.js 29/29、node scripts/check.js 及 git diff --check 通过。合成 A / B 包验证两种旧布局、优先级、label-only、真实路径越界拒绝、当前角色缺号回退；真实 Electron 覆盖 A→B→A、重启、快速切换、旧保存拒绝与冲突恢复、预设声明角色、ZIP 兼容和磁盘一致。真实浏览器延迟旧图片响应，最终仍为新角色；无台词角色点击 / 整点保持静默。迁移测试覆盖原始字节备份、幂等、未知字段、原子写失败后原文件保留。新增角色素材均为合成夹具。本阶段任务评审与修复复审已通过；最终产物与 Mac 实机仍未验收。

正式 Node 套件使用 tests/*.test.js。裸 node --test 会误收集既有浏览器调试脚本 scripts/ix-test.js 并报 document is not defined；该脚本未改动，不把这次误收集当产品测试通过。


T3 修复复审（75d78b0）：独立评审复现连续内部保存丢第二次操作，修复为队列执行时绑定内部请求身份 / revision；显式渲染页请求仍拒绝过期写入。真实文件队列验证不同字段并发及菜单 false→true 两次操作均落盘。另用 A/B 不同合成 PCM 音频观察 Native Audio loadeddata、playing、play promise 与 currentTime；切到 B 后 A 停止并归零，释放 A 的迟到回调后 B 仍播放，切回保留各自路径。node --test tests/main-config-path.test.js tests/config-store.test.js tests/characters-electron.test.js 12/12 通过，静态与 diff 检查通过；独立限定复审确认两项已解决。最终联合测试仍由 T7 执行。

### 2026-10-15：T4 Agent 契约与 WorkBuddy 生命周期实施

提交 ca224b4。新增 schema / hub / WorkBuddy adapter，主进程复用一个 hub 分配递增 revision；归一宿主仅按 completionKey 庆祝。监听、轮询、去抖与积分查询由所选来源的启用状态管理，整点提醒独立调度。Codex 在此阶段尚无读取器，选择后显示未接入且隐藏未知数量 / 积分，不回读 WorkBuddy。

Windows / Node v24.12.0 / Electron 33.4.11。首个 RED 为模块尚未实现；后续自查补出两个真实失败：旧定时器回调覆盖新生命周期句柄、adapter 启动失败遗留资源。修复后 node --test tests/agents.test.js tests/agents-electron.test.js tests/agents-main.test.js 为 13/13、0 skipped；修复前完整 tests/*.test.js 为 43/43，最终联合全套由 T7 重跑。原状态断言 29/29、check.js、diff 检查通过。

真实 Electron 加载实际 main / preload / 页面，使用隔离的合成 WorkBuddy 目录：禁用后观察 2.8 秒，无继续读取或状态推送；手动刷新 / 页面重载也不读取；启用恢复 processing；完成后紧接刷新仍保留提示；设置将 agent 保存至 global。渲染回归覆盖不按计数下降庆祝、完成键一次性、中断清理、失败表情与未接入待机。积分测试证明切换来源取消拥有的子进程、定时器并忽略迟到结果；缺失 WorkBuddy 仍可启动待机。独立任务评审发现的设置草稿问题已修复并复审通过。此结果不证明真实 Codex 接入、最终产物或 Mac 实机可用。

T4 修复复审（c694d8f）：实际设置页先修改缩放 / 检测，再切换来源会丢草稿，已修复为来源保存成功只更新 agent / revision。另覆盖请求期间继续编辑、立即排队普通保存不写回旧来源、真实 rename EACCES 保留草稿并恢复来源控件、CONFIG_STALE 明确重载且不重放旧配置。先复现三个行为失败，再执行 node --test tests/agents-electron.test.js tests/characters-electron.test.js tests/config-store.test.js，10/10、0 skipped；静态与 diff 检查通过。独立限定复审确认全部解决，无新增阻塞问题。

### 2026-10-15：T5 Codex 实施与真实桌面验证，任务评审通过

提交 a7f0ce7。Windows / Node v24.12.0 / Electron 33.4.11 / Codex 桌面 26.1007.9446.0，内嵌 CLI 0.162.0-alpha.17.2。只读白名单解析、精确来源 / 版本门槛、两种文件名与分支切换、完整行游标、半行 / 无效行 / 上限、旧终态与回放、持久化先于庆祝、禁用无读取、重新启用 / 重启静默恢复通过。来源保存队列合并执行时的最新绑定，保留 T4 草稿和冲突行为。压缩选定分支明确不支持；文件系统回退排序不冒充 SQLite 权威指针。

完整命令 node --test tests/*.test.js 最终 65/65、0 skipped（10.006 秒）；node scripts/check.js、node scripts/test-status.js（29/29）、git diff --check 通过。此前完整运行 64/65，发现测试在延迟响应钩子安装前释放回调的同步竞态；补明确就绪屏障后重跑通过，没有绕过产品保存逻辑。新增边界均记录 RED / GREEN，包括半行游标、同批多次完成、回退文件发现、来源身份和排队保存覆盖。

用户授权的临时本地桌面聊天先完成历史回合，桌宠连接后保持 idle、无完成键；再发送等待后回复的指令，真实新回合触发 running → completed，桌宠进入 done，counts 全为 null 且数量胶囊隐藏。Codex 事件时间戳至页面收到状态：开始 38 ms、完成 30 ms；适配器发布至页面收到均为 1 ms。仅测量一次本机回合，事件时间戳不是磁盘刷新时间。独立应用状态与实际 Electron 截图相互印证；临时聊天已归档，真实 ID / 原文 / 截图未入库。真实失败 / 中断操作至画面本次未触发，合成分支通过；Mac 实机及最终 Windows 产物尚未验收。

T5 评审修复（4a0fc7d）：独立评审复现未知事件名命中对象原型，导致当前回合被误当终态，后续真实完成被抑制。解析器增加自身属性检查；constructor / toString / __proto__ 各补纯解析与适配器时序回归，6 项先失败再通过。node --test tests/codex.test.js tests/codex-electron.test.js 为 25/25、0 skipped，静态与 diff 检查通过；完整套件由 T7 在最终代码重跑。独立限定复审确认问题已解决，无新增阻塞项。

### 2026-10-15：T6 WIP 开发交接

用户要求推送当前进度供朋友继续开发，本阶段未标完成、未进行独立任务评审。交接代码提交为 `600afdc9a7592bba3c52902838440cab712d15d3`，包括 Mac 启动 / 分架构构建入口、窗口找回与几何夹取、Windows 构建暂存 / 校验后替换与失败恢复，以及平台和实际产物回归脚本。Mac 结果仅为 Windows 上的命令 / 路径测试，实际 arm64 / x64 均未构建、未运行。

Windows / Node v24.12.0 / Electron 33.4.11。平台专项测试 14/14、node scripts/check.js、原 node scripts/test-status.js 29/29 和 diff 检查通过。完整 node --test tests/*.test.js 先前一次 85/85，最近一次 84/85；tests/codex.test.js 的 inherited event name __proto__ cannot terminate a live turn or suppress completion 在最终完成键处得到 null，预期为该回合键。失败原因尚未定位，不把早先绿色覆盖当前失败。

真实目录版已构建并启动 / 重启，验证旧配置迁移、中文外部角色、设置、来源模块 / 音频资源，以及程序化指针至 IPC 的窗口移动。音频使用静音的原生解码 / 播放状态断言，不声称人工听音；程序化移动不等于操作系统物理拖动。Portable 构建退出 0，PE / NSIS 头与归档长度校验通过；外层启动器的 Electron 测试驱动握手超时，受控启动加本机 CDP 已观察到角色 / 设置 / 音频 / 指针行为及截图，但关闭 / 重启脚本没有最终结果，清理时限修正尚未验证，因此 portable 重启不得填通过。

已知缺陷：网页导出的缩略图可加载，大图预览仍引用缺失的 miyo-web/v2/assets/full 资源；新增浏览器断言失败。接手时先修复此资源布局和上述完成键测试失败，再补 portable 完整验收，执行 T6 独立评审与 T7 整体评审。用户要求后续所有 review 使用 gpt-6.1-sol。真实对话、探测脚本、二进制产物和私有截图不随 Git 交接。

复验命令（从仓库根目录运行；浏览器 / Electron 测试按根 README 安装依赖，必要时用 `MIYO_PLAYWRIGHT_MODULE` 指定本机 playwright-core 模块）：

```sh
node --test tests/platform-build.test.js tests/platform-electron.test.js
node --test tests/*.test.js
node scripts/check.js
node scripts/test-status.js
node tests/manual/v040-regression.js browser
```

最后一项当前在 `previewImg` 大图加载断言处 5 秒超时，属于已知失败。Windows 目录版与 portable 的本地构建产物早于最后一次窗口可见范围调整，接手后须从最终代码重新构建，再运行回归；现存产物不能作为该提交完整通过的证据。构建期间关闭桌宠，保留原始配置和角色包备份；输出目录中的符号链接 / junction 及构建时并发修改尚未验收。

### 2026-10-15：同步上游 develop，解决 PR 合并冲突

以本分支交接提交 `462e699` 为基础，合并上游 `develop` 的 `c35c969`。上游新增 AI-HANDOFF.md、规范化仓库地址并指定 develop 为协作分支；仅 README 开头发生内容冲突，已同时保留本分支 WIP 提示与上游介绍 / 贡献说明。采用 merge 保留共享分支历史，不 rebase、不强推。协作规范同步为向上游 develop 提 PR。

本次运行 `node scripts/check.js` 全部通过、`node scripts/test-status.js` 29/29、文档链接 / 编码 / 需求覆盖检查通过；无未合并条目或冲突标记。差异检查保留上游 Markdown 两空格换行，仅放行行尾空格。运行时代码、依赖和构建脚本未变，package.json 仅更新 repository / homepage，未重复运行完整产品套件；上节 84/85 与其他 WIP 缺口仍是最新完整验收状态，不因同步上游而视为解决。

## 7. 发布判定

**当前结论：可作为 WIP 开发交接，不满足 v0.4.0 发布条件。** T2～T5 已通过任务评审及必要修复复审；T6 尚有失败测试、网页预览缺陷和 portable 重启缺口，未评审；T7 未执行。Mac 实机保留待用户补验。推送到 fork 不表示合入上游或正式发布。

发布前逐项检查：

- [ ] AC-01～AC-14 有真实结果，遗留缺口已有明确范围评审。
- [ ] Codex 桌面目标通过，不能仅提交 CLI 演示。
- [ ] Windows 两种产物端到端通过；Mac 兼容代码和操作步骤已提供，未实测保持待用户验证，不阻塞本次 Windows PR。
- [ ] 旧配置备份 / 恢复和旧角色包兼容通过。
- [ ] 最终提交的自动检查通过，文档 / 版本 / 支持矩阵一致。
- [ ] 维护者完成评审并确定发布与签名安排。
