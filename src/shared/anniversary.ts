import { tsFromDayKey } from './calendar'
import { lunarOf, solarFromLunar } from './lunar'
import { atTimeOfDay, dayIndex, dayKey, startOfDay } from './time'
import type { Anniversary, Settings } from './types'

/**
 * 纪念日。**它不是待办** —— 没有「完成」这个动作，
 * 只有「离那天还有多久」这件事本身，外加一句「到那天要不要说一声」。
 *
 * 所以它不挂在 `Task` 上：`Task` 的每一种都属于「要做的事」，
 * 共享着 `completedAt` / `deletedAt` / `kind` / 软删与撤销那一整套字段。
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

/**
 * 一条到点的纪念日。
 *
 * `at` 是提醒点（那一刻），`day` 是幂等键（那一天）—— 两个都要，因为
 * 幂等是**按天**算的而排序、去重、触发判据都是按刻算的。把它们合成一个
 * 字段会让「09:00 弹过、11:00 改了提醒时刻」这条路径上的语义变得说不清。
 */
export interface AnniversaryEntry {
  anniversary: Anniversary
  /** 该弹的提醒点：发生那天的「全天提醒时刻」 */
  at: number
  /** 那一天零点的 ts。`firedFor` 比的就是它 */
  day: number
  /** 那一刻算出来的发生情况 —— 通知文案直接用这份，免得两处各算一遍各说各话 */
  occurrence: AnniversaryOccurrence
}

/**
 * 纪念日的提醒点。
 *
 * 复用设置里那个「全天提醒时刻」，**不给纪念日单独一个时刻**：它和全天型
 * 待办本来就是同一件事（只有日期没有时刻），再多一个设置项只会让人在两个
 * 地方各调一次。
 *
 * 返回值可能是过去也可能是将来（与 `remindAtOf` 同型），由调用方按
 * 「≤ now」过滤 —— 所以这里不判断「该不该现在弹」，只回答「下一次是几点」。
 */
export function anniversaryRemindAt(
  a: Anniversary,
  settings: Settings,
  now: number
): { at: number; day: number; occurrence: AnniversaryOccurrence } | null {
  if (!a.notify) return null

  const occurrence = anniversaryOccurrence(a, now)
  if (occurrence === null) return null
  // 一次性纪念日过完就完了。负数只可能出现在它身上 ——
  // 每年重复的永远返回「下一次」，不会给负数
  if (occurrence.daysLeft < 0) return null

  const dayTs = tsFromDayKey(occurrence.at)
  if (dayTs === null) return null

  return { at: atTimeOfDay(dayTs, settings.allDayRemindTime), day: dayTs, occurrence }
}

/**
 * 挑出此刻该弹的纪念日。三条过滤规则：
 *   1. 提醒点必须 ≤ now
 *   2. 提醒点必须晚于创建时间 —— 与任务同一条：今天下午新建一条「今天」的
 *      纪念日，不该被自己早上那个提醒点打脸
 *   3. 那一天还没弹过（比 `firedFor`，比的是**天**不是刻）
 *
 * ## 与任务那边唯一的、也是刻意的差别：没有「错过」这一档
 *
 * 纪念日说的是一整天（「今天就是那天」），不是某一刻。早上九点没开机、
 * 十一点才开，这条仍然该弹，而且该当成「刚到的」直接弹。所以这里不做
 * `MISS_GRACE_MS` 的切分，命中的一律走新鲜批次，也**不会**被揉进
 * 「有 N 件事错过了」那条聚合通知里 —— 把生日说成「错过了」是错的。
 */
export function dueAnniversaries(
  list: readonly Anniversary[],
  settings: Settings,
  now: number
): AnniversaryEntry[] {
  const out: AnniversaryEntry[] = []
  for (const a of list) {
    const hit = anniversaryRemindAt(a, settings, now)
    if (hit === null) continue
    if (hit.at > now) continue
    if (hit.at <= a.createdAt) continue
    if (hit.day === a.firedFor) continue
    out.push({ anniversary: a, at: hit.at, day: hit.day, occurrence: hit.occurrence })
  }
  return out.sort((x, y) => x.at - y.at)
}
