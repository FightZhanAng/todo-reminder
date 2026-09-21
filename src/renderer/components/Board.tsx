import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { CN_MONTHS } from '@shared/calendar'
import { doneCount } from '@shared/done'
import { WEEKDAYS, formatClock } from '@shared/time'
import { groupToday, type TodayGroups } from '@shared/group'
import type { Task } from '@shared/types'
import { SectionList, type SectionName } from './SectionList'
import type { AppState } from '../useAppState'
import { useDarkMode } from '../useDarkMode'

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

/** 月份写成汉字（CN_MONTHS）在 shared/calendar.ts —— 日历控件也用同一份 */

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
  // 是否有行内菜单打开（某行 ⋮ 展开的 RowMenu）。菜单打开时挂起看板快捷键（Important 2）
  const [menuOpen, setMenuOpen] = useState(false)

  // 列表变短时把游标夹回范围内（上下界都夹住，避免空列表按 ↓ 留下 -1，Minor 3）
  useEffect(() => {
    setCursor((c) => (c < 0 ? 0 : c >= flat.length ? Math.max(0, flat.length - 1) : c))
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
      // 菜单打开时挂起看板全局快捷键：Enter/Backspace/s/t 不能改到游标行，
      // 方向键不能乱动看板游标（Important 2）。Esc 由 RowMenu 接管关闭
      if (menuOpen) return
      if (isTypingTarget(e.target)) return
      const current = flat[cursor]

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          // 下界夹 0：空列表按 ↓ 也只能是 0，不会变 -1（Minor 3）
          setCursor((c) => Math.max(0, Math.min(c + 1, flat.length - 1)))
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
    [cursor, flat, tasks, state, snapshot, menuOpen]
  )

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  const total = flat.length
  const cursorId = flat[cursor]?.id ?? null

  return (
    <>
      <Head state={state} remaining={total} overdue={groups.overdue.length} />
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
              onMenuOpenChange={setMenuOpen}
            />
          ))
        )}
      </div>
      <BottomBar state={state} />
    </>
  )
}

/**
 * 顶栏。整张界面唯一的主角是**今天这个日子**，所以它拿到最大的字号：
 * 「九月」是一枚宽字距的小标签，「18」是 30px 的宋体，周五缀在基线右侧。
 *
 * 第二行是一条账目式的状态：现在几点 · 还剩几件 · 逾期几件。
 * 「还剩 0 件」这一档不出现 —— 那句话说在空状态的大字里更合适。
 */
function Head({
  state,
  remaining,
  overdue
}: {
  state: AppState
  remaining: number
  overdue: number
}): JSX.Element {
  const d = new Date(state.now)
  const dark = useDarkMode()

  return (
    <header className="head">
      <div className="head__main">
        <h1 className="dateline">
          <span className="dateline__month">{CN_MONTHS[d.getMonth()]}</span>
          <span className="dateline__day">{d.getDate()}</span>
          <span className="dateline__dow">{WEEKDAYS[d.getDay()]}</span>
        </h1>
        <div className="head__actions">
          {/* 图标画的是「点下去会变成什么」，不是「现在是什么」——
              和系统里那一排开关一致，不用先想一下再点 */}
          <button
            type="button"
            className="iconbutton"
            aria-label={dark ? '切到浅色' : '切到深色'}
            title={dark ? '切到浅色' : '切到深色'}
            onClick={() =>
              void state.run({
                type: 'settings:patch',
                patch: { theme: dark ? 'light' : 'dark' }
              })
            }
          >
            {dark ? <SunGlyph /> : <MoonGlyph />}
          </button>
          <button
            type="button"
            className="iconbutton iconbutton--solid"
            aria-label="新建任务"
            title="新建（N）"
            onClick={() => state.go({ name: 'edit', id: null, kind: 'deadline' })}
          >
            +
          </button>
        </div>
      </div>

      <div className="head__status">
        <span className="head__clock">{formatClock(state.now)}</span>
        {remaining > 0 && (
          <>
            <span className="head__sep">·</span>
            <span>还剩 {remaining} 件</span>
          </>
        )}
        {overdue > 0 && <span className="head__late">逾期 {overdue}</span>}
      </div>
    </header>
  )
}

/* 两个图标自绘。用 currentColor 描边，所以 hover 变色、深浅主题都自动跟上 */

function SunGlyph(): JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <line x1="8" y1="0.9" x2="8" y2="2.9" />
        <line x1="8" y1="13.1" x2="8" y2="15.1" />
        <line x1="0.9" y1="8" x2="2.9" y2="8" />
        <line x1="13.1" y1="8" x2="15.1" y2="8" />
        <line x1="2.98" y1="2.98" x2="4.4" y2="4.4" />
        <line x1="11.6" y1="11.6" x2="13.02" y2="13.02" />
        <line x1="13.02" y1="2.98" x2="11.6" y2="4.4" />
        <line x1="4.4" y1="11.6" x2="2.98" y2="13.02" />
      </g>
    </svg>
  )
}

function MoonGlyph(): JSX.Element {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      {/* 24 格上的标准月牙，缩到 16 格用：1.4 的线宽 = 2.1 × 0.6667 */}
      <g transform="scale(0.6667)">
        <path
          d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}

/** 底栏：左侧两个账本入口（今天 / 已完成 / 收件箱），右侧提醒状态（规格 §6.1） */
function BottomBar({ state }: { state: AppState }): JSX.Element {
  const snapshot = state.snapshot!
  const inboxCount = snapshot.tasks.filter((t) => t.kind === 'someday' && t.deletedAt === null).length
  const doneTotal = doneCount(snapshot.tasks)
  const paused = snapshot.runtime.pausedUntil

  // 关了通知优先说「已关闭」—— 关了就不会响，比暂停更值得说
  const notifyOff = !snapshot.settings.notifyEnabled

  return (
    <footer className="bottombar">
      {/* 两个入口都常驻显示，计数为 0 也不藏 —— 一个会消失的导航入口
          比一个「已完成 · 0 件」更难找 */}
      <div className="bottombar__links">
        <button type="button" className="bottombar__link" onClick={() => state.go({ name: 'inbox' })}>
          收件箱 · {inboxCount} 件
        </button>
        <button type="button" className="bottombar__link" onClick={() => state.go({ name: 'done' })}>
          已完成 · {doneTotal} 件
        </button>
      </div>
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

// WEEKDAYS 来自 shared/time.ts，本文件不再自定义一份

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  )
}
