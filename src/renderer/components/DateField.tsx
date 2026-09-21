import { useRef, useState, type JSX } from 'react'
import {
  CAL_HEADERS,
  dayKeyOf,
  monthGrid,
  monthLabel,
  monthOf,
  nextWeekdayAfter,
  relativeDayLabel,
  shiftMonth,
  tsFromDayKey,
  type MonthRef
} from '@shared/calendar'
import { WEEKDAYS, addDays, dayKey, startOfDay } from '@shared/time'
import { Popover } from './Popover'

export interface DateFieldProps {
  /** 'YYYY-MM-DD' */
  value: string
  onChange: (value: string) => void
  /** 算「今天/明天」用。不传就取当下 */
  now?: number
}

/**
 * 自绘的日期控件，替换原生 `<input type="date">`。
 *
 * 为什么不用原生：那个控件的下拉日历是**操作系统画的**，改不了 —— 浅色界面里
 * 弹一块系统灰、深色界面里那块日历还是亮的（`color-scheme` 只管输入框本身，
 * 管不到弹出的日历）。这个应用里日期是主角，主角不能长着一张别人的脸。
 *
 * 三个部分：一行「9月18日 周五 · 明天」的摘要按钮、一张真月历、三个常用日子。
 * 「今天/明天」这类相对说法单独成块 —— 表单里最常问的问题是「这是哪天」，
 * 而人对「明天」的确定感远高于「9月19日」。
 */
export function DateField({ value, onChange, now = Date.now() }: DateFieldProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<MonthRef>(() => monthOf(tsFromDayKey(value) ?? startOfDay(now)))
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const ts = tsFromDayKey(value) ?? startOfDay(now)
  const d = new Date(ts)
  const rel = relativeDayLabel(ts, now)
  const selectedKey = dayKey(ts)
  const todayKey = dayKey(now)

  const openCal = (): void => {
    // 每次打开都回到「当前值所在的月份」，否则上次翻到别处、这次打开会看不到选中项
    setView(monthOf(ts))
    setOpen(true)
  }

  const pick = (next: number): void => {
    onChange(dayKey(startOfDay(next)))
    setOpen(false)
  }

  const weeks = monthGrid(view.year, view.month1)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={open ? 'datefield datefield--open' : 'datefield'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openCal())}
      >
        <span className="datefield__text">
          {d.getMonth() + 1}月{d.getDate()}日
        </span>
        <span className="datefield__dow">{WEEKDAYS[d.getDay()]}</span>
        {rel !== null && <span className="datefield__rel">{rel}</span>}
        <span className="datefield__caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <Popover anchorEl={btnRef.current} className="popover--cal" onClose={() => setOpen(false)}>
          <div className="cal">
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

            <div className="cal__grid">
              {weeks.flat().map((cell) => {
                const key = dayKeyOf(cell)
                const classes = ['cal__cell']
                if (key === selectedKey) classes.push('cal__cell--on')
                if (key === todayKey) classes.push('cal__cell--today')
                if (!cell.inMonth) classes.push('cal__cell--out')
                return (
                  <button
                    key={key}
                    type="button"
                    className={classes.join(' ')}
                    aria-current={key === todayKey ? 'date' : undefined}
                    onClick={() => pick(cell.ts)}
                  >
                    {cell.day}
                  </button>
                )
              })}
            </div>

            <div className="cal__quick">
              <button type="button" className="cal__chip" onClick={() => pick(now)}>
                今天
              </button>
              <button type="button" className="cal__chip" onClick={() => pick(addDays(now, 1))}>
                明天
              </button>
              <button type="button" className="cal__chip" onClick={() => pick(nextWeekdayAfter(now, 1))}>
                下周一
              </button>
            </div>
          </div>
        </Popover>
      )}
    </>
  )
}
