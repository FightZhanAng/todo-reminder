import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Command, TaskKind } from '@shared/commands'
import { mergeExiting, type ExitingEntry, type ExitKind } from '@shared/exit'
import type { NoticeId, Snapshot } from '@shared/ipc'
import type { Task } from '@shared/types'

// TaskKind 只从 shared/commands 来（Task 3 的定义），这里不重复 export 一份同名同形的

export type View =
  | { name: 'board' }
  | { name: 'inbox' }
  | { name: 'done' }
  | { name: 'future' }
  | { name: 'calendar' }
  | { name: 'countdown' }
  | { name: 'settings' }
  | {
      name: 'edit'
      id: string | null
      kind: TaskKind
      /**
       * 新建时的预填日期（'YYYY-MM-DD'）。
       *
       * 日历上「在这天记一件」必须把它带上 —— 不带的后果不是少填一个字段，
       * 而是**记到了今天**：用户在 10 月 8 日那格点了加号，回头在今天的看板上
       * 找那件事，而它其实是 10 月 8 日的。
       */
      dueDay?: string
      /** 从哪儿进来的。取消与保存都回那儿，而不是一律回看板 */
      from?: 'board' | 'calendar'
    }

/**
 * 一闪而过的居中提示。
 *
 * 带色调是因为视觉语言里「红」只有一个意思（已经晚了 / 出错），
 * 而「这次操作没成功」正属于那一类 —— 它不该和「已记下」长成同一颗墨色药丸。
 */
export type FlashTone = 'ok' | 'error'

export interface Flash {
  text: string
  tone: FlashTone
}

export interface AppState {
  /** null = 首次快照还没到 */
  snapshot: Snapshot | null
  /** 快照里的任务与退场行合并后的列表（渲染层一律用这个） */
  tasks: Task[]
  /** 「现在」。粒度按需要给（看板是分钟级、有退场行时是秒级），见 useNow */
  now: number
  exiting: ExitingEntry[]
  view: View
  flash: Flash | null
  /** 从通知点进来要聚焦的任务；Board 用它滚动并高亮 */
  focusTaskId: string | null
  go: (view: View) => void
  run: (cmd: Command) => Promise<void>
  /** 完成：登记 done 退场后再发命令 */
  complete: (task: Task) => void
  /** 取消完成（已完成清单里点勾）。同样先登记退场，让行淡出而不是当场消失 */
  uncomplete: (task: Task) => void
  /** 删除：登记 removed 退场后再发命令 */
  remove: (task: Task) => void
  /** 撤销删除 */
  undoRemove: (id: string) => void
  /** 退场动画播完 / 5 秒到期时由调用方回调 */
  settle: (ids: string[]) => void
  setFlash: (text: string | null, tone?: FlashTone) => void
  dismissNotice: (id: NoticeId) => void
}

export function useAppState(): AppState {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [exiting, setExiting] = useState<ExitingEntry[]>([])
  const [view, setView] = useState<View>({ name: 'board' })
  const [flash, setFlash] = useState<Flash | null>(null)
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

  // 托盘菜单切视图。与上面那条的区别：通知点击是「去看某条任务」，
  // 这条是用户在主窗口外面明确点了「设置」或「收件箱」
  useEffect(
    () =>
      window.todo.onOpenView((view) => {
        setView(
          view === 'settings'
            ? { name: 'settings' }
            : view === 'inbox'
              ? { name: 'inbox' }
              : view === 'calendar'
                ? { name: 'calendar' }
                : view === 'countdown'
                  ? { name: 'countdown' }
                  : { name: 'board' }
        )
      }),
    []
  )

  // 时钟的粒度按**谁在用它**给，不一律每秒：
  //   - 有退场行时要判 520ms 的到期（exit.ts），必须亚秒级；
  //   - 看板与编辑器用到 now 的只有顶栏那个 HH:mm、urgencyOf 的「快到了」
  //     （1 小时窗口）、跨零点换日和编辑器里那句「接下来」—— 全是分钟级。
  // 原来一律每秒一次，等于让整个看板以 60 倍于所需的频率重算重画。
  // 编辑器也要走时钟：它的「接下来」按今天算，停在那里过夜得能翻到新的一天。
  // 日历与倒计时同样只要分钟级，而且**必须**有：它们各自拿 now 算
  // 「哪个格子是今天」「离那天还有几天」，跨零点得当场翻页。
  const clockMode: ClockMode =
    exiting.length > 0
      ? 'second'
      : view.name === 'board' ||
          view.name === 'edit' ||
          view.name === 'calendar' ||
          view.name === 'countdown'
        ? 'minute'
        : 'off'
  const now = useNow(clockMode)

  // 快照里那条任务还在（完成只写了 completedAt），所以这里是把退场行
  // **替换回变更前的版本**，groupToday 才能把它放回原来的段与原位置。
  const rawTasks = snapshot?.tasks ?? EMPTY_TASKS
  const merged = useMemo(() => mergeExiting(rawTasks, exiting, now), [rawTasks, exiting, now])

  // mergeExiting 没有退场行时返回入参本身，所以这里通常就是 rawTasks 的引用
  const expiredKey = merged.expired.join(',')
  // 稳定引用是硬要求：TaskRow 把它交给 StrikeLine 的 520ms 定时器当依赖，
  // 换一次引用定时器就被重置一次。`setExiting` 本身稳定，所以不必再绕一个 ref ——
  // 原来那版在渲染期给 ref 赋值（React 不允许的副作用），换来的稳定性这里本来就有。
  const settle = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    const drop = new Set(ids)
    setExiting((prev) => {
      const next = prev.filter((e) => !drop.has(e.task.id))
      return next.length === prev.length ? prev : next
    })
  }, [])

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
  //
  // 编辑器是唯一有「上级」的视图：从日历点「在这天记一件」进来的，
  // Esc 必须和那颗「取消」按钮走同一条路（回日历），否则两个出口互相矛盾 ——
  // 而用户按 Esc 的时机，往往正是他看清日期填错、想回那张月历的时候。
  // 浮层（Popover）在捕获阶段自己先拦，走不到这里。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setView((v) => {
        if (v.name === 'board') return v
        if (v.name === 'edit' && v.from === 'calendar') return { name: 'calendar' }
        return { name: 'board' }
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const setFlashText = useCallback((text: string | null, tone: FlashTone = 'ok') => {
    setFlash(text === null ? null : { text, tone })
  }, [])

  /**
   * 命令的唯一出口。
   *
   * 主进程那边的**写盘**失败有自己的提示条（`write-failed`），但**通道本身**
   * 失败（handler 抛了、窗口正在销毁）没有归宿 —— 而调用方一律写成
   * `void run(...)`，于是它变成静默的 unhandled rejection：界面不动，也不说
   * 为什么。这里兜住并给一句人话。
   */
  const run = useCallback(
    async (cmd: Command) => {
      try {
        setSnapshot(await window.todo.command(cmd))
      } catch (err) {
        console.error('[app] 命令执行失败：', err)
        setFlashText('这次没成功，再试一次', 'error')
      }
    },
    [setFlashText]
  )

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

  // 取消完成也走 'done' 退场：这一行同样要「淡出并被移出」，而不是当场消失。
  // 借的是同一段 520ms 动画的**时长与观感**，语义上它是「离开这本账」——
  // 看板上的完成是离开看板，这里是离开账本，两边都是「这一行要走」。
  //
  // 这里比 complete 多一句 flash：行淡出之后用户会问「它去哪儿了」，
  // 而「它现在回看板了」是这本账唯一需要额外解释的一件事
  const uncomplete = useCallback(
    (task: Task) => {
      pushExit(task, 'done')
      setFlashText('已收回今天')
      void run({ type: 'task:uncomplete', id: task.id })
    },
    [pushExit, run, setFlashText]
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

  // 关提示条失败不必打扰用户（提示条本来就还在，重试一次就行），
  // 但也不能让它变成 unhandled rejection —— 那在控制台里长得像崩溃
  const dismissNotice = useCallback((id: NoticeId) => {
    window.todo
      .dismissNotice(id)
      .then(setSnapshot)
      .catch((err: unknown) => console.error('[app] 关闭提示条失败：', err))
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
    uncomplete,
    remove,
    undoRemove,
    settle,
    setFlash: setFlashText,
    dismissNotice
  }
}

const EMPTY_TASKS: Task[] = []

type ClockMode = 'off' | 'second' | 'minute'

/**
 * 「现在」。粒度由调用方算 —— 一个会重建整棵树的定时器该被明确开和关。
 *
 * `minute` 档**对齐到整分**，不是从挂载时刻起算 60 秒：后者在 12:01:00 时
 * 界面还停在 12:00（最多慢 59 秒），跨零点换日也会同样晚一步。
 * 对齐之后这两件事都正好落在整点上。
 */
function useNow(mode: ClockMode): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (mode === 'off') return
    // 从 off 切进来时先把 now 拉回当下 —— 否则可能拿着一分钟前的值直接渲染
    setNow(Date.now())

    let timer: ReturnType<typeof setTimeout>
    const step = (): void => {
      const t = Date.now()
      setNow(t)
      timer = setTimeout(step, mode === 'second' ? 1000 : msUntilNextMinute(t))
    }
    timer = setTimeout(step, mode === 'second' ? 1000 : msUntilNextMinute(Date.now()))
    return () => clearTimeout(timer)
  }, [mode])

  return now
}

/** 距离下一个整分还有多少毫秒。本地时区偏移都是整分钟，所以按 UTC 取模也对齐 */
function msUntilNextMinute(ts: number): number {
  return 60_000 - (ts % 60_000)
}
