/**
 * 核心逻辑无头测试。
 * 跑法：pnpm test:core
 *
 * 末尾的 PASS/FAIL 汇总行必须始终是本文件最后几行 ——
 * 后面每个任务都是在它之前插入新的测试段。
 */
let checks = 0
let failures = 0

function check(name: string, actual: unknown, expected: unknown): void {
  checks++
  if (actual === expected) {
    console.log(`ok    ${name}`)
    return
  }
  failures++
  console.log(`FAIL  ${name}`)
  console.log(`        实际 = ${String(actual)}`)
  console.log(`        期望 = ${String(expected)}`)
}

/** 本地时间构造，避免时区把测试搞成偶然通过 */
function at(y: number, m: number, d: number, h = 0, min = 0, s = 0): number {
  return new Date(y, m - 1, d, h, min, s, 0).getTime()
}

import { addDays, atTimeOfDay, dayIndex, dayKey, daysInMonth, parseHM, startOfDay } from '../src/shared/time'

console.log('\n--- time.ts ---')
check('dayKey 格式', dayKey(at(2026, 9, 16, 15, 30)), '2026-09-16')
check('dayKey 跨午夜前', dayKey(at(2026, 9, 16, 23, 59)), '2026-09-16')
check('dayKey 跨午夜后', dayKey(at(2026, 9, 17, 0, 1)), '2026-09-17')
check('dayKey 补零', dayKey(at(2026, 1, 5, 8, 0)), '2026-01-05')
check('startOfDay 归零', startOfDay(at(2026, 9, 16, 15, 30, 45)), at(2026, 9, 16, 0, 0, 0))
check('addDays 跨月', addDays(at(2026, 8, 31, 10, 0), 1), at(2026, 9, 1, 10, 0))
check('addDays 负数', addDays(at(2026, 9, 1, 10, 0), -1), at(2026, 8, 31, 10, 0))
check('atTimeOfDay', atTimeOfDay(at(2026, 9, 16, 15, 30), '09:00'), at(2026, 9, 16, 9, 0))
check('daysInMonth 1月', daysInMonth(2026, 1), 31)
check('daysInMonth 2月平年', daysInMonth(2026, 2), 28)
check('daysInMonth 2月闰年', daysInMonth(2024, 2), 29)
check('daysInMonth 4月', daysInMonth(2026, 4), 30)
check('parseHM 正常', JSON.stringify(parseHM('09:05')), JSON.stringify({ h: 9, m: 5 }))
check('parseHM 垃圾输入不炸', JSON.stringify(parseHM('abc')), JSON.stringify({ h: 0, m: 0 }))
check('dayIndex 相邻两天差 1', dayIndex(at(2026, 9, 16)) - dayIndex(at(2026, 9, 15)), 1)
check('dayIndex 跨月差 1', dayIndex(at(2026, 9, 1)) - dayIndex(at(2026, 8, 31)), 1)

console.log('\n--- 骨架自检 ---')
check('测试链路可用', 1 + 1, 2)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${checks - failures}/${checks} 项通过`)
if (failures > 0) process.exitCode = 1
