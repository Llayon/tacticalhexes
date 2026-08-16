/**
 * Platform Layer Entry Point.
 * Detects the runtime environment and returns the appropriate Platform adapter.
 */
import { BrowserPlatform } from './BrowserPlatform.js'
import { TelegramPlatform } from './telegram/TelegramPlatform.js'

let _platformInstance = null

/**
 * Check if the application is running inside a Telegram Mini App environment.
 * @returns {boolean}
 */
export function isTelegramEnvironment() {
  if (typeof window === 'undefined') return false
  const tg = window.Telegram?.WebApp
  if (!tg) return false
  return typeof tg.initData === 'string' || typeof tg.version === 'string'
}

/**
 * Create and return the appropriate Platform adapter for the current runtime.
 * @returns {BrowserPlatform | TelegramPlatform}
 */
export function createPlatform() {
  if (isTelegramEnvironment()) {
    return new TelegramPlatform()
  }
  return new BrowserPlatform()
}

/**
 * Get or create the singleton Platform instance.
 * @returns {BrowserPlatform | TelegramPlatform}
 */
export function getPlatform() {
  if (!_platformInstance) {
    _platformInstance = createPlatform()
  }
  return _platformInstance
}

export { BrowserPlatform } from './BrowserPlatform.js'
export { BrowserViewport } from './BrowserViewport.js'
export { TelegramPlatform } from './telegram/TelegramPlatform.js'
export { TelegramViewport } from './telegram/TelegramViewport.js'
