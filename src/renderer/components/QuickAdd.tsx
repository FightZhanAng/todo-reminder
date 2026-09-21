import { useEffect, useRef, useState, type JSX } from 'react'
import type { TaskDraft } from '@shared/commands'
import { nextDayStart, startOfDay } from '@shared/time'

/**
 * 快速添加小窗的全部内容。
 *
 * 没有标题栏、没有确认步骤：回车或点一下就记下。窗口是**复用**的（主进程只建一次），
 * 所以每次拿到焦点都要把上一次的残留清掉 —— 否则第二次按快捷键会看到上次那件事，
 * 顺手回车就记重复了。
 */
export function QuickAdd(): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [title, setTitle] = useState('')
  const [time, setTime] = useState(defaultClock)

  useEffect(() => {
    const reset = (): void => {
      setTitle('')
      setTime(defaultClock())
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    reset()
    window.addEventListener('focus', reset)
    return () => window.removeEventListener('focus', reset)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.quickadd.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const send = (draft: TaskDraft): void => {
    const trimmed = draft.title.trim()
    if (trimmed === '') {
      inputRef.current?.focus()
      return
    }
    void window.quickadd.submit({ ...draft, title: trimmed })
  }

  const todayAllDay = (): void =>
    send({
      kind: 'deadline',
      title,
      important: false,
      dueDay: startOfDay(Date.now()),
      allDay: true
    })

  const tomorrowAllDay = (): void =>
    send({
      kind: 'deadline',
      title,
      important: false,
      dueDay: nextDayStart(Date.now()),
      allDay: true
    })

  const atTime = (): void =>
    send({
      kind: 'deadline',
      title,
      important: false,
      dueDay: startOfDay(Date.now()),
      allDay: false,
      time: normalizeClock(time)
    })

  return (
    <form
      className="quickadd"
      onSubmit={(e) => {
        e.preventDefault()
        todayAllDay()
      }}
    >
      <input
        ref={inputRef}
        className="quickadd__title"
        placeholder="要做什么"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="quickadd__row">
        <button type="submit" className="quickadd__btn quickadd__btn--primary">
          今天 全天
        </button>
        <button type="button" className="quickadd__btn" onClick={tomorrowAllDay}>
          明天 全天
        </button>
        <span className="quickadd__sep" aria-hidden="true" />
        {/* 这里**故意不用原生 `<input type="time">`**：一个 440×110 的无边框小窗里，
            系统那套上下箭头既不跟主题走、又比整个窗口的其它元素都显眼。
            也没给它配浮层日历那样的自绘控件 —— 浮层在这个高度下会被窗口切掉。
            做成纯文本，输入 1430 或 14:3 都收（normalizeClock）。 */}
        <input
          className="mono quickadd__time"
          aria-label="今天的时刻"
          inputMode="numeric"
          placeholder="HH:mm"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => setTime(normalizeClock(time))}
          onKeyDown={(e) => {
            // 表单里回车默认会走 submit（= 今天全天），在这个框里不是用户想要的
            if (e.key !== 'Enter') return
            e.preventDefault()
            atTime()
          }}
        />
        <button type="button" className="quickadd__btn" onClick={atTime}>
          今天这个点
        </button>
      </div>
    </form>
  )
}

/** 下一个半点的 'HH:mm'。默认值别是「现在」—— 现在的意思是立刻就过期 */
function defaultClock(): string {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() + (30 - (d.getMinutes() % 30)))
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 手输的时刻 → 'HH:mm'。`1430` / `14:3` / `9` 都收 —— 一个随手弹出的小窗里
 * 没道理要求用户先补零再打冒号。给不出数字就原样退回（宁可留着让他改，
 * 也别默默改成一个他没输入过的时间）。
 */
function normalizeClock(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits === '') return raw
  const h = digits.length <= 2 ? Number(digits) : Number(digits.slice(0, -2))
  const m = digits.length <= 2 ? 0 : Number(digits.slice(-2))
  return `${String(Math.min(23, h)).padStart(2, '0')}:${String(Math.min(59, m)).padStart(2, '0')}`
}
