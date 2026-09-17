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

/** 某年某月（月为 1-12）的天数 */
export function daysInMonth(year: number, month1based: number): number {
  return new Date(year, month1based, 0).getDate()
}

/**
 * 本地日期在日历上的绝对日序号。
 * 用 Date.UTC 归一化，因此不受夏令时影响（中国不适用，但别留坑）。
 */
export function dayIndex(ts: number): number {
  const d = new Date(ts)
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000)
}
