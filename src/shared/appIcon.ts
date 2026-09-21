import { encodePng, parseHexColor, rasterize, type Shape } from './raster'

/**
 * 应用图标（窗口 / 任务栏 / exe 里嵌的那一枚）。**纯函数、不 import electron**，
 * 所以可以离线生成、也可以被测试断言。
 *
 * ## 图形：托盘图标的放大版，加一块纸面板
 *
 * 设计坐标系 64×64。托盘图标只有单色剪影可用（系统会按任务栏明暗换色），
 * 应用图标没有这个限制，于是把主界面的配色搬过来：
 *
 *   纸面底板（浅色圆角方）+ 靛蓝的竖轴与两道刻度 + **朱砂的最长那道**（越过轴）
 *
 * 朱砂在整套视觉里只有一个意思：**已经晚了**。所以这一笔必须是越线的那一道，
 * 不能随便找根线染红 —— 那样这个颜色就不再有含义了。
 *
 * 产出 `.ico` 时混用了两种条目格式：≤64px 用 BMP（Windows 至今最挑剔的
 * 消费方 —— 开始菜单、Alt+Tab、老一点的 shell 扩展都只认 BMP），
 * 128/256 用 PNG（BMP 在这个尺寸下会白白多出几百 KB）。
 */

/** 应用图标的设计坐标系边长 */
export const APP_ICON_DESIGN = 64

/**
 * 一次生成的全部尺寸。
 *
 * 16 / 20 / 24 / 32 是任务栏与 Alt+Tab（随 DPI 缩放），40 / 48 是开始菜单与
 * 桌面「中等图标」，64 是资源管理器大图标，128 / 256 给「超大图标」和高 DPI 屏。
 */
export const APP_ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

/** 超过这个边长改用 PNG 条目 —— BMP 在 128 以上体积会失控 */
export const ICO_PNG_THRESHOLD = 128

const PAPER = parseHexColor('#f4f6f5')
const PAPER_EDGE = parseHexColor('#b3beba')
const INDIGO = parseHexColor('#26496d')
const CINNABAR = parseHexColor('#bf3628')

const PLATE = { x0: 1.5, y0: 1.5, x1: 62.5, y1: 62.5, radius: 14 }
/** 竖轴落在这条 x 上。刻度的短/中档从轴往右画，最长那档从轴的左边起画 */
const AXIS_X = 23
const AXIS_W = 5

export function appIconShapes(): Shape[] {
  return [
    { kind: 'fill', ...PLATE, color: PAPER },
    { kind: 'outline', ...PLATE, width: 1.6, color: PAPER_EDGE },
    {
      kind: 'stroke',
      a: { x: AXIS_X, y: 13 },
      b: { x: AXIS_X, y: 51 },
      width: AXIS_W,
      color: INDIGO
    },
    { kind: 'stroke', a: { x: AXIS_X, y: 20.5 }, b: { x: 37, y: 20.5 }, width: AXIS_W, color: INDIGO },
    { kind: 'stroke', a: { x: AXIS_X, y: 32 }, b: { x: 45.5, y: 32 }, width: AXIS_W, color: INDIGO },
    // 最长的那道：越过轴，越过的是**限位刻度**，朱砂只留给这一笔
    {
      kind: 'stroke',
      a: { x: 13.5, y: 43.5 },
      b: { x: 51, y: 43.5 },
      width: 5.6,
      color: CINNABAR
    }
  ]
}

/** 某个边长的 RGBA 位图。大尺寸把超采样降到 2 —— 4×4 在 256px 上是纯浪费 */
export function appIconBitmap(size: number): Buffer {
  return rasterize(appIconShapes(), {
    size,
    design: APP_ICON_DESIGN,
    supersample: size >= 128 ? 2 : 4
  })
}

export function appIconPng(size: number): Buffer {
  return encodePng(size, size, appIconBitmap(size))
}

/**
 * RGBA → 32 位 BMP 图标条目（BITMAPINFOHEADER + 自下而上的 BGRA + AND 掩码）。
 *
 * 两个容易写错的地方：
 *   - biHeight 要写成**两倍**高度：BMP 图标把 XOR（颜色）与 AND（掩码）两张图
 *     竖着拼在一个结构里，写成一倍的话解析方会只读一半、整张图错位。
 *   - AND 掩码必须是**每行 4 字节对齐**的全零。32 位条目靠 alpha 通道透明，
 *     掩码只是历史包袱，但不写就是垃圾数据，碰到不看 alpha 的老消费方会花屏。
 */
export function encodeBmpEntry(rgba: Buffer, size: number): Buffer {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0) // biSize
  header.writeInt32LE(size, 4) // biWidth
  header.writeInt32LE(size * 2, 8) // biHeight = XOR + AND
  header.writeUInt16LE(1, 12) // biPlanes
  header.writeUInt16LE(32, 14) // biBitCount
  header.writeUInt32LE(0, 16) // biCompression = BI_RGB
  header.writeUInt32LE(size * size * 4, 20) // biSizeImage（只算 XOR）

  const xor = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4 // BMP 自下而上
    const dst = y * size * 4
    for (let x = 0; x < size; x++) {
      const s = src + x * 4
      const d = dst + x * 4
      xor[d] = rgba[s + 2] // B
      xor[d + 1] = rgba[s + 1] // G
      xor[d + 2] = rgba[s] // R
      xor[d + 3] = rgba[s + 3] // A
    }
  }

  const andStride = Math.ceil(size / 32) * 4
  const andMask = Buffer.alloc(andStride * size) // 全零 = 「一切按 alpha 来」

  return Buffer.concat([header, xor, andMask])
}

export interface IcoEntry {
  size: number
  data: Buffer
}

/**
 * ICO 容器：6 字节目录头 + 每个尺寸 16 字节目录项 + 紧挨着的数据。
 *
 * 目录项里的宽高是**单字节**，所以 256 只能写成 0 —— 这是 ICO 格式的约定，
 * 不是「没填」。写 256 进去会被截成 0，正好等价，但别指望它看起来对。
 */
export function encodeIco(entries: IcoEntry[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(entries.length, 4)

  const dir = Buffer.alloc(entries.length * 16)
  let offset = 6 + entries.length * 16
  entries.forEach((entry, i) => {
    const at = i * 16
    const dim = entry.size >= 256 ? 0 : entry.size
    dir[at] = dim
    dir[at + 1] = dim
    dir[at + 2] = 0 // 调色板颜色数（真彩为 0）
    dir[at + 3] = 0 // reserved
    dir.writeUInt16LE(1, at + 4) // planes
    dir.writeUInt16LE(32, at + 6) // bitCount
    dir.writeUInt32LE(entry.data.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += entry.data.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)])
}

/** 生成完整的多尺寸 .ico */
export function buildAppIco(sizes: number[] = APP_ICON_SIZES): Buffer {
  return encodeIco(
    sizes.map((size) => ({
      size,
      data: size >= ICO_PNG_THRESHOLD ? appIconPng(size) : encodeBmpEntry(appIconBitmap(size), size)
    }))
  )
}
