import type { Settings } from './types'

/**
 * 数据文件格式版本。
 *
 * v2（2026-09-29）：多了 `anniversaries` 一集，设置里多了两个倒计时开关。
 * v3（2026-09-29）：设置里多了 `autoUpdate`。
 * v4（2026-09-30）：纪念日多了 `notify` 与 `firedFor` —— 纪念日也可以
 *   逐条打开「到那天提醒我」了。旧版本读到 v4 会先备份再动，所以退回
 *   旧版本时那两个字段最多被丢掉，不会把整条纪念日连带抹掉。
 * **加字段就必须提版本号**，理由不是「格式变了」而是那条老规矩：
 * 装过新版本又退回旧版本时，旧版本靠这个数认出「这份文件比我新」，
 * 于是先备份再动 —— 否则它第一次改设置就会把全量重写一遍，
 * 用户的纪念日无声消失。
 *
 * v3 这个字段本身不致命（旧版本丢掉它只是失去一个开关），但规矩是
 * 看「有没有新字段」而不是「丢了会怎样」：判据一旦掺进「这个大概不要紧」，
 * 下次真要紧的时候就没人记得该提了。
 */
export const FILE_VERSION = 4

/** 状态巡检周期。10 秒足够，且远比 1 秒省电 */
export const TICK_MS = 10_000

/** 超过这个时长未处理就归入「错过」批次，聚合成一条通知 */
export const MISS_GRACE_MS = 10 * 60_000

export const DEFAULT_LEAD_MIN = 15
export const DEFAULT_SNOOZE_MIN = 10

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: FILE_VERSION,
  launchAtLogin: false,
  notifyEnabled: true,
  soundEnabled: true,
  allDayRemindTime: '09:00',
  defaultLeadMin: DEFAULT_LEAD_MIN,
  snoozeMinutes: DEFAULT_SNOOZE_MIN,
  quietHours: null,
  quietWhenIdle: true,
  idleThresholdMin: 5,
  hotkey: 'Control+Alt+T',
  theme: 'auto',
  alwaysOnTop: false,
  countdownHolidays: true,
  // 一年。大多数人要的是「下一个假期」和「最近的几个纪念日」，
  // 把三年后的也堆在上面只会让最近的几条被淹掉
  countdownHorizonDays: 365,
  // 默认开着：这是个常驻托盘的私人工具，「装好就不用再管」正是它的卖点。
  // 关掉的代价只是「不会自动发现新版」而已，不是一个危险的默认值
  autoUpdate: true
}
