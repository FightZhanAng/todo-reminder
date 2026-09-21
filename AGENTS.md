# todo-reminder — 协作约定

## 禁止使用 superpowers 系技能（2026-09-18 tomcato 明确要求）

**本项目内不要调用以下技能，无论任务看起来多适合：**

- `brainstorming`
- `writing-plans` / `executing-plans`
- `subagent-driven-development`
- `test-driven-development`
- `systematic-debugging`
- `requesting-code-review` / `receiving-code-review`
- `planning-with-files-zh`

**也不要生成以下产物目录：**

- `docs/superpowers/`（specs / plans / notes）
- `.superpowers/`

原因：这套流程对中小型功能是净负担 —— 需求已经明确时它还要先产出 spec、拆 task、写 brief/report、跑 review diff，
文档体量远超代码本身（此前 74 个文件约 1.4MB），拖慢进度且大量消耗 token。

**替代做法：**

- 需求清楚 → 直接改 `src/`，一句话说明改了什么，跑一次验证。
- 需要拆步骤 → 用 TaskCreate/TaskUpdate 在会话里记录，不要落盘成文档。
- 需要澄清 → 直接问 tomcato，不要先写一份 spec 再问。
- 验证 → 四条命令，改完就跑：

  | 命令 | 覆盖什么 | 耗时 |
  |---|---|---|
  | `pnpm typecheck` | 主进程 + 渲染层两套配置 | ~5s |
  | `pnpm test:core` | 核心逻辑 496 项（时间/周期/提醒/命令层/store/调度器/**月历**/**图标像素与 ico 容器**/**已完成账本**） | ~4s |
  | `pnpm smoke` | 界面 105 项：看板/收件箱/**已完成账本**/编辑器/设置页/快速添加窗/日历浮层/时间浮层/**深浅主题**真开起来点一遍 | ~11s |
  | `pnpm icons` | 从代码重画 `resources/icon.ico`（加 `--preview` 另存各尺寸 PNG 用来看） | ~6s |

  `pnpm smoke` 必须在 **PowerShell** 里跑，且先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`；
  结果落在 `.tmp-smoke/report.json`（electron.exe 是 GUI 子系统程序，stdout 接不到控制台）。
  探针窗口的尺寸是照着 `main/index.ts` 抄的 420×640 **窗口**尺寸，别改成 Electron 的默认值 ——
  本应用是窄窗，布局问题恰恰都出在窄窗上。

## 视觉语言（2026-09-18 重做，改动前先读这段）

界面叫「今日账本」，两个入口都在这两个文件里：

- `src/renderer/tokens.css` — 色值、字体栈、`--radius`
- `src/renderer/styles.css` — 顶部有一段完整的视觉说明，含横向几何的算法

几条硬规矩，改样式时别破坏：

1. **只有两个色相。** 靛蓝（`--indigo`）= 结构 + 「快到了」；朱砂（`--cinnabar`）
   = 已经晚了（逾期 / 出错 / 通知已关 / 删除）。**不要再引入第三、第四个色相做状态区分** ——
   之前那档琥珀色（soon）已经撤掉，它和朱砂是同一个语义量级。
   「快到了」靠刻度的长度与加粗表达，不靠颜色。
2. **竖轴是签名，几何不能各改各的。** 刻度列在 x = 55px（游标 3 + 时刻列 52）。
   分段标签的 `padding-left: 72px` 与两个伪元素的 `left: 55px` 都是从它推出来的。
   **没有时刻的行也必须渲染空的 `.row__clock`**，否则那一段的轴会错位、一根轴断成两截。
   `scripts/smoke.cjs` 里「竖轴逐行对齐」那条断言就是守这个的。
3. **文字只用两级灰**（`--ink` / `--ink-muted`），两级都要满足 AA（≥4.5:1）。
   `--ink-faint` 只准给图标字形用（⋮ × ·），不准给文案用。
   层级靠字号、字重、字距和等宽体做，不靠把字调淡。
4. **实心墨色块整个界面只有两块**：顶栏的「+」和表单的提交钮。别再加第三个。
5. **宋体只用于大字号**（日期 30px、页面标题 18px、空状态 19px）。
   SimSun 在 16px 以下会露出点阵感，中文界面正文一律用 `--font-ui`。
6. **图标是代码画出来的，不要手改二进制。** 托盘图标在 `shared/trayIcon.ts`、
   应用图标在 `shared/appIcon.ts`，共用 `shared/raster.ts`（自己光栅化 + 自己编 PNG/ICO）。
   改完跑 `pnpm icons` 重新生成 `resources/icon.ico`。
   **绝不要用 SVG 喂 `nativeImage`** —— 它不报错、静默返回 0×0 空图，托盘里会什么都看不见。
7. **不用原生 `<input type="date">` / `type="time">`。** 它们的下拉是操作系统画的，
   跟不上主题。日期用 `DateField`、时刻用 `TimeField`（都基于 `Popover`）。
   算月历的逻辑在 `shared/calendar.ts`，**必须留在那里**（纯函数，有测试）。
8. **主题只有一条通路**：主进程设 `nativeTheme.themeSource` → 渲染层的
   `prefers-color-scheme` 跟着变（`main/theme.ts`）。别在渲染层再算一次「现在是深色吗」，
   要问就 `useDarkMode()`。切换按钮画的是**点下去会变成什么**，不是现在是什么。
9. **「已完成」是一本单独的账**，样式在 `DoneView.tsx`，算在 `shared/done.ts`（纯函数、有测试）。
   两条容易踩的：
   - 分组按**完成日**（`completedAt`）分，不是按截止日；同一天里完成时刻倒序。
   - 周期任务**没有历史**，只有 `lastDoneDay` + `streak`。所以它单独成段（「每天」），
     **不要**把它按 `lastDoneDay` 塞进按天分组里 —— 那会读成「那天做了一件」的流水，
     而它其实是「这条习惯最近一次是那天打的卡」，明天还会回来。
   已完成的行复用 `TaskRow`，只是多传 `settled`（勾选中 + 标题挂**静态**墨线）——
   静态墨线走 `StrikeLine still`，那一笔是**信息**不是动效，reduced-motion 下也照画。

## 项目结构

- `src/main/` — Electron 主进程（托盘、通知、调度、存储）
- `src/renderer/` — React 渲染层
- `src/shared/` — 主进程与渲染层共用逻辑（含纯函数式的图标光栅化、月历计算、已完成账本）
- `resources/icon.ico` — 由 `pnpm icons` 生成，**提交进仓库**（打包机不必先跑一遍 node）
- `scripts/core-test.ts` — 核心逻辑测试（唯一需要保留的测试入口）
- `scripts/smoke.cjs` — 界面冒烟（真开 Electron 点一遍）
- `scripts/make-icons.ts` — 重画应用图标

## 文件卫生

测试/调试产生的一次性文件（probe、日志、构建副本）不要留在仓库里；
`.tmp-test/`、`.tmp-smoke/`、`.tmp-icons/`、`*.log` 已在 `.gitignore` 中，
但仍应及时清掉，不要攒着。
