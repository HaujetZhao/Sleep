// 音源清单：加音频只需往 public/audio/ 丢 mp3 + 这里加一行。
// key  = 文件名（含后缀，稳定唯一）
// name = 下拉显示文字（= 文件名去后缀；想更友好可改成中文，如 '雨声'）
// file = /audio/<文件名> 的公开 URL
export const AUDIO_SOURCES = [
  { key: 'test-15s.mp3', name: 'test-15s', file: '/audio/test-15s.mp3' },
  { key: 'full-rain.mp3', name: 'full-rain', file: '/audio/full-rain.mp3' },
]

// ponytail: 一个可运行自检 —— node src/audio-sources.js 直接跑，仿 countdown.js。
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('audio-sources.js')) {
  const keys = AUDIO_SOURCES.map(a => a.key)
  const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
  assert(new Set(keys).size === keys.length, 'key 重复')
  for (const a of AUDIO_SOURCES) {
    assert(a.key && a.name && a.file, `字段缺失: ${JSON.stringify(a)}`)
    assert(a.file.startsWith('/audio/'), `file 应以 /audio/ 开头: ${a.file}`)
    assert(a.file.endsWith('.mp3'), `file 应为 mp3: ${a.file}`)
  }
  console.log('audio-sources 自检通过:', AUDIO_SOURCES.length, '个音源')
}
