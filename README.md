# dsh-workbuddy-dashboard

把 **WorkBuddy 网关面板**（`workbuddy2api-hub`）的数据看板搬进 **DeepSeek Harness**：右下角一块可拖拽的悬浮面板，外加三个给模型用的 `workbuddy_*` 工具。

> A DeepSeek Harness plugin that renders the WorkBuddy gateway dashboard as a floating panel and exposes the same numbers to the agent as tools.
> Zero build step, zero runtime dependencies, no writes outside the gateway's read-only panel API.

![在 DeepSeek Harness 中的悬浮看板](docs/preview-in-dsh.png)

## 特性

- **悬浮面板**（右上角，可拖拽 / 折叠 / 关闭 / 换统计区间）：KPI 卡片、Token 时序、最近请求、账号额度、排程状态，深色玻璃质感，跟随 5–10s 轮询刷新。
- **18 个 KPI 指标可选**：tokens、请求数、生成速度、缓存命中、花费、成功率、prompt/completion/reasoning/cached tokens、TTFT、耗时、峰值吞吐、推理占比、错误数、额度、美元花费、就绪账号……默认展示 6 个。
- **4 个面板可开关**：Token 时序 / 最近请求 / 账号 / 排程，与 KPI 卡片一样按配置裁剪。
- **三个模型工具**：`workbuddy_status`、`workbuddy_recent`、`workbuddy_accounts`，让 agent 直接回答“今天跑了多少 token / 最近哪几条失败 / 哪个号快没额度了”。
- **只读、无凭据外泄**：仅访问 `/health`、`/panel/login`、`/usage/*`、`/accounts`、`/scheduler`；不读取、不记录 `key`、`key_name`、`msgs_sha`、`system_sha`、`prefix_sha`、`cost_policy` 等敏感字段。
- **零构建纯 ESM**：`lib/*.js` 直接就是运行时代码，方便审阅 diff；对 `@deepseek-ai/*` 的依赖全部走可选 `peerDependencies`，缺失时自动降级。

## 安装

前提：本机已经跑着 WorkBuddy 便携版网关（默认 `http://127.0.0.1:8788`，面板密码 `admin`），并且已装 DeepSeek Harness（`dsh` 命令可用，版本 ≥ `0.2.0-rc.2`）。

### 方式 A：pnpm link 到现有 profile（推荐）

```powershell
# 在插件仓库根目录执行；profile 名换成你自己的（web / tui / …）
dsh plugin --profile web add "link:$PWD"

# 把插件加进该 profile 的 bundle 列表（一次性）
# 编辑 $env:DSH_HOME\profiles\web\package.json，在 dsh.profile.bundles 末尾加：
#   "dsh-workbuddy-dashboard"
```

然后重启 harness：

```powershell
dsh --profile web
```

重启后右下/右上角出现面板，模型也会看到 `workbuddy_*` 工具。

### 方式 B：手工链接（不跑 pnpm）

```powershell
$plugin = "E:\path\to\dsh-workbuddy-dashboard"
$profile = "$env:DSH_HOME\profiles\web"
New-Item -ItemType Directory -Force "$profile\node_modules" | Out-Null
cmd /c mklink /J "$profile\node_modules\dsh-workbuddy-dashboard" "$plugin"
```

再把 `"dsh-workbuddy-dashboard"` 追加到 `$profile\package.json` 的 `dsh.profile.bundles`，重启即可。

### 卸载

```powershell
dsh plugin --profile web remove dsh-workbuddy-dashboard
# 或删掉 package.json 里 bundles 的那一行 / 删掉 junction
```

面板与工具都是纯增量注入，卸载后重启即恢复原样。

## 配置

设置页（Settings → Plugins → dsh-workbuddy-dashboard）或 profile 的 `cordis.patch.yml` 均可改：

```yaml
- id: dsh-workbuddy-dashboard
  config:
    baseUrl: http://127.0.0.1:8788
    password: admin
    range: today
    refreshMs: 10000
    cards: [tokens, requests, speed, cache, cost, success]
    panels: [trend, recent, accounts, scheduler]
    showPanel: true
    panelOpen: true
    opacity: 0.94
```

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8788` | WorkBuddy 网关地址 |
| `password` | `admin` | 面板口令，仅用于换 `X-Panel-Token`，不落盘、不写日志 |
| `range` | `today` | 默认区间：`today` / `d3` / `week` / `month` / `d30` / `all` |
| `refreshMs` | `10000` | 轮询间隔，范围 3000–300000 |
| `cards` | 6 个默认卡 | KPI 指标 id 列表，见下方“指标库” |
| `panels` | 四个全开 | 面板 id：`trend` / `recent` / `accounts` / `scheduler` |
| `showPanel` | `true` | 关掉后只保留路由与工具，不向页面注入面板 |
| `panelOpen` | `true` | 面板初始展开 / 折叠 |
| `opacity` | `0.94` | 面板背景不透明度（0.5–1），文字始终不透明 |
| `trustedHosts` | `[]` | 额外允许访问插件路由的 Host（默认只信任回环地址） |

### 指标库（`cards` 可用 id）

`tokens` `requests` `speed` `cache` `cost` `success` `prompt_tokens` `completion_tokens` `reasoning_tokens` `cached_tokens` `ttft` `elapsed` `peak_throughput` `reasoning_ratio` `errors` `credit` `cost_usd` `accounts_ready`

## 模型工具

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `workbuddy_status` | `range?` | 一行式摘要：区间、请求数、tokens、花费、缓存命中、速度、成功率、账号就绪、排程下次执行 |
| `workbuddy_recent` | `limit?`（1–20，默认 8） | 最近请求列表：时间、模型、结果、tokens、耗时、速度 |
| `workbuddy_accounts` | `limit?`（1–20，默认 8） | 账号列表：昵称、区域、就绪/冷却/停用、剩余额度 |

示例：

```text
> 今天网关跑了多少？哪个号快没额度了？
（agent 自动调用 workbuddy_status + workbuddy_accounts）
```

## HTTP 路由

插件在 harness 的同一个端口上挂了 4 条只读路由，供面板自身调用：

| 路由 | 说明 |
| --- | --- |
| `GET /workbuddy/api/snapshot?range=&force=` | 面板数据快照（KPI、趋势、最近、账号、排程） |
| `GET /workbuddy/api/health` | 缓存状态、网关可达性、最近一次错误 |
| `GET /workbuddy/api/config` | 面板需要的公开配置（不含口令） |
| `GET /workbuddy/panel.js` | 面板前端 bundle |

**安全边界**：所有路由先过 `lib/guard.js` —— Host 必须是回环地址或在 `trustedHosts` 白名单、`Sec-Fetch-Site: cross-site/same-site` 一律拒绝、带 `Origin` 时要求与 Host 同源；判定异常时按 **拒绝** 处理（fail-closed）。

## 开发

```powershell
npm test              # 单元 + 插件契约测试（29 项，无网络）
npm run test:live     # 真实网关 smoke（网关不在线时自动 skip）
npm run harness       # 本地验证页 http://127.0.0.1:4010/ ，连真实网关
npm run harness:demo  # 同上，但用脱敏 fixtures，适合截图/演示
```

目录：

```
lib/index.js      宿主插件：路由、注入、缓存、工具
lib/gateway.js    网关客户端：登录、401 重登、超时、区间换算
lib/snapshot.js   KPI 目录与快照裁剪（面板与工具共用）
lib/format.js     数字/耗时/金额格式化（对齐桌面看板口径）
lib/guard.js      路由安全栅栏
assets/panel.js   注入到页面的悬浮面板（shadow DOM，无框架）
tests/*.test.mjs  node:test 用例 + 脱敏 fixtures
scripts/          抓 fixture / 本地 harness / 截图工具
```

截图工具（可选，需要本机 Edge）：

```powershell
node scripts/screenshot.mjs "http://127.0.0.1:3091/?token=…" docs/preview-in-dsh.png --wait 10000 --size 1440x900
```

## 与桌面看板的关系

同仓库出身的 Windows 桌面悬浮看板（`workbuddy-dashboard-widget`）是 PowerShell + WPF 的独立进程；本插件是它的“浏览器内版本”——相同的 KPI 目录、相同的格式化口径、相同的区间语义，方便两边数字对得上。

## 版本记录

- **0.1.0** — 首个版本：悬浮面板（KPI / 趋势 / 最近 / 账号 / 排程）、18 指标 + 4 面板可配置、3 个 `workbuddy_*` 工具、4 条只读路由 + 安全栅栏、单元/契约/真实网关测试、脱敏 fixtures 与本地 harness。

## 许可

MIT
