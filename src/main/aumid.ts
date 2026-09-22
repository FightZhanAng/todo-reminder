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
const AUMID_KEY_ROOT = 'Software\\Classes\\AppUserModelId'

/** 只认标准的 GUID 形状（带不带花括号都行）—— 见 writeAumidActivator 的说明 */
const GUID_RE = /^\{?[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}?$/

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

function write(key: string, args: string[]): boolean {
  try {
    execFileSync('reg.exe', ['add', key, ...args], { stdio: 'ignore', windowsHide: true })
    return true
  } catch (err) {
    // 写不进去不能让应用挂掉：注册表缺失只会让通知不显示，
    // 而调度、存储、托盘都还能正常工作。
    console.error('[aumid] 写注册表失败：', key, err)
    return false
  }
}

/**
 * 幂等：每次启动都写一遍。写注册表很便宜，而「上次装的应用被卸载后又装回来」
 * 这种情况用一次性标记很容易漏。
 *
 * 这里**不碰 `CustomActivator`** —— 那一项归 `writeAumidActivator`，而且值不能由
 * 我们定，只能跟着 Electron 走，理由见那个函数。
 */
export function ensureAumidRegistered(aumid: string, displayName: string): void {
  if (process.platform !== 'win32') return

  importDisplayNames(aumid, displayName)
  write(hkcuAumidKey(aumid), [
    '/v', 'HasSentNotification', '/t', 'REG_DWORD', '/d', '1', '/f'
  ])
}

/**
 * 把 AUMID 的 `CustomActivator` 指到 `clsid`。
 *
 * **这个值只能来自「Electron 这次运行时到底注册了哪个」，不能由应用自己钉死。**
 * 三方必须指同一个 GUID：Windows 按 AUMID 下的 `CustomActivator` 找人 →
 * 拿它 CoCreateInstance → 在 ROT 里找本进程注册的 COM 类对象。
 * 一旦这里和 Electron 实际注册的那个对不上，Windows 就找不着活着的实例，
 * 点击整个丢掉 —— 症状正是「通知上点完成/推迟，什么都没发生」。
 *
 * 有两个坑，都是实测踩出来的：
 *
 * 1. **不能钉死常量。** Electron 注册时会用「开始菜单里那条属于本 AUMID 的
 *    快捷方式」记的 `System.AppUserModel.ToastActivatorCLSID` 顶掉应用设的值
 *    （`windows_toast_activator.cc` 的 `EnsureShortcut()`），随后拿这个被顶掉的
 *    值去写 CLSID 键、注册 COM 类对象。于是应用写死的那个 GUID 没有注册表键、
 *    也没有活实例，而 `CustomActivator` 恰恰指着它 —— 点一下什么都发生不了。
 *    凡是机器上装过旧版（快捷方式里已经带着旧 GUID）就必然踩中。
 * 2. **不能去注册表里反查。** 「拿 exe 路径问 reg，找一个 LocalServer32 指向自己的
 *    CLSID 键」这条路会撞上同一个 exe 的多条陈旧键（每次重装/每次随机 CLSID 都留
 *    一条），挑中哪条全看运气；而且 `reg.exe` 的 stdout 是控制台代码页，路径带中文
 *    时按 utf8 解出来根本比不中。0.1.2 安装版就是这么坏的。
 *
 * 所以调用方传进来的必须是 `app.toastActivatorCLSID`，或者那条快捷方式里记的值
 * （两者在 Electron 注册之后是同一个）。
 *
 * 校验形状再写：宁可留着上一次的值，也不要把一个不成立的 GUID 写进注册表 ——
 * 那会让点击从「还能修」变成「指向空气」。
 */
export function writeAumidActivator(aumid: string, clsid: string): boolean {
  if (process.platform !== 'win32') return false
  if (!GUID_RE.test(clsid)) {
    console.error('[aumid] 不是合法的 CLSID，跳过 CustomActivator：', clsid)
    return false
  }

  return write(hkcuAumidKey(aumid), [
    '/v', 'CustomActivator', '/t', 'REG_SZ', '/d', clsid, '/f'
  ])
}
