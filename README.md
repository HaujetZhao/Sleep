# Sleep · 助眠环境音

助眠/放松用的网页 APP：选一段环境音（雨声、海边、夜虫、旷野等），点开后单段音频**无缝循环**——相邻两段有 5 秒重叠的交叉淡入淡出，听不出接缝。支持倒计时停止、暂停/继续（原地恢复）、蓝牙耳机媒体键接管，移动端熄屏持续播放。**已做成 PWA**：可安装到主屏幕、离线可用（首次播放过的音源落盘缓存）。

> 想睡觉时脑子里冒出的第一个词就是 sleep——名字即回忆，打开即用。早期代号 "Rain Loop" 是最初只有雨声时的遗留，现已多音源，故弃用。

## 技术栈

Vite + Vue 3（单 SFC `src/App.vue`）+ `vite-plugin-pwa`（manifest + service worker）。核心思路：把交叉淡变**烤进 WAV 波形**（等功率 sqrt 曲线），播放时零 JS 控音量；双 `<audio>` 实例 + `timeupdate` 触发轮换，避开 Web Audio 在移动端熄屏被挂起的问题。图标用 Font Awesome（本地内置，离线可用）。

## 开发

```bash
npm install
npm run dev          # 手机测试：用输出的 Network 地址（同 WiFi），端口默认 5184，被占会自动跳
npm run build:pwa    # 生产构建（注入 PWA：manifest + service worker）
```

部署：push 到 `main` 即触发 `.github/workflows/deploy.yml`，自动 `build:pwa` 并部署到 GitHub Pages。

## 项目结构

- [src/App.vue](src/App.vue) — 全部 UI 与播放/轮换/暂停/倒计时/选曲/缓存态逻辑
- [src/audio-sources.js](src/audio-sources.js) — 音源清单（加音源：往 `public/audio/` 丢 mp3 + 加一行）
- [src/countdown.js](src/countdown.js) — 倒计时预设与格式化
- [vite.config.js](vite.config.js) / [vite.config.pwa.js](vite.config.pwa.js) — dev 配置 / 生产 PWA 构建配置
- [scripts/gen-icons.mjs](scripts/gen-icons.mjs) — 生成 PWA 安装图标（192/512 PNG）
- 架构与设计决策详见 [CLAUDE.md](CLAUDE.md)

## 音频素材来源

`public/audio/` 下的部分高质量音频来自于 **[Adobe Audition Sound Effects](https://www.adobe.com/products/audition/offers/AdobeAuditionDLCSFX.html)**

| 音频名 | 来源 |
|---|---|
| 01 - 打雷下雨.mp3 | `Weather\Weather Ambience Heavy Rain Thunderstorm Thunder 01.wav` |
| 02 - 倾盆大雨.mp3 | `Weather\Weather Ambience Heavy Rain Downpour Splatty 01.wav` |
| 03 - 淅沥下雨.mp3 | `Weather\Weather Ambience Rain Drips Water Splatty 01.wav` |
| 04 - 海边礁石.mp3 | `Ambience_2\Ambience Ocean Shore 01.wav` |
| 05 - 夜晚蟋蟀青蛙.mp3 | `Ambience_2\Ambience Night Crickets And A Bullfrog 01.wav` |
| 06 - 旷野.mp3 | `Ambience_2\Ambience Wilderness 01.wav` |

## 图标来源

[public/favicon.svg](public/favicon.svg) 使用 **[Font Awesome Free](https://fontawesome.com)** 的 `fa-bed` 图标，许可证 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。
