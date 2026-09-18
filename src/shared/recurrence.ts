import { addDays, dayIndex, daysInMonth, startOfDay } from './time'
import type { RecurrenceRule, Weekday } from './types'

/**
 * 逐日推进的上限。覆盖 every ≤ 3 的月度规则 + 跳周末的所有组合绰绰有余。
 *
 * **已知边界（不报错，静默返回 null）**：月度规则 every > 13 时
 * （`every × 31 > 400`），`nextOccurrence` / `expandRecurrence` 会在 400 天内
 * 找不到命中日而返回 `null` / 空数组，而不是抛错。计划只覆盖 `every ≤ 3`，
 * 这个上限是刻意为「不做无界循环」付出的代价 —— 真要支持更大间隔，
 * 应把上限改成按规则计算而不是逐日推进。
 */
const SEARCH_LIMIT_DAYS = 400

/** `day` 与 `anchor` 都必须是某天的 00:00 */
export function matchesDay(rule: RecurrenceRule, anchor: number, day: number): boolean {
  const from = startOfDay(anchor)
  const target = startOfDay(day)

  const d = new Date(target)
  const wd = d.getDay() as Weekday
  const weekend = wd === 0 || wd === 6

  switch (rule.freq) {
    case 'daily': {
      if (target < from) return false
      if (rule.skipWeekend && weekend) return false
      if (rule.every <= 1) return true
      return (dayIndex(target) - dayIndex(from)) % rule.every === 0
    }

    case 'weekly': {
      if (target < from) return false
      // 显式指定了周末就按显式规则来，skipWeekend 不再生效
      const explicitWeekend = rule.days.some((x) => x === 0 || x === 6)
      if (rule.skipWeekend && !explicitWeekend && weekend) return false
      if (!rule.days.includes(wd)) return false
      if (rule.every <= 1) return true
      const weeks = Math.floor((dayIndex(target) - dayIndex(from)) / 7)
      return weeks % rule.every === 0
    }

    case 'monthly': {
      // 锚点按「月」对齐：同锚点月内的指定日均命中，不按具体锚点日做 day<anchor 拦截
      if (rule.skipWeekend && weekend) return false
      const last = daysInMonth(d.getFullYear(), d.getMonth() + 1)
      // 指定的号数超出当月天数时落在当月最后一天
      const picked = rule.days.map((n) => Math.min(n, last))
      if (!picked.includes(d.getDate())) return false
      if (rule.every <= 1) return true
      const anchorDate = new Date(from)
      const months =
        (d.getFullYear() - anchorDate.getFullYear()) * 12 + (d.getMonth() - anchorDate.getMonth())
      // 早于锚点月的月份一律不命中
      if (months < 0) return false
      return months % rule.every === 0
    }
  }
}

/** 严格晚于 `after` 的第一个命中日（00:00）。400 天内找不到返回 null */
export function nextOccurrence(rule: RecurrenceRule, anchor: number, after: number): number | null {
  const base = startOfDay(after)
  for (let i = 1; i <= SEARCH_LIMIT_DAYS; i++) {
    const candidate = startOfDay(addDays(base, i))
    if (matchesDay(rule, anchor, candidate)) return candidate
  }
  return null
}

/** 从 `from`（含）起往后取 `count` 个命中日 */
export function expandRecurrence(
  rule: RecurrenceRule,
  anchor: number,
  from: number,
  count: number
): number[] {
  const out: number[] = []
  if (count <= 0) return out

  let cursor = startOfDay(from)
  if (matchesDay(rule, anchor, cursor)) out.push(cursor)

  while (out.length < count) {
    const next = nextOccurrence(rule, anchor, cursor)
    if (next === null) break
    out.push(next)
    cursor = next
  }
  return out
}
