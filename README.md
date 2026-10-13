# lifeRecorder

将文档、图片、视频、音频、现场录音和文字记录按日期时间归档到本地 Git 仓库，并在配置 remote 后推送至 GitHub。

## 功能

- 同一条记录可包含文字、文档、多张图片、多个视频、多个音频和现场录音
- IndexedDB 浏览器本地持久化，Git 归档失败时内容仍保留在浏览器
- 时间轴按类型、日期筛选，并支持单项详情、连续翻页和手机滑动
- 本地归档路径：`records/YYYY/MM/DD/HH-mm-ss-<记录ID>/`
- 每条记录包含 `record.json`、`content.md` 和分类媒体目录
- 发布后自动执行 `git add`、`git commit`；存在 remote 时继续执行 `git push`

## 启动

本地 Git 归档需要通过 Node 服务运行：

```bash
npm start
```

访问 `http://127.0.0.1:8080/`。请勿再使用简单静态 HTTP 服务，否则 `/api/records` 不存在，无法写入 Git 仓库。

## 配置 GitHub

当前目录需要先初始化 Git 身份并配置 GitHub remote：

```bash
git config user.name "你的名字"
git config user.email "你的邮箱"
git remote add origin git@github.com:<账号>/<仓库>.git
git branch -M main
git push -u origin main
```

也可以使用 HTTPS remote，并通过系统凭据管理器或 GitHub CLI 登录。不要把 Token、密码或私钥写入项目文件。

配置完成后，发布页面保持勾选“保存到本地 Git 仓库并推送 GitHub”。归档会按记录的本地日期和时分秒创建目录。若未配置 remote，记录仍会写入并提交到本地 Git，但页面会提示尚未推送。

## 注意

- 单次归档请求默认限制为 250MB。
- GitHub 普通仓库单文件通常不适合大型视频；大文件建议配置 Git LFS。
- 服务仅监听 `127.0.0.1`，归档写入范围限制在项目的 `records/` 目录。
