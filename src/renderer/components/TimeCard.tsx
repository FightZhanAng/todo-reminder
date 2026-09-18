import type { JSX } from 'react'
import { formatClock } from '@shared/time'
import { urgencyOf } from '@shared/urgency'
import type { Task } from '@shared/types'
import { TaskRow, type TaskRowProps } from './TaskRow'

/**
 * 带时刻列的行。逾期显示**原截止时刻**、周期任务显示 `remindTime`（规格 §6.3）。
 * 时刻列用等宽字体对齐成一条竖线，可以竖着扫读一天的节奏。
 *
 * 它只是 TaskRow 的一层壳 —— 时刻列的有无不该变成两套行实现。
 */
export function TimeCard(
  props: Omit<TaskRowProps, 'clock' | 'clockOverdue'> & { task: Task }
): JSX.Element {
  const { task, state } = props
  const clock =
    task.kind === 'recurring'
      ? task.remindTime
      : task.kind === 'deadline'
        ? formatClock(task.dueAt)
        : ''
  // 复用 urgencyOf 而不是在这里再写一遍"逾期的定义"——
  // 色条的颜色和时刻列的颜色必须是同一个判断，否则会出现
  // 「色条是灰的、时刻是红的」这种自相矛盾的一行
  const overdue = urgencyOf(task, state.now) === 'overdue'
  return <TaskRow {...props} clock={clock} clockOverdue={overdue} />
}
