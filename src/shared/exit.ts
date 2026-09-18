import type { Task } from './types'

export type ExitKind = 'done' | 'removed'

/**
 * 正在播放退场动画的一行。
 *
 * 为什么需要它：完成一件事时 `completedAt` 一写进 store，`groupToday` 就不再返回
 * 这条任务 —— 快照一到，行会**当场消失**，规格 §9.5 要的三拍动画（划线 0–260ms →
 * 降透明度 260–520ms → 移出）没得播。所以渲染层记下这行**变更前长什么样**。
 */
export interface ExitingEntry {
  /** 变更**前**的那一份。注意不是变更后的 —— 还原靠的就是它 */
  task: Task
  kind: ExitKind
  /** 登记时刻（渲染层的 Date.now()） */
  startedAt: number
}

/** 规格 §9.5：0–260ms 划线，260–520ms 降透明度并移出 */
export const EXIT_DONE_MS = 520
/** 删除的行要留够撤销的时间 */
export const EXIT_REMOVED_MS = 5_000

export function exitDurationMs(kind: ExitKind): number {
  return kind === 'done' ? EXIT_DONE_MS : EXIT_REMOVED_MS
}

/**
 * 把正在退场的行**替换回变更前的版本**。
 *
 * 注意这里是「替换」而不是「并回列表末尾」—— 这个区别不是口味问题：
 *
 * 1. 快照里那条任务**还在**（完成只是写了 `completedAt`，删除只是写了 `deletedAt`），
 *    所以我们要做的是**盖掉它**，而不是再插一条同 id 的。
 * 2. 盖回变更前的版本之后，`groupToday` 会把它放回**它原本那段、原本那个排序位置**。
 *    如果改成"追加到列表末尾"，行会先跳到段尾再开始播划掉的动画 —— 视线会跟丢。
 * 3. 更硬的理由：`groupToday` 对**已完成的周期任务**直接返回空（过滤条件是
 *    `lastDoneDay !== dayKey(now)`）。追加式合并根本找不到该把它放进哪一段。
 *
 * `expired` 是「**该从调用方的 exiting 里剔除的 id**」，三种成因：
 *   1. 动画已经播完（`now - startedAt >= 时长`）
 *   2. 这条 id 在 `current` 里已经不存在（例如被硬删）—— 没有可盖的目标了
 *   3. 同一个 id 被重复登记（保留第一条）
 *
 * 反过来：`current` 里少了一条、但它**不在** `exiting` 里 —— 本函数不会把它
 * 复活。这是刻意的：一条任务从列表消失有五种原因（完成 / 软删 / 推到明天 /
 * 改成别的类型 / 跨过午夜），只有调用方明确登记过的才配播退场动画，
 * 靠 diff 猜会把「被推到明天」播成「划掉」。
 */
export function mergeExiting(
  current: readonly Task[],
  exiting: readonly ExitingEntry[],
  now: number
): { tasks: Task[]; expired: string[] } {
  const expired: string[] = []
  const replacement = new Map<string, Task>()
  const seen = new Set<string>()

  for (const entry of exiting) {
    const id = entry.task.id
    if (seen.has(id)) {
      expired.push(id)
      continue
    }
    seen.add(id)
    if (now - entry.startedAt >= exitDurationMs(entry.kind)) {
      expired.push(id)
      continue
    }
    replacement.set(id, entry.task)
  }

  const present = new Set<string>()
  const tasks = current.map((task) => {
    present.add(task.id)
    return replacement.get(task.id) ?? task
  })

  // 登记过、但 current 里已经没有的 id：没有可盖的目标，直接剔除
  for (const id of replacement.keys()) {
    if (!present.has(id)) expired.push(id)
  }

  return { tasks, expired }
}
