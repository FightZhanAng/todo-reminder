import type { JSX } from 'react'
import { SectionList } from './SectionList'
import type { AppState } from '../useAppState'

/**
 * 收件箱 = 清单池（someday）的全集。
 *
 * 用 SectionList 而不是自己写一遍行渲染：那边「不渲染时刻列」的分支
 * （section === 'inbox'）本来就是给这里留的。
 */
export function Inbox({ state }: { state: AppState }): JSX.Element {
  const list = state.tasks
    .filter((t) => t.kind === 'someday' && t.deletedAt === null)
    // 刚记下的在最上面。store 里是追加序，反一下就是「最近记的在前」
    .sort((a, b) => b.createdAt - a.createdAt)

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
            收件箱
            <span className="topbar__date">{list.length} 件</span>
          </h1>
        </div>
        <div className="topbar__actions">
          <button
            type="button"
            className="iconbutton"
            aria-label="记一件还没定时间的事"
            onClick={() => state.go({ name: 'edit', id: null, kind: 'someday' })}
          >
            +
          </button>
        </div>
      </header>

      <div className="app__body">
        {list.length === 0 ? (
          <div className="empty">
            收件箱是空的
            <div className="empty__hint">还没想好什么时候做的事，先记在这儿</div>
          </div>
        ) : (
          <SectionList
            label="清单池"
            section="inbox"
            tasks={list}
            state={state}
            cursorId={null}
            highlightId={null}
          />
        )}
      </div>

      <footer className="bottombar">
        <span className="bottombar__state">「今天做」把它挪进今天</span>
      </footer>
    </>
  )
}
