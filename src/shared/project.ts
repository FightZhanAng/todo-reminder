/**
 * 项目的对外身份 —— 仓库地址。
 *
 * 一个来源喂两处：设置页「关于」那一格的项目主页，和便携版 / 查不到更新时
 * 给出的发布页。两处必须指向同一个仓库，所以发布页由它拼出来，不另写一遍。
 *
 * **改仓库时还得一起改 `electron-builder.yml` 的 `publish`。** 那一段是给
 * electron-builder 生成包内 `app-update.yml` 用的（运行时 electron-updater
 * 只认那个文件），写的是 owner / repo 两个字段，没法从这个常量生成 ——
 * 只能靠这条注释提醒。
 */
export const REPO_URL = 'https://github.com/FightZhanAng/todo-reminder'

/**
 * 发布页。便携版和「查不到更新」两条路上唯一的出口 —— 那里的用户
 * 得自己去下新的 exe（见 main/ipc.ts 的 `open-download-page`）。
 */
export const RELEASES_URL = `${REPO_URL}/releases/latest`
