import type { Command } from './commands'
import type { Settings, Task } from './types'

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
  /** renderer → main：窗口与进程级动作 */
  window: 'todo:window',
  /** 快速添加窗 → main：提交一条草稿后关窗 */
  quickAdd: 'todo:quickadd',
  /** 快速添加窗 → main：取消 */
  quickAddCancel: 'todo:quickadd-cancel',
  /** renderer → main：改全局快捷键。**先试注册，成功才写设置** */
  setHotkey: 'todo:set-hotkey',
  /** renderer → main：关掉某类提示（本次运行内不再显示） */
  dismissNotice: 'todo:dismiss-notice'
} as const

/** 窗口 / 进程级动作。不改数据，所以不走命令层 */
export type WindowAction = 'hide' | 'open-data-dir' | 'quit'

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
  notices: Notice[]
  version: string
  dataFile: string
}

export interface Snapshot {
  /** 含已软删的任务 —— 撤销需要它们；界面自己过滤 */
  tasks: Task[]
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
  /** 返回的不是 `Snapshot`，只是一个结果 —— 显示值由广播更新，错误由这个结果当场反馈 */
  setHotkey(hotkey: string): Promise<{ ok: boolean }>
  window(action: WindowAction): Promise<void>
  /** 关掉某类提示（本次运行内不再显示），返回更新后的快照 */
  dismissNotice(id: NoticeId): Promise<Snapshot>
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

export type NoticeId = 'notify-failed' | 'write-failed' | 'corrupt-backup'

export interface Notice {
  /** 稳定去重键：同类问题只有一条 */
  id: NoticeId
  level: 'warn' | 'error'
  /** 说事实，不道歉（规格 §9.6 措辞规范） */
  text: string
  action?: { label: string; windowAction: WindowAction }
  at: number
}
