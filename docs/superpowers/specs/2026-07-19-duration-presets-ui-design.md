# 时长预设 + 两态切换 UI 设计

日期:2026-07-19
状态:已与用户确认设计方向,待写实现计划

## 目标

在已打通的循环播放之上,加一层"选时长即开播"的交互,并把页面改造成**两态切换**的现代毛玻璃 UI。倒计时到点直接停止。

## 已确认的交互(用户逐项拍板)

1. **到点行为:直接停止**(不做渐弱、不做暂停态)。归零即回到选择页(idle)。
2. **倒计时:显示**。主区域大号剩余时间数字。
3. **时长按钮 = 开播**:点任意时长按钮立即开播 + 启动对应倒计时。不需要单独的播放键启动。
4. **视觉风格:毛玻璃光晕**(深紫渐变背景 + 半透明实心胶囊 + 柔光倒计时 + 紫色渐变暂停键)。
5. **两态切换**:
   - **选择页(idle)**:只有时长按钮(30 分 / 1 时 / 2 时 / ∞),无倒计时、无暂停键。
   - **播放页(playing/paused)**:只有大倒计时 + 两个键(暂停/继续 ↕ 返回选择页),**不显示时长按钮**。
6. **播放页两键**:
   - **⏸ 暂停/继续**(主键,实心紫)。
   - **↩ 返回**(次键,幽灵键半透明):停播、回到选择页。以后加"选声音"也用它入口。

## 状态机(沿用现有 idle/playing/paused,扩展计时状态)

现有三态 `idle / playing / paused` 不变。新增计时相关状态:

- `duration`(ms,`null` 表示无限)
- `endTime`(number | null):运行中(playing)的结束墙钟时间戳
- `remaining`(number | null):暂停时冻结的剩余 ms

### 选择页 = idle

进入 idle 的途径:
- 首次挂载(默认)
- 点「返回」键 → `stop()`(resetBoth + 清计时 + state=idle)
- 倒计时归零 → 同上

### 时长按钮点击(idle 态)

```
selectDuration(d):
  duration = d                       // null = 无限
  start()                            // 复用现有 start():resetBoth → playing → tick
  if (d !== null) endTime = Date.now() + d
  startCountdownTick()
```

### 播放页

- 倒计时显示(playing 态):`display = max(0, endTime - Date.now())`,格式 `M:SS` 或 `H:MM:SS`(≥1 小时)。无限模式显示 `∞`。
- 暂停(`pause()`):现有逻辑保留(只保留最新段进度),另存 `remaining = endTime - Date.now()`,`endTime = null`。
- 继续(`resume()`):现有逻辑保留,另算 `endTime = Date.now() + remaining`。无限模式无需调整。
- 返回键 → `stop()` → idle。

### 切换时长(播放中再点时长按钮?)

播放页**不显示时长按钮**,所以不会发生"播放中点时长"。要换时长必须先「返回」回选择页。简化交互,避免中途换计时语义的歧义。(用户拍板的两态结构天然规避了这一点。)

## 倒计时精度(关键技术点)

- 用**墙钟**算:`endTime = Date.now() + duration`。显示值每 250ms 由 `setInterval` 重算 `endTime - Date.now()`。
- **纯显示用 setInterval 可接受**:它只刷新数字,不驱动音频交接。熄屏期间页面被隐藏,setInterval 会 throttling,但醒来后第一次 tick 即按墙钟重算,显示立刻跳到正确剩余值。
- **归零检测**放在这个 250ms tick 里:`if (duration && Date.now() >= endTime) stop()`。
- **与现有 `timeupdate` 交接完全独立两套机制**:交接靠 audio 自身进度驱动,倒计时靠墙钟驱动,互不读取对方状态。
- 暂停冻结用 `remaining`,继续用墙钟重算 `endTime` → 暂停期间不消耗时长,正确。

## 无限模式

- `duration = null`,`endTime` 永远 null。
- 倒计时区显示 `∞`。
- 250ms tick 里 `duration` 为 null 则跳过归零检测。
- 暂停/继续/返回逻辑与计时模式一致(暂停只是冻结音频进度,没有剩余时间概念)。

## UI / 样式(毛玻璃光晕方向)

- 全屏背景:`radial-gradient(120% 80% at 50% 0%, #2a1a4a 0%, #0e0a1f 60%, #07060f 100%)`。
- 文字色 `#f0eaff`,次要文字 `#cfc3f0`。
- **选择页**:纵向堆叠的半透明胶囊按钮(`background: rgba(255,255,255,.08)`),hover/active 轻微提亮。按钮文字「30 分钟 / 1 小时 / 2 小时 / 无限」。
- **播放页**:
  - 中央大号倒计时(细体 / `font-weight: 200`,clamp 自适应字号)。
  - 下方两键并排:返回(幽灵键 `rgba(255,255,255,.08)`)、暂停(`linear-gradient(135deg,#a78bfa,#7c5cff)`)。
- 两态用 Vue `<Transition>` 做淡入淡出过渡(主观手感由用户验收)。
- **响应式**:`min-height:100vh` flex 居中,字号/按钮尺寸用 `clamp()`,手机单列、桌面同样居中卡片。小屏按钮宽度 `100%` 不溢出。
- `color-scheme: dark`。安全区:`padding-bottom: env(safe-area-inset-bottom)`。

## 蓝牙 / Media Session 兼容

- 现有 `setupMediaSession` 的 play/pause/stop handler 保留。`stop` handler 走 `pause()`(原地)还是 `stop()`(回选择页)?
  - 决定:**`stop` handler → `stop()` 回选择页**,符合"外部 stop = 彻底结束"语义。playpause/play/pause 维持原原地逻辑。
- 倒计时归零触发的 `stop()` 不需要额外动作,Media Session 状态由 `syncPlaybackState()` 自然同步。

## 不做的事(YAGNI)

- 不做自定义时长输入、进度环、音量控制、多音源选曲(CLAUDE.md 未提,等用户主动)。
- 不做"渐弱停止"(用户选直接停止)。
- 不做播放中切时长(两态结构天然规避)。
- 不为倒计时引入 Web Worker(墙钟方案熄屏已足够准)。

## 改动范围

只改 [src/App.vue](src/App.vue) 一个文件:模板扩成两态、样式重写为毛玻璃、script 加计时状态与 250ms tick。其余文件不动。

## 验收要点(交用户主观体验)

- 选择页 → 点时长 → 切到播放页的过渡手感。
- 倒计时跳秒、暂停冻结、继续重算、归零回选择页。
- 返回键停拔回选择页。
- 蓝牙键暂停/继续/stop。
- 熄屏回来倒计时正确。
- 移动端布局不溢出。
