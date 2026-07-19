# Rain Loop — 助眠音频循环 PWA

## 这是什么

一个助眠网页 APP：点播放后，单段音频（如 15 秒雨声切片）**无限循环播放，且相邻两段有 5 秒重叠的交叉淡入淡出**，听起来无缝。目标是做成 PWA，手机点开、倒计时播放、熄屏持续。

当前进度：**核心循环播放已打通并验收通过**。后续（倒计时、PWA、选曲、UI 打磨）尚未开始——用户会主动提出，不要主动推进。

## 语言/环境约定

- **语言**：中文。总结、Plan、WalkThrough、注释都用中文。
- **系统**：Windows 10，终端 PowerShell（命令分隔符 `;`）。但本会话用的是 bash 风格。
- **委派子代理**：独立的搜索/实现/验证/多文件改动优先用 subagent，主会话编排审阅。
- **UI 主观体验验收由用户本人做**：过渡顺不顺、手感怪不怪、布局观感这类主观体验不派子代理用 Playwright 验收。子代理只做客观机械核对（DOM class、computed style、控制台报错、编译是否通过）。

## 项目结构

```
Rain/                              # 根目录即 Vite + Vue3 主项目（早期 app/ 子目录已平移上来）
├── CLAUDE.md                      # 本文件
├── index.html                     # Vite 入口
├── vite.config.js                 # host:true 暴露局域网（手机测试），端口 5184
├── package.json
├── public/
│   ├── test-15s.mp3               # 15 秒雨声切片（App.vue 的 SRC，烤 WAV 的源；母文件前 15s）
│   ├── full-rain.mp3              # 90 秒母文件（test-15s 取其前 15s）
│   └── audio-test.html            # 验证用独立 demo（双 audio 并发 + 自动循环），保留供回溯
└── src/
    ├── App.vue                    # 当前核心：全部逻辑都在这一个 SFC 里
    └── main.js
```

dev server：`npm run dev`，手机用输出的 `Network: http://<局域网IP>:<端口>/` 访问（手机与电脑同 WiFi）。
**注意**：用户机器上常有多个残留 node dev 进程占用 5173~5184，Vite 会自动跳端口。清理由用户手动做，不要主动杀进程。

## 核心架构（已验收确定，勿轻改）

**淡变烤进 WAV + 双 `<audio>` 实例 + timeupdate 触发轮换。** 关键点：

1. **音频预处理（页面挂载时一次）**：fetch mp3 → `decodeAudioData` 解码成样本 → 对每个样本乘振幅系数（前 5s 线性 `0→1` 淡入、后 5s 线性 `1→0` 淡出）→ 手写 16-bit PCM WAV 编码器（Web Audio 无原生 encode）→ `Blob` + `URL.createObjectURL`。
   - 淡变**烤在波形里**，播放时**零 JS 控音量** → 精度无损（采样级）、熄屏无忧、无轮询粗糙问题。这是本方案能成立的关键。
2. **双 `<audio>` 实例**（A、B）都指向同一个 blob URL。`loop=false`（每段播一遍自然停）。
3. **轮换触发用 `timeupdate`，不用 setInterval**：当前段挂一次性 `ontimeupdate`，当 `currentTime >= duration - 5` 时启动下一段。`duration` 自适应 → 换任何长度音频都自动取"结束前 5 秒"交接。
   - timeupdate ~250ms 粒度，但每段基于自身真实进度重算，**误差不累积**；雨声下偏差听不出。
   - 不用 setInterval 的原因：熄屏漂移 + 误差累积。
4. **同一时刻最多 2 段并发**：正在淡出的老段 + 正在淡入的新段，重叠 5 秒叠加，无缝。

## 暂停/继续（原地恢复，非从头）

三态状态机：`idle / playing / paused`。

- **toggle**：idle→start，playing→pause，paused→resume。
- **pause()**：所有在播段 pause，但只保留"最新一段"进度，**已过交接点正在淡出的老段直接归零停掉**（使命已尽）。保留段的 `ontimeupdate` 不清。
  - "最新一段" = `nextKey` 的反面（`nextKey` 永远指向"下一个要启动的"）。
- **resume()**：只让保留段 `play()`，原地接播，`ontimeupdate` 仍在 → 播到交接点自然往下走。
- 没有"彻底重置从头"入口（idle 态只在首次或刷新页面进入）。助眠场景暂停后基本是想继续，需求弱；要重置就刷新。

## Media Session / 外部媒体键（蓝牙耳机）

- `setupMediaSession()` 在 prepare 完成后注册，挂 `play`/`pause`/`stop`/`playpause` handler，都接到统一的三态控制。
- 蓝牙耳机的播放/暂停键经此拦截 → 走原地 pause/resume（**已解决早期"蓝牙键暂停后继续就丢失循环"的问题**）。
- `syncPlaybackState()` 同步通知栏播放/暂停状态。
- HTML5 `<audio>` 激活系统媒体会话 → 通知栏/锁屏有媒体控件（实测移动端可用）。

## 关键技术决策（踩过的坑，勿重蹈）

- **走 HTML5 `<audio>` 不走 Web Audio 播放**：移动端实测双 `<audio>` 可并发且**熄屏持续播放**。Web Audio（howler 默认）做交叉淡变虽淡变更精确，但**熄屏会被系统挂起、无通知栏控件**——助眠场景不可接受。已放弃 Web Audio 播放路线。
- **淡变必须烤进 WAV，不能靠 `<audio>.volume` JS 轮询**：`<audio>` 无原生淡变 API，`volume` 是瞬变的；JS 轮询模拟精度差且熄屏/后台易糙。烤进波形是正解。
- **howler.js 已从方案中移除**：早期试过，最终原生 `<audio>` + 烤 WAV 更干净。`node_modules` 里还装着 howler，未清理（无害，可删）。
- **触发用 timeupdate 不用 setInterval**：见上。
- 早期单文件 demo（demoA = 原生 loop 硬拼、demoB = Web Audio crossfade，文件已删）已证明：原生 loop 接缝硬（用户否决）、Web Audio 熄屏挂起（用户否决）。当前方案是这两者的最佳折中。

## 已验收通过

- 循环手感顺、交接无缝（用户主观验收）。
- 移动端双 audio 并发、熄屏持续（用户实测）。
- 暂停/继续原地恢复、蓝牙键接管（待用户最终确认这一轮）。

## 下一步（用户未提，勿主动做）

倒计时停止、PWA（manifest + service worker，可装到主屏幕）、多音源/选曲、音量控制、UI 打磨。等用户主动提出。
