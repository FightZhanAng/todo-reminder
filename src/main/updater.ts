/**
 * 更新的 IO 层 —— 全项目唯一碰 `electron-updater` 的文件。
 *
 * 状态怎么变全在 `shared/update.ts`（纯函数、有测试）。这里只做三件事：
 *   1. 把 electron-updater 的事件翻译成 `UpdateEvent`
 *   2. 管自动检查的排程
 *   3. 把「现在什么状态」交给 `buildSnapshot`
 *
 * ## 为什么 `autoUpdater` 能被换掉却仍然值得分成两层
 *
 * 它是模块级单例，注入不了。但真正的问题不是「没法 mock」，而是
 * 「链路只能靠真发一个版本才能验」：真发了版、装旧版、等下载、看进度 ——
 * 一轮十几分钟，还要求网络和 GitHub 都正常。拆开之后那条链子的每一跳
 * 都是 `core-test.ts` 里的断言，这里剩下的只是「事件名对不对」。
 *
 * ## 只在打包版里启用
 *
 * `app.isPackaged === false` 时 electron-updater 找不到 `app-update.yml`
 * （那个文件由 electron-builder 在打包时写进 resources），一调就抛。
 * 开发态直接标成 `unsupported: 'dev'`，界面写「开发运行时不检查更新」——
 * 比抛一句 `Cannot find app-update.yml` 有用，而且不会在 dev 里反复弹错误。
 *
 * ## 便携版走另一条路
 *
 * 见 `shared/update.ts` 的 `isPortable`：portable 版每次运行都解压到临时目录，
 * 没有可覆盖的安装位置，electron-updater 的 Windows 实现（NSIS）够不着它。
 *
 * ## macOS 一律不支持
 *
 * electron-updater 的 mac 实现（Squirrel.Mac）只认 zip，且要求应用带
 * Developer ID 签名——没签名的包在替换 .app 那一步会被系统拒掉。
 * 项目还没有开发者账号，mac 打包版一律标 `mac-unsigned`，界面提示手动下载，
 * 别让「查得到、下得动、装不上」的三段式失败落到用户头上。
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import {
  friendlyError,
  initialUpdateState,
  sameUpdateState,
  updateReducer,
  updateUnsupportedReason,
  type UpdateEvent,
  type UpdateState
} from '../shared/update'

/**
 * 启动后隔一会儿再查第一次。
 *
 * 不是「怕被发现」，是启动那几秒本来就在抢 IO：读数据文件、建托盘、
 * 注册全局热键、同步 AUMID。再叠一个 HTTPS 请求会让「开机后第一次
 * 打开界面」明显变慢 —— 而更新结果早几十秒晚几十秒，没人在意。
 */
const FIRST_CHECK_DELAY_MS = 20_000

/**
 * 之后每 6 小时一次。
 *
 * 不查得更勤是因为没有意义：一天发不了两版，而每次检查都是一个真实的
 * HTTPS 请求（对 GitHub 也不礼貌）。这个频率够到「当天就能发现新版」。
 */
const CHECK_INTERVAL_MS = 6 * 3600_000

export interface UpdaterOptions {
  /** 状态变了。实现方负责 broadcast（同 `raiseNotice` 那条路） */
  onChange: () => void
  /**
   * 当前「自动更新」开关的值。**每次动作前现读，不缓存** ——
   * 缓存的那份会在用户关掉开关之后继续偷偷检查。
   */
  autoUpdateEnabled: () => boolean
}

/** 这一版进程能不能用自动更新。矩阵本身在 shared/update.ts（纯函数、有测试），这里只喂参数 */
function unsupportedReason() {
  return updateUnsupportedReason(process.platform, app.isPackaged, process.env)
}

export class Updater {
  private state: UpdateState
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly opts: UpdaterOptions) {
    this.state = initialUpdateState(unsupportedReason())
    if (this.state.unsupported !== null) return

    // 用户点「稍后」、甚至直接把窗口关掉之后，下次退出应用时把已下载的
    // 版本装上。托盘常驻应用可能几周都不"退出"一次，只靠界面那颗
    // 「重启并安装」会一直装不上 —— 这个默认值对它尤其合适。
    autoUpdater.autoInstallOnAppQuit = true

    this.wire()
  }

  getState(): UpdateState {
    return this.state
  }

  /** 手动检查也走这里 —— 这条路**不看**开关（开关管的是「自动」，不是「允许」） */
  async check(): Promise<void> {
    if (this.state.unsupported !== null) return
    // 每次检查前同步一次：用户可能在上一次检查之后把开关改过
    autoUpdater.autoDownload = this.opts.autoUpdateEnabled()
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      // 正常路径已经由 'error' 事件处理过（electron-updater 通常是先发事件、
      // 再让 promise reject）。这里兜住「只 reject 没发事件」的那种，
      // 重复的那次会被 apply 里的去重挡掉
      this.apply({ type: 'failed', message: friendlyError(err) })
    }
  }

  /** 只在「查到了、但没在下载」时有意义 —— 自动下载关掉时用户点的那颗按钮 */
  async download(): Promise<void> {
    if (this.state.status !== 'available') return
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.apply({ type: 'failed', message: friendlyError(err) })
    }
  }

  /**
   * 重启并安装。
   *
   * `isSilent = false`：让 NSIS 把安装界面显示出来 —— 一个通常躲在托盘里的
   * 应用忽然自己重启，屏幕上却什么都不出现，那才吓人。
   * `isForceRunAfter = true`：装完自动把应用拉起来，否则用户会以为它没了。
   */
  install(): void {
    if (this.state.status !== 'ready') return
    autoUpdater.quitAndInstall(false, true)
  }

  /**
   * 按当前开关对齐排程。开关关掉时把已经排上的也取消掉。
   *
   * 开关变化走 `settings:patch` → `afterCommand` → 这里，和 theme /
   * alwaysOnTop / launchAtLogin 是同一条路（见 main/index.ts）。漏掉这一步的
   * 症状很隐蔽：关掉开关后**这一次**不查了，但已经排上的那个定时器还在。
   */
  syncSchedule(): void {
    if (this.state.unsupported !== null) return
    this.stop()
    if (!this.opts.autoUpdateEnabled()) return

    this.timer = setTimeout(() => {
      void this.check()
      this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
      this.timer.unref()
    }, FIRST_CHECK_DELAY_MS)
    // 别让定时器吊住进程退出：这是个托盘常驻应用，`app.quit()` 之后
    // Node 还等一个 6 小时后的回调，进程就永远退不掉
    this.timer.unref()
  }

  stop(): void {
    if (this.timer === null) return
    // 同一个 handle 上 clearTimeout / clearInterval 都可以用（Node 内部
    // 是同一套），而这里两种都可能装着东西，所以两个都调
    clearTimeout(this.timer)
    clearInterval(this.timer)
    this.timer = null
  }

  /** 事件名 → UpdateEvent。这一层就是全部「翻译」成本 */
  private wire(): void {
    autoUpdater.on('checking-for-update', () => this.apply({ type: 'check-started' }))
    autoUpdater.on('update-available', (info) =>
      this.apply({ type: 'available', version: info.version })
    )
    autoUpdater.on('update-not-available', () => this.apply({ type: 'not-available' }))
    autoUpdater.on('download-progress', (p) => this.apply({ type: 'progress', percent: p.percent }))
    autoUpdater.on('update-downloaded', (info) =>
      this.apply({ type: 'downloaded', version: info.version })
    )
    autoUpdater.on('error', (err) => this.apply({ type: 'failed', message: friendlyError(err) }))
  }

  /**
   * 状态没变就不广播。
   *
   * 同一次失败会从两条路走到 `failed`（见 `check()` 的 catch），
   * 没有这道闸界面会白刷两遍 —— 而其中一遍还会把进度条从 42% 弹回 0%。
   */
  private apply(event: UpdateEvent): void {
    const next = updateReducer(this.state, event, Date.now())
    if (sameUpdateState(next, this.state)) return
    this.state = next
    this.opts.onChange()
  }
}
