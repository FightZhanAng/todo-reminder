import { matchesDay } from './recurrence'
import { atTimeOfDay, dayKey, startOfDay } from './time'
import type { RecurringTask, RemindableTask, Settings, Task } from './types'

export interface DueEntry {
  task: RemindableTask
  at: number
}

export function isRemindable(task: Task): task is RemindableTask {
  return task.kind !== 'someday'
}

/**
 * 计算当前该触发的提醒点。null 表示此刻没有待触发的提醒。
 * 取值优先级见规格 §5。
 */
export function remindAtOf(task: RemindableTask, settings: Settings, now: number): number | null {
  if (task.deletedAt !== null) return null

  if (task.kind === 'deadline') {
    if (task.completedAt !== null) return null
    if (task.snoozeUntil !== null) return task.snoozeUntil
    if (task.allDay) return atTimeOfDay(task.dueAt, settings.allDayRemindTime)
    return task.dueAt - task.leadMin * 60_000
  }

  return recurringRemindAt(task, now)
}

/**
 * 周期任务的提醒点。
 *
 * 「推迟」必须在这里单独处理 —— 截止型的提醒点存在任务字段里（`dueAt - leadMin`），
 * 所以 `snoozeUntil` 可以直接顶替它；而周期任务的提醒点是由规则**算**出来的，
 * 每天都有一个新值，直接顶替等于把之后的每一天都屏蔽掉。
 *
 * 判据是「`snoozeUntil` 不早于今天」。一次比较同时解决三件事：
 *
 * 1. 推迟点没到时返回它 → 推迟期内不弹；
 * 2. 推迟点弹过之后仍然返回它，而它此时等于 `firedFor`，被 `dueNow` 的幂等
 *    规则挡掉 → 当天不再重复。**这一步是关键**：若此处改回常规提醒点，它
 *    ≤ now 且 ≠ firedFor，会立刻再弹一次 —— 这正是修复前周期任务点「推迟」
 *    原地重弹的原因（`firedFor` 被清空 + 提醒点回落到 09:00）；
 * 3. 到了第二天，旧的 `snoozeUntil` 早于新一天的零点，自然失效、规则恢复 ——
 *    不需要任何清理代码。
 *
 * 判据为什么不是「晚于 base」：那样 23:55 推迟到次日 00:05 会在跨天瞬间失效
 * （新一天的 base 必然晚于那个推迟点），推迟被整整吞掉一天。用「不早于今天」
 * 则只跟当天的零点比，跨午夜照样生效。
 */
function recurringRemindAt(task: RecurringTask, now: number): number | null {
  if (task.lastDoneDay === dayKey(now)) return null
  const today = startOfDay(now)
  if (!matchesDay(task.rule, startOfDay(task.createdAt), today)) return null

  if (task.snoozeUntil !== null && task.snoozeUntil > today) return task.snoozeUntil

  return atTimeOfDay(today, task.remindTime)
}

/**
 * 挑出此刻该弹通知的任务。四条过滤规则：
 *   1. 提醒点必须 ≤ now
 *   2. 提醒点必须晚于创建时间 —— 否则新建一件马上要截止的事会被自己的通知打脸
 *   3. 提醒点不能等于 firedFor —— 幂等，tick 每 10 秒一次不会重复弹
 *   4. 结果按提醒点升序
 */
export function dueNow(tasks: RemindableTask[], settings: Settings, now: number): DueEntry[] {
  const out: DueEntry[] = []
  for (const task of tasks) {
    const at = remindAtOf(task, settings, now)
    if (at === null) continue
    if (at > now) continue
    if (at <= task.createdAt) continue
    if (at === task.firedFor) continue
    out.push({ task, at })
  }
  return out.sort((a, b) => a.at - b.at)
}
