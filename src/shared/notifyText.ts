import type { DueEntry } from './remind'
import type { RemindableTask } from './types'

/**
 * 单条通知的文案。措辞规范（规格 §9.6）：只往正向走 ——
 * 显示「还有多久」，不显示「已经过去多久」。真逾期了才直说逾期。
 */
export function describeTask(
  task: RemindableTask,
  at: number,
  now: number
): { title: string; body: string } {
  return { title: task.title, body: describeWhen(task, at, now) }
}

function describeWhen(task: RemindableTask, at: number, now: number): string {
  // 全天型与周期型没有「差多久」的概念，一律说今天
  if (task.kind === 'recurring') return '今天'
  if (task.allDay) return '今天'

  // `at` 是提醒点。tick 有 10 秒粒度，通知总是比提醒点略晚一点点才弹出来，
  // 「现在」的那 1 分钟因此是双侧容差：迟到不足 1 分钟还算「现在」，
  // 真迟了（睡醒补弹、暂停恢复）才说「已逾期」。
  const diff = at - now
  if (diff < -60_000) return '已逾期'
  if (diff < 60_000) return '现在'

  // 提醒点还在将来（提前查看，如面板预览）：用户关心的是任务本身还有多久，
  // 而不是提醒点还有多久 —— 截止型两者相差一个提前量。
  const left = task.dueAt - now
  if (left < 60_000) return '现在'

  const minutes = Math.round(left / 60_000)
  if (minutes < 60) return `还有 ${minutes} 分钟`
  return `还有 ${Math.round(minutes / 60)} 小时`
}

/**
 * 错过批次的聚合文案。一条而不是 N 条 ——
 * 睡醒被十几条通知轰炸会让人直接卸载应用。
 */
export function missedSummary(due: DueEntry[], max: number): { title: string; body: string } {
  const total = due.length
  const shown = due.slice(0, max).map((e) => e.task.title)
  const body = total > max ? `${shown.join(' · ')} 等 ${total} 件` : shown.join(' · ')
  return { title: `有 ${total} 件事错过了`, body }
}
