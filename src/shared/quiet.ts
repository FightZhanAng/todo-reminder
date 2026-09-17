import { parseHM } from './time'
import type { Settings } from './types'

/**
 * 当前是否落在免打扰时段内。支持跨午夜（如 22:00–08:00）。
 * 起止时刻相同视为不启用。
 */
export function inQuietHours(settings: Settings, now: number): boolean {
  const q = settings.quietHours
  if (!q) return false

  const { h: sh, m: sm } = parseHM(q.start)
  const { h: eh, m: em } = parseHM(q.end)
  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em
  if (startMin === endMin) return false

  const d = new Date(now)
  const current = d.getHours() * 60 + d.getMinutes()

  return startMin < endMin
    ? current >= startMin && current < endMin
    : current >= startMin || current < endMin
}
