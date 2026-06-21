import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// GitHub Pages のプロジェクトページ（username.github.io/<repo>/）で配信する場合、
// base をリポジトリ名に合わせる。リポジトリ名を変えたらここも変更する。
const repo = 'budget-tracker'

export default defineConfig({
  plugins: [svelte()],
  base: process.env.NODE_ENV === 'production' ? `/${repo}/` : '/',
})
