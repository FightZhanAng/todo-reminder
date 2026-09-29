import { Menu, Tray } from 'electron'
import { groupToday } from '../shared/group'
import { nextHoliday } from '../shared/holiday'
import { formatClock } from '../shared/time'
import { trayIconClear, trayIconPending } from './icons'
import type { Scheduler } from './scheduler'
import type { Store } from './store'
import type { OpenView } from '../shared/ipc'

export interface TrayDeps {
  store: Store
  scheduler: Scheduler
  onOpen: () => void
  onQuickAdd: () => void
  onSettings: () => void
  onOpenView: (view: OpenView) => void
  onQuit: () => void
}

/** 深色线条，浅色任务栏下看得见 */
const ICON_COLOR = '#1B1F23'

export class TrayController {
  private tray: Tray | null = null

  constructor(private readonly deps: TrayDeps) {}

  create(): void {
    this.tray = new Tray(this.buildIcon())
    this.tray.on('click', () => this.deps.onOpen())
    this.refresh()
  }

  /** 通知发出后、任务状态变化后调用：刷新图标形态、tooltip 与菜单 */
  refresh(): void {
    if (!this.tray) return
    this.tray.setImage(this.buildIcon())
    this.tray.setToolTip(this.tooltip())
    this.tray.setContextMenu(this.buildMenu())
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private remainingCount(): number {
    const g = groupToday([...this.deps.store.tasks], Date.now())
    return g.overdue.length + g.upcoming.length + g.anytime.length + g.recurring.length
  }

  private buildIcon() {
    return this.remainingCount() > 0 ? trayIconPending(ICON_COLOR) : trayIconClear(ICON_COLOR)
  }

  private tooltip(): string {
    const now = Date.now()
    const g = groupToday([...this.deps.store.tasks], now)
    const count = g.overdue.length + g.upcoming.length + g.anytime.length + g.recurring.length
    if (count === 0) return '待办提醒 · 今天清空了'
    const next = g.upcoming[0]
    const when = next ? ` · 最近 ${formatClock(next.dueAt)}` : ''
    return `待办提醒 · 今天 ${count} 件${when}`
  }

  private buildMenu(): Menu {
    const paused = this.deps.scheduler.pausedUntil !== null
    const holiday = nextHoliday(Date.now())
    return Menu.buildFromTemplate([
      { label: '打开待办', click: () => this.deps.onOpen() },
      { label: '快速添加', click: () => this.deps.onQuickAdd() },
      { type: 'separator' },
      // 日历与倒计时在这里也留个入口：它们是主窗口里的两个新视图，
      // 光靠窗口里那两枚图标，托盘用户的鼠标得先进窗口再找
      { label: '日历', click: () => this.deps.onOpenView('calendar') },
      { label: holidayLabel(holiday), click: () => this.deps.onOpenView('countdown') },
      { type: 'separator' },
      {
        label: '暂停提醒',
        submenu: [
          { label: '30 分钟', click: () => this.pauseFor(30) },
          { label: '2 小时', click: () => this.pauseFor(120) },
          { label: '今天', click: () => this.pauseFor(minutesUntilMidnight()) }
        ]
      },
      {
        label: paused ? '恢复提醒' : '提醒运行中',
        enabled: paused,
        click: () => {
          this.deps.scheduler.resume()
          this.refresh()
        }
      },
      { type: 'separator' },
      { label: '设置', click: () => this.deps.onSettings() },
      { label: '退出', click: () => this.deps.onQuit() }
    ])
  }

  private pauseFor(minutes: number): void {
    this.deps.scheduler.pause(Math.max(1, minutes))
    this.refresh()
  }
}

function minutesUntilMidnight(): number {
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
  return Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 60_000))
}

/**
 * 「倒计时 · 距国庆节 2 天」。
 *
 * 托盘菜单是纯文字的，多带这几粒字让菜单本身就回答了「下一个假还有多久」——
 * 这正是用户点开托盘想看一眼的东西，不必为此打开窗口。
 */
function holidayLabel(holiday: ReturnType<typeof nextHoliday>): string {
  if (holiday === null) return '倒计时'
  if (holiday.indexInRun !== null) return `倒计时 · 正在放${holiday.name}`
  return `倒计时 · 距${holiday.name} ${holiday.daysUntil} 天`
}
