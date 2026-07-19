# 多音源选择 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** idle 页加一个下拉框，在多个内置音频间选择；点播放后进入播放页，播放中不切换音源。

**Architecture:** 新建 `src/audio-sources.js` 维护音源清单数组（加音频 = 丢 mp3 进 `public/audio/` + 加一行）。`App.vue` 把单一 `SRC`/`blobUrl` 改为 `selectedKey` + `blobCache: Map`；`prepare()` 拆成 `prepareOne(key)`（烤制进缓存）+ `bindAudio(key)`（把 `audioA/B.src` 指向当前选中音源的 blob）；挂载时按 localStorage 记忆恢复 `selectedKey` 并预烤一项。播放/轮换/暂停核心零改动——`start()` 取已绑定的 `audioA/B` 即可。

**Tech Stack:** Vue 3 (`<script setup>`)、Vite、原生 `<audio>`、Web Audio（仅用于烤淡变）、localStorage。无测试框架——纯数据文件按既有 `countdown.js` 模式加 node 自检，SFC 改动用机械核对 + 用户主观验收。

**Spec:** `docs/superpowers/specs/2026-07-19-multi-audio-selection-design.md`

---

## 文件结构

| 文件 | 责任 | 动作 |
|---|---|---|
| `public/audio/test-15s.mp3` | 音源（原 `public/test-15s.mp3`） | 移动 |
| `public/audio/full-rain.mp3` | 音源（原 `public/full-rain.mp3`） | 移动 |
| `src/audio-sources.js` | 音源清单数组 + node 自检 | 新建 |
| `src/App.vue` | 接入清单、prepare 重构、选中/缓存、idle 页 chip+下拉 UI | 修改 |
| `public/test-15s.mp3`、`public/full-rain.mp3`（原位置） | — | 删除（随移动消失） |

---

### Task 1: 移动音频文件 + 新建音源清单（带自检）

**Files:**
- Move: `public/test-15s.mp3` → `public/audio/test-15s.mp3`
- Move: `public/full-rain.mp3` → `public/audio/full-rain.mp3`
- Create: `src/audio-sources.js`

- [ ] **Step 1: 用 git mv 移动两个音频（保留历史，自动建 `public/audio/`）**

Run（在项目根 `D:/Users/Haujet/Desktop/Rain`）:
```bash
git mv public/test-15s.mp3 public/audio/test-15s.mp3
git mv public/full-rain.mp3 public/audio/full-rain.mp3
```
Expected: 无输出，`git status` 显示两个 renamed。

- [ ] **Step 2: 新建 `src/audio-sources.js`**

```js
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
```

- [ ] **Step 3: 跑自检验证通过**

Run: `node src/audio-sources.js`
Expected: `audio-sources 自检通过: 2 个音源`

- [ ] **Step 4: Commit**

```bash
git add public/audio src/audio-sources.js
git commit -m "feat: 音源挪入 public/audio 并新增清单 audio-sources.js"
```

---

### Task 2: App.vue 改造 —— 清单接入、prepare 拆分、选中与缓存

**Files:**
- Modify: `src/App.vue`（`<script setup>` 区段）

- [ ] **Step 1: 替换 import 与顶部常量**

把 [App.vue:2-3](src/App.vue#L2-L3) 这两行：
```js
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { PRESETS, formatCountdown } from './countdown.js'
```
改为：
```js
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { PRESETS, formatCountdown } from './countdown.js'
import { AUDIO_SOURCES } from './audio-sources.js'
```

把 [App.vue:9](src/App.vue#L9) 这一行：
```js
const SRC = '/test-15s.mp3'
```
改为：
```js
const LS_KEY = 'rain:selected'   // localStorage 记忆上次选中的音源 key
```

- [ ] **Step 2: 在 `ready`/`toast` 附近加选中/缓存状态**

把 [App.vue:12-13](src/App.vue#L12-L13)：
```js
const ready = ref(false)
const toast = ref('')
```
改为：
```js
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
```

- [ ] **Step 3: 把 `let blobUrl = null` 一行删掉**

[App.vue:118](src/App.vue#L118) 的 `let blobUrl = null` 删除（不再用单一 blobUrl，改由 `blobCache` + `bindAudio` 管理）。保留其下的 `let audioA = null, audioB = null` 等。

- [ ] **Step 4: 用 `prepareOne` + `bindAudio` 替换 `prepare`**

把 [App.vue:126-151](src/App.vue#L126-L151) 整个 `prepare` 函数替换为：

```js
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
      const g = i / fadeSamples
      d[i] *= g            // 开头淡入
      d[len - 1 - i] *= g  // 结尾淡出
    }
  }
  const url = URL.createObjectURL(new Blob([audioBufferToWav(ab)], { type: 'audio/wav' }))
  blobCache.set(key, url)
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
```

> 说明：原 `prepare` 里 `audioA.loop = audioB.loop = false` 与 `setupMediaSession()` 调用已并入下方挂载逻辑；`ready.value = true` 也挪到挂载处。

- [ ] **Step 5: 改 `onMounted` 为恢复记忆 + 预烤选中项**

把 [App.vue:123](src/App.vue#L123) 的 `onMounted(prepare)` 改为：

```js
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
```

- [ ] **Step 6: 在 `onPreset` 附近加 `selectAudio`**

在 [App.vue:216](src/App.vue#L216)（`onPreset` 函数之后、`confirmCustom` 之前或之后均可）插入：

```js
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
```

- [ ] **Step 7: 机械核对 —— 编译通过、控制台无错**

Run: `npm run dev`（在项目根），浏览器打开 dev URL。
Expected: 页面正常显示 idle 页（此刻还没有下拉 UI，Task 3 才加），控制台**无报错**，音频能正常烤制播放（点预设按钮能出声——证明 `prepareOne` + `bindAudio` 接通了播放核心）。

- [ ] **Step 8: Commit**

```bash
git add src/App.vue
git commit -m "feat: prepare 拆为 prepareOne+缓存,支持多音源选中与惰性烤制"
```

---

### Task 3: App.vue 改造 —— idle 页下拉框 UI 与样式

**Files:**
- Modify: `src/App.vue`（template + `<style scoped>`）

- [ ] **Step 1: 改 idle 选择页结构，加 chip + 下拉**

把 [App.vue:342-347](src/App.vue#L342-L347)：
```html
<section v-if="state === 'idle'" key="select" class="page select">
  <button
    v-for="p in PRESETS" :key="p.key" class="circle"
    :disabled="!ready" @click="onPreset(p)"
  >{{ p.label }}</button>
</section>
```
替换为：
```html
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
          <span v-if="a.key === selectedKey && preparingKey !== a.key" class="chk">✓</span>
          <span v-if="preparingKey === a.key" class="loading-txt">准备中…</span>
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
```

- [ ] **Step 2: 替换 `.select` 样式为 `.select-page` + 下拉样式**

把 [App.vue:452-456](src/App.vue#L452-L456)：
```css
/* 选择页:两列圆按钮 */
.select {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 18px; justify-items: center;
}
```
替换为：
```css
/* 选择页:顶部音源下拉 + 两列圆按钮 */
.select-page { gap: 22px; }
.preset-grid {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 18px; justify-items: center; width: 100%;
}

/* 音源下拉框 */
.audio-picker { position: relative; width: 100%; max-width: 240px; }
.audio-chip {
  width: 100%; padding: 11px 18px; border: 1px solid rgba(255,255,255,.12);
  border-radius: 999px; background: rgba(255,255,255,.06); color: #f0eaff;
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
}
.audio-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-radius: 9px; cursor: pointer;
  font-size: 14px; color: #cfc3f0;
  transition: background .15s, color .15s;
}
.audio-item:hover { background: rgba(255,255,255,.07); }
.audio-item.on { background: rgba(167,139,250,.2); color: #fff; }
.audio-item.loading { opacity: .6; cursor: progress; }
.audio-item .chk { color: #a78bfa; font-size: 13px; }
.audio-item .loading-txt { font-size: 12px; color: #9d8fc2; }

/* 下拉开合过渡 */
.dropdown-enter-active, .dropdown-leave-active { transition: opacity .18s, transform .18s; }
.dropdown-enter-from, .dropdown-leave-to { opacity: 0; transform: translateY(-6px); }
```

- [ ] **Step 3: 机械核对 —— DOM / 样式 / 控制台**

在 dev 浏览器（devtools）：
1. idle 页顶部出现 chip，显示 `test-15s`（或上次记忆项）。
2. 点 chip → 下拉展开，含两项 `test-15s` / `full-rain`，当前项高亮 + `✓`。
3. 下拉 DOM 的 computed `max-height` = `240px`、`overflow-y` = `auto`。
4. 点 `full-rain` → 下拉关闭，chip 变 `full-rain`；切换瞬间若未烤过，该项曾显示「准备中…」（短切片可能一闪而过）。
5. 控制台无报错；点预设按钮播放，听感为切换后的音源。
6. 刷新页面 → chip 仍为上次选择（localStorage 生效）。

- [ ] **Step 4: Commit**

```bash
git add src/App.vue
git commit -m "feat: idle 页加音源下拉框(chip+固定高度滚动列表)"
```

---

### Task 4: 用户主观验收

> CLAUDE.md 约定：UI 主观体验由用户本人在浏览器上手判断。子代理不做 Playwright 体验验收。

- [ ] **Step 1: 列出验收点交给用户**

在 idle 页（dev 或手机端同 WiFi 访问 Network URL）逐项上手：

1. **下拉开合手感**：chip 点击响应、开合过渡顺滑。
2. **滚动**：当前两项不满 240px 不滚；将来音频多了，列表在框内上下滚动是否顺滑。
3. **选中反馈**：点一项后高亮 + ✓、chip 文字更新、下拉关闭，体感是否自然。
4. **视觉风格**：chip / 下拉与现有「自定义时长」overlay 的圆角、半透明、模糊、紫色高亮是否统一。
5. **首次切换等待**：切到一个没烤过的音源时「准备中…」是否可接受（短切片应近瞬时）。
6. **播放听感**：分别选两个音源点播放，确认循环/淡变/暂停继续都正常（核心未动，应无回归）。
7. **记忆**：刷新后回到上次音源。
8. **高度**：下拉框 240px 是否合适（你说过看了再调）。

- [ ] **Step 2: 按用户反馈微调**（高度、间距、过渡时长等纯样式参数；若有逻辑问题回到对应 Task 修）

---

## Self-Review

**Spec 覆盖：**
- 数据来源（清单数组）→ Task 1 ✓
- `public/audio/` 移入两文件 → Task 1 ✓
- 状态 `selectedKey`/`audioOpen`/`blobCache`/`preparingKey` + localStorage → Task 2 ✓
- `prepare` 拆 `prepareOne`+缓存、挂载预烤选中项、惰性烤制 → Task 2 ✓
- `start()` 不改、`bindAudio` 绑定 blob → Task 2（核心零侵入已落实）✓
- idle 页 chip + 固定高度滚动下拉、纯文字、选中高亮 ✓ → Task 3 ✓
- 现代化样式统一 → Task 3 ✓
- YAGNI（无图标/试听/运行时切换）→ 全程未引入 ✓
- 验收（机械 + 主观）→ Task 3 Step 3 + Task 4 ✓

**占位符扫描：** 无 TBD/TODO，每个代码步骤含完整代码。

**类型/命名一致性：** `prepareOne`、`bindAudio`、`selectAudio`、`selectedKey`、`selectedName`、`audioOpen`、`preparingKey`、`blobCache`、`LS_KEY`、`AUDIO_SOURCES` 在各 Task 间一致；`a.key`/`a.name`/`a.file` 与 Task 1 清单字段一致。
