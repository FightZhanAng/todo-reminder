import type { QuickAddApi, TodoApi } from '../shared/ipc'

declare global {
  interface Window {
    todo: TodoApi
    quickadd: QuickAddApi
  }
}
