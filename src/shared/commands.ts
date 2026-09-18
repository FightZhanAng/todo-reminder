import { actionPatch, type TaskAction } from './actions'
import { atTimeOfDay, startOfDay } from './time'
import type {
  DeadlineTask, RecurrenceRule, RecurringTask, Settings, SomedayTask, Task, TaskPatch
} from './types'

export type TaskKind = 'deadline' | 'recurring' | 'someday'

/**
 * 编辑器与快速添加窗提交的形状。
 *
 * **不含**时间戳与派生字段（id / createdAt / updatedAt / firedFor…）——
 * 那些由 `buildTask` 决定。尤其不传 `dueAt`：渲染层手里是「日期控件的值」和
 * 「时刻控件的值」两个东西，让它自己拼时间戳等于把「全天任务的 dueAt 必须落在
 * 当天 00:00」这条约定复制到渲染层，两份约定迟早不一致。
 */
export type TaskDraft =
  | {
      kind: 'deadline'
      title: string
      note?: string
      important: boolean
      /** 那一天的 00:00，来自渲染层的日期控件 */
      dueDay: number
      allDay: boolean
      /** 'HH:mm'，allDay 为 true 时省略 */
      time?: string
      /** 省略时取 settings.defaultLeadMin */
      leadMin?: number
    }
  | {
      kind: 'recurring'
      title: string
      note?: string
      important: boolean
      rule: RecurrenceRule
      remindTime: string
    }
  | { kind: 'someday'; title: string; note?: string; important: boolean }

export type Command =
  | { type: 'task:create'; draft: TaskDraft }
  | { type: 'task:edit'; id: string; draft: TaskDraft }
  | { type: 'task:complete'; id: string }
  | { type: 'task:snooze'; id: string; minutes: number }
  | { type: 'task:postpone'; id: string }
  | { type: 'task:remove'; id: string }
  | { type: 'task:restore'; id: string }
  | { type: 'task:toToday'; id: string }
  | { type: 'settings:patch'; patch: Partial<Settings> }

/** 命令层需要的最小 store 面 —— 传真实的 Store 也行，这样才有无头测试的价值 */
export interface CommandStore {
  readonly tasks: readonly Task[]
  readonly settings: Settings
  addTask(task: Task): unknown
  updateTask(id: string, patch: TaskPatch): unknown
  replaceTask(task: Task): Task | null
  patchSettings(patch: Partial<Settings>): unknown
  newId(): string
}

export interface CommandResult {
  ok: boolean
  /**
   * 业务性失败：任务不存在、清单池没有「完成」、只有清单池能「今天做」……
   * **不是系统故障**，调用方不要拿它弹「数据写入失败」提示条。
   */
  error?: string
  /** 写盘 / fs 层失败。只有这个才该进顶部提示条（规格 §11.1 的 write-failed） */
  writeError?: string
  /** 本次命令改了哪条任务，供调用方决定要不要刷新托盘 */
  touchedTaskId?: string
}

/**
 * 用 draft 组装一条完整任务。
 *
 * `createdAt` 由调用方传入而不是取 `now`：编辑时它是**周期规则的锚点**
 * （`matchesDay(rule, startOfDay(createdAt), …)`），重建它会悄悄搬动整个规则的相位。
 * `deletedAt` 同理 —— 编辑一条已软删的任务不该把它复活。
 */
export function buildTask(
  settings: Settings,
  draft: TaskDraft,
  now: number,
  id: string,
  createdAt: number,
  deletedAt: number | null
): Task {
  const title = draft.title.trim()
  const note = draft.note?.trim()
  const important = draft.important

  switch (draft.kind) {
    case 'deadline': {
      const allDay = draft.allDay
      // allDay 时 dueAt 必须落在当天 00:00（groupToday 按这个约定分段）；
      // 非全天却没给时刻时退回设置里的「全天提醒时刻」—— 它本来就是
      // 「一天中的默认时刻」，比硬编码 '09:00' 更贴近用户意图。
      const dueAt = allDay
        ? startOfDay(draft.dueDay)
        : atTimeOfDay(draft.dueDay, draft.time ?? settings.allDayRemindTime)
      const task: DeadlineTask = {
        kind: 'deadline',
        id, title, important, createdAt, updatedAt: now,
        deletedAt, firedFor: null, pushedFor: null,
        dueAt,
        allDay,
        leadMin: draft.leadMin ?? settings.defaultLeadMin,
        snoozeUntil: null,
        completedAt: null
      }
      return note === undefined || note === '' ? task : { ...task, note }
    }
    case 'recurring': {
      const task: RecurringTask = {
        kind: 'recurring',
        id, title, important, createdAt, updatedAt: now,
        deletedAt, firedFor: null, pushedFor: null,
        rule: draft.rule,
        remindTime: draft.remindTime,
        lastDoneDay: null,
        streak: 0,
        snoozeUntil: null
      }
      return note === undefined || note === '' ? task : { ...task, note }
    }
    case 'someday': {
      const task: SomedayTask = {
        kind: 'someday',
        id, title, important, createdAt, updatedAt: now,
        deletedAt, firedFor: null, pushedFor: null
      }
      return note === undefined || note === '' ? task : { ...task, note }
    }
  }
}

/**
 * 所有写操作的唯一入口。
 *
 * 业务性失败一律 `return { ok: false, error }`（不抛），所以能抛到 catch 里的
 * 基本只有写盘与 fs 错误 —— 但也可能是 bug。两者都归 `writeError`：
 * 对用户来说「这次改动可能没存下来」这个提示在两种情况下都是对的。
 */
export function applyCommand(
  store: CommandStore,
  cmd: Command,
  now: number
): CommandResult {
  try {
    return route(store, cmd, now)
  } catch (err) {
    return { ok: false, writeError: err instanceof Error ? err.message : String(err) }
  }
}

function route(store: CommandStore, cmd: Command, now: number): CommandResult {
  switch (cmd.type) {
    case 'task:create': {
      const task = buildTask(store.settings, cmd.draft, now, store.newId(), now, null)
      store.addTask(task)
      return { ok: true, touchedTaskId: task.id }
    }

    case 'task:edit': {
      const old = findTask(store, cmd.id)
      if (!old) return notFound(cmd.id)
      // 保留 id 与 createdAt，其余按 draft 重建；deletedAt 保留原值
      const next = buildTask(store.settings, cmd.draft, now, old.id, old.createdAt, old.deletedAt)
      if (store.replaceTask(next) === null) return notFound(cmd.id)
      return { ok: true, touchedTaskId: old.id }
    }

    case 'task:complete': {
      const task = findTask(store, cmd.id)
      if (!task) return notFound(cmd.id)
      if (task.kind === 'someday') return invalid('清单池的任务没有「完成」，只有「今天做」')
      store.updateTask(task.id, actionPatch(task, 'complete', now, opts(store)))
      return { ok: true, touchedTaskId: task.id }
    }

    case 'task:snooze': {
      const task = findTask(store, cmd.id)
      if (!task) return notFound(cmd.id)
      if (task.kind === 'someday') return invalid('清单池的任务不提醒，无法推迟')
      const minutes = Math.max(1, Math.round(cmd.minutes))
      store.updateTask(task.id, actionPatch(task, 'snooze', now, { snoozeMinutes: minutes }))
      return { ok: true, touchedTaskId: task.id }
    }

    case 'task:postpone': {
      const task = findTask(store, cmd.id)
      if (!task) return notFound(cmd.id)
      if (task.kind === 'someday') return invalid('清单池的任务不提醒，无法推到明天')
      // 命令层的动词用 postpone（推后），通知按钮的标签用 'tomorrow' —— 两者不必同名
      store.updateTask(task.id, actionPatch(task, 'tomorrow', now, opts(store)))
      return { ok: true, touchedTaskId: task.id }
    }

    case 'task:remove': {
      const task = findTask(store, cmd.id)
      if (!task) return notFound(cmd.id)
      // 软删。不级联清 firedFor —— 软删的任务 remindAtOf 已经返回 null（规格 §5 取值表）
      store.updateTask(task.id, { deletedAt: now })
      return { ok: true, touchedTaskId: task.id }
    }

    case 'task:restore': {
      const task = findTask(store, cmd.id)
      if (!task) return notFound(cmd.id)
      // 同时清 firedFor：一条逾期任务被删又撤销后，如果 firedFor 还留着旧提醒点，
      // 它会被 `remindAt !== firedFor` 的幂等规则永久挡在批次之外。
      // 这与 task:edit 的清空是两件不同的事，不能顺手合并。
      store.updateTask(task.id, { deletedAt: null, firedFor: null })
      return { ok: true, touchedTaskId: task.id }
    }

    case 'task:toToday': {
      const task = findTask(store, cmd.id)
      if (!task) return notFound(cmd.id)
      if (task.kind !== 'someday') return invalid('只有清单池的任务能「今天做」')
      // 合成一份 draft 走 buildTask，而不是另写一套构造 —— 只此一条路径，
      // 「today 的全天型任务」的定义就只有一处
      const draft: TaskDraft = {
        kind: 'deadline',
        title: task.title,
        important: task.important,
        dueDay: startOfDay(now),
        allDay: true,
        ...(task.note === undefined ? {} : { note: task.note })
      }
      const next = buildTask(store.settings, draft, now, task.id, task.createdAt, task.deletedAt)
      if (store.replaceTask(next) === null) return notFound(cmd.id)
      return { ok: true, touchedTaskId: task.id }
    }

    case 'settings:patch': {
      const patch: Partial<Settings> = { ...cmd.patch }
      // push 是嵌套对象：不浅合并的话，只改 channel 会把整个 push 打回默认值
      if (cmd.patch.push !== undefined) patch.push = { ...store.settings.push, ...cmd.patch.push }
      store.patchSettings(patch)
      return { ok: true }
    }
  }
}

function findTask(store: CommandStore, id: string): Task | undefined {
  return store.tasks.find((t) => t.id === id)
}

function opts(store: CommandStore): { snoozeMinutes: number } {
  return { snoozeMinutes: store.settings.snoozeMinutes }
}

function notFound(id: string): CommandResult {
  return { ok: false, error: `任务不存在：${id}` }
}

function invalid(reason: string): CommandResult {
  return { ok: false, error: reason }
}

/** 供测试与调用方判断命令是否触及了某个任务；也把 TaskAction 的联合再导出一次 */
export type { TaskAction }
