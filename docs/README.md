# 项目文档

当前已实现的功能看根目录 [README](../README.md)，现有代码结构和修改约定看 [ARCHITECTURE](../ARCHITECTURE.md)。本目录管理后续需求、设计、实施计划和验证记录；规划不代表功能已经实现。

## 阅读入口

| 文档 | 用途 |
| --- | --- |
| [完整需求池与版本路线](requirements/roadmap.md) | 收齐需求、记录优先级、版本候选与验收方向 |
| [v0.4.0 需求](iterations/v0.4.0/requirements.md) | 第一版的范围、明确排除项、交付标准 |
| [v0.4.0 技术方案](iterations/v0.4.0/design.md) | 模块边界、数据契约、兼容与迁移、技术风险 |
| [v0.4.0 开发计划](iterations/v0.4.0/plan.md) | 分阶段实施、依赖、检查点与建议 PR 划分 |
| [v0.4.0 测试与验证](iterations/v0.4.0/verification.md) | 基线证据、测试矩阵、待执行的验收及发布结论 |
| [协作与文档规范](contributing/workflow.md) | fork / PR 流程、权限说明、Superpowers 文档落位 |

## 目录约定

```text
docs/
  README.md                     文档索引
  AGENTS.md                     AI 文档维护规则
  requirements/roadmap.md        跨版本需求池，需求 ID 唯一真源
  iterations/<version>/
    requirements.md             该版需求和验收标准
    design.md                   该版技术方案，兼作 Superpowers spec
    plan.md                     该版开发计划，兼作 Superpowers plan
    verification.md             该版测试方案、执行记录和发布判定
  contributing/workflow.md      通用协作、文档生命周期
  archive/                      0.2.x → 0.3.x 历史资料，保持原位
  img/                          README 等公开说明图片
```

第一版规划暂称 **v0.4.0**；当前应用仍为 **0.3.23**，本次不修改应用版本号。版本号在与上游确定发布安排后可调整，并同步修改索引和交叉链接。

## 文档状态

- 需求池中的需求已收录；版本归属除第一版已选范围外均为建议。
- v0.4.0 文档于 2026-10-15 建立，方案和计划为**待评审草案**，尚未开始功能开发。
- `verification.md` 明确区分已执行的现状调研与未来的功能验收，不能把测试计划当作通过记录。
- 方案、计划直接在上述正式文件维护；不再为 Superpowers、会话或每次小修改生成重复文档。完整规则见[协作与文档规范](contributing/workflow.md)。
