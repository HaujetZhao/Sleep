<script setup>
import { ref, computed, watch } from 'vue'

// 径向圆盘时长选择器：两段式（先小时后分钟），SVG 圆盘 + Pointer Events。
// 对外：v-model:open 控制显隐；emit('confirm', ms) 吐出总毫秒数。每次打开自动重置到小时态。

const props = defineProps({ open: Boolean })
const emit = defineEmits(['update:open', 'confirm'])

const customH = ref(0)
const customM = ref(30)
const totalMinutes = computed(() => customH.value * 60 + customM.value)
const customValid = computed(() => totalMinutes.value > 0)
const stage = ref('h')                    // 'h' = 选小时, 'm' = 选分钟

watch(() => props.open, v => { if (v) stage.value = 'h' })   // 打开即重置到小时态

// 圆盘:0° 在顶(正上方),顺时针,每 30° 一个数字。两盘视觉同款,12 个数字均匀分布。
const DISK_R = 100                         // SVG 内部坐标系半径(viewBox 0 0 240 240,圆心 120,120)
const DISK_C = 120
const HOUR_NUMS  = Array.from({ length: 12 }, (_, i) => i)             // 0..11
const MIN_NUMS   = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]      // 5 分锚点

// 数字在圆盘上的位置(角度 = value*30°,0° 在顶,顺时针;屏幕坐标 y 向下,故用 -90° 偏移)
function diskPos(value) {
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
const diskNumbers = computed(() =>
  stage.value === 'h'
    ? HOUR_NUMS.map(v => ({ v, pos: diskPos(v),       label: String(v) }))
    : MIN_NUMS .map(v => ({ v, pos: diskPos(v / 5),   label: String(v) }))  // 5 分锚点占每 30° 槽
)
const diskSelected = computed(() => stage.value === 'h' ? customH.value : customM.value)
const bigH = computed(() => String(customH.value).padStart(2, '0'))
const bigM = computed(() => String(customM.value).padStart(2, '0'))

// Pointer Events:按下→拖动→释放,统一走 atan2 角度→值映射(tap 与 drag 同映射)
let dragging = false
const svgRef = ref(null)

function pointAngle(e) {
  const svg = svgRef.value
  if (!svg) return 0
  const rect = svg.getBoundingClientRect()
  const scale = rect.width / 240          // 屏幕像素映射回 viewBox 0..240
  const x = (e.clientX - rect.left) / scale - DISK_C
  const y = (e.clientY - rect.top)  / scale - DISK_C
  let deg = Math.atan2(y, x) * 180 / Math.PI   // atan2:0° 在 +x(右),顺时针为正
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
  if (stage.value === 'h') stage.value = 'm'   // 释放后:小时态自动切分钟态
}
function switchStage(s) { stage.value = s }

function close() { emit('update:open', false) }
function confirm() {
  if (!customValid.value) return
  emit('confirm', totalMinutes.value * 60_000)
  close()
}
</script>

<template>
  <Transition name="overlay-fade">
    <div v-if="open" class="overlay" @click.self="close">
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
            <!-- 指针:从圆心指向"正上方"盘边,再用 transform rotate 到当前角度 -->
            <line
              :x1="DISK_C" :y1="DISK_C"
              :x2="DISK_C" :y2="DISK_C - DISK_R"
              class="pointer"
              :style="{ transform: `rotate(${pointerAngle}deg)`, transformOrigin: `${DISK_C}px ${DISK_C}px` }"
            />
            <!-- 指针末端圆盘(随指针旋转,放大;放数字前渲染,数字叠在其上,呈"大圆盘托数字") -->
            <g
              class="pointer-tip"
              :style="{ transform: `rotate(${pointerAngle}deg)`, transformOrigin: `${DISK_C}px ${DISK_C}px` }"
            >
              <circle :cx="DISK_C" :cy="DISK_C - DISK_R" r="14" class="tip-disk"/>
            </g>
            <!-- 12 个数字 -->
            <text
              v-for="n in diskNumbers" :key="stage + '-' + n.v"
              :x="n.pos.x" :y="n.pos.y"
              :class="['disk-num', { sel: n.v === diskSelected }]"
              text-anchor="middle" dominant-baseline="central"
            >{{ n.label }}</text>
            <!-- 圆心小圆点 -->
            <circle :cx="DISK_C" :cy="DISK_C" r="6" class="center-dot"/>
          </svg>
        </div>

        <!-- 开始按钮 -->
        <button class="custom-go" :disabled="!customValid" @click="confirm">开始</button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
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
  transition: transform .12s ease-out;
}
.pointer-tip { transition: transform .12s ease-out; }
.tip-disk { fill: #a78bfa; }
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

.overlay-fade-enter-active, .overlay-fade-leave-active { transition: opacity .28s; }
.overlay-fade-enter-from, .overlay-fade-leave-to { opacity: 0; }
</style>
