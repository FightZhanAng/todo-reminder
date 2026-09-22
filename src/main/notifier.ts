import { Notification } from 'electron'
import { ACTION_ORDER, actionLabel, type TaskAction } from '../shared/actions'
import { missedTag, parseActivation, taskTag, type ActivationLike } from '../shared/activation'
import type { Command } from '../shared/commands'
import type { Notice } from '../shared/ipc'
import { describeTask, missedSummary } from '../shared/notifyText'
import type { RemindableTask } from '../shared/types'
import type { NotifyBatch } from './scheduler'
import type { Store } from './store'

const MISSED_MAX_TITLES = 3

/**
 * 同一次点击在 2 秒内只算一次。
 *
 * 实测一次点击会回传**两条**一模一样的激活（相隔约 33ms）。完成、推迟是幂等的，
 * 但「推到明天」连吃两次会把截止日挪到后天 —— 必须去重。
 */
const DEDUPE_MS = 2000

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
 *
 * **点击怎么收回来，两个平台不一样**（2026-09-22 实测）：Windows 上 `Notification`
 * 实例的 `action` / `click` 事件一次都没触发过 —— 按钮点了等于没点，界面不动、
 * 数据也不写。真正收到激活的是 `Notification.handleActivation`，它按系统原样回传的
 * tag 认人，所以冷启动、Notification 对象已被回收、从通知中心点旧通知这三种情形
 * 也都接得住。macOS / Linux 没有这个入口，仍走实例事件。
 *
 * 一条要知道的边界：Windows 上**只回传按钮**（`type=action`）。点正文收不到任何回调 ——
 * 系统自己把应用窗口提到前面就完事了（用户看到的「点正文有延迟」就是这一下）。
 * 所以「点到哪条任务就滚到哪条」只有按钮路径做得到，正文那条留给系统。
 */
export class Notifier {
  private readonly handled = new Map<string, number>()

  constructor(private readonly deps: NotifierDeps) {
    if (process.platform === 'win32') Notification.handleActivation((a) => this.onActivation(a))
  }

  private onActivation(raw: ActivationLike): void {
    const now = Date.now()
    for (const [key, at] of this.handled) {
      if (now - at > DEDUPE_MS) this.handled.delete(key)
    }
    if (this.handled.has(raw.arguments)) return
    this.handled.set(raw.arguments, now)

    const hit = parseActivation(raw)
    if (hit.kind === 'unknown') return
    if (hit.kind === 'open') this.deps.onFocusTask(hit.taskId)
    else this.applyAction(hit.taskId, hit.action)
  }

  showBatch(batch: NotifyBatch): void {
    if (!Notification.isSupported()) return

    for (const entry of batch.fresh) this.showTask(entry.task, entry.at)
    if (batch.missed.length > 0) this.showMissed(batch)
  }

  private showTask(task: RemindableTask, at: number): void {
    const { title, body } = describeTask(task, at, Date.now())
    const snoozeMinutes = this.deps.store.settings.snoozeMinutes
    const n = new Notification({
      id: taskTag(task.id, at),
      title,
      body,
      silent: !this.deps.store.settings.soundEnabled,
      actions: ACTION_ORDER.map((a) => ({
        type: 'button' as const,
        text: actionLabel(a, snoozeMinutes)
      }))
    })

    if (process.platform !== 'win32') {
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
    }
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

    const at = Date.now()
    const { title, body } = missedSummary(batch.missed, MISSED_MAX_TITLES)
    const n = new Notification({
      // 时间戳进 tag，否则同一批补发会顶掉上一条还没点的
      id: missedTag(first.task.id, at),
      title,
      body,
      silent: !this.deps.store.settings.soundEnabled,
      actions: [{ type: 'button', text: '打开待办' }]
    })
    if (process.platform !== 'win32') {
      n.on('action', () => this.deps.onFocusTask(first.task.id))
      n.on('click', () => this.deps.onFocusTask(first.task.id))
    }
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

    // 复用命令层的语义映射：与界面上那三个按钮走同一条路，tick / 托盘 / 广播都在里面
    const cmd: Command =
      action === 'complete'
        ? { type: 'task:complete', id: taskId }
        : action === 'snooze'
          ? { type: 'task:snooze', id: taskId, minutes: this.deps.store.settings.snoozeMinutes }
          : { type: 'task:postpone', id: taskId }
    this.deps.runCommand(cmd)
  }
}
