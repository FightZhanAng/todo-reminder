import type { JSX } from 'react'
import { Board } from './components/Board'
import { CalendarView } from './components/CalendarView'
import { CountdownView } from './components/CountdownView'
import { DoneView } from './components/DoneView'
import { FutureView } from './components/FutureView'
import { Inbox } from './components/Inbox'
import { NoticeBar } from './components/NoticeBar'
import { SettingsPanel } from './components/SettingsPanel'
import { TaskEditor } from './components/TaskEditor'
import { TitleBar } from './components/TitleBar'
import { useAppState } from './useAppState'

export default function App(): JSX.Element {
  const state = useAppState()

  // 标题带在两个分支里都要有：窗口没有它就不能拖、不能关，而首帧快照还没到的
  // 那段时间窗是开着的。maximized 此刻只能按 false 画 —— 那个 □ 顶多暂时是错的
  const titleBar = <TitleBar maximized={state.snapshot?.runtime.windowMaximized === true} />

  // 首次快照还没到：几条灰骨架，**不转圈** ——
  // 一个常驻小工具的加载态不该有个旋转的动画（规格 §5.1）
  if (state.snapshot === null) {
    return (
      <div className="app">
        {titleBar}
        <div className="app__body">
          <div className="empty">正在读取…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      {titleBar}
      <NoticeBar state={state} />
      {renderView(state)}
      {state.flash !== null && (
        <div className="flash">
          <div
            className={state.flash.tone === 'error' ? 'flash__inner flash__inner--error' : 'flash__inner'}
          >
            {state.flash.text}
          </div>
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
    case 'done':
      return <DoneView state={state} />
    case 'future':
      return <FutureView state={state} />
    case 'calendar':
      return <CalendarView state={state} />
    case 'countdown':
      return <CountdownView state={state} />
    case 'settings':
      return <SettingsPanel state={state} />
    case 'edit':
      return <TaskEditor state={state} view={state.view} />
  }
}
