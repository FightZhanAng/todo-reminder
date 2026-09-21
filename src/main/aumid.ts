import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Windows 上 toast 通知靠 AppUserModelID 归属。光调
 * `app.setAppUserModelId()` 不够 —— 实测在这个 AUMID 下通知**完全不弹**。
 *
 * Electron 只写 `HKCU\Software\Classes\CLSID\{guid}`（值为
 * "Electron Notification Activator" + CustomActivator=1 + LocalServer32），
 * **不写** `HKCU\Software\Classes\AppUserModelId\<AUMID>`。缺了后者，
 * Windows 不知道这个 AUMID 该由谁处理 —— 通知显示不出来，点击也投不回进程。
 *
 * 同机上能正常弹通知的应用（water-reminder / Reasonix / Steam++）
 * 两处键都齐全。对照它们的形状照做即可。
 *
 * 只写 HKCU，不需要管理员权限。
 *
 * `DisplayName` 就是通知右上角那个署名，要跟产品名一致（「待办提醒」）。
 */
const ACTIVATOR_LABEL = 'Electron Notification Activator'

const AUMID_KEY_ROOT = 'Software\\Classes\\AppUserModelId'

function hkcuAumidKey(aumid: string): string {
  return `HKCU\\${AUMID_KEY_ROOT}\\${aumid}`
}

function fullAumidKey(aumid: string): string {
  return `HKEY_CURRENT_USER\\${AUMID_KEY_ROOT}\\${aumid}`
}

/** .reg 文件里的字符串：反斜杠和引号都要逃 */
function regString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * DisplayName 走 `.reg` 文件 + `reg import`，不走 `reg add` 的命令行参数 ——
 * 中文经过程序参数会被控制台代码页吃掉，落到注册表里是一串乱码，
 * 通知上就署名成「寰呭姏鎻愰」这种。`reg import` 读文件时按 UTF-16LE + BOM
 * 解码，中文才立得住。
 */
function importDisplayNames(aumid: string, displayName: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'aumid-'))
  const file = join(dir, 'aumid.reg')
  const body = [
    'Windows Registry Editor Version 5.00',
    '',
    `[${fullAumidKey(aumid)}]`,
    `${regString('DisplayName')}=${regString(displayName)}`,
    ''
  ].join('\r\n')
  try {
    writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')]))
    execFileSync('reg.exe', ['import', file], { stdio: 'ignore', windowsHide: true })
  } catch (err) {
    // 同 write()：写不进去只影响署名，不该让应用起不来
    console.error('[aumid] reg import 失败：', aumid, err)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * 反查 Electron 自己注册的激活器 GUID。**不要自造 GUID** ——
 * 见修正表第 13 条：自造的 GUID 没有任何进程注册过，Windows 会退化成
 * 按 `LocalServer32` 冷启动一个裸 exe，屏幕上弹出标题为「Electron」的欢迎页，
 * 而正在跑的进程收不到任何事件。
 *
 * **搜索方向必须是「拿 exe 路径去问 reg」，不能是「把整棵树捞出来自己比」**：
 * reg.exe 往 stdout 写的是控制台代码页（本机 GBK），Node 按 utf8 解出来中文
 * 全是乱码，于是 `line.includes(process.execPath)` 对任何带中文的路径永远不成立
 * —— 本机项目就在「我的工作台」下，实测 11 个候选一个都比不中，
 * CustomActivator 从来没被自动写上过一次。改成让 reg 自己做匹配
 * （它拿到的是 CreateProcess 传过去的 UTF-16 参数，比较是准的），
 * 我们只从输出里取**键名** —— GUID 和 CLSID 前缀是纯 ASCII，不受代码页影响。
 * 再用默认值是不是那句 label 过一道筛（label 也是纯 ASCII，比较可靠）。
 *
 * **缓存策略**：成功扫到过一次就缓存下来，之后不再扫整棵 CLSID 树。
 * - 未扫过 / 上次没扫到：保持 undefined，下次调用继续重试；
 * - 扫到：存成字符串，之后直接返回，避免每次要发通知前都跑一次
 *   `reg query /s` 全树扫描（同步执行约 80ms，会把主进程卡住）；
 * - 失败的返回值（null）**绝不缓存** —— 否则会卡死在「再也不重试」，
 *   错过 Electron 稍后写下自己 CLSID 键的时机。这正是「启动时没扫到、
 *   `show()` 前再扫一次」兜底能成立的前提：失败时永远保留重试能力。
 */
let cachedActivatorClsid: string | undefined = undefined

function findElectronActivatorClsid(): string | null {
  if (cachedActivatorClsid !== undefined) return cachedActivatorClsid

  let stdout: string
  try {
    stdout = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Classes\\CLSID', '/s', '/f', process.execPath, '/d'],
      { encoding: 'utf8', windowsHide: true }
    )
  } catch {
    // 没搜到任何匹配时 reg 返回非 0，这是正常情况，不是错误
    return null
  }

  // 命中的通常是 ...\CLSID\{guid}\LocalServer32，取到 {guid} 那一层就截断
  const keys = stdout.match(/HKEY_CURRENT_USER\\Software\\Classes\\CLSID\\\{[0-9A-Fa-f-]{36}\}/g) ?? []
  for (const key of new Set(keys)) {
    try {
      const line = execFileSync('reg.exe', ['query', key, '/ve'], {
        encoding: 'utf8',
        windowsHide: true
      })
      if (line.includes(ACTIVATOR_LABEL)) {
        cachedActivatorClsid = key.slice(key.lastIndexOf('\\') + 1)
        return cachedActivatorClsid
      }
    } catch {
      /* 读不到默认值，跳过 */
    }
  }
  return null
}

function write(key: string, args: string[]): void {
  try {
    execFileSync('reg.exe', ['add', key, ...args], { stdio: 'ignore', windowsHide: true })
  } catch (err) {
    // 写不进去不能让应用挂掉：注册表缺失只会让通知不显示，
    // 而调度、存储、托盘都还能正常工作。
    console.error('[aumid] 写注册表失败：', key, err)
  }
}

/**
 * 幂等：每次启动都写一遍。写注册表很便宜，而「上次装的应用被卸载后又装回来」
 * 这种情况用一次性标记很容易漏。
 *
 * 返回是否成功写入了 CustomActivator —— Electron 何时写下它自己的 CLSID 键
 * 没有实测过（可能晚于本函数），所以调用方在每次 show() 之前要再调一次
 * `ensureAumidActivator()` 兜底。
 */
export function ensureAumidRegistered(aumid: string, displayName: string): boolean {
  if (process.platform !== 'win32') return false

  importDisplayNames(aumid, displayName)
  write(hkcuAumidKey(aumid), [
    '/v', 'HasSentNotification', '/t', 'REG_DWORD', '/d', '1', '/f'
  ])
  return ensureAumidActivator(aumid)
}

/**
 * 只负责把 AUMID 的 CustomActivator 指到 Electron 自注册的那个 GUID 上。
 * 扫不到就什么都不做（下次 show() 前会再试）—— 指错比不指更糟：
 * 指错会让每次点击都冷启动一个裸 electron.exe。
 */
export function ensureAumidActivator(aumid: string): boolean {
  if (process.platform !== 'win32') return false

  const clsid = findElectronActivatorClsid()
  if (!clsid) return false

  write(hkcuAumidKey(aumid), [
    '/v', 'CustomActivator', '/t', 'REG_SZ', '/d', clsid, '/f'
  ])
  return true
}
