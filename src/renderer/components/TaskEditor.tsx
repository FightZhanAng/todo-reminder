import type { JSX } from 'react'
import type { AppState, View } from '../useAppState'

/** 桩：Task 10 换成真正的编辑器 */
export function TaskEditor(_props: {
  state: AppState
  view: Extract<View, { name: 'edit' }>
}): JSX.Element | null {
  return null
}
