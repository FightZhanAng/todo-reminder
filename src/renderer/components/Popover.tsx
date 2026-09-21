import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'

export interface PopoverProps {
  /** 挂靠的触发元素。点它不算「外部」，用于 toggle 关闭 */
  anchorEl: HTMLElement | null
  onClose: () => void
  /** 附加类名，用来给具体控件（日历 / 时间轮）加样式 */
  className?: string
  children: ReactNode
}

/**
 * 挂在某个按钮下方的浮层。日期控件与时间控件共用。
 *
 * 三个刻意的选择：
 *
 * 1. **position: fixed**，不是 absolute。编辑器的正文在 `.page__body` 里滚动，
 *    absolute 的浮层会被那个容器的 `overflow-y: auto` 裁掉（RowMenu 也是这个理由）。
 * 2. **先渲染再量**，量完才 `visibility: visible`。宽度不确定就没法预先算位置；
 *    用 visibility 而不是 display:none 是因为前者仍然可测量。
 * 3. 位置在 `useLayoutEffect` 里算，且**在滚动与缩放时重算** —— 否则浮层会留在
 *    原地而触发按钮滚走了，看起来像浮层被剪断。
 */
export function Popover({ anchorEl, onClose, className, children }: PopoverProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ left: -9999, top: -9999, visible: false })

  useLayoutEffect(() => {
    const place = (): void => {
      const el = ref.current
      if (!el || !anchorEl) return
      const a = anchorEl.getBoundingClientRect()
      const { width, height } = el.getBoundingClientRect()
      const margin = 8
      const gap = 6
      const left = Math.max(margin, Math.min(a.left, window.innerWidth - width - margin))
      const below = a.bottom + gap
      // 下面放不下就翻到上方；上方也放不下（窗口很矮）就贴着下边缘
      const top =
        below + height + margin <= window.innerHeight
          ? below
          : Math.max(margin, Math.min(a.top - height - gap, window.innerHeight - height - margin))
      setPos({ left, top, visible: true })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchorEl])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (anchorEl?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // 捕获阶段拦下并掐断传播：useAppState 里那个「Esc 逐级返回」挂在 window 的
      // 冒泡阶段，不掐的话关浮层会顺带把用户弹回看板（RowMenu 同款处理）
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose, anchorEl])

  return (
    <div
      ref={ref}
      className={className === undefined ? 'popover' : `popover ${className}`}
      style={{ left: pos.left, top: pos.top, visibility: pos.visible ? 'visible' : 'hidden' }}
    >
      {children}
    </div>
  )
}
