/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the proxy API. Empty string = same-origin relative /api (Vite dev proxy or a reverse proxy in front of both). */
  readonly VITE_PROXY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
