import { deflateSync } from 'node:zlib'

/**
 * 托盘图标的位图生成与 PNG 编码。**纯函数、不 import electron** ——
 * 因此可以在无头测试里直接断言像素，而不是只能靠肉眼看托盘。
 *
 * 为什么不用 SVG：Electron 的 `nativeImage` **不支持 SVG**。
 * `createFromDataURL('data:image/svg+xml;…')` 不报错、不抛异常，静默返回一张
 * 0×0 的空图（实测 `isEmpty() === true`、`getSize()` 为 `{width:0,height:0}`）——
 * 后果是托盘里看不见图标，但 tooltip 与右键菜单照常工作，极难定位。
 * 见 `docs/superpowers/notes/toast-spike.md` 同级的排坑记录。
 *
 * 主进程没有 canvas，而 sharp / node-canvas 是原生模块（要处理 electron-rebuild
 * 与打包 ABI 匹配，为两个 16px 图标不值得），所以这里自己光栅化 + 自己编 PNG。
 */

/** 图标的设计坐标系边长（下面所有形状坐标都按 16×16 写） */
export const TRAY_ICON_SIZE = 16

/**
 * 光栅化倍率，实际产出 `16 × TRAY_ICON_SCALE` 的位图。
 *
 * 给 2 是有意的：Windows 托盘的标称尺寸在 100% DPI 下是 16×16、150% 下是 24×24。
 * 拿 32×32 的源图让系统缩，比拿 16×16 的源图放大要清晰得多（放大是糊的）。
 */
export const TRAY_ICON_SCALE = 2

export type TrayIconKind = 'pending' | 'clear'

interface Pt {
  x: number
  y: number
}

type Shape =
  | { kind: 'stroke'; a: Pt; b: Pt; width: number; alpha: number }
  | {
      kind: 'outline'
      x0: number
      y0: number
      x1: number
      y1: number
      radius: number
      width: number
      alpha: number
    }

/** 方框的几何：居中偏上，给下面的行留出呼吸空间 */
const BOX = { x0: 2.5, y0: 4, x1: 13.5, y1: 12.5, radius: 2 }

/**
 * 两种形态：
 *   pending → 框里躺着两条横线
 *   clear   → 框淡化，叠一个勾
 * 形状与颜色解耦：颜色由调用方给（任务栏深色时要用亮色）。
 */
function shapesOf(kind: TrayIconKind): Shape[] {
  if (kind === 'pending') {
    return [
      { kind: 'outline', ...BOX, width: 1.4, alpha: 1 },
      { kind: 'stroke', a: { x: 5, y: 6.8 }, b: { x: 11, y: 6.8 }, width: 1.4, alpha: 1 },
      { kind: 'stroke', a: { x: 5, y: 9.6 }, b: { x: 9, y: 9.6 }, width: 1.4, alpha: 1 }
    ]
  }
  return [
    { kind: 'outline', ...BOX, width: 1.4, alpha: 0.45 },
    { kind: 'stroke', a: { x: 5.4, y: 8.2 }, b: { x: 7.4, y: 10.2 }, width: 1.6, alpha: 1 },
    { kind: 'stroke', a: { x: 7.4, y: 10.2 }, b: { x: 11, y: 5.8 }, width: 1.6, alpha: 1 }
  ]
}

function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / len2))
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy))
}

/** 圆角矩形的有符号距离，内部为负 */
function sdRoundRect(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number
): number {
  const hw = (x1 - x0) / 2 - radius
  const hh = (y1 - y0) / 2 - radius
  const qx = Math.abs(px - (x0 + x1) / 2) - hw
  const qy = Math.abs(py - (y0 + y1) / 2) - hh
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
  )
}

function covers(shape: Shape, x: number, y: number): boolean {
  if (shape.kind === 'stroke') {
    return distToSegment(x, y, shape.a, shape.b) <= shape.width / 2
  }
  return Math.abs(sdRoundRect(x, y, shape.x0, shape.y0, shape.x1, shape.y1, shape.radius)) <=
    shape.width / 2
}

/** 每像素每轴的超采样数。4 → 16 个样本，够把 1.4px 的描边磨平 */
const SUPERSAMPLE = 4

export interface Rgb {
  r: number
  g: number
  b: number
}

/** `#RRGGBB` / `#RGB` → RGB。给不出颜色时退回黑色，绝不抛错 */
export function parseHexColor(hex: string): Rgb {
  const s = hex.trim().replace(/^#/, '')
  const full = s.length === 3 ? s.split('').map((c) => c + c).join('') : s
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0, g: 0, b: 0 }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16)
  }
}

/**
 * 光栅化成 RGBA 位图（非预乘，与 PNG 的 colorType 6 一致）。
 *
 * 每个子像素先按 source-over 依次合成各形状，再把 16 个子像素的 alpha
 * 平均掉 —— 这样多形状重叠处不会因为「按形状分别累加」而叠深。
 */
export function trayIconBitmap(
  kind: TrayIconKind,
  color: string,
  scale: number = TRAY_ICON_SCALE
): Buffer {
  const shapes = shapesOf(kind)
  const rgb = parseHexColor(color)
  const size = TRAY_ICON_SIZE * scale
  const rgba = Buffer.alloc(size * size * 4)
  const samples = SUPERSAMPLE * SUPERSAMPLE

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let acc = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          // 落到设计坐标系（0..16）里判定
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / scale
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / scale
          let a = 0
          for (const s of shapes) {
            if (covers(s, x, y)) a = a + s.alpha * (1 - a)
          }
          acc += a
        }
      }
      const off = (py * size + px) * 4
      rgba[off] = rgb.r
      rgba[off + 1] = rgb.g
      rgba[off + 2] = rgb.b
      rgba[off + 3] = Math.round((acc / samples) * 255)
    }
  }
  return rgba
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/** 最小 PNG 编码：signature + IHDR + IDAT(deflate) + IEND */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  // 10..12 = compression / filter / interlace，全 0

  const stride = 1 + width * 4
  const raw = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // 每行前置的 filter 字节：none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** 直接可喂给 `nativeImage.createFromBuffer` 的 PNG */
export function trayIconPng(
  kind: TrayIconKind,
  color: string,
  scale: number = TRAY_ICON_SCALE
): Buffer {
  const size = TRAY_ICON_SIZE * scale
  return encodePng(size, size, trayIconBitmap(kind, color, scale))
}
