import { contextBridge, ipcRenderer } from 'electron'
import { IPC, WINDOW_ARG_PREFIX, type WindowKind } from '../shared/ipc'
import type { Command, TaskDraft } from '../shared/commands'
import type { Snapshot } from '../shared/ipc'

/**
 * 桥。
 *
 * 一期这里只有一行 console.log 占位。现在按窗口类型暴露两套：
 * 主窗口拿 `window.todo`，快速添加窗拿 `window.quickadd`。
 *
 * 两者其实都能用全套（都是本应用的窗口，没有安全损失），裁剪只是为了让
 * 快速添加窗的类型面干净 —— 那边不该出现「广播订阅」这种东西。
 */
function kindFromArgv(argv: readonly string[]): WindowKind {
  const found = argv.find((a) => a.startsWith(WINDOW_ARG_PREFIX))
  return found?.slice(WINDOW_ARG_PREFIX.length) === 'quickadd' ? 'quickadd' : 'main'
}

const kind = kindFromArgv(process.argv)

if (kind === 'quickadd') {
  contextBridge.exposeInMainWorld('quickadd', {
    submit: (draft: TaskDraft): Promise<void> => ipcRenderer.invoke(IPC.quickAdd, draft),
    cancel: (): void => {
      ipcRenderer.send(IPC.quickAddCancel)
    }
  })
} else {
  contextBridge.exposeInMainWorld('todo', {
    get: (): Promise<Snapshot> => ipcRenderer.invoke(IPC.get),
    command: (cmd: Command): Promise<Snapshot> => ipcRenderer.invoke(IPC.command, cmd),
    pause: (minutes: number | null): Promise<Snapshot> => ipcRenderer.invoke(IPC.pause, { minutes }),
    onSnapshot: (cb: (snapshot: Snapshot) => void): (() => void) => {
      const listener = (_e: unknown, snapshot: Snapshot): void => cb(snapshot)
      ipcRenderer.on(IPC.snapshot, listener)
      return () => ipcRenderer.removeListener(IPC.snapshot, listener)
    },
    onFocusTask: (cb: (taskId: string) => void): (() => void) => {
      const listener = (_e: unknown, payload: { taskId: string }): void => cb(payload.taskId)
      ipcRenderer.on(IPC.focusTask, listener)
      return () => ipcRenderer.removeListener(IPC.focusTask, listener)
    },
    setHotkey: (hotkey: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.setHotkey, hotkey),
    window: (action: 'hide' | 'open-data-dir' | 'quit'): Promise<void> =>
      ipcRenderer.invoke(IPC.window, action)
  })
}
