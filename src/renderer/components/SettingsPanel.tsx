import { useState, type JSX } from 'react'
import { hotkeyFromEvent, isValidHotkey } from '@shared/hotkey'
import type { Settings } from '@shared/types'
import type { AppState } from '../useAppState'
import { TimeField } from './TimeField'

const THEMES: { value: Settings['theme']; label: string }[] = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

/** 推迟的常用档位。手填一个 7 分钟没有意义，给三个就够了 */
const SNOOZE_STEPS = [5, 10, 30]

export function SettingsPanel({ state }: { state: AppState }): JSX.Element {
  const snapshot = state.snapshot!
  const s = snapshot.settings
  const [capturing, setCapturing] = useState(false)
  const [hotkeyProblem, setHotkeyProblem] = useState<string | null>(null)

  const patch = (p: Partial<Settings>): void => {
    void state.run({ type: 'settings:patch', patch: p })
  }

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar__lead">
          <button
            type="button"
            className="iconbutton"
            aria-label="返回今天"
            onClick={() => state.go({ name: 'board' })}
          >
            ←
          </button>
          <h1 className="topbar__title">设置</h1>
        </div>
      </header>

      <div className="page__body">
        <div className="group__label">提醒</div>

        <div className="field">
          <span className="field__label">系统通知</span>
          <span className="field__control">
            <label className="check">
              <input
                type="checkbox"
                checked={s.notifyEnabled}
                onChange={(e) => patch({ notifyEnabled: e.target.checked })}
              />
              到点弹通知
            </label>
          </span>
        </div>

        <div className="field">
          <span className="field__label">提示音</span>
          <span className="field__control">
            <label className="check">
              <input
                type="checkbox"
                checked={s.soundEnabled}
                onChange={(e) => patch({ soundEnabled: e.target.checked })}
              />
              通知带声音
            </label>
          </span>
        </div>

        <div className="field">
          <span className="field__label">全天提醒</span>
          <span className="field__control field__control--row">
            <TimeField
              value={s.allDayRemindTime}
              onChange={(v) => patch({ allDayRemindTime: v })}
              label="全天提醒时刻"
            />
            <span className="unit">全天任务在这时提醒</span>
          </span>
        </div>

        <div className="field">
          <span className="field__label">默认提前</span>
          <span className="field__control field__control--row">
            <input
              type="number"
              min={0}
              max={1440}
              value={s.defaultLeadMin}
              onChange={(e) => patch({ defaultLeadMin: clampInt(e.target.value, s.defaultLeadMin, 0, 1440) })}
            />
            <span className="unit">分钟（新建截止任务时预填）</span>
          </span>
        </div>

        <div className="field">
          <span className="field__label">推迟</span>
          <span className="field__control">
            <span className="segmented">
              {SNOOZE_STEPS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={
                    s.snoozeMinutes === m
                      ? 'segmented__item segmented__item--on'
                      : 'segmented__item'
                  }
                  onClick={() => patch({ snoozeMinutes: m })}
                >
                  {m} 分钟
                </button>
              ))}
            </span>
          </span>
        </div>

        <div className="group__label">免打扰</div>

        <div className="field">
          <span className="field__label">时段</span>
          <span className="field__control">
            <label className="check">
              <input
                type="checkbox"
                checked={s.quietHours !== null}
                onChange={(e) =>
                  patch({
                    quietHours: e.target.checked
                      ? (s.quietHours ?? { start: '22:00', end: '08:00' })
                      : null
                  })
                }
              />
              这段时间不弹通知
            </label>
          </span>
        </div>

        {s.quietHours !== null && (
          <>
            <div className="field">
              <span className="field__label">从</span>
              <span className="field__control">
                <TimeField
                  value={s.quietHours.start}
                  onChange={(v) => patch({ quietHours: { ...s.quietHours!, start: v } })}
                  label="免打扰开始"
                />
              </span>
            </div>
            <div className="field">
              <span className="field__label">到</span>
              <span className="field__control field__control--row">
                <TimeField
                  value={s.quietHours.end}
                  onChange={(v) => patch({ quietHours: { ...s.quietHours!, end: v } })}
                  label="免打扰结束"
                />
                <span className="unit">可以跨午夜</span>
              </span>
            </div>
          </>
        )}

        <div className="field">
          <span className="field__label">离开时</span>
          <span className="field__control">
            <label className="check">
              <input
                type="checkbox"
                checked={s.quietWhenIdle}
                onChange={(e) => patch({ quietWhenIdle: e.target.checked })}
              />
              人不在电脑前就不弹，回来再补
            </label>
          </span>
        </div>

        {s.quietWhenIdle && (
          <div className="field">
            <span className="field__label">判定</span>
            <span className="field__control field__control--row">
              <input
                type="number"
                min={1}
                max={180}
                value={s.idleThresholdMin}
                onChange={(e) =>
                  patch({ idleThresholdMin: clampInt(e.target.value, s.idleThresholdMin, 1, 180) })
                }
              />
              <span className="unit">分钟没操作就算离开</span>
            </span>
          </div>
        )}

        <div className="group__label">外观与启动</div>

        <div className="field">
          <span className="field__label">主题</span>
          <span className="field__control">
            <span className="segmented">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={
                    s.theme === t.value ? 'segmented__item segmented__item--on' : 'segmented__item'
                  }
                  onClick={() => patch({ theme: t.value })}
                >
                  {t.label}
                </button>
              ))}
            </span>
          </span>
        </div>

        <div className="field">
          <span className="field__label">窗口置顶</span>
          <span className="field__control">
            <label className="check">
              <input
                type="checkbox"
                checked={s.alwaysOnTop}
                onChange={(e) => patch({ alwaysOnTop: e.target.checked })}
              />
              让主窗口浮在所有窗口前面
            </label>
          </span>
        </div>

        <div className="field">
          <span className="field__label">开机启动</span>
          <span className="field__control">
            <label className="check">
              <input
                type="checkbox"
                checked={s.launchAtLogin}
                onChange={(e) => patch({ launchAtLogin: e.target.checked })}
              />
              登录 Windows 后自动运行
            </label>
          </span>
        </div>

        <div className="group__label">随手记</div>

        <div className="field field--stack">
          <span className="field__label">全局快捷键</span>
          <input
            readOnly
            className="mono"
            value={capturing ? '' : s.hotkey}
            placeholder={capturing ? '按下组合键…' : '未设置'}
            onFocus={() => {
              setCapturing(true)
              setHotkeyProblem(null)
            }}
            onBlur={() => setCapturing(false)}
            onKeyDown={(e) => {
              e.preventDefault()
              if (e.key === 'Escape') {
                e.currentTarget.blur()
                return
              }
              const hk = hotkeyFromEvent(e)
              // 只按了修饰键：还没按完，继续等
              if (hk === null) return
              setCapturing(false)
              e.currentTarget.blur()
              void window.todo.setHotkey(hk).then((r) => {
                setHotkeyProblem(r.ok ? null : `${hk} 被别的程序占用了，换一个`)
              })
            }}
          />
          <div className="field__hint">
            {hotkeyProblem !== null
              ? hotkeyProblem
              : capturing
                ? '按下想用的组合键，Esc 取消'
                : isValidHotkey(s.hotkey)
                  ? snapshot.runtime.hotkeyRegistered
                    ? '按一下就在屏幕中间开一个小窗，记完就关'
                    : '设置里存着，但当前没注册上（可能被别的程序抢走了）'
                  : '还没设置'}
          </div>
        </div>

        <div className="group__label">数据</div>

        <div className="field field--stack">
          <span className="field__label">数据文件</span>
          <div className="field__hint mono path">{snapshot.runtime.dataFile}</div>
          <div className="page__foot">
            <button
              type="button"
              className="linkbutton"
              onClick={() => void window.todo.window('open-data-dir')}
            >
              打开所在文件夹
            </button>
            <button type="button" className="linkbutton" onClick={() => void window.todo.window('quit')}>
              退出应用
            </button>
          </div>
          {snapshot.runtime.corruptBackupPath !== null && (
            <div className="field__hint field__hint--warn">
              上次启动读到损坏的文件，已备份到 {snapshot.runtime.corruptBackupPath}
            </div>
          )}
        </div>

        <div className="field field--stack">
          <span className="field__label">版本</span>
          <div className="field__hint mono">{snapshot.runtime.version}</div>
        </div>
      </div>
    </div>
  )
}

function clampInt(value: string, fallback: number, lo: number, hi: number): number {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}
