/**
 * 全局快捷键的规范化与校验。
 *
 * 存进 settings.hotkey 的永远是规范化形式（`Control+Alt+T`），
 * 这样 `globalShortcut.register` 收到的东西是可预测的，
 * 用户手写 'ctrl+alt+t' 也能被认出来。
 */

const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: 'Control', control: 'Control', cmdorctrl: 'Control', commandorcontrol: 'Control',
  alt: 'Alt', option: 'Alt',
  shift: 'Shift',
  super: 'Super', meta: 'Super', cmd: 'Super', command: 'Super', win: 'Super'
}

/** 修饰键的输出顺序是固定的 —— Electron 不在乎顺序，但规范化后便于比较与存储 */
const MODIFIER_ORDER = ['Control', 'Alt', 'Shift', 'Super']

/** 非单字符主键 → Electron accelerator 里的名字 */
const NAMED_KEYS: Record<string, string> = {
  space: 'Space', spacebar: 'Space',
  tab: 'Tab', backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert',
  enter: 'Enter', return: 'Enter', escape: 'Escape', esc: 'Escape',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
  plus: 'Plus', minus: '-', comma: ',', period: '.', slash: '/', backslash: '\\',
  semicolon: ';', quote: "'", bracketleft: '[', bracketright: ']', backquote: '`'
}

/** F1–F24 */
function isFunctionKey(token: string): boolean {
  const m = /^f([1-9]|1\d|2[0-4])$/.exec(token)
  return m !== null
}

function canonicalKeyToken(token: string): string | null {
  if (token.length === 1) {
    // 单字符：字母一律大写；数字与标点原样（Electron 接受 'A' / '1' / ','）
    return /[a-z]/i.test(token) ? token.toUpperCase() : token
  }
  if (isFunctionKey(token)) return token.toUpperCase()
  return NAMED_KEYS[token] ?? null
}

/**
 * 规范化。合法返回 `Control+Alt+T` 这种形式，非法返回 null。
 *
 * 规则：**必须含至少一个修饰键 + 恰好一个主键**。
 * 不带修饰键的组合（例如单独的 `T`）在全局快捷键里会把那个键从所有程序手里抢走 ——
 * 不给出这种可能。
 */
export function normalizeHotkey(input: string): string | null {
  if (typeof input !== 'string') return null
  const tokens = input
    .split('+')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0)
  if (tokens.length === 0) return null

  const modifiers = new Set<string>()
  const keys: string[] = []
  for (const token of tokens) {
    const modifier = MODIFIER_ALIASES[token]
    if (modifier) {
      modifiers.add(modifier)
      continue
    }
    const key = canonicalKeyToken(token)
    if (key === null) return null
    keys.push(key)
  }

  if (modifiers.size === 0) return null
  if (keys.length !== 1) return null   // 0 个：只有修饰键；≥2 个：写错了

  const ordered = MODIFIER_ORDER.filter((m) => modifiers.has(m))
  return [...ordered, keys[0]].join('+')
}

export function isValidHotkey(hotkey: string): boolean {
  return normalizeHotkey(hotkey) !== null
}

/** 只取渲染层用得上的字段 —— 这样 `hotkey.ts` 不需要 DOM 类型，可无头测试 */
export interface KeyboardEventLike {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * 把一次按键事件转成快捷键字符串。只按修饰键（或没有修饰键）时返回 null ——
 * 设置页在捕获状态下用 null 表示「还没按完，继续等」。
 */
export function hotkeyFromEvent(e: KeyboardEventLike): string | null {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Control')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Super')
  if (parts.length === 0) return null
  // 主键是修饰键本身时 e.key 会是 'Control' / 'Alt' / … —— 那不是主键，继续等
  if (MODIFIER_ALIASES[e.key.toLowerCase()] !== undefined) return null
  if (e.key === 'Dead' || e.key === 'Unidentified') return null
  // 空格键的 e.key 是**一个空格字符**。直接拼进串再交给 normalizeHotkey，
  // 会被它开头的 `.trim()` 吃成空 token 再被 `.filter(length > 0)` 丢掉 ——
  // 于是 keys.length === 0，整条按键判成非法（返回 null）。
  // NAMED_KEYS 里认的是 'space' / 'spacebar'，所以在这里显式映射。
  const key = e.key === ' ' ? 'space' : e.key
  return normalizeHotkey([...parts, key].join('+'))
}
