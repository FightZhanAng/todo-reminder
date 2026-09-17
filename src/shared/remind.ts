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

/** 周期任务：今天命中且今天还没做过，才给提醒点 */
function recurringRemindAt(task: RecurringTask, now: number): number | null {
  if (task.lastDoneDay === dayKey(now)) return null
  const today = startOfDay(now)
  if (!matchesDay(task.rule, startOfDay(task.createdAt), today)) return null
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
