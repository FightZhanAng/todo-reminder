import { execFileSync } from 'node:child_process'

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
 * DisplayName 有意用 ASCII：中文注册表值走命令行参数会被控制台代码页吃掉，
 * 要写中文得走 UTF-16LE 的 .reg 文件 + reg import，或者 Python 的 winreg。
 * 本项目的应用名是「待办提醒」，要显示中文得单独处理这一步。
 */
const ACTIVATOR_LABEL = 'Electron Notification Activator'

/**
 * 反查 Electron 自己注册的激活器 GUID。**不要自造 GUID** ——
 * 见修正表第 13 条：自造的 GUID 没有任何进程注册过，Windows 会退化成
 * 按 `LocalServer32` 冷启动一个裸 exe，屏幕上弹出标题为「Electron」的欢迎页，
 * 而正在跑的进程收不到任何事件。
 *
 * 做法：先在 CLSID 树下按默认值搜 label 找到候选键，再逐个比对 LocalServer32。
 */
/**
 * 成功扫到过一次就缓存下来，之后不再扫整棵 CLSID 树。
 * - 未扫过 / 上次没扫到：保持 undefined，每次调用都重试；
 * - 扫到：存成字符串，之后直接返回，避免每个 tick（TICK_MS=10s）
 *   都跑一次 `reg query /s` 全树扫描把调度拖慢。
 *
 * 失败的返回值（null）**绝不缓存** —— 否则会卡死在「再也
 * 不重试」，错过 Electron 稍后写下自己 CLSID 键的时机。
 * 这正是「启动时没扫到、show() 前再扫一次」兜底能成立的
 * 前提：失败时永远保留重试能力。
 */
let cachedActivatorClsid: string | null | undefined = undefined

function findElectronActivatorClsid(): string | null {
  if (cachedActivatorClsid !== undefined) return cachedActivatorClsid

  const exe = process.execPath

  let stdout: string
  try {
    stdout = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Classes\\CLSID', '/s', '/f', ACTIVATOR_LABEL, '/d'],
      { encoding: 'utf8', windowsHide: true }
    )
  } catch {
    // 没搜到任何匹配时 reg 返回非 0，这是正常情况，不是错误
    return null
  }

  const keys = stdout.match(/HKEY_CURRENT_USER\\Software\\Classes\\CLSID\\\{[0-9A-Fa-f-]{36}\}/g) ?? []
  for (const key of new Set(keys)) {
    try {
      const line = execFileSync('reg.exe', ['query', `${key}\\LocalServer32`, '/ve'], {
        encoding: 'utf8',
        windowsHide: true
      })
      // 取值行的最后一段就是数据；带引号的路径要去引号
      if (line.includes(exe)) {
        cachedActivatorClsid = key.slice(key.lastIndexOf('\\') + 1)
        return cachedActivatorClsid
      }
    } catch {
      /* 没有 LocalServer32 子键，跳过 */
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

  const aumidKey = `HKCU\\Software\\Classes\\AppUserModelId\\${aumid}`
  write(aumidKey, ['/v', 'DisplayName', '/t', 'REG_SZ', '/d', displayName, '/f'])
  write(aumidKey, ['/v', 'HasSentNotification', '/t', 'REG_DWORD', '/d', '1', '/f'])
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

  write(`HKCU\\Software\\Classes\\AppUserModelId\\${aumid}`, [
    '/v', 'CustomActivator', '/t', 'REG_SZ', '/d', clsid, '/f'
  ])
  return true
}
