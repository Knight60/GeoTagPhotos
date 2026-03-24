import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/sea/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'SEA DPKYFC GIS',
        short_name: 'SEA GIS',
        description: 'การสำรวจแหล่งมรดกโลก กลุ่มป่าดงพญาเย็น-เขาใหญ่',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        icons: [
          {
            src: 'vite.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml'
          }
        ]
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  server: {
    port: 5174,
    allowedHosts: ['haus35.3bbddns.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true
      },
      '/media': {
        target: 'http://localhost:3002',
        changeOrigin: true
      }
    }
  }
})
