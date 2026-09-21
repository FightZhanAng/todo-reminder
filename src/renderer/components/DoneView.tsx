import { useMemo, type JSX } from 'react'
import { collectDone, doneDayLabel, recurringDoneLabel } from '@shared/done'
import { dayKey, formatClock } from '@shared/time'
import { TaskRow } from './TaskRow'
import type { AppState } from '../useAppState'

/**
 * 「已完成」—— 做完的事去哪儿了。
 *
 * 这个视图存在的理由只有一句话：勾掉一件事之后，它从看板上消失，而
 * `groupToday` 永远不会再返回它。任务本体一直在 store 里（`completedAt`
 * 只是被写了个时间戳，从不清理），但**在此之前没有任何界面提到它**。
 *
 * 两段：
 *   上半 —— 按完成日分组的流水账。日期标题用「今天 / 昨天 / 前天」，
 *          一周以外换成「9月16日 周三」（那之后「N 天前」已经不说明什么了）。
 *   下半 —— 周期任务的打卡现状。**不掺进上面的按天分组**：它没有历史，
 *          只有最近一次，塞进「9月16日」那一格里会看上去像那天做了件事的流水。
 *
 * 行用 TaskRow（不是 TimeCard）：时刻列在这里的含义换了 —— 不再是「截止时刻」，
 * 而是**完成时刻**（`formatClock(completedAt)`）。这一栏本来就是等宽数字对齐的
 * 一列时间，换成完成时刻读起来依然成立，而且「几点做完的」正是这本账最该回答的。
 */
export function DoneView({ state }: { state: AppState }): JSX.Element {
  const { tasks, now, exiting } = state
  const ledger = useMemo(() => collectDone(tasks, now), [tasks, now])
  const exitingById = useMemo(
    () => new Map(exiting.map((e) => [e.task.id, e.kind])),
    [exiting]
  )

  const todayKey = dayKey(now)

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
            已完成
            <span className="topbar__date">{ledger.count} 件</span>
          </h1>
        </div>
      </header>

      <div className="app__body">
        {ledger.count === 0 ? (
          <div className="empty">
            还没有做完的事
            <div className="empty__hint">在今天那张看板上勾掉一件，它就会存在这里</div>
          </div>
        ) : (
          <>
            {ledger.days.map((day) => (
              <section className="section" key={day.key}>
                <h2 className="section__label">
                  <span className="section__name">{doneDayLabel(day.dayStart, now)}</span>
                  <span className="section__count">{day.tasks.length}</span>
                </h2>
                <ul>
                  {day.tasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      state={state}
                      /* completedAt 非 null 是 collectDone 的入组条件 */
                      clock={formatClock(task.completedAt as number)}
                      cursor={false}
                      highlight={false}
                      settled
                      exitKind={exitingById.get(task.id)}
                    />
                  ))}
                </ul>
              </section>
            ))}

            {ledger.recurring.length > 0 && (
              <section className="section">
                <h2 className="section__label">
                  <span className="section__name">每天</span>
                  <span className="section__count">{ledger.recurring.length}</span>
                </h2>
                <ul>
                  {ledger.recurring.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      state={state}
                      clock={task.remindTime}
                      cursor={false}
                      highlight={false}
                      /* 今天打过卡的才划掉；更早打过的是一条活着的习惯 */
                      settled={task.lastDoneDay === todayKey}
                      trailing={recurringDoneLabel(task, now)}
                      exitKind={exitingById.get(task.id)}
                    />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      <footer className="bottombar">
        <span className="bottombar__state">点左边的勾，把它收回今天</span>
      </footer>
    </>
  )
}
