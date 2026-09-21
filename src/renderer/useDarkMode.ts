import { useEffect, useState } from 'react'

const QUERY = '(prefers-color-scheme: dark)'

/**
 * 当前**实际显示**的是不是深色。
 *
 * 刻意不用 `settings.theme` 直接判断：那一项有三个值（跟随系统 / 浅色 / 深色），
 * `auto` 时它自己不说现在到底是哪一边。而切换按钮必须知道这一点 ——
 * 否则系统是深色、设置是 auto 时，点一下「切深色」会毫无反应。
 *
 * 能这么问是因为主题只有一条通路：主进程设 `nativeTheme.themeSource`，
 * 渲染层的 `prefers-color-scheme` 跟着变（见 `src/main/theme.ts`）。
 * 于是这里监听媒体查询就等价于监听主题。
 */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(QUERY).matches)

  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const onChange = (e: MediaQueryListEvent): void => setDark(e.matches)
    mql.addEventListener('change', onChange)
    // 订阅之前可能已经变过（首帧与 effect 之间隔了一次提交），补问一次
    setDark(mql.matches)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return dark
}
