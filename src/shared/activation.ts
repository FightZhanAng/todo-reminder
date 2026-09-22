import { ACTION_ORDER, type TaskAction } from './actions'

/**
 * 通知的 tag。Windows 上它就是 `Notification.id`，激活时系统**原样回传**，
 * 所以这是「点的是哪条通知」唯一的凭据 —— 冷启动时内存里可没有那个
 * Notification 对象，光靠对象上的事件是接不到点击的。
 *
 * 分隔符用冒号不用连字符：任务 id 是 UUID，本身就带连字符。
 */
export function taskTag(taskId: string, at: number): string {
  return `task:${taskId}:${at}`
}

/** 聚合通知（「有 N 件事错过了」）。带上第一条的 id，点它要能落到那一条上 */
export function missedTag(taskId: string, at: number): string {
  return `missed:${taskId}:${at}`
}

/** Electron `ActivationArguments` 的形状（不 import electron，保持这个文件能无头测试） */
export interface ActivationLike {
  type: string
  arguments: string
  actionIndex?: number
}

export type Activation =
  /** 只把窗口唤起来、聚焦到那条任务 */
  | { kind: 'open'; taskId: string }
  /** 直接对那条任务执行通知上的按钮 */
  | { kind: 'action'; taskId: string; action: TaskAction }
  | { kind: 'unknown' }

function parsePairs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of s.split('&')) {
    const i = pair.indexOf('=')
    if (i <= 0) continue
    out[pair.slice(0, i)] = decode(pair.slice(i + 1))
  }
  return out
}

function decode(v: string): string {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/**
 * 把 Windows 回传的激活参数翻译成「对哪条任务做哪个动作」。
 *
 * 实测的 arguments 长这样：`type=action&action=0&tag=task:<id>:<at>`。
 * 标签从**右**切（`task:` 前缀固定、末段是时间戳，中间整段才是 id），
 * 否则 UUID 里的连字符会把 id 切坏。
 *
 * 聚合通知只有一颗按钮「打开待办」，它跟任务通知的第一颗按钮同为下标 0 ——
 * 所以**不能**按 ACTION_ORDER 去解释它，否则点「打开待办」会把第一条任务完成掉。
 */
export function parseActivation(a: ActivationLike): Activation {
  const p = parsePairs(a.arguments)
  const m = /^(task|missed):(.+):(\d+)$/.exec(p.tag ?? '')
  if (!m) return { kind: 'unknown' }
  const taskId = m[2]
  if (m[1] === 'missed') return { kind: 'open', taskId }

  const index = a.actionIndex ?? (p.action !== undefined ? Number(p.action) : undefined)
  const action = index === undefined ? undefined : ACTION_ORDER[index]
  if ((a.type === 'action' || index !== undefined) && action) {
    return { kind: 'action', taskId, action }
  }
  return { kind: 'open', taskId }
}
