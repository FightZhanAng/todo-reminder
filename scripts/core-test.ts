/**
 * 核心逻辑无头测试。
 * 跑法：pnpm test:core
 *
 * 末尾的 PASS/FAIL 汇总行必须始终是本文件最后几行 ——
 * 后面每个任务都是在它之前插入新的测试段。
 */
let checks = 0
let failures = 0

function check(name: string, actual: unknown, expected: unknown): void {
  checks++
  if (actual === expected) {
    console.log(`ok    ${name}`)
    return
  }
  failures++
  console.log(`FAIL  ${name}`)
  console.log(`        实际 = ${String(actual)}`)
  console.log(`        期望 = ${String(expected)}`)
}

/** 本地时间构造，避免时区把测试搞成偶然通过 */
function at(y: number, m: number, d: number, h = 0, min = 0, s = 0): number {
  return new Date(y, m - 1, d, h, min, s, 0).getTime()
}

import { addDays, atTimeOfDay, dayIndex, dayKey, daysInMonth, parseHM, startOfDay } from '../src/shared/time'

console.log('\n--- time.ts ---')
check('dayKey 格式', dayKey(at(2026, 9, 16, 15, 30)), '2026-09-16')
check('dayKey 跨午夜前', dayKey(at(2026, 9, 16, 23, 59)), '2026-09-16')
check('dayKey 跨午夜后', dayKey(at(2026, 9, 17, 0, 1)), '2026-09-17')
check('dayKey 补零', dayKey(at(2026, 1, 5, 8, 0)), '2026-01-05')
check('startOfDay 归零', startOfDay(at(2026, 9, 16, 15, 30, 45)), at(2026, 9, 16, 0, 0, 0))
check('addDays 跨月', addDays(at(2026, 8, 31, 10, 0), 1), at(2026, 9, 1, 10, 0))
check('addDays 负数', addDays(at(2026, 9, 1, 10, 0), -1), at(2026, 8, 31, 10, 0))
check('atTimeOfDay', atTimeOfDay(at(2026, 9, 16, 15, 30), '09:00'), at(2026, 9, 16, 9, 0))
check('daysInMonth 1月', daysInMonth(2026, 1), 31)
check('daysInMonth 2月平年', daysInMonth(2026, 2), 28)
check('daysInMonth 2月闰年', daysInMonth(2024, 2), 29)
check('daysInMonth 4月', daysInMonth(2026, 4), 30)
check('parseHM 正常', JSON.stringify(parseHM('09:05')), JSON.stringify({ h: 9, m: 5 }))
check('parseHM 垃圾输入不炸', JSON.stringify(parseHM('abc')), JSON.stringify({ h: 0, m: 0 }))
check('dayIndex 相邻两天差 1', dayIndex(at(2026, 9, 16)) - dayIndex(at(2026, 9, 15)), 1)
check('dayIndex 跨月差 1', dayIndex(at(2026, 9, 1)) - dayIndex(at(2026, 8, 31)), 1)

import { expandRecurrence, matchesDay, nextOccurrence } from '../src/shared/recurrence'
import type { RecurrenceRule } from '../src/shared/types'

console.log('\n--- recurrence.ts ---')
{
  // 2026-09-14 是周一 ⇒ 15 周二、16 周三、18 周五、19 周六、20 周日、21 下周一、28 再下周一
  const anchor = at(2026, 9, 14)

  const daily: RecurrenceRule = { freq: 'daily', every: 1, skipWeekend: false }
  check('daily 下一个是次日', nextOccurrence(daily, anchor, at(2026, 9, 16)), at(2026, 9, 17))
  check('daily 当天命中', matchesDay(daily, anchor, at(2026, 9, 16)), true)
  check('daily 锚点之前不命中', matchesDay(daily, anchor, at(2026, 9, 13)), false)

  const dailySkip: RecurrenceRule = { freq: 'daily', every: 1, skipWeekend: true }
  check('跳周末：周五的下一个是周一', nextOccurrence(dailySkip, anchor, at(2026, 9, 18)), at(2026, 9, 21))
  check('跳周末：周六不命中', matchesDay(dailySkip, anchor, at(2026, 9, 19)), false)
  check('跳周末：周日不命中', matchesDay(dailySkip, anchor, at(2026, 9, 20)), false)

  const daily2: RecurrenceRule = { freq: 'daily', every: 2, skipWeekend: false }
  check('每 2 天：锚点当天命中', matchesDay(daily2, anchor, at(2026, 9, 14)), true)
  check('每 2 天：+1 不命中', matchesDay(daily2, anchor, at(2026, 9, 15)), false)
  check('每 2 天：+2 命中', matchesDay(daily2, anchor, at(2026, 9, 16)), true)
  check('每 2 天：+4 命中', matchesDay(daily2, anchor, at(2026, 9, 18)), true)

  const weekly: RecurrenceRule = { freq: 'weekly', every: 1, days: [1, 3], skipWeekend: false }
  check('weekly 周一命中', matchesDay(weekly, anchor, at(2026, 9, 21)), true)
  check('weekly 周三命中', matchesDay(weekly, anchor, at(2026, 9, 16)), true)
  check('weekly 周二不命中', matchesDay(weekly, anchor, at(2026, 9, 15)), false)
  check('weekly 周四的下一个是下周一', nextOccurrence(weekly, anchor, at(2026, 9, 17)), at(2026, 9, 21))

  const weekly2: RecurrenceRule = { freq: 'weekly', every: 2, days: [1], skipWeekend: false }
  check('每 2 周：锚点那周的周一命中', matchesDay(weekly2, anchor, at(2026, 9, 14)), true)
  check('每 2 周：下一周不命中', matchesDay(weekly2, anchor, at(2026, 9, 21)), false)
  check('每 2 周：再下一周命中', matchesDay(weekly2, anchor, at(2026, 9, 28)), true)

  // 显式指定周末优先于 skipWeekend（规格 §5 边界 4）
  const weeklyWeekendExplicit: RecurrenceRule = {
    freq: 'weekly', every: 1, days: [1, 6], skipWeekend: true
  }
  check('显式指定周一命中', matchesDay(weeklyWeekendExplicit, anchor, at(2026, 9, 21)), true)
  check('显式指定了周末则 skipWeekend 不生效', matchesDay(weeklyWeekendExplicit, anchor, at(2026, 9, 19)), true)
  const weeklyWeekdayOnly: RecurrenceRule = { freq: 'weekly', every: 1, days: [1], skipWeekend: true }
  check('未指定周末时 skipWeekend 生效', matchesDay(weeklyWeekdayOnly, anchor, at(2026, 9, 20)), false)

  // monthly：月末边界全部要过
  const monthly31: RecurrenceRule = { freq: 'monthly', every: 1, days: [31], skipWeekend: false }
  check('每月 31 号在 1 月', matchesDay(monthly31, at(2026, 1, 1), at(2026, 1, 31)), true)
  check('每月 31 号落在 2 月末（平年）', matchesDay(monthly31, at(2026, 1, 1), at(2026, 2, 28)), true)
  check('每月 31 号落在 2 月末（闰年）', matchesDay(monthly31, at(2024, 1, 1), at(2024, 2, 29)), true)
  check('每月 31 号落在 4 月末', matchesDay(monthly31, at(2026, 1, 1), at(2026, 4, 30)), true)
  check('每月 31 号在 3 月 30 日不命中', matchesDay(monthly31, at(2026, 1, 1), at(2026, 3, 30)), false)

  const monthly1: RecurrenceRule = { freq: 'monthly', every: 1, days: [1], skipWeekend: false }
  check('每月 1 号', matchesDay(monthly1, at(2026, 1, 1), at(2026, 3, 1)), true)
  check('每月 1 号的下一个', nextOccurrence(monthly1, at(2026, 1, 1), at(2026, 3, 1)), at(2026, 4, 1))

  const monthly2: RecurrenceRule = { freq: 'monthly', every: 2, days: [1], skipWeekend: false }
  check('每 2 月：锚点月命中', matchesDay(monthly2, at(2026, 1, 15), at(2026, 1, 1)), true)
  check('每 2 月：隔月不命中', matchesDay(monthly2, at(2026, 1, 15), at(2026, 2, 1)), false)
  check('每 2 月：再隔月命中', matchesDay(monthly2, at(2026, 1, 15), at(2026, 3, 1)), true)

  check(
    'expandRecurrence 取 3 个交易日',
    JSON.stringify(expandRecurrence(dailySkip, anchor, at(2026, 9, 18), 3)),
    JSON.stringify([at(2026, 9, 18), at(2026, 9, 21), at(2026, 9, 22)])
  )
  check(
    'expandRecurrence 从非命中日起算',
    JSON.stringify(expandRecurrence(weekly, anchor, at(2026, 9, 15), 2)),
    JSON.stringify([at(2026, 9, 16), at(2026, 9, 21)])
  )
  check('expandRecurrence count 为 0', expandRecurrence(daily, anchor, anchor, 0).length, 0)
}

console.log('\n--- 骨架自检 ---')
check('测试链路可用', 1 + 1, 2)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${checks - failures}/${checks} 项通过`)
if (failures > 0) process.exitCode = 1
