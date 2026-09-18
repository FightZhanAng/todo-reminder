import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Command, TaskKind } from '@shared/commands'
import { mergeExiting, type ExitingEntry, type ExitKind } from '@shared/exit'
import type { NoticeId, Snapshot } from '@shared/ipc'
import type { Task } from '@shared/types'

// TaskKind 只从 shared/commands 来（Task 3 的定义），这里不重复 export 一份同名同形的

export type View =
  | { name: 'board' }
  | { name: 'inbox' }
  | { name: 'settings' }
  | { name: 'edit'; id: string | null; kind: TaskKind }

export interface AppState {
  /** null = 首次快照还没到 */
  snapshot: Snapshot | null
  /** 快照里的任务与退场行合并后的列表（渲染层一律用这个） */
  tasks: Task[]
  /** 每秒走一次的「现在」。相对时间与紧迫度都用它 */
  now: number
  exiting: ExitingEntry[]
  view: View
  flash: string | null
  /** 从通知点进来要聚焦的任务；Board 用它滚动并高亮 */
  focusTaskId: string | null
  go: (view: View) => void
  run: (cmd: Command) => Promise<void>
  /** 完成：登记 done 退场后再发命令 */
  complete: (task: Task) => void
  /** 删除：登记 removed 退场后再发命令 */
  remove: (task: Task) => void
  /** 撤销删除 */
  undoRemove: (id: string) => void
  /** 退场动画播完 / 5 秒到期时由调用方回调 */
  settle: (ids: string[]) => void
  setFlash: (text: string | null) => void
  dismissNotice: (id: NoticeId) => void
}

export function useAppState(): AppState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [exiting, setExiting] = useState<ExitingEntry[]>([])
  const [view, setView] = useState<View>({ name: 'board' })
  const [flash, setFlash] = useState<string | null>(null)
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null)

  // 订阅。React 严格模式下会双挂载，清理函数里必须真的取消订阅，
  // 否则会出现两份 listener、一次广播触发两次 setState。
  useEffect(() => window.todo.onSnapshot(setSnapshot), [])

  // 通知点击：唤起到看板并聚焦那条任务。
  // **不切到收件箱** —— 一条清单池任务点不出来却把用户送到另一个视图，
  // 比安静地什么都不做更让人困惑（规格 §6.7）。
  useEffect(
    () =>
      window.todo.onFocusTask((taskId) => {
        setView((v) => (v.name === 'inbox' ? v : { name: 'board' }))
        setFocusTaskId(taskId)
      }),
    []
  )

  // 有退场行、或停在看板上时，每秒走一次时钟。
  // 由这里统一算，不让每个组件各开一个每秒定时器 —— 同一件事做两遍。
  const clockOn = view.name === 'board' || exiting.length > 0
  const now = useNow(clockOn)

  // 快照里那条任务还在（完成只写了 completedAt），所以这里是把退场行
  // **替换回变更前的版本**，groupToday 才能把它放回原来的段与原位置。
  const rawTasks = snapshot?.tasks ?? EMPTY_TASKS
  const merged = useMemo(() => mergeExiting(rawTasks, exiting, now), [rawTasks, exiting, now])

  // mergeExiting 每次返回新数组，所以用字符串做依赖键
  const expiredKey = merged.expired.join(',')
  const settleRef = useRef<((ids: string[]) => void) | null>(null)
  settleRef.current = (ids: string[]) => {
    if (ids.length === 0) return
    const drop = new Set(ids)
    setExiting((prev) => prev.filter((e) => !drop.has(e.task.id)))
  }
  const settle = useCallback((ids: string[]) => settleRef.current?.(ids), [])

  useEffect(() => {
    if (expiredKey === '') return
    setExiting((prev) => {
      const drop = new Set(expiredKey.split(','))
      const next = prev.filter((e) => !drop.has(e.task.id))
      return next.length === prev.length ? prev : next
    })
  }, [expiredKey])

  // flash 的自动消失
  useEffect(() => {
    if (flash === null) return
    const timer = setTimeout(() => setFlash(null), 2500)
    return () => clearTimeout(timer)
  }, [flash])

  // Esc 逐级返回。看板根层级**不做任何事** —— 一个常驻托盘应用里
  // Esc 把窗口藏起来很容易误触，而托盘图标就在旁边，隐藏不缺入口。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setView((v) => (v.name === 'board' ? v : { name: 'board' }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const run = useCallback(async (cmd: Command) => {
    const next = await window.todo.command(cmd)
    setSnapshot(next)
  }, [])

  const pushExit = useCallback((task: Task, kind: ExitKind) => {
    setExiting((prev) => {
      if (prev.some((e) => e.task.id === task.id)) return prev
      return [...prev, { task, kind, startedAt: Date.now() }]
    })
  }, [])

  const complete = useCallback(
    (task: Task) => {
      pushExit(task, 'done')
      void run({ type: 'task:complete', id: task.id })
    },
    [pushExit, run]
  )

  const remove = useCallback(
    (task: Task) => {
      pushExit(task, 'removed')
      void run({ type: 'task:remove', id: task.id })
    },
    [pushExit, run]
  )

  const undoRemove = useCallback(
    (id: string) => {
      setExiting((prev) => prev.filter((e) => e.task.id !== id))
      void run({ type: 'task:restore', id })
    },
    [run]
  )

  const dismissNotice = useCallback((id: NoticeId) => {
    void window.todo.dismissNotice(id).then(setSnapshot)
  }, [])

  return {
    snapshot,
    tasks: merged.tasks,
    now,
    exiting,
    view,
    flash,
    focusTaskId,
    go: setView,
    run,
    complete,
    remove,
    undoRemove,
    settle,
    setFlash,
    dismissNotice
  }
}

const EMPTY_TASKS: Task[] = []

/** 每秒的「现在」。enabled 由调用方算 —— 一个每秒重建整棵树的定时器该被明确开和关 */
function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [enabled])
  return now
}
