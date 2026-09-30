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

/**
 * 纪念日 —— 一年一次要数的那个日子（生日、结婚纪念日…）。
 *
 * **刻意不是一种 `Task`**：待办共享着 `completedAt` / `deletedAt` / `kind` /
 * 软删与撤销那一整套东西，纪念日一样都没有 —— 它只有「离那天还有多久」，
 * 外加一句「到那天要不要说一声」。塞进 `Task` 的代价是每个关于待办的分支
 * 都要先排除它一次（见 `shared/anniversary.ts` 顶部的说明）。
 *
 * `firedFor` 两本书里同名，但**语义不同**：任务存的是「哪个提醒点」（按分钟
 * 算，`at === firedFor` 就是弹过），纪念日存的是「哪一天」（按天算，因为它
 * 的提醒谈的是一整天）。名字相同是为了让「幂等」这件事读起来是同一句话，
 * 不是因为它们能互相套用。
 */
export interface Anniversary {
  id: string
  title: string
  /** 锚点那一天，'YYYY-MM-DD'。农历纪念日存的是公历锚点，农历月日由它推出 */
  date: string
  /** true = 每年都数；false = 只数这一天 */
  yearly: boolean
  /** true = 按农历月日重复（农历生日），false = 按公历月日 */
  lunar: boolean
  /**
   * 到那天要不要弹一条通知。
   *
   * 默认 false：记一条纪念日不该顺带改变「这台电脑会不会在早上响一下」，
   * 想要的人自己去勾。
   */
  notify: boolean
  /**
   * 已经为**哪一天**弹过 —— 存的是那一天的零点，不是提醒点那一刻。
   *
   * 「今天就是那天」是一整天的事：09:00 弹过之后，同一天把提醒时刻改成
   * 11:00 也不该再弹一遍。而明年算出来的是新的一天，自然重新弹，
   * 不需要任何清理代码。
   */
  firedFor: number | null
  createdAt: number
  updatedAt: number
}

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

/**
 * 用户能在界面上改的纪念日字段。
 *
 * **不含 `firedFor`**：那是调度器的提醒账。让用户改它，等于给了他一个
 * 「让今天再弹一次」和「让今天别再弹」的旋钮 —— 前者是骚扰，后者是静音，
 * 两个都不该长得像一个可点的东西。
 */
export type AnniversaryEdit = Pick<Anniversary, 'title' | 'date' | 'yearly' | 'lunar' | 'notify'>

/**
 * 存储层接受的一批字段：用户能改的那些，加上调度器要回填的 `firedFor`。
 *
 * 分两个类型而不是共用一个，是因为它们的白名单**故意不一样** ——
 * 命令层拿到的那个是 `Partial<AnniversaryEdit>`，写不进 `firedFor`。
 */
export type AnniversaryPatch = Partial<AnniversaryEdit & Pick<Anniversary, 'firedFor'>>

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
  /** 倒计时页里显示法定节假日 */
  countdownHolidays: boolean
  /** 倒计时只显示这么多天以内的；0 = 不限 */
  countdownHorizonDays: number
  /**
   * 自动检查并在后台下载更新。
   *
   * 关掉之后**只剩手动**：设置页那颗「检查更新」照旧能点，但应用不再
   * 自己联网。给「不想让它偷跑流量」留的口子。
   */
  autoUpdate: boolean
}

export interface Persisted {
  version: number
  tasks: Task[]
  anniversaries: Anniversary[]
  settings: Settings
}
