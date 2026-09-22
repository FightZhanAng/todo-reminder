/**
 * Windows toast 的 XML。
 *
 * **为什么不让 Electron 生成**：`Notification` 的选项里没有任何办法给 `<toast>`
 * 加 `launch` 属性，而 Windows 只在 `<toast launch="...">` 里才把「点正文」那一下
 * 的参数交给注册的 COM 激活器 —— 按钮自己的 `arguments` 管按钮，正文归 `launch`。
 *
 * 实测（从本机通知数据库 `wpndatabase.db` 里翻出 Electron 生成的原始 XML）：
 * `<toast>` 上**没有** `launch`，tag 只写在三颗按钮的 `arguments` 里。于是点正文时
 * 回传的 invokedArgs 是空的，`parseActivation` 认不出是哪条任务（`{kind:'unknown'}`）
 * → 直接 return，什么都不发生。症状就是「按钮能点、点正文没反应」。
 *
 * 这里把整段 XML 拼出来，形状照抄 Electron 原来那份（`ToastGeneric` +
 * `activationType="foreground"` 的 action + `audio`），只多一个 `launch`。
 *
 * 纯函数，放 `shared/` 是为了能进无头测试 —— 这段东西最易错的两处（属性值里的
 * `&` 忘记转义、`arguments` 的格式和 `parseActivation` 对不上）都测得到。
 */

/** XML 属性值转义。`&` 必须最先换，否则会把后面转出来的实体再转一遍 */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 正文点击的参数：`type=click&tag=<tag>`。
 *
 * 与按钮的 `type=action&action=<i>&tag=<tag>` 是同一种键值串（`parseActivation`
 * 按 `&` 切）。少了 `action=` 那一项，它就被解释成 `{kind:'open'}` ——
 * 只唤起窗口并聚焦，不会被误当成某个动作。
 */
export function toastLaunchArgs(tag: string): string {
  return `type=click&tag=${tag}`
}

/** 第 `index` 颗按钮的参数。下标就是 `ACTION_ORDER` 的下标 */
export function toastActionArgs(index: number, tag: string): string {
  return `type=action&action=${index}&tag=${tag}`
}

export interface ToastSpec {
  /** 通知的 tag（`taskTag` / `missedTag` 的产物）—— 正文与每颗按钮都靠它认人 */
  tag: string
  title: string
  body: string
  /** 按钮文案，下标就是 `parseActivation` 认的那个 action 下标 */
  buttons: string[]
  /** true = 不出声（写 `<audio silent="true"/>`）；false 不写，走系统默认音 */
  silent: boolean
}

export function buildToastXml(spec: ToastSpec): string {
  const texts = [`      <text>${xmlEscape(spec.title)}</text>`]
  // 正文为空就不渲染第二个 text —— 空的第二行会在通知里空出一块
  if (spec.body !== '') texts.push(`      <text>${xmlEscape(spec.body)}</text>`)

  const actions = spec.buttons.map(
    (label, i) =>
      `    <action activationType="foreground" arguments="${xmlEscape(
        toastActionArgs(i, spec.tag)
      )}" content="${xmlEscape(label)}"/>`
  )

  const lines = [
    `<toast launch="${xmlEscape(toastLaunchArgs(spec.tag))}">`,
    '  <visual>',
    '    <binding template="ToastGeneric">',
    ...texts,
    '    </binding>',
    '  </visual>'
  ]
  // 一颗按钮都没有时不写空的 <actions>（那种 XML 不是合法的 toast）
  if (actions.length > 0) lines.push('  <actions>', ...actions, '  </actions>')
  if (spec.silent) lines.push('  <audio silent="true"/>')
  lines.push('</toast>')

  return lines.join('\n')
}
