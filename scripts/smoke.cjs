/**
 * 冒烟测试：把构建产物真的开起来，点一遍四个界面。
 *
 * 为什么需要它（而不是只有 typecheck + core-test）：
 * 类型检查过得去不代表点得动 —— 选择器写错、按钮不响应、渲染层挂载时抛异常、
 * 构建产物里少了一个渲染入口，这些只有真跑一遍才知道。而看板/收件箱/编辑器/
 * 设置页这四个界面没有单元测试可写，人工点一遍又太慢。
 *
 * 用法（**必须在 PowerShell 里跑**，Git Bash 下 Electron 起不来）：
 *   Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
 *   .\node_modules\electron\dist\electron.exe scripts\smoke.cjs
 *
 * 结果同时写到 stdout 和 `.tmp-smoke/report.json`。
 * 注意 electron.exe 是 GUI 子系统程序，**从 PowerShell 直接跑时 stdout 接不到控制台**，
 * 所以 .tmp-smoke/report.json 才是可靠的读取入口。
 */
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron')
const { join } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')

const ROOT = join(__dirname, '..')
const REPORT_DIR = join(ROOT, '.tmp-smoke')
const REPORT = join(REPORT_DIR, 'report.json')

/**
 * 先落一个「我起来了」的痕迹再干活。
 *
 * 因为 electron.exe 是 GUI 子系统程序，它的 stdout / stderr 在 PowerShell 里
 * **接不到控制台**：脚本在 whenReady 之前就炸掉时，外面看到的是「什么都没发生」，
 * 连个报错都没有。有了这个 boot.json，至少能分清「没起来」和「起来了但跑挂了」。
 */
const boot = {
  argv: process.argv,
  cwd: process.cwd(),
  dirname: __dirname,
  root: ROOT,
  at: new Date().toISOString()
}

const checks = []
const problems = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function dump(payload) {
  mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(REPORT, JSON.stringify(payload, null, 2), 'utf8')
}

/** 每推进一段就把现场落一次盘 —— 卡住时才知道卡在哪一段 */
let stage = 'boot'
function mark(next) {
  stage = next
  dump({ stage, boot, checks, problems })
}

mark(stage)
process.on('uncaughtException', (err) => {
  dump({ stage: 'uncaughtException@' + stage, boot, error: err && err.stack ? err.stack : String(err) })
  app.exit(1)
})
process.on('unhandledRejection', (err) => {
  dump({ stage: 'unhandledRejection@' + stage, boot, error: err && err.stack ? err.stack : String(err) })
  app.exit(1)
})

const HOUR = 3600_000
const now = Date.now()
const startOfToday = new Date(
  new Date().getFullYear(),
  new Date().getMonth(),
  new Date().getDate()
).getTime()
const pad2 = (n) => String(n).padStart(2, '0')
const dayKeyOf = (ts) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
// 「3 天前完成的习惯」那一行要断言它的文案，日期得在这里算好
const threeDaysAgo = new Date(startOfToday - 3 * 86_400_000)
const expectOldHabit = `上次 ${threeDaysAgo.getMonth() + 1}月${threeDaysAgo.getDate()}日 · 连续 2 天`

/** 造一份覆盖到每一种行/每一段的快照。字段与 shared/types.ts 一一对应 */
const todayTasks = [
  {
    kind: 'deadline', id: 'overdue', title: '上周的报销', important: false,
    createdAt: now - 5 * 86_400_000, updatedAt: now, deletedAt: null,
    firedFor: null,
    dueAt: now - 26 * HOUR, allDay: false, leadMin: 10, snoozeUntil: null, completedAt: null
  },
  {
    kind: 'deadline', id: 'upcoming', title: '下午的会', important: true,
    createdAt: now - 600_000, updatedAt: now, deletedAt: null,
    firedFor: null,
    dueAt: now + 2 * HOUR, allDay: false, leadMin: 10, snoozeUntil: null, completedAt: null
  },
  {
    kind: 'deadline', id: 'anytime', title: '填报销单', important: false,
    createdAt: now - 300_000, updatedAt: now, deletedAt: null,
    firedFor: null,
    dueAt: startOfToday,
    allDay: true, leadMin: 0, snoozeUntil: null, completedAt: null
  },
  {
    kind: 'recurring', id: 'recurring', title: '吃药', important: false,
    createdAt: now - 86_400_000, updatedAt: now, deletedAt: null,
    firedFor: null,
    rule: { freq: 'daily', every: 1, skipWeekend: false }, remindTime: '09:00',
    lastDoneDay: null, streak: 3, snoozeUntil: null
  },
  {
    kind: 'someday', id: 'someday', title: '学 Rust', important: false,
    createdAt: now - 120_000, updatedAt: now, deletedAt: null, firedFor: null
  },

  // ---- 「以后」这本账的素材 ----
  // 明天及以后的截止任务**不会出现在看板上**（groupToday 四段全只看今天），
  // 所以看板那些段计数一条都不受影响 —— 它们唯一的去处是底栏那枚「以后」入口
  {
    kind: 'deadline', id: 'future-tomorrow', title: '明天的评审', important: false,
    createdAt: now - 86_400_000, updatedAt: now, deletedAt: null,
    firedFor: null,
    dueAt: startOfToday + 86_400_000 + 17 * HOUR, allDay: false, leadMin: 10,
    snoozeUntil: null, completedAt: null
  },
  {
    kind: 'deadline', id: 'future-far', title: '下下周的搬家', important: false,
    createdAt: now - 86_400_000, updatedAt: now, deletedAt: null,
    firedFor: null,
    dueAt: startOfToday + 10 * 86_400_000, allDay: true, leadMin: 0,
    snoozeUntil: null, completedAt: null
  },

  // ---- 已完成这本账的素材 ----
  // 完成只写 completedAt / lastDoneDay，所以这几条**不会出现在看板上**
  // （groupToday 把它们过滤掉了）—— 板上的段计数因此一条都不受影响
  {
    kind: 'deadline', id: 'done-a', title: '下午签的合同', important: false,
    createdAt: now - 4 * 86_400_000, updatedAt: now, deletedAt: null,
    firedFor: null,
    dueAt: startOfToday - 86_400_000, allDay: false, leadMin: 10, snoozeUntil: null,
    completedAt: startOfToday + 14 * HOUR
  },
  {
    kind: 'deadline', id: 'done-b', title: '上午的电话', important: false,
    createdAt: now - 2 * 86_400_000, updatedAt: now, deletedAt: null,
    firedFor: null,
    dueAt: startOfToday, allDay: true, leadMin: 0, snoozeUntil: null,
    completedAt: startOfToday + 9 * HOUR
  },
  {
    kind: 'deadline', id: 'done-c', title: '昨天的牙医', important: false,
    createdAt: now - 6 * 86_400_000, updatedAt: now, deletedAt: null,
    firedFor: null,
    dueAt: startOfToday - 86_400_000, allDay: false, leadMin: 10, snoozeUntil: null,
    completedAt: startOfToday - 86_400_000 + 18 * HOUR
  },
  {
    kind: 'deadline', id: 'done-gone', title: '删掉的那条', important: false,
    createdAt: now - 86_400_000, updatedAt: now, deletedAt: now,
    firedFor: null,
    dueAt: startOfToday, allDay: true, leadMin: 0, snoozeUntil: null,
    completedAt: startOfToday + 10 * HOUR
  },
  {
    kind: 'recurring', id: 'habit-today', title: '早上看简历', important: false,
    createdAt: now - 3 * 86_400_000, updatedAt: now, deletedAt: null,
    firedFor: null,
    rule: { freq: 'daily', every: 1, skipWeekend: false }, remindTime: '08:30',
    lastDoneDay: dayKeyOf(startOfToday), streak: 5, snoozeUntil: null
  },
  {
    kind: 'recurring', id: 'habit-old', title: '每周复盘', important: false,
    createdAt: now - 20 * 86_400_000, updatedAt: now, deletedAt: null,
    firedFor: null,
    // 规则**刻意不命中今天**：命中的话它也会出现在看板上，
    // 那份 fixture 的段计数就跟着变了 —— 这条素材只该影响已完成这本账
    rule: { freq: 'weekly', every: 1, days: [(new Date().getDay() + 2) % 7], skipWeekend: false },
    remindTime: '20:00',
    lastDoneDay: dayKeyOf(startOfToday - 3 * 86_400_000), streak: 2, snoozeUntil: null
  }
]

const snapshot = {
  tasks: todayTasks,
  settings: {
    schemaVersion: 1, launchAtLogin: false, notifyEnabled: true, soundEnabled: true,
    allDayRemindTime: '09:00', defaultLeadMin: 10, snoozeMinutes: 10,
    quietHours: { start: '22:00', end: '08:00' }, quietWhenIdle: false, idleThresholdMin: 5,
    push: { enabled: false, configured: false, channel: 'serverchan', when: 'awayOnly', awayIdleMin: 5 },
    hotkey: 'Control+Alt+T', theme: 'auto'
  },
  runtime: {
    pausedUntil: null, hotkeyRegistered: true, corruptBackupPath: null,
    notices: [{ id: 'notify-failed', level: 'warn', text: '通知没发出去', at: now }],
    version: '0.1.0', dataFile: '（冒烟测试的假路径）'
  }
}

// 把渲染层会调的每一个通道都接上，否则点一下就抛
for (const channel of ['todo:get', 'todo:pause', 'todo:dismiss-notice']) {
  ipcMain.handle(channel, () => snapshot)
}
// 命令通道单独接：要顺带记下渲染层到底发了什么。
// 「主题开关发的是不是 settings:patch」这种事只有看真实报文才能断言 ——
// 光看界面有没有变是测不出来的（这里返回的是假快照，主题根本不会变）。
let sentCommands = []
ipcMain.handle('todo:command', (_e, cmd) => {
  sentCommands.push(cmd)
  return snapshot
})
ipcMain.handle('todo:set-hotkey', () => ({ ok: true }))
ipcMain.handle('todo:window', () => undefined)

// 每段跑完都会 destroy 掉自己的窗口。Electron 默认「窗口全关了 → 退出应用」，
// 于是第一段一结束整个进程就没了，后面的段连启动的机会都没有（实测：卡在
// main-done，退出码 0）。这里把默认行为关掉，退出时机由脚本自己决定。
app.on('window-all-closed', () => undefined)

function ok(name, condition, detail) {
  checks.push({ name, pass: !!condition, detail: detail === undefined ? null : detail })
  if (!condition) problems.push(`${name}${detail === undefined ? '' : ' — ' + JSON.stringify(detail)}`)
}

async function evalIn(win, code) {
  return win.webContents.executeJavaScript(code, true)
}

/**
 * 开一个离屏窗口。`winOpts` 是**窗口级**选项（width / height / frame…），
 * `additionalArguments` 单独掏出来放进 webPreferences。
 *
 * 别把窗口选项一股脑塞进 webPreferences —— BrowserWindow 会默默忽略不认识的键，
 * 于是窗口还是默认的 800×600，而所有依赖尺寸的断言都在量一个假的视口。
 * （踩过：`{width:420,height:640}` 传进去之后 innerWidth 还是 784。）
 */
function newWindow(winOpts = {}) {
  const { additionalArguments, ...windowLevel } = winOpts
  return new BrowserWindow({
    show: true,
    x: -3000,
    y: -3000,
    ...windowLevel,
    webPreferences: {
      preload: join(ROOT, 'out/preload/index.js'),
      sandbox: false,
      backgroundThrottling: false,
      ...(additionalArguments === undefined ? {} : { additionalArguments })
    }
  })
}

async function mainWindowPass() {
  // 尺寸必须和 main/index.ts 里建主窗口时一致。用 Electron 的默认 800×600 也能跑，
  // 但那量出来的换行、钳位、浮层收边全是另一套 —— 本应用是个 420 宽的窄窗，
  // 布局问题恰恰都出在窄窗上。
  const win = newWindow({ width: 420, height: 640 })
  win.webContents.on('preload-error', (_e, p, err) => problems.push(`preload 出错 ${p}: ${err.message}`))
  win.webContents.on('did-fail-load', (_e, code, desc) => problems.push(`加载失败 ${code} ${desc}`))
  win.webContents.on('render-process-gone', (_e, d) => problems.push(`渲染进程没了 ${JSON.stringify(d)}`))

  await win.loadFile(join(ROOT, 'out/renderer/index.html'))
  win.webContents.send('todo:snapshot', snapshot)
  await sleep(500)

  const board = await evalIn(win, `(() => ({
    sheets: document.styleSheets.length,
    sections: [...document.querySelectorAll('.section__name')].map(e => e.textContent),
    counts: [...document.querySelectorAll('.section__count')].map(e => e.textContent),
    day: (document.querySelector('.dateline__day') || {}).textContent,
    month: (document.querySelector('.dateline__month') || {}).textContent,
    late: (document.querySelector('.head__late') || {}).textContent || null,
    ticks: [...document.querySelectorAll('.row__tick')].map(e => e.dataset.urgency),
    tickW: [...document.querySelectorAll('.row__tick')].map(e => getComputedStyle(e, '::after').width),
    tickLeft: [...document.querySelectorAll('.row__tick')].map(e => Math.round(e.getBoundingClientRect().left)),
    clocks: [...document.querySelectorAll('.row__clock')].map(e => e.textContent),
    important: document.querySelectorAll('.row--important').length,
    oldMarker: document.querySelectorAll('.row__important').length,
    titles: [...document.querySelectorAll('.row__title-text')].map(e => e.textContent),
    rows: document.querySelectorAll('.row').length,
    inboxLink: (document.querySelector('.bottombar__link') || {}).textContent,
    notice: (document.querySelector('.noticebar__text') || {}).textContent,
    rowHeight: Math.round(((document.querySelector('.row') || {getBoundingClientRect: () => ({height: 0})}).getBoundingClientRect()).height)
  }))()`)
  ok('看板渲染四段', board.sections.join('/') === '逾期/接下来/今天随时/每天', board.sections)
  ok('段标签带计数', board.counts.join('/') === '1/1/1/1', board.counts)
  ok('看板不含清单池的任务', !board.titles.includes('学 Rust'), board.titles)
  ok('看板行数 = 四条会提醒的', board.rows === 4, board.rows)
  ok('底部收件箱入口带件数', /^收件箱 · 1 件$/.test(board.inboxLink || ''), board.inboxLink)
  ok('提示条显示出来', board.notice === '通知没发出去', board.notice)
  ok('样式表加载了', board.sheets > 0 && board.rowHeight > 20, { sheets: board.sheets, rowHeight: board.rowHeight })

  // 大号日期：今天的日 + 汉字月，逾期数在状态行里
  const today = new Date()
  ok('顶栏是大号日期', board.day === String(today.getDate()) && /月$/.test(board.month || ''), {
    day: board.day, month: board.month
  })
  ok('状态行报逾期数', board.late === '逾期 1', board.late)

  // 刻度尺：长度编码紧迫度（7 / 13 / 21px），这里只有一件逾期、没有「快到了」
  ok('刻度按紧迫度分档', board.ticks.join('/') === 'overdue/none/none/none', board.ticks)
  ok('刻度长度跟着档位变', board.tickW[0] === '21px' && board.tickW[1] === '7px', board.tickW)
  // 竖轴要是一根**通到底**的线：每一行的刻度列必须在同一个 x 上。
  // 「今天随时」那一段的行没有时刻，靠的是时刻列恒定占位撑住 —— 这条就是它的守卫
  ok('竖轴逐行对齐（含无时刻的段）', new Set(board.tickLeft).size === 1, board.tickLeft)
  ok('无时刻的行也占着时刻列', board.clocks.length === 4 && board.clocks[2] === '', board.clocks)
  // 「重要」现在只用字重说（fixture 里刚好一条），那个 3px 小方块已经撤掉了
  ok('「重要」走字重，不再加色块', board.important === 1 && board.oldMarker === 0, {
    important: board.important, oldMarker: board.oldMarker
  })

  // ---- 深浅主题 ----
  // 两件事要分开验：
  //   ① 顶栏那枚开关点下去发的是不是正确的 settings:patch（只改 theme）
  //   ② 主进程改 nativeTheme.themeSource 之后，渲染层的 prefers-color-scheme
  //      与配色是不是真的跟着走 —— 这是整套主题唯一的通路（见 main/theme.ts），
  //      它断了不会有任何报错，只会「点了没反应」。
  const wasDark = await evalIn(win, `window.matchMedia('(prefers-color-scheme: dark)').matches`)
  const toggleHits = await evalIn(win, `(() => {
    const btns = [...document.querySelectorAll('.head__actions .iconbutton')]
    return { count: btns.length, labels: btns.map(b => b.getAttribute('aria-label')) }
  })()`)
  ok('顶栏有主题开关和新建两个按钮', toggleHits.count === 2, toggleHits)
  ok('主题开关的 aria-label 说明点下去会变成什么',
    /^切到(浅色|深色)$/.test(toggleHits.labels[0] || ''), toggleHits.labels)

  sentCommands = []
  await evalIn(win, `document.querySelector('.head__actions .iconbutton').click(), 'ok'`)
  await sleep(250)
  const themeCmd = sentCommands[0]
  ok('主题开关发的是一条 settings:patch', themeCmd && themeCmd.type === 'settings:patch', themeCmd)
  ok('而且只改 theme，顺手别把别的设置冲掉',
    themeCmd && Object.keys(themeCmd.patch).join(',') === 'theme', themeCmd && themeCmd.patch)
  ok('切的是当前显示的反面（跟随系统时也不能「点一下没反应」）',
    themeCmd && themeCmd.patch.theme === (wasDark ? 'light' : 'dark'), { wasDark, cmd: themeCmd })

  // 真实通路：主进程设一下，渲染层应当立刻跟着变
  nativeTheme.themeSource = 'dark'
  await sleep(250)
  const dark = await evalIn(win, `(() => ({
    matched: window.matchMedia('(prefers-color-scheme: dark)').matches,
    paper: getComputedStyle(document.body).backgroundColor,
    label: document.querySelector('.head__actions .iconbutton').getAttribute('aria-label')
  }))()`)
  ok('themeSource=dark 时渲染层的 prefers-color-scheme 跟着变', dark.matched === true, dark)
  ok('深色下底纸用的是深色 token', dark.paper === 'rgb(15, 19, 21)', dark.paper)
  ok('开关的文案也跟着翻面', dark.label === '切到浅色', dark.label)

  nativeTheme.themeSource = 'light'
  await sleep(250)
  const light = await evalIn(win, `(() => ({
    paper: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.body).color
  }))()`)
  ok('浅色下底纸用的是浅色 token', light.paper === 'rgb(227, 231, 229)', light.paper)
  ok('浅色的字是深色（不是白字压白底）', light.ink === 'rgb(23, 33, 42)', light.ink)
  nativeTheme.themeSource = 'system'

  // 托盘菜单那条 main → renderer 的切视图链路
  win.webContents.send('todo:open-view', 'inbox')
  await sleep(300)
  const inbox = await evalIn(win, `(() => ({
    title: (document.querySelector('.topbar__title') || {}).textContent,
    rows: [...document.querySelectorAll('.row__title-text')].map(e => e.textContent),
    todayButtons: document.querySelectorAll('.row__today').length,
    dots: document.querySelectorAll('.row__dot').length
  }))()`)
  ok('收件箱只列清单池', inbox.rows.length === 1 && inbox.rows[0] === '学 Rust', inbox.rows)
  ok('清单池的行是「今天做」而不是完成圆点', inbox.todayButtons === 1 && inbox.dots === 0, inbox)

  // ---- 已完成这本账 ----
  // 入口只有底栏那枚链接（托盘菜单的 OpenView 里没有 done），所以这里就点
  // **真实入口** —— 顺便验它通。一条任务勾掉之后从看板上消失、而且没有任何
  // 地方再提到它，这个视图是它唯一的去处。
  win.webContents.send('todo:open-view', 'board')
  await sleep(250)
  const entries = await evalIn(win, `(() => {
    const links = [...document.querySelectorAll('.bottombar__link')]
    const r = links.map(e => e.getBoundingClientRect())
    return {
      count: links.length,
      texts: links.map(e => e.textContent),
      seps: links.map(e => getComputedStyle(e, '::before').height),
      gap: r.length >= 2 ? Math.round(r[1].left - r[0].right) : 0,
      fits: r.length > 0 && r[r.length - 1].right <= document.querySelector('.bottombar').getBoundingClientRect().right
    }
  })()`)
  ok('底栏是三个账本入口', entries.count === 3, entries)
  ok('以后入口带件数', /^以后 · 2 件$/.test(entries.texts[1] || ''), entries.texts)
  ok('已完成入口常驻并带件数', /^已完成 · 5 件$/.test(entries.texts[2] || ''), entries.texts)
  // 三个都叫「· N 件」的入口挨在一起会读成一句话，中间那条细竖线必须真的渲染出来。
  // 竖线挂在每个按钮自己的 ::before 上，所以按钮矩形之间的 gap 只是 flex 间距，
  // 实际留白 = gap + 1(线) + margin-right(10)
  ok('入口之间都有分隔线', entries.seps[1] === '9px' && entries.seps[2] === '9px' && entries.gap >= 9, entries)
  ok('三个入口在 420 宽里放得下', entries.fits === true, entries)

  // ---- 以后这本账 ----
  await evalIn(win, `(document.querySelectorAll('.bottombar__link')[1].click(), 'ok')`)
  await sleep(300)
  const future = await evalIn(win, `(() => {
    const rows = [...document.querySelectorAll('.row')]
    return {
      title: (document.querySelector('.topbar__title') || {}).textContent,
      sections: [...document.querySelectorAll('.section__name')].map(e => e.textContent),
      counts: [...document.querySelectorAll('.section__count')].map(e => e.textContent),
      titles: [...document.querySelectorAll('.row__title-text')].map(e => e.textContent),
      clocks: [...document.querySelectorAll('.row__clock')].map(e => e.textContent),
      // 全天那条没有时刻，但时刻列必须照样渲染 —— 否则那一段的竖轴会错位
      clockCells: document.querySelectorAll('.row__clock').length,
      dots: document.querySelectorAll('.row__dot').length
    }
  })()`)
  ok('以后顶栏标题带件数', /^以后/.test(future.title || '') && /2 件/.test(future.title || ''), future.title)
  ok('以后按天分两段', future.sections.length === 2 && future.sections[0] === '明天', future.sections)
  ok('明天那段一条', future.counts[0] === '1', future.counts)
  ok('一周以外换成日期加星期', /^\d+月\d+日 周.$/.test(future.sections[1] || ''), future.sections)
  ok('以后列的是那两条', future.titles.join(','), '明天的评审,下下周的搬家')
  ok('有时刻的那条显示截止时刻', future.clocks[0] === '17:00', future.clocks)
  ok('全天那条时刻列是空的但仍占位',
    future.clocks[1] === '' && future.clockCells === 2, future)
  ok('以后的行可以勾完成', future.dots === 2, future)

  await evalIn(win, `(document.querySelector('.row .row__more').click(), 'ok')`)
  await sleep(200)
  const futureMenu = await evalIn(win, `[...document.querySelectorAll('.rowmenu__item')].map(e => e.textContent)`)
  ok('以后的行菜单第一项是完成', futureMenu[0] === '完成', futureMenu)
  await evalIn(win, `(document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), 'ok')`)
  await sleep(150)
  await evalIn(win, `(document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'ok')`)
  await sleep(300)
  ok('Esc 从以后回到看板', (await evalIn(win, `!!document.querySelector('.dateline')`)) === true)

  await evalIn(win, `(document.querySelectorAll('.bottombar__link')[2].click(), 'ok')`)
  await sleep(300)
  const done = await evalIn(win, `(() => {
    const strikes = [...document.querySelectorAll('.strike')]
    return {
      title: (document.querySelector('.topbar__title') || {}).textContent,
      sections: [...document.querySelectorAll('.section__name')].map(e => e.textContent),
      counts: [...document.querySelectorAll('.section__count')].map(e => e.textContent),
      titles: [...document.querySelectorAll('.row__title-text')].map(e => e.textContent),
      clocks: [...document.querySelectorAll('.row__clock')].map(e => e.textContent),
      checked: document.querySelectorAll('.row__dot--on').length,
      settled: document.querySelectorAll('.row--settled').length,
      checkLabels: [...document.querySelectorAll('.row__dot--on')].map(e => e.getAttribute('aria-label')),
      strikes: strikes.length,
      strikeOn: strikes.filter(s => getComputedStyle(s.querySelector('path')).animationName === 'none').length,
      strikeW: Math.round(strikes.length ? strikes[0].getBoundingClientRect().width : 0),
      strikeFit: (() => {
        const row = document.querySelector('.row--settled')
        if (!row) return null
        const text = Math.round(row.querySelector('.row__title-text').getBoundingClientRect().width)
        const line = Math.round(row.querySelector('.strike').getBoundingClientRect().width)
        return { text, line }
      })(),
      locked: document.querySelectorAll('.row__dot[disabled]').length,
      trailing: [...document.querySelectorAll('.row__streak')].map(e => e.textContent),
      trailingFit: [...document.querySelectorAll('.row__streak')].every(e => {
        const row = e.closest('.row').getBoundingClientRect()
        const self = e.getBoundingClientRect()
        return self.right <= row.right - 4 && self.width > 20
      }),
      rowShrink: Math.round(((document.querySelector('.row') || {getBoundingClientRect: () => ({width: 0})}).getBoundingClientRect()).width),
      tickLeft: [...document.querySelectorAll('.row__tick')].map(e => Math.round(e.getBoundingClientRect().left))
    }
  })()`)
  ok('已完成顶栏标题', /^已完成/.test(done.title || ''), done.title)
  // 上面是按天的流水账，下面是习惯的现状 —— 顺序即展示顺序
  ok('账本分「今天/昨天/每天」三段', done.sections.join('/') === '今天/昨天/每天', done.sections)
  ok('每段带条数', done.counts.join('/') === '2/1/2', done.counts)
  ok('同一天里最近做完的在最上面', done.titles[0] === '下午签的合同' && done.titles[1] === '上午的电话', done.titles)
  ok('时刻列换成了完成时刻', done.clocks[0] === '14:00' && done.clocks[1] === '09:00', done.clocks)
  ok('没完成/软删的不进账', !done.titles.includes('上周的报销') && !done.titles.includes('删掉的那条'), done.titles)
  ok('软删的也不进习惯段', !done.titles.includes('除名'), done.titles)
  ok('看板上的活任务不重复出现', !done.titles.includes('下午的会') && !done.titles.includes('填报销单'), done.titles)

  // 已完成的行：勾是选中的、标题挂静态墨线、整行淡下去
  ok('已完成的勾是选中态', done.checked === 4 && done.settled === 4, { checked: done.checked, settled: done.settled })
  ok('勾的读屏名是「取消完成…」', done.checkLabels.every((l) => /^取消完成/.test(l || '')), done.checkLabels)
  // 静态墨线：必须**已经画完**（animationName 为 none），否则整本账的字都看不出被划掉
  ok('每个已完成行都挂着一笔墨线', done.strikes === 4, { strikes: done.strikes, on: done.strikeOn })
  ok('墨线是静态画完的，不是停在起点的动画帧', done.strikeOn === 4, done.strikeOn)
  ok('墨线量到了字的宽度（不是 0）', done.strikeW > 20, done.strikeW)
  // 墨线要贴的是**字**的宽度、且往两侧各出头 2px —— 量错包含块的话
  // （比如贴到 flex:1 撑满整行的 .row__title 上）它会一路拖到行尾
  ok('墨线贴着字的宽度、只出头 2px',
    done.strikeFit !== null && done.strikeFit.line > done.strikeFit.text &&
      done.strikeFit.line - done.strikeFit.text <= 8, done.strikeFit)

  // 习惯段：今天打过卡的划掉且勾点不动；更早打的是一条活着的习惯
  ok('今天打过卡的勾是灰的（点不动）', done.locked === 1, done.locked)
  ok('习惯段写「今天已打卡 · 连续 N 天」', done.trailing.includes('今天已打卡 · 连续 5 天'), done.trailing)
  ok('更早打的写「上次 M月D日 · 连续 N 天」', done.trailing.includes(expectOldHabit), done.trailing)
  // 行尾那串字不能被挤出 420 的窗口：窄窗里它是最长的一段补充文字
  ok('行尾的打卡文字没有溢出窗口', done.trailingFit === true, done.trailingFit)

  // 竖轴在这本账里也要是一根通到底的线（行结构复用同一套几何）
  ok('账本里的竖轴逐行对齐', new Set(done.tickLeft).size === 1, done.tickLeft)

  // 点勾 = 取消完成，发的是 task:uncomplete（不是 complete）
  sentCommands = []
  await evalIn(win, `(document.querySelector('.row--settled .row__dot').click(), 'ok')`)
  await sleep(200)
  ok('已完成清单里点勾发的是 task:uncomplete',
    sentCommands[0] && sentCommands[0].type === 'task:uncomplete', sentCommands[0])
  ok('取消完成带的是那条任务的 id',
    sentCommands[0] && sentCommands[0].id === 'done-a', sentCommands[0])
  // 「它去哪儿了」是这本账唯一需要额外解释的一件事
  ok('取消完成时给一句「已收回今天」',
    (await evalIn(win, `(document.querySelector('.flash__inner') || {}).textContent || null`)) === '已收回今天')

  // 0.1.2 真人验收发现的：操作提示气泡压在「+ 记一件」上。气泡是按 bottom 绝对定位的，
  // 记一件是后来插在底栏上方那一块 —— 两个都会说话就叠在一起。切回看板量一次：
  // 气泡还在 2.5 秒存活期内，而这正是真实里最常见的时机（在已完成点完勾回看板）。
  win.webContents.send('todo:open-view', 'board')
  await sleep(150)
  const clash = await evalIn(win, `(() => {
    const f = document.querySelector('.flash'), b = document.querySelector('.addbar__button')
    if (!f || !b) return null
    const a = f.getBoundingClientRect(), c = b.getBoundingClientRect()
    return { flashBottom: Math.round(a.bottom), btnTop: Math.round(c.top) }
  })()`)
  ok('切回看板时气泡还挂着（2.5 秒没到）', clash !== null, clash)
  ok('操作提示气泡不压住「+ 记一件」',
    clash !== null && clash.flashBottom <= clash.btnTop, clash)

  // 回已完成 —— 下面几步是在那本账里点的
  await evalIn(win, `(document.querySelectorAll('.bottombar__link')[2].click(), 'ok')`)
  await sleep(200)

  // 行内菜单第一项也要跟着变成「取消完成」。
  // 先等 520ms 的退场走完 —— 退场行的 pointer-events 是 none，而我们要点的
  // 恰好是刚被取消完成的那一行
  await sleep(700)
  await evalIn(win, `(document.querySelector('.row .row__more').click(), 'ok')`)
  await sleep(200)
  const menuItems = await evalIn(win, `[...document.querySelectorAll('.rowmenu__item')].map(e => e.textContent)`)
  ok('已完成行的菜单第一项是「取消完成」', menuItems[0] === '取消完成', menuItems)
  await evalIn(win, `(document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), 'ok')`)
  await sleep(150)
  ok('点外面能把菜单收起来', (await evalIn(win, `document.querySelectorAll('.rowmenu').length`)) === 0)

  // Esc 回看板（useAppState 那条逐级返回）
  await evalIn(win, `(document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'ok')`)
  await sleep(300)
  const back = await evalIn(win, `!!document.querySelector('.dateline')`)
  ok('Esc 从已完成回到看板', back === true, back)

  win.webContents.send('todo:open-view', 'settings')
  await sleep(300)
  const settings = await evalIn(win, `(() => ({
    groups: [...document.querySelectorAll('.group__label')].map(e => e.textContent),
    labels: [...document.querySelectorAll('.field__label')].map(e => e.textContent),
    checks: document.querySelectorAll('.check').length,
    hotkey: (document.querySelector('.field--stack input.mono') || {}).value,
    hint: (document.querySelector('.field--stack .field__hint') || {}).textContent,
    timeFields: document.querySelectorAll('.timefield').length,
    nativeTime: document.querySelectorAll('input[type=time]').length,
    bodyOverflow: document.querySelector('.page__body').scrollHeight > document.querySelector('.page__body').clientHeight + 2
  }))()`)
  ok('设置页五个分组都在', settings.groups.join('/') === '提醒/免打扰/外观与启动/随手记/数据', settings.groups)
  ok('设置页复选框都渲染了', settings.checks >= 5, settings.checks)
  ok('设置页有「窗口置顶」这一格', settings.labels.includes('窗口置顶'), settings.labels)
  ok('快捷键读的是 settings.hotkey', settings.hotkey === 'Control+Alt+T', settings.hotkey)
  ok('快捷键状态文案跟着 runtime 走', /注册上了|小窗/.test(settings.hint || ''), settings.hint)
  ok('设置页的时刻也换成了自绘控件（全天 + 免打扰起止）', settings.timeFields === 3 && settings.nativeTime === 0, settings)
  ok('设置页内容比视口长（能滚）', settings.bodyOverflow === true, settings.bodyOverflow)

  // 编辑器：从看板点「+ 记一件」（底栏上方那个实心块；顶栏那两个是主题与设置）
  win.webContents.send('todo:open-view', 'board')
  await sleep(200)
  await evalIn(win, `document.querySelector('.addbar__button').click(), 'ok'`)
  await sleep(300)
  const editor = await evalIn(win, `(() => ({
    title: (document.querySelector('.topbar__title') || {}).textContent,
    kinds: [...document.querySelectorAll('.segmented')][0] ? [...[...document.querySelectorAll('.segmented')][0].children].map(b => b.textContent) : [],
    labels: [...document.querySelectorAll('.field__label')].map(e => e.textContent),
    dateFields: document.querySelectorAll('.datefield').length,
    nativeDate: document.querySelectorAll('input[type=date]').length,
    nativeTime: document.querySelectorAll('input[type=time]').length,
    save: (document.querySelector('.topbar__button') || {}).textContent,
    hasDelete: !!document.querySelector('.bottombar__danger')
  }))()`)
  ok('新建时是「记一件」', editor.title === '记一件', editor.title)
  ok('三种类型可选', editor.kinds.join('/') === '截止/周期/清单', editor.kinds)
  ok('截止型的字段齐', ['日期', '时刻', '备注', '重要'].every((l) => editor.labels.includes(l)), editor.labels)
  ok('日期用的是自绘控件，不是原生 input', editor.dateFields === 1 && editor.nativeDate === 0, editor)
  ok('时刻也不是原生 input', editor.nativeTime === 0, editor.nativeTime)
  ok('新建时没有删除入口', editor.hasDelete === false)

  // ---- 自绘日期控件：弹出月历、翻月、点一格 ----
  await evalIn(win, `document.querySelector('.datefield').click(), 'ok'`)
  await sleep(250)
  const cal = await evalIn(win, `(() => {
    const grid = document.querySelector('.cal__grid')
    return {
      open: !!document.querySelector('.popover--cal'),
      title: (document.querySelector('.cal__title') || {}).textContent,
      dows: [...document.querySelectorAll('.cal__dow')].map(e => e.textContent),
      cells: document.querySelectorAll('.cal__cell').length,
      cols: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 0,
      today: document.querySelectorAll('.cal__cell--today').length,
      on: document.querySelectorAll('.cal__cell--on').length,
      out: document.querySelectorAll('.cal__cell--out').length,
      chips: [...document.querySelectorAll('.cal__chip')].map(e => e.textContent),
      inline: (document.querySelector('.datefield__text') || {}).textContent,
      rel: (document.querySelector('.datefield__rel') || {}).textContent,
      box: (() => {
        const r = document.querySelector('.popover--cal').getBoundingClientRect()
        return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) }
      })(),
      viewport: { w: window.innerWidth, h: window.innerHeight }
    }
  })()`)
  ok('点日期弹出的是自绘月历', cal.open === true, cal)
  ok('月历整个落在窗口里（没被裁）',
    cal.box.left >= 0 && cal.box.top >= 0 && cal.box.right <= cal.viewport.w && cal.box.bottom <= cal.viewport.h,
    cal)
  ok('月历固定 7 列、格子数是 7 的整数倍', cal.cols === 7 && cal.cells % 7 === 0, cal)
  ok('表头从周一开始', cal.dows.join('') === '一二三四五六日', cal.dows)
  ok('今天被圈出来，且只有一个', cal.today === 1, cal.today)
  ok('当前值被选中，且只有一个', cal.on === 1, cal.on)
  ok('首尾补了邻月的日子（能点到 10 月 1 号）', cal.out > 0, cal.out)
  ok('三个月历常用入口', cal.chips.join('/') === '今天/明天/下周一', cal.chips)
  ok('触发按钮上写着相对日', cal.rel === '今天', cal.rel)
  ok('月份标题是汉字月', /^\d{4} 年 .月$/.test(cal.title || ''), cal.title)

  // 点「明天」：值要变、浮层要关、按钮上的字要跟着变
  await evalIn(win, `[...document.querySelectorAll('.cal__chip')][1].click(), 'ok'`)
  await sleep(250)
  const picked = await evalIn(win, `(() => {
    const d = new Date(); d.setDate(d.getDate() + 1)
    return {
      open: !!document.querySelector('.popover--cal'),
      rel: (document.querySelector('.datefield__rel') || {}).textContent,
      text: (document.querySelector('.datefield__text') || {}).textContent,
      expect: (d.getMonth() + 1) + '月' + d.getDate() + '日'
    }
  })()`)
  ok('选完就收起来', picked.open === false, picked)
  ok('选「明天」后摘要跟着变', picked.rel === '明天' && picked.text === picked.expect, picked)

  // ---- 自绘时间控件：24 时 + 12 个分钟档 ----
  await evalIn(win, `document.querySelector('.page__body input[type=checkbox]').click(), 'ok'`)
  await sleep(200)
  await evalIn(win, `document.querySelector('.timefield').click(), 'ok'`)
  await sleep(250)
  const tp = await evalIn(win, `(() => {
    const hg = document.querySelector('.timepick__grid--h')
    const mg = document.querySelector('.timepick__grid--m')
    return {
      open: !!document.querySelector('.popover--time'),
      hours: document.querySelectorAll('.timepick__grid--h .timepick__cell').length,
      minutes: document.querySelectorAll('.timepick__grid--m .timepick__cell').length,
      hCols: hg ? getComputedStyle(hg).gridTemplateColumns.split(' ').length : 0,
      hOn: (document.querySelector('.timepick__grid--h .timepick__cell--on') || {}).textContent,
      mOn: (document.querySelector('.timepick__grid--m .timepick__cell--on') || {}).textContent,
      value: (document.querySelector('.timefield') || {}).textContent,
      box: (() => {
        const r = document.querySelector('.popover--time').getBoundingClientRect()
        return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) }
      })(),
      viewport: { w: window.innerWidth, h: window.innerHeight }
    }
  })()`)
  ok('点时刻弹出的是自绘控件', tp.open === true, tp)
  ok('时间浮层整个落在窗口里（没被裁）',
    tp.box.left >= 0 && tp.box.top >= 0 && tp.box.right <= tp.viewport.w && tp.box.bottom <= tp.viewport.h,
    tp)
  ok('摆出全部 24 个小时', tp.hours === 24 && tp.hCols === 4, tp)
  ok('分钟按 5 分钟一档（12 档）', tp.minutes === 12, tp.minutes)
  ok('当前时刻的那两格被选中', /^\d{2}$/.test(tp.hOn || '') && /^\d{2}$/.test(tp.mOn || ''), tp)
  ok('选中的两格拼起来正好等于按钮上的值',
    `${tp.hOn}:${tp.mOn}` === (tp.value || '').trim(), tp)

  // 点「08」时：值要变成 08:原来的分
  await evalIn(win, `[...document.querySelectorAll('.timepick__grid--h .timepick__cell')][8].click(), 'ok'`)
  await sleep(250)
  const afterHour = await evalIn(win, `(() => ({
    value: (document.querySelector('.timefield') || {}).textContent,
    mOn: (document.querySelector('.timepick__grid--m .timepick__cell--on') || {}).textContent,
    stillOpen: !!document.querySelector('.popover--time')
  }))()`)
  ok('点了「08 时」值就变', (afterHour.value || '').trim() === `08:${afterHour.mOn}`, afterHour)
  ok('选完时刻不急着关（分钟还没选）', afterHour.stillOpen === true, afterHour)

  // Esc 关掉浮层：**不能**顺带把用户弹回看板（Esc 的逐级返回挂在 window 冒泡阶段，
  // 浮层那条监听挂在 window 捕获阶段并 stopPropagation）。
  //
  // 派发目标必须是 body，不能是 window：直接 dispatch 到 window 时事件的目标就是
  // window，此时**同一节点上的捕获监听与冒泡监听都在「目标阶段」按注册顺序跑**，
  // stopPropagation 拦不住后者 —— 会测出一个真实使用时不会发生的「连退两级」。
  await evalIn(win, `document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'ok'`)
  await sleep(250)
  const afterEsc = await evalIn(win, `(() => ({
    open: !!document.querySelector('.popover--time'),
    title: (document.querySelector('.topbar__title') || {}).textContent
  }))()`)
  ok('Esc 关掉时间浮层', afterEsc.open === false, afterEsc)
  ok('Esc 关浮层时不会把人弹回看板', afterEsc.title === '记一件', afterEsc.title)

  // 切周期 → 每周：规则那一块要长出来
  await evalIn(win, `document.querySelectorAll('.segmented')[0].children[1].click(), 'ok'`)
  await sleep(250)
  await evalIn(win, `document.querySelectorAll('.segmented')[1].children[1].click(), 'ok'`)
  await sleep(250)
  const weekly = await evalIn(win, `(() => ({
    labels: [...document.querySelectorAll('.field__label')].map(e => e.textContent),
    weekdays: [...[...document.querySelectorAll('.segmented')][2].children].map(b => b.textContent),
    timeFields: document.querySelectorAll('.timefield').length
  }))()`)
  ok('周期型出现频率/间隔/提醒时刻', ['频率', '间隔', '提醒时刻'].every((l) => weekly.labels.includes(l)), weekly.labels)
  ok('每周出现星期选择器', weekly.weekdays.join('') === '一二三四五六日', weekly.weekdays)
  ok('目前没有日期控件了（换成了规则）', !weekly.labels.includes('日期'), weekly.labels)
  ok('提醒时刻用的也是自绘控件', weekly.timeFields === 1, weekly.timeFields)

  // 空标题提交：留下人话，不离开编辑器
  await evalIn(win, `document.querySelector('.topbar__button').click(), 'ok'`)
  await sleep(200)
  const empty = await evalIn(win, `(() => ({
    warn: (document.querySelector('.field__hint--warn') || {}).textContent || null,
    title: (document.querySelector('.topbar__title') || {}).textContent
  }))()`)
  ok('空标题提交被挡住并给出原因', empty.warn === '标题不能是空的', empty.warn)
  ok('空标题提交后仍留在编辑器', empty.title === '记一件', empty.title)

  // 每月：31 个格子
  await evalIn(win, `document.querySelectorAll('.segmented')[1].children[2].click(), 'ok'`)
  await sleep(250)
  const monthly = await evalIn(win, `(() => ({
    grid: document.querySelectorAll('.daygrid__item').length,
    on: document.querySelectorAll('.daygrid__item--on').length
  }))()`)
  ok('每月有 31 个日子可选且默认选中今天', monthly.grid === 31 && monthly.on === 1, monthly)

  win.destroy()
}

async function quickAddPass() {
  const win = newWindow({ width: 440, height: 110, frame: false, additionalArguments: ['--todo-window=quickadd'] })
  win.webContents.on('preload-error', (_e, p, err) => problems.push(`quickadd preload 出错 ${p}: ${err.message}`))

  await win.loadFile(join(ROOT, 'out/renderer/quickadd.html'))
  await sleep(400)
  const qa = await evalIn(win, `(() => {
    const el = document.querySelector('.quickadd')
    const row = document.querySelector('.quickadd__row')
    return {
      hasApi: typeof window.quickadd === 'object' && window.quickadd !== null,
      hasSubmit: typeof (window.quickadd || {}).submit === 'function',
      hasCancel: typeof (window.quickadd || {}).cancel === 'function',
      leakedTodo: typeof window.todo,
      buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()),
      time: (document.querySelector('.quickadd__time') || {}).value,
      timeKind: (document.querySelector('.quickadd__time') || {}).type,
      sheets: document.styleSheets.length,
      viewport: document.documentElement.clientHeight,
      inputH: Math.round((document.querySelector('.quickadd__title') || {getBoundingClientRect: () => ({height: 0})}).getBoundingClientRect().height),
      rowBottom: row ? Math.round(row.getBoundingClientRect().bottom) : -1
    }
  })()`)
  ok('快速添加窗只暴露 window.quickadd', qa.hasApi && qa.hasSubmit && qa.hasCancel && qa.leakedTodo === 'undefined',
    { hasApi: qa.hasApi, leakedTodo: qa.leakedTodo })
  ok('三个按钮：今天全天 / 明天全天 / 今天这个点',
    qa.buttons.join('/') === '今天 全天/明天 全天/今天这个点', qa.buttons)
  ok('默认时刻是下一个半点', /^\d{2}:(00|30)$/.test(qa.time || ''), qa.time)
  ok('时刻是纯文本输入（不是原生 time 控件）', qa.timeKind === 'text', qa.timeKind)
  ok('样式加载了', qa.sheets > 0, qa.sheets)

  // 手输的时刻要能被规整：1430 → 14:30。
  // 注意派发的是 **focusout** 而不是 blur：React 17+ 把 onBlur 挂在 focusout 上
  // （原生 blur 不冒泡，React 早就改用它了），派 blur 的话处理函数根本不会跑。
  await evalIn(win, `(() => {
    const i = document.querySelector('.quickadd__time')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(i, '1430')
    i.dispatchEvent(new Event('input', { bubbles: true }))
    i.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    return i.value
  })()`)
  await sleep(200)
  const typedNow = await evalIn(win, `document.querySelector('.quickadd__time').value`)
  ok('手输 1430 会被规整成 14:30', typedNow === '14:30', typedNow)
  // 输入框 flex:1 吃掉多余高度，按钮行就永远贴着底部 ——
  // 窗口高度不必和内容像素级对齐，松一点也不该在下面留个洞
  ok('110px 装得下（内容没被切）', qa.rowBottom > 0 && qa.rowBottom <= qa.viewport, { rowBottom: qa.rowBottom, viewport: qa.viewport })
  ok('输入框吃掉了多余高度', qa.inputH >= 36, { inputH: qa.inputH, viewport: qa.viewport })
  ok('按钮行贴着底部（不留洞）', qa.viewport - qa.rowBottom <= 16, { gap: qa.viewport - qa.rowBottom })

  win.destroy()
}

app.whenReady().then(async () => {
  mark('ready')
  try {
    await mainWindowPass()
    mark('main-done')
    await sleep(150)
    await quickAddPass()
    mark('quick-done')
  } catch (err) {
    problems.push('探针自己炸了：' + (err && err.stack ? err.stack : String(err)))
  }

  const passed = checks.filter((c) => c.pass).length
  for (const c of checks) {
    console.log(`${c.pass ? 'ok  ' : 'FAIL'}  ${c.name}${c.pass ? '' : '  ' + JSON.stringify(c.detail)}`)
  }
  console.log(`\n冒烟 ${passed}/${checks.length} 项通过`)
  if (problems.length > 0) {
    console.log('\n问题：')
    for (const p of problems) console.log('  - ' + p)
  }

  mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(
    REPORT,
    JSON.stringify({ stage: 'done', boot, passed, total: checks.length, checks, problems }, null, 2),
    'utf8'
  )
  app.exit(problems.length === 0 ? 0 : 1)
})
