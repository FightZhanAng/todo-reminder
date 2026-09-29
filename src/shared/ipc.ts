import type { Command } from './commands'
import type { Anniversary, Settings, Task } from './types'
import type { UpdateState } from './update'

/**
 * IPC 通道名。**所有通道都从这里取，别处不许硬编码字符串** ——
 * 手打通道名是那种错了不会报错、只会「事件收不到」的 bug。
 */
export const IPC = {
  /** renderer → main：读一份快照 */
  get: 'todo:get',
  /** renderer → main：执行一条命令，返回执行后的快照 */
  command: 'todo:command',
  /** renderer → main：暂停 / 恢复提醒（运行时不落盘，所以不是 Command） */
  pause: 'todo:pause',
  /** main → renderer：广播快照 */
  snapshot: 'todo:snapshot',
  /** main → renderer：把某条任务滚进视野并高亮 */
  focusTask: 'todo:focus-task',
  /** main → renderer：切到某个视图（托盘菜单用） */
  openView: 'todo:open-view',
  /** renderer → main：窗口与进程级动作 */
  window: 'todo:window',
  /** 快速添加窗 → main：提交一条草稿后关窗 */
  quickAdd: 'todo:quickadd',
  /** 快速添加窗 → main：取消 */
  quickAddCancel: 'todo:quickadd-cancel',
  /** renderer → main：改全局快捷键。**先试注册，成功才写设置** */
  setHotkey: 'todo:set-hotkey',
  /** renderer → main：关掉某类提示（本次运行内不再显示） */
  dismissNotice: 'todo:dismiss-notice',
  /** renderer → main：手动查一次更新。立即返回，结果走快照广播 */
  checkUpdate: 'todo:check-update',
  /** renderer → main：开始下载已经查到的那个版本 */
  downloadUpdate: 'todo:download-update',
  /** renderer → main：重启并装上已下载的版本 */
  installUpdate: 'todo:install-update'
} as const

/**
 * 窗口 / 进程级动作。不改数据，所以不走命令层
 *
 * `open-download-page` 是给便携版用的：它装不了自动更新（见 shared/update.ts），
 * 只能把人送到发布页去。和 `open-data-dir` 一样是「用系统程序打开某个东西」。
 *
 * `open-repo-page` 是设置页「关于」那一格 —— 认领这个程序是从哪儿来的。
 * 两个开网页的动作分开而不是合成一个 `open-url`：**渲染层不该能指定
 * 要打开哪个网址**（那等于给了它一个任意 URL 的执行口），所以地址留在主进程。
 */
export type WindowAction =
  | 'hide'
  | 'open-data-dir'
  | 'open-download-page'
  | 'open-repo-page'
  | 'quit'

/**
 * 托盘菜单能让主窗口切到哪儿。编辑器要带参数（编辑哪条），
 * 不是「切个视图」能表达的，所以不在其中。
 */
export type OpenView = 'board' | 'inbox' | 'calendar' | 'countdown' | 'settings'

/** preload 用它区分自己是哪个窗口的桥 */
export const WINDOW_ARG_PREFIX = '--todo-window='
export type WindowKind = 'main' | 'quickadd'

/**
 * 运行时状态 —— 不落盘、重启即重置的东西。
 *
 * 注意这里**没有** `hotkey` 字段：它与 `settings.hotkey` 同值，
 * 两个来源同一个东西迟早出现「一个改了另一个没改」。界面读 settings，
 * runtime 只负责说「有没有注册成功」。
 */
export interface RuntimeState {
  /** 暂停到什么时候；null = 没暂停。重启后自动解除（规格 §6.4） */
  pausedUntil: number | null
  hotkeyRegistered: boolean
  /** 数据文件损坏时的备份路径 */
  corruptBackupPath: string | null
  /** 本次加载因形状不合法被跳过的记录条数；0 = 一条都没跳过 */
  droppedTaskCount: number
  /** 数据文件版本比本程序新时的那个版本号；null = 没有这回事 */
  newerFileVersion: number | null
  notices: Notice[]
  /** 应用自己的版本号（`app.getVersion()`，来源是 package.json 的 version） */
  version: string
  /**
   * 更新状态。**不落盘** —— 它记的是「这一版进程此刻认到的事」，
   * 写进数据文件只会在下次启动时带来一个必然是过期的值（见 shared/update.ts）
   */
  update: UpdateState
  dataFile: string
}

export interface Snapshot {
  /** 含已软删的任务 —— 撤销需要它们；界面自己过滤 */
  tasks: Task[]
  /** 纪念日。没有软删，删了就是删了（见 Store.addAnniversary 的说明） */
  anniversaries: Anniversary[]
  settings: Settings
  runtime: RuntimeState
}

export interface TodoApi {
  get(): Promise<Snapshot>
  command(cmd: Command): Promise<Snapshot>
  pause(minutes: number | null): Promise<Snapshot>
  /** 返回取消订阅的函数 */
  onSnapshot(cb: (snapshot: Snapshot) => void): () => void
  onFocusTask(cb: (taskId: string) => void): () => void
  /** 托盘菜单要求切视图 */
  onOpenView(cb: (view: OpenView) => void): () => void
  /** 返回的不是 `Snapshot`，只是一个结果 —— 显示值由广播更新，错误由这个结果当场反馈 */
  setHotkey(hotkey: string): Promise<{ ok: boolean }>
  window(action: WindowAction): Promise<void>
  /** 关掉某类提示（本次运行内不再显示），返回更新后的快照 */
  dismissNotice(id: NoticeId): Promise<Snapshot>
  /**
   * 更新动作。三个都**立即返回**，进度靠 `onSnapshot` 推。
   *
   * 「检查」要等一个 HTTPS 往返、可能要好几秒，把界面挂在 await 上
   * 只会得到一个卡住的按钮；让它当场返回、状态自己推回来，按钮就能立刻
   * 变成「正在检查…」。
   */
  checkUpdate(): Promise<void>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
}

/** 快速添加窗专用，只有两个口 */
export interface QuickAddApi {
  submit(draft: TaskDraftLike): Promise<void>
  cancel(): void
}

/**
 * 快速添加窗能提交的 draft 只有截止型与清单池 —— 三个按钮只会产生
 * 「今天全天 / 明天全天 / 今天带时刻的截止」。周期任务要选规则，放不进那个小窗。
 * 用 Pick 而不是再写一遍：draft 的形状只有 `commands.ts` 一处定义。
 */
export type TaskDraftLike = Extract<Command, { type: 'task:create' }>['draft']

export type NoticeId =
  | 'notify-failed'
  | 'write-failed'
  | 'corrupt-backup'
  | 'tasks-dropped'
  | 'file-too-new'

export interface Notice {
  /** 稳定去重键：同类问题只有一条 */
  id: NoticeId
  level: 'warn' | 'error'
  /** 说事实，不道歉（规格 §9.6 措辞规范） */
  text: string
  action?: { label: string; windowAction: WindowAction }
  at: number
}
