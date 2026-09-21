export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/**
 * 重复规则。三种频率都带 skipWeekend —— 「工作日提醒」是通用需求。
 * `every` 是间隔倍数；锚点由调用方用 task.createdAt 传入，因此这里不存锚点。
 */
export type RecurrenceRule =
  | { freq: 'daily'; every: number; skipWeekend: boolean }
  | { freq: 'weekly'; every: number; days: Weekday[]; skipWeekend: boolean }
  | { freq: 'monthly'; every: number; days: number[]; skipWeekend: boolean }

export interface TaskBase {
  id: string
  title: string
  note?: string
  /** 只影响排序与一个星标，不改变提醒强度 */
  important: boolean
  createdAt: number
  /** 为将来同步预留 */
  updatedAt: number
  /** 软删除，支持撤销 */
  deletedAt: number | null
  /** 已为哪个提醒点弹过通知。存时间戳而不是布尔值 —— 见规格 §4.1 */
  firedFor: number | null
}

export interface DeadlineTask extends TaskBase {
  kind: 'deadline'
  /** 截止时点；allDay 时为当天 00:00 */
  dueAt: number
  /** true = 只有日期没有时刻 */
  allDay: boolean
  /** 提前多少分钟提醒（仅 allDay === false 时有意义） */
  leadMin: number
  /** 「推迟」后的下一个提醒点 */
  snoozeUntil: number | null
  completedAt: number | null
}

export interface RecurringTask extends TaskBase {
  kind: 'recurring'
  rule: RecurrenceRule
  /** 'HH:mm' */
  remindTime: string
  /** dayKey */
  lastDoneDay: string | null
  streak: number
  /**
   * 「推迟」后的下一个提醒点。
   *
   * 与截止型同名同义，但**判定方式不同**：周期任务的常规提醒点由规则算出、
   * 与 `snoozeUntil` 无关，所以不能像截止型那样无条件取 `snoozeUntil`
   * （那样会永久屏蔽掉之后的每一天）。这里只在 `snoozeUntil` 不早于今天时
   * 才认它 —— 详见 `remind.ts` 的 `recurringRemindAt`。
   */
  snoozeUntil: number | null
}

export interface SomedayTask extends TaskBase {
  /** 清单池，永不提醒 */
  kind: 'someday'
}

export type Task = DeadlineTask | RecurringTask | SomedayTask

/** 会提醒的任务类型。清单池不在其中 */
export type RemindableTask = DeadlineTask | RecurringTask

/**
 * 任务的可更新字段集合。
 *
 * 不要用 `Partial<Task>` —— `Partial` 是分布式映射类型，
 * `Partial<DeadlineTask | RecurringTask | SomedayTask>` 会展开成三个 Partial 的
 * 联合，于是读 `patch.streak` 或 `patch.dueAt` 会直接编译失败
 * （该属性不在联合的每个成员上）。
 *
 * 这里用 Omit 逐个去掉判别字段 `kind` 再做交叉，既有全部可更新字段，
 * 又不会让 `kind` 交叉成 `never`。
 */
export type TaskPatch = Partial<
  Omit<DeadlineTask, 'kind'> & Omit<RecurringTask, 'kind'> & Omit<SomedayTask, 'kind'>
>

export interface Settings {
  schemaVersion: number
  launchAtLogin: boolean
  notifyEnabled: boolean
  soundEnabled: boolean
  /** 全天任务的提醒时刻 */
  allDayRemindTime: string
  /** 截止型默认提前量 */
  defaultLeadMin: number
  /** 「推迟」的默认分钟数 */
  snoozeMinutes: number
  /** 免打扰时段，支持跨午夜；null = 不启用 */
  quietHours: { start: string; end: string } | null
  quietWhenIdle: boolean
  idleThresholdMin: number
  /** 全局快捷键（快速添加小窗） */
  hotkey: string
  theme: 'auto' | 'light' | 'dark'
  /** 主窗口浮在所有窗口之上 —— 托盘常驻时怕它被别的窗口压住 */
  alwaysOnTop: boolean
}

export interface Persisted {
  version: number
  tasks: Task[]
  settings: Settings
}
