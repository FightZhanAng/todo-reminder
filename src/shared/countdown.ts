import { anniversaryOccurrence, sortAnniversaries, type AnniversaryOccurrence } from './anniversary'
import { upcomingHolidays, type HolidayInfo } from './holiday'
import type { Anniversary, Settings } from './types'

/**
 * 「倒计时」这本账的取数。
 *
 * 节假日与纪念日**放在同一个入口下**（同一个视图、同一套排序），
 * 但在这里各算什么、各按什么排序，是两件事：
 *
 *   - 假期按**距离**排，由近到远。正在进行中的那个排在最前 ——
 *     十月三日打开它，「国庆节」还应该在最上面，而不是跳到下一个假期。
 *   - 纪念日按**距离的绝对值**排。「上个月刚过完的生日」和「下个月的生日」
 *     都该出现在附近，否则刚过完那几天它会沉到列表最底下。
 *
 * 两个开关（要不要看节假日、只看到多少天以内）在设置里，
 * **过滤只在这里做一次** —— 视图只管画，计数与列表不会各说各话。
 */

export interface CountdownAnniversary {
  item: Anniversary
  occurrence: AnniversaryOccurrence
}

export interface Countdowns {
  holidays: HolidayInfo[]
  anniversaries: CountdownAnniversary[]
  /** 被「只看 N 天以内」挡掉的纪念日条数，界面用它说一句「还有 N 条更远」 */
  hiddenAnniversaries: number
}

export function collectCountdowns(
  now: number,
  anniversaries: readonly Anniversary[],
  settings: Pick<Settings, 'countdownHolidays' | 'countdownHorizonDays'>
): Countdowns {
  const horizon = settings.countdownHorizonDays > 0 ? settings.countdownHorizonDays : Infinity

  const holidays = settings.countdownHolidays
    ? upcomingHolidays(now, 20).filter((h) => h.daysUntil <= horizon)
    : []

  const sorted = sortAnniversaries([...anniversaries], now)
  const kept: CountdownAnniversary[] = []
  let hidden = 0
  for (const item of sorted) {
    const occurrence = anniversaryOccurrence(item, now)
    if (occurrence === null) continue
    // 已过的一次性纪念日（daysLeft < 0）永不隐藏 —— 它不会再发生，
    // 挡住它就等于把用户记下的那一天彻底藏起来
    if (occurrence.daysLeft > horizon) {
      hidden++
      continue
    }
    kept.push({ item, occurrence })
  }

  return { holidays, anniversaries: kept, hiddenAnniversaries: hidden }
}

/** 「10月1日—10月7日」/「10月1日」。跨月跨年都按真实日期写，不省略年份会太长 */
export function holidaySpanLabel(info: Pick<HolidayInfo, 'from' | 'to'>): string {
  const a = shortDate(info.from)
  const b = shortDate(info.to)
  return a === b ? a : `${a}—${b}`
}

export function shortDate(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (m === null) return key
  return `${Number(m[2])}月${Number(m[3])}日`
}

/** 「2026年10月1日」—— 跨年的那一天要带上年份才不含糊 */
export function fullDate(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (m === null) return key
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`
}
