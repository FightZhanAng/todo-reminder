# todo-reminder 代码审查报告

**日期**：2026-10-14　**范围**：`src/main`、`src/renderer`、`src/shared`、`scripts/`
**基线**：`pnpm typecheck` 通过；`pnpm test:core` 885/885 通过
**方式**：全量通读 + 对可疑点写临时探针实际运行（探针已删除）。标【实测】的是跑出来的结论，标【读码】的是由代码推演得出。

结论按「会不会导致错误行为」排序：**5 条确定缺陷**，5 条建议项，4 条待确认。
整体判断：这是一份质量明显高于平均水准的代码，纯函数边界（`recurrence.ts` / `anniversary.ts` / `group.ts` / `agenda.ts`）、存储深校验与写盘策略、更新状态机都经得起推敲。确定缺陷不在主干设计上，而是**某一处取数来源不一致**或**某一条分支没跟主判断对齐**。

---

## 一、确定缺陷

### 1. 周期任务「推迟」跨过午夜后，次日那一整天的实例被静默吞掉

**证据**：[src/shared/remind.ts:57](src/shared/remind.ts#L57)
`if (task.snoozeUntil !== null && task.snoozeUntil > today) return task.snoozeUntil`

**触发条件**（实测）：
1. 一条每天 09:00 提醒的周期任务；
2. 前一天 23:55 点通知上的「推迟 10 分钟」→ `snoozeUntil` = 次日 00:05；
3. 次日 00:05 正常弹一次，`firedFor` 回填成 00:05；
4. 次日 09:00 —— `remindAtOf` 返回的仍是 `snoozeUntil`（00:05 > 次日零点），它 `≤ now` 且 `=== firedFor` 被幂等挡板挡掉，规则算出的 09:00 根本没机会被返回 → **不弹**。

实测输出：

```
推迟后 snoozeUntil = 2026/10/15 00:05:00
次日 00:05 触发 1 条（期望 1）
次日 09:00 触发 0 条（期望 1）   ← 该响的那次没响
次日 09:00 firedFor = 2026/10/15 00:05:00 / 常规提醒点 = 2026/10/15 09:00:00
次日 09:00 看板「每天」段 1 条   ← 界面上它还在，只是不提醒
```

**影响**：用户设的每日提醒在跨午夜推迟之后彻底失效，而且**永久持续**（`firedFor` 不再变化、`snoozeUntil` 也不再被清）。看板照常显示这条任务，用户不会发现是提醒坏了。日常场景：晚上 23:5x 收到提醒、顺手点推迟。

**为什么现有测试没挡住**：[scripts/core-test.ts:847-862](scripts/core-test.ts#L847-L862) 把这个现象记为「已知取舍」，理由是人在这天已经在 00:05 被提醒过。但那条用例的 `remindTime` 恰好是 **23:55** —— 那种设定下被并入的确实是当天稍后的那个实例，取舍成立；`remindTime = 09:00` 时被吞掉的是**当天唯一的一次**，与「已经提醒过」无关。这不是同一个取舍，是它没覆盖的分支。

**修复建议**：让判据只吸收「今天本该有、但已经过去」的那个提醒点，即推迟点必须落在**今天之内**；跨午夜的推迟点次日即失效、规则恢复。

---

### 2. 倒计时首屏会谎报「明年的放假安排还没公布」

**证据**：[src/shared/countdown.ts:40](src/shared/countdown.ts#L40)（节假日被 `horizon` 过滤）+ [src/renderer/components/CountdownView.tsx:74-79](src/renderer/components/CountdownView.tsx#L74-L79)（`hero === null` 即输出「{LATEST_KNOWN_YEAR + 1} 年的放假安排还没公布」）

**触发条件**（读码 + 数据核对）：设置页倒计时「只看」选**一个月**（`countdownHorizonDays = 30`，[SettingsPanel.tsx:24-29](src/renderer/components/SettingsPanel.tsx#L24-L29)），而**已收录那年**的下一个假期在 30 天以外。最小例子：2026-01-05 打开倒计时 —— 春节 2026-02-15 在 41 天后，被 `filter` 掉，`list.holidays` 为空 → 界面显示「2027 年的放假安排还没公布，这里只说到 2026 年」。

> 更正：最初怀疑「2027 年数据在表里却被说成没公布」——核对 [holiday.ts:51-112](src/shared/holiday.ts#L51-L112) 后确认**表里只收到 2026 年**，没有 2027。所以真正的错误不是「藏了新数据」，而是**把「被『只看 N 天』挡住」说成了「还没公布」**，且年份还算成了 `LATEST_KNOWN_YEAR + 1`。

**影响**：界面在说假话 —— 用户被告知去等一份不存在的通知（2027 年的通知要 2026 年 10 月底才发），而实际上 2026 年剩下的假期就在那儿，只是被显示范围挡住了。默认档位是 365 天（[defaults.ts:48](src/shared/defaults.ts#L48)），所以只在选 30 / 90 天时显形。

**修法线索**：[CalendarView.tsx:77-80](src/renderer/components/CalendarView.tsx#L77-L80) 调用时把 horizon 硬传 `0`（注释写明是为了不被挡住），说明作者清楚这个过滤会误伤 —— 只是倒计时页那条路径没做同样处理。

**修复建议**：让「空」这件事带上成因，别在视图层猜。给 `Countdowns` 加「被挡掉的段数 / 最近那段还有多少天」，视图分三种说法：正常显示 / 「最近的假期在 N 天以后，去设置里放宽」/ 都没有才说「还没公布」。

---

### 3. 纪念日表单的「闰月」提示取错状态源，该出现的场景恰恰不出现

**证据**：[src/renderer/components/CountdownView.tsx:239](src/renderer/components/CountdownView.tsx#L239)
`const leapWarning = ts !== null && editing?.lunar === true && anniversaryInLeapMonth(editing)`
读的是 **`editing`（数据库里那条）**，而不是 **`lunar`（用户此刻的勾选）**。

**触发条件与影响**：

| 场景 | 期望 | 实际 |
|---|---|---|
| 编辑一条 `lunar: true`、落在闰月的旧纪念日，用户把「按农历」**取消勾选** | 不该再提闰月 | `editing.lunar` 仍是 `true`，提示照旧显示，且与 [CountdownView.tsx:330](src/renderer/components/CountdownView.tsx#L330) 按 `lunar` 分支的文案自相矛盾 |
| **新建**一条，日期选在闰月里、勾上「按农历」 | 该提示「平年按同月同日过」 | `editing === null` → 条件恒 false，**永不显示** |

闰月生日是这条功能最容易出错的地方（[anniversary.ts:51-57](src/shared/anniversary.ts#L51-L57) 专门写了「闰六月十五平年就过六月十五」），而唯一解释这条规则的界面文字在最需要它的「新建」路径上是死的。顺带：另一处文案 `没有闰月的年份按正${lunarOfDate.monthName}过` 在闰月里会拼出「按正闰六月过」（`monthName` 带「闰」字，见 [lunar.ts:170](src/shared/lunar.ts#L170)）。

**修复建议**：状态源换成表单当前值 —— 用已经算出来的 `lunarOfDate.isLeap`，并把那句「按正X过」在闰月时改成「平年按同月同日过」。

---

### 4. 编辑器的默认「星期 / 几号」用真实时钟，与注入的 `now` 分叉

**证据**：[src/renderer/components/TaskEditor.tsx:411-427](src/renderer/components/TaskEditor.tsx#L411-L427)

```ts
const today = dueDay ?? dayKey(Date.now())          // ← 能被注入时钟替换
const todayDow = new Date().getDay() as Weekday     // ← 取真实时钟
weekdays: [todayDow],
monthDays: [new Date().getDate()],
```

**触发条件**：同一段代码用了两个时钟源。`Date.now` 在冒烟夹具里被替换成虚拟时钟（[smoke.cjs:326](scripts/smoke.cjs#L326) `Date.now = () => real() + offset`），而 `new Date()` 不接受这个补丁 —— 于是「默认星期 / 默认几号」永远按**真实日期**算。

**影响**：
1. **测试有效性**：冒烟里「新建周期任务的默认值」验的是真实日期推出来的值，而不是虚拟时钟的值 —— 它没在验它以为在验的东西；
2. **跨零点**：23:59:59 打开编辑器、00:00:01 提交时，表单沿用的是**前一天**的星期/几号，用户不留意就会得到一条相位错一天的规则（[recurrence.ts:29](src/shared/recurrence.ts#L29) 的 `% every` 直接吃这个相位）。
   同一文件里 `DateField`（[:157](src/renderer/components/TaskEditor.tsx#L157)）也没传 `now`，而 [CountdownView.tsx:289](src/renderer/components/CountdownView.tsx#L289) 传了 —— 同一个控件两种用法。

**修复建议**：把 `state.now` 传进 `initialForm`（在 `useState` 初值处取一次），并给 `DateField` 补上 `now={state.now}`。

---

### 5. 编辑一条「已经弹过」的任务，会在下一次 tick（≤10 秒）立刻重弹

**证据**：[commands.ts:400-409](src/shared/commands.ts#L400-L409)（`carryCompletion` 刻意不回填 `firedFor`）+ [commands.ts:148](src/shared/commands.ts#L148)（`buildTask` 把它重置为 `null`）+ [remind.ts:75](src/shared/remind.ts#L75)（`at <= createdAt` 这道挡板只管新建）

**触发条件**（实测）：
1. `now = 10:00` 截止、`leadMin = 15` 的截止型任务 → 提醒点 09:45；
2. 09:45 通知已弹，`firedFor = 09:45`；
3. 09:46 打开编辑器，**只把标题改一个错别字**，保存 → `buildTask` 重建时 `firedFor: null`，而 `createdAt` 被保留（所以 `at > createdAt` 成立）；
4. 下一次 tick（≤10 秒）同一条通知再弹一次，带三颗动作按钮。

```
原任务已弹，再扫 0 条（期望 0）
只改标题后立刻扫 1 条（1 = 会重弹）
```

**影响**：用户刚看完通知、进来改个错别字，10 秒内同一个通知又弹一遍 —— 看起来就是「这应用通知有 bug」。周期任务同形：09:00 弹过、09:30 改标题 → 编辑当天再弹一次。

**为什么这不是「设计如此」**：代码里三处都在防这件事 —— [commands.ts:272-276](src/shared/commands.ts#L272-L276)（点错勾不该被通知追着打）、[commands.ts:309-312](src/shared/commands.ts#L309-L312)（撤销删除要重新具备提醒资格，所以专门清 `firedFor`）、[remind.ts:75](src/shared/remind.ts#L75)（新建即到期不打脸）。`task:edit` 是唯一绕过这道防线的路径。`carryCompletion` 注释给的理由是「提醒时刻**可能**改过」—— 这在提醒点真的变了时成立，但它现在是无条件的。

**修复建议**：把「清 `firedFor`」收缩到「提醒点真的变了」这一个条件上：在 `carryCompletion` 之后比对新旧提醒点，没变就把 `firedFor` 带过去。

---

## 二、建议项

| # | 问题 | 要点 | 处置 |
|---|---|---|---|
| 6 | [store.ts:92-103](src/main/store.ts#L92-L103)：`tasks` / `anniversaries` 不是数组时静默全丢，`droppedCount` 算成 0 | 内存里变成 0 条，顶部提示条与设置页警告都不出现，下一次写盘就把文件重写成「没有任务」的那一份 | ✅ 已修（§5.2），并顺带发现提示条说不出口的那条链也是断的（§5.2 的 6b） |
| 7 | [store.ts:377-381](src/main/store.ts#L377-L381)：`isIntArrayInRange` 放行空数组 | `monthly days: []` 会静默永不命中（编辑器拦得住，手工编辑或旧数据拦不住） | ✅ 已修（§5.2） |
| 8 | [TaskEditor.tsx:492-501](src/renderer/components/TaskEditor.tsx#L492-L501)：`ruleOf` 把 `skipWeekend` 硬编码为 `false` | 已有的 `daily + skipWeekend: true` 会被静默改写；另 [:297](src/renderer/components/TaskEditor.tsx#L297) 的 label 说「移到下一个工作日」而实现是整次跳过，文案与实现不一致 | ✅ 已修（§5.2）：把那一格对三种频率都摆出来，值照原样带上，文案改成与实现一致 |
| 9 | [term.ts:126-135](src/shared/term.ts#L126-L135)、[lunar.ts:191](src/shared/lunar.ts#L191)：日历 42 格 × 24 节气 × 12 轮迭代，`now` 每分钟变导致重算 | 纯性能。给 `solarTermsOf(year)` 加按年 Map 缓存（照抄 [holiday.ts:146](src/shared/holiday.ts#L146) 的 `markMap`），`solarFromLunar` 用年天数前缀和 | ⚠️ 缓存加了，但**「数量级偏大」这个判断被实测否掉了**：一屏是 2.7 ms 而不是几十毫秒。详见 §5.2 的更正 |
| 10 | [QuickAdd.tsx:125-130](src/renderer/components/QuickAdd.tsx#L125-L130)：默认时刻是「下一个半点」且不处理跨日 | 23:45 按快捷键 → 默认 `00:15`，选「今天这个点」后 `at <= createdAt` 被拦，**不提醒**，但看板显示成「今天 15 分钟后到期」 | ✅ 已修（§5.2）：跨午夜退回 `23:59` |

**小改进**：`daysInMonth` 对非法月份不设防（[time.ts:45-47](src/shared/time.ts#L45-L47)，实测 `daysInMonth(2026, 13) === 31`）→ ✅ 已修；渲染层没有 ErrorBoundary，而「render 抛错 → 白屏且无恢复入口」正是 `AGENTS.md` 的头号风险 → ❌ 没做（要新增组件与顶层接线，属设计改动）；同一张通知连点两次只高亮一次（需要 nonce 作依赖）→ ❌ 没做（要跨进程传一个 nonce）；`notifier.ts:75-76` 的去重键用 `raw.arguments`，将来纪念日若加动作按钮需改成 `arguments + actionIndex` → ❌ 没做（今天无害）。三条没做的理由见 §5.3。

---

## 三、待确认 / 推测（证据不足，未计入缺陷）

1. **通知点击链路**：`parseActivation` 与 `buildToastXml` 的参数格式已对照核过没问题，但 `Notification.handleActivation` 实际回传值与 `CustomActivator` GUID 是否对齐（[index.ts:108-119](src/main/index.ts#L108-L119)）只能在无头环境之外实机点一次确认。
2. **第 9 条的实际耗时占比**已实测（见 §5.2）：一屏 2.7 ms —— 原判断「数量级偏大」不成立。
3. [update.ts:183](src/shared/update.ts#L183) 的 mac 分支一律返回 `mac-unsigned`，前提（CI 打出的 mac 包一律 ad-hoc 签名）未核对 CI 配置。
4. `anniversaryOccurrence` 在 2100 年附近返回 `null`、界面表现为纪念日消失 —— 取舍合理，但从哪一年开始失效未验。

---

## 四、核过但不是缺陷（免得被误报）

| 怀疑 | 结论 |
|---|---|
| 日历把「今天已打卡的习惯」铺到明天/下周 | 正确，与「今天那一格例外、将来照常展开」一致 |
| 周期任务「推到明天」后次日还响不响 | 正确 |
| 纪念日提醒的按天幂等 | 正确（同日改时刻不重弹、明年同日正常弹） |
| 全天型截止任务的按刻幂等 | 正确 |
| 农历纪念日落在闰月时会不会算错 | 正确（闰六月十二的下一跳是平年六月十二） |
| 时区 / 夏令时 | 确认无问题：全用本地 `Date` 做天数运算，不用 `+86400000`；节气按 UTC+8 定点 |
| `mergeExiting` 引用稳定性、`useNow` 三档粒度与整分对齐 | 正确 |
| `parseActivation` 的 tag 前缀 | 正确（`missed:` / `anniversary:` 都在前置返回里挡住，不会被误当成「完成」） |

---

## 五、修复记录（同日分两批实施）

### 5.1 确定缺陷（第一批，5 条）

| # | 结论 | 改了什么 | 落在哪 |
|---|---|---|---|
| 1 | 跨午夜推迟吞掉次日实例 | `recurringRemindAt` 的判据拆成两条：①「还没走完」（`snooze >= today && (snooze > now \|\| firedFor !== snooze)`）；②「已经弹过、且它顶掉的就是今天这个常规点」（`regular < snooze`）。跨午夜的推迟点落在次日时只走①，弹过之后规则当场恢复；早于今天的推迟点两条都不命中，照旧自然失效 | [remind.ts:59](src/shared/remind.ts#L59) |
| 2 | 倒计时谎报「还没公布」 | `Countdowns` 增加 `hiddenHolidays` / `hiddenHolidayDays`（先取全量再分两堆），视图分三态：正常 hero /「最近的假期要 N 天后，被『只看 N 天以内』挡住了」+ 去设置里放宽 / 真没公布 | [countdown.ts:42](src/shared/countdown.ts#L42)、[CountdownView.tsx:76](src/renderer/components/CountdownView.tsx#L76) |
| 3 | 闰月提示取错状态源 | 抽成纯函数 `anniversaryRepeatHint(yearly, lunar, lunarOfDate)` —— 签名里没有那条纪念日，「新建时取不到 `editing`」这个形状从根上没有了；无差别的「按正X过」也收进「仅在闰月里说」（原来会拼出「按正闰六月过」「按正正月过」） | [anniversary.ts:154](src/shared/anniversary.ts#L154)、[CountdownView.tsx:346](src/renderer/components/CountdownView.tsx#L346) |
| 4 | 编辑器混用两个时钟源 | `initialForm` 增加 `now` 形参（传 `state.now`），`new Date()` → `new Date(now)`；顺带给编辑器里的 `DateField` 补上 `now={state.now}`（同一个控件在倒计时页早就传了） | [TaskEditor.tsx:55](src/renderer/components/TaskEditor.tsx#L55)、[:411](src/renderer/components/TaskEditor.tsx#L411) |
| 5 | 编辑已弹过的任务会重弹 | 新增 `carryFired`：编辑前后提醒点相同就保留 `firedFor`（含两边都算成 null 的情形），跨类型编辑或提醒点真的变了才清 | [commands.ts:430](src/shared/commands.ts#L430) |

**这一批跑完时的状态**：`pnpm test:core` 885 → 906（新增 21 条）、`pnpm smoke` 206/206、`pnpm typecheck` 通过。最终数字见 §5.4。

这 21 条里有 **6 条在修复前的代码上会 FAIL** —— 不是推断：把 `remind.ts` 与 `commands.ts` 临时换回 HEAD 版本、用同一份测试跑了一遍，失败的**恰好**是下面这 6 条（900/906），随后按文件哈希校验还原（其余断言用的是新加的字段与函数，旧代码里根本不存在）：

| 断言 | 修复前 | 修复后 |
|---|---|---|
| `跨午夜推迟：当天回到规则（23:55）` | 返回 00:05 | 返回 23:55 |
| `跨午夜推迟：当晚 23:55 正常弹` | 0 条 | 1 条 |
| `跨午夜推迟（每日 09:00）：次日 09:00 照常弹` | 0 条 | 1 条 |
| `同类型 edit：提醒点没变时 firedFor 保留` | null | 2026-09-16 09:00 |
| `只改标题：firedFor 保留` | null | 2026-09-16 16:45 |
| `只改标题：不会重弹（修复前这里会是 1）` | 1 条 | 0 条 |

前三行钉缺陷 1，后三行钉缺陷 5。缺陷 2、3 的判别性只能体现为「2026-01-05 + 只看 30 天」那一组正对应报告里那条误报 —— 旧代码里没有 `hiddenHolidays` / `anniversaryRepeatHint` 这两个名字，换回旧代码会直接编译不过。

### 5.2 建议项与小改进（第二批）

| # | 改了什么 | 落在哪 |
|---|---|---|
| 6 | 字段「本该是数组、结果不是」时不再当成「本来就没有」：计入 `dropped`（按一条记）。于是顶部提示条与设置页的警告会出现，`copyAside` 也留了一份原文 —— 不然这次加载看起来一切正常（0 条任务、0 条跳过），下一次写盘就把文件重写成「没有任务」的那一份 | [store.ts:92](src/main/store.ts#L92) |
| 7 | `normalizeRule` 要求 `days` 非空（空数组同样让 `includes` 永远为 false、规则静默永不命中） | [store.ts:395](src/main/store.ts#L395) |
| 8 | 「周末」那一格对三种频率都摆出来；`ruleOf` 对 daily 不再写死 `false`；文案「跳过后移到下一个工作日」改成「跳过周末，不补到工作日」—— `matchesDay` 的实现是整次跳过（`return false`），文案说成顺延的话，用户会按一个不会发生的日期去安排事 | [TaskEditor.tsx:291](src/renderer/components/TaskEditor.tsx#L291)、[:508](src/renderer/components/TaskEditor.tsx#L508) |
| 9 | `solarTermsOf(year)` 按年缓存；农历年天数摊成前缀和，`lunarOf` 改成在前缀和上二分、`solarFromLunar` 直接查表 | [term.ts:123](src/shared/term.ts#L123)、[lunar.ts:151](src/shared/lunar.ts#L151) |
| 10 | 默认时刻跨午夜时退回 `23:59`（`nextHalfHourClock` 放进 `shared/time.ts`，快速添加窗改用它，顺带把这个小窗的时钟也收到一处） | [time.ts:59](src/shared/time.ts#L59)、[QuickAdd.tsx:15](src/renderer/components/QuickAdd.tsx#L15) |
| 小改进 | `daysInMonth` 对越界月份给 0 —— 以前 `new Date(2026, 13, 0)` 自己滚到明年 1 月，于是「13 月有 31 天」 | [time.ts:45](src/shared/time.ts#L45) |

**6b：本轮新发现的一条缺陷（原报告里没有）** —— 第 6 条修好之后那个提示仍然说不出口，因为主进程那条判据的顺序是反的。

`store.ts` 的 `copyAside()` 在「有记录被跳过」与「读到更新的版本」这两条路上都会写 `corruptBackupPath`，而 [index.ts:204](src/main/index.ts#L204) 原来先看它 —— 于是另外两条分支**永远走不到**：一份好好的文件被告知「数据文件损坏，已备份到 …」，而真正该说的「N 条记录形状不合法，已跳过」从来没出现过。触发条件就是第 6/7 条那两种坏数据（或读到更新版本的文件）。改法是把判据换成各自的标记字段、那个路径只用来填「备份在哪」，并在 `corruptBackupPath` 为 null（复制失败）时也说得通（[index.ts:212](src/main/index.ts#L212)）。这与设置页那句警告（[SettingsPanel.tsx:487-507](src/renderer/components/SettingsPanel.tsx#L487-L507) 的 `backupWarning`，注释里正好写着「按路径猜会把『版本更新』说成『文件损坏』」）现在是同一套规矩 —— 同一个规矩写在两处、其中一处写反了，正是它一直没被发现的原因。

**第 9 条的更正**：原报告说这里「数量级偏大」，实测不成立 —— 我先把它报大了 20 倍（把 bench 的 20 遍当成了 1 遍）。用编译产物实测，每次都是一整屏 42 格：

| 调用 | 改前 | 改后 |
|---|---|---|
| `termOnDay` ×42（日历一屏） | 2.7 ms | 0.6 ms |
| `lunarCellLabel` ×42 | 1.0 ms | 0.2 ms |
| `lunarOf` ×42 | 1.1 ms | 0.4 ms |
| `solarFromLunar` ×42 | 0.9 ms | 0.35 ms |

也就是说日历一屏原本约 3.7 ms、每分钟重算一次 —— 不构成可见的卡顿。缓存仍然留下了：它与 `holiday.ts` 的 `markMap` 是同一个理由（同一张小表被一屏问 42 次），几行、语义不变、全表测试照过。但**按「只修会导致错误行为的东西」这条尺子，它不该算进上面那一批**，在这里标出来。

### 5.3 没做的三条

- **渲染层没有 ErrorBoundary**：要新增一个组件并接到 `App.tsx` 顶层，还得决定它长什么样（今天没有「出错」这个界面）—— 那是新功能，不是修缺陷，值得单开一件事。
- **同一张通知连点两次只高亮一次**：要跨进程传一个 nonce（`shared/ipc` → `preload` → `main/notifier` → `useAppState` → `Board`），为一条次要交互改五个文件不划算。
- **`notifier.ts` 的去重键**：今天无害（纪念日那颗按钮与正文等价），等真要给它加第二颗按钮时再改。

### 5.4 验证（两批跑完后的最终状态）

- `pnpm typecheck` 通过；
- `pnpm test:core` 885 → **920/920**（两批共新增 35 条）；
- `pnpm smoke` 206 → **208/208**（新增两条守「每天也摆着『周末』这一格」与它的文案）。

第二批的判别性断言：`tasks 不是数组：也要记进跳过计数（否则提示条不出现）`（改前是 `0`）、`每周规则 days 为空数组 → 拦下`（改前两条任务照常读进来）、`下一个半点不跨午夜：23:45 → 23:59`（改前是 `00:15`）、`每天也摆着「周末」这一格` 与 `它的文案说清了是跳过、不补到工作日`（改前找不到这一格，文案是「跳过后移到下一个工作日」）。

**两个过程坑（写下来给下次）**：

1. **`pnpm smoke` 读的是 `out/`**。改完渲染层不先 `pnpm build`，就是拿旧产物跑一遍 —— 我第一次跑的时候 `out/` 还是 10-08 的，那次「206/206 全绿」其实一个新改动都没验到。判据很简单：`out/renderer/index.html` 的时间戳要晚于你改过的文件。`AGENTS.md` 的验证表里没写这一步，值得补一句。
2. **冒烟脚本的语法错误会在 Electron 里弹一个「主进程 JS 错误」的模态对话框**，非交互环境下表现为整条命令永远不返回（不是失败，也没有任何输出）。判据是 `.tmp-smoke/report.json` 的 mtime 没往前走 —— 连 `mark('boot')` 都没跑到，说明脚本在**加载期**就炸了。`node --check scripts/smoke.cjs` 一秒就能排掉这一类。

**验证边界（如实说明）**：

- 缺陷 1、5 与第二批的 6/7/8/10 都有判别性断言；缺陷 4 的时钟一致性只在冒烟里被「默认选中今天」这类断言间接覆盖，没有专门的跨零点用例；
- 缺陷 3 的纯函数部分有五条断言，**视图里那一行**没有被断言（冒烟只证明表单还渲染得出来）；
- 缺陷 2 的数据层有六条断言，**「被挡住了」那段 JSX 分支**在冒烟里跑不到 —— 表里已经没有 2026 年之后的假期，今天这次运行走的是「还没公布」那一支（那条路有断言守着）。新分支复用的是「还有 N 条更远的没显示 + 去设置里放宽」同款结构；
- 6b 只能靠读码与真机启动一次确认：主进程启动那一段不在冒烟覆盖范围内；
- 时区/夏令时、农历、节假日那些「核过但不是缺陷」的结论**没有**再复核一遍，沿用审查时的判断。

