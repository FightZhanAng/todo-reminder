import { startOfDay } from './time'
import type { Task } from './types'

export type Urgency = 'none' | 'soon' | 'overdue'

/**
 * 「即将」的判定窗口。
 *
 * 规格 §9.3 原文把 --urgency-soon 注释成「今天内到期」，但「接下来」段里的任务
 * 本来就全是今天内的 —— 那样整段都是橙色，颜色就失去区分度了。收窄到 1 小时
 * 才让这条色条真的在说话（规格修正见 §6.4 / §18 第 3 条）。
 */
export const SOON_WINDOW_MS = 60 * 60_000

/**
 * 紧迫度。颜色只编码这一件事，通过任务卡左侧 3px 竖色条表达（规格 §9.3）。
 *
 * 注意「逾期」用的是「早于今天零点」而不是「早于 now」：一件今天 15:00 截止
 * 的任务在 15:01 时不算逾期 —— 它还在「接下来」段里，只是已经过了时刻。
 * 这条与 groupToday 的 overdue 判定**必须一致**，否则同一行会在「接下来」段
 * 里显示逾期的红色。
 */
export function urgencyOf(task: Task, now: number): Urgency {
  if (task.kind !== 'deadline') return 'none'
  if (task.completedAt !== null) return 'none'
  if (task.dueAt < startOfDay(now)) return 'overdue'
  if (!task.allDay && task.dueAt - now <= SOON_WINDOW_MS) return 'soon'
  return 'none'
}
