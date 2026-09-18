import { useState, type JSX, type MouseEvent } from 'react'
import type { Task } from '@shared/types'
import { urgencyOf } from '@shared/urgency'
import { RowMenu, type MenuItem } from './RowMenu'
import type { AppState } from '../useAppState'

export interface TaskRowProps {
  task: Task
  state: AppState
  /** 时刻列文案。不传则不渲染时刻列（「今天随时」与收件箱的行） */
  clock?: string
  /** 逾期时刻用朱红（规格 §9.6：只有真逾期了才转朱红） */
  clockOverdue?: boolean
  cursor: boolean
  highlight: boolean
  exitKind?: 'done' | 'removed'
}

export function TaskRow({
  task,
  state,
  clock,
  clockOverdue = false,
  cursor,
  highlight,
  exitKind
}: TaskRowProps): JSX.Element {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const urgency = urgencyOf(task, state.now)
  const removed = exitKind === 'removed'

  const items: MenuItem[] =
    task.kind === 'someday'
      ? [
          {
            label: '今天做',
            onSelect: () => {
              void state.run({ type: 'task:toToday', id: task.id })
              state.setFlash('已移到今天')
            }
          },
          { label: '编辑', onSelect: () => state.go({ name: 'edit', id: task.id, kind: task.kind }) },
          { label: '删除', danger: true, onSelect: () => state.remove(task) }
        ]
      : [
          { label: '完成', onSelect: () => state.complete(task) },
          {
            label: `推迟 ${state.snapshot!.settings.snoozeMinutes} 分钟`,
            onSelect: () => {
              void state.run({
                type: 'task:snooze',
                id: task.id,
                minutes: state.snapshot!.settings.snoozeMinutes
              })
            }
          },
          { label: '推到明天', onSelect: () => void state.run({ type: 'task:postpone', id: task.id }) },
          { label: '编辑', onSelect: () => state.go({ name: 'edit', id: task.id, kind: task.kind }) },
          { label: '删除', danger: true, onSelect: () => state.remove(task) }
        ]

  const classes = ['row']
  if (cursor) classes.push('row--cursor')
  if (highlight) classes.push('row--highlight')
  if (exitKind) classes.push('row--exiting')
  if (removed) classes.push('row--removed')
  if (exitKind === 'done') classes.push('row--done')

  return (
    <li className={classes.join(' ')} data-task-id={task.id}>
      <span className="row__cursor" aria-hidden="true" />
      <span className="row__bar" data-urgency={urgency} aria-hidden="true" />
      {clock !== undefined && (
        <span
          className={clockOverdue ? 'row__clock mono row__clock--overdue' : 'row__clock mono'}
          aria-hidden="true"
        >
          {clock}
        </span>
      )}

      <button
        type="button"
        role="checkbox"
        aria-checked={false}
        aria-label={`完成${task.title}`}
        className="row__dot"
        disabled={task.kind === 'someday'}
        onClick={(e) => {
          e.stopPropagation()
          state.complete(task)
        }}
      />

      <span
        className="row__title"
        onClick={() => state.go({ name: 'edit', id: task.id, kind: task.kind })}
        role="button"
        tabIndex={-1}
      >
        {task.important && <span className="row__important" aria-hidden="true" />}
        {task.title}
      </span>

      {task.kind === 'recurring' && task.streak >= 2 && (
        <span className="row__streak">连续 {task.streak} 天</span>
      )}

      {removed ? (
        <button type="button" className="row__undo" onClick={() => state.undoRemove(task.id)}>
          撤销
        </button>
      ) : (
        <button
          type="button"
          className="row__more"
          aria-label="更多操作"
          aria-expanded={anchor !== null}
          onClick={(e) => {
            e.stopPropagation()
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setAnchor({ x: r.right, y: r.bottom })
          }}
        >
          ⋮
        </button>
      )}

      {anchor !== null && <RowMenu items={items} anchor={anchor} onClose={() => setAnchor(null)} />}
    </li>
  )
}
