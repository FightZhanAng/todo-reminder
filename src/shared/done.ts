import { relativeDayLabel, tsFromDayKey } from './calendar'
import { dayKey, startOfDay } from './time'
import type { DeadlineTask, RecurringTask, Task } from './types'

/**
 * 「已完成」这本账的纯计算。**不 import electron、不碰 DOM** ——
 * 于是「按完成日分组、同一天里最新做完的在最上面」这类最容易差一格的逻辑
 * 可以在无头测试里断言，而不是只能靠肉眼看那一屏列表。
 *
 * ## 为什么这本账必须存在
 *
 * 完成一件截止型任务只写 `completedAt`，`groupToday` 立刻不再返回它 ——
 * 行从看板上消失，而且**没有任何地方再提到它**。任务本身在 store 里躺着
 * （从不清理），但用户没有任何入口看到它。这个模块就是那个入口。
 *
 * ## 周期任务为什么单独一段，而不是混进按天分组里
 *
 * 周期任务没有「完成」这个概念，只有 `lastDoneDay` + `streak` ——
 * 数据模型里**没有历史**，只有最近一次。把它按 `lastDoneDay` 塞进「9月16日」
 * 那一天的分组里会撒一个谎：看上去像「那天做了一件」的流水，
 * 实际上是「这条习惯最近一次是那天打的卡」，它明天还会回来。
 * 所以两者分开：上面是按天的流水账，下面是习惯的当前状态。
 *
 * 顺带一提，周期任务其实有和截止型一样的毛病：`groupToday` 把
 * `lastDoneDay === 今天` 的过滤掉了，所以「今天打过卡」的习惯在看板上也看不见 ——
 * 这本账是它今天唯一的去处。
 */

/**
 * 已完成的条数 —— 底栏那枚入口的计数。
 *
 * 单独一个函数而不是让底栏自己 filter：底栏手里是整份 `snapshot.tasks`
 * （含已软删的），「哪些算已完成」这条规则不能在校验处、视图处、底栏处
 * 各写一遍 —— 三份一样的过滤迟早只有两份是对的。
 */
export function doneCount(tasks: Task[]): number {
  let n = 0
  for (const t of tasks) {
    if (t.deletedAt !== null) continue
    if (t.kind === 'deadline') {
      if (t.completedAt !== null) n++
    } else if (t.kind === 'recurring') {
      if (t.lastDoneDay !== null) n++
    }
  }
  return n
}

export interface DoneDay {
  /** 'YYYY-MM-DD' */
  key: string
  /** 当天本地 00:00 */
  dayStart: number
  /** 那天做完的一次性任务，**完成时刻倒序**（刚做完的在最上面） */
  tasks: DeadlineTask[]
}

export interface DoneLedger {
  /** 按天分组，最新的天在最前 */
  days: DoneDay[]
  /** 打过卡的周期任务，按最近完成日倒序 */
  recurring: RecurringTask[]
  /** 已完成的一次性任务条数 */
  total: number
  /** 一共多少条 —— 空状态判据，也让头部只算一次 */
  count: number
}

export function collectDone(tasks: Task[], now: number): DoneLedger {
  const active = tasks.filter((t) => t.deletedAt === null)

  const done = active.filter(
    (t): t is DeadlineTask => t.kind === 'deadline' && t.completedAt !== null
  )

  // 用 Map 而不是「先 sort 再连续切段」：后者依赖 sort 的稳定性，
  // 而且分组与排序两个意图会缠在一处。这里分组归分组、排序归排序。
  const byDay = new Map<string, DoneDay>()
  for (const task of done) {
    // completedAt 上面刚过滤过非 null，这里断言是安全的；不写 `as` 的话
    // 每次用都要再判一次 null，把「已经证明过」的事实重复三遍
    const at = task.completedAt as number
    const key = dayKey(at)
    let bucket = byDay.get(key)
    if (bucket === undefined) {
      bucket = { key, dayStart: startOfDay(at), tasks: [] }
      byDay.set(key, bucket)
    }
    bucket.tasks.push(task)
  }

  const days = [...byDay.values()].sort((a, b) => b.dayStart - a.dayStart)
  for (const day of days) {
    day.tasks.sort((a, b) => (b.completedAt as number) - (a.completedAt as number))
  }

  // lastDoneDay 是 'YYYY-MM-DD'，字典序与时间序一致，所以直接比字符串
  const recurring = active
    .filter((t): t is RecurringTask => t.kind === 'recurring' && t.lastDoneDay !== null)
    .sort((a, b) => (b.lastDoneDay as string).localeCompare(a.lastDoneDay as string))

  return {
    days,
    recurring,
    total: done.length,
    count: done.length + recurring.length
  }
}

/**
 * 周期任务的行尾补充：最近一次打卡是什么时候 + 连了几天。
 *
 * `streak < 2` 时不给「连续」——「连续 1 天」是句废话，那只是「做过一次」。
 */
export function recurringDoneLabel(task: RecurringTask, now: number): string {
  const key = task.lastDoneDay as string
  const ts = tsFromDayKey(key)
  const rel = ts === null ? null : relativeDayLabel(ts, now)

  let when: string
  if (rel === '今天') when = '今天已打卡'
  else if (rel === '昨天') when = '昨天打卡'
  else if (rel === '前天') when = '前天打卡'
  else if (ts !== null) {
    const d = new Date(ts)
    when = `上次 ${d.getMonth() + 1}月${d.getDate()}日`
  } else {
    when = `上次 ${key}`
  }

  return task.streak >= 2 ? `${when} · 连续 ${task.streak} 天` : when
}
