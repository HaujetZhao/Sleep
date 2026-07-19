# Sleep · 助眠环境音 — ambient 循环播放 PWA

## 这是什么

一个助眠/放松网页 APP：选一段环境音（雨声、海边、夜虫、旷野等高质量白噪音），点开后**单段音频无限循环播放，且相邻两段有 5 秒重叠的交叉淡入淡出**，听起来无缝。目标是做成 PWA，手机点开、倒计时播放、熄屏持续。

> **命名决策**：正式名定为 **Sleep**（副标题「助眠环境音」）。理由——助眠场景下，用户想睡觉时脑子里冒出的第一个词就是 sleep，零回忆成本，打开即用。早期代号 "Rain Loop" 是历史遗留（最初只有雨声），现已多音源，Rain 名不副实，故弃用。仓库名 `sleep`。
>
> **注意**：本地文件夹仍叫 `Rain`（未重命名——历史对话按文件夹索引，重命名会断链）。文件夹名与仓库名/产品名解耦，不影响。

## 语言/环境约定

- **语言**：中文。总结、Plan、WalkThrough、注释都用中文。
- **系统**：Windows 10，终端 PowerShell（命令分隔符 `;`）。本会话用 bash 风格。
- **委派子代理**：独立的搜索/实现/验证/多文件改动优先用 subagent，主会话编排审阅。
- **UI 主观体验验收由用户本人做**：过渡顺不顺、手感怪不怪、布局观感这类主观体验不派子代理用 Playwright 验收。子代理只做客观机械核对（DOM class、computed style、控制台报错、编译是否通过）。

## 项目结构

```
Rain/                              # 根目录即 Vite + Vue3 主项目（早期 app/ 子目录已平移上来）
├── CLAUDE.md                      # 本文件
├── README.md                      # 简介 + 音频/图标素材来源声明
├── index.html                     # Vite 入口（<title>Sleep · 助眠环境音</title>）
├── vite.config.js                 # dev server 配置：host:true 暴露局域网（手机测试），端口 5184
├── vite.config.pwa.js             # 生产构建配置：vite-plugin-pwa（manifest + service worker + workbox 缓存）
├── package.json                   # name: "sleep"，scripts: dev / build / build:pwa / icons / preview
├── .github/workflows/deploy.yml   # CI：push main → build:pwa → 部署 GitHub Pages（/Sleep/ 子路径）
├── scripts/
│   └── gen-icons.mjs              # 一次性：用 sharp 把 fa-bed 渲染成 icon-192/512.png（产物已提交，换图标再跑）
├── public/
│   ├── audio/                     # 6 段 Adobe 音源 mp3（192k）
│   │   ├── 01 - 打雷下雨.mp3
│   │   ├── 02 - 倾盆大雨.mp3
│   │   ├── 03 - 淅沥下雨.mp3
│   │   ├── 04 - 海边礁石.mp3
│   │   ├── 05 - 夜晚蟋蟀青蛙.mp3
│   │   └── 06 - 旷野.mp3
│   ├── favicon.svg                # fa-bed 矢量图（Font Awesome Free，CC BY 4.0）
│   ├── icon-192.png / icon-512.png # PWA 安装图标（iOS「添加到主屏幕」只认位图）
│   └── audio-test.html            # 早期验证用独立 demo（双 audio 并发 + 自动循环），保留供回溯
└── src/
    ├── App.vue                    # UI 编排：选择页/播放页、音源下拉、面板开关（~170 行）
    ├── usePlayer.js               # 播放引擎 composable：双 audio 轮换、烤 WAV、倒计时、Media Session、缓存态
    ├── wav-encoder.js             # 16-bit PCM WAV 编码器（纯函数）+ 可运行自检
    ├── audio-sources.js           # 音源清单（key/name/file）+ 可运行自检
    ├── countdown.js               # 倒计时预设 + formatCountdown + 可运行自检
    ├── main.js
    └── components/
        └── CustomDurationPicker.vue  # 自定义时长径向圆盘选择器（v-model:open + emit confirm ms）
```

> App.vue 早期是 ~700 行单文件 SFC（UI + 播放引擎 + 圆盘选择器全在一起），已按关注点拆为 UI 编排 + usePlayer composable + wav-encoder + CustomDurationPicker 组件。`docs/` 为早期设计稿存档，未参与构建。

dev server：`npm run dev`（用 `vite.config.js`），手机用输出的 `Network: http://<局域网IP>:<端口>/` 访问（手机与电脑同 WiFi）。
生产构建：`npm run build:pwa`（用 `vite.config.pwa.js`，注入 PWA）。两套配置分开——PWA 需要 service worker 与 manifest 这两个独立外链文件，dev 用不到，比 if/else 污染主配置清晰。部署走 `.github/workflows/deploy.yml`（push main 自动 build:pwa → GitHub Pages）。
**注意**：用户机器上常有多个残留 node dev 进程占用 5173~5184，Vite 会自动跳端口。清理由用户手动做，不要主动杀进程。

## 核心架构（已验收确定，勿轻改）

**淡变烤进 WAV + 双 `<audio>` 实例 + timeupdate 触发轮换。** 关键点：

1. **音频预处理（惰性、按音源 key 缓存）**：首次选中某音源时 `prepareOne(key)` —— fetch mp3 → `decodeAudioData` 解码成样本 → 对每个样本乘振幅系数（前 5s 淡入、后 5s 淡出）→ 手写 16-bit PCM WAV 编码器（[wav-encoder.js](src/wav-encoder.js)，Web Audio 无原生 encode）→ `Blob` + `URL.createObjectURL`，存入 `blobCache`（Map: key→blobUrl）。预处理与播放引擎均在 [usePlayer.js](src/usePlayer.js) composable 里。
   - 淡变**烤在波形里**，播放时**零 JS 控音量** → 精度无损（采样级）、熄屏无忧、无轮询粗糙问题。这是本方案能成立的关键。
   - **等功率淡变**：振幅系数用 `Math.sqrt(i/fadeSamples)`（非早期线性）。重叠段两路功率总和近似恒定，消除交叉处听感洼。淡入/淡出对称用同一 g。
2. **双 `<audio>` 实例**（A、B）都指向当前选中音源的 blob URL。`loop=false`（每段播一遍自然停）。`bindAudio(key)` 在切源时把两个实例的 `src` 换到新 blob。
3. **轮换触发用 `timeupdate`，不用 setInterval**：当前段挂一次性 `ontimeupdate`，当 `currentTime >= duration - 5` 时启动下一段。`duration` 自适应 → 换任何长度音频都自动取"结束前 5 秒"交接。
   - timeupdate ~250ms 粒度，但每段基于自身真实进度重算，**误差不累积**；环境音下偏差听不出。
   - 不用 setInterval 的原因：熄屏漂移 + 误差累积。
4. **同一时刻最多 2 段并发**：正在淡出的老段 + 正在淡入的新段，重叠 5 秒叠加，无缝。

## 多音源选择（已验收）

- 清单在 [src/audio-sources.js](src/audio-sources.js)：`AUDIO_SOURCES` 数组，每项 `{ key, name, file }`。**加音源只需往 `public/audio/` 丢 mp3 + 这里加一行**。文件带自检（key 唯一、字段齐全、路径合法）。
- idle 选择页有下拉 chip：选中 → `selectAudio(key)` 记忆到 localStorage（`rain:selected`）→ 惰性 `prepareOne`（下拉项显示"准备中…"）→ `bindAudio` 切换双实例 src。
- `blobCache` 跨音源复用：切回已烤过的音源是即时的，不重复解码。

## 倒计时（已验收）

- 预设 [src/countdown.js](src/countdown.js)：10 分 / 30 分 / 1 小时 / 2 小时 / 无限 / 自定义。
- **自定义 = 径向圆盘选择器**（独立组件 [src/components/CustomDurationPicker.vue](src/components/CustomDurationPicker.vue)，`v-model:open` + `emit('confirm', ms)`）：两段式（先选小时、释放后自动切分钟），SVG 圆盘 + Pointer Events，tap 与 drag 统一走 atan2→角度→值映射。
- **计时用墙钟（`Date.now()` + setInterval 250ms 刷新显示），与音频 `timeupdate` 交接完全独立**。两条时间线解耦：倒计时管"何时停"，timeupdate 管"段间如何交接"。
- `formatCountdown(ms)`：≥1 小时 `H:MM:SS`，否则 `M:SS`，向上取整到秒。文件带自检。

## 暂停/继续（原地恢复，非从头）

三态状态机：`idle / playing / paused`。

- **toggle**：idle→start，playing→pause，paused→resume。
- **pause()**：所有在播段 pause，但只保留"最新一段"进度，**已过交接点正在淡出的老段直接归零停掉**（使命已尽）。保留段的 `ontimeupdate` 不清。
  - "最新一段" = `nextKey` 的反面（`nextKey` 永远指向"下一个要启动的"）。
- **resume()**：只让保留段 `play()`，原地接播，`ontimeupdate` 仍在 → 播到交接点自然往下走。若有倒计时，墙钟按冻结的 `remaining` 重算 `endTime`。
- **stop()**（播放页返回键 / 蓝牙 stop / 倒计时到点）：回 idle 选择页，彻底清。
- 没有"彻底重置从头"入口（idle 态只在首次或刷新页面进入）。助眠场景暂停后基本是想继续，需求弱；要重置就刷新。

## Media Session / 外部媒体键（蓝牙耳机）

- `setupMediaSession()` 在 prepare 完成后注册，挂 `play`/`pause`/`stop`/`playpause` handler，都接到统一的三态控制（均在 [usePlayer.js](src/usePlayer.js)）。
- 蓝牙耳机的播放/暂停键经此拦截 → 走原地 pause/resume（**已解决早期"蓝牙键暂停后继续就丢失循环"的问题**）。
- `syncPlaybackState()` 同步通知栏播放/暂停状态。
- HTML5 `<audio>` 激活系统媒体会话 → 通知栏/锁屏有媒体控件（实测移动端可用）。
- **通知栏曲名随选中音源更新**：`updateMediaMetadata()` 把 `metadata.title` 设为 `selectedName`，在 `changeAudio()` 切源时一并调用（早期 `title` 硬编码 `'Heavy Rain'` 已修复）。

## PWA / 离线 / 缓存态图标（已验收）

- **可安装、可离线**：`vite-plugin-pwa`（`vite.config.pwa.js`）生成 manifest + service worker。`registerType: 'autoUpdate'`。manifest 用 `theme_color/background_color:#07060f`、`display:standalone`、`orientation:portrait`。
- **两层缓存策略**（workbox）：
  - **app shell 预缓存**：`globPatterns` 含 `js/css/html/svg/png/json/woff2/woff`。**woff2 必须进 precache**——否则 Font Awesome 的 `<i class="fa-">` 在离线刷新时 CSS 引用的字体 404，渲染成豆腐块。
  - **音频运行时缓存**：`.mp3` 走 `CacheFirst`（缓存名 `sleep-audio`，`maxEntries:20`，一年），首次播放后落盘，再次/离线即取本地；不塞进安装预缓存以免首装拖慢。`maximumFileSizeToCacheInBytes: 3MB` 卡住大文件。
- **缓存态图标三态**（usePlayer.js 的 `cacheState()` + `CACHE_ICON` 表；App.vue 模板的下拉项与胶囊各 `v-bind` 一处复用）：`preparingKey` / `cachedKeys` / `selectedKey` 驱动——准备中（`fa-circle-notch` 旋转）/ 已缓存本地（`fa-circle-check`）/ 云端未下载（`fa-cloud`，点击即下载烤制）。胶囊反映**当前选中音源**的真实离线态。
- ⚠️ **缓存态比对的坑（已修复）**：`navigator.onLine` 判断需与服务端缓存名比对，两边 URL 必须都用 `new URL(..., location.href).pathname` 规范化后再比，否则刷新后图标掉回云端（commit `91b9a8b`）。缓存名 `'sleep-audio'` 来自 sw 里 `.mp3` 的 CacheFirst 路由。
- **Font Awesome 本地内置**：依赖 `@fortawesome/fontawesome-free`，字体随构建打进 precache，离线可用（修复早期离线 FA 字体变豆腐块，commit `8e2f3e9`）。
- **图标**：`public/favicon.svg`（矢量）+ `icon-192/512.png`（位图，iOS Safari「添加到主屏幕」只认位图）。PNG 由 `scripts/gen-icons.mjs` 用 sharp 从 fa-bed 渲染，产物提交进 repo，换图标改 SVG 再跑一遍。
- **部署**：`.github/workflows/deploy.yml`，push main → `npm ci` → `build:pwa` → 上传 dist → deploy-pages。`base: './'`（相对）让资源与音源路径随页面 URL 自动解析，GitHub Pages 子路径 `/Sleep/` 下不写死仓库名，换仓库/路径也能用。

## 关键技术决策（踩过的坑，勿重蹈）

- **走 HTML5 `<audio>` 不走 Web Audio 播放**：移动端实测双 `<audio>` 可并发且**熄屏持续播放**。Web Audio（howler 默认）做交叉淡变虽淡变更精确，但**熄屏会被系统挂起、无通知栏控件**——助眠场景不可接受。已放弃 Web Audio 播放路线。
- **淡变必须烤进 WAV，不能靠 `<audio>.volume` JS 轮询**：`<audio>` 无原生淡变 API，`volume` 是瞬变的；JS 轮询模拟精度差且熄屏/后台易糙。烤进波形是正解。
- **淡变用等功率（sqrt）不用线性**：线性淡变在两段重叠的交叉处，功率总和在中点跌出明显听感洼。sqrt 让重叠段功率近似恒定。
- **howler.js 已从方案中移除**：早期试过，最终原生 `<audio>` + 烤 WAV 更干净。依赖也已从 package.json 卸载。
- **触发用 timeupdate 不用 setInterval**：见上。倒计时的 setInterval 只管显示刷新（墙钟），不碰音频交接。
- 早期单文件 demo（demoA = 原生 loop 硬拼、demoB = Web Audio crossfade，文件已删）已证明：原生 loop 接缝硬（用户否决）、Web Audio 熄屏挂起（用户否决）。当前方案是这两者的最佳折中。

## 已验收通过

- 循环手感顺、交接无缝（等功率淡变后无洼）。
- 移动端双 audio 并发、熄屏持续。
- 暂停/继续原地恢复、蓝牙键接管。
- 多音源选择 + 记忆 + 惰性烤制。
- 倒计时预设 + 自定义径向圆盘。
- PWA：可安装到主屏幕、离线可用（app shell + 音频两层缓存）。
- 缓存态图标三态（准备中/已缓存/云端），下拉项与胶囊各一套。
- GitHub Pages 自动部署（push main → build:pwa → Pages）。
- 代码结构：App.vue 拆为 UI 编排（~170 行）+ [usePlayer.js](src/usePlayer.js) composable（播放引擎）+ [wav-encoder.js](src/wav-encoder.js)（纯函数）+ [CustomDurationPicker.vue](src/components/CustomDurationPicker.vue) 组件；三个数据/工具文件（audio-sources / countdown / wav-encoder）均带 `node` 可运行自检。

## 下一步（用户未提，勿主动做）

音量控制、UI 打磨。等用户主动提出。
