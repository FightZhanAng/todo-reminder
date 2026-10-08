import { useState, type JSX } from 'react'
import { hotkeyFromEvent, isValidHotkey } from '@shared/hotkey'
import { REPO_URL } from '@shared/project'
import type { Settings } from '@shared/types'
import { updateSummary, type UpdateState } from '@shared/update'
import type { AppState } from '../useAppState'
import { TimeField } from './TimeField'

const THEMES: { value: Settings['theme']; label: string }[] = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

/** 推迟的常用档位。手填一个 7 分钟没有意义，给三个就够了 */
const SNOOZE_STEPS = [5, 10, 30]

/**
 * 倒计时的显示范围。`0` = 不限。
 *
 * 给档位而不是给一个数字输入框：这是「我想看多远」的偏好，
 * 没人会想填「247 天」。
 */
const HORIZON_STEPS: { value: number; label: string }[] = [
  { value: 30, label: '一个月' },
  { value: 90, label: '三个月' },
  { value: 365, label: '一年' },
  { value: 0, label: '不限' }
]

export function SettingsPanel({ state }: { state: AppState }): JSX.Element {
  const snapshot = state.snapshot!
  const s = snapshot.settings
  // 更新状态整组来自 runtime（不落盘），下面每一处都读它
  const u = snapshot.runtime.update
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
            <span className="unit">全天任务和纪念日在这时提醒</span>
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

        <div className="group__label">倒计时</div>

        <div className="field">
          <span className="field__label">节假日</span>
          <span className="field__control">
            <label className="check">
              <input
                type="checkbox"
                checked={s.countdownHolidays}
                onChange={(e) => patch({ countdownHolidays: e.target.checked })}
              />
              在倒计时里显示法定节假日
            </label>
          </span>
        </div>

        <div className="field">
          <span className="field__label">只看</span>
          <span className="field__control field__control--row">
            <span className="segmented">
              {HORIZON_STEPS.map((step) => (
                <button
                  key={step.value}
                  type="button"
                  className={
                    s.countdownHorizonDays === step.value
                      ? 'segmented__item segmented__item--on'
                      : 'segmented__item'
                  }
                  onClick={() => patch({ countdownHorizonDays: step.value })}
                >
                  {step.label}
                </button>
              ))}
            </span>
          </span>
        </div>
        <div className="field__hint">
          更远的纪念日不列出来（已经过掉的那种永远会显示）。日历上的农历与休假标记不受这里影响。
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
          {backupWarning(snapshot.runtime) !== null && (
            <div className="field__hint field__hint--warn">{backupWarning(snapshot.runtime)}</div>
          )}
        </div>

        <div className="group__label">更新</div>

        <div className="field">
          <span className="field__label">当前版本</span>
          <div className="field__hint mono">{snapshot.runtime.version}</div>
        </div>

        {u.unsupported === null && (
          <div className="field">
            <span className="field__label">自动更新</span>
            <span className="field__control">
              <label className="check">
                <input
                  type="checkbox"
                  checked={s.autoUpdate}
                  onChange={(e) => patch({ autoUpdate: e.target.checked })}
                />
                自动检查并下载
              </label>
            </span>
          </div>
        )}

        <div className="field field--stack">
          <span className="field__label">更新状态</span>
          <div className="field__hint">{updateSummary(u)}</div>
          <div className="page__foot">{updateActions(u)}</div>
        </div>

        <div className="group__label">关于</div>

        <div className="field field--stack">
          <span className="field__label">项目主页</span>
          {/* 地址本身要露出来：想给谁发一份、想顺手查一眼代码，复制比点开更快 */}
          <div className="field__hint mono path">{REPO_URL}</div>
          <div className="page__foot">
            <button
              type="button"
              className="linkbutton"
              onClick={() => void window.todo.window('open-repo-page')}
            >
              用浏览器打开
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 更新那一格该给哪个按钮。
 *
 * 抽成函数是因为它是个**穷举**：状态有八个，按钮只有四种。写在 JSX 里的
 * if 链每加一个状态就会漏一个分支，而漏掉的表现是「那一格什么都没有」——
 * 不报错，只是不能用。
 *
 * 便携版与 mac 未签名版走 `open-download-page`（都装不了自动更新，见 shared/update.ts），
 * 开发版什么都不给 —— 那里根本没有更新源可谈。
 */
function updateActions(u: UpdateState): JSX.Element | null {
  if (u.unsupported === 'portable' || u.unsupported === 'mac-unsigned') {
    return (
      <button
        type="button"
        className="linkbutton"
        onClick={() => void window.todo.window('open-download-page')}
      >
        打开发布页
      </button>
    )
  }
  if (u.unsupported === 'dev') return null

  if (u.status === 'ready') {
    return (
      <button
        type="button"
        className="linkbutton"
        onClick={() => void window.todo.installUpdate()}
      >
        重启并安装
      </button>
    )
  }
  if (u.status === 'available') {
    return (
      <button
        type="button"
        className="linkbutton"
        onClick={() => void window.todo.downloadUpdate()}
      >
        下载
      </button>
    )
  }
  if (u.status === 'downloading') {
    // 下载时不给按钮：这是个托盘应用，用户该能继续用它，
    // 不该被一个「取消」诱导去点（取消了下次还得重下）
    return null
  }
  return (
    <button
      type="button"
      className="linkbutton"
      disabled={u.status === 'checking'}
      onClick={() => void window.todo.checkUpdate()}
    >
      {u.status === 'checking' ? '正在检查…' : '检查更新'}
    </button>
  )
}

/**
 * 上次启动读到的问题数据，一句话说清「发生了什么 + 备份在哪」。
 *
 * 三种成因共用一个 `corruptBackupPath`（store.ts 里都由 `copyAside` 或损坏那一路写入），
 * 所以判据是它们各自的标记字段，而不是那个路径 —— 按路径猜会把「版本更新」
 * 说成「文件损坏」。
 */
function backupWarning(runtime: {
  corruptBackupPath: string | null
  droppedTaskCount: number
  newerFileVersion: number | null
}): string | null {
  if (runtime.corruptBackupPath === null) return null
  if (runtime.droppedTaskCount > 0) {
    return `上次启动有 ${runtime.droppedTaskCount} 条记录形状不合法被跳过，原文备份在 ${runtime.corruptBackupPath}`
  }
  if (runtime.newerFileVersion !== null) {
    return `数据文件来自更新的版本（v${runtime.newerFileVersion}），当前版本可能读不全；原文备份在 ${runtime.corruptBackupPath}`
  }
  return `上次启动读到损坏的文件，已备份到 ${runtime.corruptBackupPath}`
}

function clampInt(value: string, fallback: number, lo: number, hi: number): number {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, n))
}
