import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

/**
 * 把 `ELECTRON_RUN_AS_NODE` 从环境里**真正删掉**（不是置空、也不是置 '0'）。
 *
 * 某些宿主环境（WorkBuddy / DSH 这类把 Node 塞进 Electron 壳的应用）会给子进程
 * 注入 `ELECTRON_RUN_AS_NODE=1`，于是 `pnpm dev` 里的 electron 以**纯 Node 模式**
 * 启动：`require('electron')` 返回的是安装路径字符串而不是 API，`electron.app`
 * 是 undefined，主进程第一句 `app.setName(...)` 就抛
 * `TypeError: Cannot read properties of undefined (reading 'setName')`。
 *
 * 为什么只能删、不能"设成别的值"（2026-11-06 逐条实测）：
 *   - 置空串 `ELECTRON_RUN_AS_NODE=` → **直接崩**，exit 134，
 *     `Assertion failed: (isolate_data->snapshot_data()) != nullptr`
 *   - 置 `'0'` → 仍然是 Node 模式（`typeof require('electron') === 'string'`）
 *   - 只有"变量不存在"（`undefined`）才是 GUI 模式
 * Electron 判断的是**变量存不存在**，不是它的值。
 *
 * 为什么放在这里能生效：`electron-vite dev` 用
 * `spawn(electronPath, [entry], { stdio: 'inherit' })` 拉起主进程 ——
 * **没传 env**，所以子进程完整继承父进程的环境。而本 config 是被 electron-vite
 * 的进程加载的，这一行在主进程 spawn 之前执行，删掉之后子进程就继承不到它了。
 *
 * 反过来，如果在 `src/main/index.ts` 里删就太晚了 —— 那时已经在 Node 模式里跑，
 * `electron` 模块已经解析成字符串了。所以必须在主进程之外、spawn 之前删。
 *
 * 这一行对没有该变量的环境是无害的空操作（正常开发机上它本来就是 undefined）。
 */
delete process.env.ELECTRON_RUN_AS_NODE

// electron 必须显式外部化：一旦被 vite 打进产物，构建时就地解析成了
// node_modules/electron 的「路径转发壳」，运行时会去找根本不存在的
// out/main/dist/electron.exe 然后报 "Electron failed to install correctly"。
const nodeExternals = ['electron', ...builtinModules.flatMap((name) => [name, `node:${name}`])]

// 主进程与 preload 强制产出 CommonJS。
// electron-vite 5 默认出 ESM，但 Electron 的 `electron` 模块是 CJS，
// Node 的具名导出探测在它身上不生效，会直接报
// "does not provide an export named 'BrowserWindow'"。
const cjsOutput = { format: 'cjs' as const, entryFileNames: '[name].js' }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: nodeExternals,
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        output: cjsOutput
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: nodeExternals,
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: cjsOutput
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
    server: { fs: { allow: [resolve(__dirname)] } },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // 快速添加小窗是第二个渲染入口：一个 440×148 的无边框窗口，
          // 装不下主界面的东西，也不该为它把主 bundle 拉进来
          quickadd: resolve(__dirname, 'src/renderer/quickadd.html')
        }
      }
    }
  }
})
