import { dayKey, nextDayStart, startOfDay } from './time'
import type { DeadlineTask, Task } from './types'

/**
 * 「以后」这本账的纯计算 —— 明天及以后截止、还没做完的一次性任务。
 *
 * ## 为什么要有它
 *
 * `groupToday` 的四段全只看今天（逾期 / 接下来 / 今天随时 / 每天），收件箱只放
 * 清单池。于是一件「周三交材料」记下去之后，**界面上再没有任何地方能看见它** ——
 * 数据一直在 store 里，但没有任何视图提到它。记了却看不见的任务等于没记。
 *
 * ## 为什么逾期不进这里
 *
 * 它已经在看板置顶了。再列一遍就出现两个「今天要管的事」的入口，
 * 而这两处的排序规则还不一样（看板按逾期时长，这里按天）。
 *
 * ## 为什么全天型垫在最后
 *
 * 同一天里「17:00 交材料」和「某天之前做完就行」不是一回事：前者有钟点，
 * 可以竖着扫；后者没有。把没有钟点的混进按时刻升序的队列里，那个 `00:00`
 * 会被读成「凌晨就要交」。
 */

export interface FutureDay {
  /** 'YYYY-MM-DD' */
  key: string
  /** 当天本地 00:00 */
  dayStart: number
  /** 当天截止且未完成的截止型任务 */
  tasks: DeadlineTask[]
}

export function collectUpcoming(tasks: Task[], now: number): FutureDay[] {
  const from = nextDayStart(now)

  const open = tasks.filter(
    (t): t is DeadlineTask =>
      t.kind === 'deadline' &&
      t.deletedAt === null &&
      t.completedAt === null &&
      t.dueAt >= from
  )

  const byDay = new Map<string, FutureDay>()
  for (const task of open) {
    const key = dayKey(task.dueAt)
    let bucket = byDay.get(key)
    if (bucket === undefined) {
      bucket = { key, dayStart: startOfDay(task.dueAt), tasks: [] }
      byDay.set(key, bucket)
    }
    bucket.tasks.push(task)
  }

  const days = [...byDay.values()].sort((a, b) => a.dayStart - b.dayStart)
  for (const day of days) day.tasks.sort(withinDay)
  return days
}

/** 一天之内：有时刻的按时刻升序，全天型垫到最后，垫底那段里重要的在前 */
function withinDay(a: DeadlineTask, b: DeadlineTask): number {
  if (a.allDay !== b.allDay) return a.allDay ? 1 : -1
  if (a.allDay) return Number(b.important) - Number(a.important) || a.createdAt - b.createdAt
  return a.dueAt - b.dueAt
}

/**
 * 底栏那枚入口的计数。单独一个函数而不是让底栏自己 filter ——
 * 「哪些算以后」这条规则在校验处、视图处、底栏处各写一遍，迟早只有两份是对的。
 */
export function upcomingCount(tasks: Task[], now: number): number {
  let n = 0
  for (const day of collectUpcoming(tasks, now)) n += day.tasks.length
  return n
}
