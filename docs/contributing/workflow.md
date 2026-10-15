# 协作与文档规范

创建：2026-10-15。权限会变化；以下现场信息仅代表核实当时。

## 1. 当前仓库与权限

2026-10-15 通过 GitHub 连接核实：

- 上游为公开仓库 [`286yingyin/miyo-pet`](https://github.com/286yingyin/miyo-pet)，默认分支 `main`，允许 fork，仓库自身不是 fork。
- 当前连接账号为 `whitebluepants`；对上游 `pull: true`、`push: false`，没有直接推送权限。当前是“能读，不能直接写”，并非无法访问仓库。
- 已创建个人 fork [`whitebluepants/miyo-pet`](https://github.com/whitebluepants/miyo-pet)。本地 `origin` 已指向个人 fork，`upstream` 指向原仓库；开发分支为 `codex/v0.4.0`，在 Codex 管理的独立 worktree 中实施。
- `electron/package.json` 仍使用旧所有者 `2867977208lhb-tech` 的地址；该地址查询解析至同一仓库 ID。规范化地址应作为后续独立元数据修改，本次不混入产品变更。

**推荐采用个人 fork → 功能分支 → 上游 PR。** 只需能写自己的 fork，就能向公开上游提 PR；不必先取得上游写权限。合并仍由上游维护者决定，fork 开发本身不改变上游内容。参见 [GitHub：从 fork 创建 PR](https://docs.github.com/en/pull-requests/how-tos/create-pull-requests/creating-a-pull-request-from-a-fork)。

### contributor 与 collaborator

`Contributor` 通常表示已有贡献的作者 / 统计归属，不是为了开始协作必须申请的写权限。贡献统计还取决于提交邮箱关联和提交进入的分支等规则，不能承诺 PR 合并后立刻出现标识。参见 [GitHub：贡献者统计](https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository/viewing-a-projects-contributors)。

如果将来要直接向上游推送分支，由仓库主人在 **Settings → Collaborators → Add people** 邀请你的 GitHub 账号，接受邀请后获得 collaborator 权限；无需交出账号或给予管理员权限。个人仓库 collaborator 可读写，细粒度角色是另一套组织仓库机制。参见 [邀请协作者](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository)与[个人仓库权限](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository)。

## 2. fork 开发流程

以下是可复用流程。本次 fork 和 remote 配置已完成，PR 状态以实际提交记录为准；不要重复执行 remote rename。

1. 在 GitHub 上游页面点击 **Fork**，在自己的账号下建立仓库；以后核对实际 fork URL，不凭模板推断它已经存在。
2. 对当前已克隆目录，先检查 `git status --short`、`git remote -v`，保留未提交修改。当前 `origin` 是上游；确认尚无 `upstream` 后执行下面的 remote 调整。

```powershell
git remote rename origin upstream
git remote add origin https://github.com/whitebluepants/miyo-pet.git
git remote -v
git fetch upstream
git switch -c codex/docs-v0.4.0
```

这里的 fork URL 必须已创建且账号正确；已有同名 remote / 分支时先核对并复用，不能盲目覆盖。仅调整 remote 不会丢失当前文档。创建首个文档分支后，后续功能分别使用 `codex/<topic>`。

3. 仅暂存本次相关文件，检查 diff，完成本地提交。文档阶段只提交文档；不夹带本地配置、素材、日志、构建产物。
4. `git push -u origin <branch>` 推到自己的 fork。
5. 创建 PR：**base = `286yingyin/miyo-pet:main`；head = 个人 fork 的功能分支**。标题和说明包含实际变化、验证、未覆盖环境。可以先发草稿 PR 对齐方向。
6. 维护者评审后修改同一个分支，再推送即可更新 PR。需要同步上游时，先检查工作区并 `git fetch upstream`；个人未共享分支可以 rebase，共享分支优先 merge，避免改写他人提交。
7. 上游合并后更新本地基线，再创建下一条功能分支，保持 PR 可单独评审和回退。

本次实际采用同一 `codex/v0.4.0` 分支分模块提交，当前先以 WIP 推送供朋友接手，待收尾和验收后再向上游提 PR。进度与接手顺序见 [v0.4.0 开发计划](../iterations/v0.4.0/plan.md)。没有上游写权限不阻塞本地开发或个人 fork 提交。

## 3. 文档唯一入口与职责

| 需求 / 活动 | 正式文件 | 更新时机 |
| --- | --- | --- |
| 新想法、优先级、跨版本排序 | `docs/requirements/roadmap.md` | 新增 / 推迟 / 完成需求时 |
| 一版做什么、用户如何验收 | `docs/iterations/<version>/requirements.md` | 版本评审或范围变化时 |
| 架构、数据契约、备选方案与决策 | 同目录 `design.md` | 实现前；关键决策变化时 |
| 任务、依赖、文件边界、实施检查点 | 同目录 `plan.md` | 方案稳定后；执行中勾选 |
| 测试策略、结果、证据、发布结论 | 同目录 `verification.md` | 方案阶段建立；每次验证后更新 |
| 已实现能力与实际代码结构 | 根 `README.md`、`ARCHITECTURE.md` | 对应代码实现后更新 |

同一事实不复制维护：需求 ID 指向需求池；详细行为指向该版需求；接口只在方案定义，计划引用接口；验证引用需求和任务。版本历史原地保留，`archive/` 不搬迁。

## 4. Superpowers 如何使用正式文档

Superpowers 是开发流程辅助，不另建一套项目事实：

- `brainstorming` 的 spec = 本版 `design.md`，同时引用 `requirements.md`。
- `writing-plans` 的 plan = 本版 `plan.md`。
- 执行、代码评审和验证的必要结论追加到 `verification.md` 或方案决策表，不为每次工具调用开新文件。
- 两个技能都明确允许用户保存位置覆盖默认目录，因此不创建 `docs/superpowers/` 镜像，也不使用日期前缀反复生成同题文件。
- 路径可替换，需求澄清、方案评审、计划评审和如实验收仍保留。2026-10-15 用户先要求建立文档，随后明确批准按方案开发并与子代理审查；批准来源记录在本版文档，不能单凭文件存在自动视为获批。
- 文档写中文；必要技术标识保留英文；技能要求的计划头可以保留在 `plan.md`，无需单独文件。

`docs/AGENTS.md` 固化上述规则，避免未来 AI 再次按默认路径生成重复文件。本规范不更改本机插件或安装目录，其他仓库不受影响。

## 5. 生命周期与变更规则

状态顺序：**草案 → 已评审 → 实施中 → 待验收 → 已完成**。遇到外部缺口标记“受阻”，记录缺什么证据及可继续的任务；不得伪装通过。

- 草案允许讨论和调整；已评审时记录评审日期与确认来源；不能自动替用户填写批准。
- 范围增加先改需求与影响说明，再更新方案、计划和验证，不只在代码里临时塞功能。
- 小决策在方案的决策表追加；确需独立专题才新增子目录，并补索引。
- 测试记录包含：日期、代码提交 / 未提交状态、系统 / 应用版本、命令或操作、结果、证据位置、限制。
- 未执行项写“未执行”，外部账号或设备不可用写“待实机”，不写“预计通过”冒充结果。
- 不在仓库保存真实对话、用户工作目录、token、私有日志或未经允许再分发的角色素材。
- 纯文档交付检查链接、需求覆盖和 `git diff --check`；产品改动执行 `ARCHITECTURE.md` 规定的检查，并按版本验证矩阵补实机测试。
