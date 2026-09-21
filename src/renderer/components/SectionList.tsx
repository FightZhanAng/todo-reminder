import type { JSX } from 'react'
import type { Task } from '@shared/types'
import { TaskRow } from './TaskRow'
import { TimeCard } from './TimeCard'
import type { AppState } from '../useAppState'

export type SectionName = 'overdue' | 'upcoming' | 'anytime' | 'recurring' | 'inbox'

export interface SectionListProps {
  label: string
  section: SectionName
  tasks: Task[]
  state: AppState
  cursorId: string | null
  highlightId: string | null
  /** 透传给行，行内菜单开合时通知上层（Board 挂起看板快捷键，Important 2） */
  onMenuOpenChange?: (open: boolean) => void
}

/** 段内为空则整段消失（连标题一起），四段全空由上一层换成空状态（规格 §6.2） */
export function SectionList({
  label,
  section,
  tasks,
  state,
  cursorId,
  highlightId,
  onMenuOpenChange
}: SectionListProps): JSX.Element | null {
  if (tasks.length === 0) return null

  const exitingById = new Map(state.exiting.map((e) => [e.task.id, e.kind]))
  const withClock = section !== 'anytime' && section !== 'inbox'

  return (
    <section className={section === 'overdue' ? 'section section--overdue' : 'section'}>
      {/* 段标签挂在竖轴上（::before 续轴、::after 是分格粗刻度），
          计数用等宽数字 —— 「逾期 2」里的 2 和「接下来 5」里的 5 要能竖着对齐。
          名字单独包一层，这样 .section__name / .section__count 都能直接选到 */}
      <h2 className="section__label">
        <span className="section__name">{label}</span>
        <span className="section__count">{tasks.length}</span>
      </h2>
      <ul>
        {tasks.map((task) => {
          const shared = {
            task,
            state,
            cursor: cursorId === task.id,
            highlight: highlightId === task.id,
            exitKind: exitingById.get(task.id),
            onMenuOpenChange
          }
          return withClock ? (
            <TimeCard key={task.id} {...shared} />
          ) : (
            <TaskRow key={task.id} {...shared} />
          )
        })}
      </ul>
    </section>
  )
}
