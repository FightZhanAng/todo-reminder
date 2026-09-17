import type { Settings } from './types'

export const FILE_VERSION = 1

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
  push: {
    enabled: false,
    configured: false,
    channel: 'serverchan',
    when: 'awayOnly',
    awayIdleMin: 5
  },
  hotkey: 'Control+Alt+T',
  theme: 'auto'
}
