# 文档维护规则

本规则适用于 `docs/` 下所有内容。改产品代码前仍须阅读根目录 `ARCHITECTURE.md`。

1. 先读 `docs/README.md` 和目标版本的现有文档，修改既有文件，不按会话重复创建。
2. 需求统一登记在 `requirements/roadmap.md`，使用稳定的 `REQ-*` ID；某版的具体行为和验收写入 `iterations/<version>/requirements.md`。
3. Superpowers brainstorming 的规格直接写入该版 `design.md`；writing-plans 的计划直接写入该版 `plan.md`。这是用户指定的保存位置，覆盖技能的默认路径；不要另建 `docs/superpowers/specs/` 或 `docs/superpowers/plans/` 副本。
4. 测试策略、用例、运行结果和发布判定放在该版 `verification.md`，区分计划与实测；证据写明日期、提交、环境、命令、结果和限制。
5. 不把待实现能力写进当前功能说明。方案有实质变化时先同步需求、方案、计划、验证四者，不在临时文件里建立第二套事实。
6. 不将聊天记录、工具输出全文、机器绝对路径、账号凭据或真实 Agent 对话放进公开文档。测试夹具用合成数据；大日志和截图仅保留必要且脱敏的引用。
7. `archive/` 为历史资料，不重命名、不重排、不用旧结论覆盖当前设计；完成的版本文档原地保留。
8. 只有独立子项目确需单独评审时才在版本目录下增设文档，并立即补索引。小决策记在 `design.md`，小验证记在 `verification.md`。
9. 文档修改后检查相对链接、需求与用例覆盖、状态真实性及 `git diff --check`；纯文档修改无需启动桌宠或重复执行产品测试。

具体协作流程见 [workflow.md](contributing/workflow.md)。
