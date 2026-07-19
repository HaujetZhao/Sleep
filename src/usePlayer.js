import { ref, computed, onMounted, onUnmounted } from 'vue'
import { formatCountdown } from './countdown.js'
import { AUDIO_SOURCES } from './audio-sources.js'
import { audioBufferToWav } from './wav-encoder.js'

// ponytail: 最终方案 —— 淡变烤进 WAV + 双 <audio> 实例定时轮换。
// 播放时零 JS 控音量（精度无损、熄屏无忧），timeupdate 触发下一段（duration 自适应）。
// 暂停 = 原地保留最新段进度；继续 = 原地接播（非从头）。

const LS_KEY = 'rain:selected'   // localStorage 记忆上次选中的音源 key
const FADE = 5                  // 淡入淡出时长（秒，烤进 WAV）= 交接重叠时长

// ponytail: AudioContext 只借它做 decodeAudioData，不占音频图节点——模块级共享一个，永不 close。
// 早期每次 prepareOne 都 new+close，切 6 个音源就付 6 次硬件握手成本（移动端 Safari 尤敏感）。
let _audioCtx = null
const getAudioCtx = () => _audioCtx || (_audioCtx = new (window.AudioContext || window.webkitAudioContext)())

// 缓存态图标三态表。下拉项与胶囊共用，避免两处各写一份 v-if/v-else-if/v-else 导致文案/图标分叉。
// class 引用的 .cache-ic/.local-ic 等样式定义在 App.vue（i 元素渲染在 App.vue 模板，scoped 命中）。
const CACHE_ICON = {
  loading: { class: 'fa-solid fa-circle-notch fa-spin cache-ic loading-ic', title: '准备中' },
  local:   { class: 'fa-solid fa-circle-check cache-ic local-ic',           title: '已缓存到本地' },
  cloud:   { class: 'fa-solid fa-cloud cache-ic cloud-ic',                  title: '未缓存，点此下载到本地' },
}

export function usePlayer() {
  const ready = ref(false)
  const toast = ref('')

  // ---- 多音源选择 ----
  const preparingKey = ref(null)                     // 正在惰性烤制的 key（下拉项 loading 态）
  const selectedKey = ref(AUDIO_SOURCES[0].key)      // 当前选中；挂载时按 localStorage 覆盖
  const selectedName = computed(() =>
    AUDIO_SOURCES.find(a => a.key === selectedKey.value)?.name ?? ''
  )
  const blobCache = new Map()                        // key -> blobUrl（已烤制缓存）
  const cachedKeys = ref([])                         // 已烤制落盘的 key（驱动下拉项 云/本地 图标）

  // 缓存态三态：'loading'(烤制中) | 'local'(已落盘) | 'cloud'(未下载)。
  function cacheState(key) {
    if (preparingKey.value === key) return 'loading'
    if (cachedKeys.value.includes(key)) return 'local'
    return 'cloud'
  }

  // ---- 计时(墙钟驱动,与音频 timeupdate 交接完全独立)----
  const duration  = ref(null)   // ms;null = 无限
  const endTime   = ref(null)   // 运行中的结束时间戳(playing 态)
  const remaining = ref(null)   // 暂停冻结的剩余 ms
  const displayMs = ref(0)      // 当前显示用剩余 ms(playing 态由 tick 刷新)
  let countdownTimer = null

  let audioA = null, audioB = null
  let nextKey = 'a'
  let toastTimer = null

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

  // 把任意 URL 字符串规范化为可比较的 pathname。两边（cache 里的 Request.url 与 a.file）都过这一层，
  // 保证比对严格对称——任一边少一步就刷新后图标掉回云端（commit 91b9a8b 踩过的坑）。
  const normalizePath = urlStr => {
    try { return decodeURIComponent(new URL(urlStr, location.href).pathname) } catch { return '' }
  }
  // ponytail: 刷新后从 SW 的 Cache Storage 真实状态回填 cachedKeys，图标反映真实离线态而非内存态。
  // 缓存名 'sleep-audio' 来自 sw.js 里 .mp3 的 CacheFirst 路由（vite-plugin-pwa 生成）。
  // a.file 在 PWA 构建下是相对 './audio/...'（base:'./'），cache 里的 Request 是绝对 URL（'/audio/...' 或
  // 部署子路径 '/Sleep/audio/...'）——两边都过 normalizePath 到同一坐标系再比。
  async function syncCachedFromSW() {
    if (!('caches' in window)) return
    let cache
    try { cache = await caches.open('sleep-audio') } catch { return }
    const cached = new Set((await cache.keys()).map(r => normalizePath(r.url)))
    cachedKeys.value = AUDIO_SOURCES.filter(a => cached.has(normalizePath(a.file))).map(a => a.key)
  }

  // ---- 音频预处理：解码 → 前5s淡入/后5s淡出烤进振幅 → 编码 WAV → blob（按 key 缓存）----
  async function prepareOne(key) {
    if (blobCache.has(key)) return blobCache.get(key)
    const src = AUDIO_SOURCES.find(a => a.key === key).file
    const buf = await (await fetch(src)).arrayBuffer()
    const ab = await getAudioCtx().decodeAudioData(buf)

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

  // 切换当前音源的单一入口：惰性烤制 → 绑定双实例 → 更新通知栏曲名，preparingKey 包夹其间。
  // onMounted 初始化与 selectAudio 都走这里，三步不散落、不漏 updateMediaMetadata。
  async function changeAudio(key) {
    preparingKey.value = key
    await prepareOne(key)
    bindAudio(key)
    updateMediaMetadata()
    preparingKey.value = null
  }

  async function selectAudio(key) {       // idle 页下拉选中一项：切源 + 记忆 + 惰性烤制
    if (key === selectedKey.value) return
    selectedKey.value = key
    localStorage.setItem(LS_KEY, key)
    await changeAudio(key)
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
    if (keep.readyState >= 2) playSeg(keep)
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

  // 启动一段 audio，统一处理 autoplay policy 拦截（蓝牙/锁屏后首次播放可能被浏览器拒）。
  function playSeg(el) {
    el.play().catch(() => showToast('播放被拦截，请点击页面按钮'))
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
    const ms = Math.max(0, left)
    if (ms !== displayMs.value) displayMs.value = ms   // 仅变化时写，避免每 250ms 无谓触发响应式
    if (left <= 0) { showToast('时间到'); stop() }
  }

  function tick() {
    if (state.value !== STATE.PLAYING) return
    const el = nextKey === 'a' ? audioA : audioB
    el.currentTime = 0
    playSeg(el)
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
  // 通知栏/锁屏曲名随选中音源更新（修早期 title 硬编码 'Heavy Rain' 遗留）。
  function updateMediaMetadata() {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: selectedName.value, artist: 'Sleep', album: '助眠'
    })
  }
  // 一次性注册外部媒体键 handler。状态同步由 start/pause/resume/stop 核心函数内部调 syncPlaybackState 完成，
  // handler 不再重复调——否则每次外部键触发都同步两遍，且改同步逻辑要在多处分散改。
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return
    updateMediaMetadata()
    const onPlay  = () => {
      if (state.value === STATE.PAUSED) resume(); else if (state.value === STATE.IDLE) start()
      showToast(playing.value ? '已继续' : '')
    }
    const onPause = () => {
      if (playing.value) { pause(); showToast('已暂停') }
    }
    const onStop = () => { stop(); showToast('已结束') }
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

  onMounted(async () => {
    syncCachedFromSW()   // 不 await：与下方 prepare 并行，回填后图标响应式更新
    const saved = localStorage.getItem(LS_KEY)
    const initial = AUDIO_SOURCES.some(a => a.key === saved) ? saved : AUDIO_SOURCES[0].key
    selectedKey.value = initial
    await changeAudio(initial)
    ready.value = true
    setupMediaSession()
  })
  onUnmounted(stop)

  return {
    // 展示态
    ready, state, playing, countdownText, toast,
    selectedKey, selectedName, preparingKey, cachedKeys,
    cacheState, CACHE_ICON,
    // 动作
    toggle, selectDuration, selectAudio, stop,
  }
}
