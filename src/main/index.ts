import { app, BrowserWindow, powerMonitor } from 'electron'
import { join } from 'node:path'
import { ensureAumidActivator, ensureAumidRegistered } from './aumid'
import { broadcast, registerIpc, type AppContext } from './ipc'
import { NoticeCenter } from './notices'
import { Notifier } from './notifier'
import { Scheduler } from './scheduler'
import { Store } from './store'
import { applyTheme } from './theme'
import { TrayController } from './tray'

/**
 * Windows 通知身份（AppUserModelID）。
 *
 * 开发态必须和安装版分开，否则这两个坑一定会踩：
 *
 * 1) Electron 会按当前 AUMID 自动生成一个开始菜单快捷方式（文件名 Electron.lnk，
 *    位于 %APPDATA%\Microsoft\Windows\Start Menu\Programs），因为 Windows 要求
 *    「AUMID 必须有一个开始菜单快捷方式」才肯把通知归属于本应用。
 * 2) 若开发态直接复用安装版的 AUMID，会被覆盖成指向 electron.exe，
 *    安装版的通知从此归属错乱。
 *
 * 安装版的快捷方式由 electron-builder 的 NSIS 建（shortcutName: 待办提醒）；
 * 两边的 AUMID 必须不同。
 */
const APP_NAME = 'todo-reminder'
const DEV_AUMID = 'com.tomcato.todo-reminder.dev'
const PROD_AUMID = 'com.tomcato.todo-reminder'

// 必须在取 userData 路径之前调。不设名字的话，未打包的 Electron 会共用
// %APPDATA%\Electron 当 userData，跟别的 electron.exe 开发程序互相踩数据，
// 也不符合约定的 %APPDATA%/todo-reminder/todo-reminder.json。
app.setName(APP_NAME)

const AUMID = app.isPackaged ? PROD_AUMID : DEV_AUMID
app.setAppUserModelId(AUMID)

// 光有 AUMID 不够 —— 见修正表第 11 条：必须补上 Electron 不写的注册表键，
// 否则通知完全不弹（实测）。安装版有 NSIS 建的开始菜单快捷方式兜底，
// 但重复写一遍无害且幂等，所以不做 if (app.isPackaged) 分支。
ensureAumidRegistered(AUMID, APP_NAME)

let mainWindow: BrowserWindow | null = null
let store: Store
let scheduler: Scheduler
let notifier: Notifier
let tray: TrayController

let ctx: AppContext

const notices = new NoticeCenter()

function showMainWindow(): void {
  // 第二期做真正的界面。现在只保证窗口能开，里面是占位 HTML。
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }

  mainWindow = new BrowserWindow({
    width: 420,
    height: 640,
    minWidth: 340,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // 首帧由主进程主动推一次，渲染层不需要在挂载时先 get()
  mainWindow.webContents.on('did-finish-load', () => broadcast(ctx))
  mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

/** 单实例：第二次启动时唤起已有窗口，而不是再开一个托盘图标 */
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(() => {
    store = new Store(join(app.getPath('userData'), 'todo-reminder.json'))
    if (store.corruptBackupPath !== null) {
      notices.raise({
        id: 'corrupt-backup',
        level: 'error',
        text: `数据文件损坏，已备份到 ${store.corruptBackupPath}`,
        action: { label: '打开所在文件夹', windowAction: 'open-data-dir' },
        at: Date.now()
      })
    }

    // 主题在启动时先对齐一次 —— 设置有可能被改在别处
    applyTheme(store.settings.theme)

    scheduler = new Scheduler({
      store,
      isIdle: () =>
        powerMonitor.getSystemIdleTime() >= store.settings.idleThresholdMin * 60,
      notify: (batch, desktop) => {
        // show() 前再扫一次 AUMID 激活器：Electron 何时写下自己的 CLSID 键
        // 没实测过，可能晚于启动时的 ensureAumidRegistered。扫不到就不写，
        // 留待下次 tick 重试（aumid.ts 里失败不缓存）；扫到则缓存、后续
        // 每 tick 都走廉价短路。这样窗口期内点击也不会冷启动裸 electron.exe。
        ensureAumidActivator(AUMID)
        notifier.showBatch(batch, desktop)
        tray.refresh()
        // 回填 firedFor：非静默（desktop=true）路径不靠调度器自标，
        // 必须由调用方在通知真正弹出去之后标，否则同批任务每 TICK_MS 重弹一次。
        // 静默路径调度器已自标，这里再标一次幂等、无害。
        scheduler.markFired([...batch.fresh, ...batch.missed])
        broadcast(ctx)
      }
    })

    notifier = new Notifier({
      store,
      scheduler,
      // 第二期用 taskId 把窗口定位到具体那条任务；现在只把窗口唤起来
      onFocusTask: () => showMainWindow()
    })

    tray = new TrayController({
      store,
      scheduler,
      onOpen: () => showMainWindow(),
      onQuickAdd: () => showMainWindow(),   // 第二期换独立小窗
      onSettings: () => showMainWindow(),   // 第二期换成设置页
      onQuit: () => {
        scheduler.stop()
        tray.destroy()
        app.quit()
      }
    })
    tray.create()

    // 装配：AppContext 只用**此刻已有的部件**，后面每个任务增量补自己那块。
    // 四个最小顶替（windows / hotkeyRegistered / setHotkey / quickAdd）都是
    // 「诚实回答」而不是假成功，Task 12 换成真的。
    ctx = {
      store,
      scheduler,
      notices,
      windows: () => [mainWindow].filter((w): w is BrowserWindow => w !== null),
      hotkeyRegistered: () => false,
      afterCommand: () => {
        // 完成/推迟/推到明天/新建/编辑/删除/设置变更都要立刻重算一次并刷新托盘
        scheduler.tick()
        tray.refresh()
      },
      afterPauseChange: () => tray.refresh(),
      setHotkey: () => false,
      quickAdd: { hide: () => undefined }
    }

    registerIpc(ctx)

    scheduler.start()

    // 托盘常驻，不跟随窗口关闭退出
    app.on('window-all-closed', () => undefined)
  })

  app.on('before-quit', () => scheduler?.stop())
}
