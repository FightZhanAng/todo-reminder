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
 * 只认两种推迟点（都在**今天之内**）：
 *
 * 1. **还没走完**（`snooze > now`，或者到了点但调度器还没记上账
 *    `firedFor !== snooze`）→ 就用它顶着，免得常规时刻在这中间先弹一次；
 * 2. **已经弹过，而且它顶掉的就是今天这个常规点**（`snooze` 晚于今天的
 *    `remindTime`）→ 继续返回它，而它此时等于 `firedFor`，被 `dueNow` 的
 *    幂等规则挡掉 → 当天不再重复。**这一步是关键**：若此处改回常规提醒点，
 *    它 ≤ now 且 ≠ firedFor，会立刻再弹一次 —— 这正是修复前周期任务点
 *    「推迟」原地重弹的原因。
 *
 * 跨午夜的推迟（23:55 推到次日 00:05）走第 1 条：推迟点在次日到来时照常弹。
 * 弹过之后它比**次日**的常规点更早，第 2 条不成立，于是规则当场恢复 ——
 * 这正是 2026-10-14 修掉的缺陷：原来只比「不早于今天」，推迟点落在次日时
 * 它会一直命中第 2 条，`firedFor` 恒等于那个推迟点，次日那一整天的实例
 * （09:00 那种每天唯一的一次）被静默吞掉，而且永远不会自愈。
 *
 * 判据为什么不是「晚于 base（今天的常规点）」：那样 23:55 推迟到次日 00:05
 * 会在跨天瞬间失效（新一天的 base 必然晚于那个推迟点），推迟被整整吞掉一天。
 * 早于今天的 `snoozeUntil` 两条都不命中，自然失效、规则恢复 ——
 * 不需要任何清理代码。
 */
function recurringRemindAt(task: RecurringTask, now: number): number | null {
  if (task.lastDoneDay === dayKey(now)) return null
  const today = startOfDay(now)
  if (!matchesDay(task.rule, startOfDay(task.createdAt), today)) return null

  const regular = atTimeOfDay(today, task.remindTime)
  const snooze = task.snoozeUntil
  if (snooze !== null) {
    // 还没走完：推迟点在今天以内，而且要么还没到点、要么到了点还没记上账
    if (snooze >= today && (snooze > now || task.firedFor !== snooze)) return snooze
    // 已经弹过：只有「它顶掉的就是今天这个常规点」时才继续顶着它
    if (regular < snooze) return snooze
  }
  return regular
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
