import { WEEKDAYS, dayIndex, dayKey, daysInMonth, startOfDay } from './time'

/**
 * 月历的纯计算。**控制器与渲染分离**：日期控件的所有「算」都在这里，
 * 组件只负责画和点 —— 于是「9 月 1 号是周二、前面要空几格」这类最容易
 * 差一格的逻辑可以在无头测试里断言，不用靠肉眼看弹出来的日历。
 */

/** 月份写汉字。和宋体的「18」是同一副账簿口气，也顺带把它和数字分开 */
export const CN_MONTHS = [
  '一月',
  '二月',
  '三月',
  '四月',
  '五月',
  '六月',
  '七月',
  '八月',
  '九月',
  '十月',
  '十一月',
  '十二月'
]

/** 月历表头：一周从周一起 —— 和 TaskEditor 的星期选择器同一个顺序 */
export const CAL_HEADERS = [1, 2, 3, 4, 5, 6, 0].map((d) => WEEKDAYS[d].slice(1))

export interface MonthRef {
  year: number
  /** 1-12 */
  month1: number
}

export interface MonthCell {
  /** 当天本地 00:00 */
  ts: number
  day: number
  /** false = 补在月初/月末的邻月日子 */
  inMonth: boolean
  /** 0 = 周日 */
  weekday: number
}

export function monthOf(ts: number): MonthRef {
  const d = new Date(ts)
  return { year: d.getFullYear(), month1: d.getMonth() + 1 }
}

/** 翻月。跨年由 Date 自己算，不用手写进位 */
export function shiftMonth(m: MonthRef, delta: number): MonthRef {
  return monthOf(new Date(m.year, m.month1 - 1 + delta, 1).getTime())
}

export function monthLabel(m: MonthRef): string {
  return `${m.year} 年 ${CN_MONTHS[m.month1 - 1]}`
}

/**
 * 一个月的格子，**周一起始**、每行 7 个、首尾补齐成整周。
 *
 * 前导格数 = (星期几 + 6) % 7：周一落到 0、周日落到 6。
 * 补出来的邻月日子照常返回真实时间戳（点得动），只是 `inMonth: false` 画淡一点 ——
 * 这样「9 月 30 号之后那天是不是 10 月 1 号」在界面上直接看得见。
 */
export function monthGrid(year: number, month1: number): MonthCell[][] {
  const first = new Date(year, month1 - 1, 1)
  const lead = (first.getDay() + 6) % 7
  const total = lead + daysInMonth(year, month1)
  const rows = Math.ceil(total / 7)

  const weeks: MonthCell[][] = []
  for (let row = 0; row < rows; row++) {
    const week: MonthCell[] = []
    for (let col = 0; col < 7; col++) {
      const offset = row * 7 + col - lead
      const ts = startOfDay(new Date(year, month1 - 1, 1 + offset).getTime())
      const d = new Date(ts)
      week.push({ ts, day: d.getDate(), inMonth: offset >= 0 && offset < total - lead, weekday: d.getDay() })
    }
    weeks.push(week)
  }
  return weeks
}

/**
 * 'YYYY-MM-DD' → 当天本地 00:00。格式不对给 null，不抛错。
 *
 * **用回写比对兜住「像日期但不是日期」的输入**：`2026-02-31` 能过正则，
 * 但 `new Date(2026, 1, 31)` 会静默滚到 3 月 3 日 —— 不比对的话，用户
 * 看到的是 2 月 31 号，存下去的是 3 月 3 号。比对一次只要几微秒。
 */
export function tsFromDayKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (m === null) return null
  const year = Number(m[1])
  const month1 = Number(m[2])
  const day = Number(m[3])
  if (month1 < 1 || month1 > 12 || day < 1 || day > 31) return null
  const ts = startOfDay(new Date(year, month1 - 1, day).getTime())
  return dayKey(ts) === key ? ts : null
}

/** 单元格 → 'YYYY-MM-DD'（写回表单用的格式） */
export function dayKeyOf(cell: MonthCell): string {
  return dayKey(cell.ts)
}

/**
 * 人话版的相对日：
 *   今天 / 明天 / 后天 / 昨天 / 前天 / N 天后 / N 天前
 * 一周之外返回 null —— 「9 月 3 日」旁边写「15 天前」没有意义。
 */
export function relativeDayLabel(ts: number, now: number): string | null {
  const diff = dayIndex(ts) - dayIndex(now)
  switch (diff) {
    case 0:
      return '今天'
    case 1:
      return '明天'
    case 2:
      return '后天'
    case -1:
      return '昨天'
    case -2:
      return '前天'
  }
  if (diff > 2 && diff <= 7) return `${diff} 天后`
  if (diff < -2 && diff >= -7) return `${-diff} 天前`
  return null
}

/**
 * 分组标题用的日名：一周以内说相对话，一周以外换成「9月16日 周三」。
 *
 * 已完成那本账和「以后」那本账要的是同一件事 —— 给一天起个名。
 * 两边各写一遍的话，「一周」这个界线迟早只有一边是对的。
 */
export function dayLabel(ts: number, now: number): string {
  const rel = relativeDayLabel(ts, now)
  if (rel !== null) return rel
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
}

/**
 * 下一个**严格晚于** today 的某个星期几（0 = 周日）。
 * 「下周一」不能理解成「本周还没过去的那个周一」—— 今天是周一的时候它得是 7 天后。
 */
export function nextWeekdayAfter(today: number, weekday: number): number {
  const from = new Date(startOfDay(today))
  const delta = ((weekday - from.getDay() + 7) % 7) || 7
  from.setDate(from.getDate() + delta)
  return from.getTime()
}
