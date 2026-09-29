import { monthGrid } from './calendar'
import { matchesDay } from './recurrence'
import { atTimeOfDay, dayKey, nextDayStart, startOfDay } from './time'
import type { Task } from './types'

/**
 * 「日历」这本账的按天聚合。看板只看今天、收件箱只放清单池、
 * 「以后」只从明天起、已完成与倒计时各管一头 —— 日历是唯一一个
 * **按任意一天**回答「那天有什么」的地方，所以它必须自己算一遍。
 *
 * ## 三条容易踩的
 *
 * 1. **周期任务要按规则展开**，不能只看 `dueAt`（它根本没有）。用
 *    `matchesDay` 逐日问 —— 42 个格子 × 少数几条规则，比走
 *    `expandRecurrence` 更好推理（那个有 400 天的搜索上限，且按次数取，
 *    一条「每天」的习惯会把窗口外的日子也拉进来再被丢掉）。
 * 2. **清单池不进日历**。someday 是「还没定哪天」的池子，把它塞进某一天
 *    就篡改了它的语义 —— 它在收件箱里待着，直到被「今天做」挪出来。
 * 3. **全天型垫在同一天的末尾**（与 `future.ts` 的 `withinDay` 同一条规矩）：
 *    「17:00 交材料」和「这天做完就行」不是一回事，混在一起那个 00:00
 *    会被读成「凌晨就要交」。
 * 4. **周期任务不进过去的日子、也不进圆点**（`agendaOfDay` 里那两条规矩）。
 *    它没有历史，把规则铺到上周等于替用户编一份「那天你没做」的流水；
 *    而圆点是给「有日期承诺的事」用的 —— 一条「每天」的习惯会让整月
 *    每一格都长点，扫描的价值就没了。今天那一格例外（习惯本来就在今天）。
 */

export interface DayAgenda {
  /** 'YYYY-MM-DD' */
  key: string
  /** 当天本地 00:00 */
  dayStart: number
  /** 那天的事：截止型按到期日、周期型按规则命中。含已完成（界面自己分辨） */
  tasks: Task[]
  /** 那天的**未完成**条数，只数「有日期承诺的事」；今天例外，习惯也算（见 `agendaOfDay`） */
  pending: number
  /** 其中已经晚了的那部分（未完成，且那一天已经过去） */
  overdue: number
}

/** 那天的一件事，附上它的「钟点」用于排序 */
interface Entry {
  task: Task
  /** 用于排序的钟点；全天型给 Infinity，垫到最后 */
  clock: number
}

function clockOf(task: Task, dayStart: number): number {
  if (task.kind === 'recurring') return atTimeOfDay(dayStart, task.remindTime)
  if (task.kind === 'someday') return Number.POSITIVE_INFINITY
  return task.allDay ? Number.POSITIVE_INFINITY : task.dueAt
}

function isDone(task: Task, day: number): boolean {
  if (task.kind === 'deadline') return task.completedAt !== null
  if (task.kind === 'recurring') return task.lastDoneDay === dayKey(day)
  return false
}

/**
 * 一天的事，**只按规则展开**（不含任何「今天是哪天」的判断）。
 *
 * 所以周期任务会被铺到过去的日子上 —— 这是有意的：它是一个诚实的
 * 「那天按规则命中了什么」。要不要把过去的周期任务展示出来是**呈现**问题，
 * 由 `agendaOfDay` 决定。两处分开是为了让这个函数保持无 `now` 的纯展开。
 */
export function tasksOnDay(tasks: readonly Task[], dayStart: number): Task[] {
  const day = startOfDay(dayStart)
  const end = nextDayStart(day)

  const entries: Entry[] = []
  for (const task of tasks) {
    if (task.deletedAt !== null || task.kind === 'someday') continue
    if (task.kind === 'deadline') {
      if (task.dueAt < day || task.dueAt >= end) continue
    } else if (!matchesDay(task.rule, startOfDay(task.createdAt), day)) {
      continue
    }
    entries.push({ task, clock: clockOf(task, day) })
  }

  entries.sort(
    (a, b) =>
      a.clock - b.clock ||
      Number(b.task.important) - Number(a.task.important) ||
      a.task.createdAt - b.task.createdAt
  )
  return entries.map((e) => e.task)
}

/** 带统计的版本 —— 日历格子上的圆点与计数用它 */
export function agendaOfDay(tasks: readonly Task[], dayStart: number, now: number): DayAgenda {
  const day = startOfDay(dayStart)
  const today = startOfDay(now)
  const past = day < today

  // 过去的日子不带周期任务：它没有历史（只有 `lastDoneDay` + `streak`）。
  // 逾期都不算它，这里也不该替它记一笔 —— 把规则铺到上周，读起来就是
  // 「那天你有件没做」，而应用在别处（`done.ts` / `future.ts`）从来
  // 不主张这件事。今天与以后照常展开。
  const list = tasksOnDay(tasks, day).filter(
    (t) => !(past && t.kind === 'recurring' && t.lastDoneDay !== dayKey(day))
  )

  let pending = 0
  let overdue = 0
  for (const task of list) {
    if (isDone(task, day)) continue
    // 周期任务只在今天进圆点。习惯是背景，不是那天的欠账 ——
    // 一条「每天」的习惯会把整月每一格都点上，日历就不再是「扫一眼哪天有事」了。
    if (task.kind === 'recurring') {
      if (day === today) pending++
    } else if (task.kind === 'deadline') {
      pending++
      if (task.dueAt < today) overdue++
    }
  }

  return { key: dayKey(day), dayStart: day, tasks: list, pending, overdue }
}

/**
 * 一整个月的格子（含上下补齐的邻月日子）→ 每天的账。
 *
 * 一次算完再交给渲染层查表，而不是每个格子各 filter 一遍整份任务列表 ——
 * 42 个格子 × N 条任务是最容易被写成 O(42N) 的地方，而这个 N 会随时间长大。
 */
export function monthAgenda(
  tasks: readonly Task[],
  year: number,
  month1: number,
  now: number
): Map<string, DayAgenda> {
  const days = new Set<number>()
  for (const week of monthGrid(year, month1)) {
    for (const cell of week) days.add(cell.ts)
  }

  const out = new Map<string, DayAgenda>()
  for (const day of days) {
    const agenda = agendaOfDay(tasks, day, now)
    if (agenda.tasks.length === 0) continue
    out.set(agenda.key, agenda)
  }
  return out
}
