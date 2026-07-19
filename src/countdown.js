// 倒计时工具:纯函数 + 预设时长。抽出来便于独立自检。

export const PRESETS = [
  { key: '30m', label: '30 分钟', ms: 30 * 60_000 },
  { key: '1h',  label: '1 小时', ms: 60 * 60_000 },
  { key: '2h',  label: '2 小时', ms: 120 * 60_000 },
  { key: 'inf', label: '无限',   ms: null },
]

// ms → 倒计时字符串。≥1 小时用 H:MM:SS,否则 M:SS。向上取整到秒。
export function formatCountdown(ms) {
  if (ms < 0) ms = 0
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// ponytail: 一个可运行自检 —— node src/countdown.js 直接跑,断言挂了就抛。
// 原计划用 import.meta.url === undefined 检测,但项目 package.json 是 "type":"module",
// Node ESM 下 import.meta.url 永远有值 → 那个条件恒为 false,自检永不跑。
// 改用最朴素的入口判断:argv[1] 指向本文件就是直射运行。Vite 打包后无 process,被 import 时 argv[1] 不是本文件 → 跳过。
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('countdown.js')) {
  const assert = (got, want) => { if (got !== want) throw new Error(`want ${want} got ${got}`) }
  assert(formatCountdown(0),               '0:00')
  assert(formatCountdown(29 * 60_000),     '29:00')
  assert(formatCountdown(30 * 60_000),     '30:00')
  assert(formatCountdown(60 * 60_000),     '1:00:00')
  assert(formatCountdown(120 * 60_000),    '2:00:00')
  assert(formatCountdown(2 * 60_000 + 500),'2:01')   // 向上取整
  console.log('countdown.js self-check OK')
}
