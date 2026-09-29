import { randomUUID } from 'node:crypto'
import {
  closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, FILE_VERSION } from '../shared/defaults'
import { tsFromDayKey } from '../shared/calendar'
import type {
  Anniversary, Persisted, RecurrenceRule, Settings, Task, TaskPatch, Weekday
} from '../shared/types'

/** 软删的任务留这么久，之后彻底清掉 —— 见 Store.purgeDeleted 的说明 */
const PURGE_AFTER_MS = 30 * 24 * 60 * 60_000

/**
 * JSON 单文件存储，不用 SQLite。
 *
 * 理由：个人待办满打满算几千条，全量读进内存也就几百 KB；而 better-sqlite3
 * 是原生模块，带上就得处理 electron-rebuild 和打包时的 ABI 匹配，
 * 对这个数据量是不划算的复杂度。
 *
 * 写入用「临时文件 → fsync → rename」做原子替换。fsync 必须早于 rename：
 * 否则崩溃可能留下一个「已改名但内容为空」的文件。
 *
 * 刻意不 import electron —— 文件路径由调用方传入，因此可被无头测试覆盖。
 */
export class Store {
  private readonly file: string
  private data: Persisted
  private corruptBackup: string | null = null
  private droppedCount = 0
  private newerVersion: number | null = null

  constructor(file: string) {
    this.file = file
    this.data = this.load()
    this.purgeDeleted()
  }

  get dataFile(): string {
    return this.file
  }

  /** 数据文件损坏时坏内容被备份到哪里；未损坏为 null */
  get corruptBackupPath(): string | null {
    return this.corruptBackup
  }

  /** 本次加载因形状不合法被跳过的记录条数；0 = 一条都没跳过 */
  get droppedTaskCount(): number {
    return this.droppedCount
  }

  /** 读到的文件版本比本程序新（装过更新版本又退回来）时的那个版本号；null = 没有 */
  get newerFileVersion(): number | null {
    return this.newerVersion
  }

  get settings(): Settings {
    return this.data.settings
  }

  get tasks(): readonly Task[] {
    return this.data.tasks
  }

  get anniversaries(): readonly Anniversary[] {
    return this.data.anniversaries
  }

  private load(): Persisted {
    if (!existsSync(this.file)) return this.empty()

    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<Persisted>

      // 文件版本比本程序新 = 装过更新的版本又退回来了。**动它之前先备份**：
      // 新格式里可能有本版本不认识的字段，而每次写盘都是**全量重写**（见 flush），
      // 不备份的话，第一次改设置就会把它们永久抹掉。
      // 数据照常读进来 —— 大部分字段是兼容的，全丢反而是更重的伤害。
      const fileVersion = isNum(raw.version) ? raw.version : 1
      if (fileVersion > FILE_VERSION) {
        this.newerVersion = fileVersion
        this.copyAside('newer')
        console.error(
          `[store] 数据文件版本 ${fileVersion} 比本程序（${FILE_VERSION}）新，已先备份`
        )
      }

      const incoming = Array.isArray(raw.tasks) ? raw.tasks : []
      const tasks = incoming.map(normalizeTask).filter((t): t is Task => t !== null)

      const incomingAnniversaries = Array.isArray(raw.anniversaries) ? raw.anniversaries : []
      const anniversaries = incomingAnniversaries
        .map(normalizeAnniversary)
        .filter((a): a is Anniversary => a !== null)

      // 有记录被跳过就留一份原文：这些记录进不了内存，但用户还有机会人工抢救。
      // 与整体损坏那一路的区别是**复制**而不是改名 —— 活文件留在原地，
      // 剩下的好记录照常工作，下次 flush 才把它覆盖成只含好记录的一份。
      const dropped = incoming.length - tasks.length + (incomingAnniversaries.length - anniversaries.length)
      if (dropped > 0) {
        this.droppedCount = dropped
        this.copyAside('dropped')
        console.error(`[store] 跳过了 ${dropped} 条形状不合法的记录`)
      }

      return {
        version: FILE_VERSION,
        tasks,
        anniversaries,
        settings: {
          ...DEFAULT_SETTINGS,
          ...(raw.settings ?? {}),
          // schemaVersion 记的是「这份设置是照哪一版的格式写的」，
          // 读进来就说明本程序认得它，所以对齐成当前版本，别留一个旧数字
          schemaVersion: FILE_VERSION
        }
      }
    } catch (err) {
      // 待办数据比喝水记录珍贵得多，不能直接覆盖。
      // 备份坏文件再以空数据启动，用户还有机会人工抢救。
      console.error('[store] 数据文件损坏：', err)
      const backup = `${this.file}.corrupt-${Date.now()}`
      try {
        // 优先 rename（坏文件从原地移走，之后 flush 不会碰到它）
        renameSync(this.file, backup)
        this.corruptBackup = backup
      } catch (renameErr) {
        // rename 失败（例如坏文件被别的进程占着）时退化成复制。
        // 宁可留下重复的一份，也不能让后续 flush() 把用户唯一的那份坏数据
        // 覆盖掉 —— 那会毁掉「还能人工抢救」这个承诺。
        try {
          copyFileSync(this.file, backup)
          this.corruptBackup = backup
          console.error('[store] rename 备份失败，已改用复制：', renameErr)
        } catch (copyErr) {
          console.error('[store] 备份损坏文件失败（rename 与 copy 都不行）：', copyErr)
        }
      }
      return this.empty()
    }
  }

  private empty(): Persisted {
    return {
      version: FILE_VERSION,
      tasks: [],
      anniversaries: [],
      settings: { ...DEFAULT_SETTINGS }
    }
  }

  /**
   * 清掉早就过了撤销窗口的软删记录。
   *
   * 「删除」界面上只留 5 秒的撤销窗口（`exit.ts` 的 `EXIT_REMOVED_MS`），
   * 而且没有任何视图会列出软删的任务 —— 留着它们不服务任何功能，
   * 只是让文件随时间单调变大，而每次写盘都是全量重写（见 `flush`）。
   *
   * 留 30 天而不是立刻清：这是**没有撤销入口的数据**，宁可多留一段。
   * 启动时跑一次，没有该清的就不写盘。
   */
  private purgeDeleted(): void {
    const cutoff = Date.now() - PURGE_AFTER_MS
    const kept = this.data.tasks.filter((t) => t.deletedAt === null || t.deletedAt > cutoff)
    if (kept.length === this.data.tasks.length) return
    console.error(`[store] 清理了 ${this.data.tasks.length - kept.length} 条超过 30 天的已删记录`)
    this.data.tasks = kept
    this.flush()
  }

  /**
   * 把当前文件复制一份到 `<file>.<suffix>-<时间戳>`，并把路径记进
   * `corruptBackupPath`（界面的「打开所在文件夹」与设置页的警告都读它）。
   *
   * **复制、不改名**：活文件留在原地，本次加载进来的数据照常工作，
   * 下次 flush 才把它写成新的那份。与整体损坏那一路的 rename 相反 ——
   * 那边文件根本解析不了，留着它只会被下次 flush 覆盖掉。
   */
  private copyAside(suffix: string): void {
    const backup = `${this.file}.${suffix}-${Date.now()}`
    try {
      copyFileSync(this.file, backup)
      this.corruptBackup = backup
    } catch (err) {
      console.error(`[store] 备份失败（${suffix}）：`, err)
    }
  }

  private flush(): void {
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data), 'utf-8')

    // 显式落盘，早于 rename —— 否则崩溃可能留下空文件
    const fd = openSync(tmp, 'r+')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }

    try {
      renameSync(tmp, this.file)
    } catch (err) {
      try {
        unlinkSync(tmp)
      } catch {
        /* 清理失败不掩盖原始错误 */
      }
      throw err
    }
  }

  patchSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.flush()
    return this.data.settings
  }

  addTask(task: Task): Task {
    this.data.tasks.push(task)
    this.flush()
    return task
  }

  updateTask(id: string, patch: TaskPatch): Task | null {
    const merged = this.merge(id, patch)
    if (merged !== null) this.flush()
    return merged
  }

  /**
   * 一批更新只写一次盘。
   *
   * 逐条调 `updateTask` 时每一条都是一次**全量重写 + fsync + rename**
   * （见 `flush`），而 `Scheduler.markFired` 正是「一批到点的任务逐条回填」
   * 的形状。2026-09-22 实测：60 条任务、文件本身 14.9 KB，逐条写一轮
   * 写盘 60 次、累计 876 KB —— 放大 59 倍，而且 `fsync` 是同步阻塞的，
   * 全部发生在主进程。批量口让「一批」回到一次写盘。
   */
  updateTasks(patches: readonly { id: string; patch: TaskPatch }[]): Task[] {
    const out: Task[] = []
    for (const { id, patch } of patches) {
      const merged = this.merge(id, patch)
      if (merged !== null) out.push(merged)
    }
    if (out.length > 0) this.flush()
    return out
  }

  /**
   * 就地合并，**不写盘** —— 写一次还是一批一次，由调用方决定。
   *
   * `updatedAt` 统一取这里的时间：命令层那些「用注入的 now 盖时间戳」的路径
   * 走的是 `buildTask` + `replaceTask`，不经过本函数。
   */
  private merge(id: string, patch: TaskPatch): Task | null {
    const index = this.data.tasks.findIndex((t) => t.id === id)
    if (index < 0) return null
    const merged = { ...this.data.tasks[index], ...patch, updatedAt: Date.now() } as Task
    this.data.tasks[index] = merged
    return merged
  }

  /**
   * 整条替换。
   *
   * 不能用 `updateTask` 代替 —— 它是 `{ ...old, ...patch }` 的**合并**语义：
   * 把一条截止型改成清单池时，旧的 dueAt / allDay / leadMin / completedAt
   * 会原地留下来（`TaskPatch` 刻意 Omit 了 `kind`，所以也根本没法用 patch 改类型）。
   * 那些字段不会立刻出错，但将来切回截止型时会冒出幽灵默认值。
   *
   * 不在这里盖 updatedAt —— 调用方（applyCommand）已经在 buildTask 里用注入的
   * `now` 盖好了，这样无头测试才能断言到确定的时间戳。
   */
  replaceTask(task: Task): Task | null {
    const index = this.data.tasks.findIndex((t) => t.id === task.id)
    if (index < 0) return null
    this.data.tasks[index] = task
    this.flush()
    return task
  }

  /**
   * 纪念日的写入口。
   *
   * 与任务不同，这里**没有软删除**：任务软删是为了给「5 秒撤销窗口」留余地，
   * 而纪念日没有退场动画也没有撤销条，删掉的第二天就没人记得它存在过 ——
   * 与其留一堆永不清理的墓碑（文件每次都是全量重写），不如删干净，
   * 让界面在删之前用二次确认把话说清楚。
   */
  addAnniversary(item: Anniversary): Anniversary {
    this.data.anniversaries.push(item)
    this.flush()
    return item
  }

  updateAnniversary(
    id: string,
    patch: Partial<Pick<Anniversary, 'title' | 'date' | 'yearly' | 'lunar'>>
  ): Anniversary | null {
    const index = this.data.anniversaries.findIndex((a) => a.id === id)
    if (index < 0) return null
    const merged: Anniversary = { ...this.data.anniversaries[index]!, ...patch, updatedAt: Date.now() }
    this.data.anniversaries[index] = merged
    this.flush()
    return merged
  }

  removeAnniversary(id: string): boolean {
    const kept = this.data.anniversaries.filter((a) => a.id !== id)
    if (kept.length === this.data.anniversaries.length) return false
    this.data.anniversaries = kept
    this.flush()
    return true
  }

  newId(): string {
    return randomUUID()
  }
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNumOrNull(value: unknown): value is number | null {
  return value === null || isNum(value)
}

/** 数组里每个元素都是整数且落在 [lo, hi] 内 */
function isIntArrayInRange(value: unknown, lo: number, hi: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi)
  )
}

/**
 * 重复规则。三个频率共有的 `every` 必须是 ≥ 1 的有限数：缺了它
 * `matchesDay` 会走到 `x % undefined === NaN`，规则**静默**永不命中 ——
 * 比抛错更难发现，所以按不合法处理。
 */
function normalizeRule(value: unknown): RecurrenceRule | null {
  if (value === null || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  if (!isNum(r.every) || r.every < 1) return null
  const every = Math.floor(r.every)
  const skipWeekend = r.skipWeekend === true

  switch (r.freq) {
    case 'daily':
      return { freq: 'daily', every, skipWeekend }
    case 'weekly':
      if (!isIntArrayInRange(r.days, 0, 6)) return null
      return { freq: 'weekly', every, days: [...(r.days as Weekday[])].sort(), skipWeekend }
    case 'monthly':
      if (!isIntArrayInRange(r.days, 1, 31)) return null
      return { freq: 'monthly', every, days: [...r.days].sort((a, b) => a - b), skipWeekend }
    default:
      return null
  }
}

/**
 * 一条持久化记录的深校验。不合法返回 null（调用方负责丢掉它并留下原文）。
 *
 * 为什么必须深到每一层：只认 `id`/`title`/`createdAt`/`kind` 的浅校验挡不住
 * 「JSON 语法合法、字段却半截」的坏数据，而那种数据会在**两个进程里**以两种
 * 完全不同的方式炸掉（2026-09-22 实测，都能过旧的 `isValidTask`）：
 *
 *   - 缺 `remindTime` 的周期任务 → `remindAtOf` 走到 `parseHM` 读
 *     `undefined.split`，主进程每 10 秒的 tick 抛一次，弹「主进程 JavaScript 错误」；
 *   - 每周规则缺 `days` → `matchesDay` 读 `undefined.some`，
 *     渲染层的 render 路径直接抛，React 卸载整棵树，**白屏且没有恢复入口**。
 *
 * 判据是「这个值会不会让某处代码抛错或静默算错」，因此校验**类型与存在性、
 * 不校验格式**：`remindTime` 只要是字符串就放行（'9:00' 没补零，
 * `parseHM` 照样认，没必要为这个丢用户的记录），`undefined` 才拦下。
 */
export function normalizeTask(value: unknown): Task | null {
  if (value === null || typeof value !== 'object') return null
  const t = value as Record<string, unknown>

  if (typeof t.id !== 'string' || t.id === '') return null
  if (typeof t.title !== 'string') return null
  if (typeof t.important !== 'boolean') return null
  if (!isNum(t.createdAt) || !isNum(t.updatedAt)) return null
  if (!isNumOrNull(t.deletedAt) || !isNumOrNull(t.firedFor)) return null
  if (t.note !== undefined && typeof t.note !== 'string') return null

  const base = {
    id: t.id,
    title: t.title,
    important: t.important,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    deletedAt: t.deletedAt,
    firedFor: t.firedFor,
    ...(t.note === undefined ? {} : { note: t.note })
  }

  switch (t.kind) {
    case 'deadline':
      if (!isNum(t.dueAt)) return null
      if (typeof t.allDay !== 'boolean') return null
      if (!isNum(t.leadMin)) return null
      if (!isNumOrNull(t.snoozeUntil) || !isNumOrNull(t.completedAt)) return null
      return {
        ...base,
        kind: 'deadline',
        dueAt: t.dueAt,
        allDay: t.allDay,
        leadMin: t.leadMin,
        snoozeUntil: t.snoozeUntil,
        completedAt: t.completedAt
      }

    case 'recurring': {
      const rule = normalizeRule(t.rule)
      if (rule === null) return null
      if (typeof t.remindTime !== 'string') return null
      if (t.lastDoneDay !== null && typeof t.lastDoneDay !== 'string') return null
      if (!isNum(t.streak)) return null
      if (!isNumOrNull(t.snoozeUntil)) return null
      return {
        ...base,
        kind: 'recurring',
        rule,
        remindTime: t.remindTime,
        lastDoneDay: t.lastDoneDay,
        streak: t.streak,
        snoozeUntil: t.snoozeUntil
      }
    }

    case 'someday':
      return { ...base, kind: 'someday' }

    default:
      return null
  }
}

/**
 * 一条纪念日记录的深校验。判据与 `normalizeTask` 完全一样：
 * 「这个值会不会让某处代码抛错或静默算错」。
 *
 * 纪念日只有日期一个字段会出事，而它出的事不小：`anniversaryOccurrence`
 * 拿着 `'2026-02-31'` 这种**语法像日期、实际不存在**的值会静默滚到 3 月 3 日
 * （`tsFromDayKey` 用回写比对挡住了这一条，所以这里直接复用它，
 * 而不是自己再写一遍正则）。日期不合法就整条丢掉，而不是留一条
 * 永远算不出倒计时的记录。
 */
export function normalizeAnniversary(value: unknown): Anniversary | null {
  if (value === null || typeof value !== 'object') return null
  const a = value as Record<string, unknown>

  if (typeof a.id !== 'string' || a.id === '') return null
  if (typeof a.title !== 'string') return null
  if (typeof a.date !== 'string' || tsFromDayKey(a.date) === null) return null
  if (typeof a.yearly !== 'boolean' || typeof a.lunar !== 'boolean') return null
  if (!isNum(a.createdAt) || !isNum(a.updatedAt)) return null

  return {
    id: a.id,
    title: a.title,
    date: a.date,
    yearly: a.yearly,
    lunar: a.lunar,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt
  }
}
