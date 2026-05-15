# npm Dev Server with Hot Reload and Local Upload

**Date:** 2026-05-15
**Status:** Approved (pending written-spec review)
**Branch:** test

## 背景

`my-shop` 是一个纯静态站点（`index.html`、`admin.html`、`products.json`、`images/`），目前的工作流是：

- 用 `python -m http.server 8002` 起本地服务器
- 手机扫局域网 IP（例如 `http://192.168.1.2:8002/index.html`）预览
- `admin.html` 通过 GitHub API（个人 Token）把图片 PUT 到 `images/`、把 products.json 提交回仓库

痛点：

1. **每换一台电脑、换一次 Wi-Fi，LAN IP 都不同**，需要手动改 `AGENTS.md` 里的预览链接。
2. **改完代码要手动刷浏览器**，调样式、调交互的反馈很慢。
3. 调试时也要走 GitHub API 上传/保存，依赖网络与 Token，且会污染主仓库历史。

目标：一条 `npm run dev` 解决以上三点，并且不破坏当前 GitHub 模式（部署后的 `admin.html` 行为不变）。

## 目标与非目标

### 目标

- 任意电脑上 `npm install && npm run dev` 即可启动开发服务器
- 启动时自动选空闲端口（从 8002 起），自动取 LAN IPv4，打印 URL 与二维码
- 修改 `*.html` / `*.css` / `*.js` / `products.json` 时浏览器整页自动刷新
- 提供 `/api/upload` 与 `/api/save-products` 两个本地接口；`admin.html` 自动检测，本地通就走本地，否则维持 GitHub 流程
- 本地保存成功后，仅在 `test` 分支自动 `git add / commit / push`（commit message 用固定模板）
- 主分支或其他分支保存时本地照常生效但跳过自动同步，并在终端提示

### 非目标

- 不引入打包器（无 ESM/JSX/TS），不引入 Vite、webpack
- 不实现细粒度 HMR；整页刷新已足够
- 不实现用户认证或多用户协作
- 不重写 admin.html 的现有 GitHub 上传逻辑——只在它前面加"本地优先"分支
- 不提供后台运行 / `npm stop`；前台 + Ctrl+C

## 架构与文件结构

```
my-shop/
├── package.json              ← 新增：scripts.dev、scripts.test、devDependencies
├── package-lock.json         ← 新增（提交）
├── .gitignore                ← 新增（含 node_modules/）
├── scripts/
│   └── dev-server.js         ← 启动入口：装配 browser-sync + 中间件
├── server/
│   ├── routes.js             ← /api/health、/api/upload、/api/save-products
│   ├── git-sync.js           ← 封装 git add/commit/push（队列串行化）
│   └── net.js                ← 端口探测、LAN IP 选取
├── admin.html                ← 修改：上传/保存前 health check
├── index.html                ← 不变
├── products.json             ← 不变
├── images/                   ← 现有目录，本地上传写到这里
└── tests/
    ├── image-interactions.test.js   ← 现有
    └── dev-server.test.js           ← 新增：node:test
```

`server/` 拆出来便于单独测试；`scripts/dev-server.js` 只做装配。

### 依赖

`devDependencies`：

- `browser-sync` —— 静态托管 + 文件监听 + 整页刷新
- `qrcode-terminal` —— 在终端打印二维码

无运行时依赖；HTTP、文件、子进程全用 Node 内置（`http`、`fs/promises`、`child_process`、`os`、`net`）。

## 启动流程

`npm run dev` → `node scripts/dev-server.js` 顺序：

1. **环境检查**：未安装依赖时提示 `npm install`。
2. **找端口**：`server/net.js` 从 `process.env.PORT || 8002` 开始往上探测第一个空闲端口；探到 8050 仍无可用就报错退出，提示 `PORT=9000 npm run dev` 手动指定。
3. **取 LAN IP**：`os.networkInterfaces()` 过滤 internal、IPv6，并跳过 VMware / WSL / Tailscale 等虚拟网卡（按网卡名包含 `vEthernet`、`VMware`、`Tailscale` 黑名单 + IP 段优先级 `192.168.` > `10.` > `172.`），取第一个匹配项。
4. **启动 browser-sync**：根目录为 cwd，files 监听见下表，logLevel `info`，open=false，notify=false。
5. **挂载中间件**：`/api/*` 走 `server/routes.js`，其余请求交还 browser-sync 静态服务。
6. **打印启动信息**：见下方样式。
7. **注册 SIGINT**：Ctrl+C → 关闭 browser-sync、关闭 HTTP listener、退出 0。

### 启动信息样式

```
─────────────────────────────────────
 my-shop dev server
─────────────────────────────────────
 Local:    http://localhost:8002
 LAN:      http://192.168.1.2:8002
 Branch:   test  (auto-sync ON)

 [二维码]

 Press Ctrl+C to stop
─────────────────────────────────────
```

非 test 分支时第三行变为 `Branch: main  (auto-sync OFF — switch to test)`，二维码仍打印 LAN URL。

## 文件监听规则

| 路径 | 行为 |
|---|---|
| `*.html`、`*.css`、`*.js`、`products.json` | 整页刷新 |
| `images/**` | 不刷新（避免上传瞬间页面跳动，浏览器拉新图自然生效） |
| `node_modules/**`、`.git/**`、`docs/**`、`tests/**` | 不监听 |

## 接口约定

均挂在与静态服务同一端口下，路径前缀 `/api`，统一返回 JSON。

### `GET /api/health`

健康检查，admin.html 启动时探测一次。

- 响应：`200 { "ok": true, "mode": "local", "branch": "test", "autoSync": true }`
- 超时建议：客户端 1s

### `POST /api/upload`

上传图片到 `./images/`。

- Content-Type：`multipart/form-data`
- 字段：`file`（必填）
- 限制：仅接受 `image/*`，单文件 ≤ 10MB
- 文件名生成：`<时间戳>-<6位随机>.<原扩展名>`，避免冲突
- 写入成功后触发 git 同步（仅 test 分支）：commit message 模板 `chore(dev): add image <filename>`
- 响应：`200 { "url": "images/<filename>" }`
- 错误：`400 { "error": "not an image" | "too large" }`、`500 { "error": "..." }`

### `POST /api/save-products`

覆盖保存整份 products 数据。

- Content-Type：`application/json`
- Body：products 数组（与现有 products.json 结构一致；不做 schema 校验，由 admin.html 保证结构）
- 行为：原子写入 `products.json`（先写 `.tmp` 再 rename），写完触发 git 同步（仅 test 分支）：commit message 模板 `chore(dev): update products via dev server`
- 响应：`200 { "ok": true, "synced": true|false }`（synced 反映 git push 是否成功）
- 错误：`400 { "error": "invalid json" }`、`500 { "error": "..." }`

## 上传 / 保存的本地 vs GitHub 切换

`admin.html` 改动遵循"加分支不改主流程"：

1. 页面加载时执行一次 `fetch('/api/health', { signal: AbortSignal.timeout(1000) })`：
   - 成功 → `window.__SHOP_MODE__ = 'local'`
   - 失败 → `window.__SHOP_MODE__ = 'github'`（默认值）
2. 现有 `uploadImageToGitHub(blob, ...)` 调用点改为：
   ```js
   const url = window.__SHOP_MODE__ === 'local'
     ? await uploadImageToLocal(blob)
     : await uploadImageToGitHub(blob, ...);
   ```
3. 现有 products.json 提交点同理：本地模式 `POST /api/save-products`，否则走原 GitHub commit 流程。
4. UI 上在 admin 页面顶部加一个小标签 `local mode` / `github mode`，方便确认当前走哪条路径。

部署到 GitHub Pages 时 `/api/health` 必然失败，逻辑回退到现有行为，行为完全等价于今天。

## Git 同步策略

`server/git-sync.js`：

1. 启动时读 `git rev-parse --abbrev-ref HEAD`，缓存当前分支；非 test 分支直接将 `enabled` 设为 false，所有同步调用变为 no-op + 终端 warn（每次只 warn 一次，避免刷屏）。
2. 同步只 `git add` 显式路径：`products.json`、`images/<具体文件名>`，**不执行 `git add .`**。
3. `git commit -m "<模板>"`；commit 失败（无变更等）忽略。
4. `git push origin test`；失败仅打印警告，不阻塞接口响应。
5. **并发串行化**：用内存 promise 队列，所有同步调用串行执行，避免 `.git/index.lock` 冲突。
6. 不读写 git config，不 force push，不动 hook。

## 错误处理表

| 场景 | 处理 |
|---|---|
| 8002–8050 全占 | 退出，提示 `PORT=9000 npm run dev` |
| `/api/upload` 非图片或 >10MB | 400，不写文件 |
| `/api/save-products` 非合法 JSON | 400，不写文件 |
| 写文件失败（权限/磁盘） | 500，不触发 git |
| `git push` 失败（无网/冲突/认证） | 本地写入仍成功；终端 warn；接口响应 `synced: false` |
| 同时多次保存 | git 队列串行；接口立即返回 |
| 缺 devDependencies | `dev` 脚本前置检查 `node_modules/browser-sync` 是否存在，缺则提示 `npm install` |

## 测试

新增 `tests/dev-server.test.js`，使用 Node 内置 `node:test` + `node:assert`，不引入 jest。

覆盖：

- `server/net.js`：能从给定起点找到下一个空闲端口；过滤虚拟网卡能选到正确 IP（用注入的网卡列表）
- `server/routes.js`：`/api/health` 返回结构正确
- `server/routes.js`：`/api/upload` 写入临时目录并返回正确 URL；非图片返回 400
- `server/routes.js`：`/api/save-products` 写入临时文件后能读回相同内容；非法 JSON 返回 400
- `server/git-sync.js`：非 test 分支时 enable=false，调用为 no-op；test 分支下用注入的 mock spawn 验证只 add 指定路径

`package.json` 加 `"test": "node --test tests/"`。

## .gitignore

```
node_modules/
*.log
.DS_Store
```

## 部署影响

- GitHub Pages 行为不变：仅多了 `package.json` 与 `scripts/`、`server/` 目录的源码，对静态托管无影响。
- `admin.html` 在线版调 `/api/health` 返回 404，1s 超时后回落 GitHub 模式，与现状一致；多一次 HEAD-equivalent 请求可忽略。

## AGENTS.md 调整

启动方式改为 `npm run dev`，不再硬编码 LAN IP。`AGENTS.md` 后续更新交给实现阶段。

## 后续 / 非本次范围

- 后台运行 / `npm stop` / 日志分文件
- 多用户/远程团队协作
- products.json schema 校验
- HTTPS / 局域网证书
