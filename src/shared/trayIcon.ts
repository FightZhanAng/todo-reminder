import { encodePng, parseHexColor, rasterize, type Rgb, type Shape } from './raster'

/**
 * 托盘图标的位图生成。**纯函数、不 import electron** —— 像素可以在无头测试里
 * 直接断言，而不是只能靠肉眼看托盘。光栅化与 PNG 编码在 `raster.ts`。
 *
 * ## 图形：一根竖轴 + 三道刻度
 *
 * 和主界面是同一个母题（见 `src/renderer/styles.css` 开头的视觉说明）：整张看板
 * 围绕一根竖轴组织，每行在轴上留一道刻度，**刻度的长度编码紧迫度**。
 * 托盘图标就是这根轴本身：
 *
 *      │────        三道刻度自下而上变长
 *      │──────
 *   ───┼────────    最长的那道**越过轴向左伸出去** —— 逾期，冲过限位刻度的针
 *      │
 *
 * 选它而不是「一个方框里躺两条线」，理由和主界面一样：方框加横线可以是任何
 * 一个待办软件，而这一根轴只属于这个应用，且竖向扫一眼就能数出还剩几件事。
 *
 * 两种形态：
 *   pending → 轴 + 三道刻度（有未完成的）
 *   clear   → 轴淡下去，右侧换成一个勾（今天清空）
 *
 * 颜色由调用方给（任务栏深色时要用亮色），形状与颜色解耦。
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

/** 竖轴落在这条 x 上。刻度的「短/中」档从轴往右画，最长那档从轴的左边起画 */
const AXIS_X = 5.2
const AXIS_TOP = 2.8
const AXIS_BOTTOM = 13.2
const AXIS_WIDTH = 1.5

/** 三道刻度的纵坐标与右端。等距 3.4，长度 3.2 / 4.6 / 8.0 */
const TICKS: { y: number; x1: number }[] = [
  { y: 4.6, x1: 8.4 },
  { y: 8.0, x1: 9.8 },
  { y: 11.4, x1: 13.2 }
]
/** 最长那道的左端 —— 在轴的左侧，就是「越过轴」的那一截 */
const LONG_TICK_X0 = 3.6

/** clear 形态里轴淡下去的程度。太低看不见，太高就和勾抢注意力 */
const CLEAR_AXIS_ALPHA = 0.45

function shapesOf(kind: TrayIconKind, color: Rgb): Shape[] {
  if (kind === 'pending') {
    return [
      {
        kind: 'stroke',
        a: { x: AXIS_X, y: AXIS_TOP },
        b: { x: AXIS_X, y: AXIS_BOTTOM },
        width: AXIS_WIDTH,
        color
      },
      ...TICKS.map((t, i) => ({
        kind: 'stroke' as const,
        a: { x: i === TICKS.length - 1 ? LONG_TICK_X0 : AXIS_X, y: t.y },
        b: { x: t.x1, y: t.y },
        width: i === TICKS.length - 1 ? 1.7 : AXIS_WIDTH,
        color
      }))
    ]
  }
  return [
    {
      kind: 'stroke',
      a: { x: AXIS_X - 2.6, y: AXIS_TOP + 0.6 },
      b: { x: AXIS_X - 2.6, y: AXIS_BOTTOM - 0.6 },
      width: 1.4,
      color,
      alpha: CLEAR_AXIS_ALPHA
    },
    { kind: 'stroke', a: { x: 5.2, y: 8.4 }, b: { x: 7.4, y: 10.6 }, width: 1.8, color },
    { kind: 'stroke', a: { x: 7.4, y: 10.6 }, b: { x: 11.6, y: 5.6 }, width: 1.8, color }
  ]
}

/** 光栅化成 RGBA 位图（非预乘，与 PNG 的 colorType 6 一致） */
export function trayIconBitmap(
  kind: TrayIconKind,
  color: string,
  scale: number = TRAY_ICON_SCALE
): Buffer {
  return rasterize(shapesOf(kind, parseHexColor(color)), {
    size: TRAY_ICON_SIZE * scale,
    design: TRAY_ICON_SIZE
  })
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

export { parseHexColor, type Rgb }
