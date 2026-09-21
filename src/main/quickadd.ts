import { BrowserWindow, globalShortcut } from 'electron'
import { join } from 'node:path'
import { WINDOW_ARG_PREFIX } from '../shared/ipc'

/**
 * 快速添加小窗 + 全局快捷键。
 *
 * 小窗只有一件事要做：回车记下、失焦就走。所以它是无边框、置顶、不进任务栏的。
 *
 * 窗口**只建一次**（启动时预建、隐藏着）而不是每次弹都新建：BrowserWindow 的构造
 * 加首帧要几十毫秒，按快捷键最常见的结果是先看到一个空白窗再看到内容。内容清空
 * 交给渲染层在拿到焦点时做（见 renderer/components/QuickAdd.tsx）。
 */
export interface QuickAdd {
  show: () => void
  hide: () => void
  /** 当前有没有一个真的注册上了的快捷键 */
  isHotkeyRegistered: () => boolean
  /**
   * 试注册一个新快捷键。失败时会把注册**回滚到上一个还能用的值**并返回 false ——
   * 不回滚的话，界面会显示「没注册上」，而用户原本好用的那个热键已经被卸掉了。
   */
  setHotkey: (hotkey: string) => boolean
  /** 退出前解绑，别把热键留在系统里 */
  destroy: () => void
}

export function createQuickAdd(): QuickAdd {
  let win: BrowserWindow | null = null
  /** 真正注册成功的那一个；null = 一个都没有 */
  let active: string | null = null

  function create(): BrowserWindow {
    const w = new BrowserWindow({
      width: 440,
      height: 110,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        // preload 靠它认出自己是哪个窗口，进而只暴露 window.quickadd
        additionalArguments: [`${WINDOW_ARG_PREFIX}quickadd`]
      }
    })
    // 失焦即走。回车提交与 Esc 取消都在渲染层，但「点回原来的程序」这条路
    // 只能在这儿兜住
    w.on('blur', () => w.hide())
    w.on('closed', () => {
      win = null
    })
    void w.loadFile(join(__dirname, '../renderer/quickadd.html'))
    return w
  }

  function ensure(): BrowserWindow {
    if (win === null || win.isDestroyed()) win = create()
    return win
  }

  function show(): void {
    const w = ensure()
    w.show()
    w.focus()
  }

  function hide(): void {
    if (win !== null && !win.isDestroyed()) win.hide()
  }

  function toggle(): void {
    if (win !== null && !win.isDestroyed() && win.isVisible()) {
      win.hide()
      return
    }
    show()
  }

  function register(hotkey: string): boolean {
    try {
      return globalShortcut.register(hotkey, toggle)
    } catch {
      // 非法 accelerator 会抛而不是返回 false
      return false
    }
  }

  function setHotkey(hotkey: string): boolean {
    if (hotkey === active) return true
    const previous = active
    if (previous !== null) globalShortcut.unregister(previous)
    active = null

    if (register(hotkey)) {
      active = hotkey
      return true
    }
    if (previous !== null && register(previous)) active = previous
    return false
  }

  // 启动就预建，这样第一次按快捷键弹出来的是已经加载好的页面
  ensure()

  return {
    show,
    hide,
    isHotkeyRegistered: () => active !== null,
    setHotkey,
    destroy: () => {
      globalShortcut.unregisterAll()
      active = null
      if (win !== null && !win.isDestroyed()) win.destroy()
      win = null
    }
  }
}
