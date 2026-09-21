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
import { APP_ICON_SIZES, appIconBitmap, buildAppIco } from '../src/shared/appIcon'
import {
  CAL_HEADERS,
  CN_MONTHS,
  dayKeyOf,
  monthGrid,
  monthLabel,
  nextWeekdayAfter,
  relativeDayLabel,
  shiftMonth,
  tsFromDayKey
} from '../src/shared/calendar'
import { collectDone, doneCount, doneDayLabel, recurringDoneLabel } from '../src/shared/done'
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
import { SOON_WINDOW_MS, urgencyOf } from '../src/shared/urgency'
import { hotkeyFromEvent, isValidHotkey, normalizeHotkey } from '../src/shared/hotkey'
import { EXIT_DONE_MS, EXIT_REMOVED_MS, exitDurationMs, mergeExiting } from '../src/shared/exit'

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
  const batches: Array<{ fresh: string[]; missed: string[] }> = []

  const sched = new Scheduler({
    store,
    isIdle: () => false,
    now: () => clock,
    notify: (batch) =>
      batches.push({
        fresh: batch.fresh.map((e) => e.task.id),
        missed: batch.missed.map((e) => e.task.id)
      })
  })

  store.addTask(deadline({ id: 'k1' }))   // 提醒点 16:15，创建于 08:00

  sched.tick()
  check('未到点不通知', batches.length, 0)

  clock = at(2026, 9, 16, 16, 15, 30)
  sched.tick()
  check('到点通知一次', batches.length, 1)
  check('归入 fresh', batches[0].fresh.join(','), 'k1')

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

  // 3. 人不在电脑前：不弹，也**不标已处理** —— 回来之后再补
  const store3 = tmpStore('todo-sched3-', 'c.json')
  store3.addTask(deadline({ id: 'i1' }))
  let idle = true
  let clock3 = at(2026, 9, 16, 16, 15, 30)
  const b3: Array<{ fresh: string[]; missed: string[] }> = []
  const sched3 = new Scheduler({
    store: store3,
    isIdle: () => idle,
    now: () => clock3,
    notify: (batch) =>
      b3.push({ fresh: batch.fresh.map((e) => e.task.id), missed: batch.missed.map((e) => e.task.id) })
  })
  sched3.tick()
  check('空闲时不弹通知', b3.length, 0)
  const idleTask = store3.tasks[0]
  if (idleTask.kind === 'someday') throw new Error('任务类型不对')
  check('空闲时不标 firedFor（标了就再也补不回来）', idleTask.firedFor, null)
  idle = false
  clock3 = at(2026, 9, 16, 17, 30)
  sched3.tick()
  check('人回来后排一次', b3.length, 1)
  check('回来时它已是「错过的」，走聚合而不是 fresh', b3[0].missed.join(','), 'i1')
  check('聚合那条不在 fresh 里', b3[0].fresh.length, 0)

  // 4. 免打扰时段：同上，出了时段再补
  const store4 = tmpStore('todo-sched4-', 'd.json')
  store4.patchSettings({ quietHours: { start: '22:00', end: '08:00' } })
  store4.addTask(deadline({ id: 'n1', dueAt: at(2026, 9, 16, 23, 0) }))   // 提醒点 22:45
  let clock4 = at(2026, 9, 16, 22, 50)
  const b4: Array<{ fresh: string[]; missed: string[] }> = []
  const sched4 = new Scheduler({
    store: store4,
    isIdle: () => false,
    now: () => clock4,
    notify: (batch) =>
      b4.push({ fresh: batch.fresh.map((e) => e.task.id), missed: batch.missed.map((e) => e.task.id) })
  })
  sched4.tick()
  check('免打扰时段内不弹', b4.length, 0)
  const quietTask = store4.tasks[0]
  if (quietTask.kind === 'someday') throw new Error('任务类型不对')
  check('免打扰时段内不标 firedFor', quietTask.firedFor, null)
  clock4 = at(2026, 9, 17, 8, 30)
  sched4.tick()
  check('出了免打扰时段补发一次', b4.length, 1)
  check('夜里攒下的走 missed 聚合', b4[0].missed.join(','), 'n1')

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
// 修法：shared/raster.ts 自己光栅化、shared/trayIcon.ts 自己编 PNG，下面直接断言像素。
//
// 2026-09-20 换了图形：从「方框里躺两条线」改成「一根竖轴 + 三道刻度」，
// 和主看板同一个母题。**母题里最容易改坏的一条是「最长那一道越过轴」** ——
// 它承的是「逾期」这个语义，所以专门为它留了两条断言（越轴的与不越轴的各一条）。
// ---------------------------------------------------------------------------
console.log('\n--- 托盘图标：必须是真有像素的 PNG，且刻度越过轴 ---')
{
  const size = TRAY_ICON_SIZE * TRAY_ICON_SCALE
  const bmp = trayIconBitmap('pending', '#1B1F23')
  const alphasOf = (b: Buffer): number[] => {
    const out: number[] = []
    for (let i = 3; i < b.length; i += 4) out.push(b[i])
    return out
  }
  const alphaAt = (b: Buffer, x: number, y: number): number => b[(y * size + x) * 4 + 3]

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

  // 设计坐标 → 像素：×2（TRAY_ICON_SCALE）。取每格的中心，避开小数边界
  // 轴在 x=5.2、宽 1.5 → 像素 11 的横向区间 5.5..6.0 完整落在轴里
  check('竖轴是实心的', alphaAt(bmp, 11, 8) > 200, true)
  // 第三道刻度（y=11.4）从 x=3.6 起画，越过 x=5.2 的轴；像素 7 = 设计 3.5..4.0
  check('最长的那道刻度越过轴、伸到轴左边', alphaAt(bmp, 7, 22) > 0, true)
  // 对照：第二道（y=8.0）只在轴右边，同一个 x 上必须是空的
  check('另外两道不越过轴', alphaAt(bmp, 7, 16), 0)
  // 第二道刻度在轴右侧的实处：像素 14 = 设计 7.0..7.5
  check('刻度画在轴的右边', alphaAt(bmp, 14, 16) > 200, true)

  const clear = trayIconBitmap('clear', '#1B1F23')
  check('两种形态的位图不同', clear.equals(bmp), false)
  check('清空形态有实心像素（那个勾）', alphasOf(clear).filter((v) => v === 255).length > 20, true)
  // alpha 0.45 → 约 115。数的是「明显不是全透明、也明显不满」的那一批
  const dim = alphasOf(clear).filter((v) => v > 60 && v < 200).length
  check('清空形态的轴淡下去（0.45）', dim > 20, true)

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

// ---------------------------------------------------------------------------
// 应用图标。Windows 对 .ico 的格式相当挑剔，而错了不会有任何提示 —— 只会
// 在任务栏上看到一枚默认的空白图标。所以把容器的每个字段都断言一遍。
// ---------------------------------------------------------------------------
console.log('\n--- 应用图标：.ico 的容器格式与配色 ---')
{
  const px = (b: Buffer, size: number, x: number, y: number): number[] => {
    const o = (y * size + x) * 4
    return [b[o], b[o + 1], b[o + 2], b[o + 3]]
  }
  const solid = appIconBitmap(64)
  const hasColor = (rgb: number[]): boolean => {
    for (let i = 0; i < solid.length; i += 4) {
      if (solid[i] === rgb[0] && solid[i + 1] === rgb[1] && solid[i + 2] === rgb[2] && solid[i + 3] === 255) {
        return true
      }
    }
    return false
  }

  check('有纸面底板 #f4f6f5', hasColor([244, 246, 245]), true)
  check('有靛蓝 #26496d', hasColor([38, 73, 109]), true)
  check('有朱砂 #bf3628', hasColor([191, 54, 40]), true)
  // 朱砂那一道必须**越过**靛蓝的轴。轴在 x=23、宽 5 → 20.5..25.5；
  // 像素 17（设计坐标 17..18）整个落在轴的左边，只有越轴时才可能有颜色。
  // 第三道刻度在 y=43.5：像素 43 完整落在它的 40.7..46.3 里。
  check('朱砂那一笔越过了轴', px(solid, 64, 17, 43).slice(0, 3).join(','), '191,54,40')
  // 对照：第二道刻度（y=32）不越轴，同一个 x 上必须是**纸面**。
  // 这里只能比颜色不能比透明度 —— 应用图标底下有一块不透明的底板，
  // alpha 处处都是 255（托盘图标是透明背景，才可以用 alpha 判空）。
  check('另外两道不越轴（那里的纸面没被碰过）', px(solid, 64, 17, 32).slice(0, 3).join(','), '244,246,245')
  check('轴上段仍是靛蓝', px(solid, 64, 22, 20).slice(0, 3).join(','), '38,73,109')
  check('四角是透明的（圆角之外）', px(solid, 64, 0, 0)[3], 0)

  check('尺寸表覆盖系统会用到的那些', APP_ICON_SIZES.join(','), '16,20,24,32,40,48,64,128,256')

  const ico = buildAppIco()
  const count = APP_ICON_SIZES.length
  check('ICO 保留字段 = 0', ico.readUInt16LE(0), 0)
  check('ICO 类型 = 1（图标，不是光标）', ico.readUInt16LE(2), 1)
  check('ICO 条目数 = 尺寸数', ico.readUInt16LE(4), count)

  const dirEntry = (i: number): number => 6 + i * 16
  check('16 的宽高字节都写 16', `${ico[dirEntry(0)]},${ico[dirEntry(0) + 1]}`, '16,16')
  check('256 的宽高字节写 0（ICO 的单字节约定）', `${ico[dirEntry(count - 1)]},${ico[dirEntry(count - 1) + 1]}`, '0,0')
  check('目录里写 32 位', ico.readUInt16LE(dirEntry(0) + 6), 32)

  // 图片数据紧挨着目录，每项的偏移 = 前一项偏移 + 前一项长度
  let cursor = 6 + count * 16
  let packed = true
  const offsets: number[] = []
  for (let i = 0; i < count; i++) {
    const off = ico.readUInt32LE(dirEntry(i) + 12)
    const len = ico.readUInt32LE(dirEntry(i) + 8)
    offsets.push(off)
    if (off !== cursor) packed = false
    cursor += len
  }
  check('数据段无空洞、偏移首尾相接', packed, true)
  check('最后一项刚好落在文件尾', cursor, ico.length)

  // ≤64 用 BMP，≥128 用 PNG
  const bmpOff = offsets[0]
  check('16 是 BMP：biSize = 40', ico.readUInt32LE(bmpOff), 40)
  check('BMP 宽 = 16', ico.readInt32LE(bmpOff + 4), 16)
  check('BMP 高写成两倍（XOR + AND 叠在一个结构里）', ico.readInt32LE(bmpOff + 8), 32)
  check('BMP 位深 = 32', ico.readUInt16LE(bmpOff + 14), 32)
  check('BMP 不压缩', ico.readUInt32LE(bmpOff + 16), 0)
  const bmpLen = ico.readUInt32LE(dirEntry(0) + 8)
  check('BMP 长度 = 头 40 + 像素 + 全零 AND 掩码（4 字节对齐）', bmpLen, 40 + 16 * 16 * 4 + 4 * 16)

  const off256 = offsets[count - 1]
  check('256 是 PNG', ico.subarray(off256, off256 + 8).toString('hex'), '89504e470d0a1a0a')
  check('256 的 PNG 边长写对', ico.readUInt32BE(off256 + 16), 256)
}

console.log('\n--- urgency.ts ---')
{
  const now = at(2026, 9, 16, 16, 0)
  check('逾期：dueAt 早于今天零点', urgencyOf(deadline({ dueAt: at(2026, 9, 15, 9, 0) }), now), 'overdue')
  check('今天 15:00 截止、现在 16:00 → 不算逾期（还在今天）',
    urgencyOf(deadline({ dueAt: at(2026, 9, 16, 15, 0) }), now), 'soon')
  check('1 小时内 → soon', urgencyOf(deadline({ dueAt: at(2026, 9, 16, 16, 30) }), now), 'soon')
  check('刚好 1 小时 → soon', urgencyOf(deadline({ dueAt: now + SOON_WINDOW_MS }), now), 'soon')
  check('1 小时零 1 毫秒 → none', urgencyOf(deadline({ dueAt: now + SOON_WINDOW_MS + 1 }), now), 'none')
  check('全天型不会 soon（没有具体时刻）',
    urgencyOf(deadline({ allDay: true, dueAt: at(2026, 9, 16) }), now), 'none')
  check('已完成 → none', urgencyOf(deadline({ completedAt: now, dueAt: at(2026, 9, 15) }), now), 'none')
  check('周期任务 → none', urgencyOf(recurring(), now), 'none')
  check('清单池 → none', urgencyOf(someday(), now), 'none')
}

console.log('\n--- hotkey.ts ---')
{
  check('小写规范成大写', normalizeHotkey('ctrl+alt+t'), 'Control+Alt+T')
  check('大写同样通过', normalizeHotkey('CTRL+ALT+T'), 'Control+Alt+T')
  check('修饰键输出顺序固定（与输入顺序无关）', normalizeHotkey('shift+alt+ctrl+p'), 'Control+Alt+Shift+P')
  check('Super 别名 win', normalizeHotkey('win+shift+k'), 'Shift+Super+K')   // 见下方说明
  check('单个字母不带修饰键 → null', normalizeHotkey('t'), null)
  check('只有修饰键 → null', normalizeHotkey('Control+Alt'), null)
  check('两个主键 → null', normalizeHotkey('Control+A+B'), null)
  check('空串 → null', normalizeHotkey(''), null)
  check('垃圾主键 → null', normalizeHotkey('Control+NotAKey'), null)
  check('功能键', normalizeHotkey('ctrl+f5'), 'Control+F5')
  check('F25 不存在', normalizeHotkey('ctrl+f25'), null)
  check('空格', normalizeHotkey('ctrl+space'), 'Control+Space')
  check('方向键别名归一', normalizeHotkey('ctrl+arrowup'), 'Control+Up')
  check('isValidHotkey 复用 normalize 的判定', isValidHotkey('control+alt+t'), true)
  check('isValidHotkey 拒绝无修饰键', isValidHotkey('t'), false)

  const ev = (patch: Partial<Parameters<typeof hotkeyFromEvent>[0]>) => ({
    key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...patch
  })
  check('只按 Control → null（还没按完）',
    hotkeyFromEvent(ev({ key: 'Control', ctrlKey: true })), null)
  check('没有修饰键 → null', hotkeyFromEvent(ev({ key: 't' })), null)
  check('Control+Alt+T',
    hotkeyFromEvent(ev({ key: 't', ctrlKey: true, altKey: true })), 'Control+Alt+T')
  check('Control+Shift+K（key 是大写 K）',
    hotkeyFromEvent(ev({ key: 'K', ctrlKey: true, shiftKey: true })), 'Control+Shift+K')
  check('Control+空格',
    hotkeyFromEvent(ev({ key: ' ', ctrlKey: true })), 'Control+Space')
  check('Control+ArrowUp',
    hotkeyFromEvent(ev({ key: 'ArrowUp', ctrlKey: true })), 'Control+Up')
  check('Dead 键忽略',
    hotkeyFromEvent(ev({ key: 'Dead', ctrlKey: true })), null)
}

console.log('\n--- exit.ts ---')
{
  const now = at(2026, 9, 16, 16, 0)
  // 变更前的样子（未完成、未删除）
  const before = deadline({ id: 'a', title: 'A' })
  // 变更后的样子（已完成）—— 快照里那条
  const afterDone = deadline({ id: 'a', title: 'A', completedAt: now })
  // 变更后（软删）
  const afterRemoved = deadline({ id: 'a', title: 'A', deletedAt: now })
  const other = deadline({ id: 'b', title: 'B' })

  check('时长：done', exitDurationMs('done'), EXIT_DONE_MS)
  check('时长：removed', exitDurationMs('removed'), EXIT_REMOVED_MS)

  const none = mergeExiting([afterDone, other], [], now)
  check('空 exiting：原样返回', none.tasks.map((t) => t.id).join(','), 'a,b')
  check('空 exiting：已完成的那条保持已完成',
    (none.tasks[0] as DeadlineTask).completedAt, now)
  check('空 exiting：没有过期项', none.expired.length, 0)

  // done：替换回变更前的版本
  const done = mergeExiting(
    [afterDone, other],
    [{ task: before, kind: 'done', startedAt: now - 100 }],
    now
  )
  check('done：条数不变（替换而不是插入）', done.tasks.length, 2)
  check('done：completedAt 被盖回 null', (done.tasks[0] as DeadlineTask).completedAt, null)
  check('done：位置不变（还在第 0 位）', done.tasks[0].id, 'a')
  check('done：未过期', done.expired.length, 0)
  check('done：没被动的任务原样', (done.tasks[1] as DeadlineTask).completedAt, null)

  // removed：替换回未删除的版本（这样 groupToday 才会把它排回原来的段）
  const removed = mergeExiting(
    [afterRemoved, other],
    [{ task: before, kind: 'removed', startedAt: now - 100 }],
    now
  )
  check('removed：deletedAt 被盖回 null', removed.tasks[0].deletedAt, null)

  // 过期：不替换，并报出来
  const expiredDone = mergeExiting(
    [afterDone],
    [{ task: before, kind: 'done', startedAt: now - EXIT_DONE_MS }],
    now
  )
  check('刚好到时长：过期', expiredDone.expired.join(','), 'a')
  check('过期后不再替换', (expiredDone.tasks[0] as DeadlineTask).completedAt, now)

  const nearly = mergeExiting(
    [afterDone],
    [{ task: before, kind: 'done', startedAt: now - EXIT_DONE_MS + 1 }],
    now
  )
  check('差 1ms：仍算未过期', nearly.expired.length, 0)

  const removedLong = mergeExiting(
    [afterRemoved],
    [{ task: before, kind: 'removed', startedAt: now - EXIT_DONE_MS - 1 }],
    now
  )
  check('removed 的窗口比 done 长得多', removedLong.expired.length, 0)

  // current 里已经没有这个 id
  const gone = mergeExiting([other], [{ task: before, kind: 'done', startedAt: now }], now)
  check('目标已不在列表里：报过期', gone.expired.join(','), 'a')
  check('目标已不在列表里：不复活', gone.tasks.map((t) => t.id).join(','), 'b')

  // 同 id 重复登记
  const dup = mergeExiting(
    [afterDone],
    [
      { task: before, kind: 'done', startedAt: now },
      { task: before, kind: 'done', startedAt: now }
    ],
    now
  )
  check('重复登记只替换一次', dup.tasks.length, 1)
  check('重复的那条报过期', dup.expired.join(','), 'a')

  // 多条混合：一条替换 + 一条过期 + 一条不在列表里
  const afterDoneB = deadline({ id: 'b', title: 'B', completedAt: now })
  const mixed = mergeExiting(
    [afterDone, afterDoneB],
    [
      { task: before, kind: 'done', startedAt: now - 10 },
      { task: deadline({ id: 'b', title: 'B' }), kind: 'done', startedAt: now - EXIT_DONE_MS - 1 },
      { task: deadline({ id: 'c' }), kind: 'done', startedAt: now }
    ],
    now
  )
  check('混合：a 被盖回未完成', (mixed.tasks[0] as DeadlineTask).completedAt, null)
  check('混合：b 已过期所以保持已完成', (mixed.tasks[1] as DeadlineTask).completedAt, now)
  check('混合：过期的单列出来', mixed.expired.slice().sort().join(','), 'b,c')
  check('混合：输出仍只有两条（不插入新行）', mixed.tasks.length, 2)
}

import { applyCommand, buildTask } from '../src/shared/commands'
import type { Command, TaskDraft } from '../src/shared/commands'

console.log('\n--- commands.ts ---')
{
  const dir = mkdtempSync(join(tmpdir(), 'todo-cmd-'))
  const store = new Store(join(dir, 'todo-reminder.json'))
  const now = at(2026, 9, 16, 16, 0)
  const run = (cmd: Command) => applyCommand(store, cmd, now)
  const byId = (id: string) => store.tasks.find((t) => t.id === id)
  const last = () => store.tasks[store.tasks.length - 1]

  // ---- task:create ----
  const dl: TaskDraft = {
    kind: 'deadline', title: '  交周报  ', important: true,
    dueDay: at(2026, 9, 17), allDay: false, time: '17:30'
  }
  const created = run({ type: 'task:create', draft: dl })
  const deadlineId = created.touchedTaskId!
  check('create 返回 ok', created.ok, true)
  check('create 返回 touchedTaskId', typeof deadlineId, 'string')
  check('create 落在 store 里', store.tasks.length, 1)
  check('标题被 trim', last().title, '交周报')
  check('kind 是 deadline', last().kind, 'deadline')
  check('dueAt 按日期 + 时刻拼', (last() as DeadlineTask).dueAt, at(2026, 9, 17, 17, 30))
  check('leadMin 缺省取 settings.defaultLeadMin', (last() as DeadlineTask).leadMin, S.defaultLeadMin)
  check('createdAt = now', last().createdAt, now)
  check('updatedAt = now', last().updatedAt, now)
  check('firedFor 为 null', last().firedFor, null)
  check('deletedAt 为 null', last().deletedAt, null)
  check('deadline 的 completedAt 为 null', (last() as DeadlineTask).completedAt, null)
  check('deadline 的 snoozeUntil 为 null', (last() as DeadlineTask).snoozeUntil, null)
  check('没写备注时对象上没有 note 键', 'note' in last(), false)

  const allDayDraft: TaskDraft = {
    kind: 'deadline', title: '买菜', important: false,
    dueDay: at(2026, 9, 18), allDay: true
  }
  run({ type: 'task:create', draft: allDayDraft })
  check('全天型 dueAt 落在当天 00:00', (last() as DeadlineTask).dueAt, at(2026, 9, 18))
  check('全天型 allDay 为 true', (last() as DeadlineTask).allDay, true)

  run({ type: 'task:create', draft: { ...allDayDraft, title: '带提前量', leadMin: 30 } })
  check('显式 leadMin 优先', (last() as DeadlineTask).leadMin, 30)

  run({
    type: 'task:create',
    draft: {
      kind: 'recurring', title: '早上看简历', important: false,
      rule: { freq: 'daily', every: 1, skipWeekend: true }, remindTime: '09:00'
    }
  })
  check('recurring streak 从 0 开始', (last() as RecurringTask).streak, 0)
  check('recurring lastDoneDay 为 null', (last() as RecurringTask).lastDoneDay, null)
  check('recurring snoozeUntil 为 null', (last() as RecurringTask).snoozeUntil, null)

  const recurringId = last().id

  run({ type: 'task:create', draft: { kind: 'someday', title: '想看的书', important: false } })
  check('someday 没有 dueAt 键', 'dueAt' in last(), false)
  check('someday 没有 completedAt 键', 'completedAt' in last(), false)

  const somedayId = last().id
  check('每次 create 都拿到不同 id', somedayId === deadlineId, false)
  check('create 确实追加而不是覆盖', store.tasks.length, 5)

  // ---- buildTask 的备注 ----
  const withNote = buildTask(
    S,
    { kind: 'someday', title: 'x', note: '  有备注  ', important: false },
    now, 'n1', now, null
  )
  check('备注被 trim', withNote.note, '有备注')
  const blankNote = buildTask(
    S,
    { kind: 'someday', title: 'x', note: '   ', important: false },
    now, 'n2', now, null
  )
  check('空白备注不写进对象', 'note' in blankNote, false)

  // ---- task:edit ----
  run({
    type: 'task:edit', id: deadlineId,
    draft: { kind: 'deadline', title: '交周报（改）', important: false, dueDay: at(2026, 9, 19), allDay: false, time: '10:00', leadMin: 5 }
  })
  const edited = byId(deadlineId) as DeadlineTask
  check('edit 保留 id', edited.id, deadlineId)
  check('edit 保留 createdAt', edited.createdAt, now)
  check('edit 换标题', edited.title, '交周报（改）')
  check('edit 换 dueAt', edited.dueAt, at(2026, 9, 19, 10, 0))
  check('edit 换 leadMin', edited.leadMin, 5)
  check('edit 更新 updatedAt', edited.updatedAt, now)

  // edit 要清掉 snooze / firedFor
  store.updateTask(deadlineId, { snoozeUntil: at(2026, 9, 16, 18, 0), firedFor: at(2026, 9, 16, 17, 0) })
  run({ type: 'task:edit', id: deadlineId, draft: dl })
  check('edit 清 snoozeUntil', (byId(deadlineId) as DeadlineTask).snoozeUntil, null)
  check('edit 清 firedFor', byId(deadlineId)!.firedFor, null)

  // edit 跨类型：清单池 → 截止型，且不留上一个类型的字段
  run({
    type: 'task:edit', id: somedayId,
    draft: { kind: 'deadline', title: '想看的书', important: false, dueDay: at(2026, 9, 20), allDay: true }
  })
  const converted = byId(somedayId) as DeadlineTask
  check('edit 跨类型：kind 变了', converted.kind, 'deadline')
  check('edit 跨类型：拿到 dueAt', converted.dueAt, at(2026, 9, 20))

  // edit 跨类型：截止型 → 清单池，字段必须被清干净（这是 replaceTask 的存在理由）
  run({ type: 'task:edit', id: deadlineId, draft: { kind: 'someday', title: '交周报（改）', important: false } })
  const back = byId(deadlineId)!
  check('edit 跨类型：kind 回到 someday', back.kind, 'someday')
  check('回去后不留 dueAt', 'dueAt' in back, false)
  check('回去后不留 allDay', 'allDay' in back, false)
  check('回去后不留 leadMin', 'leadMin' in back, false)
  check('回去后不留 completedAt', 'completedAt' in back, false)

  // edit 保留软删状态
  run({ type: 'task:remove', id: deadlineId })
  run({ type: 'task:edit', id: deadlineId, draft: { kind: 'someday', title: '仍然删着', important: false } })
  check('edit 不复活已软删的任务', byId(deadlineId)!.deletedAt, now)
  run({ type: 'task:restore', id: deadlineId })

  // ---- task:edit 保留同类型完成态（审查补的断言，原题 88 条里零覆盖）----
  // 周期任务今天已做完 → 同类型 edit 改标题 → lastDoneDay / streak 必须保留，firedFor 必须清
  const rEdit = run({
    type: 'task:create',
    draft: { kind: 'recurring', title: '周期完成态', important: false, rule: { freq: 'daily', every: 1, skipWeekend: false }, remindTime: '09:00' }
  }).touchedTaskId!
  store.updateTask(rEdit, { lastDoneDay: '2026-09-16', streak: 3, firedFor: at(2026, 9, 16, 9, 0) })
  run({
    type: 'task:edit', id: rEdit,
    draft: { kind: 'recurring', title: '周期完成态（改）', important: false, rule: { freq: 'daily', every: 1, skipWeekend: false }, remindTime: '09:00' }
  })
  const rAfter = byId(rEdit) as RecurringTask
  // 判别性：buildTask 会把这两者写成 null / 0，若回填丢失这里会 FAIL
  check('同类型 edit：周期 lastDoneDay 保留', rAfter.lastDoneDay, '2026-09-16')
  check('同类型 edit：周期 streak 保留（不为 0）', rAfter.streak, 3)
  // firedFor 仍清（提醒时刻可能改过，旧的已提醒标记不成立，必须重新具备提醒资格）
  check('同类型 edit：周期 firedFor 仍被清', rAfter.firedFor, null)

  // 已完成的截止型 → 同类型 edit → completedAt 保留（否则变回未完成、重新进分组）
  const dEdit = run({
    type: 'task:create',
    draft: { kind: 'deadline', title: '完成的截止', important: false, dueDay: at(2026, 9, 16), allDay: true }
  }).touchedTaskId!
  run({ type: 'task:complete', id: dEdit })
  const dDoneAt = (byId(dEdit) as DeadlineTask).completedAt
  run({
    type: 'task:edit', id: dEdit,
    draft: { kind: 'deadline', title: '完成的截止（改）', important: false, dueDay: at(2026, 9, 16), allDay: true }
  })
  // 判别性：buildTask 会把它写成 null，若回填丢失这里会 FAIL（dDoneAt === now，非 null）
  check('同类型 edit：已完成截止型 completedAt 保留', (byId(dEdit) as DeadlineTask).completedAt, dDoneAt)

  // 跨类型切换：完成态不残留（保持 buildTask 重建语义，carryCompletion 不跨类型）
  const crossSrc = run({
    type: 'task:create',
    draft: { kind: 'deadline', title: '要转去清单池', important: false, dueDay: at(2026, 9, 16), allDay: true }
  }).touchedTaskId!
  run({ type: 'task:complete', id: crossSrc })
  run({ type: 'task:edit', id: crossSrc, draft: { kind: 'someday', title: '转去清单池', important: false } })
  const crossBack = byId(crossSrc)!
  check('跨类型 edit：kind 变 someday', crossBack.kind, 'someday')
  check('跨类型 edit：不残留 completedAt', 'completedAt' in crossBack, false)

  // ---- 业务性失败 ----
  // 上面几段把 deadlineId / somedayId 的类型来回切过，这里另起两条干净的
  const freshSomeday = run({ type: 'task:create', draft: { kind: 'someday', title: '干净清单', important: false } }).touchedTaskId!
  const freshDeadline = run({
    type: 'task:create',
    draft: { kind: 'deadline', title: '干净截止', important: false, dueDay: at(2026, 9, 16), allDay: true }
  }).touchedTaskId!

  const missing = run({ type: 'task:complete', id: 'nope' })
  check('不存在的 id：ok 为 false', missing.ok, false)
  check('不存在的 id：给业务错误文案', missing.error, '任务不存在：nope')
  check('不存在的 id：不是写盘错误（不该弹提示条）', missing.writeError, undefined)
  check('不存在的 id：不带 touchedTaskId', missing.touchedTaskId, undefined)
  check('清单池不能 complete', run({ type: 'task:complete', id: freshSomeday }).ok, false)
  check('非清单池不能 toToday', run({ type: 'task:toToday', id: freshDeadline }).ok, false)
  check('清单池不能 snooze', run({ type: 'task:snooze', id: freshSomeday, minutes: 10 }).ok, false)
  check('清单池不能 postpone', run({ type: 'task:postpone', id: freshSomeday }).ok, false)
  check('edit 不存在的 id 失败', run({ type: 'task:edit', id: 'nope', draft: { kind: 'someday', title: 'x', important: false } }).ok, false)
  check('remove 不存在的 id 失败', run({ type: 'task:remove', id: 'nope' }).ok, false)
  check('失败的命令不改数据', (byId(freshSomeday) as SomedayTask).kind, 'someday')

  // ---- task:complete ----
  const d2 = run({ type: 'task:create', draft: { kind: 'deadline', title: '完成我', important: false, dueDay: at(2026, 9, 16), allDay: true } })
  const d2id = d2.touchedTaskId!
  run({ type: 'task:complete', id: d2id })
  check('complete 写 completedAt', (byId(d2id) as DeadlineTask).completedAt, now)

  run({ type: 'task:complete', id: recurringId })
  const rec = byId(recurringId) as RecurringTask
  check('周期任务 complete 写 lastDoneDay', rec.lastDoneDay, '2026-09-16')
  check('周期任务 complete 记 streak 1', rec.streak, 1)
  run({ type: 'task:complete', id: recurringId })
  check('同一 now 再 complete 不累加 streak', (byId(recurringId) as RecurringTask).streak, 1)

  // 昨天做过 → streak +1
  store.updateTask(recurringId, { lastDoneDay: '2026-09-15', streak: 4 })
  run({ type: 'task:complete', id: recurringId })
  check('昨天做过则 streak +1', (byId(recurringId) as RecurringTask).streak, 5)

  // ---- task:uncomplete ----
  // 取消完成只对截止型有意义；关键是**不动 firedFor** ——
  // 点错勾不该被已经弹过的通知再追着打一次
  const u1 = run({
    type: 'task:create',
    draft: { kind: 'deadline', title: '点错了', important: false, dueDay: at(2026, 9, 16), allDay: false, time: '09:00' }
  })
  const u1id = u1.touchedTaskId!
  store.updateTask(u1id, { firedFor: at(2026, 9, 16, 8, 45) })
  run({ type: 'task:complete', id: u1id })
  check('uncomplete 前确实是已完成', (byId(u1id) as DeadlineTask).completedAt, now)
  run({ type: 'task:uncomplete', id: u1id })
  check('uncomplete 清 completedAt', (byId(u1id) as DeadlineTask).completedAt, null)
  check('uncomplete 不动 firedFor', byId(u1id)!.firedFor, at(2026, 9, 16, 8, 45))
  // 提醒点仍然等于 firedFor → dueNow 的幂等挡板照旧生效，不会再弹一次
  check(
    'uncomplete 后提醒点仍等于 firedFor（不会重弹）',
    remindAtOf(byId(u1id) as DeadlineTask, S, now),
    byId(u1id)!.firedFor
  )

  const again = run({ type: 'task:uncomplete', id: u1id })
  check('本来就没完成的 uncomplete 失败', again.ok, false)
  check('失败是业务性的，不该弹「数据写入失败」', again.writeError, undefined)
  // 周期任务的完成态是 lastDoneDay + streak，没有历史可还原 —— 显式拒绝，
  // 而不是做一个会把连续天数吃掉的动作
  check('周期任务不能 uncomplete', run({ type: 'task:uncomplete', id: recurringId }).ok, false)
  check('清单池不能 uncomplete', run({ type: 'task:uncomplete', id: freshSomeday }).ok, false)
  check('不存在的 id 不能 uncomplete', run({ type: 'task:uncomplete', id: 'nope' }).ok, false)

  // ---- task:snooze ----
  const e1 = run({ type: 'task:create', draft: { kind: 'deadline', title: '推迟我', important: false, dueDay: at(2026, 9, 16, 18), allDay: false, time: '18:00' } })
  const e1id = e1.touchedTaskId!
  store.updateTask(e1id, { firedFor: at(2026, 9, 16, 17, 45) })
  run({ type: 'task:snooze', id: e1id, minutes: 10 })
  check('snooze 写 snoozeUntil', (byId(e1id) as DeadlineTask).snoozeUntil, now + 10 * 60_000)
  check('snooze 清 firedFor', byId(e1id)!.firedFor, null)
  run({ type: 'task:snooze', id: e1id, minutes: 0 })
  check('snooze 分钟数下限为 1', (byId(e1id) as DeadlineTask).snoozeUntil, now + 60_000)

  // ---- task:postpone ----
  const p1 = run({ type: 'task:create', draft: { kind: 'deadline', title: '推到明天', important: false, dueDay: at(2026, 9, 16, 9), allDay: false, time: '09:58' } })
  const p1id = p1.touchedTaskId!
  run({ type: 'task:postpone', id: p1id })
  const postponed = byId(p1id) as DeadlineTask
  check('postpone 保持时分挪到明天', postponed.dueAt, at(2026, 9, 17, 9, 58))
  check('postpone 清 snoozeUntil', postponed.snoozeUntil, null)
  check('postpone 清 firedFor', byId(p1id)!.firedFor, null)

  const recId2 = run({
    type: 'task:create',
    draft: { kind: 'recurring', title: '周期推后', important: false, rule: { freq: 'daily', every: 1, skipWeekend: false }, remindTime: '09:00' }
  }).touchedTaskId!
  run({ type: 'task:postpone', id: recId2 })
  check('周期任务 postpone = 今天跳过', (byId(recId2) as RecurringTask).lastDoneDay, '2026-09-16')

  // ---- task:remove / restore ----
  run({ type: 'task:remove', id: p1id })
  check('remove 写 deletedAt', byId(p1id)!.deletedAt, now)
  store.updateTask(p1id, { firedFor: at(2026, 9, 16, 9, 43) })
  run({ type: 'task:restore', id: p1id })
  check('restore 清 deletedAt', byId(p1id)!.deletedAt, null)
  check('restore 清 firedFor（否则永不提醒）', byId(p1id)!.firedFor, null)

  // ---- task:toToday ----
  const s2 = run({ type: 'task:create', draft: { kind: 'someday', title: '今天做我', note: '备注', important: true } })
  const s2id = s2.touchedTaskId!
  run({ type: 'task:toToday', id: s2id })
  const today = byId(s2id) as DeadlineTask
  check('toToday 变成截止型', today.kind, 'deadline')
  check('toToday 是全天型', today.allDay, true)
  check('toToday dueAt = startOfDay(now)', today.dueAt, at(2026, 9, 16))
  check('toToday 保留标题', today.title, '今天做我')
  check('toToday 保留备注', today.note, '备注')
  check('toToday 保留 important', today.important, true)
  check('toToday 保留 id', today.id, s2id)
  // 23:59 的边界：另起一条**干净的**清单池任务 —— 上面 s2id 已经被转成截止型了，
  // 对非 someday 的 task:toToday，route 直接判 invalid（第二次调用会 ok:false）。
  // 这里断言的是真实语义：dueAt 落在当天 00:00，而逾期判据是 dueAt < startOfDay(now)，
  // 此刻两者**相等** → 它不逾期，进的是「今天随时」段（规格 §14 第 3 条，刻意不特判）。
  const lateSrc = run({
    type: 'task:create',
    draft: { kind: 'someday', title: '夜里翻出来的', important: false }
  }).touchedTaskId!
  const late = applyCommand(store, { type: 'task:toToday', id: lateSrc }, at(2026, 9, 16, 23, 59))
  const lateTask = byId(lateSrc) as DeadlineTask
  check('23:59 点今天做：dueAt 仍是当天零点', lateTask.dueAt, at(2026, 9, 16))
  check('23:59 点今天做：返回 ok', late.ok, true)
  check('23:59 点今天做：dueAt 不早于 startOfDay(now) → 不算逾期',
    lateTask.dueAt < startOfDay(at(2026, 9, 16, 23, 59)), false)

  // ---- settings:patch ----
  run({ type: 'settings:patch', patch: { snoozeMinutes: 20, theme: 'dark' } })
  check('settings:patch 写进去', store.settings.snoozeMinutes, 20)
  check('settings:patch 写主题', store.settings.theme, 'dark')
  check('settings:patch 不动没提到的键', store.settings.idleThresholdMin, DEFAULT_SETTINGS.idleThresholdMin)
  run({ type: 'settings:patch', patch: { quietHours: { start: '23:00', end: '07:00' } } })
  check('settings:patch 写嵌套对象', JSON.stringify(store.settings.quietHours),
    JSON.stringify({ start: '23:00', end: '07:00' }))
  check('写嵌套对象不牵连别的键', store.settings.snoozeMinutes, 20)

  // ---- 落盘 ----
  const persisted = JSON.parse(readFileSync(store.dataFile, 'utf-8')) as { tasks: Task[] }
  check('命令确实落到了磁盘', persisted.tasks.length, store.tasks.length)
  check('落盘的条目数与内存一致', persisted.tasks.length > 0, true)

  rmSync(dir, { recursive: true, force: true })
}

import { NoticeCenter } from '../src/main/notices'
import type { Notice } from '../src/shared/ipc'

console.log('\n--- notices.ts ---')
{
  const notice = (id: Notice['id'], level: Notice['level'], at: number): Notice => ({
    id, level, text: `${id}@${at}`, at
  })

  const nc = new NoticeCenter()
  check('空中心 head 为 null', nc.head(), null)
  check('空中心 list 为空', nc.list().length, 0)

  nc.raise(notice('notify-failed', 'warn', 100))
  check('raise 之后有一条', nc.list().length, 1)
  check('has 认得出', nc.has('notify-failed'), true)
  check('没提过的 id 为 false', nc.has('write-failed'), false)

  // 同 id 覆盖，不新增
  nc.raise(notice('notify-failed', 'warn', 200))
  check('同 id 覆盖不新增', nc.list().length, 1)
  check('同 id 取最新', nc.head()!.at, 200)

  nc.raise(notice('write-failed', 'error', 150))
  check('不同 id 会新增', nc.list().length, 2)
  check('最严重优先：error 在前', nc.head()!.id, 'write-failed')
  check('list 的顺序稳定', nc.list().map((n) => n.id).join(','), 'write-failed,notify-failed')

  // 同级别按时间新的在前。
  // 先把 notify-failed 收回：它只被 raise 过、从没 dismiss / clear，会一直留在
  // list 里；不收回的话下面三条断言（排序串 / dismiss 后的串 / list 长度）都会多出它。
  nc.clear('notify-failed')
  nc.clear('write-failed')
  nc.raise(notice('write-failed', 'error', 300))
  nc.raise(notice('corrupt-backup', 'error', 400))
  check('同级别新的在前', nc.list().map((n) => n.id).join(','), 'corrupt-backup,write-failed')

  // dismiss
  nc.dismiss('corrupt-backup')
  check('dismiss 后不在 list 里', nc.list().map((n) => n.id).join(','), 'write-failed')
  check('dismiss 后 has 为 false', nc.has('corrupt-backup'), false)
  nc.raise(notice('corrupt-backup', 'error', 500))
  check('dismiss 过的 id 再 raise 也不显示（本次运行内）', nc.has('corrupt-backup'), false)
  check('但内容确实被更新了', nc.list().length, 1)

  // clear 会重置 dismiss
  nc.clear('corrupt-backup')
  check('clear 后不再被压制', nc.has('corrupt-backup'), false)
  nc.raise(notice('corrupt-backup', 'warn', 600))
  check('clear 之后 raise 能显示', nc.has('corrupt-backup'), true)

  // clear 未提及的 id 不炸
  nc.clear('write-failed')
  check('clear 之后该条消失', nc.has('write-failed'), false)

  check('action 原样带出', (() => {
    const c = new NoticeCenter()
    c.raise({
      id: 'corrupt-backup', level: 'error', text: '坏了', at: 1,
      action: { label: '打开所在文件夹', windowAction: 'open-data-dir' }
    })
    return c.head()!.action!.windowAction
  })(), 'open-data-dir')
}

// ---------------------------------------------------------------------------
// 月历。日期控件里最容易差一格的就是「月初要补几格」，而补错了肉眼看不出
// （整张日历会整体右移一天，看着也像一张日历）。所以按固定月份断言。
//
// 2026 年 9 月：1 日是周二，30 天 → 前补 1 格（8/31）、5 行、最后一行尾补 4 格。
// ---------------------------------------------------------------------------
console.log('\n--- calendar.ts：月历网格 ---')
{
  const sep = monthGrid(2026, 9)
  check('9 月排成 5 行', sep.length, 5)
  check('每行 7 格', sep.every((w) => w.length === 7), true)
  check('周一起始：第一列的星期几是周一', sep[0][0].weekday, 1)

  check('9/1 是周二 → 前面补 1 格', dayKey(sep[0][0].ts), '2026-08-31')
  check('那格标记为邻月', sep[0][0].inMonth, false)
  check('9 月 1 日落在第二列', dayKey(sep[0][1].ts), '2026-09-01')
  check('9 月 1 日是本月的', sep[0][1].inMonth, true)
  check('最后一天是 9 月 30 日', dayKey(sep[4][2].ts), '2026-09-30')
  check('尾补的第一格是 10 月 1 日', dayKey(sep[4][3].ts), '2026-10-01')
  check('尾补也标成邻月', sep[4][3].inMonth, false)
  check('格子的 day 与时间戳一致', sep[4][2].day, 30)

  const inMonthDays = sep.flat().filter((c) => c.inMonth).length
  check('9 月有 30 天', inMonthDays, 30)

  // 2 月：2026 平年 / 2024 闰年，且 2026-02-01 是周日 → 前补 6 格
  check('2026-02-01 是周日 → 前补 6 格', dayKey(monthGrid(2026, 2)[0][6].ts), '2026-02-01')
  check('平年 2 月 28 天', monthGrid(2026, 2).flat().filter((c) => c.inMonth).length, 28)
  check('闰年 2 月 29 天', monthGrid(2024, 2).flat().filter((c) => c.inMonth).length, 29)

  check('翻月跨年：12 月 +1 → 次年 1 月', JSON.stringify(shiftMonth({ year: 2026, month1: 12 }, 1)), '{"year":2027,"month1":1}')
  check('翻月跨年：1 月 -1 → 上年 12 月', JSON.stringify(shiftMonth({ year: 2026, month1: 1 }, -1)), '{"year":2025,"month1":12}')
  check('月份写汉字', monthLabel({ year: 2026, month1: 9 }), '2026 年 九月')
  check('表头是周一起', CAL_HEADERS.join(''), '一二三四五六日')
  check('月份表有 12 项', CN_MONTHS.length, 12)

  check('tsFromDayKey 回到当天零点', tsFromDayKey('2026-09-18'), startOfDay(at(2026, 9, 18)))
  check('tsFromDayKey 拒绝非日期串', tsFromDayKey('2026/09/18'), null)
  check('tsFromDayKey 拒绝 2 月 31 日（不能悄悄滚到 3 月）', tsFromDayKey('2026-02-31'), null)
  check('tsFromDayKey 拒绝 13 月', tsFromDayKey('2026-13-01'), null)
  check('dayKeyOf 与 tsFromDayKey 同格式', dayKeyOf({ ts: at(2026, 9, 18), day: 18, inMonth: true, weekday: 5 }), '2026-09-18')

  const now = at(2026, 9, 18, 10, 0)
  check('相对日：今天', relativeDayLabel(at(2026, 9, 18, 23, 0), now), '今天')
  check('相对日：明天', relativeDayLabel(at(2026, 9, 19), now), '明天')
  check('相对日：后天', relativeDayLabel(at(2026, 9, 20), now), '后天')
  check('相对日：昨天', relativeDayLabel(at(2026, 9, 17), now), '昨天')
  check('相对日：前天', relativeDayLabel(at(2026, 9, 16), now), '前天')
  check('相对日：3 天后', relativeDayLabel(at(2026, 9, 21), now), '3 天后')
  check('相对日：一周内还算', relativeDayLabel(at(2026, 9, 25), now), '7 天后')
  check('相对日：一周之外不给文案', relativeDayLabel(at(2026, 9, 26), now), null)

  // 「下周一」必须是**严格之后**的那个周一：今天就是周一时得是 7 天后
  check('周五的下周一 = 9/21', dayKey(nextWeekdayAfter(at(2026, 9, 18), 1)), '2026-09-21')
  check('周一的下周一 = 下周的周一', dayKey(nextWeekdayAfter(at(2026, 9, 21), 1)), '2026-09-28')
  check('周日 + 周一 = 明天', dayKey(nextWeekdayAfter(at(2026, 9, 20), 1)), '2026-09-21')
}

console.log('\n--- done.ts（已完成这本账）---')
{
  const now = at(2026, 9, 16, 16, 0) // 周三

  const dLate = deadline({ id: 'd-late', dueAt: at(2026, 9, 10, 10, 0), completedAt: at(2026, 9, 16, 14, 20) })
  const dEarly = deadline({ id: 'd-early', dueAt: at(2026, 9, 16, 9, 0), completedAt: at(2026, 9, 16, 9, 5) })
  const dYest = deadline({ id: 'd-yest', dueAt: at(2026, 9, 15, 18, 0), completedAt: at(2026, 9, 15, 18, 30) })
  const dOpen = deadline({ id: 'd-open' }) // 没完成
  const dGone = deadline({ id: 'd-gone', completedAt: at(2026, 9, 16, 12, 0), deletedAt: now })
  const rToday = recurring({ id: 'r-today', lastDoneDay: '2026-09-16', streak: 5 })
  const rOld = recurring({ id: 'r-old', lastDoneDay: '2026-09-13', streak: 2 })
  const rNever = recurring({ id: 'r-never' })
  const s1 = someday({ id: 's-1' })

  const all: Task[] = [dLate, dEarly, dYest, dOpen, dGone, rToday, rOld, rNever, s1]
  const led = collectDone(all, now)

  // 分组：按**完成日**分，不是按截止日 —— dLate 的 dueAt 是 9/10，但它落在 9/16 组
  check('账本：分成两天', led.days.length, 2)
  check('账本：最新的一天在最前', led.days[0].key, '2026-09-16')
  check('账本：按完成日而非截止日入组', led.days[0].tasks.length, 2)
  check('账本：同一天里最近做完的在最上面', led.days[0].tasks[0].id, 'd-late')
  check('账本：同一天里次新的第二', led.days[0].tasks[1].id, 'd-early')
  check('账本：第二天是昨天', led.days[1].key, '2026-09-15')

  // 排除项：没完成的、软删的、清单池的都不进账
  const ids = led.days.flatMap((d) => d.tasks.map((t) => t.id)).join(',')
  check('账本：没完成的不进账', ids.includes('d-open'), false)
  check('账本：软删的不进账', ids.includes('d-gone'), false)
  check('账本：清单池不进任何一段', led.recurring.some((t) => t.id === 's-1'), false)

  check('账本：一次性完成数', led.total, 3)
  check('账本：周期打卡按最近完成日倒序', led.recurring.map((t) => t.id).join(','), 'r-today,r-old')
  check('账本：从没打过卡的习惯不进账', led.recurring.some((t) => t.id === 'r-never'), false)
  check('账本：总条数 = 一次性 + 周期', led.count, 5)

  const empty = collectDone([], now)
  check('账本：空账 days 为空', empty.days.length, 0)
  check('账本：空账 count 为 0', empty.count, 0)

  // 底栏计数必须和账本一致 —— 两处各写一份过滤迟早只有一份是对的
  check('doneCount 与账本一致', doneCount(all), led.count)

  // 标题：近三天用相对说法，一周以外换成日期 + 星期
  check('账本标题：今天', doneDayLabel(at(2026, 9, 16), now), '今天')
  check('账本标题：昨天', doneDayLabel(at(2026, 9, 15), now), '昨天')
  check('账本标题：前天', doneDayLabel(at(2026, 9, 14), now), '前天')
  check('账本标题：一周内仍是相对说法', doneDayLabel(at(2026, 9, 13), now), '3 天前')
  check('账本标题：一周外换成日期加星期', doneDayLabel(at(2026, 9, 1), now), '9月1日 周二')

  // 周期任务行尾：最近一次 + 连续天数
  check('打卡文案：今天 + 连续', recurringDoneLabel(rToday, now), '今天已打卡 · 连续 5 天')
  check('打卡文案：昨天不写连续 1 天', recurringDoneLabel(recurring({ lastDoneDay: '2026-09-15', streak: 1 }), now), '昨天打卡')
  check('打卡文案：前天', recurringDoneLabel(recurring({ lastDoneDay: '2026-09-14', streak: 0 }), now), '前天打卡')
  check('打卡文案：更早换日期', recurringDoneLabel(rOld, now), '上次 9月13日 · 连续 2 天')
  check('打卡文案：连着一天不给「连续」', recurringDoneLabel(recurring({ lastDoneDay: '2026-09-16', streak: 1 }), now), '今天已打卡')
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${checks - failures}/${checks} 项通过`)
if (failures > 0) process.exitCode = 1
