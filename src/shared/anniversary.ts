import { tsFromDayKey } from './calendar'
import { lunarOf, solarFromLunar } from './lunar'
import { dayIndex, dayKey, startOfDay } from './time'
import type { Anniversary } from './types'

/**
 * 纪念日。**它不是待办** —— 没有「完成」这个动作，也不提醒，
 * 只是「离那天还有多久」这件事本身。
 *
 * 所以它不挂在 `Task` 上：`Task` 的每一种都属于「要做的事」，
 * 共享着 `completedAt` / `firedFor` / 提醒时刻那一整套字段。
 * 硬塞进去的结果是每个关于待办的分支都要先排除它一次。
 *
 * ## 两种重复
 *
 *   - 公历每年重复：`date` 的月日，一年一次（生日、结婚纪念日）。
 *   - 农历每年重复（`lunar: true`）：按 `date` 那天的**农历月日**重复
 *     （农历生日、农历节日）。存的是公历锚点，农历月日从锚点推出来 ——
 *     让用户自己填「八月十五」既没有控件可用，也挡不住他填出一个
 *     不存在的日子（闰月、二十九、三十）。
 *   - `yearly: false`：一次性，就那一天（「高考」「手术复查」）。
 */

/** 2 月 29 日出生的人，在平年就过 2 月 28 日 —— 比落到 3 月 1 日符合直觉 */
function clampDay(year: number, month1: number, day: number): { month1: number; day: number } {
  const last = new Date(year, month1, 0).getDate()
  return { month1, day: Math.min(day, last) }
}

/** 解析 'YYYY-MM-DD'，同时给出年月日 */
function parts(date: string): { y: number; m: number; d: number } | null {
  const ts = tsFromDayKey(date)
  if (ts === null) return null
  const dt = new Date(ts)
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() }
}

export interface AnniversaryOccurrence {
  /** 下一次的那天，'YYYY-MM-DD' */
  at: string
  /** 距今天还有几天；0 = 就是今天；负数是已过（只可能出现在一次性纪念日上） */
  daysLeft: number
  /** 第几周年。一次性、或锚点在未来时给 null */
  years: number | null
  /** 从锚点那天到今天过了多少天（负数 = 锚点在未来） */
  sinceDays: number
  /** 按农历显示时的说明文字，如「农历八月十五」；公历为 null */
  lunarLabel: string | null
}

/**
 * 下一次发生。
 *
 * 农历生日有个绕不开的坑：闰月。锚点落在闰六月时，**不能**要求每年都有
 * 闰六月（有的年份没有），所以存的是「第几个月」而不是「哪个闰月」——
 * 闰六月十五的生日，平年就过六月十五。
 */
export function anniversaryOccurrence(a: Anniversary, now: number): AnniversaryOccurrence | null {
  const anchor = parts(a.date)
  if (anchor === null) return null

  const today = dayIndex(startOfDay(now))
  const sinceDays = today - dayIndex(startOfDay(tsFromDayKey(a.date)!))

  const lunarAnchor = a.lunar ? lunarOf(tsFromDayKey(a.date)!) : null
  const lunarLabel = lunarAnchor === null ? null : `农历${lunarAnchor.label}`

  if (!a.yearly) {
    return {
      at: a.date,
      daysLeft: sinceDays === 0 ? 0 : -sinceDays,
      years: null,
      sinceDays,
      lunarLabel
    }
  }

  // 从锚点那一年开始往后找第一次不早于今天的发生日。最多找两年就够 ——
  // 公历固定在一年内必然出现一次，农历最多差一个月（闰月）
  for (let step = 0; step <= 2; step++) {
    const year = new Date(now).getFullYear() + step
    let ts: number | null
    if (lunarAnchor !== null) {
      ts = solarFromLunar(year, lunarAnchor.month, lunarAnchor.day)
    } else {
      const c = clampDay(year, anchor.m, anchor.d)
      ts = startOfDay(new Date(year, c.month1 - 1, c.day).getTime())
    }
    if (ts === null) continue
    if (dayIndex(ts) >= today) {
      return {
        at: dayKey(ts),
        daysLeft: dayIndex(ts) - today,
        years: year - anchor.y,
        sinceDays,
        lunarLabel
      }
    }
  }
  return null
}

/** 按「还有几天」排：最近的在前，已过的最远者垫底 */
export function sortAnniversaries(list: Anniversary[], now: number): Anniversary[] {
  return [...list].sort((a, b) => {
    const oa = anniversaryOccurrence(a, now)
    const ob = anniversaryOccurrence(b, now)
    const da = oa === null ? Number.MAX_SAFE_INTEGER : Math.abs(oa.daysLeft)
    const db = ob === null ? Number.MAX_SAFE_INTEGER : Math.abs(ob.daysLeft)
    return da - db || a.createdAt - b.createdAt
  })
}

/**
 * 一句人话的距离。
 *
 * 「还有 1 天」而不是「还有 1 日」、「就是今天」而不是「还有 0 天」——
 * 倒数到 0 那天正是用户要的那天，把他推给一个 0 是没说清楚。
 */
export function daysLeftLabel(days: number): string {
  if (days === 0) return '就是今天'
  if (days > 0) return `还有 ${days} 天`
  return `已过 ${-days} 天`
}

/** 周年说法。第 0 周年没意义，锚点当年就说「今年」 */
export function yearsLabel(years: number | null): string | null {
  if (years === null) return null
  if (years <= 0) return '今年'
  return `第 ${years} 周年`
}

/** 农历纪念日的锚点是不是落在一个闰月里（界面提示用） */
export function anniversaryInLeapMonth(a: Anniversary): boolean {
  if (!a.lunar) return false
  const ts = tsFromDayKey(a.date)
  if (ts === null) return false
  return lunarOf(ts)?.isLeap === true
}
