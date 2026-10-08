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
import { anniversaryTag, missedTag, parseActivation, taskTag } from '../src/shared/activation'
import { buildToastXml } from '../src/shared/toastXml'
import { describeAnniversary, describeTask, missedSummary } from '../src/shared/notifyText'
import {
  TRAY_ICON_SCALE,
  TRAY_ICON_SIZE,
  parseHexColor,
  trayIconBitmap,
  trayIconPng
} from '../src/shared/trayIcon'
import { APP_ICON_SIZES, appIconBitmap, buildAppIco, buildAppIcns, encodeIcns, ICNS_ENTRIES } from '../src/shared/appIcon'
import {
  CAL_HEADERS,
  CN_MONTHS,
  dayKeyOf,
  dayLabel,
  monthGrid,
  monthLabel,
  nextWeekdayAfter,
  relativeDayLabel,
  shiftMonth,
  tsFromDayKey
} from '../src/shared/calendar'
import { collectDone, doneCount, recurringDoneLabel } from '../src/shared/done'
import { collectUpcoming, upcomingCount } from '../src/shared/future'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store, normalizeAnniversary } from '../src/main/store'
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
import {
  clampPercent,
  friendlyError,
  initialUpdateState,
  isPortable,
  sameUpdateState,
  updateReducer,
  updateSummary,
  updateUnsupportedReason
} from '../src/shared/update'

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

  // 6. 深校验：形状半截的记录必须被拦下。
  //    下面这几条**都能过旧的浅校验**，然后分别在主进程 / 渲染层炸掉 ——
  //    见 store.ts 的 normalizeTask。这里逐条钉住，别再退回浅校验。
  const s6 = new Store(file)
  s6.addTask(deadline({ id: 'p2' }))
  const raw3 = JSON.parse(readFileSync(file, 'utf-8'))
  const good = raw3.tasks[0]
  const recBase = {
    kind: 'recurring', id: 'r', title: '习惯', important: false,
    createdAt: at(2026, 9, 16), updatedAt: at(2026, 9, 16),
    deletedAt: null, firedFor: null, lastDoneDay: null, streak: 0, snoozeUntil: null
  }
  raw3.tasks = [
    good,
    // 缺 remindTime：dueNow → parseHM 读 undefined.split（主进程每 10 秒抛一次）
    { ...recBase, id: 'no-remind-time', rule: { freq: 'daily', every: 1, skipWeekend: false } },
    // 每周规则缺 days：matchesDay 读 undefined.some（渲染层 render 抛，白屏）
    { ...recBase, id: 'weekly-no-days', rule: { freq: 'weekly', every: 1, skipWeekend: false }, remindTime: '09:00' },
    // 缺 every：x % undefined === NaN，规则静默永不命中 —— 比抛错更难发现
    { ...recBase, id: 'no-every', rule: { freq: 'daily', skipWeekend: false }, remindTime: '09:00' },
    // 截止型缺 allDay / leadMin
    {
      kind: 'deadline', id: 'deadline-no-allday', title: '交周报', important: false,
      createdAt: at(2026, 9, 16), updatedAt: at(2026, 9, 16),
      deletedAt: null, firedFor: null, dueAt: at(2026, 9, 17),
      snoozeUntil: null, completedAt: null
    },
    // important 不是布尔（JSON.stringify 会把 undefined 直接删掉）
    { ...good, id: 'no-important', important: undefined },
    // 类型对但内容怪：'9:00' 没补零，parseHM 认，不该为它丢用户的记录
    { ...recBase, id: 'loose-time', rule: { freq: 'daily', every: 1, skipWeekend: false }, remindTime: '9:00' }
  ]
  writeFileSync(file, JSON.stringify(raw3), 'utf-8')

  const s6b = new Store(file)
  check('缺 remindTime 的周期任务被拦下', s6b.tasks.some((t) => t.id === 'no-remind-time'), false)
  check('缺 days 的每周规则被拦下', s6b.tasks.some((t) => t.id === 'weekly-no-days'), false)
  check('缺 every 的规则被拦下', s6b.tasks.some((t) => t.id === 'no-every'), false)
  check('缺 allDay 的截止任务被拦下', s6b.tasks.some((t) => t.id === 'deadline-no-allday'), false)
  check('important 不是布尔的记录被拦下', s6b.tasks.some((t) => t.id === 'no-important'), false)
  check('remindTime 只补零不齐时照常放行', s6b.tasks.some((t) => t.id === 'loose-time'), true)
  check('好记录照常留下', s6b.tasks.some((t) => t.id === 'p2'), true)
  check('跳过条数被记下来', s6b.droppedTaskCount, 5)
  check('被跳过的原文有备份', typeof s6b.corruptBackupPath, 'string')
  check(
    '备份里含被跳过的记录',
    readFileSync(s6b.corruptBackupPath as string, 'utf-8').includes('no-remind-time'),
    true
  )
  check('活文件留在原地（跳过走复制，不走改名）', existsSync(file), true)
  check('没跳过时计数为 0', new Store(join(dir, 'clean.json')).droppedTaskCount, 0)

  // 7. 更新不存在的 id
  check('更新不存在的 id 返回 null', s6.updateTask('nope', { title: 'x' }), null)

  // 8. 原子性：不应留下 .tmp
  check('写入后无残留 tmp 文件', existsSync(`${file}.tmp`), false)

  // 9. 批量更新只写一次盘。
  //    markFired 的 59 倍写放大就是这么来的（逐条 updateTask = 逐条全量重写 + fsync）。
  //    tsc 把 `import { writeFileSync }` 编成 `node_fs_1.writeFileSync(...)`，
  //    即每次调用都查模块对象的属性，所以这里替换掉它就能数出写盘次数。
  const fsMod = require('node:fs') as typeof import('node:fs')
  const s9 = new Store(join(dir, 'batch.json'))
  for (let i = 0; i < 20; i++) s9.addTask(deadline({ id: `b${i}` }))
  const realWrite = fsMod.writeFileSync
  let writes = 0
  fsMod.writeFileSync = ((...args: Parameters<typeof realWrite>) => {
    writes++
    return realWrite(...args)
  }) as typeof realWrite
  const touched = s9.updateTasks(
    Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, patch: { firedFor: 1234 } }))
  )
  fsMod.writeFileSync = realWrite
  check('批量更新 20 条只写一次盘', writes, 1)
  check('批量更新返回全部命中的记录', touched.length, 20)
  check('批量更新真的写进去了', s9.tasks.every((t) => t.firedFor === 1234), true)

  writes = 0
  fsMod.writeFileSync = ((...args: Parameters<typeof realWrite>) => {
    writes++
    return realWrite(...args)
  }) as typeof realWrite
  s9.updateTasks([])
  fsMod.writeFileSync = realWrite
  check('空批次不写盘', writes, 0)

  // 10. 启动时清掉早过撤销窗口的软删记录。
  //     界面上「删除」只留 5 秒撤销窗口（exit.ts 的 EXIT_REMOVED_MS），
  //     而且没有任何视图会列出软删任务 —— 留着只是让文件单调变大。
  const s10 = new Store(join(dir, 'purge.json'))
  s10.addTask(deadline({ id: 'fresh' }))
  s10.addTask(deadline({ id: 'ancient' }))
  const longAgo = Date.now() - 31 * 24 * 60 * 60_000
  s10.updateTask('ancient', { deletedAt: longAgo })
  s10.updateTask('fresh', { deletedAt: Date.now() })
  const s10b = new Store(join(dir, 'purge.json'))
  check('超过 30 天的软删记录被清掉', s10b.tasks.some((t) => t.id === 'ancient'), false)
  check('刚删的还在（撤销窗口内）', s10b.tasks.some((t) => t.id === 'fresh'), true)

  // 11. 文件版本比程序新（装过更新的版本又退回来）：数据照读，但**先备份**。
  //     每次写盘都是全量重写，不备份的话第一次改设置就会把新格式的字段抹掉。
  const newerFile = join(dir, 'newer.json')
  writeFileSync(
    newerFile,
    JSON.stringify({ version: FILE_VERSION + 7, tasks: [deadline({ id: 'from-future' })], settings: {} }),
    'utf-8'
  )
  const s11 = new Store(newerFile)
  check('更新的版本号被记下来', s11.newerFileVersion, FILE_VERSION + 7)
  check('数据照常读进来（不整份丢掉）', s11.tasks.some((t) => t.id === 'from-future'), true)
  check('动它之前先备份了', typeof s11.corruptBackupPath, 'string')
  check(
    '备份里是那份新格式的原文',
    readFileSync(s11.corruptBackupPath as string, 'utf-8').includes('from-future'),
    true
  )
  check('版本正常时没有降级标记', new Store(join(dir, 'clean.json')).newerFileVersion, null)

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
  check(
    'FILE_VERSION = 4（v2 加 anniversaries，v3 加 autoUpdate，v4 加纪念日的 notify/firedFor）',
    FILE_VERSION,
    4
  )
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
  check('默认不置顶窗口', DEFAULT_SETTINGS.alwaysOnTop, false)
  check('默认显示节假日倒计时', DEFAULT_SETTINGS.countdownHolidays, true)
  check('默认倒计时看一年', DEFAULT_SETTINGS.countdownHorizonDays, 365)
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

console.log('\n--- 应用图标：.icns 的容器格式（mac）---')
{
  // mac 侧的坑与 Windows 同构：容器是手编的，写错一个字段 Finder 会直接
  // 拒收整个 icns，而 electron-builder 不做校验 —— 只能在这里拦。
  const icns = buildAppIcns()
  check('ICNS magic = "icns"', icns.subarray(0, 4).toString('ascii'), 'icns')
  // 头部总长必须等于整个文件：写小了 Finder 拒收，写大了读取越界
  check('头部总长 = 整个文件长度', icns.readUInt32BE(4), icns.length)

  // 先按容器自身的长度域把条目偏移扫出来，再逐条断言 —— 断言集中、
  // 没有提前退出的控制流，读到坏数据也只产生一条明确的失败
  const chunks: Array<{ type: string; len: number; off: number }> = []
  let cursor = 8
  // 64 是防死循环的上限：真容器只有 4 条目；万一长度域损坏也不会在这里吊死
  while (cursor < icns.length && chunks.length < 64) {
    chunks.push({
      type: icns.subarray(cursor, cursor + 4).toString('ascii'),
      len: icns.readUInt32BE(cursor + 4),
      off: cursor
    })
    cursor += icns.readUInt32BE(cursor + 4)
  }
  check('条目数 = ICNS_ENTRIES', chunks.length, ICNS_ENTRIES.length)
  check('条目首尾相接，最后一项落在文件尾', cursor, icns.length)

  chunks.forEach((chunk, i) => {
    const { type, size } = ICNS_ENTRIES[i]
    check(`@${chunk.off} 是 ${type}`, chunk.type, type)
    // PNG 签名 8 + IHDR 长度域 4 + 'IHDR' 4 → 宽在第 16 字节起
    const png = icns.subarray(chunk.off + 8, chunk.off + chunk.len)
    check(`${type} 的载荷长 = 条目长 - 8`, png.length, chunk.len - 8)
    check(`${type} 载荷是 PNG`, png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    check(`${type} 对应的 PNG 宽 = ${size}`, png.readUInt32BE(16), size)
  })

  // encodeIcns 对任意条目集都该成立：用一个假条目验「总长 = 8 + Σ(8+载荷)」
  const tiny = encodeIcns([{ type: 'ic07', data: Buffer.alloc(4, 7) }])
  check('手编容器的总长算式', tiny.readUInt32BE(4), 8 + 8 + 4)
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

  const incoming = [afterDone, other]
  const none = mergeExiting(incoming, [], now)
  check('空 exiting：原样返回', none.tasks.map((t) => t.id).join(','), 'a,b')
  check('空 exiting：已完成的那条保持已完成',
    (none.tasks[0] as DeadlineTask).completedAt, now)
  check('空 exiting：没有过期项', none.expired.length, 0)
  // 同一个引用：下游 useMemo 靠它判断「没变」，新建数组会让整棵树每秒重算
  check('空 exiting：返回的就是入参本身（身份不变）', none.tasks === incoming, true)

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

  // 同 id 覆盖，不新增
  nc.raise(notice('notify-failed', 'warn', 200))
  check('同 id 覆盖不新增', nc.list().length, 1)
  check('同 id 取最新', nc.head()!.at, 200)

  nc.raise(notice('write-failed', 'error', 150))
  check('不同 id 会新增', nc.list().length, 2)
  check('最严重优先：error 在前', nc.head()!.id, 'write-failed')
  check('list 的顺序稳定', nc.list().map((n) => n.id).join(','), 'write-failed,notify-failed')

  // 同级别按时间新的在前。
  // 每个场景一个**新实例**：同 id 只保留一条是这个类的主要行为，
  // 共用实例就得先想办法把上一条收回，反而看不清哪条断言依赖什么。
  const order = new NoticeCenter()
  order.raise(notice('write-failed', 'error', 300))
  order.raise(notice('corrupt-backup', 'error', 400))
  check('同级别新的在前', order.list().map((n) => n.id).join(','), 'corrupt-backup,write-failed')

  // dismiss：本次运行内这一类不再显示，但别的不受影响
  const dis = new NoticeCenter()
  dis.raise(notice('corrupt-backup', 'error', 400))
  dis.dismiss('corrupt-backup')
  check('dismiss 后不在 list 里', dis.list().length, 0)
  check('dismiss 后 head 为 null', dis.head(), null)
  dis.raise(notice('corrupt-backup', 'error', 500))
  check('dismiss 过的 id 再 raise 也不显示（本次运行内）', dis.list().length, 0)
  dis.raise(notice('write-failed', 'warn', 600))
  check('dismiss 一个 id 不影响别的', dis.list().map((n) => n.id).join(','), 'write-failed')

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

  // 日名：近三天用相对说法，一周以外换成日期 + 星期（已完成与「以后」共用）
  check('日名：今天', dayLabel(at(2026, 9, 16), now), '今天')
  check('日名：昨天', dayLabel(at(2026, 9, 15), now), '昨天')
  check('日名：前天', dayLabel(at(2026, 9, 14), now), '前天')
  check('日名：一周内仍是相对说法', dayLabel(at(2026, 9, 13), now), '3 天前')
  check('日名：一周外换成日期加星期', dayLabel(at(2026, 9, 1), now), '9月1日 周二')
  check('日名：明天', dayLabel(at(2026, 9, 17), now), '明天')
  check('日名：后天', dayLabel(at(2026, 9, 18), now), '后天')

  // 周期任务行尾：最近一次 + 连续天数
  check('打卡文案：今天 + 连续', recurringDoneLabel(rToday, now), '今天已打卡 · 连续 5 天')
  check('打卡文案：昨天不写连续 1 天', recurringDoneLabel(recurring({ lastDoneDay: '2026-09-15', streak: 1 }), now), '昨天打卡')
  check('打卡文案：前天', recurringDoneLabel(recurring({ lastDoneDay: '2026-09-14', streak: 0 }), now), '前天打卡')
  check('打卡文案：更早换日期', recurringDoneLabel(rOld, now), '上次 9月13日 · 连续 2 天')
  check('打卡文案：连着一天不给「连续」', recurringDoneLabel(recurring({ lastDoneDay: '2026-09-16', streak: 1 }), now), '今天已打卡')
}

console.log('\n--- future.ts（以后这本账）---')
{
  const now = at(2026, 9, 16, 16, 0) // 周三

  const fTomorrowLate = deadline({ id: 'f-t-late', dueAt: at(2026, 9, 17, 17, 0) })
  const fTomorrowEarly = deadline({ id: 'f-t-early', dueAt: at(2026, 9, 17, 9, 30) })
  const fTomorrowAllDay = deadline({ id: 'f-t-allday', dueAt: at(2026, 9, 17), allDay: true })
  const fTomorrowImportant = deadline({
    id: 'f-t-imp', dueAt: at(2026, 9, 17), allDay: true, important: true
  })
  const fDayAfter = deadline({ id: 'f-dafter', dueAt: at(2026, 9, 18, 14, 0) })
  const fNextMonth = deadline({ id: 'f-far', dueAt: at(2026, 10, 12, 10, 0) })
  const today = deadline({ id: 'f-today', dueAt: at(2026, 9, 16, 18, 0) })
  const overdue = deadline({ id: 'f-over', dueAt: at(2026, 9, 10, 10, 0) })
  const done = deadline({ id: 'f-done', dueAt: at(2026, 9, 20, 10, 0), completedAt: now })
  const removed = deadline({ id: 'f-gone', dueAt: at(2026, 9, 20, 10, 0), deletedAt: now })
  const pool = someday({ id: 'f-pool' })
  const every = recurring({ id: 'f-rec' })

  const all = [
    fTomorrowLate, fTomorrowEarly, fTomorrowAllDay, fTomorrowImportant,
    fDayAfter, fNextMonth, today, overdue, done, removed, pool, every
  ]
  const days = collectUpcoming(all, now)

  check('以后：按天分三段', days.map((d) => d.key).join(','), '2026-09-17,2026-09-18,2026-10-12')
  check('以后：段名是相对日', dayLabel(days[0].dayStart, now), '明天')
  check('以后：后天', dayLabel(days[1].dayStart, now), '后天')
  check('以后：一周外换成日期加星期', dayLabel(days[2].dayStart, now), '10月12日 周一')
  check('以后：今天的归看板，不进这里', days.some((d) => d.tasks.some((t) => t.id === 'f-today')), false)
  check('以后：逾期的也不重复列', days.some((d) => d.tasks.some((t) => t.id === 'f-over')), false)
  check('以后：做完的不进', days.some((d) => d.tasks.some((t) => t.id === 'f-done')), false)
  check('以后：软删的不进', days.some((d) => d.tasks.some((t) => t.id === 'f-gone')), false)
  check('以后：清单池不进', days.some((d) => d.tasks.some((t) => t.id === 'f-pool')), false)
  check('以后：周期任务不进（它没有单个日期）',
    days.some((d) => d.tasks.some((t) => t.id === 'f-rec')), false)

  const t = days[0].tasks
  check('同一天：有时刻的按时刻升序', t.map((x) => x.id).join(','), 'f-t-early,f-t-late,f-t-imp,f-t-allday')
  check('同一天：全天型垫在最后', t[t.length - 1].allDay, true)
  check('垫底那段里重要的在前', t[t.length - 2].id, 'f-t-imp')

  check('以后：空账不分组', collectUpcoming([], now).length, 0)
  // 底栏计数与分组必须同源 —— 两处各写一份过滤迟早只有一份是对的
  check('upcomingCount 与分组一致', upcomingCount(all, now), t.length + 1 + 1)
}

// ── 通知激活（Windows 的点击只走 handleActivation，见 shared/activation.ts）──────
{
  const id = '97fbbb4e-a7ba-4c6f-bf72-05ed1cafbdd3'
  const at = 1789982220000

  check('标签：task 用冒号分段', taskTag(id, at), `task:${id}:${at}`)
  check('标签：missed 同理', missedTag(id, at), `missed:${id}:${at}`)
  check('标签：anniversary 同理', anniversaryTag(id, at), `anniversary:${id}:${at}`)

  // check 是 === 比较，对象一律先序列化再比
  const shape = (v: unknown): string => JSON.stringify(v)
  const act = (i: number, tag = taskTag(id, at)) =>
    parseActivation({ type: 'action', actionIndex: i, arguments: `type=action&action=${i}&tag=${tag}` })

  check('激活：第 0 颗按钮是完成', shape(act(0)), shape({ kind: 'action', taskId: id, action: 'complete' }))
  check('激活：第 1 颗是推迟', shape(act(1)), shape({ kind: 'action', taskId: id, action: 'snooze' }))
  check('激活：第 2 颗是推到明天', shape(act(2)), shape({ kind: 'action', taskId: id, action: 'tomorrow' }))
  const dashed = act(0)
  check('激活：UUID 里的连字符没把 id 切坏', dashed.kind === 'action' && dashed.taskId, id)

  check(
    '激活：点正文只唤起窗口',
    shape(parseActivation({ type: 'click', arguments: `type=click&tag=${taskTag(id, at)}` })),
    shape({ kind: 'open', taskId: id })
  )
  // 纪念日：前缀就定了去向，**不去读 actionIndex** ——
  // 读了的话，那颗同在下标 0 的按钮会被当成「完成」并落到某条任务头上
  check(
    '激活：纪念日那颗按钮 → 切到倒计时',
    shape(
      parseActivation({
        type: 'action',
        actionIndex: 0,
        arguments: `type=action&action=0&tag=${anniversaryTag(id, at)}`
      })
    ),
    shape({ kind: 'countdown' })
  )
  check(
    '激活：纪念日正文那一下 → 也切到倒计时',
    shape(parseActivation({ type: 'click', arguments: `type=click&tag=${anniversaryTag(id, at)}` })),
    shape({ kind: 'countdown' })
  )
  check(
    '激活：tag 被 URL 编码过也能认',
    shape(
      parseActivation({
        type: 'click',
        arguments: `type=click&tag=${encodeURIComponent(taskTag(id, at))}`
      })
    ),
    shape({ kind: 'open', taskId: id })
  )

  // 聚合通知只有一颗「打开待办」，它与任务通知的「完成」同为下标 0 ——
  // 按 ACTION_ORDER 解释它的话，点「打开待办」会把第一条任务直接勾掉
  check(
    '激活：聚合通知的按钮是打开，不是完成',
    shape(
      parseActivation({
        type: 'action',
        actionIndex: 0,
        arguments: `type=action&action=0&tag=${missedTag(id, at)}`
      })
    ),
    shape({ kind: 'open', taskId: id })
  )

  check('激活：下标越界退回打开窗口', shape(act(7)), shape({ kind: 'open', taskId: id }))
  check(
    '激活：不认识的 tag 什么都不做',
    shape(parseActivation({ type: 'action', actionIndex: 0, arguments: 'type=action&action=0&tag=other' })),
    shape({ kind: 'unknown' })
  )
  check(
    '激活：arguments 缺 tag 也不炸',
    shape(parseActivation({ type: 'click', arguments: 'type=click' })),
    shape({ kind: 'unknown' })
  )
}

// ── toast XML（Windows 只认 <toast launch> 上的正文参数，见 shared/toastXml.ts）──
{
  const id = '97fbbb4e-a7ba-4c6f-bf72-05ed1cafbdd3'
  const at = 1789982220000
  const tag = taskTag(id, at)
  const shape = (v: unknown): string => JSON.stringify(v)

  // Windows 读 XML 时会把实体还原回来 —— 这里就得干这件事，
  // 否则测的不是「Windows 看到什么」，而是「XML 长什么样」
  const unesc = (s: string): string =>
    s
      .replace(/&quot;/g, '"')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
  const attrOf = (src: string, name: string): string[] => {
    const out: string[] = []
    const needle = `${name}="`
    let i = src.indexOf(needle)
    while (i >= 0) {
      const start = i + needle.length
      const end = src.indexOf('"', start)
      out.push(unesc(src.slice(start, end)))
      i = src.indexOf(needle, end)
    }
    return out
  }

  const xml = buildToastXml({
    tag,
    title: '交房租',
    body: '今天 17:00',
    buttons: ['完成', '推迟 10 分钟', '推到明天'],
    silent: true
  })

  // 这一条是整段的重点：Electron 生成的 XML 没有 launch，点正文就什么都收不到
  check('toast：正文那一下带上了 launch', attrOf(xml, 'launch')[0], `type=click&tag=${tag}`)
  check(
    'toast：正文那一下被解释成「打开」',
    shape(parseActivation({ type: 'click', arguments: attrOf(xml, 'launch')[0]! })),
    shape({ kind: 'open', taskId: id })
  )

  const args = attrOf(xml, 'arguments')
  check('toast：三颗按钮', args.length, 3)
  check(
    'toast：第 0 颗是完成',
    shape(parseActivation({ type: 'action', actionIndex: 0, arguments: args[0]! })),
    shape({ kind: 'action', taskId: id, action: 'complete' })
  )
  check(
    'toast：第 1 颗是推迟',
    shape(parseActivation({ type: 'action', actionIndex: 1, arguments: args[1]! })),
    shape({ kind: 'action', taskId: id, action: 'snooze' })
  )
  check(
    'toast：第 2 颗是推到明天',
    shape(parseActivation({ type: 'action', actionIndex: 2, arguments: args[2]! })),
    shape({ kind: 'action', taskId: id, action: 'tomorrow' })
  )

  // 聚合通知那颗「打开待办」与任务的「完成」同为下标 0，参数里靠 missed: 前缀区分
  const missedXml = buildToastXml({
    tag: missedTag(id, at),
    title: '有 2 件事错过了',
    body: '交房租、交电费',
    buttons: ['打开待办'],
    silent: true
  })
  check(
    'toast：聚合通知的按钮落在「打开」',
    shape(
      parseActivation({
        type: 'action',
        actionIndex: 0,
        arguments: attrOf(missedXml, 'arguments')[0]!
      })
    ),
    shape({ kind: 'open', taskId: id })
  )

  // 纪念日那颗「打开倒计时」同样落在下标 0，靠 anniversary: 前缀区分。
  // 这条断言是必须的：万一有人按 ACTION_ORDER[0] 去解释它，点一下会把某条
  // 任务标成「完成」—— 一个在界面上完全看不见的破坏
  const annXml = buildToastXml({
    tag: anniversaryTag(id, at),
    title: '妈妈生日',
    body: '就是今天 · 第 58 周年',
    buttons: ['打开倒计时'],
    silent: true
  })
  check(
    'toast：纪念日那颗按钮切到倒计时',
    shape(
      parseActivation({
        type: 'action',
        actionIndex: 0,
        arguments: attrOf(annXml, 'arguments')[0]!
      })
    ),
    shape({ kind: 'countdown' })
  )
  check(
    'toast：纪念日正文那一下也切到倒计时',
    shape(parseActivation({ type: 'click', arguments: attrOf(annXml, 'launch')[0]! })),
    shape({ kind: 'countdown' })
  )

  check('toast：静音写 audio silent', xml.includes('<audio silent="true"/>'), true)
  const loud = buildToastXml({ tag, title: '交房租', body: '', buttons: ['完成'], silent: false })
  check('toast：不静音就不写 audio', loud.includes('<audio'), false)
  check('toast：正文为空时不渲染第二个 text', (loud.match(/<text>/g) ?? []).length, 1)

  const odd = buildToastXml({
    tag,
    title: 'a & b < c',
    body: 'd " e',
    buttons: ['x & y'],
    silent: true
  })
  check('toast：标题里的 & 与 < 被转义', odd.includes('a &amp; b &lt; c'), true)
  check('toast：正文里的引号被转义', odd.includes('d &quot; e'), true)
  check('toast：按钮文案里的 & 被转义', odd.includes('content="x &amp; y"'), true)
}

// ---------------------------------------------------------------------------
// 第四期：日历（农历 / 节气 / 节假日 / 调休）与倒计时（节假日 + 纪念日）
// ---------------------------------------------------------------------------

import {
  LUNAR_MAX_YEAR, LUNAR_MIN_YEAR, leapMonth, lunarCellLabel, lunarFestival,
  lunarOf, lunarYearDays, monthDays, solarFromLunar
} from '../src/shared/lunar'
import { SOLAR_TERMS, solarTermsOf, termOnDay, winterSolstice } from '../src/shared/term'
import {
  KNOWN_YEARS, LATEST_KNOWN_YEAR, dayMarkOf, holidayCoverageNote,
  holidayPositionOf, holidayYearKnown, isRestDay, makeupFor, nextHoliday, upcomingHolidays
} from '../src/shared/holiday'
import {
  anniversaryInLeapMonth, anniversaryOccurrence, anniversaryRemindAt, daysLeftLabel,
  dueAnniversaries, sortAnniversaries, yearsLabel, type AnniversaryEntry
} from '../src/shared/anniversary'
import { collectCountdowns, fullDate, holidaySpanLabel, shortDate } from '../src/shared/countdown'
import { agendaOfDay, monthAgenda, tasksOnDay } from '../src/shared/agenda'
import type { Anniversary } from '../src/shared/types'

function anniversary(patch: Partial<Anniversary> = {}): Anniversary {
  return {
    id: 'a1',
    title: '结婚纪念日',
    date: '2015-05-20',
    yearly: true,
    lunar: false,
    // 默认不提醒 —— 与界面新建时那个勾的默认值一致（见 AnniversaryForm 的 state）
    notify: false,
    firedFor: null,
    createdAt: at(2026, 9, 29, 10, 0),
    updatedAt: at(2026, 9, 29, 10, 0),
    ...patch
  }
}

/** 日期之间的整天数。比手算「还有 233 天」可靠 */
function daysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000)
}

console.log('\n--- 农历（1900–2100 的表，抄错一位就整年歪掉）---')
{
  // 春节：2024–2027 全部来自国务院办公厅的放假通知（通知里写着
  // 「2 月 15 日（农历腊月二十八）」这种对照），是**外部**锚点；
  // 1900 那个是这张表的定义本身
  const spring: Array<[number, string]> = [
    [1900, '1900-01-31'],
    [1912, '1912-02-18'],
    [1949, '1949-01-29'],
    [1984, '1984-02-02'],
    [1997, '1997-02-07'],
    [2000, '2000-02-05'],
    [2020, '2020-01-25'],
    [2024, '2024-02-10'],
    [2025, '2025-01-29'],
    [2026, '2026-02-17'],
    [2027, '2027-02-06']
  ]
  for (const [year, expected] of spring) {
    const ts = solarFromLunar(year, 1, 1)
    check(`${year} 年春节 = ${expected}`, ts === null ? 'null' : dayKey(ts), expected)
  }

  // 中秋 / 端午 / 除夕 —— 2026 的中秋与端午都在官方通知里出现过
  check('2026-09-25 是八月十五（中秋）', lunarOf(at(2026, 9, 25))?.label, '八月十五')
  check('2026 中秋节落在格子上', lunarCellLabel(at(2026, 9, 25)), '中秋节')
  check('2026-06-19 是五月初五（端午）', lunarOf(at(2026, 6, 19))?.label, '五月初五')
  check('2024-06-10 是五月初五（端午）', lunarOf(at(2024, 6, 10))?.label, '五月初五')
  check('2025-05-31 是五月初五（端午）', lunarOf(at(2025, 5, 31))?.label, '五月初五')
  check('2027-09-15 是八月十五（中秋）', lunarOf(at(2027, 9, 15))?.label, '八月十五')
  check('2025-10-06 是八月十五（中秋）', lunarOf(at(2025, 10, 6))?.label, '八月十五')
  check('2026-02-17 是正月初一', lunarOf(at(2026, 2, 17))?.isLeap, false)
  check('2026-09-29 是八月十九', lunarOf(at(2026, 9, 29))?.label, '八月十九')

  // 除夕是**腊月最后一天**：腊月是小月时它落在二十九，写死三十会漏掉一半年份
  check('2026 年腊月只有 29 天', monthDays(2026, 12), 29)
  check('除夕落在腊月二十九', lunarFestival(lunarOf(at(2027, 2, 5))!), '除夕')
  check('除夕的格子文案', lunarCellLabel(at(2027, 2, 5)), '除夕')
  check('正月初一的格子写月份名', lunarCellLabel(at(2027, 2, 6)), '春节')
  check('普通日子写农历日', lunarCellLabel(at(2026, 9, 29)), '十九')

  // 闰月：2025 年是闰六月。闰月的月名要带「闰」字，且闰月的天数单独记
  check('2025 年闰六月', leapMonth(2025), 6)
  const leapFirst = solarFromLunar(2025, 6, 1, true)
  check('闰六月初一算得出来', leapFirst !== null, true)
  check('闰六月初一确实是闰月', lunarOf(leapFirst!)?.monthName, '闰六月')
  check('闰六月和六月不是同一天', solarFromLunar(2025, 6, 1, false) === leapFirst, false)
  check('闰月的天数计入年长', lunarYearDays(2025) > 380, true)
  check('平年没有闰月', leapMonth(2026), 0)

  // 表的边界：外面不猜
  check('1899 年算不出来', lunarOf(at(1899, 6, 1)), null)
  check('2101 年算不出来', lunarOf(at(2101, 6, 1)), null)
  check('表的起止年', `${LUNAR_MIN_YEAR}-${LUNAR_MAX_YEAR}`, '1900-2100')

  // 往返：农历 → 公历 → 农历，十年里一天不差
  let roundTrip = 0
  for (let ts = at(2020, 1, 1); ts < at(2031, 1, 1); ts = addDays(ts, 1)) {
    const l = lunarOf(ts)
    if (l === null) { roundTrip++; continue }
    if (solarFromLunar(l.year, l.month, l.day, l.isLeap) !== startOfDay(ts)) roundTrip++
  }
  check('2020–2030 每天往返一致（0 处不符）', roundTrip, 0)

  /**
   * 冬至必落十一月 —— 这是农历**置闰规则本身**：闰月就是「不含冬至的那个月」。
   * 一个十六进制位抄错，通常会在这一步的某一年暴露出来。
   * 拿它当整张表的体检，比逐年核对春节更狠：199 年全过。
   */
  let solsticeOff = 0
  const offenders: string[] = []
  for (let y = 1900; y <= 2098; y++) {
    const ts = tsFromDayKey(winterSolstice(y).key)
    const l = ts === null ? null : lunarOf(ts)
    if (l === null || l.month !== 11 || l.isLeap) {
      solsticeOff++
      if (offenders.length < 5) offenders.push(`${y}:${l?.monthName ?? 'null'}`)
    }
  }
  check(`1900–2098 冬至都落在十一月（例外 ${offenders.join(',')}）`, solsticeOff, 0)
}

console.log('\n--- 节气（算出来的，不是查表）---')
{
  check('24 个节气', SOLAR_TERMS.length, 24)
  check('第一个是小寒，最后一个是冬至', `${SOLAR_TERMS[0]}/${SOLAR_TERMS[23]}`, '小寒/冬至')

  // 冬至的日期对着天文时刻核过（2027 年冬至是北京时间 12 月 22 日 10:42）
  const solstices: Array<[number, string]> = [
    [2024, '2024-12-21'],
    [2025, '2025-12-21'],
    [2026, '2026-12-22'],
    [2027, '2027-12-22'],
    [2028, '2028-12-21']
  ]
  for (const [year, expected] of solstices) {
    check(`${year} 年冬至 ${expected}`, winterSolstice(year).key, expected)
  }
  check('2027 年春分 03-21（三月分点 20:25 UTC + 8 小时）', solarTermsOf(2027)[5]!.key, '2027-03-21')

  // 一年 24 个节气必须都落在本年、且严格递增 —— 迭代没收敛就会撞在这里
  let orderBad = 0
  let rangeBad = 0
  for (let y = 1950; y <= 2080; y++) {
    const terms = solarTermsOf(y)
    for (let i = 0; i < terms.length; i++) {
      if (!terms[i]!.key.startsWith(`${y}-`)) rangeBad++
      if (i > 0 && terms[i - 1]!.key >= terms[i]!.key) orderBad++
    }
  }
  check('1950–2080 的节气都在本年', rangeBad, 0)
  check('1950–2080 的节气严格递增', orderBad, 0)

  // 节气的落点窗口（这几条是历书上最稳的规律）
  let qingmingBad = 0
  for (let y = 1990; y <= 2080; y++) {
    const d = Number(solarTermsOf(y)[6]!.key.slice(8))
    if (d < 4 || d > 6) qingmingBad++
  }
  check('清明永远落在 4 月 4–6 日', qingmingBad, 0)

  check('termOnDay 认出冬至那天', termOnDay(at(2027, 12, 22))?.name, '冬至')
  check('termOnDay 对普通日子给 null', termOnDay(at(2027, 12, 25)), null)
  check('冬至那天的时刻是 4 位数钟点', /^\d{2}:\d{2}$/.test(winterSolstice(2027).clock), true)
}

console.log('\n--- 节假日与调休（数据抄自国务院办公厅的通知）---')
{
  // 2026 年（国办发明电〔2025〕7 号）
  check('2026-01-01 是元旦假期', dayMarkOf(at(2026, 1, 1)).name, '元旦')
  check('2026-01-04 调休上班', dayMarkOf(at(2026, 1, 4)).kind, 'adjusted-work')
  check('2026-01-04 为元旦上班', makeupFor(at(2026, 1, 4)), '元旦')
  check('2026 春节 9 天（2/15–2/23）', holidayPositionOf(at(2026, 2, 23))?.span, 9)
  check('春节第一天是 2/15', holidayPositionOf(at(2026, 2, 15))?.index, 1)
  check('2/14 调休上班（为春节）', makeupFor(at(2026, 2, 14)), '春节')
  check('2/28 调休上班（为春节）', dayMarkOf(at(2026, 2, 28)).kind, 'adjusted-work')
  check('清明 3 天', holidayPositionOf(at(2026, 4, 5))?.span, 3)
  check('劳动节 5 天', holidayPositionOf(at(2026, 5, 2))?.span, 5)
  check('5/9 调休上班', makeupFor(at(2026, 5, 9)), '劳动节')
  check('中秋 3 天', holidayPositionOf(at(2026, 9, 25))?.span, 3)
  check('国庆 7 天', holidayPositionOf(at(2026, 10, 4))?.span, 7)
  check('10/8 已经不是假期（上班）', dayMarkOf(at(2026, 10, 8)).kind, 'workday')
  check('10/10 调休上班（周六）', makeupFor(at(2026, 10, 10)), '国庆节')
  check('9/20 调休上班（周日）', dayMarkOf(at(2026, 9, 20)).kind, 'adjusted-work')
  // 假期里的周末算假期，不算周末 —— 决定「能不能安排出行」的是前者
  check('10/3（周六）算假期不算周末', dayMarkOf(at(2026, 10, 3)).kind, 'holiday')

  // 2025：中秋与国庆连休，段名两个都要写上
  check('2025 国庆中秋连休 8 天', holidayPositionOf(at(2025, 10, 6))?.span, 8)
  check('段名带上中秋', holidayPositionOf(at(2025, 10, 6))?.run.name, '国庆节·中秋节')
  check('2025 元旦只放 1 天不调休', holidayPositionOf(at(2025, 1, 1))?.span, 1)
  check('2025-01-26 调休上班', makeupFor(at(2025, 1, 26)), '春节')

  // 2024：元旦在通知里是「1 月 1 日放假」，抄成一天
  check('2024 元旦 1 天', holidayPositionOf(at(2024, 1, 1))?.span, 1)
  check('2024-09-29 调休上班', makeupFor(at(2024, 9, 29)), '国庆节')

  // 没有数据的年份：退回周末判定，且**不猜**
  check('2027-02-06（周六）算周末', dayMarkOf(at(2027, 2, 6)).kind, 'weekend')
  check('2027-02-08（周一）算工作日', dayMarkOf(at(2027, 2, 8)).kind, 'workday')
  check('2027 年没有数据', holidayYearKnown(2027), false)
  check('2026 年有数据', holidayYearKnown(2026), true)
  check('未公布年份说清楚了', (holidayCoverageNote(2027) ?? '').includes('还没公布'), true)
  check('表之前的年份说实话（不是「未公布」）',
    (holidayCoverageNote(2023) ?? '').includes('没有收录'), true)
  check('有数据的年份不出声', holidayCoverageNote(2026), null)
  check('已公布到 2026 年', LATEST_KNOWN_YEAR, 2026)
  check('收录的年份', KNOWN_YEARS.join(','), '2024,2025,2026')

  check('isRestDay：假期算休', isRestDay(at(2026, 10, 1)), true)
  check('isRestDay：调休上班不算休', isRestDay(at(2026, 10, 10)), false)
  check('isRestDay：普通周中不算休', isRestDay(at(2026, 9, 29)), false)

  // 倒计时取数：今天是 2026-09-29（周二），下一个假期是国庆
  const now = at(2026, 9, 29, 10, 0)
  const next = nextHoliday(now)!
  check('下一个假期是国庆节', next.name, '国庆节')
  check('还有 2 天（9/29 → 10/1）', next.daysUntil, 2)
  check('还没开始所以不是假期里的第几天', next.indexInRun, null)
  check('国庆放 7 天', next.span, 7)

  const during = nextHoliday(at(2026, 10, 3, 9, 0))!
  check('正在放假时它还在最前面', during.name, '国庆节')
  check('正在进行的天数', during.indexInRun, 3)
  check('进行中的 daysUntil 归零', during.daysUntil, 0)

  const rest = upcomingHolidays(now, 8)
  check('从今天起还有 1 个假期（2027 未公布）', rest.length, 1)
  check('假期跨年时也不会算错：10/8 查下一个',
    nextHoliday(at(2026, 10, 8, 9, 0)), null)
}

console.log('\n--- 纪念日 ---')
{
  const now = at(2026, 9, 29, 10, 0)

  // 公历每年重复：今年的 5/20 已过 → 翻到明年
  const yearly = anniversaryOccurrence(anniversary(), now)!
  check('公历生日翻到明年', yearly.at, '2027-05-20')
  check('第 12 周年', yearly.years, 12)
  check('从锚点起已过 4150 天', yearly.sinceDays, 4150)
  check('还有的天数与两个日期之差一致', yearly.daysLeft, daysBetween(now, at(2027, 5, 20)))
  check('公历没有农历说明', yearly.lunarLabel, null)

  // 今天当天
  const today = anniversaryOccurrence(anniversary({ date: '2015-09-29' }), now)!
  check('今天就是那天', today.daysLeft, 0)
  check('今天的文案', daysLeftLabel(today.daysLeft), '就是今天')

  // 2/29 的锚点在平年落到 2/28 —— 比落到 3/1 符合直觉
  const feb29 = anniversary({ date: '2000-02-29' })
  check('2027 不是闰年，落到 2/28', anniversaryOccurrence(feb29, now)!.at, '2027-02-28')
  check('2028 是闰年，回到 2/29',
    anniversaryOccurrence(feb29, at(2027, 12, 31))!.at, '2028-02-29')
  check('2/29 的周年数照常', anniversaryOccurrence(feb29, now)!.years, 27)

  // 农历纪年：锚点是 2026 年中秋（八月十五），下一次应当落在 2027 年中秋
  const lunarAnnual = anniversary({ date: '2026-09-25', lunar: true })
  const lunarNext = anniversaryOccurrence(lunarAnnual, now)!
  check('农历纪念日翻到 2027 年中秋', lunarNext.at, '2027-09-15')
  check('农历说明', lunarNext.lunarLabel, '农历八月十五')
  check('第 1 周年', lunarNext.years, 1)

  // 闰月里的锚点：2025 闰六月十五。2026 没有闰六月 → 按六月十五过
  const inLeap = anniversary({
    date: dayKey(solarFromLunar(2025, 6, 15, true)!),
    lunar: true
  })
  check('锚点确实落在闰月里', anniversaryInLeapMonth(inLeap), true)
  const afterLeap = anniversaryOccurrence(inLeap, at(2025, 8, 8))!
  check('平年按同月同日过（不是闰月）', afterLeap.at, dayKey(solarFromLunar(2026, 6, 15)!))
  check('平年那次不是闰月', lunarOf(tsFromDayKey(afterLeap.at)!)!.isLeap, false)
  check('公历纪念日不算闰月', anniversaryInLeapMonth(anniversary()), false)

  // 一次性：过完就不再倒数，但那条记录还在，界面会说「已过 N 天」
  const once = anniversary({ date: '2026-12-25', yearly: false })
  check('一次性纪念日就是那天', anniversaryOccurrence(once, now)!.at, '2026-12-25')
  check('还有 87 天', anniversaryOccurrence(once, now)!.daysLeft, 87)
  check('一次性没有周年数', anniversaryOccurrence(once, now)!.years, null)
  const past = anniversary({ date: '2025-01-01', yearly: false })
  const pastOcc = anniversaryOccurrence(past, now)!
  check('过掉的一次性是负数（已过）', pastOcc.daysLeft < 0, true)
  check('已过的文案', daysLeftLabel(pastOcc.daysLeft).startsWith('已过'), true)
  check('一次性不吃农历开关',
    anniversaryOccurrence(anniversary({ date: '2026-12-25', yearly: false, lunar: true }), now)!.lunarLabel,
    '农历冬月十七')

  check('周年文案：今年', yearsLabel(0), '今年')
  check('周年文案：第 12 周年', yearsLabel(12), '第 12 周年')
  check('周年文案：没有就不说', yearsLabel(null), null)
  check('远近文案：还有 1 天', daysLeftLabel(1), '还有 1 天')

  // 排序按「离得多近」，过掉的与将到的都排在中间附近
  const sorted = sortAnniversaries(
    [
      anniversary({ id: 'far', date: '2027-08-01' }),
      anniversary({ id: 'near', date: '2026-10-01' }),
      anniversary({ id: 'today', date: '2015-09-29' })
    ],
    now
  )
  check('最近的排最前', sorted.map((a) => a.id).join(','), 'today,near,far')
}

console.log('\n--- 纪念日的提醒（按天论，不按刻论）---')
{
  const now = at(2026, 9, 29, 10, 0)
  const today = startOfDay(now)

  // 没勾「到那天提醒我」→ 根本没有提醒点。这是默认状态
  check('没勾提醒 → 没有提醒点', anniversaryRemindAt(anniversary(), S, now), null)

  // 勾了，但那天还没到 → 提醒点在将来，此刻不弹
  check(
    '勾了但日子没到 → 此刻不弹',
    dueAnniversaries([anniversary({ date: '2026-12-25', yearly: false, notify: true })], S, now).length,
    0
  )

  // 就是今天。createdAt 往前挪到 9 月 1 日 —— 当天新建的会被
  // 「提醒点必须晚于创建时间」那条挡掉，那一条下面单独测
  const todayAnn = anniversary({
    date: '2015-09-29', notify: true, createdAt: at(2026, 9, 1, 8, 0)
  })
  const hit = dueAnniversaries([todayAnn], S, now)
  check('就是今天 → 该弹', hit.length, 1)
  check('提醒点是当天 09:00（与全天型待办共用一个时刻）', hit[0]?.at, at(2026, 9, 29, 9, 0))
  check('幂等键是那一天，不是那一刻', hit[0]?.day, today)
  check('通知文案直接用那一份备好的发生情况', hit[0]?.occurrence.daysLeft, 0)

  // 幂等按天：09:00 弹过之后，同一天把提醒时刻改到 11:00 也不该再弹一遍。
  // 这正是 firedFor 存「天」而不是存「刻」的理由
  const fired = anniversary({
    date: '2015-09-29', notify: true, firedFor: today, createdAt: at(2026, 9, 1, 8, 0)
  })
  check('那天弹过 → 同日不再弹', dueAnniversaries([fired], S, at(2026, 9, 29, 23, 59)).length, 0)
  check(
    '同日改了提醒时刻也不再弹（按天论）',
    dueAnniversaries([fired], { ...S, allDayRemindTime: '11:00' }, at(2026, 9, 29, 23, 59)).length,
    0
  )

  // 「当天一整天都算数」：早上九点没开机、下午三点才开，仍然该弹
  check('下午才开机也照样弹', dueAnniversaries([todayAnn], S, at(2026, 9, 29, 15, 0)).length, 1)

  // 但当天新建的不能弹 —— 与任务那条「提醒点必须晚于创建时间」同源
  check(
    '当天下午才记的，不该被自己早上那个提醒点打脸',
    dueAnniversaries(
      [anniversary({ date: '2015-09-29', notify: true, createdAt: at(2026, 9, 29, 15, 0) })],
      S,
      at(2026, 9, 29, 16, 0)
    ).length,
    0
  )

  // 一次性纪念日过完就完了，明年不会再冒出来
  check(
    '一次性纪念日过完不再提醒',
    anniversaryRemindAt(anniversary({ date: '2025-01-01', yearly: false, notify: true }), S, now),
    null
  )

  // 农历纪念日：提醒点落在当年那个农历日子上，不是锚点那串公历数字
  const lunarAnn = anniversary({ date: '1990-09-24', lunar: true, notify: true })
  const lunarHit = anniversaryRemindAt(lunarAnn, S, now)
  check(
    '农历纪念日的提醒点落在农历那一天的零点上',
    lunarHit === null ? null : dayKey(lunarHit.day),
    anniversaryOccurrence(lunarAnn, now)!.at
  )
}

console.log('\n--- 纪念日的提醒：穿过调度器那一趟 ---')
{
  // 上面几条测的是 `dueAnniversaries` 这个纯函数，这一条测的是**接线**：
  // `tick` 有没有把它取上、`markAnniversaryFired` 标的是「天」还是「刻」。
  // 后者是这套东西里最容易悄悄错的一处 —— 标成刻的话，「弹过之后同一天改一下
  // 提醒时刻」就会重弹一遍，而单测 `dueAnniversaries` 永远看不见它。
  const dir = mkdtempSync(join(tmpdir(), 'todo-ann-sched-'))
  const store = new Store(join(dir, 'a.json'))
  const now = at(2026, 9, 29, 10, 0)
  store.addAnniversary(
    anniversary({
      id: 'ann1',
      date: '2026-09-29',
      yearly: false,
      notify: true,
      createdAt: at(2026, 9, 1, 8, 0)
    })
  )

  let clock = now
  const batches: AnniversaryEntry[][] = []
  const sched = new Scheduler({
    store,
    isIdle: () => false,
    now: () => clock,
    notify: (batch) => batches.push(batch.anniversaries)
  })

  sched.tick()
  check('纪念日走的是同一个 tick', batches.length, 1)
  check('它落在自己那一格，不挤进任务的 fresh', batches[0].map((e) => e.anniversary.id).join(','), 'ann1')
  check('晚一小时开机照样弹（它不是「错过」）', batches[0][0]?.at, at(2026, 9, 29, 9, 0))

  sched.markAnniversaryFired(batches[0])
  check('回填的是「那一天」，不是「那一刻」', store.anniversaries[0]!.firedFor, at(2026, 9, 29, 0, 0))

  clock = at(2026, 9, 29, 20, 0)
  store.patchSettings({ allDayRemindTime: '19:00' })
  sched.tick()
  check('同一天改了提醒时刻也不重弹（按天论）', batches.length, 1)

  clock = at(2026, 9, 30, 10, 0)
  sched.tick()
  check('一次性纪念日第二天不再响', batches.length, 1)

  rmSync(dir, { recursive: true, force: true })
}

console.log('\n--- 纪念日的通知文案 ---')
{
  const now = at(2026, 9, 29, 10, 0)
  const annBody = (a: Anniversary): string => describeAnniversary(a, anniversaryOccurrence(a, now)!).body

  check(
    '标题就是那条纪念日的名字',
    describeAnniversary(anniversary(), anniversaryOccurrence(anniversary(), now)!).title,
    '结婚纪念日'
  )
  check('「就是今天」+ 第几周年', annBody(anniversary({ date: '2015-09-29' })), '就是今天 · 第 11 周年')
  // 一次性既没有周年数也没有农历标注，只说「就是今天」
  check('一次性只说「就是今天」', annBody(anniversary({ date: '2026-09-29', yearly: false })), '就是今天')
  check('农历纪念日把农历一并写出来', annBody(anniversary({ date: '2026-09-29', lunar: true })), '就是今天 · 今年 · 农历八月十九')
}

console.log('\n--- 倒计时取数 ---')
{
  const now = at(2026, 9, 29, 10, 0)
  const list = [
    anniversary({ id: 'near', date: '2026-10-20' }),
    anniversary({ id: 'far', date: '2027-09-01' }),
    anniversary({ id: 'once-past', date: '2026-01-01', yearly: false })
  ]
  const base = { countdownHolidays: true, countdownHorizonDays: 365 }

  const all = collectCountdowns(now, list, base)
  check('节假日也在里面', all.holidays[0]!.name, '国庆节')
  check('纪念日三条都在', all.anniversaries.length, 3)
  check('一条都没被藏', all.hiddenAnniversaries, 0)

  const near = collectCountdowns(now, list, { ...base, countdownHorizonDays: 30 })
  check('只看 30 天：远的藏起来', near.anniversaries.map((x) => x.item.id).join(','), 'near,once-past')
  check('被藏了几条', near.hiddenAnniversaries, 1)

  const noHoliday = collectCountdowns(now, list, { ...base, countdownHolidays: false })
  check('关掉节假日就真的一条都不给', noHoliday.holidays.length, 0)

  const unlimited = collectCountdowns(now, list, { ...base, countdownHorizonDays: 0 })
  check('不限天数时全都在', unlimited.anniversaries.length, 3)

  // 已经过掉的一次性纪念日**永远**显示 —— 藏起来等于把用户记下的那天抹掉
  const tiny = collectCountdowns(now, list, { ...base, countdownHorizonDays: 1 })
  check('过掉的一次性不会被天数挡住',
    tiny.anniversaries.some((x) => x.item.id === 'once-past'), true)

  check('日期范围文案', holidaySpanLabel({ from: '2026-10-01', to: '2026-10-07' }), '10月1日—10月7日')
  check('单日假期只写一天', holidaySpanLabel({ from: '2025-01-01', to: '2025-01-01' }), '1月1日')
  check('短日期', shortDate('2026-09-05'), '9月5日')
  check('长日期带年份', fullDate('2027-01-01'), '2027年1月1日')
}

console.log('\n--- 日历的按天聚合 ---')
{
  const day = at(2026, 9, 29) // 周二
  const tasks: Task[] = [
    {
      kind: 'deadline', id: 'dl-evening', title: '提交材料', important: false,
      createdAt: at(2026, 9, 20), updatedAt: at(2026, 9, 20), deletedAt: null, firedFor: null,
      dueAt: at(2026, 9, 29, 17, 0), allDay: false, leadMin: 15, snoozeUntil: null, completedAt: null
    },
    {
      kind: 'deadline', id: 'dl-allday', title: '填个表', important: false,
      createdAt: at(2026, 9, 20), updatedAt: at(2026, 9, 20), deletedAt: null, firedFor: null,
      dueAt: day, allDay: true, leadMin: 0, snoozeUntil: null, completedAt: null
    },
    {
      kind: 'deadline', id: 'dl-other', title: '明天的事', important: false,
      createdAt: at(2026, 9, 20), updatedAt: at(2026, 9, 20), deletedAt: null, firedFor: null,
      dueAt: at(2026, 9, 30, 9, 0), allDay: false, leadMin: 15, snoozeUntil: null, completedAt: null
    },
    {
      kind: 'deadline', id: 'dl-late', title: '上周欠的', important: false,
      createdAt: at(2026, 9, 20), updatedAt: at(2026, 9, 20), deletedAt: null, firedFor: null,
      dueAt: at(2026, 9, 28, 17, 0), allDay: false, leadMin: 15, snoozeUntil: null, completedAt: null
    },
    {
      kind: 'deadline', id: 'dl-done', title: '已经做完的', important: false,
      createdAt: at(2026, 9, 20), updatedAt: at(2026, 9, 20), deletedAt: null, firedFor: null,
      dueAt: at(2026, 9, 28, 10, 0), allDay: false, leadMin: 15, snoozeUntil: null,
      completedAt: at(2026, 9, 28, 11, 0)
    },
    {
      kind: 'deadline', id: 'dl-deleted', title: '删掉的', important: false,
      createdAt: at(2026, 9, 20), updatedAt: at(2026, 9, 20), deletedAt: at(2026, 9, 21),
      firedFor: null, dueAt: day, allDay: true, leadMin: 0, snoozeUntil: null, completedAt: null
    },
    {
      kind: 'recurring', id: 'rec-morning', title: '早上看简历', important: false,
      createdAt: at(2026, 9, 1), updatedAt: at(2026, 9, 1), deletedAt: null, firedFor: null,
      rule: { freq: 'weekly', every: 1, days: [2], skipWeekend: false },
      remindTime: '08:00', lastDoneDay: null, streak: 0, snoozeUntil: null
    },
    {
      kind: 'recurring', id: 'rec-night', title: '记一笔', important: false,
      createdAt: at(2026, 9, 1), updatedAt: at(2026, 9, 1), deletedAt: null, firedFor: null,
      rule: { freq: 'daily', every: 1, skipWeekend: false },
      remindTime: '21:30', lastDoneDay: null, streak: 0, snoozeUntil: null
    },
    {
      kind: 'someday', id: 'pool', title: '学 Rust', important: false,
      createdAt: at(2026, 9, 1), updatedAt: at(2026, 9, 1), deletedAt: null, firedFor: null
    }
  ]

  const onDay = tasksOnDay(tasks, day)
  check(
    '那天的事按钟点排，全天型垫最后',
    onDay.map((t) => t.id).join(','),
    'rec-morning,dl-evening,rec-night,dl-allday'
  )
  check('别天的事不掺进来', onDay.some((t) => t.id === 'dl-other'), false)
  check('删掉的不算', onDay.some((t) => t.id === 'dl-deleted'), false)
  check('清单池不进日历', onDay.some((t) => t.id === 'pool'), false)

  const today = agendaOfDay(tasks, day, at(2026, 9, 29, 12, 0))
  check('那天的未完成条数（今天例外，两条习惯也数进去）', today.pending, 4)
  check('那天没有逾期（逾期的是前一天）', today.overdue, 0)

  const yesterday = agendaOfDay(tasks, at(2026, 9, 28), at(2026, 9, 29, 12, 0))
  check('前一天两条都在（含已完成的）', yesterday.tasks.length, 2)
  check('已完成的只算展示、不算未完成', yesterday.pending, 1)
  check('未完成的那条算逾期', yesterday.overdue, 1)
  // 周期任务没有历史：铺到过去就是替用户编一份「那天你没做」的流水
  check('过去的日子不带周期任务', yesterday.tasks.some((t) => t.kind === 'recurring'), false)

  // 未来那天的习惯进明细（「那天有这个习惯」），但**不进圆点** ——
  // 一条「每天」的习惯否则会把整月每一格都点上
  const futureDay = agendaOfDay(tasks, at(2026, 10, 6), at(2026, 9, 29, 12, 0))
  check('未来的日子带周期任务（进明细）', futureDay.tasks.some((t) => t.id === 'rec-morning'), true)
  check('但习惯不进圆点', futureDay.pending, 0)

  // 周期任务当天打过卡：仍在明细里（带静态墨线），但不计未完成
  const checked = tasks.map((t) =>
    t.id === 'rec-night' ? { ...t, lastDoneDay: '2026-09-29' } : t
  ) as Task[]
  const afterCheck = agendaOfDay(checked, day, at(2026, 9, 29, 22, 0))
  check('打过卡的周期任务还在那天', afterCheck.tasks.some((t) => t.id === 'rec-night'), true)
  check('但它不再算未完成', afterCheck.pending, 3)

  // 整月：一次算完，含上下补齐的邻月日子
  const month = monthAgenda(tasks, 2026, 10, at(2026, 10, 5, 12, 0))
  check('10 月网格补进来的 9/28 也在表里', month.has('2026-09-28'), true)
  check('补进来那天的逾期算得对', month.get('2026-09-28')!.overdue, 1)
  check('网格首尾之外的邻月日子不进表', month.has('2026-09-27'), false)
  check('网格首尾之外的邻月日子不进表（后缘）', month.has('2026-11-02'), false)
  check('10 月的周期任务按星期展开', month.get('2026-10-06')!.tasks.some((t) => t.id === 'rec-morning'), true)
  check('下一个周二才算下一次', month.get('2026-10-13')!.tasks.some((t) => t.id === 'rec-morning'), true)

  // 一整天都没事就别占一格（拿掉那条「每天」的习惯才看得出差别）
  const sparse = monthAgenda(
    tasks.filter((t) => t.id !== 'rec-night'),
    2026,
    10,
    at(2026, 10, 5, 12, 0)
  )
  check('没事的那天不进表', sparse.has('2026-10-07'), false)
  check('有事的那天还在表里', sparse.has('2026-10-06'), true)
}

console.log('\n--- store：纪念日的校验与读写 ---')
{
  const dir = mkdtempSync(join(tmpdir(), 'todo-ann-'))
  const file = join(dir, 'todo-reminder.json')
  const raw = { id: 'x', title: '生日', date: '2026-03-01', yearly: true, lunar: false, createdAt: 1, updatedAt: 1 }

  check('合法记录通过', normalizeAnniversary(raw) !== null, true)
  check('2 月 31 日不是真日期，拦下', normalizeAnniversary({ ...raw, date: '2026-02-31' }), null)
  check('日期格式不对，拦下', normalizeAnniversary({ ...raw, date: '2026/03/01' }), null)
  check('缺 yearly，拦下', normalizeAnniversary({ ...raw, yearly: undefined }), null)
  check('缺 lunar，拦下', normalizeAnniversary({ ...raw, lunar: undefined }), null)
  // 与 normalizeTask 同一条分工：存储只管形状（类型/存在性），
  // 「名字不能是空的」是业务规则，在命令层拒（见 buildAnniversary）
  check('空标题能过存储校验', normalizeAnniversary({ ...raw, title: '' }) !== null, true)
  check('不是对象，拦下', normalizeAnniversary('nope'), null)

  // notify / firedFor 是 v4 才有的字段，老文件里根本没有 —— 缺了**补默认值**
  // 而不是拦下：升级一次就让攒了几年的纪念日全部消失，是这里最贵的一种错误。
  // notify 补的是 false：补 true 的话，所有老纪念日会在升级后的第一个早上集体开炮
  check('缺 notify → 补 false', normalizeAnniversary({ ...raw, notify: undefined })?.notify, false)
  check('notify 给了个大白话 → 按 false 算', normalizeAnniversary({ ...raw, notify: 'yes' })?.notify, false)
  check('notify 是 true → 原样留下', normalizeAnniversary({ ...raw, notify: true })?.notify, true)
  check('缺 firedFor → 补 null', normalizeAnniversary({ ...raw, firedFor: undefined })?.firedFor, null)
  check('firedFor 是垃圾值 → 按没弹过算', normalizeAnniversary({ ...raw, firedFor: 'x' })?.firedFor, null)
  check('firedFor 是数字 → 原样留下', normalizeAnniversary({ ...raw, firedFor: 123 })?.firedFor, 123)

  const s = new Store(file)
  s.addAnniversary(anniversary({ id: 'a1' }))
  const s2 = new Store(file)
  check('落盘读回', s2.anniversaries.length, 1)
  check('标题读回', s2.anniversaries[0]!.title, '结婚纪念日')
  check('农历开关读回', s2.anniversaries[0]!.lunar, false)
  check('提醒开关读回（默认 false）', s2.anniversaries[0]!.notify, false)
  check('firedFor 读回（默认 null）', s2.anniversaries[0]!.firedFor, null)

  // 一批回填只写一次盘 —— `Scheduler.markAnniversaryFired` 就是这个形状
  const firedDay = at(2026, 9, 29, 0, 0)
  s2.updateAnniversaries([{ id: 'a1', patch: { firedFor: firedDay } }])
  check('批量回填 firedFor', new Store(file).anniversaries[0]!.firedFor, firedDay)
  check(
    '批量里找不到的 id 静默跳过',
    s2.updateAnniversaries([{ id: 'nope', patch: { notify: true } }]).length,
    0
  )

  s2.updateAnniversary('a1', { title: '改成生日', lunar: true, notify: true })
  check('编辑写回', new Store(file).anniversaries[0]!.title, '改成生日')
  check('编辑不动的字段保留', new Store(file).anniversaries[0]!.date, '2015-05-20')
  check('提醒开关改得动', new Store(file).anniversaries[0]!.notify, true)
  check('编辑不存在的返回 null', s2.updateAnniversary('nope', { title: 'x' }), null)
  check('删除成功', s2.removeAnniversary('a1'), true)
  check('删完就没了', new Store(file).anniversaries.length, 0)
  check('删不存在的不报错但返回 false', s2.removeAnniversary('nope'), false)

  // 旧文件（v1，没有 anniversaries 这个键）照常读，且不触发「版本更新」备份
  const oldFile = join(dir, 'old.json')
  writeFileSync(
    oldFile,
    JSON.stringify({ version: 1, tasks: [deadline({ id: 't1' })], settings: { theme: 'dark' } }),
    'utf-8'
  )
  const old = new Store(oldFile)
  check('没有 anniversaries 键的旧文件读成空表', old.anniversaries.length, 0)
  check('旧文件不算「更新版本」', old.newerFileVersion, null)
  check('旧文件的设置照常合并', old.settings.theme, 'dark')
  check('旧文件缺的键取默认值', old.settings.countdownHorizonDays, DEFAULT_SETTINGS.countdownHorizonDays)

  // 坏记录：跳过、留原文、计数
  const badFile = join(dir, 'bad.json')
  writeFileSync(
    badFile,
    JSON.stringify({
      version: 2,
      tasks: [],
      anniversaries: [{ ...raw, id: 'bad', date: '2026-13-45' }],
      settings: {}
    }),
    'utf-8'
  )
  const bad = new Store(badFile)
  check('坏纪念日被跳过', bad.anniversaries.length, 0)
  check('跳过计数记上', bad.droppedTaskCount, 1)
  check('原文备份留下来了', typeof bad.corruptBackupPath, 'string')
  check('备份里含那条坏记录', readFileSync(bad.corruptBackupPath as string, 'utf-8').includes('2026-13-45'), true)

  rmSync(dir, { recursive: true, force: true })
}

console.log('\n--- commands.ts：纪念日的增删改 ---')
{
  const dir = mkdtempSync(join(tmpdir(), 'todo-ann-cmd-'))
  const store = new Store(join(dir, 'a.json'))
  const now = at(2026, 9, 29, 10, 0)
  const run = (cmd: Command) => applyCommand(store, cmd, now)
  const draft = {
    title: '  结婚纪念日 ', date: '2015-05-20', yearly: true, lunar: false, notify: false
  }

  const added = run({ type: 'anniversary:add', draft })
  check('add 成功', added.ok, true)
  check('标题去掉首尾空格', store.anniversaries[0]!.title, '结婚纪念日')
  const id = store.anniversaries[0]!.id
  check('id 是新生成的', typeof id === 'string' && id.length > 0, true)
  check('新记的一条没弹过', store.anniversaries[0]!.firedFor, null)

  check('edit 成功', run({ type: 'anniversary:edit', id, draft: { ...draft, date: '2016-06-01' } }).ok, true)
  check('日期改掉了', store.anniversaries[0]!.date, '2016-06-01')
  check('createdAt 不被编辑改掉', store.anniversaries[0]!.createdAt, now)

  // 「到那天提醒我」改得动
  run({ type: 'anniversary:edit', id, draft: { ...draft, notify: true } })
  check('edit 把 notify 写进去', store.anniversaries[0]!.notify, true)

  // 但编辑**不该**动提醒账：改个名字就让今天已经弹过的那条重弹，
  // 是最容易被当成「应用有 bug」的那种行为
  const firedDay = at(2026, 9, 29, 0, 0)
  store.updateAnniversary(id, { firedFor: firedDay })
  run({ type: 'anniversary:edit', id, draft: { ...draft, title: '改个名字' } })
  check('编辑改名字不动 firedFor', store.anniversaries[0]!.firedFor, firedDay)
  check('名字确实改了', store.anniversaries[0]!.title, '改个名字')

  check('坏日期被拒', run({ type: 'anniversary:add', draft: { ...draft, date: '2026-02-31' } }).ok, false)
  check('空名字被拒', run({ type: 'anniversary:add', draft: { ...draft, title: '   ' } }).ok, false)
  const rejected = run({ type: 'anniversary:add', draft: { ...draft, date: '2026-02-31' } })
  check('被拒的是业务性失败，不是写盘失败', rejected.writeError === undefined, true)
  check('被拒不写进 store', store.anniversaries.length, 1)

  // 一次性纪念日不带农历开关（buildAnniversary 里归一）
  run({ type: 'anniversary:add', draft: { title: '高考', date: '2027-06-07', yearly: false, lunar: true, notify: false } })
  check('只数一次的日子不吃农历开关', store.anniversaries[1]!.lunar, false)

  check('编辑不存在的给业务性失败', run({ type: 'anniversary:edit', id: 'nope', draft }).ok, false)
  check('删除成功', run({ type: 'anniversary:remove', id }).ok, true)
  check('删完只剩一条', store.anniversaries.length, 1)
  check('删不存在的给业务性失败', run({ type: 'anniversary:remove', id: 'nope' }).ok, false)

  rmSync(dir, { recursive: true, force: true })
}

/**
 * 视觉规矩的可执行版本。
 *
 * `AGENTS.md` 第 3 条写着「文字只用两级灰，两级都要满足 AA（≥4.5:1）；
 * `--ink-faint` 只准给图标字形用」。但这条规矩在 2026-09-22 之前**没有任何东西守着**：
 * 实测当时 `--ink-muted` 在 `--paper` 上只有 4.61:1（余量 0.11），
 * 而 `--ink-faint` 被拿去给日历的周末表头和邻月日子当了文案色，只有 2.45–4.12:1。
 * 所以这里把两条都钉成断言 —— 调色时越线会当场失败，而不是等谁肉眼发现。
 *
 * 路径按 `__dirname` 推（`.tmp-test/scripts` → 仓库根），不依赖 cwd。
 */
/**
 * 自动更新的状态机。
 *
 * 这一堆是「把纯函数拆出来」换来的回报：`main/updater.ts` 那层只剩事件名
 * 翻译，真正的链路（检查中 → 有新版 → 下载 42% → 可以重启了）在这里逐跳验，
 * 不需要真发一个版本、不需要网络、不需要等 GitHub。
 */
console.log('\n--- 自动更新的状态机 ---')
{
  const begin = initialUpdateState()
  check('初始是 idle', begin.status, 'idle')
  check('初始没有版本号', begin.version, null)
  check('初始没查完过（checkedAt 为 null）', begin.checkedAt, null)
  check('初始没有「用不了自动更新」的理由', begin.unsupported, null)

  // 完整链路走一遍
  const t0 = at(2026, 9, 29, 10, 0)
  let s = updateReducer(begin, { type: 'check-started' }, t0)
  check('开始检查 → checking', s.status, 'checking')
  check('检查中**不**记 checkedAt（那是「查完了」的意思）', s.checkedAt, null)

  s = updateReducer(s, { type: 'available', version: '0.1.5' }, t0 + 1200)
  check('查到新版 → available', s.status, 'available')
  check('版本号记下来了', s.version, '0.1.5')
  check('查完了才记时间', s.checkedAt, t0 + 1200)

  s = updateReducer(s, { type: 'progress', percent: 42.6 }, t0 + 3000)
  check('下载进度 → downloading', s.status, 'downloading')
  check('进度四舍五入', s.percent, 43)

  s = updateReducer(s, { type: 'downloaded', version: '0.1.5' }, t0 + 9000)
  check('下好了 → ready', s.status, 'ready')
  check('下好直接记 100（最后一跳常停在 99.x）', s.percent, 100)

  // 没有新版那条路
  const nope = updateReducer(
    updateReducer(begin, { type: 'check-started' }, t0),
    { type: 'not-available' },
    t0 + 800
  )
  check('没有新版 → up-to-date', nope.status, 'up-to-date')
  check('没有新版要清掉版本号', nope.version, null)
  check('没有新版也算查完了', nope.checkedAt, t0 + 800)

  // 失败
  const bad = updateReducer(begin, { type: 'failed', message: '连不上更新服务器' }, t0)
  check('失败 → error', bad.status, 'error')
  check('失败要把原因带上', bad.error, '连不上更新服务器')

  // 开新一轮：进度作废，但版本号留住
  const again = updateReducer(s, { type: 'check-started' }, t0 + 10_000)
  check('重新检查时进度清空', again.percent, null)
  check('重新检查时上一轮的错清空', again.error, null)
  check('重新检查时版本号留住（否则文案会闪一下）', again.version, '0.1.5')

  // 进度夹取：刚接到响应头时 electron-updater 会给 -1
  check('进度 -1 夹到 0', clampPercent(-1), 0)
  check('进度 120 夹到 100', clampPercent(120), 100)
  check('进度 NaN 当 0', clampPercent(Number.NaN), 0)
  check('进度小数取整', clampPercent(7.5), 8)

  // 便携版识别
  check('有 PORTABLE_EXECUTABLE_DIR 就是便携版', isPortable({ PORTABLE_EXECUTABLE_DIR: 'C:\\Temp' }), true)
  check('空字符串不算', isPortable({ PORTABLE_EXECUTABLE_DIR: '' }), false)
  check('没有这个变量就不是', isPortable({}), false)
  check('安装版的 env 里没有它', isPortable({ APPDATA: 'C:\\Users\\x\\AppData' }), false)

  // 用不上的矩阵：平台 × 打包方式。mac 那条是给 CI 的 mac 包看的 ——
  // 没 Developer ID 签名的包，Squirrel.Mac 在替换 .app 那一步会拒掉，
  // 放着不管就是「查得到、下得动、装不上」的三段式失败
  check('未打包 = 开发态', updateUnsupportedReason('win32', false, {}), 'dev')
  check('mac 未打包也标开发态（判据是打包，不是平台）', updateUnsupportedReason('darwin', false, {}), 'dev')
  check('mac 打包版一律标不支持（无签名）', updateUnsupportedReason('darwin', true, {}), 'mac-unsigned')
  check('mac 便携判据不生效（env 里不会有那个变量）', updateUnsupportedReason('darwin', true, { PORTABLE_EXECUTABLE_DIR: '/tmp' }), 'mac-unsigned')
  check('win 安装版能用', updateUnsupportedReason('win32', true, {}), null)
  check('win 便携版不能用', updateUnsupportedReason('win32', true, { PORTABLE_EXECUTABLE_DIR: 'C:\\Temp' }), 'portable')
  check('linux 打包版不设防（当前没有 linux target，标可用无副作用）', updateUnsupportedReason('linux', true, {}), null)

  // 文案：unsupported 的每一档都要有一句人话，漏档的表现是界面空白
  check('mac 未签名的文案', updateSummary(initialUpdateState('mac-unsigned')), 'macOS 版未签名，自动更新用不了，请手动下载新版本')

  // 状态去重：同一次失败会从 reject 和 error 事件两条路进来，只能广播一次
  const f1 = updateReducer(begin, { type: 'failed', message: 'x' }, t0)
  const f2 = updateReducer(begin, { type: 'failed', message: 'x' }, t0)
  check('同一事件同一时刻 → 两个状态相同', sameUpdateState(f1, f2), true)
  check(
    '时间不同 → 视为不同',
    sameUpdateState(f1, updateReducer(begin, { type: 'failed', message: 'x' }, t0 + 1)),
    false
  )
  check(
    '文案不同 → 视为不同',
    sameUpdateState(f1, updateReducer(begin, { type: 'failed', message: 'y' }, t0)),
    false
  )

  // 错误翻译：要翻成「用户能据以行动」的一句话
  check(
    '404 说人话',
    friendlyError(new Error('HttpError: 404 Not Found')),
    '更新源上没有找到版本信息（Release 可能还是草稿，或者漏传了 latest.yml）'
  )
  check('连不上说人话', friendlyError(new Error('net::ERR_NAME_NOT_RESOLVED')), '连不上更新服务器')
  check(
    '校验失败说人话',
    friendlyError(new Error('sha512 checksum mismatch')),
    '下载到的安装包校验不一致，稍后再试'
  )
  check(
    '认不出来的错误保留第一行（排查时还要线索）',
    friendlyError(new Error('something odd\nsecond line')),
    'something odd'
  )
  check('空错误也有兜底', friendlyError(new Error('')), '未知原因')

  // 界面文案
  check(
    '便携版文案',
    updateSummary(initialUpdateState('portable')),
    '便携版每次运行都在临时目录里，装不了新版本，请手动下载'
  )
  check('开发版文案', updateSummary(initialUpdateState('dev')), '开发运行时不检查更新')
  check('没查过文案', updateSummary(initialUpdateState()), '还没检查过')
  check('检查中文案', updateSummary(updateReducer(begin, { type: 'check-started' }, t0)), '正在检查…')
  check('最新版文案', updateSummary(nope), '已是最新版本')
  check(
    '有新版文案',
    updateSummary(updateReducer(begin, { type: 'available', version: '0.1.5' }, t0)),
    '发现新版本 0.1.5'
  )
  check('失败文案带原因', updateSummary(bad), '检查更新失败：连不上更新服务器')
}

console.log('\n--- renderer/tokens.css 的对比度与用色规矩 ---')
{
  const root = join(__dirname, '..', '..')
  const tokens = readFileSync(join(root, 'src', 'renderer', 'tokens.css'), 'utf-8')
  const styles = readFileSync(join(root, 'src', 'renderer', 'styles.css'), 'utf-8')

  /** 取 `[from, to)` 之间所有 `--name: value;`。
   *  必须给上界：深色块里的同名 token 会覆盖浅色块的值，
   *  只给起点的话两套主题会解析成同一份，浅色那几条断言就变成了假的 */
  const readTokens = (from: number, to: number): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const m of tokens.slice(from, to).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      out[m[1]] = m[2].trim()
    }
    return out
  }
  const darkAt = tokens.indexOf('@media (prefers-color-scheme: dark)')
  check('tokens.css 里找得到深色块', darkAt > 0, true)
  const light = readTokens(tokens.indexOf(':root'), darkAt)
  const dark = readTokens(darkAt, tokens.length)

  const srgb = (c: number): number => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const luminance = (hex: string): number => {
    const { r, g, b } = parseHexColor(hex)
    return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
  }
  const contrast = (a: string, b: string): number => {
    const x = luminance(a)
    const y = luminance(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
  }

  check('深色段真的解析到了（不是空对象）', Object.keys(dark).length > 0, true)

  // 三层纸：窗口底 --paper（顶栏与底栏就坐在它上面）、列表纸面 --sheet、
  // 控件面 --surface（浮层）。**每个当文字用的色都要在三层上都达标** ——
  // 只验一层会漏掉「同一个色在顶栏够、在纸面上不够」这类问题，
  // 而朱砂恰好就是这么漏的：--paper 上 4.46:1，--sheet 上 5.08:1。
  const PAPERS = ['paper', 'sheet', 'surface']
  const TEXT_HUES = ['ink', 'ink-muted', 'indigo', 'cinnabar']

  for (const [themeName, t] of [['浅色', light], ['深色', dark]] as const) {
    for (const fg of TEXT_HUES) {
      // 非 6 位十六进制会让 parseHexColor 静默返回黑色、算出假的高对比度，
      // 所以先钉住格式：改成 rgba() 时必须连这里一起改，不能悄悄失效
      check(`${themeName} --${fg} 是 6 位十六进制`, /^#[0-9a-fA-F]{6}$/.test(t[fg]), true)
      const worst = Math.min(...PAPERS.map((bg) => contrast(t[fg], t[bg])))
      check(
        `${themeName} --${fg} 在三层纸上都满足 AA（最差 ${worst.toFixed(2)}:1）`,
        worst >= 4.5,
        true
      )
    }
  }

  // --ink-faint 只准给图标字形用。逐个列出允许的落点：加一处就得在这里加一行，
  // 于是「顺手拿它给一段文案调淡」会在测试里被挡住
  // （顺序 = styles.css 里的出现顺序，标题带那三个字形画在最前面。
  //   原表里还有 `.head__sep` —— 表头那句「· 还剩 4 件」换成读数带之后，
  //   分隔线由 border-left 画，那枚 `·` 连同它的落点一起撤了）
  const GLYPH_SELECTORS = [
    '.titlebar__button',
    '.row__more',
    '.noticebar__close',
    '.datefield__caret'
  ]
  const faintUsers: string[] = []
  let selector = ''
  for (const line of styles.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.endsWith('{')) selector = trimmed.slice(0, -1).trim()
    if (trimmed.startsWith('color:') && trimmed.includes('var(--ink-faint)')) {
      faintUsers.push(selector)
    }
  }
  check(
    `--ink-faint 只落在图标字形上（${faintUsers.join(' ')}）`,
    faintUsers.join(' ') === GLYPH_SELECTORS.join(' '),
    true
  )

  /*
   * 实底上的字：`--on-indigo` 压 `--indigo`（15px 的今日日号那种「小印」）、
   * `--on-slab` 压 `--slab`（倒计时页那一整块）。
   *
   * 这是本轮新引入的一类耦合 —— 上面那组只管「写在纸上」的字，管不到「压在实心上」的。
   * 调亮一个底、或换了底却忘了一起换字色，都会掉到 AA 以下，而这两种失效都只显形在
   * 那一小块上，肉眼大概率漏掉。
   *
   * **必须连 opacity 一起算**：hero 里的小字都带 0.75，混出来的实色才是真正被读到的
   * 颜色 —— 这条断言当日就把 `--on-slab` 从 `#e6edf2` 逼成了 `#ffffff`
   * （`#e6edf2` @75% 压在深色的 `--slab` 上只有 4.36:1，看着像够其实不够）。
   */
  const blend = (fg: string, bg: string, alpha: number): string => {
    if (alpha === 1) return fg
    const a = parseHexColor(fg)
    const b = parseHexColor(bg)
    const mix = [a.r, a.g, a.b].map((v, i) => {
      const under = [b.r, b.g, b.b][i]
      return Math.round(v * alpha + under * (1 - alpha))
    })
    return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`
  }
  // [字色, 底, 字在这层底上的实际不透明度]
  const SOLID_PAIRS: Array<[string, string, number]> = [
    ['on-indigo', 'indigo', 1],
    ['on-slab', 'slab', 0.75],
  ]
  for (const [themeName, t] of [['浅色', light], ['深色', dark]] as const) {
    for (const [fg, bg, alpha] of SOLID_PAIRS) {
      // 同上：非 6 位十六进制会静默算成黑色，得出假的高对比度
      check(
        `${themeName} --${fg} 与 --${bg} 都是 6 位十六进制`,
        /^#[0-9a-fA-F]{6}$/.test(t[fg]) && /^#[0-9a-fA-F]{6}$/.test(t[bg]),
        true
      )
      const mixed = blend(t[fg], t[bg], alpha)
      const c = contrast(mixed, t[bg])
      check(
        `${themeName} --${fg} 压在 --${bg} 上满足 AA（${alpha === 1 ? '实色' : `@${alpha * 100}%`} ${mixed}，${c.toFixed(2)}:1）`,
        c >= 4.5,
        true
      )
    }
  }
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${checks - failures}/${checks} 项通过`)
if (failures > 0) process.exitCode = 1
