import { useState, type JSX } from 'react'
import { tsFromDayKey } from '@shared/calendar'
import type { TaskDraft, TaskKind } from '@shared/commands'
import { dayKey, WEEKDAYS } from '@shared/time'
import type { RecurrenceRule, Task, Weekday } from '@shared/types'
import type { AppState, View } from '../useAppState'
import { DateField } from './DateField'
import { TimeField } from './TimeField'

const KINDS: { kind: TaskKind; label: string }[] = [
  { kind: 'deadline', label: '截止' },
  { kind: 'recurring', label: '周期' },
  { kind: 'someday', label: '清单' }
]

const FREQS: { freq: RecurrenceRule['freq']; label: string }[] = [
  { freq: 'daily', label: '每天' },
  { freq: 'weekly', label: '每周' },
  { freq: 'monthly', label: '每月' }
]

/** 星期选择器的展示顺序：一周从周一开始，但值仍是 Date.getDay() 的下标 */
const WEEKDAY_PICKS: Weekday[] = [1, 2, 3, 4, 5, 6, 0]

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

interface Form {
  kind: TaskKind
  title: string
  note: string
  important: boolean
  dueDay: string
  allDay: boolean
  time: string
  leadMin: string
  freq: RecurrenceRule['freq']
  every: string
  weekdays: Weekday[]
  monthDays: number[]
  skipWeekend: boolean
  remindTime: string
}

export function TaskEditor({
  state,
  view
}: {
  state: AppState
  view: Extract<View, { name: 'edit' }>
}): JSX.Element {
  const snapshot = state.snapshot!
  const editing = view.id === null ? null : (snapshot.tasks.find((t) => t.id === view.id) ?? null)
  const [form, setForm] = useState<Form>(() => initialForm(editing, view.kind, snapshot.settings))
  const [problem, setProblem] = useState<string | null>(null)

  const f = form
  const set = <K extends keyof Form>(key: K, value: Form[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const toggleWeekday = (d: Weekday): void =>
    set(
      'weekdays',
      f.weekdays.includes(d) ? f.weekdays.filter((x) => x !== d) : [...f.weekdays, d]
    )

  const toggleMonthDay = (d: number): void =>
    set(
      'monthDays',
      f.monthDays.includes(d) ? f.monthDays.filter((x) => x !== d) : [...f.monthDays, d]
    )

  const submit = (): void => {
    const draft = toDraft(f, snapshot.settings.defaultLeadMin)
    if (typeof draft === 'string') {
      setProblem(draft)
      return
    }
    setProblem(null)
    void state.run(
      editing === null
        ? { type: 'task:create', draft }
        : { type: 'task:edit', id: editing.id, draft }
    )
    state.setFlash(editing === null ? '已记下' : '已保存')
    state.go({ name: 'board' })
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar__lead">
          <button
            type="button"
            className="iconbutton"
            aria-label="不保存，返回"
            onClick={() => state.go({ name: 'board' })}
          >
            ←
          </button>
          <h1 className="topbar__title">{editing === null ? '记一件' : '编辑'}</h1>
        </div>
        <div className="topbar__actions">
          <button type="button" className="topbar__button topbar__button--primary" onClick={submit}>
            {editing === null ? '记下' : '保存'}
          </button>
        </div>
      </header>

      <div className="page__body">
        <div className="field">
          <span className="field__label">类型</span>
          <span className="field__control">
            <span className="segmented">
              {KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  className={
                    f.kind === k.kind ? 'segmented__item segmented__item--on' : 'segmented__item'
                  }
                  onClick={() => set('kind', k.kind)}
                >
                  {k.label}
                </button>
              ))}
            </span>
          </span>
        </div>

        <div className="field">
          <span className="field__label">标题</span>
          <span className="field__control">
            <input
              autoFocus
              value={f.title}
              placeholder="要做什么"
              onChange={(e) => set('title', e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
              }}
            />
          </span>
        </div>

        {f.kind === 'deadline' && (
          <>
            <div className="field">
              <span className="field__label">日期</span>
              <span className="field__control">
                <DateField value={f.dueDay} onChange={(v) => set('dueDay', v)} />
              </span>
            </div>
            <div className="field">
              <span className="field__label">时刻</span>
              <span className="field__control field__control--row">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={f.allDay}
                    onChange={(e) => set('allDay', e.target.checked)}
                  />
                  全天
                </label>
                {!f.allDay && <TimeField value={f.time} onChange={(v) => set('time', v)} label="时刻" />}
              </span>
            </div>
            {!f.allDay && (
              <div className="field">
                <span className="field__label">提前</span>
                <span className="field__control field__control--row">
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={f.leadMin}
                    onChange={(e) => set('leadMin', e.target.value)}
                  />
                  <span className="unit">分钟提醒</span>
                </span>
              </div>
            )}
          </>
        )}

        {f.kind === 'recurring' && (
          <>
            <div className="field">
              <span className="field__label">频率</span>
              <span className="field__control">
                <span className="segmented">
                  {FREQS.map((x) => (
                    <button
                      key={x.freq}
                      type="button"
                      className={
                        f.freq === x.freq ? 'segmented__item segmented__item--on' : 'segmented__item'
                      }
                      onClick={() => set('freq', x.freq)}
                    >
                      {x.label}
                    </button>
                  ))}
                </span>
              </span>
            </div>

            <div className="field">
              <span className="field__label">间隔</span>
              <span className="field__control field__control--row">
                <span className="unit">每</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={f.every}
                  onChange={(e) => set('every', e.target.value)}
                />
                <span className="unit">
                  {f.freq === 'daily' ? '天' : f.freq === 'weekly' ? '周' : '个月'}
                </span>
              </span>
            </div>

            {f.freq === 'weekly' && (
              <div className="field field--stack">
                <span className="field__label">星期</span>
                <span className="segmented">
                  {WEEKDAY_PICKS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={
                        f.weekdays.includes(d)
                          ? 'segmented__item segmented__item--on'
                          : 'segmented__item'
                      }
                      onClick={() => toggleWeekday(d)}
                    >
                      {WEEKDAYS[d].slice(1)}
                    </button>
                  ))}
                </span>
              </div>
            )}

            {f.freq === 'monthly' && (
              <div className="field field--stack">
                <span className="field__label">几号</span>
                <span className="daygrid">
                  {MONTH_DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={
                        f.monthDays.includes(d)
                          ? 'daygrid__item daygrid__item--on'
                          : 'daygrid__item'
                      }
                      onClick={() => toggleMonthDay(d)}
                    >
                      {d}
                    </button>
                  ))}
                </span>
                <div className="field__hint">31 号在小月自动落到当月最后一天</div>
              </div>
            )}

            <div className="field">
              <span className="field__label">提醒时刻</span>
              <span className="field__control">
                <TimeField
                  value={f.remindTime}
                  onChange={(v) => set('remindTime', v)}
                  label="提醒时刻"
                />
              </span>
            </div>

            {f.freq !== 'daily' && (
              <div className="field">
                <span className="field__label">周末</span>
                <span className="field__control">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={f.skipWeekend}
                      onChange={(e) => set('skipWeekend', e.target.checked)}
                    />
                    跳过后移到下一个工作日
                  </label>
                </span>
              </div>
            )}
          </>
        )}

        <div className="field field--stack">
          <span className="field__label">备注</span>
          <textarea
            rows={3}
            value={f.note}
            placeholder="可选"
            onChange={(e) => set('note', e.target.value)}
          />
        </div>

        <div className="field">
          <span className="field__label">重要</span>
          <span className="field__control">
            <label className="check">
              <input
                type="checkbox"
                checked={f.important}
                onChange={(e) => set('important', e.target.checked)}
              />
              顶部加一个标记，排序靠前
            </label>
          </span>
        </div>

        {problem !== null && <div className="field__hint field__hint--warn">{problem}</div>}
      </div>

      {editing !== null && (
        <footer className="bottombar">
          <span />
          <button
            type="button"
            className="bottombar__danger"
            onClick={() => {
              state.remove(editing)
              state.go({ name: 'board' })
            }}
          >
            删除这条
          </button>
        </footer>
      )}
    </div>
  )
}

/** 表单初值：编辑时逐字段还原，新建时用设置里的默认值 */
function initialForm(
  task: Task | null,
  kind: TaskKind,
  settings: { defaultLeadMin: number; allDayRemindTime: string }
): Form {
  const today = dayKey(Date.now())
  const todayDow = new Date().getDay() as Weekday
  const base: Form = {
    kind,
    title: '',
    note: '',
    important: false,
    dueDay: today,
    allDay: true,
    time: settings.allDayRemindTime,
    leadMin: String(settings.defaultLeadMin),
    freq: 'daily',
    every: '1',
    weekdays: [todayDow],
    monthDays: [new Date().getDate()],
    skipWeekend: false,
    remindTime: settings.allDayRemindTime
  }
  if (task === null) return base

  const next: Form = {
    ...base,
    kind: task.kind,
    title: task.title,
    note: task.note ?? '',
    important: task.important
  }
  if (task.kind === 'deadline') {
    const d = new Date(task.dueAt)
    next.dueDay = dayKey(task.dueAt)
    next.allDay = task.allDay
    next.time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    next.leadMin = String(task.leadMin)
  } else if (task.kind === 'recurring') {
    next.remindTime = task.remindTime
    next.freq = task.rule.freq
    next.every = String(task.rule.every)
    next.skipWeekend = task.rule.skipWeekend
    if (task.rule.freq === 'weekly') next.weekdays = [...task.rule.days]
    if (task.rule.freq === 'monthly') next.monthDays = [...task.rule.days]
  }
  return next
}

/** 返回 draft，或一句人话说明为什么还不能提交 */
function toDraft(f: Form, defaultLeadMin: number): TaskDraft | string {
  const title = f.title.trim()
  if (title === '') return '标题不能是空的'
  const note = f.note.trim()
  const common = { title, important: f.important, ...(note === '' ? {} : { note }) }

  if (f.kind === 'someday') return { kind: 'someday', ...common }

  if (f.kind === 'deadline') {
    const dueDay = tsFromDayKey(f.dueDay)
    if (dueDay === null) return '日期没填对'
    return {
      kind: 'deadline',
      ...common,
      dueDay,
      allDay: f.allDay,
      ...(f.allDay ? {} : { time: f.time, leadMin: clamp(num(f.leadMin, defaultLeadMin), 0, 1440) })
    }
  }

  const every = clamp(num(f.every, 1), 1, 99)
  if (f.freq === 'weekly' && f.weekdays.length === 0) return '至少选一个星期'
  if (f.freq === 'monthly' && f.monthDays.length === 0) return '至少选一个日子'
  const rule: RecurrenceRule =
    f.freq === 'daily'
      ? { freq: 'daily', every, skipWeekend: false }
      : f.freq === 'weekly'
        ? { freq: 'weekly', every, days: [...f.weekdays].sort(), skipWeekend: f.skipWeekend }
        : {
            freq: 'monthly',
            every,
            days: [...f.monthDays].sort((a, b) => a - b),
            skipWeekend: f.skipWeekend
          }
  return { kind: 'recurring', ...common, rule, remindTime: f.remindTime }
}

/** 日期控件的 'YYYY-MM-DD' → 当天本地 00:00 在 shared/calendar.ts（tsFromDayKey） */

function num(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}
