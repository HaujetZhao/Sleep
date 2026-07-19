<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { PRESETS, formatCountdown } from './countdown.js'

// ponytail: 最终方案 —— 淡变烤进 WAV + 双 <audio> 实例定时轮换。
// 播放时零 JS 控音量（精度无损、熄屏无忧），timeupdate 触发下一段（duration 自适应）。
// 暂停 = 原地保留最新段进度；继续 = 原地接播（非从头）。

const SRC = '/test-15s.mp3'
const FADE = 5                  // 淡入淡出时长（秒，烤进 WAV）= 交接重叠时长

const ready = ref(false)
const toast = ref('')

// ---- 计时(墙钟驱动,与音频 timeupdate 交接完全独立)----
const duration  = ref(null)   // ms;null = 无限
const endTime   = ref(null)   // 运行中的结束时间戳(playing 态)
const remaining = ref(null)   // 暂停冻结的剩余 ms
const displayMs = ref(0)      // 当前显示用剩余 ms(playing 态由 tick 刷新)
let countdownTimer = null

let blobUrl = null
let audioA = null, audioB = null
let nextKey = 'a'
let toastTimer = null

onMounted(prepare)
onUnmounted(stop)

// ---- 音频预处理：解码 → 前5s淡入/后5s淡出烤进振幅 → 编码 WAV → blob ----
async function prepare() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  const ctx = new Ctx()
  const buf = await (await fetch(SRC)).arrayBuffer()
  const ab = await ctx.decodeAudioData(buf)
  ctx.close()

  const len = ab.length, sr = ab.sampleRate, fadeSamples = FADE * sr
  for (let c = 0; c < ab.numberOfChannels; c++) {
    const d = ab.getChannelData(c)
    for (let i = 0; i < fadeSamples; i++) {
      const g = i / fadeSamples
      d[i] *= g            // 开头淡入
      d[len - 1 - i] *= g  // 结尾淡出
    }
  }
  blobUrl = URL.createObjectURL(new Blob([audioBufferToWav(ab)], { type: 'audio/wav' }))

  audioA = new Audio(blobUrl)
  audioB = new Audio(blobUrl)
  audioA.loop = audioB.loop = false

  ready.value = true
  setupMediaSession()
}

// 最小 WAV 编码器（16-bit PCM）。Web Audio 无原生 encode，手写这几十行。
function audioBufferToWav(buffer) {
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

// ---- 播放控制 ----
// ponytail: 不用 setInterval（熄屏漂移、误差累积）。改用 audio 自身的 timeupdate：
// 当前段播到 (duration - FADE) 秒时启动下一段。duration 自适应，换任何长度音频都成立。
//
// 暂停/继续（原地恢复，非从头）：
//   - 暂停时，所有在播段 pause；但只保留"最新一段"的进度（= 非 nextKey 且在播的那段），
//     更早的段（已过交接点、正在淡出）直接归零停掉——它的历史使命已结束。
//   - 单段播放时，那一段就是最新的，原地暂停。
//   - 继续：只有保留的那一段 play()，它的 ontimeupdate 还在，播到交接点正常往下走。
const STATE = { IDLE: 'idle', PLAYING: 'playing', PAUSED: 'paused' }
const state = ref(STATE.IDLE)
const playing = computed(() => state.value === STATE.PLAYING)

const countdownText = computed(() => {
  if (!duration.value) return '∞'
  const ms = state.value === STATE.PAUSED ? remaining.value : displayMs.value
  return formatCountdown(ms ?? 0)
})

function toggle() {
  if (state.value === STATE.IDLE)        start()
  else if (state.value === STATE.PLAYING) pause()
  else                                   resume()
}

function start() {
  if (!ready.value) return
  resetBoth()
  state.value = STATE.PLAYING
  syncPlaybackState()
  nextKey = 'a'
  tick()
}

function selectDuration(ms) {        // ms === null = 无限
  if (!ready.value) return
  duration.value = ms
  start()                            // 复用现有音频启动:resetBoth → playing → tick()
  if (ms != null) { endTime.value = Date.now() + ms; startCountdown() }
}

function pause() {
  state.value = STATE.PAUSED
  const keep = nextKey === 'a' ? audioB : audioA
  const drop = nextKey === 'a' ? audioA : audioB
  if (!keep.paused) { keep.pause() }
  drop.ontimeupdate = null; drop.pause(); drop.currentTime = 0
  if (duration.value) remaining.value = Math.max(0, endTime.value - Date.now())  // 冻结剩余
  endTime.value = null
  stopCountdown()
  syncPlaybackState()
}

function resume() {
  state.value = STATE.PLAYING
  if (duration.value && remaining.value != null) {                                // 墙钟重算
    endTime.value = Date.now() + remaining.value
    startCountdown()
  }
  syncPlaybackState()
  const keep = nextKey === 'a' ? audioB : audioA
  if (keep.readyState >= 2) keep.play().catch(() => showToast('播放被拦截'))
}

function stop() {                    // 彻底停:回选择页 / 卸载 / 倒计时归零 / 蓝牙 stop
  state.value = STATE.IDLE
  resetBoth()
  stopCountdown()
  duration.value = null
  endTime.value = null
  remaining.value = null
  syncPlaybackState()
}

function goBack() {                   // 播放页"返回"键:停拔回选择页
  stop()
}

function resetBoth() {
  if (audioA) { audioA.ontimeupdate = null; audioA.pause(); audioA.currentTime = 0 }
  if (audioB) { audioB.ontimeupdate = null; audioB.pause(); audioB.currentTime = 0 }
}

function startCountdown() {
  stopCountdown()
  onCountdownTick()
  countdownTimer = setInterval(onCountdownTick, 250)
}
function stopCountdown() {
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
}
function onCountdownTick() {
  if (state.value !== STATE.PLAYING || !duration.value || endTime.value == null) return
  const left = endTime.value - Date.now()
  displayMs.value = Math.max(0, left)
  if (left <= 0) { showToast('时间到'); stop() }
}

function tick() {
  if (state.value !== STATE.PLAYING) return
  const el = nextKey === 'a' ? audioA : audioB
  el.currentTime = 0
  el.play().catch(() => showToast('播放被拦截，请点击页面按钮'))
  nextKey = nextKey === 'a' ? 'b' : 'a'

  // 当前段播到 (duration - FADE) 秒时启动下一段；handler 一次性。
  el.ontimeupdate = () => {
    // ponytail: 暂停时只 return 不清 handler——继续播放还要靠它接下一段。
    // （彻底停由 resetBoth 清，无需在此兜底；早期这里清自己导致暂停后再继续丢交接。）
    if (state.value !== STATE.PLAYING) return
    if (!el.duration) return
    if (el.currentTime >= el.duration - FADE) {
      el.ontimeupdate = null
      tick()
    }
  }
}

// ---- Media Session：拦截蓝牙耳机等外部媒体的 play/pause/stop ----
function syncPlaybackState() {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playing.value ? 'playing' : 'paused'
  }
}
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return
  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'Heavy Rain', artist: 'Rain Loop', album: '助眠'
  })
  const onPlay  = () => {
    if (state.value === STATE.PAUSED) resume(); else if (state.value === STATE.IDLE) start()
    showToast(playing.value ? '已继续' : '')
    syncPlaybackState()
  }
  const onPause = () => {
    if (playing.value) { pause(); showToast('已暂停') }
    syncPlaybackState()
  }
  const onStop = () => { stop(); showToast('已结束'); syncPlaybackState() }
  navigator.mediaSession.setActionHandler('play',      onPlay)
  navigator.mediaSession.setActionHandler('pause',     onPause)
  navigator.mediaSession.setActionHandler('stop',      onStop)
  navigator.mediaSession.setActionHandler('playpause', () => playing.value ? onPause() : onPlay())
}

// ---- Toast ----
function showToast(msg) {
  toast.value = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = '' }, 2000)
}
</script>

<template>
  <main>
    <h1>RAIN LOOP</h1>
    <Transition name="fade" mode="out-in">
      <!-- 选择页:idle -->
      <section v-if="state === 'idle'" key="select" class="page select">
        <button
          v-for="p in PRESETS" :key="p.key" class="preset"
          :disabled="!ready" @click="selectDuration(p.ms)"
        >{{ p.label }}</button>
      </section>
      <!-- 播放页:playing / paused -->
      <section v-else key="play" class="page play">
        <div class="countdown">{{ countdownText }}</div>
        <div class="status">{{ playing ? '播放中' : '已暂停' }}</div>
        <div class="controls">
          <button class="btn ghost" @click="goBack" aria-label="返回选择页">
            <i class="fa-solid fa-arrow-left"></i>
          </button>
          <button class="btn main" @click="toggle" aria-label="暂停或继续">
            <i v-if="playing" class="fa-solid fa-pause"></i>
            <i v-else class="fa-solid fa-play"></i>
          </button>
        </div>
      </section>
    </Transition>
    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </main>
</template>

<style scoped>
:root { color-scheme: dark; }
main {
  min-height: 100vh; min-height: 100dvh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 28px;
  padding: 24px; padding-bottom: calc(24px + env(safe-area-inset-bottom));
  background: radial-gradient(120% 80% at 50% 0%, #2a1a4a 0%, #0e0a1f 60%, #07060f 100%);
  color: #f0eaff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
h1 {
  font-size: clamp(13px, 3.5vw, 16px); font-weight: 500;
  color: #cfc3f0; letter-spacing: 3px; margin: 0; opacity: .7;
}

/* 两态共用 */
.page { display: flex; flex-direction: column; align-items: center; gap: 18px; width: 100%; max-width: 320px; }

/* 选择页 */
.select { gap: 12px; }
.preset {
  width: 100%; padding: 16px 0; border: none; cursor: pointer;
  background: rgba(255,255,255,.08); color: #f0eaff;
  font-size: clamp(15px, 4vw, 17px); letter-spacing: 1px;
  border-radius: 999px;
  transition: background .18s, transform .12s;
  backdrop-filter: blur(8px);
}
.preset:hover:not(:disabled)  { background: rgba(255,255,255,.16); }
.preset:active:not(:disabled) { transform: scale(.98); }
.preset:disabled { opacity: .4; cursor: not-allowed; }

/* 播放页 */
.countdown {
  font-size: clamp(56px, 22vw, 96px); font-weight: 200;
  line-height: 1; letter-spacing: 2px; color: #f0eaff;
  text-shadow: 0 0 40px rgba(167,139,250,.35);
}
.status { font-size: 13px; color: #9d8fc2; letter-spacing: 1px; margin: -4px 0 6px; }
.controls { display: flex; gap: 18px; }
.btn {
  width: 64px; height: 64px; border-radius: 50%; border: none; cursor: pointer;
  font-size: 22px; color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: transform .12s, background .18s, opacity .18s;
}
.btn:active { transform: scale(.94); }
.btn .fa-play { transform: translateX(2px); }   /* 三角形右侧留白,微移光学居中 */
.btn.main  { background: linear-gradient(135deg, #a78bfa, #7c5cff); box-shadow: 0 6px 24px rgba(124,92,255,.4); }
.btn.ghost { background: rgba(255,255,255,.08); color: #cfc3f0; }
.btn.ghost:hover { background: rgba(255,255,255,.16); }

/* 两态淡入淡出 */
.fade-enter-active, .fade-leave-active { transition: opacity .28s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Toast */
.toast {
  position: fixed; bottom: calc(32px + env(safe-area-inset-bottom)); left: 50%; transform: translateX(-50%);
  background: rgba(0,0,0,.6); color: #fff; padding: 10px 18px;
  border-radius: 10px; font-size: 14px; pointer-events: none;
  backdrop-filter: blur(6px);
}
.toast-enter-active, .toast-leave-active { transition: opacity .25s; }
.toast-enter-from, .toast-leave-to { opacity: 0; }
</style>
