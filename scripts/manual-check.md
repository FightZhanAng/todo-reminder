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
| 6 | 点通知上的「推迟 10 分钟」 | 通知消失，10 分钟后再次弹出 | ⏳ 待人工点击（点完可验 `snoozeUntil` +10 分钟、`firedFor` 清空） |
| 7 | 点通知上的「推到明天」 | 今天不再弹，任务落到明天 | ⏳ 待人工点击（点完可验 `dueAt` 挪到明天同一时刻） |
| 8 | 点通知上的「完成」 | 任务从今日看板消失，托盘件数 -1 | ⏳ 待人工点击（点完可验 `completedAt` 非空） |
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
