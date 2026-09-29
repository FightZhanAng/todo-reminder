import { addDays, dayIndex } from './time'

/**
 * 农历（阴阳历）的纯计算。**不 import electron、不碰 DOM** ——
 * 「2026 年春节到底是哪天」这种事只能在无头测试里断言，
 * 肉眼看一眼日历是看不出「这个月的月首算错了」的。
 *
 * ## 数据从哪来
 *
 * 农历没有公式可算 —— 朔望月的长度不等，只能查表。这里用的是
 * 1900–2100 的**权威压缩表**（`LUNAR_INFO`，201 个整数，中文互联网上
 * 通行的那一份，与紫金山天文台历书一致）。每年一个数，位含义见
 * `leapMonth` / `leapDays` / `monthDays` 三个函数。
 *
 * ## 怎么保证这张表没抄错
 *
 * 一个十六进制位抄错，整整一年的月份长度就全歪了，而界面上看起来
 * 只是「某天的农历日期不对」—— 极难发现。所以 `scripts/core-test.ts` 里有两道闸：
 *
 *   1. **锚点**：2024–2027 的春节、中秋、端午等日期全部来自国务院办公厅的
 *      放假通知（通知里写着「2 月 15 日（农历腊月二十八）」这种对照），
 *      逐年对得上才是对的；
 *   2. **冬至必落十一月**（`term.ts` 算出冬至，这里回头看它在几月）——
 *      这是农历**置闰规则的本身**：闰月就是「不含冬至的那一个月」。
 *      1900–2100 每年都验一遍，某年表错了通常会在这一步暴露。
 *
 * ## 时区
 *
 * 农历以**北京时间**为准。这里的入参是「本地某天」的时间戳，取的是它的
 * 本地年月日 —— 中国用户（UTC+8）身上两者完全一致；这台机器的开发与使用
 * 环境都在中国，不为跨时区的理论上正确去引入一层时区换算。
 */

/** 农历表的起止年。表外的日期按 null 处理，不猜 */
export const LUNAR_MIN_YEAR = 1900
export const LUNAR_MAX_YEAR = 2100

/**
 * 农历年基线：1900-01-31 是农历 1900 年正月初一。
 * 表的第 0 项（`0x04bd8`）就是 1900 年本身。
 */
const BASE_DAY = dayIndex(new Date(1900, 0, 31).getTime())
const BASE_TS = new Date(1900, 0, 31).getTime()

/**
 * 1900–2100 每年的编码，每年一个整数：
 *
 *   - bit 15..4  ：正月到腊月的大小月，置位 = 30 天，不置位 = 29 天
 *   - bit 3..0   ：闰月是几月（0 = 本年无闰月）
 *   - bit 16     ：闰月是大月（30 天）还是小月（29 天）
 *
 * 三个低位（17 以上）没用上 —— 有人在这张表里塞过节气信息，没必要。
 */
const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2, // 1900
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977, // 1910
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, // 1920
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950, // 1930
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557, // 1940
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0, // 1950
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, // 1960
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6, // 1970
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570, // 1980
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0, // 1990
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, // 2000
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930, // 2010
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530, // 2020
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, // 2030
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, // 2040
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0, // 2050
  0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4, // 2060
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, // 2070
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, // 2080
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252, // 2090
  0x0d520 // 2100
]

const DAY_NAMES = [
  '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'
]

/** 月份写汉字。十一月口语是「冬月」、十二月是「腊月」，日历上也是这么写的 */
const MONTH_NAMES = ['正', '二', '三', '四', '五', '六', '七', '八', '九', '十', '冬', '腊']

export interface LunarDate {
  /** 农历年 */
  year: number
  /** 1-12 */
  month: number
  /** 1-30 */
  day: number
  /** 是否闰月 */
  isLeap: boolean
  /** 「八月」「闰六月」 */
  monthName: string
  /** 「十五」 */
  dayName: string
  /** 「八月十五」「闰六月初一」 */
  label: string
}

function infoOf(year: number): number | null {
  if (year < LUNAR_MIN_YEAR || year > LUNAR_MAX_YEAR) return null
  return LUNAR_INFO[year - LUNAR_MIN_YEAR]!
}

/** 本年闰几月；0 = 无闰月 */
export function leapMonth(year: number): number {
  const info = infoOf(year)
  return info === null ? 0 : info & 0xf
}

/** 闰月的天数；无闰月给 0 */
export function leapDays(year: number): number {
  const info = infoOf(year)
  if (info === null || (info & 0xf) === 0) return 0
  return (info & 0x10000) !== 0 ? 30 : 29
}

/**
 * 农历某月（1-12）的天数。**不含闰月** —— 闰月的天数走 `leapDays`。
 * 位 15 是正月，往右依次到腊月（位 4）。
 */
export function monthDays(year: number, month: number): number {
  const info = infoOf(year)
  if (info === null || month < 1 || month > 12) return 0
  return (info & (0x10000 >> month)) !== 0 ? 30 : 29
}

/** 农历一年共多少天（含闰月）。平年 353–355，闰年 383–385 */
export function lunarYearDays(year: number): number {
  let sum = 0
  for (let m = 1; m <= 12; m++) sum += monthDays(year, m)
  return sum + leapDays(year)
}

/** 公历某天 → 农历。超出 1900–2100 给 null（不猜） */
export function lunarOf(ts: number): LunarDate | null {
  let offset = dayIndex(ts) - BASE_DAY
  if (offset < 0) return null

  let year = LUNAR_MIN_YEAR
  for (; year <= LUNAR_MAX_YEAR; year++) {
    const days = lunarYearDays(year)
    if (offset < days) break
    offset -= days
  }
  if (year > LUNAR_MAX_YEAR) return null

  const leap = leapMonth(year)
  let month = 1
  let isLeap = false
  for (; month <= 12; month++) {
    // 闰月排在「闰几月」的正月之后：闰六月在六月与七月之间
    const days = isLeap ? leapDays(year) : monthDays(year, month)
    if (offset < days) break
    offset -= days
    if (leap === month && !isLeap) {
      // 正六月过完，接下来是闰六月 —— 同一个 month 再走一遍
      isLeap = true
      month--
    } else if (isLeap) {
      isLeap = false
    }
  }

  const day = offset + 1
  const monthName = `${isLeap ? '闰' : ''}${MONTH_NAMES[month - 1]}月`
  const dayName = DAY_NAMES[day - 1] ?? ''
  return { year, month, day, isLeap, monthName, dayName, label: `${monthName}${dayName}` }
}

/** 农历 → 公历当天本地 00:00。月份/日期越界或超出表范围给 null */
export function solarFromLunar(
  year: number,
  month: number,
  day: number,
  isLeap = false
): number | null {
  if (infoOf(year) === null) return null
  if (month < 1 || month > 12) return null
  const leap = leapMonth(year)
  if (isLeap && leap !== month) return null

  const length = isLeap ? leapDays(year) : monthDays(year, month)
  if (day < 1 || day > length) return null

  let days = 0
  for (let y = LUNAR_MIN_YEAR; y < year; y++) days += lunarYearDays(y)
  for (let m = 1; m < month; m++) {
    days += monthDays(year, m)
    if (leap === m) days += leapDays(year)
  }
  if (isLeap) days += monthDays(year, month)
  days += day - 1

  return addDays(BASE_TS, days)
}

/**
 * 日历格子里那一行小字：优先节气（在 `term.ts`，调用方自己先问），
 * 其次传统节日，最后才是农历日期 —— 真实日历就是这个优先级。
 *
 * 初一显示月份名（「八月」）而不是「初一」：一整个月里只有一天是初一，
 * 那天写月份能让人知道**这个月是从哪儿开始的**。
 */
export function lunarCellLabel(ts: number): string {
  const l = lunarOf(ts)
  if (l === null) return ''
  const festival = lunarFestival(l)
  if (festival !== null) return festival
  return l.day === 1 ? l.monthName : l.dayName
}

/**
 * 传统节日（按农历月日定，与国务院的法定假日是两件事）。
 *
 * 除夕是**腊月最后一天**，不是「腊月三十」——腊月是小月时它落在二十九，
 * 写死 30 会整整漏掉一半的年份。
 */
export function lunarFestival(l: LunarDate): string | null {
  if (l.isLeap) return null
  const key = `${l.month}-${l.day}`
  switch (key) {
    case '1-1':
      return '春节'
    case '1-15':
      return '元宵节'
    case '5-5':
      return '端午节'
    case '7-7':
      return '七夕'
    case '7-15':
      return '中元节'
    case '8-15':
      return '中秋节'
    case '9-9':
      return '重阳节'
    case '12-8':
      return '腊八节'
  }
  if (l.month === 12 && l.day === monthDays(l.year, 12)) return '除夕'
  return null
}
