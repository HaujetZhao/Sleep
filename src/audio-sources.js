// 音源清单：加音频只需往 src/audio/ 丢 mp3 + 加一条 import + 加一行。
// key  = 文件名（含后缀，稳定唯一）
// name = 下拉显示文字（手填中文，与文件名解耦，可自由起更友好的名字）
// file = mp3 经 Vite bundler 解析出的 URL：
//          - 普通 build（单 HTML，U 盘 file:// 直开）：vite.config.js 把 assetsInlineLimit
//            调高 → mp3 内联成 data URI，fetch(dataURI) 在 file:// 下放行，烤 WAV 路径成立；
//          - PWA build：默认 limit → 产物 /assets/<hash>.mp3，运行时 CacheFirst 仍按
//            pathname.endsWith('.mp3') 命中，缓存态图标比对（commit 91b9a8b）不受影响。
// 注意：静态 import mp3 使本文件无法再用 `node src/audio-sources.js` 自检（node 解析不了
//      mp3）；countdown.js / wav-encoder.js 的自检不受影响。
import f01 from './audio/01 - 打雷下雨.mp3'
import f02 from './audio/02 - 倾盆大雨.mp3'
import f03 from './audio/03 - 淅沥下雨.mp3'
import f04 from './audio/04 - 海边礁石.mp3'
import f05 from './audio/05 - 夜晚蟋蟀青蛙.mp3'
import f06 from './audio/06 - 旷野.mp3'

export const AUDIO_SOURCES = [
  { key: '01 - 打雷下雨.mp3',           name: '打雷下雨',     file: f01 },
  { key: '02 - 倾盆大雨.mp3',           name: '倾盆大雨',     file: f02 },
  { key: '03 - 淅沥下雨.mp3',           name: '淅沥下雨',     file: f03 },
  { key: '04 - 海边礁石.mp3',           name: '海边礁石',     file: f04 },
  { key: '05 - 夜晚蟋蟀青蛙.mp3',       name: '夜晚蟋蟀青蛙', file: f05 },
  { key: '06 - 旷野.mp3',              name: '旷野',         file: f06 },
]
