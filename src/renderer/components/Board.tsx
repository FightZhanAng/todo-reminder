import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { WEEKDAYS, formatClock } from '@shared/time'
import { groupToday, type TodayGroups } from '@shared/group'
import type { Task } from '@shared/types'
import { SectionList, type SectionName } from './SectionList'
import type { AppState } from '../useAppState'

interface FlatRow {
  id: string
  section: SectionName
}

// `section` 的类型必须是 `keyof TodayGroups` 而不是 `SectionName` ——
// SectionName 里还有 'inbox'，而 TodayGroups 只有四段，用 SectionName 索引
// `groups` 在 strict 下会报 TS7053。四段的名字与顺序以 shared/group.ts 为准
// （overdue / upcoming / anytime / recurring，顺序即展示顺序）。
const SECTIONS: { section: keyof TodayGroups; label: string }[] = [
  { section: 'overdue', label: '逾期' },
  { section: 'upcoming', label: '接下来' },
  { section: 'anytime', label: '今天随时' },
  { section: 'recurring', label: '每天' }
]

export function Board({ state }: { state: AppState }): JSX.Element {
  const { tasks, now, snapshot, focusTaskId } = state
  const groups = useMemo(
    () => groupToday([...tasks], now),
    [tasks, now]
  )

  // 跨段连续的一维行序列 —— 键盘游标用它，所以它不能是"每段一个游标"
  const flat = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = []
    for (const { section } of SECTIONS) {
      for (const task of groups[section]) rows.push({ id: task.id, section })
    }
    return rows
  }, [groups])

  const [cursor, setCursor] = useState(0)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  // 列表变短时把游标夹回范围内
  useEffect(() => {
    setCursor((c) => (c >= flat.length ? Math.max(0, flat.length - 1) : c))
  }, [flat.length])

  // 从通知点进来：滚进视野 + 2 秒高亮。找不到就什么都不做（规格 §6.7）
  useEffect(() => {
    if (focusTaskId === null) return
    const el = document.querySelector(`[data-task-id="${CSS.escape(focusTaskId)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setHighlightId(focusTaskId)
    const timer = setTimeout(() => setHighlightId(null), 2000)
    return () => clearTimeout(timer)
  }, [focusTaskId])

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const current = flat[cursor]

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setCursor((c) => Math.min(c + 1, flat.length - 1))
          return
        case 'ArrowUp':
          e.preventDefault()
          setCursor((c) => Math.max(c - 1, 0))
          return
        case 'Escape':
          // 看板根层级不做任何事（规格 §6.6）。useAppState 里已经吞掉
          // "返回上一级"，这里不再插手
          return
        case '+':
        case 'n':
        case 'N':
          e.preventDefault()
          state.go({ name: 'edit', id: null, kind: 'deadline' })
          return
      }

      if (!current) return
      const task = tasks.find((t) => t.id === current.id)
      if (!task) return

      switch (e.key) {
        case 'Enter':
          e.preventDefault()
          state.complete(task)
          return
        case 'Backspace':
          e.preventDefault()
          state.remove(task)
          return
        case 's':
        case 'S':
          e.preventDefault()
          void state.run({
            type: 'task:snooze',
            id: task.id,
            minutes: snapshot!.settings.snoozeMinutes
          })
          return
        case 't':
        case 'T':
          e.preventDefault()
          void state.run({ type: 'task:postpone', id: task.id })
          return
      }
    },
    [cursor, flat, tasks, state, snapshot]
  )

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  const total = flat.length
  const cursorId = flat[cursor]?.id ?? null

  return (
    <>
      <TopBar state={state} />
      <div className="app__body">
        {total === 0 ? (
          <div className="empty">
            今天的事都办完了
            <div className="empty__hint">「+」记一件新的事</div>
          </div>
        ) : (
          SECTIONS.map(({ section, label }) => (
            <SectionList
              key={section}
              label={label}
              section={section}
              tasks={groups[section]}
              state={state}
              cursorId={cursorId}
              highlightId={highlightId}
            />
          ))
        )}
      </div>
      <BottomBar state={state} />
    </>
  )
}

/** 顶栏：左侧「今天 · 9月18日 周五」，右侧新建 */
function TopBar({ state }: { state: AppState }): JSX.Element {
  return (
    <header className="topbar">
      <h1 className="topbar__title">
        今天
        <span className="topbar__date">{formatHeaderDate(state.now)}</span>
      </h1>
      <div className="topbar__actions">
        <button
          type="button"
          className="iconbutton"
          aria-label="新建任务"
          onClick={() => state.go({ name: 'edit', id: null, kind: 'deadline' })}
        >
          +
        </button>
      </div>
    </header>
  )
}

/** 底栏：左侧收件箱入口，右侧提醒状态（规格 §6.1） */
function BottomBar({ state }: { state: AppState }): JSX.Element {
  const snapshot = state.snapshot!
  const inboxCount = snapshot.tasks.filter((t) => t.kind === 'someday' && t.deletedAt === null).length
  const paused = snapshot.runtime.pausedUntil

  // 关了通知优先说「已关闭」—— 关了就不会响，比暂停更值得说
  const notifyOff = !snapshot.settings.notifyEnabled

  return (
    <footer className="bottombar">
      <button type="button" className="bottombar__link" onClick={() => state.go({ name: 'inbox' })}>
        收件箱 · {inboxCount} 件
      </button>
      {notifyOff ? (
        <button
          type="button"
          className="bottombar__state bottombar__state--off"
          onClick={() => state.go({ name: 'settings' })}
        >
          提醒已关闭
        </button>
      ) : paused !== null ? (
        <button
          type="button"
          className="bottombar__state"
          onClick={() => void window.todo.pause(null)}
        >
          提醒已暂停至 {formatClock(paused)} · 恢复
        </button>
      ) : null}
    </footer>
  )
}

// WEEKDAYS 来自 shared/time.ts（上面刚新增），本文件不再自定义一份

function formatHeaderDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
}
