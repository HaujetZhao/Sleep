import { createApp } from 'vue'
import '@fortawesome/fontawesome-free/css/all.min.css'   // FA 整包本地内置（webfont），离线 PWA 可用，未来加图标直接用 <i class="fa-...">

import App from './App.vue'

createApp(App).mount('#app')
