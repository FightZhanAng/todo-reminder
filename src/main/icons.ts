import { nativeImage, type NativeImage } from 'electron'

/**
 * 托盘图标是一个方框：
 *   还有未完成 → 框里躺着几条横线
 *   今天清空   → 变成一个勾
 *
 * 用 SVG 转 PNG 生成，不依赖美术资源文件。16×16 是 Windows 托盘标准尺寸。
 */
function svgToImage(svg: string): NativeImage {
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  )
}

function wrap(inner: string, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" color="${color}">${inner}</svg>`
}

export function trayIconPending(color: string): NativeImage {
  return svgToImage(
    wrap(
      `<rect x="2.5" y="4" width="11" height="8.5" rx="2" fill="none" stroke="${color}" stroke-width="1.4"/>
       <path d="M5 6.8h6" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>
       <path d="M5 9.6h4" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>`,
      color
    )
  )
}

export function trayIconClear(color: string): NativeImage {
  return svgToImage(
    wrap(
      `<rect x="2.5" y="4" width="11" height="8.5" rx="2" fill="none" stroke="${color}" stroke-width="1.4" opacity="0.45"/>
       <path d="M5.4 8.2 L7.4 10.2 L11 5.8" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
      color
    )
  )
}
