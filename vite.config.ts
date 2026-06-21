import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages のプロジェクトページ（username.github.io/<repo>/）で配信する場合、
// base をリポジトリ名に合わせる。リポジトリ名を変えたらここも変更する。
const repo = 'budget-tracker'
const base = process.env.NODE_ENV === 'production' ? `/${repo}/` : '/'

export default defineConfig({
  base,
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',          // 新バージョン配信時に自動更新
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: '家計簿',
        short_name: '家計簿',
        description: '個人用の家計簿アプリ（収支・予算・給与明細取込）',
        lang: 'ja',
        dir: 'ltr',
        display: 'standalone',
        background_color: '#FBFAF7',
        theme_color: '#1F6F58',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // アプリシェル（HTML/JS/CSS/アイコン）を事前キャッシュしてオフラインでも起動できるように。
        // pdf.js 本体(extract-*.js)とそのワーカー(.mjs)は取込時のみ・ネット必須なので除外して軽量化。
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        globIgnores: ['**/extract-*.js'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
