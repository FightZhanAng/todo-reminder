/** 'YYYY-MM-DD'（本地时区） */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime()
}

export function nextDayStart(ts: number): number {
  const d = new Date(startOfDay(ts))
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

export function addDays(ts: number, n: number): number {
  const d = new Date(ts)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

export function parseHM(hm: string): { h: number; m: number } {
  const [h, m] = hm.split(':').map((v) => Number.parseInt(v, 10))
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 }
}

export function formatClock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 把某天的时间置为 'HH:mm' */
export function atTimeOfDay(dayTs: number, hm: string): number {
  const { h, m } = parseHM(hm)
  const d = new Date(startOfDay(dayTs))
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

/** 某年某月（月为 1-12）的天数。月份越界给 0 —— 别让 `new Date` 替我们滚年 */
export function daysInMonth(year: number, month1based: number): number {
  if (!Number.isInteger(month1based) || month1based < 1 || month1based > 12) return 0
  return new Date(year, month1based, 0).getDate()
}

/**
 * 「下一个半点」的 'HH:mm'，用作快速添加窗的默认时刻。
 *
 * 默认值不能是「现在」—— 现在的意思就是立刻就过期。也**不能跨过午夜**：
 * 那个半点已经属于明天，而它会被「今天这个点」那颗按钮用掉，算出来的截止
 * 时刻是**今天**的，于是那个时刻落在过去，`dueNow` 的 `at <= createdAt`
 * 一挡，这条任务永远不会提醒（界面却照常显示它今天到期）。
 * 所以跨午夜时退回今天的最后一分钟。
 */
export function nextHalfHourClock(now: number): string {
  const d = new Date(now)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + (30 - (d.getMinutes() % 30)))
  return dayKey(d.getTime()) === dayKey(now) ? formatClock(d.getTime()) : '23:59'
}

/**
 * 本地日期在日历上的绝对日序号。
 * 用 Date.UTC 归一化，因此不受夏令时影响（中国不适用，但别留坑）。
 */
export function dayIndex(ts: number): number {
  const d = new Date(ts)
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}

/** 星期几的显示名。下标即 `Date.getDay()`（0 = 周日）—— 与 types.ts 的 Weekday 同一约定 */
export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
