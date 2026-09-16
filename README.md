# radishtools

RadishWeb 的 Tauri 2 安卓客户端起步工程。只在本目录开发；`../radishWeb` 作为只读接口依据。

## 已核实的后端接口

依据 `../radishWeb/backend/api/*.py`、`../radishWeb/backend/api/__init__.py` 与 `../radishWeb/main.py` 的当前代码：

| 服务 | 请求 | 认证 | 数据 |
| --- | --- | --- | --- |
| 登录 | `POST /api/login/?encode_mode=0`，FormData `username,password` | 无 | `access_token,token_type,user_name,email,avatar` |
| 校验 | `POST /api/login/timeliness/` | Bearer | JSON `detail: yes/no`，无令牌也可能返回 200/no |
| 图床 | `POST /api/image-bed/list`，FormData `pages,page_size,search` | Bearer | `images[]`、`pagination` |
| 图床 | `POST /api/image-bed/upload`，FormData `file` | Bearer | `image.uuid,url,thumbnail_url` |
| 图床 | `GET /api/image-bed/thumbnail/{uuid.ext}` | 无 | 图片字节 |
| 云盘 | `GET /api/storage/list?page=1&page_size=20` | Bearer | `files[]`、`pagination` |
| 云盘 | `GET /api/storage/disk-usage` | Bearer | `used,max_storage,file_count` |
| 云盘 | `POST /api/storage/upload`，FormData `file,folder_id?` | Bearer | `file_id,filename,size` |
| 云盘 | `GET /api/storage/file/{file_id}` | Bearer | 文件字节 |
| 博客 | `GET /api/blog/explore/?page=1&page_size=10` | 无 | `blogs[]`、`pagination`，仅公开文章 |
| 博客 | `POST /api/blog/content/{file_uuid无.md后缀}.md` | 无 | Markdown 文本 |
| 博客 | `POST /api/blog/upload`，FormData `file,public_status` | Bearer | 202 `accepted`，随后异步审核 |

登录服务默认 `encode_mode=1`，要求前端按日期对凭据进行数字变换。客户端显式用 `encode_mode=0` 提交原始 FormData；该参数由后端当前函数定义直接支持。JWT 采用 HS256，`sub` 为用户名，过期时间 12 小时。图床、云盘、博客各自校验同一 Bearer token。客户端仅存储并提交令牌，不复制后端签名密钥。网络无法校验时保留当前登录数据，明确提示用户。

`/api/yun-data/data` 是运动日志数据，非云盘。`/api/review` 是旧代码审查接口且当前路由未挂载。当前后端没有启用的模型对话路由，因此对话页保持待接入状态；需要先定义后端会话、消息、模型列表及流式响应接口。

## 工程与运行

- React + TypeScript + Vite；Tauri 2 Rust 壳；Tauri HTTP 插件供移动端跨域调用。
- `npm install`，`npm run dev` 运行网页调试；`npm run build` 进行前端编译。
- 安卓需 Android SDK/NDK、`ANDROID_HOME`、Java 21、Rust Android target。安装后执行 `npx tauri android init`，再执行 `npx tauri android dev`。
- 当前机器有 Node、Rust、Java 21，但没有 Android SDK，因而未生成 Android 项目或 APK。
- 在应用首页填写实际服务器地址；网页调试还需要后端允许该开发地址跨域访问。安卓端 HTTP 插件按用户配置的服务器访问。

## 当前阶段与下一步

已完成工程壳、服务地址配置、登录/令牌校验、图床列表与上传、云盘列表/用量与上传、博客广场/原文与上传。尚未在真实后端或安卓设备上联调。后续应先完成 Android SDK 安装和设备编译，再验证上传及认证；随后接入云盘的带令牌下载、文件夹管理、博客 Markdown 渲染与分页。模型对话依赖新的后端接口，在不改动 `radishWeb` 的约束下暂时无法完成真实接入。

## GitHub Release 打包

此应用使用独立仓库 [Ashisheng2005/radishwebphone](https://github.com/Ashisheng2005/radishwebphone) 发布。推送代码后，以 `v0.0.1` 形式打版本标签；`.github/workflows/android-release.yml` 会在 GitHub 的 Ubuntu runner 安装 Android SDK/NDK、生成 Tauri Android 项目、编译 arm64 APK、签名并上传到**草稿** GitHub Release。草稿经检查后再发布给用户。`workflow_dispatch` 用于人工验证流水线。

发布前须在仓库 Actions secrets 配置 `ANDROID_KEY_BASE64`（JKS 文件的 base64）、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。签名密钥和密码不可提交到仓库；后续版本必须复用同一签名密钥，否则现有安装无法直接升级。

流程基于 Tauri 的 [Android 签名说明](https://v2.tauri.app/distribute/sign/android/)和 [tauri-action 移动构建说明](https://github.com/tauri-apps/tauri-action)。
