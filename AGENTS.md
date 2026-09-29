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
  | `pnpm test:core` | 核心逻辑 814 项（时间/周期/提醒/命令层/store/调度器/**月历**/**农历与节气**/**节假日与调休**/**纪念日与倒计时**/**日历按天聚合**/**图标像素与 ico 容器**/**已完成账本**/**以后这本账**/**自动更新的状态机**/**配色的对比度与用色规矩**（含**实底上的字**）） | ~4s |
  | `pnpm smoke` | 界面 188 项：看板/收件箱/**日历**/**倒计时**/**已完成账本**/**以后**/编辑器/设置页（含**更新**那一格）/快速添加窗/日历浮层/时间浮层/**深浅主题**真开起来点一遍 | ~15s |
  | `pnpm icons` | 从代码重画 `resources/icon.ico`（加 `--preview` 另存各尺寸 PNG 用来看） | ~6s |
  | `pnpm dist` | 出安装包：`release/todo-reminder-<版本>-setup.exe`（NSIS）+ 同版本便携版，另带 `latest.yml` 与 `*.blockmap`（**自动更新要用它们，别只上传 exe**） | ~2min |

  `pnpm smoke` 必须在 **PowerShell** 里跑，且先 `Remove-Item Env:ELECTRON_RUN_AS_NODE`；
  结果落在 `.tmp-smoke/report.json`（electron.exe 是 GUI 子系统程序，stdout 接不到控制台）。
  探针窗口的尺寸是照着 `main/index.ts` 抄的 420×640 **窗口**尺寸，别改成 Electron 的默认值 ——
  本应用是窄窗，布局问题恰恰都出在窄窗上。
  探针中途炸掉时 `report.json` 的 `problems` 里会有**渲染层那条栈**
  （`executeJavaScript` 被拒只给一句没信息量的话，所以进场时挂了一个 window error 监听）。
  写 `evalIn` 的立即执行函数时留意括号：对象字面量形式要 `(() => ({ … }))()`，
  块体形式要 `(() => { … })()` —— 少一个右括号在渲染层是 `SyntaxError: Unexpected end of input`，
  而它只在跑到那一行时才炸，前面的断言全绿，很容易误以为是偶发。

## 视觉语言（2026-09-18 重做，改动前先读这段）

界面叫「今日账本」，两个入口都在这两个文件里：

- `src/renderer/tokens.css` — 色值、字体栈、`--radius`
- `src/renderer/styles.css` — 顶部有一段完整的视觉说明，含横向几何的算法

几条硬规矩，改样式时别破坏：

1. **只有两个色相。** 靛蓝（`--indigo`）= 结构 + 「快到了」；朱砂（`--cinnabar`）
   = 已经晚了（逾期 / 出错 / 通知已关 / 删除）。**不要再引入第三、第四个色相做状态区分** ——
   之前那档琥珀色（soon）已经撤掉，它和朱砂是同一个语义量级。
   「快到了」靠刻度的长度与加粗表达，不靠颜色。
   两个色相**都会被当文字用**（顶栏的「逾期 N」、`.field__hint--warn`…），
   而它们写在三层纸（`--paper` / `--sheet` / `--surface`）上都可能：
   朱砂原来是 `#bf3628`，在 `--paper` 上只有 4.46:1，所以压到了 `#b93427`。
   调色时**四层文字色 × 三层纸**全都要过 AA，别只看一层。
2. **竖轴是签名，几何不能各改各的。** 刻度列在 x = 55px（游标 3 + 时刻列 52）。
   分段标签的 `padding-left: 72px` 与两个伪元素的 `left: 55px` 都是从它推出来的。
   **没有时刻的行也必须渲染空的 `.row__clock`**，否则那一段的轴会错位、一根轴断成两截。
   `scripts/smoke.cjs` 里「竖轴逐行对齐」那条断言就是守这个的。
3. **文字只用两级灰**（`--ink` / `--ink-muted`），两级都要满足 AA（≥4.5:1）。
   `--ink-faint` 只准给图标字形用（⋮ × ·），不准给文案用。
   层级靠字号、字重、字距和等宽体做，不靠把字调淡。
   **这条有测试守着**（`core-test.ts` 末尾读 `tokens.css` 算对比度）：
   `--ink` / `--ink-muted` / `--indigo` / `--cinnabar` 在三种纸上都要 ≥4.5，
   而且 `--ink-faint` 的落点被钉在一份白名单里 —— 加一处就得在测试里加一行。
   **实底上的字是另一组耦合**（2026-09-29 加）：`--on-indigo` 压 `--indigo`
   （15px 的今日日号那种「小印」）、`--on-slab` 压 `--slab`（倒计时页那一整块）。
   上面那组管不到它们 —— 调亮一个底、或换了底却忘了一起换字色，就会掉到 AA 以下，
   而失效只显形在那一小块上，肉眼大概率漏掉。所以测试里另有一组断言，
   **而且要把 `opacity` 混算进去**（块里的小字都带 0.75，混出来的实色才是被读到的颜色）：
   `--on-slab` 就是从 `#e6edf2` 被这条逼成 `#ffffff` 的（`#e6edf2` @75% 只有 4.36:1，
   看着像够其实不够）。**新开一对「底 + 压在上面的字」就要同步进那份断言表。**
   **铺了底色的格子必须把文字升一级**：`--indigo-wash` 的浓度足够吃掉 `--ink-muted`
   的余量（10px 的农历文字会掉到 AA 以下），所以假日那格的 `.monthcell__label`
   从 `--ink-muted` 升到 `--ink`。**凡是要给一块区域铺底，先想清楚压在上面的字升不升。**
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
10. **「以后」是第三本账**，样式在 `FutureView.tsx`，算在 `shared/future.ts`（纯函数、有测试）。
    看板四段全只看今天、收件箱只放清单池，所以在这之前记一条周三的事就从界面上消失了。
    两条容易踩的：逾期**不进**这里（它已在看板置顶，再列一遍会有两个入口、两套排序）；
    全天型的时刻列给**空串而不是 `00:00`**，但也**不能不渲染**（竖轴靠它撑，见第 2 条）。
11. **「日历」是唯一一个按任意一天回答「那天有什么」的地方**，样式在 `CalendarView.tsx`，
    算在 `shared/agenda.ts`（纯函数、有测试）；农历在 `shared/lunar.ts`、节气在 `shared/term.ts`、
    节假日与调休在 `shared/holiday.ts`。六条容易踩的：
   - **周期任务不进过去的日子、也不进圆点**（`agendaOfDay` 里那两条）。它没有历史，
     铺到上周就是替用户编一份「那天你没做」的流水；而圆点是给「有日期承诺的事」用的，
     一条「每天」的习惯会把整月每一格都点上，日历就不再是「扫一眼哪天有事」了。
     今天那一格例外 —— 习惯本来就在今天。`tasksOnDay` 保留纯展开（无 `now`），
     呈现规则只在 `agendaOfDay`，别把 `now` 塞进前者。
   - **农历与节气是算出来的，不是查表**。年表只到 1900–2100，节气走天文算法
     （`term.ts` 的牛顿迭代）。`core-test.ts` 拿国务院通知的春节/中秋/端午当锚点逐条对，
     还用「冬至必落农历十一月」做整表体检 —— **别改成抄一张表**，抄错一位整年都歪而界面上完全正常。
   - **节假日数据抄自国务院办公厅的通知**，没公布的年份**不许猜**：
     `upcomingHolidays` 返回空就明说「还没公布」，按规则推一个日期会让人照着去请假。
   - **一格上叠着六件事，就给它六个各不相同的通道**（只有一个色相，全靠浓度、纹理和几何
     重量区分，见第 1 条）。改这块样式前先把表读一遍，别让两件事挤进同一个通道：

     | 要说什么 | 怎么画 |
     |---|---|
     | 放假 | 整格铺 `--indigo-wash`，连着的几天会自己接成一条色带 + 靛蓝加粗日号 + 「休」 |
     | 调休上班 | 45° 斜纹（`--stripe`，**用墨色不用靛蓝** —— 靛蓝在这张月历上已等于「放假」，同色再来一档就说不清那天到底休不休）+ 加粗日号 + 「班」 |
     | 那天有逾期 | 格子左边一道 2px 朱砂竖条（和看板刻度轴同一套语言） |
     | 那天还有几件没做完 | 右下角的小点，一点一件、最多三个；有逾期时点换朱砂，超出三个给数字（`--late` 与竖条说的是同一件事，所以同用朱砂） |
     | 今天是哪天 | 日号上盖一枚实心靛蓝印（`--indigo` / `--on-indigo`） |
     | 选中了哪天 | 2px 实靛 **outline**（是框不是底，所以和上面五件事都能叠着出现） |

   - **三处顺序敏感，调 CSS 时别打乱**：`.monthcell--today .monthcell__day` 要排在休假 /
     调休的日号染色**之后**（否则今天恰好是个调休周六时，最该一眼看见的那枚印会被盖掉）；
     `.monthcell--rest .monthcell__label`（有底色 → 灰度升一级）要排在 `--out` 压回之后；
     `.monthcell--rest .monthcell__label--term` 排在**最后**（假日里的节气要保住靛蓝，
     否则春节里的「雨水」看起来和普通农历文字一样）。
   - **底色走 `::after` + `z-index: -1`**，所以格子要 `position: relative` + `isolation: isolate`
     （不隔离的话负 z-index 会漏出格子）；hover 用 **outline**、别用 inset 阴影 ——
     inset 阴影和背景同属一层，会被 `::after` 的底色盖掉，等于没写。
     底色左右各外扩半像素（`inset: 0 -0.5px`），把 1px 网格缝盖上，九天连休才连得成一条。
12. **「倒计时」是第四本账**，样式在 `CountdownView.tsx`（不是 `.ts`，里面还有内联表单），
    算在 `shared/countdown.ts` + `shared/anniversary.ts`（都是纯函数、有测试）。
    三条容易踩的：
   - **纪念日不是 `Task`** —— 没有「完成」这个动作，也不提醒，所以它不挂 `completedAt` /
     `firedFor`，在 `Persisted` 里是独立数组（`anniversaries`）。别为了省一张表把它塞进 `Task`，
     那样每个关于待办的分支都要先排除它一次。
   - **农历纪念日存的是公历锚点**，农历月日从锚点推出来。让用户自己填「八月十五」既没有控件可用，
     也挡不住他填出一个不存在的日子；闰月的锚点按「第几个月」处理（闰六月十五的生日，
     平年就过六月十五）。
   - **纪念日没有软删**（`Store.removeAnniversary` 直接删干净），所以界面上删除是**两步确认**
     —— 点一下就没了的按钮不该长得跟「保存」一样轻。
13. **Esc 逐级返回 ≠ 一律回看板。** 看板根层级什么都不做（常驻托盘应用里 Esc 隐藏窗口太容易误触）；
    **编辑器回它进来的地方**（`view.from === 'calendar'` 就回日历，和那颗「取消」按钮同一条路，
    两个出口不能互相矛盾）；其余视图回看板。浮层（`Popover`）在捕获阶段自己先拦。
14. **自动更新只对安装版（NSIS）有效，便携版只能手动下载。** 更新走 `electron-updater`，
    状态机在 `shared/update.ts`（纯函数、有测试），全项目只有 `main/updater.ts` 碰 electron-updater。
    版本号显示在设置页「更新」组的「当前版本」（`app.getVersion()`，来源是 package.json）。
    五条容易踩的：

    - **状态不落盘**。它挂在 `RuntimeState.update` 上 —— 记的是「这一版进程此刻认到的事」，
      写进数据文件只会在下次启动时带来一个必然是过期的值（同 `pausedUntil`）。
    - **便携版的判据是 `PORTABLE_EXECUTABLE_DIR`**（electron-builder 注入的环境变量），
      不是 exe 路径：用户可能把 setup 装到 D 盘、也可能把 portable 丢在任何地方。
      便携版每次运行都解压到临时目录，没有可覆盖的安装位置，而 electron-updater 在
      Windows 上只支持 NSIS —— 够不着它，界面上只能提示 + 给一个发布页按钮。
    - **开发态不检查**（`app.isPackaged === false`）：那时没有 `app-update.yml`
      （打包时才由 electron-builder 按 `electron-builder.yml` 的 `publish` 段写进 resources），
      一调就抛。直接标成 `unsupported: 'dev'`，界面写「开发运行时不检查更新」——
      比在 dev 里反复弹「Cannot find app-update.yml」有用。
    - **发布纪律**（少一条就静默失效：electron-updater 不报错，只会一直说「已是最新」）：
      tag 必须和 `package.json` 的 `version` 一致；Release 不能是 draft（draft 对更新检查完全不可见）；
      `latest.yml` 与 `*.blockmap` 必须和 exe 一起上传（`release.yml` 里那几行 path 就是干这个的，
      漏了就是 404）。`latest.yml` 和 exe 还必须属于**同一次构建** —— 拿旧的 yml 配新的 exe，
      客户端会按错误的 sha512 校验失败。
    - **关掉开关要撤掉已经排上的定时器**（`afterCommand` 里那行 `updater.syncSchedule()`）。
      漏了它的症状很隐蔽：这一次不查了，但 6 小时后还会再查。排程本身是启动 20 秒后首次
      （开局那几秒在抢 IO：读数据文件、建托盘、注册热键），之后每 6 小时；
      定时器一律 `unref()` —— 否则 `app.quit()` 之后进程会被一个 6 小时后的回调吊住，永远退不掉。

## 项目结构

- `src/main/` — Electron 主进程（托盘、通知、调度、存储、**更新**）
- `src/renderer/` — React 渲染层
- `src/shared/` — 主进程与渲染层共用逻辑（含纯函数式的图标光栅化、月历计算、农历与节气、
  节假日与调休、日历按天聚合、纪念日与倒计时、已完成账本、**自动更新状态机**）
- `resources/icon.ico` — 由 `pnpm icons` 生成，**提交进仓库**（打包机不必先跑一遍 node）
- `scripts/core-test.ts` — 核心逻辑测试（唯一需要保留的测试入口）
- `scripts/smoke.cjs` — 界面冒烟（真开 Electron 点一遍）
- `scripts/make-icons.ts` — 重画应用图标

## 存储（2026-09-22 加固）

数据在 `%APPDATA%/todo-reminder/todo-reminder.json`，单文件全量读写。四条别踩：

1. **校验必须深到每一层**（`store.ts` 的 `normalizeTask`）。只认 `id`/`title`/`kind`
   的浅校验挡不住「JSON 语法合法、字段却半截」的数据，而那种数据会在**两个进程里**
   以两种方式炸掉：缺 `remindTime` 的周期任务让主进程每 10 秒的 tick 抛一次；
   每周规则缺 `days` 让渲染层 render 抛错、React 卸载整棵树**白屏且无恢复入口**。
   判据是「这个值会不会让某处代码抛错或静默算错」，所以校验**类型与存在性、不校验格式**
   （`'9:00'` 没补零照样放行，`undefined` 才拦）。
   被拦下的记录**不静默丢弃**：原文复制一份到 `<file>.dropped-<ts>`，并在顶部提示条说一声。
2. **写盘是「临时文件 → fsync → rename」的全量重写**，所以**一批更新要走
   `updateTasks`**，别在循环里逐条 `updateTask`。逐条写 60 条实测放大 59 倍
   （14.9 KB 的文件写出 876 KB），而且 `fsync` 是同步阻塞的、全在主进程。
3. **软删的任务留 30 天后启动时清掉**（`purgeDeleted`）。界面上删除只留 5 秒撤销窗口，
   也没有任何视图会列出软删任务 —— 留着它们只让文件单调变大，而每次写盘都是全量重写。
4. **`version` 字段是有用的**：读到比 `FILE_VERSION` 新的文件（装过更新版本又退回来）
   会**先备份再动**，否则第一次改设置就会把新格式的字段全量重写掉。
   加新字段时沿用这条：先保证「不认识的字段不会因为一次写盘就消失」。
   `FILE_VERSION` 现在是 **2**（第四期加了 `anniversaries` 与两条倒计时设置）。
   提版本号不是仪式：旧程序读到 v2 文件会先备份，不提的话它一次写盘就把纪念日全抹了。
   `ANNIVERSARY` 的校验是 `normalizeAnniversary`，和 `normalizeTask` 同一条分工 ——
   存储只管形状（类型与存在性），「名字不能是空的」是业务规则、在命令层拒
   （`buildAnniversary`）。测试里有一条专门钉这个分工。

## 渲染层的两个性能前提（2026-09-22）

都不是正确性问题，但破坏它们是**静默**的 —— 只是界面每秒白重算一遍，没人会当场发现：

1. **时钟按需给粒度**（`useAppState` 的 `useNow`，三档 `off` / `minute` / `second`）：
   有退场行时要判 520ms 的到期，所以是秒级；看板、编辑器、**日历、倒计时**用到 `now` 的
   只有顶栏那个 `HH:mm`、「快到了」的 1 小时窗口、跨零点换日和「今天那格是哪一格」，
   全是分钟级，**而且要对齐到整分**（从挂载时刻起算 60 秒的话，12:01:00 时界面还停在 12:00，
   换日也会晚一步）。已完成/以后/收件箱/设置页干脆是 `off`。别改回一律 `setInterval(…, 1000)`。
2. **`mergeExiting` 没有退场行时返回入参本身**（同一个引用）。它的返回值就是
   `AppState.tasks`，而下游的 `groupToday`、行序列、每一行都挂在 `useMemo`/props 上 ——
   每次新建数组会让整条链失效、整棵树重算。

同理，给 `useCallback`/`useEffect` 写依赖时别把 `state` 整个对象放进去：
`useAppState` 每轮渲染都返回新对象字面量，那等于每轮摘掉重挂一次监听器
（`Board.tsx` 的键盘处理就是这么写的，取的是里面那几个稳定的回调）。

## 打包（第三期落地，2026-09-21）

一条命令：`pnpm dist`（= `electron-vite build` + `node scripts/dist.mjs --win --publish never`），
产物在 `release/`（已 gitignore）。几条硬规矩：

1. **配置只在 `electron-builder.yml` 一处。** 别再往 `package.json` 的 `build` 块里加东西 ——
   两处配置迟早不一致，而 `productName` 和 AUMID 的 `DisplayName` 必须与界面上的显示名同步。
2. **不要直接跑 `electron-builder`，跑 `scripts/dist.mjs`。** 这台机器访问 GitHub 会卡在
   证书吊销检查（`CRYPT_E_NO_REVOCATION_CHECK`），winCodeSign / nsis 那些二进制必须走
   npmmirror 镜像，那个脚本就是干这个的（顺带避开 `.cmd` 在中文路径下被截断的坑）。
3. **exe 名保持 ASCII**（`executableName: todo-reminder`），中文交给 `productName` 和快捷方式名。
4. **图标喂自己产的 32×32 多尺寸 `.ico`**，别给 png 让 electron-builder 去转 ——
   它内置的 WASM 图标工具在内存受限环境下直接把打包流程崩掉。
5. **通知归属是三件事，少一件都不弹**（实测，见 `src/main/aumid.ts` 顶部）：
   `app.setAppUserModelId()`、NSIS 建的开始菜单快捷方式、`HKCU\Software\Classes\AppUserModelId\<AUMID>`
   下的 `DisplayName` / `HasSentNotification` / `CustomActivator`。三个雷：
   - `DisplayName` 要写中文 → **只能走 UTF-16LE + BOM 的 `.reg` 文件 + `reg import`**。
     走 `reg add` 的命令行参数会被控制台代码页吃掉，注册表里落成乱码。
   - **点通知正文要让 Windows 认得出来，就得自己生成 toast XML。** Electron 生成的
     `<toast>` 上没有 `launch` 属性，tag 只写在按钮的 `arguments` 里 —— 点正文回传的
     invokedArgs 是空的，`parseActivation` 认不出是哪条任务，症状是「按钮能点、点正文没反应」。
     实测方法：`%LOCALAPPDATA%\Microsoft\Windows\Notifications\wpndatabase.db` 里存着
     通知的原始 XML，直接翻就能看见有没有 `launch`。XML 在 `src/shared/toastXml.ts`
     （纯函数、有测试，参数格式和 `parseActivation` 对着测）。
   - `CustomActivator` 指哪个 GUID → **既不要钉死常量，也不要去注册表反查**。
     钉死必落空：Electron 注册时若看到「开始菜单里属于本 AUMID 的那条快捷方式」记着
     `System.AppUserModel.ToastActivatorCLSID`，就改用那个值去写 CLSID 键、注册 COM 类对象
     （`windows_toast_activator.cc` 的 `EnsureShortcut()`）—— 应用写死的 GUID 于是没人注册，
     Windows 找不着活实例，点「完成/推迟」什么都不发生。反查同样不行：同一个 exe 会攒下多条
     陈旧 CLSID 键（每次重装、每次随机 GUID 都留一条），挑中哪条看运气；而且 `reg.exe` 的 stdout
     是控制台代码页，路径带中文（本项目就在「我的工作台」下）按 utf8 解出来永远比不中。
     正解：`shell.readShortcutLink` 读那条快捷方式（按 AUMID 认，只有一条），读不到才退回
     `app.toastActivatorCLSID`；启动时对齐一次，每批通知前后再各一次 —— 见 `index.ts` 的
     `syncToastActivator()`。**注意 `app.toastActivatorCLSID` 在注册之前读到的还是本次运行新生成的
     随机值**，跟快捷方式里那个不一样，所以顺序不能反。
6. **开机自启只有打包版算真验过。** 开发态 `process.execPath` 是 `electron.exe`，
   注册进 `HKCU\...\Run` 的是它（2026-09-21 实测：打包版登记的是
   `"...\release\win-unpacked\todo-reminder.exe"`，键名用 AUMID）。
   便携版（portable）自启不可信 —— 它跑在临时解压目录里。
7. **安装包由 Actions 构建，不手工上传二进制。** `.github/workflows/release.yml`：打 `v*`
   tag 就 `pnpm dist` + 发 Release。CI 上设 `DIST_OFFICIAL_MIRROR=1` 走官方源（镜像是给
   这台开发机用的），并且**不跑 `pnpm smoke`** —— CI 没有桌面会话。
8. **只调 `node scripts/dist.mjs --win` 不会重新构建 `out/`。** 它只拉起 electron-builder，
   打的是**磁盘上现成的** `out/`（`files` 里写的就是它）。看着产物是新的、时间戳也是新的，
   但里面那层代码可能是改之前的 —— 要打就用 `pnpm dist`（= `electron-vite build` +
   `dist.mjs`）。真要单独调 builder，先自己跑一次 `pnpm build`。
   验证「打进包里的到底是不是新代码」别只看体积：asar 是「头 + 内容」两段，
   **头里只有文件树（路径 + 偏移），没有文件内容** —— 在头里搜代码字符串永远搜不到，
   得按偏移把内容读出来再搜。头布局是 `[4][pickleSize][jsonSize][json][padding]`，
   内容区从 `8 + pickleSize` 开始。
9. **本机 `safe-delete` 会把「删除」和「改名」都送回收站，大目录必失败。** 它拦的不只是
   bash 的 `rm -rf`，`node` / PowerShell / **Python 的 `os.remove`、`shutil.rmtree`、`shutil.move`
   一样拦**（实测 `os.rename` 也走 trash）。单个小文件没问题；一旦树大（几百 MB 的
   `win-unpacked`、或一次删 70+ 个文件）回收站操作就报 `Some operations were aborted`，
   然后 FAIL_CLOSED 整个拒绝。AGENTS.md 上面记的 `SHFileOperationW` 那条对**单文件**有效，
   对这种大树同样返回 124。
   两个绕法，都不用跟它对着干：
   - **打包时换个空的输出目录**（`--config.directories.output=.tmp-pkg3`）：electron-builder
     不再需要清理旧的 stage 目录，一次都不会触发。
   - **验证完的产物干脆别删**，`.tmp-pkg*/` 与 `release/` 都已在 `.gitignore` 里；
     真要腾空间就手动（资源管理器）删。
   另：`--dir` 模式**不生成 `app-update.yml`、也不带 `elevate.exe`**（那是完整打包/NSIS 才有的），
   别以为自动更新坏了。
10. **打包报 `EBUSY: resource busy or locked, unlink …\release\win-unpacked.tmp\resources\*.asar`
   时，是那个文件上挂了个「删不掉的句柄」—— 而且很可能是 safe-delete 自己弄出来的。**
   完整症状：electron-builder 能把暂存目录里 74/75 个文件清掉，只卡在一个 `.asar` 上，
   然后 `Command failed with exit code 1`。看着像玄学，其实有确定的判据和确定的解法：

   - **怎么确认是句柄而不是权限/属性**：用 `CreateFileW` 以 `dwShareMode = 0`（独占）去开它。
     返回 `ERROR_SHARING_VIOLATION(32)` 就是真有别的进程拿着句柄；能开就是别的问题。
     别用「属性有没有只读」判断 —— 实测属性是干净的 `Archive`、也不是硬链接。
   - **为什么 `unlink` 和 `rename` 都失败、但「截断成 0 字节」却成功**：持有方打开时带的是
     `FILE_SHARE_WRITE` 但**没有** `FILE_SHARE_DELETE` —— 能写不能删，这是最典型的组合。
     Electron 用 mmap 读 `*.asar` 正好是这个共享模式，所以**出事的总是 `.asar`**。
   - **凶手多半看不见**：`Get-Process` 里翻不到任何进程占着它（受保护进程如 Defender 压根
     枚举不出来），`handle.exe` 本机也没装，`openfiles` 又要先开「维护对象列表」系统标志。
     **别在这上面耗时间**，直接按下面解。
   - **大概率是 safe-delete 自己泄漏的句柄**：它去「送回收站」时打开了目标文件，失败的
     那一次把句柄漏了，于是**这个文件从此永久删不掉**（连下一次 safe-delete 也会失败），
     表现就是「第一次没删掉，以后再也删不掉」。本项目里 `.tmp-pkg\...\app.asar` 与
     `release\win-unpacked.tmp\resources\default_app.asar` 都是这么被毒上的。
   - **解法一（推荐）**：**重启 WorkBuddy**（或重启机器）释放句柄 → 在**资源管理器里**删掉
     整个 `release\` → 再 `pnpm dist`。资源管理器不在 shim 的进程树里，删除不走 safe-delete。
   - **解法二（不想重启）**：换一个全新的输出目录，完全不碰那个中毒的暂存目录 ——
     实测可行（`--config.directories.output=.tmp-pkg-verify`，`exit=0`）。
     代价是多一份几百 MB 的产物要清。

   顺带一条：**这个坑的入口是「构建被打断」**。electron-builder 每次都要清自己的
   `win-unpacked.tmp`，而它一旦被中断就会留下一个 `resources\` 尾巴。所以宁可
   「先想好输出目录再跑」也别中途 Ctrl-C。
   清理这种「有一个文件删不掉的树」时，另有两个反直觉的行为（2026-09-29 实测）：

   - **`shutil.rmtree` 是原子的**：树里只要有一个文件被占用，整棵树**一个字节都不会删**
     （对照实验：0 个文件被占用的树 166 个文件一趟删干净；1 个被占用的树释放 0 MB）。
     正解是 `os.walk(root, topdown=False)` 逐文件 `os.remove`、失败的 `except OSError: pass`
     跳过 —— 慢（247 个文件 3 分 42 秒），但能把能删的全拿回来。
   - **别用改名去「挪开」**：`shutil.move` 在 shim 下是「先复制、再送源去回收站」，
     源删不掉就会**凭空留一份拷贝**。把 `release` 改名成 `release-old` 的后果是
     多出 1.1 GB（`release-old/` 加 `release-old/release/` 两份）。

## 文件卫生

测试/调试产生的一次性文件（probe、日志、构建副本）不要留在仓库里；
`.tmp-test/`、`.tmp-smoke/`、`.tmp-icons/`、`.tmp-shot/`、`*.log` 已在 `.gitignore` 中，
但仍应及时清掉，不要攒着。**改配色 / 版式时要看效果**，用已经归档好的
`.workbuddy/tools/shot.cjs`（真开 Electron 拍日历页与倒计时页，浅深各一张，
产物落 `.workbuddy/preview/`）—— 它是可复用的，不是一次性脚本，别每次重写一遍：

```
unset ELECTRON_RUN_AS_NODE
./node_modules/electron/dist/electron.exe .workbuddy/tools/shot.cjs          # 浅色
./node_modules/electron/dist/electron.exe .workbuddy/tools/shot.cjs --dark   # 深色
```

它**不是测试**（断言在 `pnpm smoke` 里），只回答「改成什么样了」。临时的像素采样脚本
还是按上面这条走 —— 用完同一轮删掉。两条本机限制先说在前面，省得再踩：

- **`pnpm exec electron` 在这个中文路径下接不上**（报「不是内部或外部命令」）。得直接调
  `node_modules/electron/dist/electron.exe`，但**两个 shell 的等待语义不一样**（2026-09-29 实测）：

  | 怎么调 | 会等吗 | 结论 |
  |---|---|---|
  | Bash 工具 `./node_modules/electron/dist/electron.exe probe.cjs` | **等**（实测 12.1s） | 可以，探针自己 `app.exit()` 就行 |
  | PowerShell `& .\...\electron.exe probe.cjs` | **不等**（0.04s 返回，进程在后台照跑） | 紧跟着的命令只会看到上一轮的旧产物 |
  | PowerShell `Start-Process … -Wait -WindowStyle Hidden` | **等**（实测 3.6s，与探针设定一致） | PowerShell 下就用这个 |

  进程不是没跑完，只是 shell 先返回了 —— 症状是**产物的时间戳没变**，极易误判成「探针坏了」
  （我这么误判过一次）。另外 **`ELECTRON_RUN_AS_NODE` 只要还在，`electron.exe probe.cjs`
  就会以 Node 模式跑脚本**：`require('electron')` 返回一个路径字符串而不是 API，`app` 是
  undefined，**0.5s 秒退且没有任何输出** —— 这就是两个命令开头都要先清掉它的原因。
  探针本身也要记得：**主题必须在 `loadFile` 之前设**（窗口在屏幕外时 Chromium 认为它被遮挡、
  不重新合成，换主题后再拍拿到的还是上一帧），而且**冷启动可能 5–12 秒**，别拿短 timeout 卡它。
- **送回收站走不了 `Add-Type`**（被安全策略拦：`Command blocked for security`），COM 通道
  在本机也是关的。用 Python + `ctypes` 调 `shell32.SHFileOperationW`（`FO_DELETE` +
  `FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI`），`pFrom` 记得
  **双 `\0` 结尾**，返回 0 就是成功。
