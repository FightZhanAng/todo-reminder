import { TICK_MS } from '../shared/defaults'
import { groupMissed } from '../shared/group'
import { inQuietHours } from '../shared/quiet'
import { dueNow, isRemindable, type DueEntry } from '../shared/remind'
import type { Store } from './store'

export interface NotifyBatch {
  fresh: DueEntry[]
  missed: DueEntry[]
}

export interface SchedulerDeps {
  store: Store
  /**
   * 把一批到点的任务交出去。
   * `desktop` 为 false 表示「这批不该弹桌面通知，但仍要交给手机推送」。
   */
  notify: (batch: NotifyBatch, desktop: boolean) => void
  /** 人是否不在电脑前 */
  isIdle: () => boolean
  now?: () => number
}

/**
 * 提醒调度器。
 *
 * 与 water-reminder 的关键差异：那边维护单个游标（喝水只有一个节律），
 * 这边是 N 个任务各有时点 —— 与其维护游标不如每 tick 全量扫描，
 * 千条任务的 filter 是微秒级，比维护游标的复杂度低得多。
 *
 * 语义也是反的：喝水睡一夜醒来会丢弃错过的提醒，待办必须补发。
 *
 * 刻意不直接调 Date.now() 和 powerMonitor —— 依赖注入之后测试可以直接
 * 调 tick() 并用假时钟，不需要真实定时器。
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private pausedUntilValue: number | null = null
  private readonly store: Store
  private readonly notify: (batch: NotifyBatch, desktop: boolean) => void
  private readonly isIdle: () => boolean
  private readonly clock: () => number

  constructor(deps: SchedulerDeps) {
    this.store = deps.store
    this.notify = deps.notify
    this.isIdle = deps.isIdle
    this.clock = deps.now ?? ((): number => Date.now())
  }

  get pausedUntil(): number | null {
    return this.pausedUntilValue
  }

  start(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  pause(minutes: number): void {
    this.pausedUntilValue = this.clock() + Math.max(1, minutes) * 60_000
  }

  resume(): void {
    this.pausedUntilValue = null
  }

  /**
   * 回填已处理的提醒点，保证 tick 幂等。
   * 桌面通知由 notify 调用方在真正发出后回填 firedFor；
   * 免打扰/空闲（silent）路径没有桌面回执，由 tick 自己调本方法标记。
   */
  markFired(entries: DueEntry[]): void {
    for (const entry of entries) {
      this.store.updateTask(entry.task.id, { firedFor: entry.at })
    }
  }

  tick(): void {
    const now = this.clock()

    if (this.pausedUntilValue !== null) {
      if (now < this.pausedUntilValue) return
      this.pausedUntilValue = null
    }

    const settings = this.store.settings
    if (!settings.notifyEnabled) return

    const due = dueNow(this.remindableTasks(), settings, now)
    if (due.length === 0) return

    const { fresh, missed } = groupMissed(due, now)

    // 免打扰：不弹桌面通知，但批次照常交出去走手机推送。
    // 待办不做「静默后重试」—— 「到点」这个事实不因为人不在而改变。
    const silent =
      inQuietHours(settings, now) || (settings.quietWhenIdle && this.isIdle())

    this.notify({ fresh, missed }, !silent)

    // 桌面通知有回执：notify 调用方在真正发出后回填 firedFor（见 markFired 注释），
    // 因此这里不替它标。免打扰/空闲时批次只走手机推送、没有桌面回执，
    // 调度器代为标记已处理，避免静默路径无限重发。
    if (silent) this.markFired(due)
  }

  private remindableTasks() {
    return this.store.tasks.filter(isRemindable)
  }
}
