/**
 * 视觉截图工具：把日历页与倒计时页真开起来存成 PNG，用来验收配色 / 版式改动。
 * **不是测试**（断言在 `pnpm smoke` 里），这里只回答「改成什么样了」。
 *
 * ## 怎么跑
 *
 *   在 Bash 工具里跑（它会阻塞到进程退出）：
 *     unset ELECTRON_RUN_AS_NODE
 *     ./node_modules/electron/dist/electron.exe .workbuddy/tools/shot.cjs
 *     ./node_modules/electron/dist/electron.exe .workbuddy/tools/shot.cjs --dark
 *
 *   三条实测限制，踩过就别再踩：
 *   1. **`ELECTRON_RUN_AS_NODE` 必须清掉** —— 否则 `electron.exe <script>` 会以 Node 模式
 *      跑它，`require('electron')` 返回的是路径字符串而不是 API，0.5s 秒退且无任何输出。
 *   2. **PowerShell 的 `&` 不等它**（实测 0.04s 就返回，进程在后台照跑），紧跟其后的
 *      读图命令只会看到上一轮的旧图 —— 症状是「时间戳没变」，极易误判成探针坏了。
 *      要在 PowerShell 里跑就用 `Start-Process -FilePath <exe> -ArgumentList <script>
 *      -Wait -WindowStyle Hidden`（实测会一直等到进程退出）。
 *   3. **冷启动要 5–12 秒**，别拿短 timeout 卡它。
 *
 * ## 产物
 *
 * `.workbuddy/preview/{calendar,countdown,settings}-{light,dark}.png`
 * 放这儿不放 `.tmp-shot/`：那类 `.tmp-*` 是随手就清的临时目录，这几张是给人看的交付物。
 *
 * ## 两个必须记住的坑（都在下面代码里体现）
 *
 * - **主题一定要在 `loadFile` 之前设。** 窗口开在屏幕外时 Chromium 认为它被遮挡、
 *   不重新合成，换完主题再拍拿到的还是上一帧 —— 表现为「DOM 已经是深色，图还是浅色」。
 *   所以 `--dark` 走独立进程，而不是在同一个进程里连拍两套。
 * - 渲染层要的是 `todo:snapshot` 这条 **send**（不是 handle），数据形状见下面 `snapshot`。
 */
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron')
const { join } = require('node:path')
const { writeFileSync, mkdirSync } = require('node:fs')

const ROOT = join(__dirname, '..', '..')
const OUT = join(ROOT, '.workbuddy', 'preview')

const now = Date.now()
const HOUR = 3600_000
const d0 = new Date(now)
const startOfToday = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime()

const dayKeyOf = (ts) => {
  const d = new Date(ts)
  const p = (n) => (n < 10 ? '0' + n : String(n))
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()

// 任务刻意落在 2026 年 2 月（春节那段），这样一屏里能同时看到
// 休假色带、调休斜纹、逾期朱砂条和未完成圆点
const tasks = [
  {
    kind: 'deadline', id: 'late-1', title: '交季度报表', important: true,
    createdAt: at(2026, 2, 10), updatedAt: now, deletedAt: null, firedFor: null,
    dueAt: at(2026, 2, 18, 17, 0), allDay: false, leadMin: 15, snoozeUntil: null, completedAt: null
  },
  {
    kind: 'deadline', id: 'late-2', title: '回医生的电话', important: false,
    createdAt: at(2026, 2, 10), updatedAt: now, deletedAt: null, firedFor: null,
    dueAt: at(2026, 2, 20, 10, 0), allDay: false, leadMin: 15, snoozeUntil: null, completedAt: null
  },
  {
    kind: 'deadline', id: 'anytime-1', title: '把年货清单定下来', important: false,
    createdAt: at(2026, 2, 10), updatedAt: now, deletedAt: null, firedFor: null,
    dueAt: at(2026, 2, 17, 0, 0), allDay: true, leadMin: 0, snoozeUntil: null, completedAt: null
  },
  {
    kind: 'deadline', id: 'done-1', title: '给家里打个电话', important: false,
    createdAt: at(2026, 2, 10), updatedAt: now, deletedAt: null, firedFor: null,
    dueAt: at(2026, 2, 17, 20, 0), allDay: false, leadMin: 15, snoozeUntil: null,
    completedAt: at(2026, 2, 17, 21, 0)
  },
  {
    kind: 'recurring', id: 'habit', title: '早上看简历', important: false,
    createdAt: at(2026, 1, 1), updatedAt: now, deletedAt: null, firedFor: null,
    rule: { freq: 'daily', every: 1, skipWeekend: false }, remindTime: '08:30',
    lastDoneDay: dayKeyOf(startOfToday), streak: 5, snoozeUntil: null
  },
  {
    kind: 'deadline', id: 'today-1', title: '下午的会', important: false,
    createdAt: now - HOUR, updatedAt: now, deletedAt: null, firedFor: null,
    dueAt: startOfToday + 15 * HOUR, allDay: false, leadMin: 10, snoozeUntil: null, completedAt: null
  }
]

const snapshot = {
  tasks,
  anniversaries: [
    {
      id: 'ann-once', title: '术后复查', date: dayKeyOf(startOfToday + 20 * 86_400_000),
      yearly: false, lunar: false, createdAt: now - 8 * 86_400_000, updatedAt: now
    },
    {
      id: 'ann-mom', title: '妈妈生日', date: '1968-03-12', yearly: true, lunar: false,
      createdAt: now - 10 * 86_400_000, updatedAt: now
    },
    {
      id: 'ann-lunar', title: '外婆生日', date: '1990-09-24', yearly: true, lunar: true,
      createdAt: now - 9 * 86_400_000, updatedAt: now
    }
  ],
  settings: {
    schemaVersion: 3, launchAtLogin: false, notifyEnabled: true, soundEnabled: true,
    allDayRemindTime: '09:00', defaultLeadMin: 10, snoozeMinutes: 10,
    quietHours: { start: '22:00', end: '08:00' }, quietWhenIdle: false, idleThresholdMin: 5,
    push: { enabled: false, configured: false, channel: 'serverchan', when: 'awayOnly', awayIdleMin: 5 },
    hotkey: 'Control+Alt+T', theme: 'auto',
    countdownHolidays: true, countdownHorizonDays: 365,
    autoUpdate: true
  },
  runtime: {
    pausedUntil: null, hotkeyRegistered: true, corruptBackupPath: null,
    // 这两个不写的话 `newerFileVersion` 是 undefined、`undefined !== null` 为真，
    // 设置页会凭空多出一条「数据文件来自更新的版本」的告警
    droppedTaskCount: 0, newerFileVersion: null,
    notices: [], version: '0.1.6', dataFile: '（截图工具的假路径）',
    // 更新状态取自 runtime，且**开发态是 'dev'**（不检查更新、也不显示开关）。
    // 这里直接摆一个「有新版可下」的状态，好让截图能把开关和那颗按钮都拍进去
    update: {
      status: 'available', version: '0.1.7', percent: null, error: null,
      checkedAt: now, unsupported: null
    }
  }
}

// 渲染层会调的每个通道都要接上，否则点一下就抛
for (const channel of ['todo:get', 'todo:pause', 'todo:dismiss-notice']) {
  ipcMain.handle(channel, () => snapshot)
}
ipcMain.handle('todo:command', () => snapshot)
ipcMain.handle('todo:set-hotkey', () => ({ ok: true }))
ipcMain.handle('todo:window', () => undefined)
app.on('window-all-closed', () => undefined)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  mkdirSync(OUT, { recursive: true })
  const theme = process.argv.includes('--dark') ? 'dark' : 'light'

  // 主题在建窗口之前定好，理由见文件头
  nativeTheme.themeSource = theme

  // 尺寸与框都要跟 main/index.ts 的主窗口对齐：那边是无框的（自绘标题带），
  // 留着框拍出来的客户区窄一圈，标题带也就拍不准了
  const win = new BrowserWindow({
    show: true, x: -3000, y: -3000, width: 420, height: 640, frame: false,
    webPreferences: {
      preload: join(ROOT, 'out', 'preload', 'index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })
  const go = (code) => win.webContents.executeJavaScript(code, true)
  const shot = async (name) => {
    const img = await win.webContents.capturePage()
    writeFileSync(join(OUT, name + '-' + theme + '.png'), img.toPNG())
  }

  await win.loadFile(join(ROOT, 'out', 'renderer', 'index.html'))
  win.webContents.send('todo:snapshot', snapshot)
  await sleep(800)

  // 日历 → 翻到 2026 年 二月 → 选中 2/17（春节里的一天，当天还有件逾期的）
  await go(`([...document.querySelectorAll('.head__actions .iconbutton')][0].click(), 'ok')`)
  await sleep(400)
  for (let i = 0; i < 24; i++) {
    const title = await go(`(document.querySelector('.cal__title') || {}).textContent || ''`)
    if (title === '2026 年 二月') break
    await go(`(document.querySelectorAll('.cal__nav')[0].click(), 'ok')`)
    await sleep(80)
  }
  await go(`(() => {
    const c = [...document.querySelectorAll('.monthcell')].find(
      (el) => !el.classList.contains('monthcell--out') &&
        el.querySelector('.monthcell__day').textContent === '17')
    c.click()
    return 'ok'
  })()`)
  await sleep(400)
  await shot('calendar')

  // 倒计时
  await go(
    `([...document.querySelectorAll('.bottombar__link')]
       .find((el) => el.textContent.includes('倒计时')).click(), 'ok')`
  )
  await sleep(400)
  await shot('countdown')

  // 设置页（含「更新」那一组：当前版本 / 自动更新开关 / 更新状态）。
  // 用 `todo:open-view` 而不是点顶栏那枚图标 —— 和 `pnpm smoke` 走同一条路，
  // 区别只是这里开的是真窗口、要的是图。
  win.webContents.send('todo:open-view', 'settings')
  await sleep(400)
  await go(`(document.querySelector('.page__body').scrollTop = 1e6, 'ok')`)
  await sleep(200)
  await shot('settings')

  app.exit(0)
})
