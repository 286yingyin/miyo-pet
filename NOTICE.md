# NOTICE — 版权分层声明

本仓库采用**三层许可结构**，各部分彼此独立：

## 1. 程序代码 —— MIT License

`electron\`、`scripts\`、`prototype\v1\*.html`、`prototype\v2\*.html` 等全部源码
依 [LICENSE](LICENSE)（MIT）授权，Copyright (c) 2026 miyo-pet contributors。

## 2. 游戏素材 —— © NEXON Games 及官方所有

以下文件为《蔚蓝档案》（Blue Archive）游戏素材或其派生物，**不属于本仓库的 MIT
授权范围**：

- `prototype\v1\assets\spr\`（半身差分 40 张）
- `prototype\v2\assets\full\`、`prototype\v2\assets\full_low\`（全身立绘 41 张及低清副本）
- `prototype\voices\`（游戏语音 ogg）
- `electron\icon.png`、`electron\icon.ico`（派生图标）
- `packs\` 下用户自行放置的差分包

> 素材版权归 NEXON Games 及官方所有，仅供个人使用，请勿用于商业目的。

《蔚蓝档案》是 NEXON Games 的商标/作品，本仓库与其官方无任何关联。
仓库默认仅随附上述素材中「美代」角色的部分；如需完整体验，请参考 README 的
素材说明自行获取并放置。若你是版权方并认为仓库内容不妥，请提 Issue 联系删除。

## 3. 第三方运行时 —— Spine Runtimes License

`prototype\v2\spine-webgl.js` 是 Esoteric Software 的 Spine 4.2 官方运行时，
依 [Spine Runtimes License](https://esotericsoftware.com/spine-runtimes-license)
单独授权（该许可证不允许再分发 Spine 运行时的修改版等限制），
同样不属于本仓库的 MIT 授权范围。
