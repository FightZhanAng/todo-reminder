import type { JSX } from 'react'
import type { WindowAction } from '@shared/ipc'

/**
 * 自绘标题带 —— 顶掉 Windows 那条不跟主题走的原生标题栏。
 *
 * 整条是拖动区，三个按钮各自 no-drag（见 styles.css）。双击拖动区的
 * 「最大化 / 还原」是 Electron 对拖动区的内建行为，不在这里实现。
 *
 * 三个字形是画的不是打的：− 和 □ 在中文字体里能凑出来，「还原」那个
 * （U+2750）就得指望字体回落，而回落成什么样没人守着。画的代价是每个 6 行 CSS。
 *
 * 关闭按钮的 hover 用靛蓝而不是系统那个红：这里的朱砂只说「已经晚了」和
 * 「删除」（AGENTS.md 第 1 条），关掉一个常驻托盘应用的窗两样都不是。
 */
export function TitleBar({ maximized }: { maximized: boolean }): JSX.Element {
  const act = (action: WindowAction): (() => void) => () => {
    void window.todo.window(action)
  }

  return (
    <header className="titlebar">
      <span className="titlebar__name">待办提醒</span>
      <div className="titlebar__actions">
        <button type="button" className="titlebar__button" aria-label="最小化" onClick={act('minimize')}>
          <span className="titlebar__mark titlebar__mark--min" />
        </button>
        <button
          type="button"
          className="titlebar__button"
          aria-label={maximized ? '向下还原' : '最大化'}
          onClick={act('toggle-maximize')}
        >
          <span
            className={
              maximized ? 'titlebar__mark titlebar__mark--restore' : 'titlebar__mark titlebar__mark--max'
            }
          />
        </button>
        <button type="button" className="titlebar__button" aria-label="关闭" onClick={act('close')}>
          <span className="titlebar__mark titlebar__mark--close" />
        </button>
      </div>
    </header>
  )
}
