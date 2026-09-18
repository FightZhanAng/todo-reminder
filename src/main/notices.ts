import type { Notice, NoticeId } from '../shared/ipc'

const LEVEL_RANK: Record<Notice['level'], number> = { error: 0, warn: 1 }

/**
 * 顶部提示条的来源。
 *
 * 第一期 `notify-failed` 只写了 `console.error`，用户侧零反馈 —— 弹不出来的时候
 * 人根本不知道。这里给它一个去处。
 *
 * 刻意不 import electron，因此可以被无头测试覆盖。
 */
export class NoticeCenter {
  private readonly items = new Map<NoticeId, Notice>()
  /** 本次运行里被用户关掉的 id。重启后重新评估 */
  private readonly dismissed = new Set<NoticeId>()

  /**
   * 同一 id 只保留一条，后来者覆盖 —— 输入参数 `at` 只用于排序。
   *
   * 不"每次失败都插一条"是刻意的：通知连续失败会每 tick 触发一次，
   * 插一条就会让顶部提示条不停闪动，比不显示更烦人。
   */
  raise(notice: Notice): void {
    this.items.set(notice.id, notice)
  }

  /** 用户点关闭：本次运行不再显示这一类问题 */
  dismiss(id: NoticeId): void {
    this.dismissed.add(id)
    this.items.delete(id)
  }

  /** 条件不再成立时收回（例如数据文件已重新读好）。顺带清掉"已关闭"标记，让下次还能显示 */
  clear(id: NoticeId): void {
    this.items.delete(id)
    this.dismissed.delete(id)
  }

  has(id: NoticeId): boolean {
    return this.items.has(id) && !this.dismissed.has(id)
  }

  /** 按严重度排序（error 在前），同级别按时间新的在前 */
  list(): Notice[] {
    return [...this.items.values()]
      .filter((n) => !this.dismissed.has(n.id))
      .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || b.at - a.at)
  }

  /** 提示条只显示最严重的一条，它就是 list()[0] */
  head(): Notice | null {
    return this.list()[0] ?? null
  }
}
