import { tsFromDayKey } from './calendar'
import { addDays, dayIndex, dayKey, startOfDay } from './time'

/**
 * 法定节假日与调休。**数据是抄来的，不是算出来的** ——
 * 放假安排在每年 10 月底由国务院办公厅发一份通知定下来，
 * 谁也推不出明年春节怎么调休。
 *
 * ## 数据来源
 *
 * 每一条都对着《国务院办公厅关于 X 年部分节假日安排的通知》抄的
 * （通知里写死了「2 月 15 日（农历腊月二十八、周日）至 23 日放假调休，
 * 共 9 天；2 月 14 日、2 月 28 日上班」这种句子）。所以：
 *
 *   - `runs` 只收通知里**明确给出起止**的放假段，或者它明确给出的单日
 *     （「1 月 1 日放假 1 天」）。通知说「与周末连休」时只记那天 ——
 *     连着的那两天本来就是周末，日历上标成「周末」比标成节日更准。
 *   - `workdays` 是调休上班的那几天，`name` 记它**是为哪个节**上的班
 *     （日历上只写个「班」，点开那天的明细才需要说清楚）。
 *
 * ## 没有数据的年份
 *
 * 2027 年的安排要等到 2026 年 10 月底才公布，所以 2027 年**现在没有数据**，
 * 这不是遗漏。没覆盖到的年份一律退回「周六周日休息」这个默认判断，
 * 界面会明说「这一年还没公布」。宁可说得少，也不要拿规则硬猜 ——
 * 猜错一天，用户就会按错的日期去请假。
 */

export interface HolidayRun {
  /** 节日名，与通知里的写法一致 */
  name: string
  /** 'YYYY-MM-DD'，含当天 */
  from: string
  /** 'YYYY-MM-DD'，含当天 */
  to: string
}

export interface HolidayWorkday {
  /** 'YYYY-MM-DD' */
  day: string
  /** 为哪个节上的班 */
  name: string
}

export interface HolidayYear {
  year: number
  runs: HolidayRun[]
  workdays: HolidayWorkday[]
}

export const HOLIDAY_YEARS: readonly HolidayYear[] = [
  {
    year: 2024,
    runs: [
      { name: '元旦', from: '2024-01-01', to: '2024-01-01' },
      { name: '春节', from: '2024-02-10', to: '2024-02-17' },
      { name: '清明节', from: '2024-04-04', to: '2024-04-06' },
      { name: '劳动节', from: '2024-05-01', to: '2024-05-05' },
      { name: '端午节', from: '2024-06-10', to: '2024-06-10' },
      { name: '中秋节', from: '2024-09-15', to: '2024-09-17' },
      { name: '国庆节', from: '2024-10-01', to: '2024-10-07' }
    ],
    workdays: [
      { day: '2024-02-04', name: '春节' },
      { day: '2024-02-18', name: '春节' },
      { day: '2024-04-07', name: '清明节' },
      { day: '2024-04-28', name: '劳动节' },
      { day: '2024-05-11', name: '劳动节' },
      { day: '2024-09-14', name: '中秋节' },
      { day: '2024-09-29', name: '国庆节' },
      { day: '2024-10-12', name: '国庆节' }
    ]
  },
  {
    year: 2025,
    runs: [
      { name: '元旦', from: '2025-01-01', to: '2025-01-01' },
      { name: '春节', from: '2025-01-28', to: '2025-02-04' },
      { name: '清明节', from: '2025-04-04', to: '2025-04-06' },
      { name: '劳动节', from: '2025-05-01', to: '2025-05-05' },
      { name: '端午节', from: '2025-05-31', to: '2025-06-02' },
      { name: '国庆节·中秋节', from: '2025-10-01', to: '2025-10-08' }
    ],
    workdays: [
      { day: '2025-01-26', name: '春节' },
      { day: '2025-02-08', name: '春节' },
      { day: '2025-04-27', name: '劳动节' },
      { day: '2025-09-28', name: '国庆节·中秋节' },
      { day: '2025-10-11', name: '国庆节·中秋节' }
    ]
  },
  {
    year: 2026,
    runs: [
      { name: '元旦', from: '2026-01-01', to: '2026-01-03' },
      { name: '春节', from: '2026-02-15', to: '2026-02-23' },
      { name: '清明节', from: '2026-04-04', to: '2026-04-06' },
      { name: '劳动节', from: '2026-05-01', to: '2026-05-05' },
      { name: '端午节', from: '2026-06-19', to: '2026-06-21' },
      { name: '中秋节', from: '2026-09-25', to: '2026-09-27' },
      { name: '国庆节', from: '2026-10-01', to: '2026-10-07' }
    ],
    workdays: [
      { day: '2026-01-04', name: '元旦' },
      { day: '2026-02-14', name: '春节' },
      { day: '2026-02-28', name: '春节' },
      { day: '2026-05-09', name: '劳动节' },
      { day: '2026-09-20', name: '国庆节' },
      { day: '2026-10-10', name: '国庆节' }
    ]
  }
]

/** 有数据的年份（升序）。界面靠它说「这一年还没公布」 */
export const KNOWN_YEARS: readonly number[] = HOLIDAY_YEARS.map((y) => y.year)

export function holidayYearKnown(year: number): boolean {
  return HOLIDAY_YEARS.some((y) => y.year === year)
}

/** 已公布到哪一年 —— 日历翻过这一年就该说一句「安排未公布」 */
export const LATEST_KNOWN_YEAR: number = KNOWN_YEARS[KNOWN_YEARS.length - 1] ?? 0

/**
 * 一天的属性。
 *
 * `holiday` 与 `weekend` 分开而不是合成一个「休息」：日历上标「休」的
 * 是**法定假期**，标「周末」的是普通双休 —— 前者关系到能不能安排出行，
 * 后者不关系。调休上班也绝不是「工作日」，它是一年里最容易被忘掉的日子。
 */
export type DayKind = 'holiday' | 'weekend' | 'adjusted-work' | 'workday'

export interface DayMark {
  kind: DayKind
  /** 放假的节日名 / 为哪个节调休；周末与普通工作日为 null */
  name: string | null
}

const WEEKEND: DayMark = { kind: 'weekend', name: null }
const WORKDAY: DayMark = { kind: 'workday', name: null }

/**
 * dayKey → 标记。表很小（三年共 21 个放假段 + 19 个调休日），
 * 启动时摊平一次，之后每次查都是 O(1) —— 日历一屏要问 42 次。
 */
let marks: Map<string, DayMark> | null = null

function markMap(): Map<string, DayMark> {
  if (marks !== null) return marks
  const out = new Map<string, DayMark>()
  for (const year of HOLIDAY_YEARS) {
    for (const run of year.runs) {
      const from = tsFromDayKey(run.from)
      const to = tsFromDayKey(run.to)
      if (from === null || to === null) continue
      for (let ts = from; ts <= to; ts = addDays(ts, 1)) {
        out.set(dayKey(ts), { kind: 'holiday', name: run.name })
      }
    }
    for (const w of year.workdays) {
      if (tsFromDayKey(w.day) === null) continue
      out.set(w.day, { kind: 'adjusted-work', name: w.name })
    }
  }
  marks = out
  return out
}

/** 某天的属性。没数据的年份按周六周日判周末 */
export function dayMarkOf(ts: number): DayMark {
  const hit = markMap().get(dayKey(ts))
  if (hit !== undefined) return hit
  const wd = new Date(ts).getDay()
  return wd === 0 || wd === 6 ? WEEKEND : WORKDAY
}

/** 这天休不休（法定假期或周末）。调休上班日不休 */
export function isRestDay(ts: number): boolean {
  const kind = dayMarkOf(ts).kind
  return kind === 'holiday' || kind === 'weekend'
}

export interface HolidayPosition {
  run: HolidayRun
  /** 这个假期的第几天（1 起） */
  index: number
  /** 一共几天 */
  span: number
}

/** 某天落在哪个放假段里的第几天。不在假期里给 null（明细面板用） */
export function holidayPositionOf(ts: number): HolidayPosition | null {
  const key = dayKey(ts)
  for (const year of HOLIDAY_YEARS) {
    for (const run of year.runs) {
      const from = tsFromDayKey(run.from)
      const to = tsFromDayKey(run.to)
      if (from === null || to === null) continue
      const start = dayIndex(from)
      const end = dayIndex(to)
      const at = dayIndex(ts)
      if (at >= start && at <= end) {
        return { run, index: at - start + 1, span: end - start + 1 }
      }
    }
  }
  return null
}

/** 调休上班那天是为哪个节 */
export function makeupFor(ts: number): string | null {
  const mark = markMap().get(dayKey(ts))
  return mark?.kind === 'adjusted-work' ? mark.name : null
}

export interface HolidayInfo {
  name: string
  from: string
  to: string
  /** 连续放几天 */
  span: number
  /** 距开始还有几天。今天开始或正在进行 = 0 */
  daysUntil: number
  /** 今天是这个假期的第几天（1 起）；还没开始给 null */
  indexInRun: number | null
}

function spanOf(run: HolidayRun): { start: number; end: number } | null {
  const from = tsFromDayKey(run.from)
  const to = tsFromDayKey(run.to)
  if (from === null || to === null) return null
  return { start: dayIndex(from), end: dayIndex(to) }
}

/**
 * 从今天起的假期，含**正在进行中的那个** ——
 * 十月三日打开这个界面时，「下一个假期」应该还是国庆，只是说法从
 * 「还有 2 天」变成「今天是第 3 天」。过掉的段不返回。
 */
export function upcomingHolidays(now: number, limit = 8): HolidayInfo[] {
  const today = dayIndex(startOfDay(now))
  const out: HolidayInfo[] = []
  for (const year of HOLIDAY_YEARS) {
    for (const run of year.runs) {
      const span = spanOf(run)
      if (span === null || span.end < today) continue
      out.push({
        name: run.name,
        from: run.from,
        to: run.to,
        span: span.end - span.start + 1,
        daysUntil: Math.max(0, span.start - today),
        indexInRun: today >= span.start ? today - span.start + 1 : null
      })
    }
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil || a.from.localeCompare(b.from))
  return out.slice(0, limit)
}

/** 紧接着的那个假期（进行中的算它）。一处定义，底栏与倒计时页共用 */
export function nextHoliday(now: number): HolidayInfo | null {
  return upcomingHolidays(now, 1)[0] ?? null
}

/**
 * 「这一年为什么没有休/班标记」的一句话。
 *
 * 两种成因得分清楚说：一种是这一年**还没公布**（将来的年份），
 * 一种是这一年在**这份表之前**（表只从 2024 年收起）。
 * 合起来说成「未公布」会让 2023 年看起来像还没定下来。
 */
export function holidayCoverageNote(year: number): string | null {
  if (holidayYearKnown(year)) return null
  const first = KNOWN_YEARS[0]
  if (first !== undefined && year < first) {
    return `${year} 年的放假安排没有收录，这一年只标周末（数据从 ${first} 年起）`
  }
  return `${year} 年的放假安排还没公布，这一年只标周末（已公布到 ${LATEST_KNOWN_YEAR} 年）`
}
