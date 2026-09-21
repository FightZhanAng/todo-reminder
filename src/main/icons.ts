import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, nativeImage, type NativeImage } from 'electron'
import { trayIconPng, type TrayIconKind } from '../shared/trayIcon'

/**
 * 托盘图标是一个方框：
 *   还有未完成 → 框里躺着几条横线
 *   今天清空   → 变成一个勾
 *
 * **绝对不要用 SVG。** Electron 的 `nativeImage` 不支持 SVG：
 * `createFromDataURL('data:image/svg+xml;base64,…')` 不抛错、不警告，静默返回
 * 一张 0×0 的空图（实测 `isEmpty() === true`、`getSize()` 为 `{0,0}`）。
 * 后果是**托盘里什么都看不见**，而 tooltip、右键菜单、通知全部正常 ——
 * 极易误判成「图标颜色太浅」或「系统把新图标折叠了」。2026-09-18 就是这么踩的：
 * 这个文件的上一版注释写着「用 SVG 转 PNG 生成」，但代码从头到尾没转过，
 * 只是把 SVG 塞进了 data URL。
 *
 * 现在的做法：`shared/trayIcon.ts` 自己光栅化 + 自己编 PNG（纯函数、可无头测试），
 * 这里只包一层 `nativeImage`。像素断言在 `scripts/core-test.ts` 里。
 */
function build(kind: TrayIconKind, color: string): NativeImage {
  return nativeImage.createFromBuffer(trayIconPng(kind, color))
}

export function trayIconPending(color: string): NativeImage {
  return build('pending', color)
}

export function trayIconClear(color: string): NativeImage {
  return build('clear', color)
}

/**
 * 窗口图标（任务栏 + Alt+Tab 用的那一枚）的文件路径，没有就返回 null。
 *
 * **只在开发态返回。** 打包后 Windows 直接从 exe 里取图标 —— 那是
 * electron-builder 按 package.json 的 `build.win.icon` 嵌进去的，
 * 比运行时再指一个文件可靠（也不会有「asar 里读不到」这类问题）。
 *
 * 图标本身由 `pnpm icons` 从 `shared/appIcon.ts` 生成，不手改二进制。
 */
export function windowIconPath(): string | null {
  if (app.isPackaged) return null
  const path = join(__dirname, '../../resources/icon.ico')
  return existsSync(path) ? path : null
}
