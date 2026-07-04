/**
 * Base URL for the proxy. Empty string means same-origin — in dev, Vite's
 * server proxy forwards /api/* to the proxy (see vite.config.ts).
 */
export const PROXY_BASE: string = import.meta.env.VITE_PROXY_URL ?? ''
