import { app, BrowserWindow, powerMonitor, shell } from 'electron'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAumidRegistered, writeAumidActivator } from './aumid'
import { windowIconPath } from './icons'
import { broadcast, registerIpc, runCommand, type AppContext } from './ipc'
import type { Command, CommandResult } from '../shared/commands'
import { isValidHotkey } from '../shared/hotkey'
import { IPC, type Notice, type OpenView } from '../shared/ipc'
import { NoticeCenter } from './notices'
import { Notifier } from './notifier'
import { createQuickAdd, type QuickAdd } from './quickadd'
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
/** 通知右上角的署名，与 electron-builder.yml 的 productName 保持一致 */
const DISPLAY_NAME = '待办提醒'
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
ensureAumidRegistered(AUMID, DISPLAY_NAME)

/**
 * `CustomActivator` 该指哪个 GUID。
 *
 * 结论是**不钉死**：必须是 Electron 这次运行时真正注册的那个，理由见
 * `aumid.ts` 的 `writeAumidActivator`。这里只负责把它读出来，读两个地方，
 * **快捷方式优先**：
 *
 * 1. 开始菜单里那条属于本 AUMID 的快捷方式上的
 *    `System.AppUserModel.ToastActivatorCLSID`。Electron 注册时若看见它，就会
 *    改用这个值（`EnsureShortcut()` 里的 `SetAppToastActivatorCLSID`），所以它才
 *    是最终值 —— 而 `app.toastActivatorCLSID` 在那之前读到的还是 Electron 自己
 *    准备用的值，两者在「首次注册之前」并不相同，必须先看快捷方式。
 * 2. `app.toastActivatorCLSID`：没有快捷方式时，Electron 就是拿这个值去建
 *    快捷方式并注册的，也就是最终值。
 *
 * 读快捷方式而不是去注册表反查 CLSID 键，是因为键会攒（每次重装、每次随机
 * GUID 都留一条指向同一个 exe 的陈旧键），挑中哪条全看运气；快捷方式只有一条，
 * 而且按 AUMID 认人，是准的。
 */
function shortcutActivatorClsid(): string | null {
  try {
    const dir = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    for (const name of readdirSync(dir)) {
      if (!name.toLowerCase().endsWith('.lnk')) continue
      try {
        const details = shell.readShortcutLink(join(dir, name))
        if (details.appUserModelId === AUMID && details.toastActivatorClsid) {
          return details.toastActivatorClsid
        }
      } catch {
        // 单条读不了（坏文件/不是快捷方式）不该拖垮整轮
      }
    }
  } catch {
    // 目录读不到（权限、路径变化）就当没有快捷方式，退回 app 的值
  }
  return null
}

/** 已经写进注册表的那个值，省掉「值没变还去写一遍注册表」 */
let activatorClsid: string | null = null

/**
 * 把 `CustomActivator` 对齐到 Electron 实际注册的 GUID。启动时先来一次，
 * 之后每次弹通知前后各跟一次 —— 首条通知那一刻 Electron 才会跑它自己的注册
 * （`RegisterActivator` 在后台线程里建快捷方式、写 CLSID 键、注册 COM 类对象），
 * 后面那一次就是把「注册之后才定下来的值」补上。写一次注册表很便宜，
 * 只有值真的变了才写。
 */
function syncToastActivator(): void {
  if (process.platform !== 'win32') return
  let clsid: string
  try {
    clsid = shortcutActivatorClsid() ?? app.toastActivatorCLSID
  } catch {
    // app.toastActivatorCLSID 读不到（老版本 / 非 win32）就不动它
    return
  }
  if (!clsid || clsid === activatorClsid) return
  if (writeAumidActivator(AUMID, clsid)) activatorClsid = clsid
}

let mainWindow: BrowserWindow | null = null
let store: Store
let scheduler: Scheduler
let notifier: Notifier
let tray: TrayController
let quickAdd: QuickAdd

let ctx: AppContext

const notices = new NoticeCenter()

function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }

  const icon = windowIconPath()

  mainWindow = new BrowserWindow({
    width: 420,
    height: 640,
    minWidth: 340,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    alwaysOnTop: store.settings.alwaysOnTop,
    // 不给的话开发态任务栏上是 Electron 的默认原子图标；打包后走 exe 内嵌图标
    ...(icon === null ? {} : { icon }),
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

/**
 * 「把主窗口打开并告诉它该显示什么」。
 *
 * 单独抽出来是因为托盘菜单和系统通知都走这条路，而它们和 `showMainWindow`
 * 有一处不同：**窗口可能是这一次才建出来的**，此刻渲染层还没挂载，直接 send
 * 会石沉大海。所以首帧没好的时候挂到 did-finish-load 上补发。
 * 那个事件上已经挂了 broadcast（在 showMainWindow 里注册的，先于这里），
 * 所以补发时渲染层手里一定已经有快照了。
 */
function openMain(view: OpenView | null, focusTaskId: string | null): void {
  showMainWindow()
  const win = mainWindow
  if (win === null || win.isDestroyed()) return

  const send = (): void => {
    if (win.isDestroyed()) return
    if (view !== null) win.webContents.send(IPC.openView, view)
    if (focusTaskId !== null) win.webContents.send(IPC.focusTask, { taskId: focusTaskId })
  }
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
  else send()
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

    // 通知能不能点回来，全看 `CustomActivator` 与 Electron 注册的那个 GUID
    // 是否一致。启动先把上一次运行留下的值校正过来。
    syncToastActivator()

    app.setLoginItemSettings({
      openAtLogin: store.settings.launchAtLogin,
      path: process.execPath
    })

    scheduler = new Scheduler({
      store,
      isIdle: () =>
        powerMonitor.getSystemIdleTime() >= store.settings.idleThresholdMin * 60,
      notify: (batch) => {
        // 首条通知这一刻 Electron 才真去注册（建快捷方式 + 写 CLSID 键 + 注册
        // COM 类对象，都在后台线程），所以前后各对齐一次，别让 `CustomActivator`
        // 落在一个没有活实例的 GUID 上 —— 那样点「完成」是什么都不会发生的
        syncToastActivator()
        notifier.showBatch(batch)
        syncToastActivator()
        tray.refresh()
        // 回填 firedFor：通知真弹出去之后才标，否则同批任务每 TICK_MS 重弹一次
        scheduler.markFired([...batch.fresh, ...batch.missed])
        broadcast(ctx)
      }
    })

    quickAdd = createQuickAdd()

    const raiseNotice = (notice: Notice): void => {
      notices.raise(notice)
      broadcast(ctx)
    }

    notifier = new Notifier({
      store,
      // 通知上的三个按钮与界面走同一条命令层：tick、托盘刷新、广播都在里面
      runCommand: (cmd) => void runCommand(ctx, cmd),
      // 点通知要落到**具体那一条**上：只把窗口唤起来，用户还得自己在列表里找
      onFocusTask: (taskId) => openMain(null, taskId),
      raiseNotice
    })

    tray = new TrayController({
      store,
      scheduler,
      onOpen: () => showMainWindow(),
      onQuickAdd: () => quickAdd.show(),
      onSettings: () => openMain('settings', null),
      onQuit: () => {
        scheduler.stop()
        tray.destroy()
        app.quit()
      }
    })
    tray.create()

    // 装配：AppContext 用的都是此刻已经存在的部件。
    // 快捷键这一组走 quickadd.ts —— 那里才知道「真注册上了没有」
    ctx = {
      store,
      scheduler,
      notices,
      windows: () => [mainWindow].filter((w): w is BrowserWindow => w !== null),
      hotkeyRegistered: () => quickAdd.isHotkeyRegistered(),
      afterCommand: (cmd: Command, _result: CommandResult) => {
        // 原规格 §6.4：完成/推迟/推到明天/新建/编辑/删除/设置变更
        // 都要立刻重算一次并刷新托盘
        scheduler.tick()
        tray.refresh()
        if (cmd.type !== 'settings:patch') return
        if (cmd.patch.theme !== undefined) applyTheme(store.settings.theme)
        if (cmd.patch.alwaysOnTop !== undefined) {
          // 窗口可能还没建（藏在托盘里）—— 那种情况下 openMain 会读设置建对，
          // 这里只管已经存在的那个
          mainWindow?.setAlwaysOnTop(store.settings.alwaysOnTop)
        }
        if (cmd.patch.launchAtLogin !== undefined) {
          app.setLoginItemSettings({
            openAtLogin: store.settings.launchAtLogin,
            path: process.execPath
          })
        }
        // 注意这里**没有** hotkey 的分支：快捷键走 IPC.setHotkey，
        // 因为那条路要求先试注册、成功才写设置
      },
      afterPauseChange: () => tray.refresh(),
      setHotkey: (hotkey) => quickAdd.setHotkey(hotkey),
      quickAdd: { hide: () => quickAdd.hide() }
    }

    registerIpc(ctx)

    // 带 `--open` 启动时直接把主窗口打开。
    // 平时这是个纯托盘应用，启动完屏幕上什么都不出现 —— 但要"看一眼界面"的时候，
    // 不该先让人去右下角找托盘图标。用法：electron . --open
    if (process.argv.includes('--open')) showMainWindow()

    // 启动时把存着的快捷键注册上。注册失败**不报错也不清设置** ——
    // 多半是那个组合被别的程序抢了，界面会据 hotkeyRegistered 显示出来，
    // 用户改一个就好；这里清掉反而让他不知道原来设的是什么
    if (isValidHotkey(store.settings.hotkey)) quickAdd.setHotkey(store.settings.hotkey)

    scheduler.start()

    // 托盘常驻，不跟随窗口关闭退出
    app.on('window-all-closed', () => undefined)
  })

  app.on('before-quit', () => {
    scheduler?.stop()
    // 热键要解绑：不解绑的话进程虽然退了，组合键在系统里还是被占着
    quickAdd?.destroy()
  })
}
