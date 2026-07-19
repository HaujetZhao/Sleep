<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { PRESETS, formatCountdown } from './countdown.js'
import { AUDIO_SOURCES } from './audio-sources.js'

// ponytail: 最终方案 —— 淡变烤进 WAV + 双 <audio> 实例定时轮换。
// 播放时零 JS 控音量（精度无损、熄屏无忧），timeupdate 触发下一段（duration 自适应）。
// 暂停 = 原地保留最新段进度；继续 = 原地接播（非从头）。

const LS_KEY = 'rain:selected'   // localStorage 记忆上次选中的音源 key
const FADE = 5                  // 淡入淡出时长（秒，烤进 WAV）= 交接重叠时长

const ready = ref(false)
const toast = ref('')

// ---- 多音源选择 ----
const audioOpen = ref(false)                       // 下拉框开合
const preparingKey = ref(null)                     // 正在惰性烤制的 key（下拉项 loading 态）
const selectedKey = ref(AUDIO_SOURCES[0].key)      // 当前选中；挂载时按 localStorage 覆盖
const selectedName = computed(() =>
  AUDIO_SOURCES.find(a => a.key === selectedKey.value)?.name ?? ''
)
const blobCache = new Map()                        // key -> blobUrl（已烤制缓存）
const cachedKeys = ref([])                         // 已烤制落盘的 key（驱动下拉项 云/本地 图标）

// ---- 自定义时长输入面板(径向圆盘选择器) ----
const customOpen = ref(false)
const customH = ref(0)
const customM = ref(30)
const customValid = computed(() => customH.value * 60 + customM.value > 0)
const stage = ref('h')                    // 'h' = 选小时, 'm' = 选分钟

// 圆盘:0° 在顶(正上方),顺时针,每 30° 一个数字。两盘视觉同款,12 个数字均匀分布。
const DISK_R = 100                         // SVG 内部坐标系半径(viewBox 0 0 240 240,圆心 120,120)
const DISK_C = 120
const HOUR_NUMS  = Array.from({ length: 12 }, (_, i) => i)             // 0..11
const MIN_NUMS   = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]      // 5 分锚点

// 数字 i 在圆盘上的位置(角度 = i*30°,0° 在顶,顺时针;屏幕坐标 y 向下,故用 -90° 偏移)
function diskPos(value) {
  // value: 小时态直接 i(0..11); 分钟态把"步进角"统一为该数字对应的 30° 槽位(m/5 * 30°)
  const angle = (value * 30 - 90) * Math.PI / 180   // -90 把 0° 转到正上方
  return {
    x: DISK_C + DISK_R * Math.cos(angle),
    y: DISK_C + DISK_R * Math.sin(angle),
  }
}

// 指针角度(度,0° 在顶,顺时针):小时 h*30°,分钟 m*6°
const pointerAngle = computed(() =>
  stage.value === 'h' ? customH.value * 30 : customM.value * 6
)

// 当前 stage 盘面要渲染的数字列表(带其角度槽位)
const diskNumbers = computed(() =>
  stage.value === 'h'
    ? HOUR_NUMS.map(v => ({ v, pos: diskPos(v),       label: String(v) }))
    : MIN_NUMS .map(v => ({ v, pos: diskPos(v / 5),   label: String(v) }))  // 5 分锚点占每 30° 槽
)

// 当前 stage 当前选中值(用于高亮数字)
const diskSelected = computed(() => stage.value === 'h' ? customH.value : customM.value)

// 顶部大数字 H : M
const bigH = computed(() => String(customH.value).padStart(2, '0'))
const bigM = computed(() => String(customM.value).padStart(2, '0'))

// ---- Pointer Events:按下→拖动→释放,统一走 atan2 角度→值映射(tap 与 drag 同映射) ----
let dragging = false
const svgRef = ref(null)

function pointAngle(e) {
  const svg = svgRef.value
  if (!svg) return 0
  const rect = svg.getBoundingClientRect()
  // 用 viewBox 坐标系:把屏幕像素映射回 0..240
  const scale = rect.width / 240
  const x = (e.clientX - rect.left) / scale - DISK_C
  const y = (e.clientY - rect.top)  / scale - DISK_C
  // atan2 返回 -π..π,0° 在 +x 轴(右),顺时针为正(屏幕 y 向下)
  let deg = Math.atan2(y, x) * 180 / Math.PI
  deg += 90                                 // 把 0° 从右转到顶
  deg = (deg + 360) % 360                   // 归一到 0..360
  return deg
}

function angleToValue(deg) {
  if (stage.value === 'h') return Math.round(deg / 30) % 12               // 0..11
  return Math.round(deg / 6) % 60                                          // 0..59
}

function applyValue(v) {
  if (stage.value === 'h') {
    if (customH.value !== v) customH.value = v
  } else {
    if (customM.value !== v) customM.value = v
  }
}

function onPointerDown(e) {
  dragging = true
  e.target.setPointerCapture?.(e.pointerId)
  applyValue(angleToValue(pointAngle(e)))
}
function onPointerMove(e) {
  if (!dragging) return
  applyValue(angleToValue(pointAngle(e)))
}
function onPointerUp() {
  if (!dragging) return
  dragging = false
  // 释放后:若在小时态,自动切到分钟态(spec 两段式流程)
  if (stage.value === 'h') stage.value = 'm'
}

function openCustom() {                    // 进面板:重置 stage 为小时态
  audioOpen.value = false
  stage.value = 'h'
  customOpen.value = true
}
function switchStage(s) { stage.value = s }

// ---- 计时(墙钟驱动,与音频 timeupdate 交接完全独立)----
const duration  = ref(null)   // ms;null = 无限
const endTime   = ref(null)   // 运行中的结束时间戳(playing 态)
const remaining = ref(null)   // 暂停冻结的剩余 ms
const displayMs = ref(0)      // 当前显示用剩余 ms(playing 态由 tick 刷新)
let countdownTimer = null

let audioA = null, audioB = null
let nextKey = 'a'
let toastTimer = null

onMounted(async () => {
  const saved = localStorage.getItem(LS_KEY)
  const initial = AUDIO_SOURCES.some(a => a.key === saved) ? saved : AUDIO_SOURCES[0].key
  selectedKey.value = initial
  preparingKey.value = initial
  await prepareOne(initial)
  bindAudio(initial)
  preparingKey.value = null
  ready.value = true
  setupMediaSession()
})
onUnmounted(stop)

// ---- 音频预处理：解码 → 前5s淡入/后5s淡出烤进振幅 → 编码 WAV → blob（按 key 缓存）----
async function prepareOne(key) {
  if (blobCache.has(key)) return blobCache.get(key)
  const src = AUDIO_SOURCES.find(a => a.key === key).file
  const Ctx = window.AudioContext || window.webkitAudioContext
  const ctx = new Ctx()
  const buf = await (await fetch(src)).arrayBuffer()
  const ab = await ctx.decodeAudioData(buf)
  ctx.close()

  const len = ab.length, sr = ab.sampleRate, fadeSamples = FADE * sr
  for (let c = 0; c < ab.numberOfChannels; c++) {
    const d = ab.getChannelData(c)
    for (let i = 0; i < fadeSamples; i++) {
      const g = Math.sqrt(i / fadeSamples)  // 等功率淡变:重叠段功率总和近似恒定,听感无洼
      d[i] *= g            // 开头淡入
      d[len - 1 - i] *= g  // 结尾淡出
    }
  }
  const url = URL.createObjectURL(new Blob([audioBufferToWav(ab)], { type: 'audio/wav' }))
  blobCache.set(key, url)
  if (!cachedKeys.value.includes(key)) cachedKeys.value.push(key)   // 通知下拉项：此源已落本地
  return url
}

// 把双 <audio> 实例绑定到指定 key 的 blob；播放/轮换/暂停核心只认 audioA/B，与此处来源解耦。
function bindAudio(key) {
  const url = blobCache.get(key)
  if (!audioA) {
    audioA = new Audio(url); audioB = new Audio(url)
    audioA.loop = audioB.loop = false
  } else if (audioA.src !== url) {
    audioA.src = url; audioB.src = url
  }
  resetBoth()   // 切源后确保干净（idle 态，安全）
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

function onPreset(p) {               // 选择页按钮分发:自定义开面板,其余直接启动
  if (p.key === 'custom') { openCustom(); return }
  selectDuration(p.ms)
}

async function selectAudio(key) {       // idle 页下拉选中一项：切源 + 记忆 + 惰性烤制
  if (key === selectedKey.value) { audioOpen.value = false; return }
  selectedKey.value = key
  localStorage.setItem(LS_KEY, key)
  audioOpen.value = false
  preparingKey.value = key
  await prepareOne(key)
  bindAudio(key)
  preparingKey.value = null
}

function confirmCustom() {           // 自定义面板:时+分 → ms → 启动
  if (!customValid.value) return
  const ms = (customH.value * 60 + customM.value) * 60_000
  customOpen.value = false
  selectDuration(ms)
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
    title: 'Heavy Rain', artist: 'Sleep', album: '助眠'
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
    <h1>SLEEP</h1>
    <Transition name="fade" mode="out-in">
      <!-- 选择页:idle -->
      <section v-if="state === 'idle'" key="select" class="page select-page">
        <div class="audio-picker">
          <button class="audio-chip" @click="audioOpen = !audioOpen">
            <span class="audio-name">{{ selectedName }}</span>
            <span class="caret">▾</span>
          </button>
          <div v-if="audioOpen" class="dropdown-backdrop" @click="audioOpen = false"></div>
          <Transition name="dropdown">
            <ul v-if="audioOpen" class="audio-dropdown">
              <li
                v-for="a in AUDIO_SOURCES" :key="a.key"
                :class="['audio-item', { on: a.key === selectedKey, loading: preparingKey === a.key }]"
                @click="selectAudio(a.key)"
              >
                <span class="audio-item-name">{{ a.name }}</span>
                <!-- 缓存态图标:云端=未下载(离线不可用,点一下即下载)/本地=已落盘可离线/旋转=正在烤制 -->
                <i v-if="preparingKey === a.key" class="fa-solid fa-circle-notch fa-spin cache-ic loading-ic" title="准备中"></i>
                <i v-else-if="cachedKeys.includes(a.key)" class="fa-solid fa-circle-check cache-ic local-ic" title="已缓存到本地"></i>
                <i v-else class="fa-solid fa-cloud cache-ic cloud-ic" title="未缓存，点此下载到本地"></i>
              </li>
            </ul>
          </Transition>
        </div>
        <div class="preset-grid">
          <button
            v-for="p in PRESETS" :key="p.key" class="circle"
            :disabled="!ready" @click="onPreset(p)"
          >{{ p.label }}</button>
        </div>
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

    <!-- 自定义时长输入面板:径向圆盘选择器 -->
    <Transition name="fade">
      <div v-if="customOpen" class="overlay" @click.self="customOpen = false">
        <div class="custom-card">
          <!-- 顶部大数字 H : M -->
          <div class="big-display">
            <span :class="['part', { active: stage === 'h' }]">{{ bigH }}</span>
            <span class="sep">:</span>
            <span :class="['part', { active: stage === 'm' }]">{{ bigM }}</span>
          </div>

          <!-- 小时 / 分钟 切换标签 -->
          <div class="stage-tabs">
            <button :class="['tab', { on: stage === 'h' }]" @click="switchStage('h')">小时</button>
            <button :class="['tab', { on: stage === 'm' }]" @click="switchStage('m')">分钟</button>
          </div>

          <!-- 圆盘 -->
          <div class="disk-wrap">
            <svg
              ref="svgRef" viewBox="0 0 240 240" class="disk"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="onPointerUp"
            >
              <!-- 外圈细环 -->
              <circle :cx="DISK_C" :cy="DISK_C" :r="DISK_R + 16" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="1"/>
              <!-- 12 个数字 -->
              <text
                v-for="n in diskNumbers" :key="stage + '-' + n.v"
                :x="n.pos.x" :y="n.pos.y"
                :class="['disk-num', { sel: n.v === diskSelected }]"
                text-anchor="middle" dominant-baseline="central"
              >{{ n.label }}</text>
              <!-- 指针:从圆心指向"正上方"盘边,再用 transform rotate 到当前角度 -->
              <line
                :x1="DISK_C" :y1="DISK_C"
                :x2="DISK_C" :y2="DISK_C - DISK_R"
                class="pointer"
                :style="{ transform: `rotate(${pointerAngle}deg)`, transformOrigin: `${DISK_C}px ${DISK_C}px` }"
              />
              <!-- 指针末端圆点(随指针旋转) -->
              <g
                class="pointer-tip"
                :style="{ transform: `rotate(${pointerAngle}deg)`, transformOrigin: `${DISK_C}px ${DISK_C}px` }"
              >
                <circle :cx="DISK_C" :cy="DISK_C - DISK_R" r="7" class="tip-dot"/>
              </g>
              <!-- 圆心小圆点 -->
              <circle :cx="DISK_C" :cy="DISK_C" r="6" class="center-dot"/>
            </svg>
          </div>

          <!-- 开始按钮 -->
          <button class="custom-go" :disabled="!customValid" @click="confirmCustom">开始</button>
        </div>
      </div>
    </Transition>
  </main>
</template>

<style scoped>
:root { color-scheme: dark; }
main {
  position: relative;
  min-height: 100vh; min-height: 100dvh;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 28px;
  padding: 24px; padding-bottom: calc(24px + env(safe-area-inset-bottom));
  background: radial-gradient(120% 80% at 50% 0%, #2a1a4a 0%, #0e0a1f 60%, #07060f 100%);
  color: #f0eaff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
h1 {
  position: absolute; top: calc(18px + env(safe-area-inset-top)); left: 0; right: 0;
  text-align: center;
  font-size: clamp(13px, 3.5vw, 16px); font-weight: 500;
  color: #cfc3f0; letter-spacing: 3px; margin: 0; opacity: .7;
  pointer-events: none;
}

/* 两态共用 */
.page { display: flex; flex-direction: column; align-items: center; gap: 18px; width: 100%; max-width: 360px; }

/* 选择页:顶部音源下拉 + 两列圆按钮 */
.select-page { gap: 34px; }
.preset-grid {
  display: grid; grid-template-columns: repeat(2, auto);
  row-gap: 30px; column-gap: 22px; justify-content: center; justify-items: center; width: 100%;
}

/* 音源下拉框:V3 与圆块精确等宽(2×圆 + gap), 加存在感 */
.audio-picker {
  position: relative; width: 100%;
  max-width: calc(2 * clamp(108px, 30vw, 138px) + 22px);
}
.audio-chip {
  width: 100%; padding: 13px 18px; border: 1px solid rgba(255,255,255,.18);
  border-radius: 999px; background: rgba(255,255,255,.09); color: #f0eaff;
  font-size: 15px; letter-spacing: 1px; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 8px;
  backdrop-filter: blur(8px);
  transition: background .18s, border-color .18s;
}
.audio-chip:hover { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.2); }
.audio-chip .caret { opacity: .6; font-size: 12px; }

.dropdown-backdrop {
  position: fixed; inset: 0; z-index: 9;   /* 透明背板,点外关闭 */
}
.audio-dropdown {
  position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 10;
  margin: 0; padding: 6px; list-style: none;
  background: rgba(30,22,56,.95); border: 1px solid rgba(255,255,255,.12);
  border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.5);
  backdrop-filter: blur(10px);
  max-height: 240px; overflow-y: auto;     /* 固定高度,文件多则框内滚 */
  scrollbar-width: none;                   /* Firefox 隐藏滚动条 */
}
.audio-dropdown::-webkit-scrollbar { display: none; }  /* WebKit/Chromium 隐藏滚动条 */
.audio-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-radius: 9px; cursor: pointer;
  font-size: 14px; color: #cfc3f0;
  transition: background .15s, color .15s;
}
.audio-item:hover { background: rgba(255,255,255,.07); }
.audio-item.on { background: rgba(167,139,250,.2); color: #fff; }
.audio-item.loading { opacity: .6; cursor: progress; }
.audio-item .cache-ic { font-size: 14px; }
.audio-item .local-ic { color: #5ad19a; }                 /* 本地:绿,离线可用 */
.audio-item .cloud-ic { color: #9d8fc2; opacity: .85; }   /* 云端:需下载 */
.audio-item .loading-ic { color: #9d8fc2; }

/* 下拉开合过渡 */
.dropdown-enter-active, .dropdown-leave-active { transition: opacity .18s, transform .18s; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(-6px); }
.circle {
  width: clamp(108px, 30vw, 138px); aspect-ratio: 1; border: none; cursor: pointer;
  border-radius: 50%;
  background: rgba(255,255,255,.08); color: #f0eaff;
  font-size: clamp(15px, 4vw, 18px); letter-spacing: 1px;
  transition: background .18s, transform .12s;
  backdrop-filter: blur(8px);
}
.circle:hover:not(:disabled)  { background: rgba(255,255,255,.16); }
.circle:active:not(:disabled) { transform: scale(.95); }
.circle:disabled { opacity: .4; cursor: not-allowed; }

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

/* 自定义时长输入面板:径向圆盘选择器 */
.overlay {
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(7,6,15,.6); backdrop-filter: blur(4px);
  z-index: 10;
}
.custom-card {
  width: min(86vw, 320px);
  background: rgba(30,22,56,.92);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 20px; padding: 24px;
  display: flex; flex-direction: column; gap: 16px; align-items: center;
  box-shadow: 0 12px 48px rgba(0,0,0,.5);
}

/* 顶部大数字 H : M */
.big-display {
  display: flex; align-items: baseline; gap: 4px;
  font-size: clamp(48px, 14vw, 64px); font-weight: 200; line-height: 1;
  letter-spacing: 2px; color: #f0eaff;
  text-shadow: 0 0 32px rgba(167,139,250,.35);
}
.big-display .part { transition: color .18s, text-shadow .18s; color: #6f6390; }
.big-display .part.active { color: #f0eaff; }
.big-display .sep { color: #6f6390; }

/* 小时/分钟 切换标签 */
.stage-tabs { display: flex; gap: 8px; }
.stage-tabs .tab {
  border: 1px solid rgba(255,255,255,.12); background: transparent;
  color: #9d8fc2; cursor: pointer;
  padding: 5px 16px; border-radius: 999px; font-size: 13px; letter-spacing: 1px;
  transition: background .18s, color .18s, border-color .18s;
}
.stage-tabs .tab.on {
  background: rgba(167,139,250,.22); color: #fff; border-color: rgba(167,139,250,.6);
}

/* 圆盘 */
.disk-wrap {
  width: clamp(180px, 60vw, 240px); aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
  user-select: none; touch-action: none;
}
.disk { width: 100%; height: 100%; cursor: pointer; overflow: visible; }
.disk-num {
  fill: #cfc3f0; font-size: 20px; font-weight: 400;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  transition: fill .15s, font-weight .15s;
}
.disk-num.sel { fill: #fff; font-weight: 700; }
.pointer {
  stroke: #a78bfa; stroke-width: 2; stroke-linecap: round;
  /* 指针从圆心向"上"画到盘边:y 从 120 到 (120 - R) */
  transition: transform .12s ease-out;
}
.pointer-tip { transition: transform .12s ease-out; }
.tip-dot { fill: #a78bfa; }
.center-dot { fill: #a78bfa; }

.custom-go {
  width: 100%; padding: 12px 0; border: none; cursor: pointer;
  border-radius: 999px; font-size: 15px; letter-spacing: 1px; color: #fff;
  background: linear-gradient(135deg, #a78bfa, #7c5cff);
  box-shadow: 0 6px 24px rgba(124,92,255,.4);
  transition: transform .12s, opacity .18s;
}
.custom-go:active:not(:disabled) { transform: scale(.98); }
.custom-go:disabled { opacity: .4; cursor: not-allowed; }
</style>
