这一版只改一条路：安装包的下载。原来直连 GitHub release，慢到不可用。

## 更新

- **安装包改走国内镜像下载**。实测 95 MB 的包直连 GitHub release 只有 25–30 KB/s（四十多分钟），同一台机器走镜像 1.9 MB/s。检查更新、版本号、sha512 仍然来自 GitHub，只把「下载这个 exe」那一跳改道，装上的包照样按官方 sha512 复核。
- **清单一律不动**：`latest.yml`、`releases.atom`、`api.github.com` 与差分块表都还是直连 GitHub。镜像是社区公益站，对 `.atom` 直接回 403 —— 把版本发现一起换源会让「检查更新」整个坏掉，那比慢几十分钟严重。
- **镜像挂了不影响更新**：连续两次失败就摘掉改道、退回直连，慢但能用；只在这一版进程里生效，下次启动重新给镜像一次机会。
- 想彻底关掉或换一家：环境变量 `TODO_UPDATE_MIRROR=off` 关掉，或填一个自己的镜像前缀。

## 两个容易误判的现象

- **开着「GitHub 代理」也可能一点没帮上**。这类工具靠 hosts + 本地反代，只覆盖 `github.com` 那几个域名；release 下载 302 跳到的 `release-assets.githubusercontent.com` 不在名单里，一字节都不过代理。判断依据是进程实际连的那个 IP，不是代理开没开。
- **差分下载偶尔会静默变成全量**：更新器缓存里那个当差分基准的 `installer.exe` 本身可能不完整（实测比官方资产多 81 字节、sha512 对不上），于是退回全量下载。症状是「明明只跨一个小版本却要下整包」，与这次改道无关。

## 开发

- 改道的判据收在 `shared/update.ts`（纯函数）：只认 `https://github.com/<org>/<repo>/releases/download/<tag>/<file>.exe|zip|dmg` 这个完整形状，所以已经改道过的 URL 不会再套一层前缀，`latest.yml` / `*.blockmap` / `releases.atom` 也不会被误伤。
- 主进程那边用 `webRequest.onBeforeRequest` 拦**安装包那一跳**，不是 `setFeedURL` 换 provider —— 后者会让更新清单也跟着来自镜像。
- 新增 15 条断言钉「什么该改、什么绝不能改」；`pnpm typecheck` 干净，`pnpm test:core` 943 项、`pnpm smoke` 全过。
