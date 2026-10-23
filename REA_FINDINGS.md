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
| `InfiniteCanvas-RJ5ItsbU.js` 移动画布时提交 `spaceType`、`targetFolderId`、`projectIds`；卡片打开按钮读取 `capabilities.canRead`，移动菜单读取 `canMoveInCurrentSpace`。 | 发布脚本中画布文件夹对话框及卡片调用链的静态核对。 | 本地补齐能力字段，校验个人文件夹并持久化画布所在文件夹。 |
| `ThreeDDirector-1ow1W1Rw.js` 创建导演台提交 `projectId`、`name`、`configJson`、`remark`；`ThreeDDirector-C2n2LSUQ.js` 按 ID 读取并保存配置。 | 两个发布脚本的定向静态核对。 | 本地保存导演台配置；俯视图和生成任务不在此实现。 |
| `AiComicCanvas-DafGQ4uD.js` 的自定义图片预设提交 `name`、`prefixPrompt`、`suffixPrompt`、`location: 110`，列表按 `presetType: 0` 查询；UI 将 `type: 99` 识别为自定义项，空列表时不显示预设菜单。 | 发布脚本中预设编辑器调用链的静态核对。 | 本地保存用户预设，首次启动提供一条可删除的示例预设以打开菜单。 |
| `index-CB4bi7Oy.js` 在自由模式上传文稿后调用 `editNewFreeProject` 保存 `id`、`scriptUrl`、`scriptName`，然后进入要素推理。 | 发布脚本中上传对话框调用链的静态核对。 | 本地保存文稿元数据；推理服务仍未接入。 |
| `project-laJ0o51V.js` 声明 `jsonBySeriesId` 和 `scriptJsonBySeriesId` 两种导出接口；剧本工作台中的已上传图片按 URL 字符串渲染。 | 发布脚本中的接口封装与剧本工作台调用链静态核对；媒体类型由本地浏览器错误与修复后渲染佐证。 | 本地根据已上传的分镜媒体生成素材清单和草稿数据，统一分镜媒体 URL 格式。 |
| `VoiceSelectorModal-87KAS23k.js` 在“本地音频上传”后调用 `createMine`，提交 `name` 和 `voiceUrl`；选择器从 `listMine` 读取自定义音色，上传控件允许 MP3／WAV／AAC／M4A。 | 发布脚本中音色选择器调用链的静态核对，本地浏览器观察了 WAV 上传与保存。 | 本地保存音频地址与音色名称，支持四种扩展名和媒体响应；AAC／M4A 未逐格式验证浏览器解码，不代表语音生成可用。 |

这些是静态发布包中的调用线索，不能证明原站的响应格式、权限、运行顺序或生成算法。REA 对 189 个可达脚本做过整体清点，成功解析 188 个；语义图达到容量上限，标记为部分覆盖。完整分析 Evidence ID 为 `ev_806781451eaf59825b9f82b4befa9a31db7b3bb751ba3794e856d0420a6dd70c`。

本地隔离浏览器另外验证了画布卡片打开和移动后刷新回显、自定义图片预设的创建／更新／删除、从分镜创建导演台及改色后刷新回显，以及 AI 实验室的 WAV 上传到“我的自定义音色”列表。剧本工作台的“一键导出”实际调用 `jsonBySeriesId` 并下载 ZIP，包内图片 SHA-256 与源文件一致，草稿 JSON 可解析；`scriptJsonBySeriesId` 仅经隔离 API 检查。这些运行记录只证明本地站行为，不代表原站服务端采用相同数据结构或导出算法。

2026-10-23 对项目素材历史做了定向复核。REA 再次读取原版 `create-BxYumHha.js` 的接口封装，父 Evidence ID 为 `ev_f671854c1db0434e88721c485f50f3ce29d7279b276810d07da6a7dcb025570c`；另对原版 `index-CB4bi7Oy.js` 做单文件分析，父 Evidence ID 为 `ev_2ee9f74362ba525a5e1729e3221d5deaf4de8338990702c5c840c9cb0f6cb77c`。两次都仅选了 1 个文件，应用图与语义覆盖为部分覆盖。REA 受控浏览器对隔离本地工作台的初始页面抓取 Evidence ID 为 `ev_31fb4a9b39cf50328050adc3e469d029fab2fe8620fff157f828d48a73baf0ba`；证据导出在开发机器的 `jzzm-rea-analysis/evidence-history-ui-20261023.json`。这些 Evidence 不包含原站登录后的实际操作。

随后在隔离数据的本地浏览器中，点击角色卡片“编辑”→“角色历史记录”，实际请求携带的是形象 ID（示例 `libraryId: 1004`），而本地接口之前只按素材组 ID 查询（示例 `1003`），所以旧图被误报为“暂无历史记录”。已使历史查询和切换同时识别素材组 ID 与形象 ID，并将形象入口限定到所属形象。页面现在列出当前图和旧图；选择旧图并点击“选用该版本”后，请求提交该形象 ID 与历史 ID，刷新页面仍显示旧图。隔离浏览器还验证了空角色库中的跨项目一键导入和刷新回显，以及“项目生成历史”弹窗的图片显示、收藏与“仅看收藏”筛选。弹窗读项目历史，素材库侧栏的“历史库”读当前剧集分镜历史，两处可能显示不同数量。本地运行验收不能证明原站服务端的数据格式或算法与此相同。

同一隔离数据还为分镜保存了两个本地图片版本。浏览器中“分镜历史”显示两张卡片；点击旧图提交 `switchMaterial`，包含分镜 ID、剧集 ID、历史 ID 和图片类型。本地接口回读显示分镜 `imageList` 已切为旧图；刷新页面后仍能读取。REA 对该点击的额外受控采集未完成，故此项运行结论仅依据隔离浏览器点击和本地 API 回读。

随后 REA 对原版 `index-CB4bi7Oy.js` 与 `create-BxYumHha.js` 做了定向静态解析，父 Evidence ID 为 `ev_e053f1fd12e406dbc7c093e3f0c6222fd23d121a165d4f0bd3aabe97b7c7e527`；只选了两份业务脚本，应用图仍为部分覆盖。脚本中的多形象卡片展开先检查协作锁；本地没有加入原站协作房间时，该检查拦住展开。分镜历史卡片初始仅挂载占位框，等待 `IntersectionObserver` 报告可见。本地受控浏览器复现了两种阻断。`patch-local-frontend.mjs` 对本地发布脚本副本做两处精确替换，并在不匹配时停止；关闭素材卡片的协作锁依赖，让分镜历史卡片立即挂载。REA 浏览器场景工具本轮未完成采集，因此这两处运行结论来自隔离浏览器操作与页面 DOM，未记录为 REA 受控运行 Evidence。

隔离浏览器完整验收了角色编辑页：改名、描述和形象信息经 `updateProjectLibrary` 保存并在刷新后回显。新增形象上传有效尺寸图片时，页面提交的形象没有 ID，并带绝对 `127.0.0.1:4175` 图片地址；原本地 API 原样保存会使后续操作和跨端口使用失败。现为新形象分配 ID、规范化本地图片及参考图地址，并校验形象归属。页面保存后刷新显示新形象，确认主形象提交 `setMainImage`，确认删除提交 `deleteProjectLibraryImage`，再次刷新仍回显正确。保存现有形象时，原版表单要求生成提示词；“本集素材”筛选下新增形象按钮禁用。这是页面现有交互，不能据此推断原站服务端实现。

隔离数据还生成两个合法 H.264 MP4 并保存为同一分镜的视频历史。修复历史卡片挂载后，页面显示四张图片／视频历史卡片；点击旧视频提交 `switchMaterial`，请求包含 `seriesId`、`storyBoardId`、`storyBoardHistoryId` 与 `type: 2`。刷新后播放器加载所选视频，`readyState=4`，播放时间推进。本地历史逻辑和媒体服务经此验证；原站视频生成、其他历史字段及服务端算法仍未知。

本地站使用自己的数据结构和确定性逻辑。AI 图片、视频、语音、分集推理、积分结算、多人协作与正式成片仍需要独立服务和真实验收。运行页面中出现的入口不能当作已实现证明。
