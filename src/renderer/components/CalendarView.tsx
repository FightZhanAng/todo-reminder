import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { agendaOfDay, monthAgenda, type DayAgenda } from '@shared/agenda'
import {
  CAL_HEADERS, dayKeyOf, monthGrid, monthLabel, monthOf, shiftMonth, tsFromDayKey
} from '@shared/calendar'
import { collectCountdowns } from '@shared/countdown'
import { dayMarkOf, holidayCoverageNote, holidayPositionOf, makeupFor } from '@shared/holiday'
import { lunarCellLabel, lunarOf } from '@shared/lunar'
import { termOnDay } from '@shared/term'
import { dayKey, formatClock, startOfDay, WEEKDAYS } from '@shared/time'
import type { Task } from '@shared/types'
import { TaskRow } from './TaskRow'
import type { AppState, View } from '../useAppState'

/**
 * 日历 —— 唯一一个**按任意一天**回答「那天有什么」的地方。
 *
 * 看板四段只看今天、收件箱只放清单池、「以后」从明天起、已完成与倒计时各管一头，
 * 所以「上个月那笔报销是哪天交的」「下下周三有没有事」在这之前没有答案。
 *
 * ## 一格上有五件事，分走五个不同的通道
 *
 * 信息多但通道不重叠，所以扫一眼不用逐格读字：
 *
 *   底色    ← 休（淡靛，连着几天自己连成一条色带）/ 调休（45° 斜纹）
 *   左边一笔 ← 有逾期（朱砂竖条，给底色让路）
 *   字的重量 ← 休假日号染靛蓝、调休日号加粗、节气染靛蓝加粗
 *   一个点  ← 今天（日号上的实心靛蓝印）
 *   一个框  ← 选中（2px 靛蓝）
 *
 * 「休 / 班」两个字还在，但去掉了外框 —— 底色和斜纹已经把这一格围住了，
 * 再加描边就是两层框。
 *
 * 色相仍然只有两个：靛蓝 = 结构、放假、快到了；朱砂 = 已经晚了。
 * 加的是**浓度和纹理**（`--indigo-wash` / `--stripe`），不是第三个颜色 ——
 * 调休上班是一年里最容易被忘掉的一天，但它不是「已经晚了」，不能借朱砂。
 *
 * ## 为什么选中的格子不填墨
 *
 * 日期浮层（`DateField`）里的选中日是实心墨块，这里不能照抄：
 * 格子里还装着底色、徽标和圆点，填了墨它们全得反过来画一遍。
 * 这里用 2px 靛蓝细边，今天则靠日号上一枚实心印表达 —— 一个框、一个点，
 * 叠在一起也分得清。
 */
export function CalendarView({ state }: { state: AppState }): JSX.Element {
  const { tasks, now } = state
  const snapshot = state.snapshot!
  const [view, setView] = useState(() => monthOf(now))
  const [selected, setSelected] = useState(() => dayKey(now))

  const todayKey = dayKey(now)
  const lastToday = useRef(todayKey)

  // 跨零点时把「今天」推走：停在这一屏过夜，日期该翻。但**只跟着走一天** ——
  // 用户选的是前天，零点一过不该把他弹回今天（他正在看那天的事）
  useEffect(() => {
    const previous = lastToday.current
    lastToday.current = todayKey
    if (previous === todayKey || selected !== previous) return
    setSelected(todayKey)
    setView(monthOf(now))
  }, [todayKey, selected, now])

  const weeks = useMemo(() => monthGrid(view.year, view.month1), [view.year, view.month1])
  const agenda = useMemo(
    () => monthAgenda(tasks, view.year, view.month1, now),
    [tasks, view.year, view.month1, now]
  )

  // 选中日自己算一次，而不是从上面那张表里取：翻到别的月份时选中日不在表里，
  // 那样下面的明细会突然变成空的 —— 用户没点任何东西，内容却消失了
  const selectedTs = tsFromDayKey(selected) ?? startOfDay(now)
  const detail = useMemo(() => agendaOfDay(tasks, selectedTs, now), [tasks, selectedTs, now])

  const coverageNote = holidayCoverageNote(view.year)
  // 日期范围不设限：这一条只是「下一个假期」的引子，被「只看 N 天」挡住就没意义了
  const next = collectCountdowns(now, snapshot.anniversaries, {
    countdownHolidays: snapshot.settings.countdownHolidays,
    countdownHorizonDays: 0
  }).holidays[0]

  const goEditOnDay = (day: string): void => {
    const target: View = { name: 'edit', id: null, kind: 'deadline', dueDay: day, from: 'calendar' }
    state.go(target)
  }

  return (
    <div className="page">
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
          <h1 className="topbar__title">日历</h1>
        </div>
        <div className="topbar__actions">
          <button
            type="button"
            className="topbar__button"
            onClick={() => {
              setView(monthOf(now))
              setSelected(todayKey)
            }}
          >
            今天
          </button>
        </div>
      </header>

      <div className="page__body">
        <div className="cal__head">
          <button
            type="button"
            className="cal__nav"
            aria-label="上个月"
            onClick={() => setView((v) => shiftMonth(v, -1))}
          >
            ‹
          </button>
          <span className="cal__title">{monthLabel(view)}</span>
          <button
            type="button"
            className="cal__nav"
            aria-label="下个月"
            onClick={() => setView((v) => shiftMonth(v, 1))}
          >
            ›
          </button>
        </div>

        <div className="cal__dows" aria-hidden="true">
          {CAL_HEADERS.map((label, i) => (
            <span key={i} className={i > 4 ? 'cal__dow cal__dow--rest' : 'cal__dow'}>
              {label}
            </span>
          ))}
        </div>

        <div className="monthgrid">
          {weeks.flat().map((cell) => {
            const key = dayKeyOf(cell)
            const mark = dayMarkOf(cell.ts)
            const term = termOnDay(cell.ts)
            const label = term?.name ?? lunarCellLabel(cell.ts)
            const day = agenda.get(key)
            const classes = ['monthcell']
            if (!cell.inMonth) classes.push('monthcell--out')
            if (mark.kind === 'holiday') classes.push('monthcell--rest')
            if (mark.kind === 'adjusted-work') classes.push('monthcell--work')
            if (day !== undefined && day.overdue > 0) classes.push('monthcell--late')
            if (key === todayKey) classes.push('monthcell--today')
            if (key === selected) classes.push('monthcell--on')
            return (
              <button
                key={key}
                type="button"
                className={classes.join(' ')}
                aria-current={key === todayKey ? 'date' : undefined}
                aria-label={`${dowShort(cell.weekday)}${cell.day} 日${label === '' ? '' : ` ${label}`}`}
                onClick={() => setSelected(key)}
              >
                <span className="monthcell__top">
                  {mark.kind === 'holiday' && <span className="monthcell__badge">休</span>}
                  {mark.kind === 'adjusted-work' && (
                    <span className="monthcell__badge monthcell__badge--work">班</span>
                  )}
                  <span className="monthcell__day">{cell.day}</span>
                </span>
                <span className={term === null ? 'monthcell__label' : 'monthcell__label monthcell__label--term'}>
                  {label}
                </span>
                <Dots agenda={day} />
              </button>
            )
          })}
        </div>

        {coverageNote !== null && <div className="cal__note">{coverageNote}</div>}

        <DayCard
          state={state}
          selectedTs={selectedTs}
          detail={detail}
          onCreate={() => goEditOnDay(dayKey(selectedTs))}
        />
      </div>

      <footer className="bottombar">
        <button
          type="button"
          className="bottombar__link"
          onClick={() => state.go({ name: 'countdown' })}
        >
          {next === undefined
            ? '倒计时'
            : `倒计时 · ${next.name}${
                next.indexInRun === null ? ` ${next.daysUntil} 天后` : ` 第 ${next.indexInRun} 天`
              }`}
        </button>
      </footer>
    </div>
  )
}

/** 圆点 = 那天还没做完的条数，最多三个；有逾期的换朱砂，超出三个给数字 */
function Dots({ agenda }: { agenda: DayAgenda | undefined }): JSX.Element | null {
  if (agenda === undefined || agenda.pending === 0) return null
  return (
    <span className="monthcell__dots" data-late={agenda.overdue > 0 ? '1' : '0'}>
      {Array.from({ length: Math.min(3, agenda.pending) }, (_, i) => (
        <span key={i} className="monthdot" />
      ))}
      {agenda.pending > 3 && <span className="monthcell__more">{agenda.pending}</span>}
    </span>
  )
}

/**
 * 选中那天的明细。
 *
 * 顶部那两行字是这个视图真正值钱的地方：农历、节气、休还是班 ——
 * 平时要掏手机查的东西，这里一句话说完。
 */
function DayCard({
  state,
  selectedTs,
  detail,
  onCreate
}: {
  state: AppState
  selectedTs: number
  detail: DayAgenda
  onCreate: () => void
}): JSX.Element {
  const d = new Date(selectedTs)
  const lunar = lunarOf(selectedTs)
  const term = termOnDay(selectedTs)
  const position = holidayPositionOf(selectedTs)
  const makeup = makeupFor(selectedTs)

  return (
    <section className="daycard">
      <header className="daycard__head">
        <div className="daycard__line">
          <span className="daycard__date">
            {d.getMonth() + 1} 月 {d.getDate()} 日
          </span>
          <span className="daycard__dow">{WEEKDAYS[d.getDay()]}</span>
          {position !== null && (
            <span className="daycard__chip">
              {position.run.name} 第 {position.index}/{position.span} 天
            </span>
          )}
          {makeup !== null && <span className="daycard__chip">调休上班 · 为{makeup}</span>}
        </div>
        <div className="daycard__meta">
          {lunar !== null && <span>农历{lunar.label}</span>}
          {term !== null && (
            <span>
              {term.name} {term.clock}
            </span>
          )}
          {position === null && makeup === null && <span>{restLabel(d.getDay())}</span>}
        </div>
      </header>

      {detail.tasks.length === 0 ? (
        <div className="daycard__empty">这天没有安排</div>
      ) : (
        <ul>
          {detail.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              state={state}
              clock={clockOf(task)}
              cursor={false}
              highlight={false}
              exitKind={state.exiting.find((e) => e.task.id === task.id)?.kind}
              settled={settledOn(task, selectedTs)}
            />
          ))}
        </ul>
      )}

      <div className="daycard__foot">
        <button type="button" className="daycard__add" onClick={onCreate}>
          + 在这天记一件
        </button>
      </div>
    </section>
  )
}

function restLabel(weekday: number): string {
  return weekday === 0 || weekday === 6 ? '周末' : '工作日'
}

function dowShort(weekday: number): string {
  return WEEKDAYS[weekday] ?? ''
}

/** 时刻列：全天型给空串而不是 00:00（「这天做完就行」不是「凌晨就要交」） */
function clockOf(task: Task): string {
  if (task.kind === 'recurring') return task.remindTime
  if (task.kind === 'someday') return ''
  return task.allDay ? '' : formatClock(task.dueAt)
}

/** 那天已经打过卡的（截止型已完成 / 周期型当天已打卡）挂在静态墨线上 */
function settledOn(task: Task, dayStart: number): boolean {
  if (task.kind === 'deadline') return task.completedAt !== null
  if (task.kind === 'recurring') return task.lastDoneDay === dayKey(dayStart)
  return false
}
