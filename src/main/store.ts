import { randomUUID } from 'node:crypto'
import {
  closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, renameSync, unlinkSync, writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, FILE_VERSION } from '../shared/defaults'
import type { Persisted, Settings, Task, TaskPatch } from '../shared/types'

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

  constructor(file: string) {
    this.file = file
    this.data = this.load()
  }

  get dataFile(): string {
    return this.file
  }

  /** 数据文件损坏时坏内容被备份到哪里；未损坏为 null */
  get corruptBackupPath(): string | null {
    return this.corruptBackup
  }

  get settings(): Settings {
    return this.data.settings
  }

  get tasks(): readonly Task[] {
    return this.data.tasks
  }

  private load(): Persisted {
    if (!existsSync(this.file)) {
      return { version: FILE_VERSION, tasks: [], settings: { ...DEFAULT_SETTINGS } }
    }

    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf-8')) as Partial<Persisted>
      const tasks = Array.isArray(raw.tasks) ? raw.tasks.filter(isValidTask) : []
      return {
        version: FILE_VERSION,
        tasks,
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) }
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
      return { version: FILE_VERSION, tasks: [], settings: { ...DEFAULT_SETTINGS } }
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
    const index = this.data.tasks.findIndex((t) => t.id === id)
    if (index < 0) return null
    const merged = { ...this.data.tasks[index], ...patch, updatedAt: Date.now() } as Task
    this.data.tasks[index] = merged
    this.flush()
    return merged
  }

  /** 软删除，可撤销 */
  removeTask(id: string): boolean {
    return this.updateTask(id, { deletedAt: Date.now() }) !== null
  }

  restoreTask(id: string): boolean {
    return this.updateTask(id, { deletedAt: null }) !== null
  }

  /** 彻底删除，仅用于测试与「清空收件箱」 */
  hardRemoveTask(id: string): boolean {
    const before = this.data.tasks.length
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id)
    if (this.data.tasks.length === before) return false
    this.flush()
    return true
  }

  newId(): string {
    return randomUUID()
  }
}

function isValidTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object') return false
  const t = value as Record<string, unknown>
  if (typeof t.id !== 'string' || typeof t.title !== 'string') return false
  if (typeof t.createdAt !== 'number') return false
  if (t.kind !== 'deadline' && t.kind !== 'recurring' && t.kind !== 'someday') return false
  if (t.kind === 'deadline' && typeof t.dueAt !== 'number') return false
  if (t.kind === 'recurring' && !t.rule) return false
  return true
}
