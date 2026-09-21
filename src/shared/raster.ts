import { deflateSync } from 'node:zlib'

/**
 * 极小的软件光栅化器 + PNG 编码器。**纯函数、不 import electron** ——
 * 所以像素可以在无头测试里直接断言，而不是只能靠肉眼盯着托盘看。
 *
 * 为什么不用 SVG / canvas / sharp：
 *   - Electron 的 `nativeImage` **不支持 SVG**。`createFromDataURL('data:image/svg+xml;…')`
 *     不报错、不抛异常，静默返回一张 0×0 的空图（实测 `isEmpty() === true`）——
 *     托盘里什么都看不见，但 tooltip 与右键菜单照常工作，极难定位。
 *   - 主进程没有 canvas。
 *   - sharp / node-canvas 是原生模块，要处理 electron-rebuild 与打包 ABI 匹配，
 *     为两个图标不值得。
 *
 * 形状与颜色**解耦**：每个形状自己带色（多色图标要用），坐标写在一个
 * 「设计坐标系」里（图标是 16、应用图标是 64），由 `size` 决定实际产出多大。
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export interface Pt {
  x: number
  y: number
}

/** 线的两端点 */
export interface StrokeShape {
  kind: 'stroke'
  a: Pt
  b: Pt
  width: number
  color: Rgb
  /** 缺省 1 */
  alpha?: number
}

/** 圆角矩形的**描边**（空心框） */
export interface OutlineShape {
  kind: 'outline'
  x0: number
  y0: number
  x1: number
  y1: number
  radius: number
  width: number
  color: Rgb
  alpha?: number
}

/** 圆角矩形的**填充**（实心块） */
export interface FillShape {
  kind: 'fill'
  x0: number
  y0: number
  x1: number
  y1: number
  radius: number
  color: Rgb
  alpha?: number
}

export type Shape = StrokeShape | OutlineShape | FillShape

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
  const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2)
  const hw = (x1 - x0) / 2 - r
  const hh = (y1 - y0) / 2 - r
  const qx = Math.abs(px - (x0 + x1) / 2) - hw
  const qy = Math.abs(py - (y0 + y1) / 2) - hh
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/** 这个子采样点是否落在形状里。返回 0/1 —— 抗锯齿交给超采样 */
function covers(shape: Shape, x: number, y: number): boolean {
  if (shape.kind === 'stroke') {
    return distToSegment(x, y, shape.a, shape.b) <= shape.width / 2
  }
  const sd = sdRoundRect(x, y, shape.x0, shape.y0, shape.x1, shape.y1, shape.radius)
  if (shape.kind === 'fill') return sd <= 0
  return Math.abs(sd) <= shape.width / 2
}

export interface RasterOptions {
  /** 产出位图的边长（像素） */
  size: number
  /** 形状坐标所在的设计坐标系边长 */
  design: number
  /**
   * 每像素每轴的超采样数，默认 4（16 个样本）。小图标需要它来磨平 1px 描边；
   * 256px 那么大的图上再上 4×4 就是纯浪费，调用方可以降到 2。
   */
  supersample?: number
}

/**
 * 光栅化成 RGBA 位图（**非预乘**，与 PNG 的 colorType 6 一致）。
 *
 * 每个子采样点按 source-over 把各形状依次叠上去，且**在预乘空间里累加**——
 * 这样重叠处不会因为「按形状分别累加再平均」而叠深，也不会在半透明形状叠
 * 不透明形状时算错颜色。最后再把预乘值除回去。
 */
export function rasterize(shapes: Shape[], opts: RasterOptions): Buffer {
  const { size, design } = opts
  const ss = opts.supersample ?? 4
  const scale = size / design
  const samples = ss * ss
  const rgba = Buffer.alloc(size * size * 4)

  // 颜色先归一到 0..1，内层循环里就不用反复除 255
  const layers = shapes.map((s) => ({
    shape: s,
    a: s.alpha ?? 1,
    r: s.color.r / 255,
    g: s.color.g / 255,
    b: s.color.b / 255
  }))

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let accR = 0
      let accG = 0
      let accB = 0
      let accA = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / scale
          const y = (py + (sy + 0.5) / ss) / scale
          let pr = 0
          let pg = 0
          let pb = 0
          let pa = 0
          for (const { shape, a, r, g, b } of layers) {
            if (!covers(shape, x, y)) continue
            pr = r * a + pr * (1 - a)
            pg = g * a + pg * (1 - a)
            pb = b * a + pb * (1 - a)
            pa = a + pa * (1 - a)
          }
          accR += pr
          accG += pg
          accB += pb
          accA += pa
        }
      }
      const off = (py * size + px) * 4
      const a = accA / samples
      if (a > 0) {
        rgba[off] = Math.round((accR / samples / a) * 255)
        rgba[off + 1] = Math.round((accG / samples / a) * 255)
        rgba[off + 2] = Math.round((accB / samples / a) * 255)
      }
      rgba[off + 3] = Math.round(a * 255)
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
