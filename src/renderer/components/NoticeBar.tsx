import { useState, type JSX } from 'react'
import type { AppState } from '../useAppState'

/**
 * 顶部提示条。
 *
 * 一次只显示一条 —— 两条提示条会把看板顶下去一截，而这些提示（写盘失败、
 * 数据损坏、通知发不出去）都不是要用户马上处理的事。多条时给一个「还有 N 条」，
 * 点一下换下一条（滚动查看比堆叠更省纵向空间）。
 */
export function NoticeBar({ state }: { state: AppState }): JSX.Element | null {
  const [offset, setOffset] = useState(0)
  const notices = state.snapshot?.runtime.notices ?? []
  if (notices.length === 0) return null

  const notice = notices[offset % notices.length]

  return (
    <div className={notice.level === 'error' ? 'noticebar noticebar--error' : 'noticebar'}>
      <span className="noticebar__text">{notice.text}</span>
      {notice.action !== undefined && (
        <button
          type="button"
          className="noticebar__action"
          onClick={() => void window.todo.window(notice.action!.windowAction)}
        >
          {notice.action.label}
        </button>
      )}
      {notices.length > 1 && (
        <button
          type="button"
          className="noticebar__more"
          onClick={() => setOffset((o) => o + 1)}
        >
          还有 {notices.length - 1} 条
        </button>
      )}
      <button
        type="button"
        className="noticebar__close"
        aria-label="这条不再提示"
        onClick={() => state.dismissNotice(notice.id)}
      >
        ×
      </button>
    </div>
  )
}
