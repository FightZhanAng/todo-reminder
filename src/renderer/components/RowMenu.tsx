import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'

export interface MenuItem {
  label: string
  danger?: boolean
  onSelect: () => void
}

export interface RowMenuProps {
  items: MenuItem[]
  /** 期望的落点（一般是 ⋮ 按钮的右下角），会在窗口内自动收边 */
  anchor: { x: number; y: number }
  /** 触发按钮（一般是 ⋮）。点它不算「外部」，用于 toggle 关闭（Minor 4） */
  anchorEl?: HTMLElement | null
  onClose: () => void
}

/**
 * 自绘的 popover 菜单，不用 Electron 的原生 Menu。
 *
 * 原生菜单在 Windows 上无法跟随应用的亮/暗主题 —— 在一个安静的浅色界面里
 * 弹出一块系统灰，比省下这 60 行代码糟糕得多（规格 §6.5）。
 *
 * 用 position: fixed 而不是 absolute：列表容器有 overflow-y: auto，
 * absolute 的菜单会被裁掉。
 */
export function RowMenu({ items, anchor, anchorEl, onClose }: RowMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y, visible: false })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 6
    // 右边/下边放不下就翻到锚点的左上，再夹进窗口
    const x = Math.max(margin, Math.min(anchor.x - width, window.innerWidth - width - margin))
    const y = Math.max(margin, Math.min(anchor.y, window.innerHeight - height - margin))
    setPos({ x, y, visible: true })
    // 打开即聚焦首项：点开后直接按 Enter / Space 就能激活（Important 2 ②），
    // 也方便键盘在菜单内 Tab 移动
    el.querySelector<HTMLButtonElement>('button')?.focus()
  }, [anchor.x, anchor.y])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current) return
      const target = e.target as Node
      // 菜单自身 / 触发按钮（⋮）都不算「外部」——
      // 前者正常，后者用于 toggle（再点一次 ⋮ 关闭，Minor 4）
      if (ref.current.contains(target)) return
      if (anchorEl && anchorEl.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
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
      className="rowmenu"
      role="menu"
      style={{ left: pos.x, top: pos.y, visibility: pos.visible ? 'visible' : 'hidden' }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.danger ? 'rowmenu__item rowmenu__item--danger' : 'rowmenu__item'}
          onClick={() => {
            onClose()
            item.onSelect()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
