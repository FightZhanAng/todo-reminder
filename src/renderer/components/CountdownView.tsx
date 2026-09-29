import { useState, type JSX } from 'react'
import { anniversaryInLeapMonth, daysLeftLabel, yearsLabel } from '@shared/anniversary'
import { collectCountdowns, fullDate, holidaySpanLabel, shortDate } from '@shared/countdown'
import { LATEST_KNOWN_YEAR } from '@shared/holiday'
import { lunarOf } from '@shared/lunar'
import { tsFromDayKey } from '@shared/calendar'
import { dayKey } from '@shared/time'
import type { Anniversary } from '@shared/types'
import { DateField } from './DateField'
import type { AppState } from '../useAppState'

/**
 * 倒计时 —— 节假日与纪念日。
 *
 * 两件事放在同一屏，因为它们回答的是同一个问题：「还有多久到那天」。
 * 分成两个视图的话，用户得先想一下「春节算节假日还是纪念日」。
 *
 * ## 节假日的数据是抄来的
 *
 * 放假安排每年由国务院办公厅发通知定下（见 `shared/holiday.ts` 顶部）。
 * **没公布的年份这里不猜** —— 界面明说「还没公布」，而不是按规则推一个
 * 似是而非的日期：推错了用户会照着去请假。
 *
 * ## 纪念日只倒数，不提醒
 *
 * 它没有「完成」这个动作，也不该在生日当天早上弹一条通知逼你处理。
 * 界面上把这句话写清楚，免得有人等通知等不到。
 */
export function CountdownView({ state }: { state: AppState }): JSX.Element {
  const { now } = state
  const snapshot = state.snapshot!
  const [form, setForm] = useState<FormState | null>(null)

  const list = collectCountdowns(now, snapshot.anniversaries, snapshot.settings)
  const hero = list.holidays[0] ?? null
  const rest = list.holidays.slice(1)

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
          <h1 className="topbar__title">倒计时</h1>
        </div>
        <div className="topbar__actions">
          <button
            type="button"
            className="iconbutton iconbutton--solid"
            aria-label="加一个纪念日"
            title="加一个纪念日"
            onClick={() => setForm(form === null ? { mode: 'add' } : null)}
          >
            +
          </button>
        </div>
      </header>

      <div className="page__body">
        {form !== null && (
          <AnniversaryForm state={state} form={form} onClose={() => setForm(null)} />
        )}

        {snapshot.settings.countdownHolidays ? (
          hero === null ? (
            <div className="cal__note">
              {LATEST_KNOWN_YEAR + 1} 年的放假安排还没公布，这里只说到 {LATEST_KNOWN_YEAR} 年
              —— 国务院一般每年 10 月底发通知，公布了升一次版本就有
            </div>
          ) : (
            <section className="hero">
              <div className="hero__label">
                {hero.indexInRun === null ? '最近的假期' : '正在放假'}
              </div>
              <div className="hero__name">{hero.name}</div>
              <div className="hero__days">
                {hero.indexInRun === null ? (
                  <>
                    <span className="hero__num mono">{hero.daysUntil}</span>
                    <span className="hero__unit">天后</span>
                  </>
                ) : (
                  <>
                    <span className="hero__unit">今天是第</span>
                    <span className="hero__num mono">{hero.indexInRun}</span>
                    <span className="hero__unit">天</span>
                  </>
                )}
              </div>
              <div className="hero__sub">
                {holidaySpanLabel(hero)} · 共 {hero.span} 天
              </div>
            </section>
          )
        ) : (
          <div className="cal__note">节假日倒计时在设置里关掉了</div>
        )}

        {rest.length > 0 && (
          <>
            <div className="group__label">节假日</div>
            <ul>
              {rest.map((h) => (
                <li className="crow crow--static" key={`${h.name}-${h.from}`}>
                  <div className="crow__line">
                    <span className="crow__title">{h.name}</span>
                    <span className="crow__days mono">{daysLeftLabel(h.daysUntil)}</span>
                  </div>
                  <div className="crow__sub">
                    {holidaySpanLabel(h)} · 共 {h.span} 天
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="group__label">纪念日</div>
        {list.anniversaries.length === 0 ? (
          <div className="empty empty--tight">
            还没有纪念日
            <div className="empty__hint">点右上角的「+」记一个生日或纪念日，这里天天给你数</div>
          </div>
        ) : (
          <ul>
            {list.anniversaries.map(({ item, occurrence }) => {
              const years = yearsLabel(occurrence.years)
              return (
                <li className="crow" key={item.id}>
                  <button
                    type="button"
                    className="crow__hit"
                    onClick={() => setForm({ mode: 'edit', id: item.id })}
                    aria-label={`改一改${item.title}`}
                  >
                    <span className="crow__line">
                      <span className="crow__title">{item.title}</span>
                      <span
                        className="crow__days mono"
                        data-today={occurrence.daysLeft === 0 ? '1' : '0'}
                      >
                        {daysLeftLabel(occurrence.daysLeft)}
                      </span>
                    </span>
                    <span className="crow__sub">
                      {subLine(item, occurrence.lunarLabel, years, occurrence.sinceDays)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {list.hiddenAnniversaries > 0 && (
          <div className="cal__note">
            还有 {list.hiddenAnniversaries} 条更远的没显示
            <button
              type="button"
              className="linkbutton cal__note-link"
              onClick={() => state.go({ name: 'settings' })}
            >
              去设置里放宽
            </button>
          </div>
        )}

        <div className="cal__note">
          节假日按国务院办公厅的通知（已收录到 {LATEST_KNOWN_YEAR} 年）；纪念日只倒数，不弹通知
        </div>
      </div>
    </div>
  )
}

/** 「10月11日 · 第 5 周年 · 农历八月三十 · 已 1826 天」—— 只留必要的几段 */
function subLine(
  item: Anniversary,
  lunarLabel: string | null,
  years: string | null,
  sinceDays: number
): string {
  const parts: string[] = []
  parts.push(item.yearly ? shortDate(item.date) : fullDate(item.date))
  if (years !== null) parts.push(years)
  if (lunarLabel !== null) parts.push(lunarLabel)
  if (item.yearly && sinceDays > 0) parts.push(`已 ${sinceDays} 天`)
  return parts.join(' · ')
}

interface FormState {
  mode: 'add' | 'edit'
  id?: string
}

/**
 * 加 / 改一个纪念日。
 *
 * 日期控件选的是**公历**那天；勾了「按农历」之后就按那天对应的农历月日重复
 * （见 `shared/anniversary.ts`）。这样用户不必去填「八月十五」这种
 * 既没有控件、又挡不住填出「闰六月三十二」的东西，
 * 屏幕上会当场把农历写出来给他对。
 */
function AnniversaryForm({
  state,
  form,
  onClose
}: {
  state: AppState
  form: FormState
  onClose: () => void
}): JSX.Element {
  const snapshot = state.snapshot!
  const editing =
    form.mode === 'edit' ? (snapshot.anniversaries.find((a) => a.id === form.id) ?? null) : null

  const [title, setTitle] = useState(editing?.title ?? '')
  const [date, setDate] = useState(editing?.date ?? dayKey(state.now))
  const [yearly, setYearly] = useState(editing?.yearly ?? true)
  const [lunar, setLunar] = useState(editing?.lunar ?? false)
  const [confirming, setConfirming] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const ts = tsFromDayKey(date)
  const lunarOfDate = ts === null ? null : lunarOf(ts)
  const leapWarning = ts !== null && editing?.lunar === true && anniversaryInLeapMonth(editing)

  const submit = (): void => {
    if (title.trim() === '') {
      setProblem('名字不能是空的')
      return
    }
    if (ts === null) {
      setProblem('日期没填对')
      return
    }
    setProblem(null)
    const draft = { title, date, yearly, lunar: yearly && lunar }
    if (form.mode === 'add') {
      void state.run({ type: 'anniversary:add', draft })
      state.setFlash('已记下')
    } else if (form.id !== undefined) {
      void state.run({ type: 'anniversary:edit', id: form.id, draft })
      state.setFlash('已保存')
    }
    onClose()
  }

  return (
    <section className="annform">
      <div className="annform__head">
        <span className="annform__title">{form.mode === 'add' ? '加一个纪念日' : '改一改'}</span>
        <button type="button" className="linkbutton" onClick={onClose}>
          收起
        </button>
      </div>

      <div className="field">
        <span className="field__label">名字</span>
        <span className="field__control">
          <input
            autoFocus
            value={title}
            placeholder="结婚纪念日 / 妈妈生日"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
          />
        </span>
      </div>

      <div className="field">
        <span className="field__label">日期</span>
        <span className="field__control field__control--row">
          <DateField value={date} onChange={setDate} now={state.now} />
          {lunarOfDate !== null && <span className="unit">农历{lunarOfDate.label}</span>}
        </span>
      </div>

      <div className="field">
        <span className="field__label">重复</span>
        <span className="field__control">
          <label className="check">
            <input
              type="checkbox"
              checked={yearly}
              onChange={(e) => {
                setYearly(e.target.checked)
                if (!e.target.checked) setLunar(false)
              }}
            />
            每年都数
          </label>
        </span>
      </div>

      {yearly && (
        <div className="field">
          <span className="field__label">按哪个历</span>
          <span className="field__control">
            <label className="check">
              <input
                type="checkbox"
                checked={lunar}
                onChange={(e) => setLunar(e.target.checked)}
              />
              按农历月日重复（农历生日）
            </label>
          </span>
        </div>
      )}

      <div className="field__hint">
        {!yearly
          ? '只数这一天，过完就不再出现'
          : lunar && lunarOfDate !== null
            ? `每年到农历${lunarOfDate.label}那天倒数。没有闰月的年份按正${lunarOfDate.monthName}过`
            : '每年到这一天倒数'}
        {leapWarning && '（这条记在闰月里，平年按同月同日过）'}
      </div>

      {problem !== null && <div className="field__hint field__hint--warn">{problem}</div>}

      <div className="annform__foot">
        <button type="button" className="topbar__button topbar__button--primary" onClick={submit}>
          {form.mode === 'add' ? '记下' : '保存'}
        </button>
        {form.mode === 'edit' && form.id !== undefined && (
          <button
            type="button"
            className="bottombar__danger"
            onClick={() => {
              // 两步确认：纪念日没有软删除也没有撤销窗口（见 Store.removeAnniversary），
              // 点一下就没了的按钮不该长得跟「保存」一样轻
              if (!confirming) {
                setConfirming(true)
                return
              }
              void state.run({ type: 'anniversary:remove', id: form.id! })
              state.setFlash('已删掉')
              onClose()
            }}
          >
            {confirming ? '再点一下确认删掉' : '删掉这条'}
          </button>
        )}
      </div>
    </section>
  )
}
