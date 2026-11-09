/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}
declare const __BUILD_TIME__: string
interface ImportMeta {
  readonly env: ImportMetaEnv
}
