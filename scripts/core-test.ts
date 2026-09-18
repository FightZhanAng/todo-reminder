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
import { addDays, atTimeOfDay, dayIndex, dayKey, daysInMonth, parseHM, startOfDay } from '../src/shared/time'
import { expandRecurrence, matchesDay, nextOccurrence } from '../src/shared/recurrence'
import type { RecurrenceRule } from '../src/shared/types'
import { dueNow, isRemindable, remindAtOf } from '../src/shared/remind'
import { groupMissed, groupToday } from '../src/shared/group'
import { inQuietHours } from '../src/shared/quiet'
import { ACTION_ORDER, actionLabel, actionPatch } from '../src/shared/actions'
import { describeTask, missedSummary } from '../src/shared/notifyText'
import {
  TRAY_ICON_SCALE,
  TRAY_ICON_SIZE,
  parseHexColor,
  trayIconBitmap,
  trayIconPng
} from '../src/shared/trayIcon'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../src/main/store'
import { Scheduler } from '../src/main/scheduler'
import { formatClock, nextDayStart } from '../src/shared/time'
import {
  DEFAULT_LEAD_MIN,
  DEFAULT_SNOOZE_MIN,
  FILE_VERSION,
  MISS_GRACE_MS,
  TICK_MS
} from '../src/shared/defaults'

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
    snoozeUntil: null,
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
  const g = groupToday(all, now)

  check('逾期只有 1 条', g.overdue.map((t) => t.id).join(','), 'o1')
  check('接下来只有带时刻的今日任务', g.upcoming.map((t) => t.id).join(','), 'u1')
  check('今天随时只有全天型的今日任务', g.anytime.map((t) => t.id).join(','), 'a1')
  check('每天只有今天该做且未做的', g.recurring.map((t) => t.id).join(','), 'r1')
  check('已完成不进任何段', g.upcoming.concat(g.anytime).some((t) => t.id === 'u3'), false)
  check('已软删除不进任何段', g.upcoming.concat(g.anytime).some((t) => t.id === 'u4'), false)
  check('明天的任务不在今天', g.upcoming.concat(g.anytime).some((t) => t.id === 'u2'), false)

  const imp = deadline({ id: 'a2', dueAt: at(2026, 9, 16), allDay: true, important: true })
  check('今天随时：important 优先', groupToday([todayAllDay, imp], now).anytime.map((t) => t.id).join(','), 'a2,a1')
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

console.log('\n--- actions.ts ---')
{
  // 数组下标就是 toast 回传的 actionIndex，顺序是承重的
  check('按钮顺序 = actionIndex 下标', ACTION_ORDER.join(','), 'complete,snooze,tomorrow')
  check('完成按钮文案', actionLabel('complete', 10), '完成')
  // 推迟的分钟数必须来自设置
  check('推迟按钮文案跟着设置走', actionLabel('snooze', 20), '推迟 20 分钟')
  check('推到明天按钮文案', actionLabel('tomorrow', 10), '推到明天')

  const now = at(2026, 9, 16, 16, 20)
  const opts = { snoozeMinutes: 10 }

  check('完成截止型：写 completedAt', actionPatch(deadline({ id: 'x1' }), 'complete', now, opts).completedAt, now)

  const snoozed = actionPatch(deadline({ id: 'x2', firedFor: at(2026, 9, 16, 16, 15) }), 'snooze', now, opts)
  check('推迟：snoozeUntil = now + 10 分钟', snoozed.snoozeUntil, at(2026, 9, 16, 16, 30))
  check('推迟：清空 firedFor 以便重新触发', snoozed.firedFor, null)

  // 「推到明天」= 截止时间整体挪到明天的相同时刻
  const tmr = actionPatch(deadline({ id: 'x3' }), 'tomorrow', now, opts)
  check('推到明天：截止时间挪到明天同一时刻', tmr.dueAt, at(2026, 9, 17, 16, 30))
  check('推到明天：清掉 snoozeUntil', tmr.snoozeUntil, null)
  check('推到明天：清掉 firedFor', tmr.firedFor, null)

  const tmrAllDay = actionPatch(deadline({ id: 'x4', dueAt: at(2026, 9, 16), allDay: true }), 'tomorrow', now, opts)
  check('全天型推到明天', tmrAllDay.dueAt, at(2026, 9, 17))

  // 周期任务：「推到明天」= 今天跳过，不打断规则
  const tmrRecurring = actionPatch(recurring({ id: 'x5' }), 'tomorrow', now, opts)
  check('周期任务推到明天 = 标记今天已处理', tmrRecurring.lastDoneDay, '2026-09-16')
  check('周期任务推到明天不动 streak', tmrRecurring.streak, undefined)

  // 周期任务完成：连续天数
  const r1 = actionPatch(recurring({ id: 'y1', lastDoneDay: '2026-09-15', streak: 11 }), 'complete', now, opts)
  check('周期任务：昨天做过则 streak + 1', r1.streak, 12)
  check('周期任务：记录今天', r1.lastDoneDay, '2026-09-16')

  const r2 = actionPatch(recurring({ id: 'y2', lastDoneDay: '2026-09-10', streak: 5 }), 'complete', now, opts)
  check('周期任务：断档则 streak 归 1', r2.streak, 1)

  const r3 = actionPatch(recurring({ id: 'y3', lastDoneDay: '2026-09-16', streak: 3 }), 'complete', now, opts)
  check('周期任务：今天已做过则不变', r3.streak, undefined)
}

console.log('\n--- notifyText.ts ---')
{
  const now = at(2026, 9, 16, 16, 0)

  check('标题就是任务标题', describeTask(deadline(), at(2026, 9, 16, 16, 15), now).title, '交周报')
  check('不到 1 小时用分钟表述', describeTask(deadline(), at(2026, 9, 16, 16, 15), now).body, '还有 30 分钟')

  // 提醒点 16:00 相对 now 是 0 分钟差 → 走「现在」分支
  check('提醒点等于 now 说「现在」', describeTask(deadline(), now, now).body, '现在')

  // tick 有 10 秒粒度，通知总是比提醒点略晚一点点弹出来：
  // 这条路径不能说「已逾期」，否则离截止还有 15 分钟的通知在撒谎
  const tickLate = at(2026, 9, 16, 16, 15, 5)
  check('迟 5 秒弹出来仍说「现在」', describeTask(deadline(), at(2026, 9, 16, 16, 15), tickLate).body, '现在')

  const farTask = deadline({ dueAt: at(2026, 9, 16, 18, 0) })
  check('大于 1 小时用小时表述', describeTask(farTask, at(2026, 9, 16, 17, 45), now).body, '还有 2 小时')

  check('全天型说「今天」', describeTask(deadline({ allDay: true }), at(2026, 9, 16, 9, 0), now).body, '今天')
  check('周期型说「今天」', describeTask(recurring(), at(2026, 9, 16, 9, 0), now).body, '今天')
  check('已过提醒点说「已逾期」', describeTask(deadline(), at(2026, 9, 15, 15, 45), now).body, '已逾期')

  const s = missedSummary(
    ['交周报', '给猎头回邮件', '看简历'].map((title, i) => ({ task: deadline({ id: `s${i}`, title }), at: 0 })),
    3
  )
  check('错过标题带件数', s.title, '有 3 件事错过了')
  check('错过正文用间隔点连接', s.body, '交周报 · 给猎头回邮件 · 看简历')

  const many = missedSummary(
    ['甲', '乙', '丙', '丁', '戊'].map((title, i) => ({ task: deadline({ id: `m${i}`, title }), at: 0 })),
    3
  )
  check('超过上限时省略并给总数', many.body, '甲 · 乙 · 丙 等 5 件')
  check('超过上限时标题仍是总数', many.title, '有 5 件事错过了')
}

console.log('\n--- store.ts ---')
{
  const dir = mkdtempSync(join(tmpdir(), 'todo-store-'))
  const file = join(dir, 'todo-reminder.json')

  // 1. 空启动
  const s1 = new Store(file)
  check('空启动任务列表为空', s1.tasks.length, 0)
  check('空启动设置取默认值', s1.settings.defaultLeadMin, 15)
  check('空启动无损坏备份', s1.corruptBackupPath, null)

  // 2. 写入并重新读取
  s1.addTask(deadline({ id: 'p1' }))
  s1.patchSettings({ defaultLeadMin: 30 })
  const s2 = new Store(file)
  check('持久化后任务还在', s2.tasks.length, 1)
  check('持久化后任务内容一致', s2.tasks[0].id, 'p1')
  check('持久化后设置生效', s2.settings.defaultLeadMin, 30)

  // 3. 新增设置项时老文件自动补默认值
  const raw = JSON.parse(readFileSync(file, 'utf-8'))
  delete raw.settings.allDayRemindTime
  writeFileSync(file, JSON.stringify(raw), 'utf-8')
  check('缺失的设置项补默认值', new Store(file).settings.allDayRemindTime, '09:00')

  // 4. 单条非法任务被丢弃，其余保留
  const raw2 = JSON.parse(readFileSync(file, 'utf-8'))
  raw2.tasks.push({ id: 'broken' })
  writeFileSync(file, JSON.stringify(raw2), 'utf-8')
  const s4 = new Store(file)
  check('非法任务被丢弃', s4.tasks.length, 1)
  check('合法任务保留', s4.tasks[0].id, 'p1')

  // 5. 文件整体损坏：备份 + 空启动，不覆盖坏文件
  writeFileSync(file, '{ this is not json', 'utf-8')
  const s5 = new Store(file)
  check('损坏后以空数据启动', s5.tasks.length, 0)
  check('损坏后有备份路径', typeof s5.corruptBackupPath, 'string')
  check(
    '备份文件内容就是原来的坏内容',
    readFileSync(s5.corruptBackupPath as string, 'utf-8'),
    '{ this is not json'
  )

  // 6. 软删除与恢复
  const s6 = new Store(file)
  s6.addTask(deadline({ id: 'p2' }))
  check('软删除返回 true', s6.removeTask('p2'), true)
  check('软删除后仍在数组里', s6.tasks.some((x) => x.id === 'p2'), true)
  check('软删除后 deletedAt 非空', s6.tasks.find((x) => x.id === 'p2')?.deletedAt != null, true)
  check('软删除不存在的 id 返回 false', s6.removeTask('nope'), false)
  s6.restoreTask('p2')
  check('恢复后 deletedAt 为 null', s6.tasks.find((x) => x.id === 'p2')?.deletedAt, null)

  // 7. 更新不存在的 id
  check('更新不存在的 id 返回 null', s6.updateTask('nope', { title: 'x' }), null)

  // 8. 原子性：不应留下 .tmp
  check('写入后无残留 tmp 文件', existsSync(`${file}.tmp`), false)

  rmSync(dir, { recursive: true, force: true })
}

console.log('\n--- scheduler.ts ---')
{
  const cleanups: string[] = []
  const tmpStore = (prefix: string, name: string): Store => {
    const d = mkdtempSync(join(tmpdir(), prefix))
    cleanups.push(d)
    return new Store(join(d, name))
  }

  // 1. 基本触发与幂等
  const store = tmpStore('todo-sched-', 'a.json')
  let clock = at(2026, 9, 16, 16, 14)
  const batches: Array<{ fresh: string[]; missed: string[]; desktop: boolean }> = []

  const sched = new Scheduler({
    store,
    isIdle: () => false,
    now: () => clock,
    notify: (batch, desktop) =>
      batches.push({
        fresh: batch.fresh.map((e) => e.task.id),
        missed: batch.missed.map((e) => e.task.id),
        desktop
      })
  })

  store.addTask(deadline({ id: 'k1' }))   // 提醒点 16:15，创建于 08:00

  sched.tick()
  check('未到点不通知', batches.length, 0)

  clock = at(2026, 9, 16, 16, 15, 30)
  sched.tick()
  check('到点通知一次', batches.length, 1)
  check('归入 fresh', batches[0].fresh.join(','), 'k1')
  check('desktop 为 true', batches[0].desktop, true)

  sched.tick()
  check('markFired 之前会重复通知', batches.length, 2)

  const firedTask = store.tasks[0]
  if (firedTask.kind === 'someday') throw new Error('任务类型不对')
  sched.markFired([{ task: firedTask, at: at(2026, 9, 16, 16, 15) }])
  sched.tick()
  check('markFired 之后不再通知', batches.length, 2)

  // 2. 错过批次
  const store2 = tmpStore('todo-sched2-', 'b.json')
  store2.addTask(deadline({ id: 'm1', createdAt: at(2026, 9, 16, 7, 0), dueAt: at(2026, 9, 16, 8, 0) }))
  const b2: Array<{ fresh: string[]; missed: string[] }> = []
  new Scheduler({
    store: store2,
    isIdle: () => false,
    now: () => at(2026, 9, 16, 12, 0),
    notify: (batch) =>
      b2.push({ fresh: batch.fresh.map((e) => e.task.id), missed: batch.missed.map((e) => e.task.id) })
  }).tick()
  check('8 点的提醒点归入 missed', b2[0].missed.join(','), 'm1')
  check('missed 不进 fresh', b2[0].fresh.length, 0)

  // 3. 系统空闲 → 静默但仍交出批次
  const store3 = tmpStore('todo-sched3-', 'c.json')
  store3.addTask(deadline({ id: 'i1' }))
  const b3: Array<{ desktop: boolean; count: number }> = []
  const sched3 = new Scheduler({
    store: store3,
    isIdle: () => true,
    now: () => at(2026, 9, 16, 16, 15, 30),
    notify: (batch, desktop) => b3.push({ desktop, count: batch.fresh.length + batch.missed.length })
  })
  sched3.tick()
  check('空闲时通知一次', b3.length, 1)
  check('空闲时 desktop 为 false', b3[0].desktop, false)
  check('空闲时批次仍带上了任务（给手机推送用）', b3[0].count, 1)
  const idleTask = store3.tasks[0]
  if (idleTask.kind === 'someday') throw new Error('任务类型不对')
  check('空闲时也标记了 firedFor', idleTask.firedFor, at(2026, 9, 16, 16, 15))
  sched3.tick()
  check('空闲静默后不重复通知', b3.length, 1)

  // 4. 免打扰时段
  const store4 = tmpStore('todo-sched4-', 'd.json')
  store4.patchSettings({ quietHours: { start: '22:00', end: '08:00' } })
  store4.addTask(deadline({ id: 'n1', dueAt: at(2026, 9, 16, 23, 0) }))
  const b4: Array<{ desktop: boolean }> = []
  new Scheduler({
    store: store4,
    isIdle: () => false,
    now: () => at(2026, 9, 16, 22, 50),
    notify: (_batch, desktop) => b4.push({ desktop })
  }).tick()
  check('免打扰时段 desktop 为 false', b4.length === 1 && b4[0].desktop === false, true)

  // 5. 暂停 / 恢复
  const store5 = tmpStore('todo-sched5-', 'e.json')
  store5.addTask(deadline({ id: 'z1' }))
  let b5 = 0
  const sched5 = new Scheduler({
    store: store5,
    isIdle: () => false,
    now: () => at(2026, 9, 16, 16, 15, 30),
    notify: () => { b5++ }
  })
  sched5.pause(30)
  check('暂停后 pausedUntil 非空', sched5.pausedUntil !== null, true)
  sched5.tick()
  check('暂停期间不通知', b5, 0)
  sched5.resume()
  sched5.tick()
  check('恢复后正常通知', b5, 1)

  // 6. 全局关闭通知
  const store6 = tmpStore('todo-sched6-', 'f.json')
  store6.patchSettings({ notifyEnabled: false })
  store6.addTask(deadline({ id: 'w1' }))
  let b6 = 0
  new Scheduler({
    store: store6,
    isIdle: () => false,
    now: () => at(2026, 9, 16, 16, 15, 30),
    notify: () => { b6++ }
  }).tick()
  check('全局关闭通知后不弹', b6, 0)

  for (const d of cleanups) rmSync(d, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 2026-09-18 补齐：承重常量、剩余时间工具、免打扰整点端点
// （评审留下的 deferred 小账，补完第一期就不再挂账）
// ---------------------------------------------------------------------------

console.log('\n--- 承重常量（静默改值 typecheck 抓不到）---')
{
  check('FILE_VERSION = 1', FILE_VERSION, 1)
  check('TICK_MS = 10 秒', TICK_MS, 10_000)
  check('MISS_GRACE_MS = 10 分钟', MISS_GRACE_MS, 600_000)
  check('DEFAULT_LEAD_MIN = 15', DEFAULT_LEAD_MIN, 15)
  check('DEFAULT_SNOOZE_MIN = 10', DEFAULT_SNOOZE_MIN, 10)

  check('默认 schemaVersion = FILE_VERSION', DEFAULT_SETTINGS.schemaVersion, FILE_VERSION)
  check('默认不自启', DEFAULT_SETTINGS.launchAtLogin, false)
  check('默认开通知', DEFAULT_SETTINGS.notifyEnabled, true)
  check('默认有提示音', DEFAULT_SETTINGS.soundEnabled, true)
  check('默认全天提醒 09:00', DEFAULT_SETTINGS.allDayRemindTime, '09:00')
  check('默认提前量 = DEFAULT_LEAD_MIN', DEFAULT_SETTINGS.defaultLeadMin, DEFAULT_LEAD_MIN)
  check('默认推迟 = DEFAULT_SNOOZE_MIN', DEFAULT_SETTINGS.snoozeMinutes, DEFAULT_SNOOZE_MIN)
  check('默认不开免打扰时段', DEFAULT_SETTINGS.quietHours, null)
  check('默认空闲免打扰开', DEFAULT_SETTINGS.quietWhenIdle, true)
  check('默认空闲阈值 5 分钟', DEFAULT_SETTINGS.idleThresholdMin, 5)
  check('默认主题 auto', DEFAULT_SETTINGS.theme, 'auto')
  check('默认推送关闭', DEFAULT_SETTINGS.push.enabled, false)
  check('默认推送未配置密钥', DEFAULT_SETTINGS.push.configured, false)
  check('默认推送渠道 serverchan', DEFAULT_SETTINGS.push.channel, 'serverchan')
  check('默认推送时机 awayOnly', DEFAULT_SETTINGS.push.when, 'awayOnly')
  check('默认离开判定 5 分钟', DEFAULT_SETTINGS.push.awayIdleMin, 5)
  check('默认快捷键 Control+Alt+T', DEFAULT_SETTINGS.hotkey, 'Control+Alt+T')
}

console.log('\n--- 时间工具的剩余导出 ---')
{
  check('formatClock 补零', formatClock(at(2026, 9, 16, 9, 5)), '09:05')
  check('formatClock 午夜', formatClock(at(2026, 9, 16, 0, 0)), '00:00')
  check('formatClock 深夜', formatClock(at(2026, 9, 16, 23, 59)), '23:59')
  check('nextDayStart 是次日零点', nextDayStart(at(2026, 9, 16, 23, 59, 59)), at(2026, 9, 17))
  check('nextDayStart 白天也是次日零点', nextDayStart(at(2026, 9, 16, 12, 0)), at(2026, 9, 17))
  check('nextDayStart 跨月', nextDayStart(at(2026, 9, 30, 12, 0)), at(2026, 10, 1))
}

console.log('\n--- 免打扰：同日时段的整点端点 ---')
{
  const sameDay = { ...DEFAULT_SETTINGS, quietHours: { start: '09:00', end: '18:00' } }
  check('起点含（09:00 整）', inQuietHours(sameDay, at(2026, 9, 16, 9, 0)), true)
  check('终点不含（18:00 整）', inQuietHours(sameDay, at(2026, 9, 16, 18, 0)), false)
  check('终点前一分钟算（17:59）', inQuietHours(sameDay, at(2026, 9, 16, 17, 59)), true)
  check('起点前一分钟不算（08:59）', inQuietHours(sameDay, at(2026, 9, 16, 8, 59)), false)
}

console.log('\n--- 错过批次的宽限期端点 ---')
{
  const now = at(2026, 9, 16, 12, 0)
  const entry = (minAgo: number) => ({ task: deadline({ id: `g${minAgo}` }), at: now - minAgo * 60_000 })
  check('刚好 10 分钟归 fresh', groupMissed([entry(10)], now).fresh.length, 1)
  check('超过 10 分钟归 missed', groupMissed([entry(10.1)], now).missed.length, 1)
  check('9 分钟归 fresh', groupMissed([entry(9)], now).fresh.length, 1)
}

console.log('\n--- 聚合通知文案的边界 ---')
{
  const one = [{ task: deadline({ id: 'm1' }), at: 0 }]
  check('标题带总数', missedSummary(one, 0).title, '有 1 件事错过了')
  check('max 足够时不追加「等 N 件」', missedSummary(one, 3).body, '交周报')
  // max=0 时 shown 为空，修复前会拼出「 等 1 件」这种前导空格
  check('max=0 不产生前导空格', missedSummary(one, 0).body, '等 1 件')
  check('多条时用 · 连接', missedSummary(
    [{ task: deadline({ id: 'a', title: '甲' }), at: 0 }, { task: deadline({ id: 'b', title: '乙' }), at: 0 }],
    5
  ).body, '甲 · 乙')
}

// ---------------------------------------------------------------------------
// 2026-09-18 修复：周期任务的「推迟」
//
// 修复前：actionPatch('snooze') 无差别地写 snoozeUntil + 清 firedFor，
// 而 recurringRemindAt 不读 snoozeUntil → 提醒点回落到今天的 remindTime，
// 它 ≤ now 且 ≠ firedFor → 下一个 tick（10 秒内）原地重弹，推迟完全失效。
// RED 证据见 docs/superpowers/../scripts/manual-check.md 的探针输出。
// ---------------------------------------------------------------------------
console.log('\n--- 周期任务的「推迟」---')
{
  const opts = { snoozeMinutes: 10 }

  // 基准：09:00 的提醒点已过，now = 09:05
  const now = at(2026, 9, 16, 9, 5)
  check('基准：提醒点 = 今天 09:00', remindAtOf(recurring(), S, now), at(2026, 9, 16, 9, 0))

  const patch = actionPatch(recurring(), 'snooze', now, opts)
  check('推迟：写 snoozeUntil = now + 10 分钟', patch.snoozeUntil, at(2026, 9, 16, 9, 15))
  check('推迟：清空 firedFor', patch.firedFor, null)

  const snoozed = recurring({ snoozeUntil: at(2026, 9, 16, 9, 15) })
  check('推迟后提醒点 = snoozeUntil', remindAtOf(snoozed, S, now), at(2026, 9, 16, 9, 15))
  check('推迟后此刻不弹', dueNow([snoozed], S, now).length, 0)
  check('推迟后 09:14 不弹', dueNow([snoozed], S, at(2026, 9, 16, 9, 14)).length, 0)
  check('推迟点到时弹一次', dueNow([snoozed], S, at(2026, 9, 16, 9, 15)).length, 1)

  // 弹过之后调度器回填 firedFor = snoozeUntil
  const fired = recurring({
    snoozeUntil: at(2026, 9, 16, 9, 15),
    firedFor: at(2026, 9, 16, 9, 15)
  })
  check('推迟弹过后当天不再弹（09:20）', dueNow([fired], S, at(2026, 9, 16, 9, 20)).length, 0)
  check('推迟弹过后当天不再弹（23:59）', dueNow([fired], S, at(2026, 9, 16, 23, 59)).length, 0)
  check('次日提醒点回到次日 09:00', remindAtOf(fired, S, at(2026, 9, 17, 8, 0)), at(2026, 9, 17, 9, 0))
  check('次日 09:00 正常弹', dueNow([fired], S, at(2026, 9, 17, 9, 0)).length, 1)

  // 边界：23:55 推迟到次日 00:05，跨午夜必须仍然生效
  const cross = recurring({
    remindTime: '23:55',
    snoozeUntil: at(2026, 9, 17, 0, 5)
  })
  check('跨午夜推迟：推起点未被吞掉', remindAtOf(cross, S, at(2026, 9, 16, 23, 56)), at(2026, 9, 17, 0, 5))
  check('跨午夜推迟：次日 00:05 弹一次', dueNow([cross], S, at(2026, 9, 17, 0, 5)).length, 1)
  // 已知取舍：推迟点落到次日 00:05 后，它会一直「不早于今天」，于是**次日**
  // 那个 23:55 的实例被并入、当天不再单独弹（人在这天已经在 00:05 被提醒过）。
  // 再下一天 snoozeUntil 早于新一天零点，自动失效、规则恢复。
  const crossFired = { ...cross, firedFor: at(2026, 9, 17, 0, 5) }
  check(
    '跨午夜推迟：推迟点所在当天不再重复',
    remindAtOf(crossFired, S, at(2026, 9, 17, 12, 0)),
    at(2026, 9, 17, 0, 5)
  )
  check('跨午夜推迟：当晚不再弹', dueNow([crossFired], S, at(2026, 9, 17, 23, 55)).length, 0)
  check(
    '跨午夜推迟：再下一天回到规则（23:55）',
    remindAtOf(crossFired, S, at(2026, 9, 18, 12, 0)),
    at(2026, 9, 18, 23, 55)
  )
  check('跨午夜推迟：再下一天 23:55 正常弹', dueNow([crossFired], S, at(2026, 9, 18, 23, 55)).length, 1)

  // 已完成 / 今天不该做时，推迟不改变 null
  check(
    '今天已做：推迟不改变 null',
    remindAtOf(recurring({ lastDoneDay: '2026-09-16', snoozeUntil: at(2026, 9, 16, 9, 15) }), S, now),
    null
  )
  check('截止型不受影响：仍无条件用 snoozeUntil', remindAtOf(
    deadline({ snoozeUntil: at(2026, 9, 16, 9, 15) }),
    S,
    now
  ), at(2026, 9, 16, 9, 15))
}

// ---------------------------------------------------------------------------
// 2026-09-18 修复：托盘图标看不见
//
// 根因：icons.ts 把 SVG 塞进 data URL 交给 nativeImage，而 Electron **不支持 SVG** ——
// 不报错，静默返回 0×0 的空图（实测 isEmpty() === true），托盘里什么都不显示，
// 但 tooltip 与右键菜单正常，所以极难定位。
// 修法：shared/trayIcon.ts 自己光栅化 + 自己编 PNG。下面直接断言像素。
// ---------------------------------------------------------------------------
console.log('\n--- 托盘图标：必须是真有像素的 PNG ---')
{
  const size = TRAY_ICON_SIZE * TRAY_ICON_SCALE
  const bmp = trayIconBitmap('pending', '#1B1F23')
  const alphasOf = (b: Buffer): number[] => {
    const out: number[] = []
    for (let i = 3; i < b.length; i += 4) out.push(b[i])
    return out
  }

  check('位图字节数 = w×h×4', bmp.length, size * size * 4)
  const a = alphasOf(bmp)
  const painted = a.filter((v) => v > 0).length
  check('画上了东西（非全透明）', painted > 40, true)
  check('没糊满整张（画的是稀疏图形，不是实心块）', painted < size * size * 0.75, true)
  check('有实心像素', a.filter((v) => v === 255).length > 20, true)
  check('有抗锯齿边缘（0<alpha<255）', a.filter((v) => v > 0 && v < 255).length > 20, true)

  let solidIdx = -1
  for (let i = 3; i < bmp.length; i += 4) {
    if (bmp[i] === 255) {
      solidIdx = i - 3
      break
    }
  }
  const hex = (n: number): string => n.toString(16).padStart(2, '0')
  check(
    '实心像素用的是指定颜色 #1B1F23',
    `${hex(bmp[solidIdx])}${hex(bmp[solidIdx + 1])}${hex(bmp[solidIdx + 2])}`,
    '1b1f23'
  )

  check('两种形态的位图不同', trayIconBitmap('clear', '#1B1F23').equals(bmp), false)
  const semi = alphasOf(trayIconBitmap('clear', '#1B1F23')).filter((v) => v > 70 && v < 130)
  check('清空形态的半透明外框（0.45）确实存在', semi.length > 20, true)

  const png = trayIconPng('pending', '#1B1F23')
  check('PNG 签名', png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  check('IHDR 宽 = 32', png.readUInt32BE(16), size)
  check('IHDR 高 = 32', png.readUInt32BE(20), size)
  check('位深 8', png[24], 8)
  check('colorType 6（RGBA）', png[25], 6)
  check('以 IEND 收尾', png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND')
  check('PNG 不是空壳', png.length > 200, true)

  check('parseHexColor 三位简写', JSON.stringify(parseHexColor('#f0a')), JSON.stringify({ r: 255, g: 0, b: 170 }))
  check('parseHexColor 非法值退回黑', JSON.stringify(parseHexColor('nope')), JSON.stringify({ r: 0, g: 0, b: 0 }))
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${checks - failures}/${checks} 项通过`)
if (failures > 0) process.exitCode = 1
