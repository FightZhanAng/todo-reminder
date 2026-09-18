import { MISS_GRACE_MS } from './defaults'
import { matchesDay } from './recurrence'
import type { DueEntry } from './remind'
import { dayKey, nextDayStart, startOfDay } from './time'
import type { DeadlineTask, RecurringTask, Task } from './types'

export interface TodayGroups {
  /** 已逾期未完成，置顶 */
  overdue: DeadlineTask[]
  /** 今天且 allDay === false，按时刻升序 */
  upcoming: DeadlineTask[]
  /** 当天全天型：allDay === true 且 dueAt 落在今天 */
  anytime: DeadlineTask[]
  /** 今天该做的周期任务 */
  recurring: RecurringTask[]
}

/**
 * 今日看板的四段分组。段顺序即展示顺序。
 * 清单池（someday）不出现在任何一段 —— 它只出现在收件箱里。
 *
 * 不收 `settings`：分组只看任务的日期字段，与任何设置无关。
 * 原来带着 `settings` 形参是给第二期预留的，一直没人用 —— 与其留个
 * 会让人误以为「分组受设置影响」的死参数，不如等真需要时再加。
 */
export function groupToday(tasks: Task[], now: number): TodayGroups {
  const today = startOfDay(now)
  const tomorrow = nextDayStart(now)
  const active = tasks.filter((t) => t.deletedAt === null)

  const openDeadlines = active.filter(
    (t): t is DeadlineTask => t.kind === 'deadline' && t.completedAt === null
  )

  const overdue = openDeadlines.filter((t) => t.dueAt < today).sort((a, b) => a.dueAt - b.dueAt)

  const todays = openDeadlines.filter((t) => t.dueAt >= today && t.dueAt < tomorrow)

  const upcoming = todays.filter((t) => !t.allDay).sort((a, b) => a.dueAt - b.dueAt)

  const anytime = todays
    .filter((t) => t.allDay)
    .sort((a, b) => Number(b.important) - Number(a.important) || a.createdAt - b.createdAt)

  const recurring = active
    .filter((t): t is RecurringTask => t.kind === 'recurring' && t.lastDoneDay !== dayKey(now))
    .filter((t) => matchesDay(t.rule, startOfDay(t.createdAt), today))
    .sort((a, b) => a.remindTime.localeCompare(b.remindTime))

  return { overdue, upcoming, anytime, recurring }
}

/**
 * 把到点的一批切成「刚到的」和「错过的」。
 * 睡一夜醒来时，昨晚的提醒点会全部落进 missed，调度器把它们聚合成一条
 * 通知，而不是几十条轰炸。
 */
export function groupMissed(
  due: DueEntry[],
  now: number
): { fresh: DueEntry[]; missed: DueEntry[] } {
  const fresh: DueEntry[] = []
  const missed: DueEntry[] = []
  for (const entry of due) {
    if (now - entry.at <= MISS_GRACE_MS) fresh.push(entry)
    else missed.push(entry)
  }
  return { fresh, missed }
}
