import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { APP_ICON_SIZES, buildAppIco, appIconPng } from '../src/shared/appIcon'

/**
 * 生成 `resources/icon.ico`（应用图标：窗口 / 任务栏 / exe 内嵌）。
 *
 *     pnpm icons              # 只写 .ico
 *     pnpm icons --preview    # 顺手把各尺寸导成 PNG 到 .tmp-icons/，用来看效果
 *
 * **托盘图标不走这里** —— 它由 `shared/trayIcon.ts` 在运行时按任务栏明暗
 * 现算颜色，不能固化成一张图。
 *
 * 为什么要一个脚本而不是把图直接塞进仓库：图是**代码画出来的**，改一根线的
 * 坐标应该改代码、重新生成，而不是去修一张二进制图（改完没人知道它对应哪版）。
 * 生成的 .ico 提交进仓库，这样 CI / 打包机不需要先跑一遍 node。
 */

const ROOT = projectRoot()
const ICON_PATH = join(ROOT, 'resources', 'icon.ico')

/**
 * 往上找到 package.json 所在的那一层当项目根。
 *
 * **不能写 `resolve(__dirname, '..')`** —— 这个脚本是编译之后从 `.tmp-test/scripts/`
 * 跑的（见 package.json 的 `icons`），`..` 会落在 `.tmp-test` 上，图标就写进了
 * 一个马上会被清掉的临时目录，而命令退出码还是 0。踩过一次。
 */
function projectRoot(): string {
  let dir = __dirname
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'package.json'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('找不到项目根（往上 6 层都没有 package.json）')
}


function main(): void {
  const ico = buildAppIco()
  mkdirSync(dirname(ICON_PATH), { recursive: true })
  writeFileSync(ICON_PATH, ico)
  console.log(`icon.ico  ${(ico.length / 1024).toFixed(1)} KB  ${APP_ICON_SIZES.join(' / ')}`)

  if (process.argv.includes('--preview')) {
    const dir = join(ROOT, '.tmp-icons')
    mkdirSync(dir, { recursive: true })
    for (const size of APP_ICON_SIZES) {
      writeFileSync(join(dir, `app-${size}.png`), appIconPng(size))
    }
    console.log(`preview  → ${dir}`)
  }
}

main()
