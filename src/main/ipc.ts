import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { applyCommand, type Command, type CommandResult, type TaskDraft } from '../shared/commands'
import { IPC, type Snapshot, type WindowAction } from '../shared/ipc'
import type { NoticeCenter } from './notices'
import type { Scheduler } from './scheduler'
import type { Store } from './store'

export interface AppContext {
  store: Store
  scheduler: Scheduler
  notices: NoticeCenter
  /** 广播目标：主窗口与快速添加窗都要收到 */
  windows: () => BrowserWindow[]
  /** 快捷键是否注册成功（由 quickadd.ts 维护） */
  hotkeyRegistered: () => boolean
  /**
   * 一条命令成功之后的副作用：tick + 托盘刷新 + 主题/开机自启/快捷键同步。
   * 实现在 index.ts（那里才拿得到 tray），通过依赖注入进来。
   * 它必须在 `store` 已经写完、`broadcast` 之前执行。
   */
  afterCommand: (cmd: Command, result: CommandResult) => void
  /** 暂停状态变化后要刷新托盘菜单 */
  afterPauseChange: () => void
  /**
   * 试注册一个全局快捷键，返回是否成功。
   * 失败时实现方要把注册回滚到**当前生效的那个值** —— 否则
   * `hotkeyRegistered` 会误报成 false，而旧热键其实还好好的。
   */
  setHotkey: (hotkey: string) => boolean
  quickAdd: { hide: () => void }
}

export function buildSnapshot(ctx: AppContext): Snapshot {
  return {
    tasks: [...ctx.store.tasks],
    settings: ctx.store.settings,
    runtime: {
      pausedUntil: ctx.scheduler.pausedUntil,
      hotkeyRegistered: ctx.hotkeyRegistered(),
      corruptBackupPath: ctx.store.corruptBackupPath,
      notices: ctx.notices.list(),
      version: app.getVersion(),
      dataFile: ctx.store.dataFile
    }
  }
}

/**
 * 广播点。
 *
 * 命令路径（新建/编辑/完成/推迟/…）全部收敛到 `runCommand`，那是主广播点。
 * 另有几处不经命令层、必须手动广播：
 *  - `pause` 处理器：暂停/恢复不落盘，不走 Command；
 *  - `setHotkey` 试注册失败分支：没写设置，但要刷新 `hotkeyRegistered` 状态；
 *  - 调度器 `notify` 回调：调度器不经命令层，弹通知后要刷新界面；
 *  - `index.ts` 里窗口首帧 `did-finish-load`：主动推一次，渲染层无需先 get()。
 *
 * 漏广播的症状是「操作生效了但界面不更新」，且只在特定路径出现。
 * 将来要加广播点时，请意识到这个清单、别只在 runCommand 里加。
 */
export function broadcast(ctx: AppContext): void {
  const snapshot = buildSnapshot(ctx)
  for (const win of ctx.windows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.snapshot, snapshot)
  }
}

export function runCommand(ctx: AppContext, cmd: Command): CommandResult {
  const result = applyCommand(ctx.store, cmd, Date.now())

  if (result.writeError) {
    ctx.notices.raise({
      id: 'write-failed',
      level: 'error',
      text: `数据写入失败：${result.writeError}。这次的改动可能在重启后丢失。`,
      at: Date.now()
    })
  }
  // 业务性失败（任务不存在之类）不是系统故障，不动提示条 —— 见
  // `CommandResult` 的两个错误字段的分工
  if (result.ok) ctx.afterCommand(cmd, result)

  broadcast(ctx)
  return result
}

export function registerIpc(ctx: AppContext): void {
  ipcMain.handle(IPC.get, () => buildSnapshot(ctx))

  ipcMain.handle(IPC.command, (_e, cmd: Command) => {
    runCommand(ctx, cmd)
    return buildSnapshot(ctx)
  })

  ipcMain.handle(IPC.pause, (_e, arg: { minutes: number | null }) => {
    if (arg === null || arg.minutes === null) ctx.scheduler.resume()
    else ctx.scheduler.pause(Math.max(1, arg.minutes))
    ctx.afterPauseChange()
    broadcast(ctx)
    return buildSnapshot(ctx)
  })

  // 快捷键：**先试注册、成功才写设置**（规格 §9.4「注册失败不写进设置」）。
  // 反过来的话，旧的那个还能用的热键会被一个注册不上的新值顶掉。
  ipcMain.handle(IPC.setHotkey, (_e, hotkey: string) => {
    if (typeof hotkey !== 'string') return { ok: false }
    const ok = ctx.setHotkey(hotkey)
    if (ok) runCommand(ctx, { type: 'settings:patch', patch: { hotkey } })
    else broadcast(ctx)
    return { ok }
  })

  ipcMain.handle(IPC.window, (e, action: WindowAction) => {
    switch (action) {
      case 'hide':
        BrowserWindow.fromWebContents(e.sender)?.hide()
        return
      case 'open-data-dir':
        shell.showItemInFolder(ctx.store.dataFile)
        return
      case 'quit':
        app.quit()
        return
    }
  })

  // 快速添加窗专用。只接受 deadline / someday —— 周期任务要选规则，放不进那个小窗。
  ipcMain.handle(IPC.quickAdd, (_e, draft: TaskDraft) => {
    if (draft.kind === 'recurring') {
      // 不静默接受：静默接受会让「快捷键添加 + 某天开始变成周期任务」无法排查
      console.error('[ipc] 快速添加不接受 recurring draft')
      return
    }
    runCommand(ctx, { type: 'task:create', draft })
    ctx.quickAdd.hide()
  })

  ipcMain.on(IPC.quickAddCancel, () => ctx.quickAdd.hide())
}
