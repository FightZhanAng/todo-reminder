# 手动验收清单（第一期）

跑之前把数据文件删掉，从干净状态开始：
`%APPDATA%/todo-reminder/todo-reminder.json`

造测试数据的方法：直接编辑该 JSON，往 `tasks` 数组里塞一条，然后重启应用。
一条截止型任务的最小结构：

```json
{
  "kind": "deadline",
  "id": "manual-1",
  "title": "验收测试",
  "important": false,
  "createdAt": <今天早上 8 点的时间戳>,
  "updatedAt": <同左>,
  "deletedAt": null,
  "firedFor": null,
  "pushedFor": null,
  "dueAt": <距今 1 分钟后的时间戳>,
  "allDay": false,
  "leadMin": 15,
  "snoozeUntil": null,
  "completedAt": null
}
```

注意 `leadMin: 15` 意味着提醒点比 `dueAt` 早 15 分钟 —— 想让提醒在 1 分钟后
触发，`dueAt` 要设成 16 分钟后。

## 怎么启动（2026-09-18 实测补充）

**必须用 PowerShell / CMD 启动，不能从 Git Bash 启动。**

本机 `ELECTRON_RUN_AS_NODE=1` 被预设，且 Git Bash 下启动 Electron **浏览器模式会在
`app.ready` 之前静默退出**（1 秒、退出码 0、用户代码一行都没跑、无任何日志）。
PowerShell 里 `Remove-Item Env:ELECTRON_RUN_AS_NODE` 后直接调 exe 才能跑起来。

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Set-Location 'D:\WorkBuddy\我的工作台\todo-reminder'
& '.\node_modules\electron\dist\electron.exe' .
```

## 不想看屏幕也能验的两条探针

1. **通知有没有被 Windows 收下**（唯一不需要眼睛的信号）：
   `HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\<AUMID>\LastNotificationAddedTime`
   每次投递成功都会更新。
2. **通知真的发出去之后状态有没有回填**：数据文件里对应任务的 `firedFor` 应等于它的提醒点。
   这一条同时证明「非静默路径不自标、由调用方回填」的接线是对的 —— 回填漏了的话
   每 `TICK_MS`（10 秒）会重复弹同一批。

## 验收表

| # | 步骤 | 期望 | 结果 |
|---|---|---|---|
| 1 | 启动应用 | 托盘出现方框图标，框里有横线 | ⏳ 待人工 |
| 2 | 悬浮托盘图标 | tooltip 显示「待办提醒 · 今天 N 件」 | ⏳ 待人工 |
| 3 | 右键托盘 → 暂停提醒 → 30 分钟 | 菜单项变成可点的「恢复提醒」 | ⏳ 待人工 |
| 4 | 点「恢复提醒」 | 变回不可点的「提醒运行中」 | ⏳ 待人工 |
| 5 | 造一个 1 分钟后提醒的任务，重启应用 | 到点弹出系统通知 | ✅ OS 层已确认投递（`LastNotificationAddedTime` 更新）；屏幕可见性待人工 |
| 6 | 点通知上的「推迟 10 分钟」 | 通知消失，10 分钟后再次弹出 | ✅ **通过（含重弹）**：`snoozeUntil` = 点击时刻 + 10 分钟，`firedFor` 清空；到点后 `firedFor` 精确回填成该 snooze 时刻、系统投递探针再次更新 → 确实重弹了一次且只一次 |
| 7 | 点通知上的「推到明天」 | 今天不再弹，任务落到明天 | ✅ 通过：`dueAt` 09-18 09:58:35 → 09-19 09:58:00（明天同一时分，秒按 `sameClockTomorrow` 的设计截到整分），`firedFor` 清空 → 当天不会再弹 |
| 8 | 点通知上的「完成」 | 任务从今日看板消失，托盘件数 -1 | ✅ 通过：`completedAt` = 点击时刻 10:01:02，`firedFor` 保留 → 不再可提醒 |
| 9 | 造一条昨天该提醒的截止任务，重启应用 | 弹出**一条**「有 1 件事错过了」，不是多条 | ✅ 已确认：fresh / missed 分流正确，两条都只投递一次 |
| 10 | 全部完成，看托盘图标 | 图标变成勾 | ⏳ 待人工 |
| 11 | 手动把数据文件改成 `{` 再启动 | 不崩，生成 `todo-reminder.json.corrupt-*` 备份 | ✅ 通过：不崩、备份内容与坏文件逐字一致、`todo-reminder.json` 被移走 |
| 12 | 启动第二个实例 | 唤起已有窗口，托盘不出现第二个图标 | ✅ 部分：第二实例 50 ms 退出、进程数不增（不产生第二个托盘）；「唤起已有窗口」待人工 |

### 2026-09-18 自动化验收跑出来的额外结论

- 幂等成立：连续 35 秒（跨 3 个 tick）`LastNotificationAddedTime` 未再变化 → 不会重复弹。
- `aumid.ts` 的 `ensureAumidRegistered` 真的执行了：`HKCU\...\AppUserModelId\...dev` 的
  `DisplayName` 被从 spike 时期的 `todo-reminder (dev)` 覆盖成 `APP_NAME` 的值 `todo-reminder`。
- `CustomActivator` 指向 Electron 自注册的 `{4DAFC2DC-A582-4861-B981-53DDD584BE30}`，
  与 spike 结论一致。
- 已知小瑕疵（非阻塞）：主进程 `console.error` 输出中文到重定向文件时会乱码 ——
  控制台代码页问题，不影响功能。

### 第 6/7/8 项的实际点击情况（2026-09-18 10:01）

三条通知是同时弹出的，点击时**没有按标题一一对应**，三种动作各自落到了另一条任务上：

| 通知标题 | 实际点到的动作 | 落到的任务 |
|---|---|---|
| 点「推到明天」这条 | 完成 | `btn-tomorrow` |
| 点「推迟 10 分钟」这条 | 推迟 10 分钟 | `btn-snooze` |
| 点「完成」这条 | 推到明天 | `btn-complete` |

**这不影响结论**：三种动作各自都产生了一次可核对的状态变化，且都符合预期语义，
所以「动作 → 字段变更」的映射三个分支全部验证通过。

「按钮文字 ↔ action 的对应关系」本来也不需要靠这次点击来证 —— 它由构造保证：

- `notifier.ts` 用 `ACTION_ORDER.map(a => ({ text: actionLabel(a, snoozeMinutes) }))`
  生成 `actions` 数组，**按钮文案与数组下标同源**，不可能错位；
- `ACTION_ORDER = ['complete', 'snooze', 'tomorrow']`，文案依次是
  「完成 / 推迟 N 分钟 / 推到明天」；
- spike 阶段实测过：点按钮「完成」回传 `ACTION_INDEX=0`（见 `docs/superpowers/notes/toast-spike.md`），
  即 index 0 与数组首项一致。

仍未实测的只剩「index 1 / 2 的物理位置顺序」—— 但既然 0 是对的、`actions` 又是按数组顺序下发的，
没有理由单独错位。要继续钉的话只需再跑一轮：只弹一条通知，指定点最右边那个按钮，
看落地的 `snoozeUntil` / `dueAt` 是哪一个。

**10:07 第二轮已把这一点钉死。** 三条通知的标题直接写了「请点最左／中间／最右那个」，
tomcato 按标题点完之后：

| 通知标题 | 点的位置 | 落地结果 | 判定 |
|---|---|---|---|
| ① 请点最左边那个「完成」 | 最左 | `completedAt` = 10:09:11 | ✅ 最左 = `complete` |
| ② 请点中间那个「推迟 10 分钟」 | 中间 | `snoozeUntil` = 10:09:06 + 10min = 10:19:06、`firedFor` 清空 | ✅ 中间 = `snooze` |
| ③ 请点最右边那个「推到明天」 | 最右 | `dueAt` 10-18 10:07:57 → 10-19 10:07:00、`firedFor` 清空 | ✅ 最右 = `tomorrow` |

→ 按钮左右顺序与 `ACTION_ORDER` 下标完全一致，spike 阶段遗留的最后一个不确定项已消除。

### ⚠️ 验收过程中发现一个未修的缺陷：周期任务的「推迟」是坏的

用 `.tmp-test/` 里的一次性探针实跑（`remindAtOf` / `actionPatch` / `dueNow` 直调）：

```
=== 周期任务（每天 09:00 站会，now = 09:05）===
当前 remindAtOf          : <2026-09-18 09:00:00>
点「推迟 10 分钟」的 patch: {"snoozeUntil":<09:15:00>,"firedFor":null}
推迟后 remindAtOf        : <2026-09-18 09:00:00>     ← 没变成 09:15
推迟后 dueNow(−0 分钟) 命中数: 1                      ← 下一个 tick 立刻又弹
推迟后 dueNow(+10 分钟) 命中数: 1

=== 对照：截止型任务 ===
点「推迟 10 分钟」的 patch: {"snoozeUntil":<09:15:00>,"firedFor":null}
推迟后 remindAtOf        : <2026-09-18 09:15:00>     ← 正确
推迟后 dueNow(−0 分钟) 命中数: 0
推迟后 dueNow(+10 分钟) 命中数: 1
```

**根因**：`remindAtOf` 只在 `deadline` 分支读 `snoozeUntil`，`recurringRemindAt` 完全不看它；
而 `actionPatch('snooze')` 无差别地对两类任务都写 `snoozeUntil` + 清 `firedFor`。
周期任务因此失去幂等保护 → 下一个 tick（10 秒内）原地重弹，且永远不会真的推迟。

**为什么第一期没人踩到**：第一期没有创建任务的界面，周期任务只能手改 JSON 造出来，
所以这个分支从来没被点过。**第二期一有界面就会暴露。**

规格 §5 的 `remindAtOf` 取值表里也**只有 `deadline + snoozeUntil` 一行**，没有定义
「周期任务 + 推迟」的语义 —— 属于规格缺口，需要先补语义再改代码。
