# 时长预设 + 两态切换 UI 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已打通的循环播放之上,加"选时长即开播 + 大倒计时"交互,并把页面改成两态切换(选择页 / 播放页)的毛玻璃光晕 UI;倒计时归零直接停止回选择页。

**Architecture:** 计时与音频两套独立机制并行——音频交接继续靠现有 `timeupdate` 驱动,倒计时靠墙钟(`endTime = Date.now() + duration`)驱动,250ms `setInterval` 仅刷新显示与检测归零。暂停冻结 `remaining`,继续按墙钟重算 `endTime`。视图按 `state` 在选择页(idle)与播放页(playing/paused)间切换。

**Tech Stack:** Vue 3 `<script setup>`、原生 `<audio>`、Web Audio(仅预处理)、CSS(毛玻璃 + 渐变 + clamp 响应式)。

对应 spec:[docs/superpowers/specs/2026-07-19-duration-presets-ui-design.md](../specs/2026-07-19-duration-presets-ui-design.md)

---

## 文件结构

- **新建** `src/countdown.js` — 纯函数 `formatCountdown(ms)` 与时长预设常量 `PRESETS`,带可独立 `node` 运行的自检。
- **改写** `src/App.vue` — 加计时状态/倒计时 tick/两态模板/毛玻璃样式;`<script setup>` import `countdown.js`。

`countdown.js` 抽出来是为了让 `formatCountdown` 这个唯一有分支的纯逻辑可独立自检(spec 原说"只改 App.vue",这里为可测性抽一个最小模块,其余仍在 App.vue)。

---

## Task 1: 倒计时格式化纯函数 + 自检

**Files:**
- Create: `src/countdown.js`

- [ ] **Step 1: 新建 `src/countdown.js`,写入格式化函数、预设常量、自检**

```js
// 倒计时工具:纯函数 + 预设时长。抽出来便于独立自检。

export const PRESETS = [
  { key: '30m', label: '30 分钟', ms: 30 * 60_000 },
  { key: '1h',  label: '1 小时', ms: 60 * 60_000 },
  { key: '2h',  label: '2 小时', ms: 120 * 60_000 },
  { key: 'inf', label: '无限',   ms: null },
]

// ms → 倒计时字符串。≥1 小时用 H:MM:SS,否则 M:SS。向上取整到秒。
export function formatCountdown(ms) {
  if (ms < 0) ms = 0
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = n => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

// ponytail: 一个可运行自检 —— node src/countdown.js 直接跑,断言挂了就抛。
if (import.meta.url === undefined) {
  // 被 node 直射运行(无 import.meta.url)时跑自检;Vite 打包时跳过。
  const assert = (got, want) => { if (got !== want) throw new Error(`want ${want} got ${got}`) }
  assert(formatCountdown(0),               '0:00')
  assert(formatCountdown(29 * 60_000),     '29:00')
  assert(formatCountdown(30 * 60_000),     '30:00')
  assert(formatCountdown(60 * 60_000),     '1:00:00')
  assert(formatCountdown(120 * 60_000),    '2:00:00')
  assert(formatCountdown(2 * 60_000 + 500),'2:01')   // 向上取整
  console.log('countdown.js self-check OK')
}
```

> 说明:`import.meta.url === undefined` 在 Node CJS 直射运行时为真(Vite/ESM 环境下 `import.meta.url` 是字符串),所以自检只在 `node src/countdown.js` 时触发,不影响打包。

- [ ] **Step 2: 运行自检验证通过**

Run: `node src/countdown.js`
Expected: 输出 `countdown.js self-check OK`,无异常。

- [ ] **Step 3: 提交**

```bash
git add src/countdown.js
git commit -m "feat: 倒计时格式化纯函数 + 自检"
```

---

## Task 2: App.vue 计时状态 + 选时长开播 + 倒计时 tick + 归零停

**Files:**
- Modify: `src/App.vue`(`<script setup>` 部分)

- [ ] **Step 1: 顶部 import 处加上 countdown.js**

把 [src/App.vue:2](src/App.vue#L2) 的 import 行替换为:

```js
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { PRESETS, formatCountdown } from './countdown.js'
```

- [ ] **Step 2: 在 `const toast = ref('')` 之后(约 [src/App.vue:12](src/App.vue#L12) 下方)加计时状态**

```js
// ---- 计时(墙钟驱动,与音频 timeupdate 交接完全独立)----
const duration  = ref(null)   // ms;null = 无限
const endTime   = ref(null)   // 运行中的结束时间戳(playing 态)
const remaining = ref(null)   // 暂停冻结的剩余 ms
const displayMs = ref(0)      // 当前显示用剩余 ms(playing 态由 tick 刷新)
let countdownTimer = null
```

- [ ] **Step 3: 在 `resetBoth()` 之后(约 [src/App.vue:122](src/App.vue#L122) 下方)加倒计时 tick 三件套**

```js
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
```

- [ ] **Step 4: 加 `selectDuration`(放在 `start()` 之后,约 [src/App.vue:94](src/App.vue#L94) 下方)**

```js
function selectDuration(ms) {        // ms === null = 无限
  if (!ready.value) return
  duration.value = ms
  start()                            // 复用现有音频启动:resetBoth → playing → tick()
  if (ms != null) { endTime.value = Date.now() + ms; startCountdown() }
}
```

- [ ] **Step 5: 扩展 `stop()`,清计时状态(替换 [src/App.vue:114-117](src/App.vue#L114-L117) 的 `stop`)**

```js
function stop() {                    // 彻底停:回选择页 / 卸载 / 倒计时归零 / 蓝牙 stop
  state.value = STATE.IDLE
  resetBoth()
  stopCountdown()
  duration.value = null
  endTime.value = null
  remaining.value = null
  syncPlaybackState()
}
```

- [ ] **Step 6: 加 `countdownText` 计算属性(放在 `const playing = computed(...)` 之后,约 [src/App.vue:79](src/App.vue#L79) 下方)**

```js
const countdownText = computed(() => {
  if (!duration.value) return '∞'
  const ms = state.value === STATE.PAUSED ? remaining.value : displayMs.value
  return formatCountdown(ms ?? 0)
})
```

- [ ] **Step 7: dev server 手动核对(无 UI 还没接,先确保编译不报错)**

Run: `npm run dev`,浏览器打开,控制台无报错(界面此时仍是旧的,Task 5 才换模板)。
Expected: 页面正常加载,控制台干净。

- [ ] **Step 8: 提交**

```bash
git add src/App.vue
git commit -m "feat: 计时状态 + 选时长开播 + 墙钟倒计时 tick + 归零停"
```

---

## Task 3: 暂停冻结 / 继续重算 remaining

**Files:**
- Modify: `src/App.vue`(`pause()`、`resume()`)

- [ ] **Step 1: 替换 `pause()`(替换 [src/App.vue:96-104](src/App.vue#L96-L104))**

```js
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
```

- [ ] **Step 2: 替换 `resume()`(替换 [src/App.vue:106-112](src/App.vue#L106-L112))**

```js
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
```

- [ ] **Step 3: dev server 手动核对编译**

Run: `npm run dev`,控制台无报错。
Expected: 无异常(完整功能验收留到 Task 7)。

- [ ] **Step 4: 提交**

```bash
git add src/App.vue
git commit -m "feat: 暂停冻结 remaining / 继续墙钟重算 endTime"
```

---

## Task 4: 返回键 + 蓝牙 stop 改走 stop()

**Files:**
- Modify: `src/App.vue`(`goBack`、`setupMediaSession`)

- [ ] **Step 1: 加 `goBack`(放在 `stop()` 下方)**

```js
function goBack() {                   // 播放页"返回"键:停拔回选择页
  stop()
}
```

> 单行包装,留作语义入口(以后选声音也走它);现在直接复用 `stop()`。

- [ ] **Step 2: 改 `setupMediaSession` 的 `stop` handler(替换 [src/App.vue:150-168](src/App.vue#L150-L168) 中的 `stop` 映射行)**

把这一行:

```js
  navigator.mediaSession.setActionHandler('stop',      onPause)
```

替换为(新增 `onStop`,并把 `stop` 指过去):

```js
  const onStop = () => { stop(); showToast('已结束'); syncPlaybackState() }
  navigator.mediaSession.setActionHandler('stop',      onStop)
```

- [ ] **Step 3: dev server 手动核对编译**

Run: `npm run dev`,控制台无报错。
Expected: 无异常。

- [ ] **Step 4: 提交**

```bash
git add src/App.vue
git commit -m "feat: 返回键 + 蓝牙 stop 走彻底停止"
```

---

## Task 5: 两态模板 + Transition

**Files:**
- Modify: `src/App.vue`(`<template>` 整段替换)

- [ ] **Step 1: 替换整个 `<template>`(替换 [src/App.vue:178-194](src/App.vue#L178-L194))**

```html
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
          <button class="btn ghost" @click="goBack" aria-label="返回选择页">↩</button>
          <button class="btn main"  @click="toggle" aria-label="暂停或继续">{{ playing ? '⏸' : '▶' }}</button>
        </div>
      </section>
    </Transition>
    <Transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </main>
</template>
```

> `toggle()` 在播放页只在 playing/paused 间切(idle 分支触不到,因播放页不展示于 idle 态)。`PRESETS` 与 `selectDuration` 来自 Task 2。

- [ ] **Step 2: dev server 手动核对**

Run: `npm run dev`,打开页面。
Expected: 进入即看到 4 个时长按钮(无样式,Task 6 才美化);点「30 分钟」后切换到倒计时 + 两按钮视图(同样未美化)。功能跑通。

- [ ] **Step 3: 提交**

```bash
git add src/App.vue
git commit -m "feat: 两态切换模板(选择页 / 播放页)"
```

---

## Task 6: 毛玻璃光晕样式 + 响应式

**Files:**
- Modify: `src/App.vue`(`<style scoped>` 整段替换)

- [ ] **Step 1: 替换整个 `<style scoped>`(替换 [src/App.vue:196-220](src/App.vue#L196-L220))**

```css
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
  transition: transform .12s, background .18s, opacity .18s;
}
.btn:active { transform: scale(.94); }
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
```

- [ ] **Step 2: dev server 浏览器核对(客观项)**

Run: `npm run dev`,DevTools 确认:
- 背景为紫色径向渐变。
- 时长按钮为半透明胶囊,`backdrop-filter: blur` 生效(computed style 非空)。
- 倒计时为大号细体;暂停键紫色渐变。
- 控制台无报错。
Expected: 上述全部成立。

- [ ] **Step 3: 提交**

```bash
git add src/App.vue
git commit -m "style: 毛玻璃光晕 + clamp 响应式"
```

---

## Task 7: 交用户主观体验验收

**Files:** 无代码改动,把验收清单交给用户本人(按 CLAUDE.md:UI 主观体验由用户上手判断,不派子代理用 Playwright 点)。

- [ ] **Step 1: 在浏览器(含手机同 WiFi)上把下列清单走一遍**

清单(逐条反馈给用户结论):
1. 进来即选择页(4 个时长按钮),无倒计时、无暂停键。
2. 点「30 分钟」→ 淡入切换到播放页,显示 `30:00` 并开始跳秒。
3. 点「无限」→ 播放页显示 `∞`,无跳秒、持续循环。
4. 暂停键 → 倒计时冻结、音频原地停;再点 → 倒计时从冻结处继续、音频接播。
5. 「↩ 返回」→ 停播、淡回选择页。
6. 播放中切到「1 小时」需要先返回(spec 两态结构:播放页无时长按钮)。
7. 蓝牙耳机播放/暂停键 → 原地暂停/继续;stop 键 → 彻底停、回选择页。
8. 熄屏一段时间回来 → 倒计时按墙钟正确(可设 30 秒临时验证:把 `selectDuration` 里 `Date.now() + ms` 临时改成 `+ 30_000` 验证归零回选择页,验完改回)。
9. 手机端布局不溢出、按钮可点区足够。
10. 两态淡入淡出过渡手感是否可接受。

- [ ] **Step 2: 收集用户反馈,有问题回到对应 Task 修;全过则收尾**

---

## Self-Review 结果

- **Spec 覆盖**:到点直接停(Task2 步骤3/5)、显示倒计时(Task2 步骤6)、点时长即开播(Task2 步骤4)、毛玻璃光晕(Task6)、两态切换(Task5)、播放页两键(Task5)、暂停冻结/继续重算(Task3)、返回键 + 蓝牙 stop(Task4)、不做的事(YAGNI 全程未引入)——逐条对应。
- **占位符**:无 TBD/TODO,每步含完整代码。
- **命名一致**:`selectDuration` / `startCountdown` / `stopCountdown` / `onCountdownTick` / `countdownText` / `goBack` 全程一致;不与音频侧现有 `tick()` / `toggle()` / `start()` / `stop()` 冲突。
- **类型一致**:`duration/endTime/remaining` 为 `ref`,Task2 声明、Task3/4 使用一致;`null` 语义(无限 / 未运行)统一。
