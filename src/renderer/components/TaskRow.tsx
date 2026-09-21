import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { Task } from '@shared/types'
import { urgencyOf } from '@shared/urgency'
import { RowMenu, type MenuItem } from './RowMenu'
import { StrikeLine } from './StrikeLine'
import type { AppState } from '../useAppState'

export interface TaskRowProps {
  task: Task
  state: AppState
  /** 时刻列文案。没有时刻的行（「今天随时」与收件箱）传空串 ——
      刻度列的位置由 fixed 宽度撑住，**不能靠不渲染**，否则那几个分段的
      竖轴会整体左移，一根轴就断成两截了 */
  clock?: string
  cursor: boolean
  highlight: boolean
  exitKind?: 'done' | 'removed'
  /**
   * 「已完成」形态：勾是选中态、标题划掉、点勾走 `state.uncomplete`。
   *
   * 与 `exitKind` 正交 —— 退场动画该播还是照播。两者同时为真时表现是
   * 「点勾 → 这一笔还在（静态墨线不重画）→ 整行降透明度移出」。
   */
  settled?: boolean
  /** 行尾补充文字。省略时按类型给默认（周期任务且连续 ≥ 2 天时显示连续数） */
  trailing?: string
  /** 菜单开合时通知上层（Board 据此挂起看板全局快捷键）。可选，便于复用 */
  onMenuOpenChange?: (open: boolean) => void
}

export function TaskRow({
  task,
  state,
  clock,
  cursor,
  highlight,
  exitKind,
  settled = false,
  trailing,
  onMenuOpenChange
}: TaskRowProps): JSX.Element {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const moreRef = useRef<HTMLButtonElement | null>(null)
  const urgency = urgencyOf(task, state.now)
  const removed = exitKind === 'removed'
  // 周期任务「今天已打卡」时勾点不动：completeRecurring 对同一个
  // lastDoneDay 本来就返回空补丁，做成可点是「点了没反应」的假控件。
  // 取消打卡要清 lastDoneDay + streak 且无法还原，见 commands.ts 的说明。
  const toggleLocked = settled && task.kind === 'recurring'

  // 划完这一笔之后把行交给上层移出。**必须是稳定引用**：StrikeLine 的 520ms
  // 定时器以它为依赖，传内联箭头的话，看板每秒一次的 now tick（useNow）会让
  // 定时器被反复重置，第三拍从 520ms 漂到 520–1040ms（实测 558/563/701/784/1020）。
  // state.settle 本身是 useCallback(…, []) 的稳定引用（useAppState.ts:82）。
  const settleDone = useCallback(() => state.settle([task.id]), [state.settle, task.id])

  const items: MenuItem[] =
    task.kind === 'someday'
      ? [
          {
            label: '今天做',
            onSelect: () => {
              void state.run({ type: 'task:toToday', id: task.id })
              state.setFlash('已移到今天')
            }
          },
          { label: '编辑', onSelect: () => state.go({ name: 'edit', id: task.id, kind: task.kind }) },
          { label: '删除', danger: true, onSelect: () => state.remove(task) }
        ]
      : [
          // 已完成清单里第一项换成「取消完成」—— 一本只是陈列的账，
          // 见到一条记错的也没有办法改，等于没有账
          settled && !toggleLocked
            ? { label: '取消完成', onSelect: () => state.uncomplete(task) }
            : { label: '完成', onSelect: () => state.complete(task) },
          {
            label: `推迟 ${state.snapshot!.settings.snoozeMinutes} 分钟`,
            onSelect: () => {
              void state.run({
                type: 'task:snooze',
                id: task.id,
                minutes: state.snapshot!.settings.snoozeMinutes
              })
            }
          },
          { label: '推到明天', onSelect: () => void state.run({ type: 'task:postpone', id: task.id }) },
          { label: '编辑', onSelect: () => state.go({ name: 'edit', id: task.id, kind: task.kind }) },
          { label: '删除', danger: true, onSelect: () => state.remove(task) }
        ]

  // 退场行的交互契约（两种行不一样，别混）：
  // - done：520ms 内整行不可点击（挂 .row--exiting → pointer-events:none），
  //   避免用户点到一条正在消失的行（规格 §9.5）。
  // - removed：5 秒撤销窗口内整行仍不可点（.row--exiting 保留，否则误触
  //   圆点/标题会给已软删任务写 completedAt，撤销后 groupToday 因 completedAt
  //   直接不渲染，看起来「撤销没生效」）；但「撤销」按钮单独放开（见
  //   styles.css 的 .row--removed .row__undo { pointer-events: auto }），让它可点。
  const classes = ['row']
  if (task.important) classes.push('row--important')
  if (cursor) classes.push('row--cursor')
  if (highlight) classes.push('row--highlight')
  if (settled) classes.push('row--settled')
  // 两种退场行都挂 .row--exiting（整行 pointer-events:none），只把「撤销」放出来
  if (exitKind) classes.push('row--exiting')
  if (removed) classes.push('row--removed')
  if (exitKind === 'done') classes.push('row--done')

  // 菜单开合 → 通知上层（Board 用来挂起看板快捷键，Important 2）。
  // cleanup 兜底：行在菜单打开时被卸载（如跨零点重新分组导致换段/消失，
  // SectionList 段空返回 null），也要补报 false，否则 menuOpen 卡在 true
  // 会永久挂起看板快捷键，直到再开合一次菜单或重进看板才恢复。
  useEffect(() => {
    onMenuOpenChange?.(anchor !== null)
    return () => onMenuOpenChange?.(false)
  }, [anchor, onMenuOpenChange])

  return (
    <li className={classes.join(' ')} data-task-id={task.id}>
      <span className="row__cursor" aria-hidden="true" />
      {/* 时刻列恒定占位（没有时刻的行是空的）—— 刻度列的 x 由它撑住 */}
      <span className="row__clock mono" data-urgency={urgency} aria-hidden="true">
        {clock ?? ''}
      </span>
      {/* 刻度列：一根贯通全页的竖轴 + 这一行的一道刻度。
          刻度长度与颜色都取自同一个 urgency，时刻列的颜色也取自它，
          所以「色条是灰的、时刻是红的」这种自相矛盾不可能出现 */}
      <span className="row__tick" data-urgency={urgency} aria-hidden="true" />

      {/* 清单池没有「完成」这个动作（commands.ts 里显式拒绝），所以那个位置
          不放一个永远点不动的圆点，改成这条任务唯一该做的动作 */}
      {task.kind === 'someday' ? (
        <button
          type="button"
          className="row__today"
          onClick={(e) => {
            e.stopPropagation()
            void state.run({ type: 'task:toToday', id: task.id })
            state.setFlash('已移到今天')
          }}
        >
          今天做
        </button>
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={settled}
          aria-label={settled ? `取消完成${task.title}` : `完成${task.title}`}
          title={toggleLocked ? '今天已经打过卡了' : undefined}
          disabled={toggleLocked}
          className={settled ? 'row__dot row__dot--on' : 'row__dot'}
          onClick={(e) => {
            e.stopPropagation()
            if (settled) state.uncomplete(task)
            else state.complete(task)
          }}
        />
      )}

      <span
        className="row__title"
        onClick={() => state.go({ name: 'edit', id: task.id, kind: task.kind })}
        role="button"
        tabIndex={-1}
      >
        {/* 「重要」不在这里加标记 —— 它只改 .row--important 上的字重 */}
        {/* 墨线要贴的是**字**的宽度，而 .row__title 是 flex:1 撑满整行的盒子：
            短标题时墨线会从字尾一路拖到整行右端。所以文字单独包一层，由这个内联
            盒子当 .strike 的包含块（宽度由 StrikeLine 量出来写死，见那边的注释）。
            overflow: hidden 仍留在 .row__title 上 —— 长标题的省略号照旧，
            墨线也被切在同一个位置。 */}
        <span className="row__title-text">
          {task.title}
          {(settled || exitKind === 'done') && (
            <StrikeLine seed={task.id} still={settled} onDone={settleDone} />
          )}
        </span>
      </span>

      {trailing !== undefined
        ? trailing !== '' && <span className="row__streak">{trailing}</span>
        : task.kind === 'recurring' &&
          task.streak >= 2 && <span className="row__streak">连续 {task.streak} 天</span>}

      {removed ? (
        <button type="button" className="row__undo" onClick={() => state.undoRemove(task.id)}>
          撤销
        </button>
      ) : (
        <button
          ref={moreRef}
          type="button"
          className="row__more"
          aria-label="更多操作"
          aria-expanded={anchor !== null}
          onClick={(e) => {
            e.stopPropagation()
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            // toggle：再点一次 ⋮ 关闭（Minor 4）。外部点击仍由 RowMenu 关闭
            setAnchor((prev) => (prev === null ? { x: r.right, y: r.bottom } : null))
          }}
        >
          ⋮
        </button>
      )}

      {anchor !== null && (
        <RowMenu
          items={items}
          anchor={anchor}
          anchorEl={moreRef.current}
          onClose={() => setAnchor(null)}
        />
      )}
    </li>
  )
}
