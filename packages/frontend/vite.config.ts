import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, type PluginOption } from 'vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    visualizer({
      filename: 'dist/stats.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
      open: false,
    }) as PluginOption,
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string): string | null | undefined {
          // React 判定を最優先
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'react-vendor'
          }
          if (id.includes('@tanstack/react-router') || id.includes('@tanstack/router-core')) {
            return 'router-vendor'
          }
          if (id.includes('lucide-react')) {
            return 'icon-vendor'
          }
          // dnd-kit: dnd-kit 配布物のみを対象（react は react-vendor へ）
          if (
            id.includes('/@dnd-kit/') &&
            !id.includes('node_modules/react/') &&
            !id.includes('node_modules/react-dom/')
          ) {
            return 'dnd-vendor'
          }
          return undefined
        },
      },
    },
  },
  server: {
    // /api/* のリクエストを wrangler dev (Hono backend) にプロキシ
    // ブラウザからは同一オリジン (http://localhost:5173/api/...) として見える
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
})
