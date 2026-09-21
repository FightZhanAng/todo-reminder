import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'

export interface StrikeLineProps {
  /** 种子来源。同一件事每次划的痕迹完全一致 —— 它属于这件事（规格 §9.5） */
  seed: string
  /**
   * 静态渲染：不起动画、不回调，直接把那一笔画在原地。
   *
   * 已完成清单用它 —— 那里的每一行**本来就已经划掉了**，需要的是这一笔的
   * *形状*（免得标题看着像被打印划掉的），不是一个「刚刚被划掉」的动画。
   * 所以这个模式下 reduced-motion 也照画：此时这一笔是信息，不是动效。
   */
  still?: boolean
  onDone: () => void
}

/**
 * 粗段露出来的横向区间，单位是 viewBox 的横轴（0–100）。
 * 取正中间 40%（两端各留 30%）：粗细变化沿路径一眼能看出来。
 */
const MID_X = 30
const MID_WIDTH = 40

/** 墨线往文字两侧各出头多少（规格 §7「略微超出字的宽度」） */
const OVERHANG = 2

/**
 * 划掉的那一笔。
 *
 * 为什么不用 <text-decoration: line-through>：那个是一根等宽直线，
 * 看起来是"被打印划掉的"，不是"被手划掉的"。人在纸上划掉一件事时，
 * 那一笔的粗细会变、会抖、会略微超出字的宽度 —— 这一下就是整个界面的性格所在。
 *
 * 粗细不均（规格 §12）靠**两条 path 叠在同一条 d 上**：
 *   .strike__full  1.1px，扫全程（细段）
 *   .strike__mid   1.6px，只露中段（粗段，由 clipPath 限定横向区间）
 * 两条用同一个 stroke-dasharray 值、同一个 stroke-dashoffset 动画、同一个
 * ease-out 260ms，所以露出来的**前沿逐帧重合**：整条线仍然读作一次从左到右的
 * 扫过，而不是两段先后各扫一遍。
 *
 * 宽度为什么这样接（细段全程 + 粗段中段），而不是反过来：同色墨叠在一起，
 * 眼睛看到的是**并集**。粗段全程 + 细段中段的话，细段整根都被粗段盖住，
 * 实测中段还是 1.50px 宽（只多出一圈 0.25px 的淡边），目视根本看不出粗细变化 ——
 * ② 不成立。反过来接：两端 0.95px、中段 1.40px（实测比值 1.46，声明 1.6/1.1 = 1.45），
 * 「粗处 1.6、细处 1.1」才是**看得见**的。两种接法都测过，见 task-8-report.md。
 *
 * 中段为什么不用 stroke-dasharray 挖（「空白-中段长-空白」）：dash 图案相对路径
 * 是**整体平移**的，dashoffset 从 L 走到 0 时那条可见的中段会跟着滑一大段再绕回，
 * 中段并不长在原地。详见 task-8-report.md 里的逐帧演算。
 *
 * 三拍（规格 §9.5）：
 *   0–260ms   墨线从左往右扫过（stroke-dashoffset 动画）
 *   260–520ms 整行降透明度并移出（.row--done 的 CSS 动画）
 *   520ms     行移出分区
 */
export function StrikeLine({ seed, still = false, onDone }: StrikeLineProps): JSX.Element {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const pathRef = useRef<SVGPathElement | null>(null)
  // 文字的宽度/高度：必须量，不能让 CSS 自己算（见下面 useLayoutEffect 里的注释）
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  // 路径在**描边坐标系**（CSS px）里的长度，不是 getTotalLength() 的 user 单位
  const [len, setLen] = useState(0)

  // 固定种子 —— 不能用 Math.random()，同一件事每次划的痕迹必须一样
  const path = useMemo(() => wobblePath(seed), [seed])

  // clipPath 的 id 得每个实例唯一，否则同屏两个退场行会互相抢。
  // 用种子哈希：确定性的，不需要 Math.random()／计数器
  const clipId = useMemo(() => `strike-mid-${fnv1a(seed).toString(36)}`, [seed])

  useLayoutEffect(() => {
    const svg = svgRef.current
    const el = pathRef.current
    const host = svg?.parentElement
    if (!svg || !el || !host) return

    // 墨线要贴的是**字**的宽度，所以宽度只能量："包含块是内联盒子"这件事
    // Chromium 只兑现一半 —— left 会按内联盒子锚定（实测 -2px 准），
    // 但可用宽度按不定处理，left+right 并不能把宽度夹出来，width: auto 会走
    // svg 的固有宽高比（实测恒为 200×16，与文字宽度无关）。所以按量出来的值写死。
    const rect = host.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    const viewW = w + OVERHANG * 2
    setBox({ w, h })
    setLen(strokeLength(el, viewW / 100, h / 8))
  }, [path])

  // 第三拍：520ms 把这一行交给调用方移出。reduced-motion 时直接完成（规格 §9.5）
  //
  // 这个 effect 的依赖必须是稳定引用 —— 它一被重跑就会重新计时。onDone 由
  // TaskRow 用 useCallback 钉住（state.settle 本身是 useCallback(…, []) 的稳定
  // 引用）。传内联箭头的话，useNow 每秒一次的 tick 会把 520ms 反复推后，
  // 退场时间从 520ms 漂到 520–1040ms（实测）。
  useLayoutEffect(() => {
    if (still) return
    if (prefersReducedMotion()) {
      onDone()
      return
    }
    const timer = setTimeout(onDone, 520)
    return () => clearTimeout(timer)
  }, [onDone, still])

  // 静态模式在 reduced-motion 下也要画（那一笔是信息，不是动效）；
  // 动态模式才需要靠「什么都不画」来跳过动画
  if (!still && prefersReducedMotion()) return <></>

  // 字宽、线长都还没量出来时**不启动动画、也不着墨**：那时 dasharray 只能是兜底值，
  // 而兜底值（1）对一条一百多单位的路径就是「1 亮 1 灭」的虚线。首帧绝不能以这样的
  // 假中间态被画出来。（现在靠 useLayoutEffect 在 paint 前重渲染抢跑，但那是隐式依赖，
  // 不是契约 —— 见 task-8-report.md 的 Minor 3。）
  const ready = box !== null && len > 0
  const ink = {
    // 长度要同时喂给 dasharray（起始态）和 keyframes 的 from（兜底值）
    strokeDasharray: ready ? len : 1,
    // 静态模式停在「画完」的位置，动态模式停在「还没开始画」
    strokeDashoffset: ready ? (still ? 0 : len) : 1,
    '--strike-len': ready ? len : 1,
    animation: ready && !still ? 'strike-draw 260ms ease-out forwards' : 'none',
    strokeOpacity: ready ? undefined : 0
  } as CSSProperties

  return (
    <svg
      ref={svgRef}
      className="strike"
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ width: box ? box.w + OVERHANG * 2 : undefined, height: box ? box.h : undefined }}
    >
      <defs>
        {/* 细段只在这个横向窗口里露面；两条 path 的距离参数完全一致，
            clip 只负责"擦掉窗口外的墨"，不参与扫过的进度 */}
        <clipPath id={clipId}>
          <rect x={MID_X} y="0" width={MID_WIDTH} height="8" />
        </clipPath>
      </defs>
      <path ref={pathRef} className="strike__full" d={path} style={ink} />
      <path className="strike__mid" d={path} clipPath={`url(#${clipId})`} style={ink} />
    </svg>
  )
}

/**
 * 路径在**描边坐标系**（= CSS px）里的长度。
 *
 * 不能直接用 getTotalLength()：.strike 的 stroke 用了 vector-effect: non-scaling-stroke，
 * 于是 dasharray / dashoffset 的单位变成 CSS px，而 getTotalLength() 给的是 viewBox 的
 * user 单位，两者差一个横向缩放比。喂错单位的表现是墨线扫到三分之一就停住
 * （实测：200px 宽的盒子里只画了 61px，正好差那个比例）。
 * viewBox 到盒子的映射是 preserveAspectRatio="none"，所以逐段按 (sx, sy) 折算再求弧长。
 */
function strokeLength(path: SVGPathElement, sx: number, sy: number): number {
  const total = path.getTotalLength()
  if (!(total > 0)) return 0
  const steps = 64
  let acc = 0
  let prev = path.getPointAtLength(0)
  for (let i = 1; i <= steps; i++) {
    const p = path.getPointAtLength((total * i) / steps)
    acc += Math.hypot((p.x - prev.x) * sx, (p.y - prev.y) * sy)
    prev = p
  }
  return acc
}

/**
 * 从种子算出一条固定抖动的路径。
 *
 * 用 FNV-1a 哈希把 id 摊成几个确定性的偏移量 —— 同一个 id 永远得到同一条曲线。
 * 三段折线而不是一条直线；粗细不均由**第二个 path 叠在同一条 d 上**做出来
 * （见 CSS 的 .strike__full / .strike__mid，以及规格 §12）。
 *
 * h 是 `>>> 0` 出来的 uint32：所有取位都必须用**无符号**右移 `>>>`。
 * 用有符号的 `>>` 时 h ≥ 2³¹ 会变成负数，`% 7` 也就跟着变负，于是约一半的 id
 * 抖动幅度是另一半的 3 倍、而且只往同一侧偏（实测 74.6% 的曲线中点偏到中线以上）。
 */
function wobblePath(seed: string): string {
  const h = fnv1a(seed)
  const j1 = ((h % 7) - 3) * 0.35
  const j2 = (((h >>> 3) % 7) - 3) * 0.35
  const j3 = (((h >>> 6) % 7) - 3) * 0.35
  const startX = -0.5 + ((h >>> 9) % 5) * 0.2
  const endX = 100.5 + ((h >>> 12) % 5) * 0.2
  return [
    `M ${startX} ${4 + j1}`,
    `C ${25} ${4 + j2}, ${55} ${4 + j3}, ${endX} ${4 + j1 * 0.5}`,
    // 收笔那一小段往回勾一点，是手写的习惯。
    //
    // 它**必须是同一条子路径的延续**（直接接 `l`，不能另起一个 `M`）：SVG 的 dash 图案
    // 在每个子路径开头重新起算，而 dashoffset 是同一个值。这一勾只有 1.5 单位长，
    // 一旦它自成子路径，dashoffset 只要小于 dash 长度它就整根亮着 —— 实测 30% 进度时
    // 墨迹已经铺到路径包围盒的 103.7%（尾部先画完）。连成一条子路径之后，dash 会沿着
    // 路径一路扫过主线再扫到这一勾，收笔出现在最后，整条线才是「一次从左到右扫过」。
    `l 1.4 ${j2 * 0.6}`
  ].join(' ')
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
