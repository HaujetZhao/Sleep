// 一次性脚本：把 favicon 的 fa-bed 图标渲染成 PWA 需要的 PNG(192/512)。
//   现有 favicon.svg 是矢量，但 iOS Safari「添加到主屏幕」只认位图 → 需 PNG。
//   用法：node scripts/gen-icons.mjs
// ponytail: 产物提交进 repo，脚本仅作可复现来源保留；换图标改这里的 SVG 再跑一遍即可。
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'

// fa-bed 路径（同 public/favicon.svg，Font Awesome Free 6 fa-bed，CC BY 4.0）
const BED_PATH = 'M32 32c17.7 0 32 14.3 32 32l0 256 224 0 0-160c0-17.7 14.3-32 32-32l224 0c53 0 96 43 96 96l0 224c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-32-224 0-32 0L64 416l0 32c0 17.7-14.3 32-32 32s-32-14.3-32-32L0 64C0 46.3 14.3 32 32 32zm144 96a80 80 0 1 1 0 160 80 80 0 1 1 0-160z'

// 渲染一个 size×size 的图标：深色圆角底 + 居中紫色 bed（缩进留 maskable 安全区）
function svg(size) {
  const bed = (size * 0.62) | 0          // bed 占画布高度约 62%
  const scale = bed / 512                // 原 viewBox 高 512
  const w = 640 * scale
  const x = (size - w) / 2
  const y = (size - bed) / 2
  const r = size * 0.22                  // 圆角
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="#07060f"/>
  <g transform="translate(${x} ${y}) scale(${scale})">
    <path fill="#863bff" d="${BED_PATH}"/>
  </g>
</svg>`
}

for (const s of [192, 512]) {
  const out = `public/icon-${s}.png`
  await sharp(Buffer.from(svg(s))).png().toFile(out)
  console.log('wrote', out)
}
