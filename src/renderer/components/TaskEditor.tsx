import { useState, type JSX } from 'react'
import { dayLabel, tsFromDayKey } from '@shared/calendar'
import type { TaskDraft, TaskKind } from '@shared/commands'
import { expandRecurrence } from '@shared/recurrence'
import { dayKey, startOfDay, WEEKDAYS } from '@shared/time'
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
  const [form, setForm] = useState<Form>(() =>
    initialForm(editing, view.kind, snapshot.settings, view.dueDay)
  )
  const [problem, setProblem] = useState<string | null>(null)

  // 从哪进来就回哪去。日历上「在这天记一件」之后落到看板是**丢上下文**的 ——
  // 那条任务在别的日子，今天的看板上什么都不会变
  const back: View = view.from === 'calendar' ? { name: 'calendar' } : { name: 'board' }

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
    state.go(back)
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar__lead">
          <button
            type="button"
            className="iconbutton"
            aria-label="不保存，返回"
            onClick={() => state.go(back)}
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

            {/* 预览放在这一段最后：上面的频率 / 间隔 / 星期 / 几号 / 时刻 / 周末
                每一项都会改变结果，摆在中间会读成「只反映它上面的几项」 */}
            <NextRuns
              form={f}
              anchor={editing === null ? null : editing.createdAt}
              now={state.now}
            />
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
              state.go(back)
            }}
          >
            删除这条
          </button>
        </footer>
      )}
    </div>
  )
}

/**
 * 「接下来几次」。规则本身看不见 —— 选了「每 2 周的周三」之后，
 * 界面上没有任何东西能回答「那到底哪几天响」。
 *
 * 用 `expandRecurrence`（`shared/recurrence.ts` 里的纯函数，有测试）算，
 * 不在组件里另写一遍推进逻辑。
 *
 * **锚点必须跟着编辑的对象走**：`matchesDay` 对 every > 1 的规则按
 * `(target - anchor) % every` 定相位，锚点偏一天结果就整体错开一格。
 * 编辑一条老任务时锚点是它的 `createdAt`（不是今天），传 null 表示新建 ——
 * 新建的 `createdAt` 就是提交那一刻。
 *
 * `now` 由外面传（`state.now`）而不是在渲染里读 `Date.now()` —— 渲染要保持纯，
 * 而且那个时钟在编辑器打开时照常走（见 useAppState 的 clockMode）。
 */
function NextRuns({
  form,
  anchor,
  now
}: {
  form: Form
  anchor: number | null
  now: number
}): JSX.Element | null {
  const rule = ruleOf(form)
  // 规则还不成立（没选星期 / 没选日子）时不出声 —— 那时下面那句问题提示
  // 才是用户该看的东西，两个一起出现只会互相打架
  if (typeof rule === 'string') return null

  const days = expandRecurrence(rule, anchor ?? now, startOfDay(now), 4)
  if (days.length === 0) return null

  return (
    <div className="field field--stack">
      <span className="field__label">接下来</span>
      <div className="field__hint">{days.map((d) => dayLabel(d, now)).join(' · ')}</div>
    </div>
  )
}

/**
 * 表单初值：编辑时逐字段还原，新建时用设置里的默认值。
 *
 * `dueDay` 只有从日历进来时才有 —— 它**不改类型**，只换掉「日期」那一格
 * 的初值。周期型与清单池用不到它（它们没有截止日）。
 */
function initialForm(
  task: Task | null,
  kind: TaskKind,
  settings: { defaultLeadMin: number; allDayRemindTime: string },
  dueDay?: string
): Form {
  const today = dueDay ?? dayKey(Date.now())
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

  const rule = ruleOf(f)
  if (typeof rule === 'string') return rule
  return { kind: 'recurring', ...common, rule, remindTime: f.remindTime }
}

/**
 * 表单 → 重复规则，或一句人话说明还差什么。
 *
 * 单独一个函数是因为**「下次触发」的预览和真正提交的 draft 必须是同一条规则** ——
 * 两处各算一遍的话，预览说「下周三」而实际排到周四这类错位迟早出现，
 * 而且看起来会像是排期算错了。
 */
function ruleOf(f: Form): RecurrenceRule | string {
  const every = clamp(num(f.every, 1), 1, 99)
  if (f.freq === 'weekly' && f.weekdays.length === 0) return '至少选一个星期'
  if (f.freq === 'monthly' && f.monthDays.length === 0) return '至少选一个日子'
  return f.freq === 'daily'
    ? { freq: 'daily', every, skipWeekend: false }
    : f.freq === 'weekly'
      ? { freq: 'weekly', every, days: [...f.weekdays].sort(), skipWeekend: f.skipWeekend }
      : {
          freq: 'monthly',
          every,
          days: [...f.monthDays].sort((a, b) => a - b),
          skipWeekend: f.skipWeekend
        }
}

/** 日期控件的 'YYYY-MM-DD' → 当天本地 00:00 在 shared/calendar.ts（tsFromDayKey） */

function num(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}
