<script setup>
import { ref } from 'vue'
import { PRESETS } from './countdown.js'
import { AUDIO_SOURCES } from './audio-sources.js'
import { usePlayer } from './usePlayer.js'
import CustomDurationPicker from './components/CustomDurationPicker.vue'

// App.vue 只做 UI 编排：选择页/播放页的展示与切换、下拉/面板开关。
// 播放引擎（双 audio 轮换、烤 WAV、倒计时、Media Session、缓存态）全在 usePlayer composable。
// 自定义时长圆盘选择器是独立组件 CustomDurationPicker。

const audioOpen = ref(false)          // 音源下拉框开合
const customOpen = ref(false)         // 自定义时长面板开合

const {
  ready, state, playing, countdownText, toast,
  selectedKey, selectedName, preparingKey, cachedKeys,
  cacheState, CACHE_ICON,
  toggle, selectDuration, selectAudio, stop,
} = usePlayer()

function onPreset(p) {                 // 选择页按钮分发:自定义开面板,其余直接启动
  if (p.key === 'custom') { audioOpen.value = false; customOpen.value = true; return }
  selectDuration(p.ms)
}
function onSelectAudio(key) {          // 下拉选中:关下拉 + 切源(同 key 时 usePlayer 内部短路)
  audioOpen.value = false
  selectAudio(key)
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
            <!-- 缓存态图标:与下拉项同款,反映当前选中音源的真实离线态 -->
            <i v-bind="CACHE_ICON[cacheState(selectedKey)]"></i>
          </button>
          <div v-if="audioOpen" class="dropdown-backdrop" @click="audioOpen = false"></div>
          <Transition name="dropdown">
            <ul v-if="audioOpen" class="audio-dropdown">
              <li
                v-for="a in AUDIO_SOURCES" :key="a.key"
                :class="['audio-item', { on: a.key === selectedKey, loading: preparingKey === a.key }]"
                @click="onSelectAudio(a.key)"
              >
                <span class="audio-item-name">{{ a.name }}</span>
                <!-- 缓存态图标:云端=未下载(点一下即下载)/本地=已落盘可离线/旋转=正在烤制 -->
                <i v-bind="CACHE_ICON[cacheState(a.key)]"></i>
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
        <div class="status">{{ (playing ? '播放中' : '已暂停') + '：' + selectedName }}</div>
        <div class="controls">
          <button class="btn ghost" @click="stop" aria-label="返回选择页">
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

    <CustomDurationPicker v-model:open="customOpen" @confirm="selectDuration" />
  </main>
</template>

<style scoped>
:root { color-scheme: dark; }
main {
  position: relative;
  min-height: 100%;            /* 不用 vh/dvh——锁死 #app 视口高度,免受下拉刷新过滚动脱钩影响 */
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

/* 音源下拉框:与圆块精确等宽(2×圆 + gap), 加存在感 */
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

.dropdown-backdrop { position: fixed; inset: 0; z-index: 9; }   /* 透明背板,点外关闭 */
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
.cache-ic { font-size: 14px; }
.local-ic { color: #5ad19a; }                 /* 本地:绿,离线可用 */
.cloud-ic { color: #9d8fc2; opacity: .85; }   /* 云端:需下载 */
.loading-ic { color: #9d8fc2; }

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
</style>
