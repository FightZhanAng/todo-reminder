import type { JSX } from 'react'
import { formatClock } from '@shared/time'
import type { Task } from '@shared/types'
import { TaskRow, type TaskRowProps } from './TaskRow'

/**
 * 带时刻列的行。逾期显示**原截止时刻**、周期任务显示 `remindTime`。
 * 时刻列用等宽字体对齐成一条竖线，可以竖着扫读一天的节奏。
 *
 * 它只是 TaskRow 的一层壳 —— 时刻列的有无不该变成两套行实现。
 *
 * 没有时刻的行在这里拿到的是空串而不是 undefined：刻度列的 x 靠时刻列撑住，
 * 一旦不渲染，整根竖轴就在分段之间错位了（见 TaskRow 的注释）。
 */
export function TimeCard(
  props: Omit<TaskRowProps, 'clock'> & { task: Task }
): JSX.Element {
  const { task } = props
  const clock =
    task.kind === 'recurring'
      ? task.remindTime
      : task.kind === 'deadline'
        ? formatClock(task.dueAt)
        : ''
  // 时刻列的颜色不再由这里判断 —— TaskRow 内部本来就要算 urgency 来画刻度，
  // 两个地方各判一次迟早会不一致
  return <TaskRow {...props} clock={clock} />
}
