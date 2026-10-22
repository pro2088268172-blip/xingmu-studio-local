# REA 前端证据与本地实现边界

分析对象是原站公开发布的前端脚本，不包含服务端源码。REA 6.7.0 的完整分析记录保存在开发机器的 `jzzm-rea-analysis/`；本文摘录了继续开发本地站最相关的结论。

| 前端静态观察 | 证据 | 本地处理 |
| --- | --- | --- |
| `material-CJB4LEBA.js` 声明资产创建、列表、改名、子素材编辑／删除、隐藏、收藏及主形象调用。 | `ev_e711e47d9d28517769c989ddc523a273fffa6b88a9463a8d868166fc7f7098f3`，该次选入 `material-CJB4LEBA.js` 等 9 个业务脚本。 | `local-api.mjs` 保存本地图片与音频资产；`local-api-check.mjs` 验证持久化。 |
| `index-CB4bi7Oy.js` 的分镜创作模式切换提交 `seriesId`、`storyBoardId`、`produceType`；剧集精细模式提交 `detailedCount`。 | `ev_17982baa5a0ebb5ebee12493a95a20ec43acd41ea7481bd687a5de0e1`，单文件定向分析。 | 保存分镜模式和剧集标记。 |
| `create-BxYumHha.js` 声明 `historyList` 和 `switchMaterial`；后者接收 `seriesId`、`storyBoardId`、`storyBoardHistoryId`、`type`。 | `ev_e711e47d9d28517769c989ddc523a273fffa6b88a9463a8d868166fc7f7098f3`。 | 手工上传的新图片／视频生成本地历史快照，可切回旧素材。 |
| `index-CB4bi7Oy.js` 从个人资产库导入项目时调用 `importParentResources`，传入 `projectId` 和 `parentResources`。 | `ev_17982baa5a0ebb5ebee12493a95a20ec43acd41ea7481bd687a5de0e1`。 | 本地后端从已保存的个人资产复制图片到项目素材库，供 `@` 引用。 |
| `index-CB4bi7Oy.js` 从另一项目导入素材时传 `importProjectId`、`newProjectId`、`projectLibraryIds`；项目历史按类型、剧集、收藏和搜索词查询。 | `ev_17982baa5a0ebb5ebee12493a95a20ec43acd41ea7481bd687a5de0e1`。 | 本地素材可跨项目复制；手工保存的图片／视频进入可筛选的项目历史。 |
| `projectDeletion-CtrPd1C1.js` 对项目素材同步先查冲突，使用 `merge` 或 `overwrite` 决定如何写入个人资产库；`index-CB4bi7Oy.js` 提交勾选的 `imageIds`。 | 全量静态分析 `ev_806781451eaf59825b9f82b4befa9a31db7b3bb751ba3794e856d0420a6dd70c`；该图部分覆盖。 | 本地按资产名称与图片文件地址判断冲突，并仅同步选中的图片；不推断原站服务端的冲突算法。 |
| `index-CB4bi7Oy.js` 的历史侧栏按 `seriesId` 调用 `historyList`。 | 发布脚本中 `fve` 调用链的静态核对。 | 本地历史接口支持按剧集读取已有分镜素材历史。 |
| `create-BxYumHha.js` 的 `libraryList` 接收 `projectId` 和 `type`；`index-CB4bi7Oy.js` 的素材工作台读取响应中的 `characters`。 | 发布脚本中 `fetchMaterialList` 调用链的静态核对。 | 本地返回已保存的项目素材及图片地址。 |
| `create-BxYumHha.js` 的 `libraryHistoryList` 接收 `projectId`、`type`、`libraryId`；`switchLibraryHistory` 接收 `projectId`、`libraryId`、`libraryHistoryId`。 | 发布脚本中素材历史面板调用链的静态核对。 | 本地记录已上传图片的旧版本，并可切回旧图。 |

这些是静态发布包中的调用线索，不能证明原站的响应格式、权限、运行顺序或生成算法。REA 对 189 个可达脚本做过整体清点，成功解析 188 个；语义图达到容量上限，标记为部分覆盖。完整分析 Evidence ID 为 `ev_806781451eaf59825b9f82b4befa9a31db7b3bb751ba3794e856d0420a6dd70c`。

本地站使用自己的数据结构和确定性逻辑。AI 图片、视频、语音、分集推理、积分结算、多人协作与正式成片仍需要独立服务和真实验收。运行页面中出现的入口不能当作已实现证明。
