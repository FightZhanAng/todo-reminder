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

console.log('\n--- 骨架自检 ---')
check('测试链路可用', 1 + 1, 2)

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}  ${checks - failures}/${checks} 项通过`)
if (failures > 0) process.exitCode = 1
