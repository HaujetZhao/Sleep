// 最小 WAV 编码器（16-bit PCM）。Web Audio 无原生 encode，手写这几十行。
// 输入 AudioBuffer（decodeAudioData 解码后的浮点 PCM，样本范围 [-1,1]），输出 WAV 文件的 ArrayBuffer。
export function audioBufferToWav(buffer) {
  const numCh = buffer.numberOfChannels, sr = buffer.sampleRate, len = buffer.length
  const blockAlign = numCh * 2, dataSize = len * blockAlign
  const v = new DataView(new ArrayBuffer(44 + dataSize))
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  ws(0,'RIFF'); v.setUint32(4,36+dataSize,true); ws(8,'WAVE'); ws(12,'fmt ')
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,numCh,true)
  v.setUint32(24,sr,true); v.setUint32(28,sr*blockAlign,true)
  v.setUint16(32,blockAlign,true); v.setUint16(34,16,true); ws(36,'data'); v.setUint32(40,dataSize,true)
  const chs = []; for (let c = 0; c < numCh; c++) chs.push(buffer.getChannelData(c))
  let off = 44
  for (let i = 0; i < len; i++) for (let c = 0; c < numCh; c++) {
    let s = Math.max(-1, Math.min(1, chs[c][i]))
    v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2
  }
  return v.buffer
}

// ponytail: 可运行自检 —— node src/wav-encoder.js。构造极小 fake AudioBuffer，验头部魔数与长度。
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('wav-encoder.js')) {
  const fake = {
    numberOfChannels: 1, sampleRate: 8000, length: 1,
    getChannelData: () => new Float32Array([0]),
  }
  const out = audioBufferToWav(fake)
  const view = new DataView(out)
  const assert = (cond, msg) => { if (!cond) throw new Error(msg) }
  assert(out.byteLength === 44 + 2, `长度应为 46，实际 ${out.byteLength}`)
  const str = off => String.fromCharCode(...new Uint8Array(out, off, 4))
  assert(str(0) === 'RIFF', `RIFF 魔数错：${str(0)}`)
  assert(str(8) === 'WAVE', `WAVE 魔数错：${str(8)}`)
  assert(view.getUint16(22, true) === 1, '声道数错')
  assert(view.getUint16(34, true) === 16, '位深度错')
  console.log('wav-encoder 自检通过：', out.byteLength, '字节')
}
