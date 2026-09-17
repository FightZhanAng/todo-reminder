import { dayKey, startOfDay } from './time'
import type { RecurringTask, RemindableTask, TaskPatch } from './types'

export type TaskAction = 'complete' | 'snooze' | 'tomorrow'

/** 通知按钮的排列顺序。下标即 Notification 的 actionIndex */
export const ACTION_ORDER: TaskAction[] = ['complete', 'snooze', 'tomorrow']

/**
 * 按钮文案。「推迟」的分钟数必须从设置取 ——
 * 写死成常量的话，将来设置里把推迟改成 20 分钟，按钮上还写着 10 分钟，
 * 通知就在撒谎。
 */
export function actionLabel(action: TaskAction, snoozeMinutes: number): string {
  switch (action) {
    case 'complete':
      return '完成'
    case 'snooze':
      return `推迟 ${snoozeMinutes} 分钟`
    case 'tomorrow':
      return '推到明天'
  }
}

export interface ActionOptions {
  snoozeMinutes: number
}

/** 算出动作要合并进任务的字段。纯函数 —— 不读时钟、不做 IO */
export function actionPatch(
  task: RemindableTask,
  action: TaskAction,
  now: number,
  opts: ActionOptions
): TaskPatch {
  if (action === 'complete') {
    return task.kind === 'recurring' ? completeRecurring(task, now) : { completedAt: now }
  }

  if (action === 'snooze') {
    return { snoozeUntil: now + opts.snoozeMinutes * 60_000, firedFor: null }
  }

  // 「推到明天」有意不走「算一下明天的提醒点」那条路 ——
  // 那条路要考虑提前量、全天时刻、顺延，全是容易错的边界。
  if (task.kind === 'recurring') {
    // 周期任务本来就按规则重复，「推到明天」= 今天跳过，规则不受影响
    return { lastDoneDay: dayKey(now), firedFor: null }
  }
  // 截止型：整体把截止时间挪到明天同一时刻
  return { dueAt: sameClockTomorrow(task.dueAt, now), snoozeUntil: null, firedFor: null }
}

/** 把时间戳整体挪到明天、保持时分；结果保证晚于 now */
function sameClockTomorrow(ts: number, now: number): number {
  const source = new Date(ts)
  const candidate = new Date(now)
  candidate.setDate(candidate.getDate() + 1)
  candidate.setHours(source.getHours(), source.getMinutes(), 0, 0)
  while (candidate.getTime() <= now) candidate.setDate(candidate.getDate() + 1)
  return candidate.getTime()
}

/** 周期任务完成：更新 lastDoneDay 与 streak，任务本体不消失 */
function completeRecurring(task: RecurringTask, now: number): TaskPatch {
  const today = dayKey(now)
  if (task.lastDoneDay === today) return {}

  const yesterday = dayKey(startOfDay(now) - 1)
  const streak = task.lastDoneDay === yesterday ? task.streak + 1 : 1
  return { lastDoneDay: today, streak, firedFor: null }
}
