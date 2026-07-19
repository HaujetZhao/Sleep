// 音源清单：加音频只需往 public/audio/ 丢 mp3 + 这里加一行。
// key  = 文件名（含后缀，稳定唯一）
// name = 下拉显示文字（= 文件名去后缀；想更友好可改成中文，如 '雨声'）
// file = audio/<文件名> 在 base 下的 URL（GitHub Pages 部署在 /Sleep/ 子路径，
//        绝对 /audio/ 会 404，故用 vite 的 BASE_URL 前缀拼出正确路径）
// ponytail: BASE_URL 在 node 自检环境下为 undefined，回退 '/' 让自检通过。
const BASE = (import.meta.env && import.meta.env.BASE_URL) || '/'
const audio = name => `${BASE}audio/${name}`
export const AUDIO_SOURCES = [
  { key: '01 - 打雷下雨.mp3',           name: '打雷下雨',     file: audio('01 - 打雷下雨.mp3') },
  { key: '02 - 倾盆大雨.mp3',           name: '倾盆大雨',     file: audio('02 - 倾盆大雨.mp3') },
  { key: '03 - 淅沥下雨.mp3',           name: '淅沥下雨',     file: audio('03 - 淅沥下雨.mp3') },
  { key: '04 - 海边礁石.mp3',           name: '海边礁石',     file: audio('04 - 海边礁石.mp3') },
  { key: '05 - 夜晚蟋蟀青蛙.mp3',       name: '夜晚蟋蟀青蛙', file: audio('05 - 夜晚蟋蟀青蛙.mp3') },
  { key: '06 - 旷野.mp3',              name: '旷野',         file: audio('06 - 旷野.mp3') },
]

// ponytail: 一个可运行自检 —— node src/audio-sources.js 直接跑，仿 countdown.js。
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('audio-sources.js')) {
  const keys = AUDIO_SOURCES.map(a => a.key)
  const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
  assert(new Set(keys).size === keys.length, 'key 重复')
  for (const a of AUDIO_SOURCES) {
    assert(a.key && a.name && a.file, `字段缺失: ${JSON.stringify(a)}`)
    assert(/\/audio\/[^/]+\.mp3$/.test(a.file), `file 应以 /audio/ 开头且为 mp3: ${a.file}`)
  }
  console.log('audio-sources 自检通过:', AUDIO_SOURCES.length, '个音源')
}
