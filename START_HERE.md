# 星幕工坊：搬到另一台电脑继续开发

这个目录是可以独立运行的开发包。解压后保留目录结构，不需要原电脑上的其他项目目录，也不需要 Dreama CLI、REA 或原站账号。

## 在新电脑启动

1. 安装 Node.js **24 或更新版本**，在终端运行 `node --version` 确认。
2. Windows 双击 `start-local.cmd`；也可以在本目录运行 `node server.mjs`。macOS 和 Linux 在终端运行 `node server.mjs`。
3. 打开 `http://127.0.0.1:4173/homepage`。终端保持打开；按 Ctrl+C 停止。

无需 `npm install`。端口被占用时，在启动前设置 `JZZM_LOCAL_PORT` 为另一个端口。例如 PowerShell：

```powershell
$env:JZZM_LOCAL_PORT = '4180'
node server.mjs
```

第一次启动时数据为空。首次保存项目后会生成 `local-data.json`；上传文件写入 `local-upload/`。这两处属于你的个人数据，默认不在交付包内。要把原电脑的项目内容也搬过来，请另行复制这两处，并在复制前备份新电脑上的同名文件。`local-data.example.json` 是空数据结构示例。

## 继续开发

| 路径 | 作用 | 来源与可维护性 |
| --- | --- | --- |
| `server.mjs` | 本地 HTTP、静态资源、上传与 WebSocket 入口 | 本项目源码，可直接改 |
| `local-api.mjs` | 项目、剧集、分镜、素材和画布等本地 API | 本项目源码，可直接改 |
| `local-export.mjs` | 本地素材导出清单和剪辑草稿数据 | 本项目源码，可直接改 |
| `local-api-check.mjs` | 资产、剧集和分镜接口的隔离数据检查 | 本项目源码，可直接改 |
| `public-gateway.mjs` | 带密码的公网访问网关 | 本项目源码，可直接改 |
| `index.html`、`branding/`、`logo.png`、`titleIcon.svg` | 页面入口和自有品牌资源 | 本项目文件，可直接改 |
| `ai_comic/`、`resourceBucket/`、`plaza-assets/` 等 | 页面运行所需的前端发布文件、字体和图像 | 第三方压缩发布包；可检查和修改副本，但没有原始组件工程 |
| `local-data.example.json` | 空数据示例 | 本项目文件 |
| `REA_FINDINGS.md` | REA 前端证据摘要与本地实现边界 | 本项目文档 |

前端页面并非完整的 React/Vite 源码树，没有原始组件、构建配置、源映射和原站后端。`ai_comic/production/assets/` 中的脚本是压缩后的发布文件；修改它们可以改变本地页面，但维护成本较高。自行编写的代码使用本项目的 MIT 许可证；第三方文件的授权边界见 `THIRD_PARTY.md`。

开发本地业务逻辑时，修改 `local-api.mjs` 并重启服务。需要独立测试数据时，设置 `JZZM_LOCAL_DATA` 为一个**绝对路径**，例如：

```powershell
$env:JZZM_LOCAL_PORT = '4180'
$env:JZZM_LOCAL_DATA = 'C:\temp\xingmu-dev-data.json'
node server.mjs
```

上传文件始终位于本目录的 `local-upload/`，测试上传请在单独解压的一份开发包里进行。`README.md` 列出已经验证的本地操作和当前缺口；页面上能看到的按钮不代表对应的原站 AI 服务已经实现。

## 在自己的版本库继续维护

本包不含 `.git`。在解压后的目录运行 `git init` 即可建立自己的仓库；`.gitignore` 默认排除个人数据和第三方资源。如果要备份整个**私人**开发副本，另行选择合适的存储和授权方式。公开的 GitHub 仓库只含本项目自行编写的源码，不足以单独启动完整页面；这个开发包附上了运行资源。

`build-portable.ps1` 可以从完整工作目录重新打包，会拒绝覆盖已有包，并排除个人数据、凭据、测试产物和 `.git`。
