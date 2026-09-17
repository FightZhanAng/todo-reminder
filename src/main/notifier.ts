import { Notification } from 'electron'
import { ACTION_ORDER, actionLabel, actionPatch, type TaskAction } from '../shared/actions'
import { describeTask, missedSummary } from '../shared/notifyText'
import type { RemindableTask } from '../shared/types'
import type { NotifyBatch, Scheduler } from './scheduler'
import type { Store } from './store'

const MISSED_MAX_TITLES = 3

export interface NotifierDeps {
  store: Store
  scheduler: Scheduler
  /** 点击通知正文时唤起主窗口并聚焦到某个任务 */
  onFocusTask: (taskId: string) => void
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

  /** desktop 为 false 表示只走手机推送，不弹桌面通知 */
  showBatch(batch: NotifyBatch, desktop: boolean): void {
    if (!desktop) return
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
    n.on('failed', (_e, err) => console.error('[notifier] 通知失败：', err))
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
    n.on('failed', (_e, err) => console.error('[notifier] 聚合通知失败：', err))
    n.show()
  }

  private applyAction(taskId: string, action: TaskAction): void {
    const task = this.deps.store.tasks.find((t) => t.id === taskId)
    if (!task || task.kind === 'someday') return

    // actionPatch 对同一个 now 幂等，按钮动作本身不可做累加式写法
    const patch = actionPatch(task, action, Date.now(), {
      snoozeMinutes: this.deps.store.settings.snoozeMinutes
    })
    this.deps.store.updateTask(taskId, patch)
    // 立刻重算一次，让刚被推迟/完成的任务马上影响下一轮
    this.deps.scheduler.tick()
  }
}
