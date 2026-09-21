import { useMemo, useRef, useState, type JSX } from 'react'
import { parseHM } from '@shared/time'
import { Popover } from './Popover'

export interface TimeFieldProps {
  /** 'HH:mm' */
  value: string
  onChange: (value: string) => void
  /** 读屏用的名字。控件本身只显示时刻，不带上下文 */
  label?: string
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

/**
 * 自绘的时间控件，替换原生 `<input type="time">`。
 *
 * 原生那个的上下箭头在浅色界面里是两块系统灰，且**点一下要按滚动步长一格一格
 * 挪**——选 18:30 得按十几次。这里直接摆出 24 个小时和 12 个分钟档，
 * 两下点完，中间不需要键盘。
 *
 * 分钟按 5 分钟一档：提醒类应用不需要 1 分钟的精度，摆 60 个格子只会让人
 * 挑花眼。但**当前值不在档上时要把它补进去** —— 否则改一条 18:33 的旧任务，
 * 打开控件会看到没有一个格子是选中的。
 */
export function TimeField({ value, onChange, label }: TimeFieldProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  const { h, m } = parseHM(value)

  const minutes = useMemo(() => {
    const steps = Array.from({ length: 12 }, (_, i) => i * 5)
    return steps.includes(m) ? steps : [...steps, m].sort((a, b) => a - b)
  }, [m])

  const set = (nextH: number, nextM: number): void => {
    onChange(`${String(nextH).padStart(2, '0')}:${String(nextM).padStart(2, '0')}`)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={open ? 'timefield timefield--open' : 'timefield'}
        aria-label={label === undefined ? `时刻 ${value}` : `${label} ${value}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="mono">{value}</span>
      </button>

      {open && (
        <Popover anchorEl={btnRef.current} className="popover--time" onClose={() => setOpen(false)}>
          <div className="timepick">
            <div className="timepick__col">
              <div className="timepick__label">时</div>
              <div className="timepick__grid timepick__grid--h">
                {HOURS.map((x) => (
                  <button
                    key={x}
                    type="button"
                    className={x === h ? 'timepick__cell timepick__cell--on' : 'timepick__cell'}
                    onClick={() => set(x, m)}
                  >
                    {String(x).padStart(2, '0')}
                  </button>
                ))}
              </div>
            </div>
            <div className="timepick__col">
              <div className="timepick__label">分</div>
              <div className="timepick__grid timepick__grid--m">
                {minutes.map((x) => (
                  <button
                    key={x}
                    type="button"
                    className={x === m ? 'timepick__cell timepick__cell--on' : 'timepick__cell'}
                    onClick={() => set(h, x)}
                  >
                    {String(x).padStart(2, '0')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Popover>
      )}
    </>
  )
}
