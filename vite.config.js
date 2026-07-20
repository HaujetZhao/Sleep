import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

import { cloudflare } from "@cloudflare/vite-plugin";

// 普通 build → 单 HTML：JS/CSS/woff2 字体 + 6 段 mp3 全内联进 index.html，
// 产物拷到 U 盘 file:// 直开可用（mp3 内联成 data URI，fetch 在 file:// 下放行）。
// assetsInlineLimit 调高，让 mp3 也走 base64 内联（viteSingleFile 默认已设，这里显式兜底）。
export default defineConfig({
  plugins: [vue(), viteSingleFile(), cloudflare()],
  base: './',
  build: { assetsInlineLimit: 100 * 1024 * 1024 },
  // ponytail: host 暴露到局域网（手机测试），固定端口方便记。
  server: {
    host: true,
    port: 5184,
    strictPort: false,
  },
})