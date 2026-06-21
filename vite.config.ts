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
        // アプリシェル＋遅延ロードする取込チャンク（pdf.js本体 extract-*.js・ワーカー含む）を
        // まとめて事前キャッシュする。取込チャンクを事前キャッシュから外すと、再デプロイで
        // ハッシュが変わった際に「古いアプリ殻（SWキャッシュ）が、サーバーから削除済みの
        // 旧 extract-*.js を動的importしようとして失敗」＝ "Importing a module script failed"
        // になる（バージョン不整合）。事前キャッシュに含めればSWのバージョンと常に一致し防げる。
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/assets\//],   // 資産(JS/CSS)リクエストに index.html(HTML) を返さない
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024, // pdf.js ワーカー(約1.2MB)を事前キャッシュ対象に含める
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
