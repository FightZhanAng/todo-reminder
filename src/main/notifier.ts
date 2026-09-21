import { Notification } from 'electron'
import { ACTION_ORDER, actionLabel, type TaskAction } from '../shared/actions'
import type { Command } from '../shared/commands'
import type { Notice } from '../shared/ipc'
import { describeTask, missedSummary } from '../shared/notifyText'
import type { RemindableTask } from '../shared/types'
import type { NotifyBatch } from './scheduler'
import type { Store } from './store'

const MISSED_MAX_TITLES = 3

export interface NotifierDeps {
  store: Store
  /**
   * 动作走命令层 —— 保证「通知改的数据」与「界面改的数据」是同一条路。
   * 直接写 store 会漏掉 tick + 托盘刷新 + 广播，症状是「通知点完完成，
   * 主窗口还挂着那条任务，托盘件数也不变」。
   */
  runCommand: (cmd: Command) => void
  /** 点通知正文 / 「打开待办」 → 唤起窗口并聚焦 */
  onFocusTask: (taskId: string) => void
  /** 通知发不出去时的反馈渠道（只 console.error 的话，用户永远看不到） */
  raiseNotice: (notice: Notice) => void
}

/**
 * 系统通知。
 *
 * Windows 上必须先设 AppUserModelID，否则通知根本不弹 —— 见 index.ts。
 * 带按钮的 toast 在开发态的可用性由 Task 2 的 spike 结论决定；
 * 若 spike 判定不可用，把 buildActions() 换成 toastXml 或改成
 * 「点击通知唤起操作卡」。
 */
export class Notifier {
  constructor(private readonly deps: NotifierDeps) {}

  showBatch(batch: NotifyBatch): void {
    if (!Notification.isSupported()) return

    for (const entry of batch.fresh) this.showTask(entry.task, entry.at)
    if (batch.missed.length > 0) this.showMissed(batch)
  }

  private showTask(task: RemindableTask, at: number): void {
    const { title, body } = describeTask(task, at, Date.now())
    const snoozeMinutes = this.deps.store.settings.snoozeMinutes
    const n = new Notification({
      id: `task-${task.id}-${at}`,
      title,
      body,
      silent: !this.deps.store.settings.soundEnabled,
      actions: ACTION_ORDER.map((a) => ({
        type: 'button' as const,
        text: actionLabel(a, snoozeMinutes)
      }))
    })

    // 位置参数实测可用但已 deprecated，事件对象上是新的官方位置，两个都兼容
    n.on('action', (e, index) => {
      const i =
        typeof index === 'number'
          ? index
          : (e as { actionIndex?: number }).actionIndex
      const action = i === undefined ? undefined : ACTION_ORDER[i]
      if (action) this.applyAction(task.id, action)
    })
    n.on('click', () => this.deps.onFocusTask(task.id))
    n.on('failed', (_e, err) => {
      this.deps.raiseNotice({
        id: 'notify-failed',
        level: 'warn',
        text: `系统通知发送失败：${err}。检查「专注助手」或系统通知设置。`,
        at: Date.now()
      })
    })
    n.show()
  }

  private showMissed(batch: NotifyBatch): void {
    const first = batch.missed[0]
    if (!first) return

    const { title, body } = missedSummary(batch.missed, MISSED_MAX_TITLES)
    const n = new Notification({
      id: `missed-${Date.now()}`,
      title,
      body,
      silent: !this.deps.store.settings.soundEnabled,
      actions: [{ type: 'button', text: '打开待办' }]
    })
    n.on('action', () => this.deps.onFocusTask(first.task.id))
    n.on('click', () => this.deps.onFocusTask(first.task.id))
    n.on('failed', (_e, err) => {
      this.deps.raiseNotice({
        id: 'notify-failed',
        level: 'warn',
        text: `聚合通知发送失败：${err}。检查「专注助手」或系统通知设置。`,
        at: Date.now()
      })
    })
    n.show()
  }

  private applyAction(taskId: string, action: TaskAction): void {
    const task = this.deps.store.tasks.find((t) => t.id === taskId)
    if (!task || task.kind === 'someday') return

    // 复用命令层的语义映射。actionPatch 对同一个 now 幂等，
    // 所以「一次点击可能触发两次 action」（实测相隔 ~31ms）不会累加
    const cmd: Command =
      action === 'complete'
        ? { type: 'task:complete', id: taskId }
        : action === 'snooze'
          ? { type: 'task:snooze', id: taskId, minutes: this.deps.store.settings.snoozeMinutes }
          : { type: 'task:postpone', id: taskId }
    this.deps.runCommand(cmd)
  }
}
