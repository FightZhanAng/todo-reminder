import { dueAnniversaries, type AnniversaryEntry } from '../shared/anniversary'
import { TICK_MS } from '../shared/defaults'
import { groupMissed } from '../shared/group'
import { inQuietHours } from '../shared/quiet'
import { dueNow, isRemindable, type DueEntry } from '../shared/remind'
import type { Store } from './store'

export interface NotifyBatch {
  fresh: DueEntry[]
  missed: DueEntry[]
  /**
   * 到点的纪念日。**不切 fresh/missed** —— 见 `dueAnniversaries`：
   * 它说的是一整天，早上九点没弹成、十一点开机仍然该弹，
   * 而且绝不该被揉进「有 N 件事错过了」那句话里（把生日说成「错过了」是错的）。
   */
  anniversaries: AnniversaryEntry[]
}

export interface SchedulerDeps {
  store: Store
  /** 把一批到点的任务交出去（弹桌面通知） */
  notify: (batch: NotifyBatch) => void
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
  private readonly notify: (batch: NotifyBatch) => void
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
   * 由 notify 的调用方在桌面通知真正发出后调 —— 调度器自己不标，
   * 因为「交出去」不等于「用户看见了」。
   *
   * 走 `updateTasks` 而不是逐条 `updateTask`：一批 60 条逐条写就是 60 次
   * 全量重写 + fsync（实测放大 59 倍），而这里本来就是一个批次。
   */
  markFired(entries: DueEntry[]): void {
    this.store.updateTasks(entries.map((e) => ({ id: e.task.id, patch: { firedFor: e.at } })))
  }

  /**
   * 纪念日的回填。标的是 `e.day` 而**不是** `e.at` —— 它的幂等按天算
   * （见 `Anniversary.firedFor`）：09:00 弹过之后，同一天把提醒时刻改成
   * 11:00 也不该再弹一遍。这里如果跟着任务写 `e.at`，那条路径就会重弹。
   */
  markAnniversaryFired(entries: AnniversaryEntry[]): void {
    this.store.updateAnniversaries(
      entries.map((e) => ({ id: e.anniversary.id, patch: { firedFor: e.day } }))
    )
  }

  tick(): void {
    const now = this.clock()

    if (this.pausedUntilValue !== null) {
      if (now < this.pausedUntilValue) return
      this.pausedUntilValue = null
    }

    const settings = this.store.settings
    if (!settings.notifyEnabled) return

    // 免打扰时段或人不在电脑前：这个 tick 什么都不做，**尤其不标 firedFor**。
    // 标了就等于把这批提醒当场处理掉，它们再也进不了「错过补发」。
    // 时段结束、人回来之后，同一个提醒点仍然 due，只是已经越过 MISS_GRACE_MS，
    // 于是自然落进 missed，聚合成一条「有 N 件事错过了」而不是 N 条轰炸。
    if (inQuietHours(settings, now) || (settings.quietWhenIdle && this.isIdle())) return

    const due = dueNow(this.remindableTasks(), settings, now)
    const anniversaries = dueAnniversaries(this.store.anniversaries, settings, now)
    if (due.length === 0 && anniversaries.length === 0) return

    this.notify({ ...groupMissed(due, now), anniversaries })
  }

  /**
   * 会提醒的任务。纪念日**不在这里** —— 它压根不在 `store.tasks` 里，
   * 而且它的提醒规则（按天论、每年滚动、没有「错过」）本来就与任务不同，
   * 混进这个数组只会让 `dueNow` 里冒出三处 `kind === 'anniversary'` 的例外。
   * 两条支路在 `tick` 里并到同一批通知上，那才是它们该合的地方。
   */
  private remindableTasks() {
    return this.store.tasks.filter(isRemindable)
  }
}
