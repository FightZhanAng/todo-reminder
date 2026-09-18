import type { JSX } from 'react'
import { Board } from './components/Board'
import { Inbox } from './components/Inbox'
import { NoticeBar } from './components/NoticeBar'
import { SettingsPanel } from './components/SettingsPanel'
import { TaskEditor } from './components/TaskEditor'
import { useAppState } from './useAppState'

export default function App(): JSX.Element {
  const state = useAppState()

  // 首次快照还没到：几条灰骨架，**不转圈** ——
  // 一个常驻小工具的加载态不该有个旋转的动画（规格 §5.1）
  if (state.snapshot === null) {
    return (
      <div className="app">
        <div className="app__body">
          <div className="empty">正在读取…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <NoticeBar state={state} />
      {renderView(state)}
      {state.flash !== null && (
        <div className="flash">
          <div className="flash__inner">{state.flash}</div>
        </div>
      )}
    </div>
  )
}

function renderView(state: ReturnType<typeof useAppState>): JSX.Element {
  switch (state.view.name) {
    case 'board':
      return <Board state={state} />
    case 'inbox':
      return <Inbox state={state} />
    case 'settings':
      return <SettingsPanel state={state} />
    case 'edit':
      return <TaskEditor state={state} view={state.view} />
  }
}
