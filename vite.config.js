import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

import { cloudflare } from "@cloudflare/vite-plugin";

// ponytail: host 暴露到局域网（手机测试），固定端口方便记。
export default defineConfig({
  plugins: [vue(), cloudflare()],
  server: {
    host: true,
    port: 5184,
    strictPort: false,
  },
})