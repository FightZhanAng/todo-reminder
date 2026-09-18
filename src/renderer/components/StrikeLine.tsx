import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from 'react'

export interface StrikeLineProps {
  /** 种子来源。同一件事每次划的痕迹完全一致 —— 它属于这件事（规格 §9.5） */
  seed: string
  onDone: () => void
}

/**
 * 划掉的那一笔。
 *
 * 为什么不用 <text-decoration: line-through>：那个是一根等宽直线，
 * 看起来是"被打印划掉的"，不是"被手划掉的"。人在纸上划掉一件事时，
 * 那一笔的粗细会变、会抖、会略微超出字的宽度 —— 这一下就是整个界面的性格所在。
 *
 * 三拍（规格 §9.5）：
 *   0–260ms   墨线从左往右扫过（stroke-dashoffset 动画）
 *   260–520ms 整行降透明度并移出（.row--done 的 CSS 动画）
 *   520ms     行移出分区
 */
export function StrikeLine({ seed, onDone }: StrikeLineProps): JSX.Element {
  const pathRef = useRef<SVGPathElement | null>(null)
  const [length, setLength] = useState(0)

  // 固定种子 —— 不能用 Math.random()，同一件事每次划的痕迹必须一样
  const path = useMemo(() => wobblePath(seed), [seed])

  useLayoutEffect(() => {
    const el = pathRef.current
    if (!el) return
    setLength(el.getTotalLength())
  }, [path])

  // 260ms 划完 + 260ms 移出。reduced-motion 时直接完成（规格 §9.5）
  useLayoutEffect(() => {
    if (prefersReducedMotion()) {
      onDone()
      return
    }
    const timer = setTimeout(onDone, 520)
    return () => clearTimeout(timer)
  }, [onDone])

  if (prefersReducedMotion()) return <></>

  return (
    <svg className="strike" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
      <path
        ref={pathRef}
        d={path}
        style={
          {
            // 路径长度是运行时量出来的，写不进 CSS —— 但它必须同时喂给
            // dasharray（起点状态）和 keyframes 里的 from（兜底值）
            strokeDasharray: length || 1,
            strokeDashoffset: length || 1,
            '--strike-len': length || 1,
            animation: 'strike-draw 260ms ease-out forwards'
          } as CSSProperties
        }
      />
    </svg>
  )
}

/**
 * 从种子算出一条固定抖动的路径。
 *
 * 用 FNV-1a 哈希把 id 摊成几个确定性的偏移量 —— 同一个 id 永远得到同一条曲线。
 * 三段折线而不是一条直线，中间那段的粗细单独用第二个 path 叠出来（见 CSS）。
 */
function wobblePath(seed: string): string {
  const h = fnv1a(seed)
  const j1 = ((h % 7) - 3) * 0.35
  const j2 = (((h >> 3) % 7) - 3) * 0.35
  const j3 = (((h >> 6) % 7) - 3) * 0.35
  const startX = -0.5 + ((h >> 9) % 5) * 0.2
  const endX = 100.5 + ((h >> 12) % 5) * 0.2
  return [
    `M ${startX} ${4 + j1}`,
    `C ${25} ${4 + j2}, ${55} ${4 + j3}, ${endX} ${4 + j1 * 0.5}`,
    // 收笔那一小段往回勾一点，是手写的习惯
    `M ${endX} ${4 + j1 * 0.5} l 1.4 ${j2 * 0.6}`
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
