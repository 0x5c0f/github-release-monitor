# github-release-monitor

面向第三方仓库的 GitHub Release 监听与中文总结应用。  
默认通过 **Vercel Cron 轮询**（不是 webhook）获取新版本并生成摘要。

## 功能概览

1. 轮询第三方仓库（如 `openclaw/openclaw`）的最新 Release。
2. 对 release notes 自动执行中文翻译与中文总结。
3. 支持首页查看“最新发布”与按 `tag` 查询指定版本。
4. 使用 Vercel Blob 做轻量持久化，仅保留最近 `N` 条。
5. 首页密码登录 + API 同密码鉴权（可用 header/cookie）。
6. 可选保留 webhook 接口（仅适用于你有权限配置 webhook 的仓库）。

## 技术栈

1. Next.js 16（App Router, TypeScript）
2. Tailwind CSS 4
3. Vercel Blob（private）
4. GitHub REST API（轮询）
5. OpenAI SDK

## 核心模式说明

### 第三方仓库模式（推荐）

使用 `WATCH_REPOS` 配置要监听的第三方仓库列表，Vercel Cron 定时调用 `/api/cron/poll-releases`：

1. 拉取各仓库最新 release。
2. 如果是新版本，调用 AI 翻译 + 总结。
3. 写入 Blob 并更新最新指针。

### webhook 模式（可选）

如果你对某个仓库有管理员权限，也可以配置 `/api/webhook/github`。  
但第三方仓库通常无法配置 webhook，因此不是主流程。

## 本地开发

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env.local
```

3. 启动开发服务

```bash
npm run dev
```

4. 访问 `http://localhost:3000`

## Vercel 部署步骤（轮询模式）

1. 推送代码到 Git 平台并在 Vercel 导入项目。
2. 配置环境变量（见下文，最少要有 `OPENAI_API_KEY`、`BLOB_READ_WRITE_TOKEN`、`WATCH_REPOS`、`CRON_AUTH_TOKEN`、`APP_LOGIN_PASSWORD`）。
3. 确认仓库根目录有 `vercel.json`（本项目已提供），其中定义 cron：
   - `*/10 * * * *` 调用 `/api/cron/poll-releases`
4. 首次可手动触发一次轮询验证：
   - `GET /api/cron/poll-releases`（带 `Authorization: Bearer <CRON_AUTH_TOKEN>`）

## 环境变量说明

| 变量名 | 必填 | 说明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 是 | OpenAI 兼容 API 密钥 |
| `OPENAI_MODEL` | 否 | 模型名，默认 `gpt-4.1-mini` |
| `OPENAI_BASE_URL` | 否 | 兼容代理/网关地址 |
| `BLOB_READ_WRITE_TOKEN` | 是 | Vercel Blob 读写 token |
| `WATCH_REPOS` | 是 | 轮询仓库列表，逗号分隔，如 `openclaw/openclaw,vercel/next.js` |
| `POLL_INCLUDE_PRERELEASE` | 否 | 轮询时是否包含预发布版本，默认 `false` |
| `CRON_AUTH_TOKEN` | 是 | `/api/cron/poll-releases` 鉴权 token |
| `APP_LOGIN_PASSWORD` | 是 | 首页登录与 release API 鉴权密码 |
| `APP_SESSION_TTL_SECONDS` | 否 | 登录会话时长（秒），默认 `86400` |
| `DEFAULT_REPO` | 否 | 首页默认仓库（未传 repo 参数时使用） |
| `RETENTION_COUNT` | 否 | Blob 保留条数，默认 `5` |
| `ALLOWED_REPOS` | 否 | release 查询白名单，逗号分隔 |
| `DEFAULT_INCLUDE_PRERELEASE` | 否 | 默认查询是否包含预发布，默认 `false` |
| `GITHUB_TOKEN` | 否 | 提升 GitHub API 限额（建议配置） |
| `REVALIDATE_TOKEN` | 否 | `POST /api/releases/revalidate` 的二次保护 token |
| `GITHUB_WEBHOOK_SECRET` | 否 | 仅 webhook 模式使用 |

## 环境变量配置方式

### 方式 1：Vercel 控制台（推荐）

1. 打开 `Vercel -> Project -> Settings -> Environment Variables`。
2. 逐项添加上表变量。
3. 若只用第三方轮询模式，可不配置 `GITHUB_WEBHOOK_SECRET`。

### 方式 2：Vercel CLI

```bash
cd /path/to/github-release-monitor

vercel env add OPENAI_API_KEY production --scope 51ac
vercel env add OPENAI_MODEL production --scope 51ac
vercel env add BLOB_READ_WRITE_TOKEN production --scope 51ac
vercel env add WATCH_REPOS production --scope 51ac
vercel env add CRON_AUTH_TOKEN production --scope 51ac
vercel env add APP_LOGIN_PASSWORD production --scope 51ac
```

## API 列表

1. `GET /api/cron/poll-releases`
   - Cron 轮询入口。
   - 鉴权：`Authorization: Bearer <CRON_AUTH_TOKEN>` 或 `x-cron-token`。

2. `GET /api/releases/latest?repo=owner/name&includePrerelease=false`
   - 查询最新发布摘要。
   - 需登录或携带 `x-app-password: <APP_LOGIN_PASSWORD>`。

3. `GET /api/releases/by-tag?repo=owner/name&tag=v1.2.3`
   - 查询指定 tag 摘要。
   - 需登录或携带 `x-app-password: <APP_LOGIN_PASSWORD>`。

4. `POST /api/releases/revalidate`
   - 手动刷新缓存（可选 `x-revalidate-token`）。
   - 需登录或携带 `x-app-password: <APP_LOGIN_PASSWORD>`。

5. `POST /api/webhook/github`（可选）
   - webhook 模式入口（非第三方主流程）。

## 存储策略

使用 Vercel Blob（`private`）存储摘要：

1. `releases/{owner}/{repo}/versions/{safe_tag}.json`
2. `releases/{owner}/{repo}/latest.json`
3. `releases/{owner}/{repo}/latest-stable.json`

保留策略：

1. 按 `published_at` 倒序保留最近 `RETENTION_COUNT` 条。
2. 同时间按 `release_id` 倒序。
3. 再兜底按 Blob `uploadedAt`。

## 项目结构

```text
src/
  app/
    api/
      auth/
        login/route.ts
        logout/route.ts
      cron/
        poll-releases/route.ts
      releases/
        latest/route.ts
        by-tag/route.ts
        revalidate/route.ts
      webhook/
        github/route.ts
    layout.tsx
    page.tsx
    globals.css
  components/
    login-gate.tsx
    logout-button.tsx
    release-monitor.tsx
  lib/
    shared.ts
    schemas.ts
    types.ts
    server/
      auth.ts
      blob-store.ts
      env.ts
      errors.ts
      github.ts
      release-service.ts
      summarizer.ts
      webhook.ts
vercel.json
```

## 常用脚本

```bash
npm run dev
npm run lint
npm run build
npm run start
```
