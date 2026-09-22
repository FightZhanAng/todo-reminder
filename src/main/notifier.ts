import { Notification } from 'electron'
import { ACTION_ORDER, actionLabel, type TaskAction } from '../shared/actions'
import { missedTag, parseActivation, taskTag, type ActivationLike } from '../shared/activation'
import type { Command } from '../shared/commands'
import type { Notice } from '../shared/ipc'
import { describeTask, missedSummary } from '../shared/notifyText'
import { buildToastXml } from '../shared/toastXml'
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
 * 一条要知道的边界：Windows 上按钮和正文**都**回传激活，但正文那一下的参数只来自
 * toast XML 的 `<toast launch="...">`，而 Electron 生成的 XML 里没有这个属性 ——
 * 于是点正文回传空参数、认不出是哪条任务（2026-09-22 用本机通知数据库里的原始
 * XML 实测）。所以 Windows 的 XML 由我们自己生成（`shared/toastXml.ts`），
 * 把 tag 同时写进 `launch` 和三颗按钮的 `arguments`。
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
    const tag = taskTag(task.id, at)
    const silent = !this.deps.store.settings.soundEnabled
    const buttons = ACTION_ORDER.map((a) => actionLabel(a, snoozeMinutes))
    const n = new Notification({
      id: tag,
      ...(process.platform === 'win32'
        ? {
            // Windows 必须自己给 XML 补 launch：Electron 生成的那份没有它，
            // 点正文回传的是空参数、认不出是哪条任务。见 shared/toastXml.ts
            toastXml: buildToastXml({ tag, title, body, buttons, silent })
          }
        : {
            title,
            body,
            silent,
            actions: buttons.map((text) => ({ type: 'button' as const, text }))
          })
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
    // 时间戳进 tag，否则同一批补发会顶掉上一条还没点的
    const tag = missedTag(first.task.id, at)
    const silent = !this.deps.store.settings.soundEnabled
    const n = new Notification({
      id: tag,
      // 同 showTask：正文那一下要靠 <toast launch> 才认得出来
      ...(process.platform === 'win32'
        ? { toastXml: buildToastXml({ tag, title, body, buttons: ['打开待办'], silent }) }
        : {
            title,
            body,
            silent,
            actions: [{ type: 'button' as const, text: '打开待办' }]
          })
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
