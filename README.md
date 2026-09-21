# 待办提醒

Windows 托盘常驻的待办应用。三句话说明它跟别的待办软件有什么不同：

1. **通知上就能办事** —— 弹出来的 toast 带「完成 / 推迟 / 改天」三个按钮，点下去走的是和界面
   完全同一条命令层，不会出现「数据改了、界面没动」。
2. **错过的提醒一定补回来** —— 免打扰时段、人不在电脑前、通知被关掉，这些都只是**延后**，
   不是丢弃。回到电脑前的第一个 tick 就补发。
3. **今天 / 以后 / 已完成是三本分开的账** —— 看板只管今天，明天及以后的事在「以后」里，
   做完的进「已完成」。

## 界面

- **今日账本**：逾期 / 接下来 / 今天随时 / 每天（周期任务）四段，左边一根竖轴把时刻和刻度串起来
- **收件箱**：还没决定哪天做的清单池，一键「今天做」
- **以后**：明天及以后的截止任务，按天分组
- **已完成**：按完成日分组的流水账，加周期任务的打卡现状
- **快速添加**：`Ctrl+Alt+T` 呼出小窗，记完即关
- 深浅主题跟随系统，也可以钉死

> 仓库是 TypeScript + React，**没有网页版**，上面这些都是桌面窗口。

## 技术栈

Electron 43 + electron-vite 5 + React 19 + TypeScript，包管理 pnpm。
数据是一个 JSON 文件（`%APPDATA%/todo-reminder/todo-reminder.json`），没有原生模块、没有数据库、
不联网。

代码分三层（`src/main` 主进程 / `src/renderer` 渲染层 / `src/shared` 共用），`shared/` 里全是纯函数 ——
时间、周期、提醒判定、月历、图标光栅化、三本账的分组。所以最容易出现差一格的逻辑都在无头测试里
断着，不靠肉眼看界面。

## 开发

```
pnpm dev        # 起开发实例
pnpm build      # 出 out/
pnpm typecheck  # 主进程 + 渲染层两套配置
pnpm test:core  # 核心逻辑 507 项
pnpm smoke      # 界面冒烟 116 项（真开 Electron 点一遍）
pnpm icons      # 从代码重画 resources/icon.ico
pnpm dist       # 出安装包：release/*-setup.exe（NSIS）+ 同版本便携版
```

`pnpm smoke` 要在 PowerShell 里跑，且先 `Remove-Item Env:\ELECTRON_RUN_AS_NODE` —— 本机预设了它，
Electron 会以 node 模式启动、`app.ready` 之前静默退出。结果落在 `.tmp-smoke/report.json`。

逐条验收清单、以及「哪些是真机跑过的、哪些只有自动化覆盖」记在 `scripts/manual-check.md`。

## Windows 通知这块有三个坑（都踩过）

1. 光调 `app.setAppUserModelId()` 通知根本不弹。还得有开始菜单快捷方式（NSIS 建的那条），
   以及 `HKCU\Software\Classes\AppUserModelId\<AUMID>` 下的 `DisplayName` / `HasSentNotification`
   / `CustomActivator`。
2. `DisplayName` 要写中文，就只能走 UTF-16LE + BOM 的 `.reg` 文件 + `reg import`；
   走 `reg add` 的命令行参数会被控制台代码页吃掉，注册表里落成乱码。
3. 反查 Electron 自注册的激活器 GUID 时，**拿 exe 路径去问 `reg`**，不要把整棵 CLSID 树捞回来
   自己比字符串 —— `reg.exe` 的 stdout 同样是控制台代码页编码，路径带中文时永远比不中。

另外：图标是代码画出来的（`src/shared/raster.ts` 自己光栅化、自己编 ICO），改完跑 `pnpm icons`。
**别把 SVG 喂给 `nativeImage`** —— 它不报错，静默返回一张 0×0 空图，托盘里就什么都不剩了。

## 下载

Releases 里有打包好的安装版：`todo-reminder-<版本>-setup.exe`（NSIS，per-user 安装）
与 `todo-reminder-<版本>-portable.exe`（便携版，双击即用，但开机自启别指望它 ——
它跑在临时解压目录里）。

## 许可

MIT，见 [LICENSE](LICENSE)。
