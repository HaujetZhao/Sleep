# 多音源选择 · 设计稿

日期：2026-07-19
分支：feat/duration-presets-ui

## 目标

idle（选时长）页支持在多个内置音频之间选择；点播放后进入播放页，**播放过程中不切换音源**。先把现有的两个测试文件（`test-15s.mp3`、`full-rain.mp3`）纳入选择体系，后续可零改码地持续追加音频。

## 非目标（YAGNI）

- 不做试听、不做图标、不做音源描述/时长显示（用户明确要纯文字选项）。
- 不做播放中运行时切换 / 跨音源交叉淡变（播放中不切）。
- 不做多音源混音 / 音量调节。
- 不做内置音源的远端下载（纯本地内置）。

## 现状（改造前提）

- `App.vue`：`const SRC = '/test-15s.mp3'` 写死。
- `onMounted(prepare)`：fetch SRC → decode → 前 5s 淡入 / 后 5s 淡出烤进振幅 → 手写 WAV 编码 → `blobUrl`。
- `audioA`、`audioB` 两个 `<audio>` 实例都指向同一 `blobUrl`，`loop=false`，timeupdate 触发轮换。
- 播放 / 轮换 / 暂停-继续 / Media Session 全部围绕 `blobUrl` 运转，**不关心 blobUrl 从哪来**。

→ 多音源改造可做到对播放核心零侵入，只改「blobUrl 的来源」和「prepare 的触发时机」。

## 数据来源

- 新建 `public/audio/`，`test-15s.mp3` 与 `full-rain.mp3` 挪入其中（消除孤儿文件，清单统一）。
- 清单由 **Vite `import.meta.glob`** 在构建期自动扫描 `public/audio/*.mp3` 生成：
  - 这样后续加音频 = 只丢文件、零改代码（契合「会陆续加尝试性音频」）。
  - 选项 `name` = 文件名去后缀（如 `full-rain`）。
  - `key` = 文件名（含后缀，稳定唯一）。
  - 排序按文件名字典序（可控、稳定）。
- 运行时结构：`AUDIO_SOURCES: Array<{ key, name, file }>`，`file` 为 `/audio/xxx.mp3` 的公开 URL。

> 说明：`import.meta.glob` 默认扫描源码目录。对 `public/` 下静态资源，改用「构建期扫 `public/audio/` 目录 + 读取文件名」不可行（Vite 不暴露 public 清单）。落地时采用 **`import.meta.glob` 指向 `src` 侧的音频导入** 或 **运行时 fetch 一个由简单脚本/写死数组维护的清单**。两种取舍见「清单来源待决」一节。**实施阶段先确认这一点。**

## 状态

- `selectedKey`：当前选中音源的 key。默认 = 清单第一项。
- `localStorage['rain:selected']`：记忆上次选择，挂载时恢复；切换时写入。
- `audioOpen`：下拉框开合（`ref(false)`）。
- `blobCache: Map<key, blobUrl>`：已烤制并缓存的 blob URL。
- `preparingKey`：当前正在惰性烤制的 key（用于下拉项 loading 态），`ref(null)`。

## prepare 改造（核心零侵入）

把现 `prepare()` 的烤制主体抽成 `prepareOne(key)`：

```
async function prepareOne(key) {
  if (blobCache.has(key)) return blobCache.get(key)
  const src = AUDIO_SOURCES.find(a => a.key === key).file
  // …现有 decode → 烤淡变 → WAV 编码逻辑…
  const url = URL.createObjectURL(new Blob([audioBufferToWav(ab)], { type: 'audio/wav' }))
  blobCache.set(key, url)
  return url
}
```

- **挂载时**：`prepareOne(selectedKey)`，烤完 `ready = true`（首屏点播放即可出声，保留现有首屏体验）。**不全量预烤**——音源会变多，全量卡顿。
- **切换 selectedKey 时**：
  - cache 命中 → 即时切换，零延迟。
  - cache 未命中 → `preparingKey = key`，烤制（下拉项显示 loading），烤完清 `preparingKey`、更新 chip。期间用户若已点播放则等烤完。
- **`start()`**：取 `blobCache.get(selectedKey)` 赋给 `audioA.src = audioB.src`（或重新 `new Audio(url)`），再走原播放/轮换/暂停逻辑（**一行不改**）。
- 播放中不切换 → `start()` 一次性绑定 blob 即可，运行期不变。

> AudioContext 复用：每次 `prepareOne` 各 `new AudioContext()` 并 `close()`，沿用现有写法（短切片开销可忽略，避免跨实例状态污染）。

## idle 页 UI（下拉框 · 方案 B）

- 顶部一个 chip：`<选中音源 name> ▾`，点击切换 `audioOpen`。
- 展开后为下拉面板：
  - **固定 `max-height: 240px` + `overflow-y: auto`**，文件再多也是框内上下滚动（后续高度可调）。
  - 纯文字选项，`name` 即文件名去后缀。
  - 选中项高亮 + `✓`；正在烤制的项显示 loading 文案。
  - 现代化样式：圆角、半透明背景、模糊背板、深色，与现有「自定义时长」overlay 风格统一。
- 选中一项 → 关闭面板、`selectedKey` 更新、写 localStorage、触发惰性 `prepareOne`。
- 点击面板外（背板）关闭。

## 改动文件

| 文件 | 改动 |
|---|---|
| `src/App.vue` | `SRC` 常量删除 → `selectedKey`/`AUDIO_SOURCES` 驱动；`prepare()` 拆为 `prepareOne(key)` + 缓存；挂载预烤 `selectedKey`；`start()` 从缓存取 blob 绑定 audioA/B；idle 页顶部加 chip + 下拉面板；localStorage 记忆。 |
| `public/audio/` | 新建目录；`test-15s.mp3`、`full-rain.mp3` 从 `public/` 根挪入。 |
| `public/test-15s.mp3`、`public/full-rain.mp3`（原位置） | 删除（已挪入 `audio/`）。 |

## 清单来源待决（实施前确认）

两选一：

- **方案 G（glob）**：把音频放进 `src/assets/audio/`，用 `import.meta.glob('./assets/audio/*.mp3', { eager: true, query: '?url', import: 'default' })` 拿到构建期 URL 清单。优点：真·零改码追加、文件名即选项。代价：音频打进构建产物（而非 `public/`），首次加载体积略增；且 PWA 离线缓存策略要相应覆盖。
- **方案 M（清单数组）**：音频仍放 `public/audio/`，在 `countdown.js` 旁新建 `audio-sources.js` 导出写死数组 `[{ key, name, file }]`。追加音频需改一行数组。优点：保持 `public/` 静态服务、PWA 简单；改动极小。代价：非零改码。

推荐 **方案 M**（清单数组）：与现有 `public/` 服务方式一致、PWA 简单、改动最小；音频就两三个时维护成本可忽略。等音频膨胀到两位数、追加频繁时再升到方案 G。

## 验收（用户主观 + 机械）

- 机械：下拉框 DOM 结构、`overflow-y` computed style、选中态 class、控制台无报错、编译通过；切换音源后 `audioA.currentSrc` 指向对应 blob；localStorage 读写正确。
- 主观（用户本人在浏览器上手）：下拉开合手感、滚动顺滑、选中反馈、视觉风格是否与现有 overlay 统一、切换不同音源播放听感。
