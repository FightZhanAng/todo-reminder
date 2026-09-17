import { Menu, Tray } from 'electron'
import { groupToday } from '../shared/group'
import { formatClock } from '../shared/time'
import { trayIconClear, trayIconPending } from './icons'
import type { Scheduler } from './scheduler'
import type { Store } from './store'

export interface TrayDeps {
  store: Store
  scheduler: Scheduler
  onOpen: () => void
  onQuickAdd: () => void
  onSettings: () => void
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
    const g = groupToday([...this.deps.store.tasks], this.deps.store.settings, Date.now())
    return g.overdue.length + g.upcoming.length + g.anytime.length + g.recurring.length
  }

  private buildIcon() {
    return this.remainingCount() > 0 ? trayIconPending(ICON_COLOR) : trayIconClear(ICON_COLOR)
  }

  private tooltip(): string {
    const now = Date.now()
    const g = groupToday([...this.deps.store.tasks], this.deps.store.settings, now)
    const count = g.overdue.length + g.upcoming.length + g.anytime.length + g.recurring.length
    if (count === 0) return '待办提醒 · 今天清空了'
    const next = g.upcoming[0]
    const when = next ? ` · 最近 ${formatClock(next.dueAt)}` : ''
    return `待办提醒 · 今天 ${count} 件${when}`
  }

  private buildMenu(): Menu {
    const paused = this.deps.scheduler.pausedUntil !== null
    return Menu.buildFromTemplate([
      { label: '打开待办', click: () => this.deps.onOpen() },
      { label: '快速添加', click: () => this.deps.onQuickAdd() },
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
