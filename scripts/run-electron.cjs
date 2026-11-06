/**
 * 用 electron 跑一个脚本的通用启动器 —— 先删 `ELECTRON_RUN_AS_NODE`，再 spawn。
 *
 *   node scripts/run-electron.cjs scripts/smoke.cjs
 *   node scripts/run-electron.cjs .workbuddy/tools/shot.cjs --dark
 *
 * ## 它解决什么
 *
 * 某些宿主环境（WorkBuddy / DSH 这类把 Node 塞进 Electron 壳的应用）会给子进程
 * 注入 `ELECTRON_RUN_AS_NODE=1`。设了它之后 electron.exe 以**纯 Node 模式**启动：
 * `require('electron')` 返回安装路径字符串而不是 API，`app` 是 undefined ——
 * 于是主进程第一句 `app.setName(...)`（或者探针里的 `app.whenReady()`）就抛
 * `TypeError: Cannot read properties of undefined`，栈尾还挂着 `Node.js v24.x`。
 *
 * ## 为什么必须在外面删，不能在里面删
 *
 * 等 electron 跑起来的时候，`electron` 模块**已经**被解析成字符串了，
 * 再 `delete process.env.ELECTRON_RUN_AS_NODE` 救不回来。
 * 只有让 electron 进程**从一开始就看不到这个变量**才有效。
 *
 * ## 为什么是删，不是置空、也不是置 '0'（2026-11-06 逐条实测）
 *
 *   - `ELECTRON_RUN_AS_NODE=`（空串）→ **直接崩**，exit 134，
 *     `Assertion failed: (isolate_data->snapshot_data()) != nullptr`
 *   - `ELECTRON_RUN_AS_NODE=0` → 仍然是 Node 模式
 *   - 只有**变量不存在**（undefined）才是 GUI 模式
 *
 * Electron 判断的是变量**存不存在**，不是它的值。所以唯一正确的写法是 delete。
 *
 * ## 对正常环境无害
 *
 * 没有该变量的机器上，`delete` 一个不存在的键是空操作，行为与直接跑 electron 完全一致。
 */

const { spawn } = require('node:child_process')
const { join, isAbsolute } = require('node:path')
const { existsSync } = require('node:fs')

delete process.env.ELECTRON_RUN_AS_NODE

const ROOT = join(__dirname, '..')
const target = process.argv[2]

if (target === undefined) {
  console.error('[run-electron] 用法：node scripts/run-electron.cjs <要跑的脚本> [...参数]')
  process.exit(1)
}

// electron 的 npm 包在 Node 里 `require` 出来的就是可执行文件路径。
// 别写死 `dist/electron.exe` —— 不同平台布局不一样。
const electronPath = require('electron')

if (typeof electronPath !== 'string' || !existsSync(electronPath)) {
  console.error(`[run-electron] 找不到 electron 可执行文件：${electronPath}`)
  console.error('[run-electron] 试一下 `node node_modules/electron/install.js`')
  process.exit(1)
}

const scriptPath = isAbsolute(target) ? target : join(ROOT, target)
if (!existsSync(scriptPath)) {
  console.error(`[run-electron] 找不到脚本：${scriptPath}`)
  process.exit(1)
}

const child = spawn(electronPath, [scriptPath, ...process.argv.slice(3)], {
  cwd: ROOT,
  stdio: 'inherit'
})

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[run-electron] 被信号 ${signal} 终止`)
    process.exit(1)
  }
  process.exit(code ?? 0)
})
