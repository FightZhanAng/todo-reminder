import { nativeTheme } from 'electron'
import type { Settings } from '../shared/types'

/**
 * 一处对齐两边的主题。
 *
 * 设了 `themeSource` 之后，主进程的 `nativeTheme.shouldUseDarkColors` 与渲染层的
 * `prefers-color-scheme` **同时**跟着变 —— 不需要任何主进程↔渲染层的通信。
 * 这是本期选它而不是「两边各算一次」的全部理由（规格 §2 决策 6）。
 */
export function applyTheme(theme: Settings['theme']): void {
  nativeTheme.themeSource = theme === 'auto' ? 'system' : theme
}
