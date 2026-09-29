/**
 * 二十四节气。**算出来的，不是查表**。
 *
 * ## 为什么不用那张通行的「寿星公式」表
 *
 * 那套做法是 `[Y × D + C] - L` 加一张分世纪的常数表和一张「例外年」补丁表 ——
 * 常数抄错一位、例外年漏一条，错的就是某一年某一个节气的一天，
 * 而这种错**在界面上看起来完全正常**。
 *
 * 节气的定义本身只有一句话：太阳的**视黄经**每走 15° 就是一个节气
 * （春分 0°、清明 15°…… 冬至 270°）。所以这里直接算黄经再反解时刻：
 * 用 Meeus 的低精度太阳位置（精度约 0.01°，折合 15 分钟），
 * 再用牛顿迭代找 15° 的整数倍。没有magic number，也没有例外表。
 *
 * 精度够用：15 分钟的误差只有在节气正好落在北京时间午夜前后 15 分钟内
 * 才会把日期推错一天，而那种情形一百年里只有个位数次。
 * 界面上节气只显示到「日」，时刻是附带的参考。
 *
 * ## 时区
 *
 * 按**北京时间**定日期 —— 节气是中国历法的一部分，它落在哪天由东八区决定，
 * 与这台机器在哪个时区无关。返回的 `key` 是北京时间的 'YYYY-MM-DD'，
 * 日历格子里比的就是这个键。
 */

/** 顺序即黄经递增，小寒 = 285°，每项 +15°，到冬至 270° 收尾 */
export const SOLAR_TERMS = [
  '小寒', '大寒', '立春', '雨水', '惊蛰', '春分',
  '清明', '谷雨', '立夏', '小满', '芒种', '夏至',
  '小暑', '大暑', '立秋', '处暑', '白露', '秋分',
  '寒露', '霜降', '立冬', '小雪', '大雪', '冬至'
] as const

export interface SolarTerm {
  name: string
  /** 北京时间那一天，'YYYY-MM-DD' */
  key: string
  /** 北京时间的时刻，'HH:mm' */
  clock: string
  /** 黄经，度数。测试与调试用 */
  longitude: number
}

const J2000 = 2451545.0
/** 一天里黄经平均走多少度 —— 牛顿迭代的步长换算用 */
const DEG_PER_DAY = 0.98564736

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180
}

/**
 * 太阳的视黄经（度，0–360）。
 *
 * Meeus《Astronomical Algorithms》第 25 章的「低精度」公式：平黄经 + 中心差
 * 得到真黄经，再扣掉光行差与黄赤交角的章动（最后那两项 0.00569 / 0.00478 度的修正）。
 * 1900–2100 范围内误差约 0.01°，足够定出「哪一天」。
 */
export function sunLongitude(jd: number): number {
  const t = (jd - J2000) / 36525
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
  const m = 357.52911 + 35999.05029 * t - 0.0001537 * t * t
  const c =
    (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(toRadians(m)) +
    (0.019993 - 0.000101 * t) * Math.sin(toRadians(2 * m)) +
    0.000289 * Math.sin(toRadians(3 * m))
  const omega = 125.04 - 1934.136 * t
  const apparent = l0 + c - 0.00569 - 0.00478 * Math.sin(toRadians(omega))
  return ((apparent % 360) + 360) % 360
}

/** 公历日期 → 儒略日（该日 0 时） */
function julianDay(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const m = month <= 2 ? month + 12 : month
  const a = Math.floor(y / 100)
  const b = 2 - a + Math.floor(a / 4)
  return (
    Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5
  )
}

/** 儒略日 → 北京时间当天的 'YYYY-MM-DD' 与 'HH:mm' */
function beijingOf(jd: number): { key: string; clock: string } {
  const ms = (jd - 2440587.5) * 86_400_000 + 8 * 3_600_000
  const d = new Date(ms)
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`
  const clock = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  return { key, clock }
}

/**
 * 第 `index` 个节气（0 = 小寒）在 `year` 年的儒略日。
 *
 * 初值按「小寒在 1 月 5 日前后、每 15.22 天一个」估计，再迭代收正 ——
 * 相邻节气的黄经差是固定的 15°，偏差换算成天就是 `diff / DEG_PER_DAY`，
 * 三四轮就到 1e-6 度以内。
 */
function termJulianDay(year: number, index: number): number {
  const target = (285 + 15 * index) % 360
  let jd = julianDay(year, 1, 5) + index * 15.218
  for (let i = 0; i < 12; i++) {
    const diff = ((target - sunLongitude(jd) + 540) % 360) - 180
    if (Math.abs(diff) < 1e-7) break
    jd += diff / DEG_PER_DAY
  }
  return jd
}

/** 一整年的节气。24 个节气全部落在本年（小寒 1 月 5 日、冬至 12 月 21 日前后） */
export function solarTermsOf(year: number): SolarTerm[] {
  return SOLAR_TERMS.map((name, index) => {
    const { key, clock } = beijingOf(termJulianDay(year, index))
    return { name, key, clock, longitude: (285 + 15 * index) % 360 }
  })
}

/**
 * 某天（本地时间戳）的节气；没有则 null。
 *
 * 按**本地年月日**去比北京时间那天的键值 —— 对中国用户两者是同一个日子，
 * 这个函数只回答「这天的格子上该不该写节气」。
 */
export function termOnDay(ts: number): SolarTerm | null {
  const d = new Date(ts)
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`
  for (const term of solarTermsOf(d.getFullYear())) {
    if (term.key === key) return term
  }
  return null
}

/** 冬至（黄经 270°）在某年落在哪一天。农历置闰规则的判据用得到 */
export function winterSolstice(year: number): SolarTerm {
  return solarTermsOf(year)[23]!
}
