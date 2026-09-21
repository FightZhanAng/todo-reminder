import { useMemo, type JSX } from 'react'
import { dayLabel } from '@shared/calendar'
import { collectUpcoming } from '@shared/future'
import { formatClock } from '@shared/time'
import { TaskRow } from './TaskRow'
import type { AppState } from '../useAppState'

/**
 * 「以后」—— 明天及以后的事排在哪天。
 *
 * 看板的四段全只看今天，收件箱只放清单池，所以在这之前记一条周三的事，
 * 它就从界面上彻底消失了（分组规则见 `shared/future.ts`）。
 *
 * 行复用 TaskRow，只是时刻列自己算：**全天型给空串而不是 `00:00`** ——
 * 「周三之前做完就行」显示成凌晨零点会被读成「那天凌晨要交」。
 * 空串不等于不渲染，刻度列的 x 靠时刻列撑住。
 */
export function FutureView({ state }: { state: AppState }): JSX.Element {
  const { tasks, now, exiting } = state
  const days = useMemo(() => collectUpcoming(tasks, now), [tasks, now])
  const exitingById = useMemo(
    () => new Map(exiting.map((e) => [e.task.id, e.kind])),
    [exiting]
  )
  const total = days.reduce((n, day) => n + day.tasks.length, 0)

  return (
    <>
      <header className="topbar">
        <div className="topbar__lead">
          <button
            type="button"
            className="iconbutton"
            aria-label="返回今天"
            onClick={() => state.go({ name: 'board' })}
          >
            ←
          </button>
          <h1 className="topbar__title">
            以后
            <span className="topbar__date">{total} 件</span>
          </h1>
        </div>
      </header>

      <div className="app__body">
        {total === 0 ? (
          <div className="empty">
            以后是空的
            <div className="empty__hint">明天及以后要截止的事会排在这里</div>
          </div>
        ) : (
          days.map((day) => (
            <section className="section" key={day.key}>
              <h2 className="section__label">
                <span className="section__name">{dayLabel(day.dayStart, now)}</span>
                <span className="section__count">{day.tasks.length}</span>
              </h2>
              <ul>
                {day.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    state={state}
                    clock={task.allDay ? '' : formatClock(task.dueAt)}
                    cursor={false}
                    highlight={false}
                    exitKind={exitingById.get(task.id)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      <footer className="bottombar">
        <span className="bottombar__state">点标题改日期</span>
      </footer>
    </>
  )
}
