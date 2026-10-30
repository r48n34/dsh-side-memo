# 侧边便签（Side Memo）

![侧边便签——随时记录，伴你工作](assets/side-memo-banner.png)

**语言：** [English](README.md) · **简体中文** · [繁體中文](README.zh-TW.md)

![侧边便签面板打开时的截图：右侧边栏中可搜索的便签与标签](assets/plugin0_0_1_screenshot.jpg)

一个轻量、可开关的 **右侧便签面板**，为 [DeepSeek Harness](https://deepseek.com/harness) 打造。聊天时随手记下内容——文字、内嵌图片和标签——一键复制，收藏常用便签让它始终置顶，还能把所有便签整体导入或导出为 Excel 工作簿。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Version](https://img.shields.io/badge/version-1.1.0-4D6BFE)
[![npm](https://img.shields.io/npm/v/dsh-side-memo?label=npm&color=4D6BFE)](https://www.npmjs.com/package/dsh-side-memo)
[![CI](https://github.com/r48n34/dsh-side-memo/actions/workflows/ci.yml/badge.svg)](https://github.com/r48n34/dsh-side-memo/actions/workflows/ci.yml)
![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-4D6BFE)
![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Desktop-lightgrey)

**分类：** 界面与体验

## 安装

`dsh-side-memo` 已[发布到 npm](https://www.npmjs.com/package/dsh-side-memo)。通过你的 DSH 配置（profile）安装：

```bash
dsh plugin --profile web add dsh-side-memo
```

也可以直接从本仓库安装——当需要的提交尚未发布到 npm，或无法访问 npm 时，使用 GitHub 形式：

```bash
dsh plugin --profile web add github:r48n34/dsh-side-memo
```

如果你的 DSH 运行的是 Desktop 配置（profile），请使用 **设置 → 插件** 中显示的配置名（Desktop 应用通常是 `desktop`）：

```bash
dsh plugin --profile desktop add dsh-side-memo
```

安装后，**侧边便签** 图标就已经在会话标题栏上——位于标题栏右端，包括还没有任何会话时（首屏）以及新会话欢迎页。可以从这里打开它，也可以从会话标题栏右侧的功能区，或右侧边栏的添加/引导控件打开。如果没有看到图标，请重启一次 DSH，让新的插件包完成加载。

要移除它，请在 DSH 的 **设置 → 插件** 中操作（或使用与你的配置对应的 `dsh plugin` 命令）。

## 功能

- **便签面板** —— 通过标题栏开关打开；有会话时显示在右侧边栏，没有会话时显示浮动抽屉。
- **编辑与收藏** —— 自动保存便签；收藏置顶，其余按更新时间排序。编辑器可直接新建便签，并复用空白草稿；删除需二次确认。
- **内嵌图片** —— 粘贴、插入或拖放图片；图片缩小后保存在本地，可在编辑器中移除。
- **标签与搜索** —— 搜索标题、正文和标签；可按多个标签同时筛选或按标签分组。每条便签最多 12 个标签，每个最多 24 个字符，重复标签不区分大小写。
- **快速复制** —— 复制正文，正文为空时复制标题；只有图片的便签复制第一张图片。
- **拖入聊天框** —— 把列表中的便签直接拖到聊天输入框上，正文会粘贴到正在编辑的消息里。
- **Excel 导入 / 导出** —— 导出全部便签到 `.xlsx`，或追加导入便签，不覆盖现有内容。图片本身不会导出，`Images` 列仅记录数量。
- **本地保存** —— 便签和图片引用存于浏览器的 `localStorage`，图片数据存于 IndexedDB；刷新后保留，并在会话间共享。

## 使用方法

1. 点击标题栏右端的 **侧边便签** 图标。没有会话时打开浮动抽屉，可按 `Esc` 或点击关闭按钮收起；建立会话后便签会移至右侧边栏。
2. 点击 **新建**，输入标题和正文，编辑会自动保存。编辑器顶栏也可直接新建便签。粘贴、拖放图片或使用图片按钮添加图片；悬停图片并点击 **×** 可移除。
3. 在 **添加标签…** 中输入标签，按 `Enter`、输入 `,` 或点击别处提交；点击标签的 **×** 可移除。列表支持搜索、标签筛选和分组；多选标签时仅显示包含全部所选标签的便签，**全部标签** 可清除筛选。
4. 点击便签编辑，用星标收藏或复制图标复制。工具栏可导出全部便签到 `side-memo-YYYY-MM-DD.xlsx`，或追加导入首个工作表；标题和正文均为空的行会跳过，文件上限为 8 MB。
5. 写消息时可以直接把便签从列表拖到聊天输入框：正文会插入到当前光标位置，便签中的图片不会随文字一起粘贴。
6. 再次点击标题栏图标或使用侧边栏收起控件，隐藏面板。

## 兼容性

- DeepSeek Harness **0.2.x**（在 **0.2.1-rc.3**、Desktop 配置下开发和测试）。
- Web GUI 与 Desktop（Electron/Chromium）。客户端部分只依赖标准浏览器 API：`localStorage`、IndexedDB、Clipboard、File API、`Blob`/`URL`、Canvas，以及用于读取压缩 `.xlsx` 文件的 `DecompressionStream('deflate-raw')`。
- 使用内置的右侧边栏插件 API（`@deepseek-ai/dsh-client-ui-sidebar-right`）；面板是标准的右侧边栏标签页，因此需要一个会话来承载它。在任何会话出现之前，同一套便签界面由插件自己在框架级覆盖层（`shell.overlay`）中渲染。在会话建立前和新会话阶段，开关通过常驻标题栏的 `conversation.header.leading` 位置挂载，并根据实时的标题栏/面板开关几何信息把自己定位到标题栏右端。
- 使用会话客户端的输入框插入 API（`inputActions`）把拖入的便签作为一次可撤销的编辑写入聊天草稿。
- TypeScript 源码位于 `src/`；`client.js` 与 `index.js` 是由源码编译并提交到仓库的浏览器/宿主模块，因此安装或运行插件都不需要构建步骤。

## 权限与隐私

- **不访问网络**，也不使用任何外部服务。
- **不访问宿主数据**，不提供面向智能体的工具。宿主部分只有一个空的 `apply()`。
- 便签和图片只保存在当前浏览器中（便签存于 `localStorage` 的 `dsh.side-memo.notes.v1` 键，图片数据存于 `dsh-side-memo-images` 这个 IndexedDB 数据库）；不加密，也不会跨设备同步。
- 只有在你点击复制时才会写入剪贴板。
- Excel 文件通过浏览器的文件选择器/下载在你的电脑上读写——绝不会被上传。

## 已知限制

- 仅支持浏览器本地存储：不支持跨设备或跨浏览器同步。
- 没有会话时，便签会在插件自带的浮动抽屉中打开（右侧边栏本身是会话级的）；抽屉和右侧边栏标签页是同一套便签的不同宿主。
- 拖入聊天框需要已建立会话且输入框可编辑；只会粘贴便签的纯文本，图片和标签不会随文字一起粘贴。
- 文本是纯文本（不支持 Markdown 或富文本格式）；图片是唯一的富内容。图片在保存前会被缩小，也不会导出到 Excel——`Images` 列只记录数量。
- 图片功能依赖 IndexedDB 和 Canvas。如果浏览器禁用了 IndexedDB，文字便签仍可正常使用，但插入图片会被禁用。
- Excel 导入只读取第一个工作表；公式按其缓存值导入，富文本单元格格式会被忽略。
- 上限：300 条便签、标题 120 字符、正文 8,000 字符、每条便签 12 个标签（每个 24 字符）、每条便签 20 张图片（单张源图片不超过 24 MB，保存前会缩小到最长边 1,400 像素、质量 0.82）、`.xlsx` 文件 8 MB（解压后总量不超过 32 MB，压缩包内最多 64 个条目），以及浏览器图片总量 60 MB。
- 标签是扁平标签——不支持层级、按标签着色或独立的标签管理器——而且每个标签都按便签单独存储，所以重命名一个标签意味着要编辑所有带有它的便签。
- 收藏只是固定在便签列表内；目前还没有单独的“仅收藏”视图。

## 开发

TypeScript 源码位于 `src/`，仅用 TypeScript 编译器（不含打包器）编译为提交在仓库中的 `client.js` 与 `index.js`：

| 文件 | 作用 |
|---|---|
| `package.json` | Bundle/客户端清单（`dsh.bundle` 补丁与 `dsh.client` 浏览器模块） |
| `cordis.patch.yml` | 插入 `dsh-side-memo` 的 Loader 行 |
| `index.js` | 宿主部分（空的 `apply`；由 `src/host/index.ts` 生成） |
| `client.js` | 便签面板、标签页类型、始终可用的标题栏开关、会话前抽屉、localStorage + IndexedDB 存储、内嵌图片编辑器、标签筛选/分组、编辑器顶栏新建按钮、拖入聊天框粘贴、`.xlsx` 导入/导出（由 `src/client/` 生成） |
| `src/` | 两部分的 TypeScript 源码 |
| `tsconfig.json`、`scripts/build.mjs` | 类型检查配置与 `yarn build` 脚本 |
| `locale/en.json`、`locale/zh.json` | 插件管理器的标题和描述 |
| `icon.svg` | 插件图标 |

可以用 DSH 插件管理器（对本目录调用 `install_bundle`）把它加载到某个配置中，或用 [安装](#安装) 中的命令安装。包内容仅限上表列出的运行时文件——源码与构建脚本不会进入发布包，npm tarball 只是在这些运行时资源之外附带三个 README 和 LICENSE。

### 测试

- 单元测试：`yarn test` 会先重新构建（`pretest`），再用 Node.js 内置的 `node --test` 运行（需要 Node.js **>=22**）。首次运行请执行一次 `yarn install` 安装构建工具链——开发依赖仅有 `typescript` 与 `@types/react`，发布的包本身没有依赖——测试会直接调用编译后的 `client.js` 中的真实辅助函数。
- 浏览器端到端测试（可选，仅开发使用，不包含在 `yarn test` 中）：参见 [`test/e2e/README.md`](test/e2e/README.md)，了解隔离配置下的测试环境与运行方式。
- CI 在每次 push 和 pull request 时运行单元测试：[`.github/workflows/ci.yml`](.github/workflows/ci.yml)。

## 许可证

[MIT](LICENSE) © 2026 Reemo Studio
