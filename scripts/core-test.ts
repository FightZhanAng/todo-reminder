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

import { DEFAULT_SETTINGS } from '../src/shared/defaults'
import type { DeadlineTask, RecurringTask, SomedayTask, Task } from '../src/shared/types'

function deadline(patch: Partial<DeadlineTask> = {}): DeadlineTask {
  return {
    kind: 'deadline',
    id: 'd1',
    title: '交周报',
    important: false,
    createdAt: at(2026, 9, 16, 8, 0),
    updatedAt: at(2026, 9, 16, 8, 0),
    deletedAt: null,
    firedFor: null,
    pushedFor: null,
    dueAt: at(2026, 9, 16, 16, 30),
    allDay: false,
    leadMin: 15,
    snoozeUntil: null,
    completedAt: null,
    ...patch
  }
}

function recurring(patch: Partial<RecurringTask> = {}): RecurringTask {
  return {
    kind: 'recurring',
    id: 'r1',
    title: '早上看简历',
    important: false,
    createdAt: at(2026, 9, 14),
    updatedAt: at(2026, 9, 14),
    deletedAt: null,
    firedFor: null,
    pushedFor: null,
    rule: { freq: 'daily', every: 1, skipWeekend: false },
    remindTime: '09:00',
    lastDoneDay: null,
    streak: 0,
    ...patch
  }
}

function someday(patch: Partial<SomedayTask> = {}): SomedayTask {
  return {
    kind: 'someday',
    id: 's1',
    title: '想看的书',
    important: false,
    createdAt: at(2026, 9, 14),
    updatedAt: at(2026, 9, 14),
    deletedAt: null,
    firedFor: null,
    pushedFor: null,
    ...patch
  }
}

/** 测试用的设置基线 */
const S = { ...DEFAULT_SETTINGS, allDayRemindTime: '09:00', defaultLeadMin: 15 }

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

import { dueNow, isRemindable, remindAtOf } from '../src/shared/remind'

console.log('\n--- remind.ts ---')
check('isRemindable 排除清单池', isRemindable(someday()), false)
check('isRemindable 认得截止型', isRemindable(deadline()), true)

check('截止型：提醒点 = 截止 - 提前量', remindAtOf(deadline(), S, at(2026, 9, 16, 8, 0)), at(2026, 9, 16, 16, 15))
check('全天型：提醒点 = 当天 09:00', remindAtOf(deadline({ allDay: true }), S, at(2026, 9, 16, 8, 0)), at(2026, 9, 16, 9, 0))
check('已完成不再提醒', remindAtOf(deadline({ completedAt: at(2026, 9, 16, 12, 0) }), S, at(2026, 9, 16, 12, 0)), null)
check('已软删除不再提醒', remindAtOf(deadline({ deletedAt: at(2026, 9, 16, 12, 0) }), S, at(2026, 9, 16, 12, 0)), null)
check('推迟后提醒点用 snoozeUntil', remindAtOf(deadline({ snoozeUntil: at(2026, 9, 16, 17, 0) }), S, at(2026, 9, 16, 16, 15)), at(2026, 9, 16, 17, 0))

check('周期型：今天该做则给今天的提醒时刻', remindAtOf(recurring(), S, at(2026, 9, 16, 8, 0)), at(2026, 9, 16, 9, 0))
check('周期型：今天已做则 null', remindAtOf(recurring({ lastDoneDay: '2026-09-16' }), S, at(2026, 9, 16, 10, 0)), null)
check(
  '周期型：今天不该做则 null',
  remindAtOf(recurring({ rule: { freq: 'weekly', every: 1, days: [1], skipWeekend: false } }), S, at(2026, 9, 16, 8, 0)),
  null
)

console.log('\n--- dueNow ---')
{
  const now = at(2026, 9, 16, 16, 20)

  // 提醒点 16:15，创建于 08:00 → 该弹
  check('到点且未弹过 → 弹出', dueNow([deadline()], S, now).length, 1)
  check('到点且未弹过 → 携带提醒点', dueNow([deadline()], S, now)[0].at, at(2026, 9, 16, 16, 15))
  check('已弹过 → 不再弹', dueNow([deadline({ firedFor: at(2026, 9, 16, 16, 15) })], S, now).length, 0)
  check('未到点 → 不弹', dueNow([deadline()], S, at(2026, 9, 16, 16, 0)).length, 0)

  // 规格 §5 边界 5：提醒点早于创建时间 → 不提醒
  // 15:50 建一个 16:00 截止、提前 15 分钟的任务，提醒点 15:45 比创建时间还早
  const lateCreated = deadline({ createdAt: at(2026, 9, 16, 15, 50), dueAt: at(2026, 9, 16, 16, 0) })
  check('提醒点早于创建时间 → 不弹', dueNow([lateCreated], S, now).length, 0)

  // 排序：按提醒点升序（b 的提醒点 16:45，a 的 17:45）
  const a = deadline({ id: 'a', dueAt: at(2026, 9, 16, 18, 0) })
  const b = deadline({ id: 'b', dueAt: at(2026, 9, 16, 17, 0) })
  check('结果按提醒点升序', dueNow([a, b], S, at(2026, 9, 16, 18, 0)).map((e) => e.task.id).join(','), 'b,a')
}

console.log('\n--- 骨架自检 ---')
check('测试链路可用', 1 + 1, 2)

import { groupMissed, groupToday } from '../src/shared/group'
import { inQuietHours } from '../src/shared/quiet'

console.log('\n--- group.ts ---')
{
  const now = at(2026, 9, 16, 12, 0)   // 周三

  const overdueTask = deadline({ id: 'o1', dueAt: at(2026, 9, 15, 16, 0) })
  const todayTimed = deadline({ id: 'u1', dueAt: at(2026, 9, 16, 16, 30) })
  const todayAllDay = deadline({ id: 'a1', dueAt: at(2026, 9, 16), allDay: true })
  const tomorrowTimed = deadline({ id: 'u2', dueAt: at(2026, 9, 17, 10, 0) })
  const doneToday = deadline({ id: 'u3', dueAt: at(2026, 9, 16, 18, 0), completedAt: now })
  const gone = deadline({ id: 'u4', dueAt: at(2026, 9, 16, 19, 0), deletedAt: now })
  const dueToday = recurring({ id: 'r1' })
  const notToday = recurring({ id: 'r2', rule: { freq: 'weekly', every: 1, days: [1], skipWeekend: false } })
  const doneRecurring = recurring({ id: 'r3', lastDoneDay: '2026-09-16' })

  const all: Task[] = [
    overdueTask, todayTimed, todayAllDay, tomorrowTimed, doneToday, gone,
    dueToday, notToday, doneRecurring, someday()
  ]
  const g = groupToday(all, S, now)

  check('逾期只有 1 条', g.overdue.map((t) => t.id).join(','), 'o1')
  check('接下来只有带时刻的今日任务', g.upcoming.map((t) => t.id).join(','), 'u1')
  check('今天随时只有全天型的今日任务', g.anytime.map((t) => t.id).join(','), 'a1')
  check('每天只有今天该做且未做的', g.recurring.map((t) => t.id).join(','), 'r1')
  check('已完成不进任何段', g.upcoming.concat(g.anytime).some((t) => t.id === 'u3'), false)
  check('已软删除不进任何段', g.upcoming.concat(g.anytime).some((t) => t.id === 'u4'), false)
  check('明天的任务不在今天', g.upcoming.concat(g.anytime).some((t) => t.id === 'u2'), false)

  const imp = deadline({ id: 'a2', dueAt: at(2026, 9, 16), allDay: true, important: true })
  check('今天随时：important 优先', groupToday([todayAllDay, imp], S, now).anytime.map((t) => t.id).join(','), 'a2,a1')
}

console.log('\n--- groupMissed ---')
{
  const now = at(2026, 9, 16, 12, 0)
  const entries = [
    { task: deadline({ id: 'f1' }), at: at(2026, 9, 16, 11, 55) },  // 5 分钟前
    { task: deadline({ id: 'm1' }), at: at(2026, 9, 16, 8, 0) },    // 4 小时前
    { task: deadline({ id: 'f2' }), at: at(2026, 9, 16, 11, 50) },  // 正好 10 分钟
    { task: deadline({ id: 'm2' }), at: at(2026, 9, 16, 11, 49, 59) }
  ]
  const r = groupMissed(entries, now)
  check('fresh 含 5 分钟前那条', r.fresh.some((e) => e.task.id === 'f1'), true)
  check('missed 含 4 小时前那条', r.missed.some((e) => e.task.id === 'm1'), true)
  check('正好 10 分钟算 fresh', r.fresh.some((e) => e.task.id === 'f2'), true)
  check('超过 10 分钟算 missed', r.missed.some((e) => e.task.id === 'm2'), true)
  check('空数组不炸', groupMissed([], now).fresh.length, 0)
}

console.log('\n--- quiet.ts ---')
{
  const overnight = { ...S, quietHours: { start: '22:00', end: '08:00' } }
  check('跨午夜：23:00 静默', inQuietHours(overnight, at(2026, 9, 16, 23, 0)), true)
  check('跨午夜：07:00 静默', inQuietHours(overnight, at(2026, 9, 16, 7, 0)), true)
  check('跨午夜：12:00 不静默', inQuietHours(overnight, at(2026, 9, 16, 12, 0)), false)
  check('跨午夜：08:00 整点结束', inQuietHours(overnight, at(2026, 9, 16, 8, 0)), false)
  check('跨午夜：22:00 整点开始', inQuietHours(overnight, at(2026, 9, 16, 22, 0)), true)

  const daytime = { ...S, quietHours: { start: '09:00', end: '18:00' } }
  check('同日时段内 12:00', inQuietHours(daytime, at(2026, 9, 16, 12, 0)), true)
  check('同日时段外 20:00', inQuietHours(daytime, at(2026, 9, 16, 20, 0)), false)

  check('未配置免打扰时段', inQuietHours(S, at(2026, 9, 16, 23, 0)), false)
  check('起止相同视为不启用', inQuietHours({ ...S, quietHours: { start: '09:00', end: '09:00' } }, at(2026, 9, 16, 9, 0)), false)
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${checks - failures}/${checks} 项通过`)
if (failures > 0) process.exitCode = 1
