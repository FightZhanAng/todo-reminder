/**
 * 更新状态机 —— **纯函数、无 IO**。
 *
 * 为什么把「状态怎么变」和「怎么调 electron-updater」拆开：
 * `autoUpdater` 是模块级单例，既没法注入、也没法在无头环境里造事件，
 * 于是「检查中 → 有新版 → 下载 42% → 可以重启了」这条链子会变成一段
 * 只能靠**真发一个版本**才能验的代码。拆出来之后，链子上每一跳都是
 * `core-test.ts` 里的一行断言。
 *
 * `src/main/updater.ts` 因此只剩一件事：把 electron-updater 的事件
 * 翻译成这里的 `UpdateEvent`，再把新状态广播出去。
 */

/**
 * 更新状态。**不落盘** —— 重启即重置，和 `pausedUntil` 同类。
 *
 * 它记的是「这一版进程此刻认到的事」，写进数据文件只会在下次启动时
 * 带来一个必然是过期的值。
 */
export interface UpdateState {
  status: UpdateStatus
  /** 查到 / 下好的版本号；没有就是 null */
  version: string | null
  /** 下载进度 0-100；不在下载就是 null */
  percent: number | null
  /** 出错时的一句话（给人看的，不是堆栈） */
  error: string | null
  /** 上次检查**结束**的时间戳；从没查完过是 null。`checking` 期间不动它 */
  checkedAt: number | null
  /**
   * 为什么用不了自动更新。null = 能用。
   *
   * 单开一个字段而不是塞进 `status`：界面上「便携版请手动下载」和
   * 「还没检查过」是两种完全不同的处境 —— 前者该给下载页按钮、
   * 后者该给检查按钮，混在一个枚举里每次用都得再判一次。
   */
  unsupported: UnsupportedReason
}

export type UnsupportedReason = 'portable' | 'dev' | 'mac-unsigned' | null

export type UpdateStatus =
  /** 还没查过 */
  | 'idle'
  | 'checking'
  /** 查到了，等下载（自动下载打开时会被下面那个状态直接顶掉） */
  | 'available'
  | 'downloading'
  /** 下好了，等重启 */
  | 'ready'
  | 'up-to-date'
  | 'error'

export type UpdateEvent =
  | { type: 'check-started' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'failed'; message: string }

export function initialUpdateState(unsupported: UnsupportedReason = null): UpdateState {
  return { status: 'idle', version: null, percent: null, error: null, checkedAt: null, unsupported }
}

/**
 * 进度取整并夹进 0-100。
 *
 * electron-updater 的 `progress.percent` 在刚接到响应头那一下会给 `-1`
 * （总大小还不知道），直接把 `-1` 画进进度条会得到一个越界的宽度。
 */
export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, Math.round(percent)))
}

/**
 * 状态转移。
 *
 * `now` 从外面传进来而不是这里取 —— 这个文件里不出现 `Date.now()`，
 * 否则「检查完有没有记上时间」就得靠等时钟走一格来验。
 */
export function updateReducer(state: UpdateState, event: UpdateEvent, now: number): UpdateState {
  switch (event.type) {
    case 'check-started':
      // 开新一轮：上一次的错和进度都作废，但**版本号留着** ——
      // 「下到一半重新检查」时进度条归零是对的，版本号闪一下没有道理，
      // 而且下面 `friendlyError` 拼文案时还要用它
      return { ...state, status: 'checking', percent: null, error: null }

    case 'available':
      // 检查到此结束，所以这里要记时间（`checking` 期间不记，避免
      // 界面把「刚开始查」显示成「刚查完」）
      return {
        ...state,
        status: 'available',
        version: event.version,
        percent: null,
        error: null,
        checkedAt: now
      }

    case 'not-available':
      return {
        ...state,
        status: 'up-to-date',
        version: null,
        percent: null,
        error: null,
        checkedAt: now
      }

    case 'progress':
      return { ...state, status: 'downloading', percent: clampPercent(event.percent) }

    case 'downloaded':
      // 100 而不是保留上一次的 percent：`download-progress` 的最后一跳
      // 不一定正好是 100（实测常常停在 99.x），而这时候进度条已经没有意义了
      return { ...state, status: 'ready', version: event.version, percent: 100, error: null, checkedAt: now }

    case 'failed':
      return { ...state, status: 'error', percent: null, error: event.message, checkedAt: now }
  }
}

/**
 * 两个状态是不是「看起来一样」。
 *
 * 用途只有一个：`Updater` 在广播前拿它挡掉重复推送。
 * `checkForUpdates()` 失败时会**同时** reject 和发 `error` 事件，
 * 两条路都会走到同一个 `failed` —— 有了这个判断，界面就只收到一次。
 *
 * 逐字段比而不是 `JSON.stringify`：字段顺序变了就不会误判成不同。
 */
export function sameUpdateState(a: UpdateState, b: UpdateState): boolean {
  return (
    a.status === b.status &&
    a.version === b.version &&
    a.percent === b.percent &&
    a.error === b.error &&
    a.checkedAt === b.checkedAt &&
    a.unsupported === b.unsupported
  )
}

/**
 * 是不是便携版。
 *
 * 判据是 electron-builder 的 portable target 注入的 `PORTABLE_EXECUTABLE_DIR` /
 * `PORTABLE_EXECUTABLE_FILE`，**不是 exe 路径**：用户可能把 setup 装到 D 盘、
 * 也可能把 portable exe 丢在任何地方，路径推不出来这件事。
 *
 * 便携版**不能自动更新**：它每次运行都把自身解压到一个临时目录再启动，
 * 没有「安装位置」可供下一版覆盖。这是 electron-updater 的限制
 * （它支持的 Windows 目标是 NSIS），不是配置问题。
 *
 * 参数是 `env` 而不是直接读 `process.env` —— 这样才测得了。
 */
export function isPortable(env: Record<string, string | undefined>): boolean {
  const dir = env.PORTABLE_EXECUTABLE_DIR
  return typeof dir === 'string' && dir !== ''
}

/**
 * 这一版进程用不用得了自动更新。null = 能用。
 *
 * 抽成纯函数是因为「在哪一天不能用」是个平台 × 打包方式的矩阵，
 * 而 main/updater.ts 拿着它没法无头测试 —— 矩阵本身该是断言。
 *
 * macOS 这条要单独说：electron-updater 的 mac 实现（Squirrel.Mac）要求
 * 应用**必须带 Developer ID 签名**才肯装更新 —— 没签名的包会在替换
 * .app 那一步被系统拒掉。本项目还没有 Apple 开发者账号，CI 打出的
 * mac 包一律是 ad-hoc 签名，所以 mac 上**一律标不支持**，让用户走
 * 手动下载，而不是「查得到、下得动、装不上」。哪天真买了账号、
 * CI 配上 `CSC_LINK`，把这条改成运行时检测签名再放行。
 */
export function updateUnsupportedReason(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  env: Record<string, string | undefined>
): UnsupportedReason {
  if (!isPackaged) return 'dev'
  if (platform === 'darwin') return 'mac-unsigned'
  if (isPortable(env)) return 'portable'
  return null
}

/**
 * 把 electron-updater 抛出来的错误压成一句人话。
 *
 * 它的 `err.message` 经常是一整段带堆栈和 HTTP 细节的文本，直接显示在
 * 设置页里会挤满好几行、而且看不出该做什么。这里只认几种**用户能据以行动**
 * 的成因，其余截断第一行兜底 —— 兜底也要保留原文，不然排查时线索没了。
 */
export function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const oneLine = raw.split('\n')[0]?.trim() ?? ''
  // 更新源上压根没找到版本清单：Release 是 draft、忘了传 latest.yml、
  // 或者 tag 和 package.json 的版本对不上，都会落在这里
  if (/404|not found|cannot find latest|no published versions/i.test(raw)) {
    return '更新源上没有找到版本信息（Release 可能还是草稿，或者漏传了 latest.yml）'
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|net::/i.test(raw)) {
    return '连不上更新服务器'
  }
  if (/sha512|checksum|integrity/i.test(raw)) {
    return '下载到的安装包校验不一致，稍后再试'
  }
  return oneLine === '' ? '未知原因' : oneLine.slice(0, 120)
}

/**
 * 安装包下载改道用的国内镜像前缀（实测 2026-11-06：直连 GitHub release
 * 资源只有 25–30 KB/s，同一台机器走这个镜像单路 409 KB/s、四路 2.19 MB/s）。
 *
 * 这类镜像是社区公益站，**随时可能停**，所以它只能当加速尝试、不能当唯一通路
 * —— 这也是下面 `mirrorReleaseUrl` 只认安装包、且 main 那边挂不上就
 * 原样走 GitHub 的原因。
 */
export const RELEASE_MIRROR = 'https://ghfast.top/'

/**
 * 安装包本身的 URL 形状：GitHub release 下、以安装产物扩展名结尾的那一个。
 *
 * 两处都是刻意的窄：
 * - 必须匹配**完整路径**，不能用 `includes('/releases/download/')` —— 镜像站的
 *   URL 形状就是 `https://ghfast.top/https://github.com/...`，用 includes 会把
 *   已经改道过的 URL 再套一层，变成前缀套娃。
 * - 只认安装产物扩展名，**不认 `.yml` / `.atom` / `.blockmap`**：版本清单必须
 *   继续来自 GitHub，这样 sha512 是官方那份，改道不降低完整性保证。
 */
const GITHUB_INSTALLER_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+\.(exe|zip|dmg)$/i

/**
 * 把 GitHub 安装包的下载 URL 换成走镜像的等价 URL。不是那个形状就原样返回。
 *
 * **只管安装包，别扩到 latest.yml / releases.atom**：这类镜像对
 * `releases.atom` 直接回 403（实测），把发现请求一起改道会让「检查更新」整个坏掉
 * —— 而那比慢 45 分钟严重得多。安装包的 sha512 由 GitHub 上的 latest.yml 校验，
 * 装完还会由 electron-updater 复核，所以这一跳换源不降低完整性保证。
 *
 * `https://` 是硬条件：明文 http 的包会被镜像当路径处理，改道过去是个 404。
 */
export function mirrorReleaseUrl(url: string, mirror: string = RELEASE_MIRROR): string {
  return GITHUB_INSTALLER_URL.test(url) ? `${mirror}${url}` : url
}

/**
 * 连续失败几次就放弃镜像。
 *
 * 取 2 而不是 1：差分下载会发**多个** Range 请求，一次抖动就记一笔，
 * 一次就撤会让「时好时坏」的镜像完全用不上。也不取更大 —— 镜像真停时
 * 每个请求都要先撞穿一次超时才轮到直连，用户等到的是两倍时长。
 */
const MIRROR_GIVE_UP_AFTER = 2

/**
 * 本次进程还要不要把安装包改道到镜像。
 *
 * 存在的理由只有一个：镜像是第三方公益站，**它挂了不能让自动更新跟着挂**。
 * main 那边数失败次数，到阈值就退回慢但能用的直连。只在本次进程内生效 ——
 * 下次启动重新给镜像一次机会，不必把「今天挂了」写进磁盘永久生效。
 */
export function shouldUseMirror(failures: number): boolean {
  return failures < MIRROR_GIVE_UP_AFTER
}

/**
 * 状态 → 一句话。界面只调它，别在 JSX 里现写 if 链 ——
 * 那样每加一个状态就得到处补一处，漏掉的那个分支会静默显示成空白。
 */
export function updateSummary(state: UpdateState): string {
  if (state.unsupported === 'portable') return '便携版每次运行都在临时目录里，装不了新版本，请手动下载'
  if (state.unsupported === 'dev') return '开发运行时不检查更新'
  if (state.unsupported === 'mac-unsigned') return 'macOS 版未签名，自动更新用不了，请手动下载新版本'
  switch (state.status) {
    case 'idle':
      return '还没检查过'
    case 'checking':
      return '正在检查…'
    case 'available':
      return `发现新版本 ${state.version ?? ''}`
    case 'downloading':
      return `正在下载 ${state.percent ?? 0}%`
    case 'ready':
      return `新版本 ${state.version ?? ''} 已下载好，重启后生效`
    case 'up-to-date':
      return '已是最新版本'
    case 'error':
      return `检查更新失败：${state.error ?? '未知原因'}`
  }
}
