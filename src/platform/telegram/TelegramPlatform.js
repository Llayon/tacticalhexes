/**
 * TelegramPlatform - Telegram Mini App platform adapter.
 * Centralizes all interactions with window.Telegram.WebApp without leaking SDK calls elsewhere.
 */
import { TelegramViewport } from './TelegramViewport.js'

export class TelegramPlatform {
  constructor(webApp = window.Telegram?.WebApp) {
    this.name = 'telegram'
    this.isTelegram = true
    this.webApp = webApp
    this.viewport = new TelegramViewport(this.webApp)
    this._lifecycleListeners = new Map()

    this._onActivated = this._onActivated.bind(this)
    this._onDeactivated = this._onDeactivated.bind(this)
    this._onThemeChanged = this._onThemeChanged.bind(this)
    this._onVisibilityChange = this._onVisibilityChange.bind(this)
  }

  async init() {
    this.viewport.init()

    if (this.webApp) {
      try {
        // Signal to Telegram that the Mini App is initialized and ready to display
        if (typeof this.webApp.ready === 'function') {
          this.webApp.ready()
        }

        // Expand app to fill maximum available height in Telegram
        if (typeof this.webApp.expand === 'function' && !this.webApp.isExpanded) {
          this.webApp.expand()
        }

        // Enable closing confirmation to prevent accidental swipe-down exits during sessions
        if (typeof this.webApp.enableClosingConfirmation === 'function') {
          this.webApp.enableClosingConfirmation()
        }

        // Set background / header colors if supported
        if (typeof this.webApp.setBackgroundColor === 'function') {
          this.webApp.setBackgroundColor('#000000')
        }
        if (typeof this.webApp.setHeaderColor === 'function') {
          this.webApp.setHeaderColor('#000000')
        }

        // Bind Telegram lifecycle events
        if (typeof this.webApp.onEvent === 'function') {
          this.webApp.onEvent('activated', this._onActivated)
          this.webApp.onEvent('deactivated', this._onDeactivated)
          this.webApp.onEvent('themeChanged', this._onThemeChanged)
        }
      } catch (err) {
        console.warn('[TelegramPlatform] Initialization warning:', err?.message || err)
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibilityChange)
    }

    return true
  }

  destroy() {
    this.viewport.destroy()

    if (this.webApp && typeof this.webApp.offEvent === 'function') {
      this.webApp.offEvent('activated', this._onActivated)
      this.webApp.offEvent('deactivated', this._onDeactivated)
      this.webApp.offEvent('themeChanged', this._onThemeChanged)
    }

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange)
    }

    this._lifecycleListeners.clear()
  }

  /**
   * Request fullscreen mode (Telegram Bot API 8.0+ / WebApp v8.0+)
   * Falls back to standard browser fullscreen if available.
   */
  async requestFullscreen() {
    if (this.webApp && typeof this.webApp.requestFullscreen === 'function') {
      try {
        this.webApp.requestFullscreen()
        return true
      } catch (err) {
        console.warn('[TelegramPlatform] Telegram requestFullscreen non-fatal error:', err?.message || err)
      }
    }

    // Fallback to standard fullscreen
    if (typeof document !== 'undefined') {
      try {
        const el = document.documentElement
        if (el.requestFullscreen) {
          await el.requestFullscreen()
          return true
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen()
          return true
        }
      } catch {
        // Ignored
      }
    }
    return false
  }

  /**
   * Exit fullscreen mode
   */
  async exitFullscreen() {
    if (this.webApp && typeof this.webApp.exitFullscreen === 'function') {
      try {
        this.webApp.exitFullscreen()
        return true
      } catch (err) {
        console.warn('[TelegramPlatform] Telegram exitFullscreen error:', err?.message || err)
      }
    }

    if (typeof document !== 'undefined') {
      try {
        if (document.exitFullscreen) {
          await document.exitFullscreen()
          return true
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen()
          return true
        }
      } catch {
        // Ignored
      }
    }
    return false
  }

  /**
   * Lock screen orientation if supported (Telegram Bot API 8.0+ or Screen Orientation API)
   * @param {'landscape'|'portrait'} orientation
   */
  async lockOrientation(orientation = 'landscape') {
    if (this.webApp && typeof this.webApp.lockOrientation === 'function') {
      try {
        this.webApp.lockOrientation()
        return true
      } catch (err) {
        console.warn('[TelegramPlatform] Telegram lockOrientation non-fatal error:', err?.message || err)
      }
    }

    if (typeof screen !== 'undefined' && screen.orientation?.lock) {
      try {
        await screen.orientation.lock(orientation)
        return true
      } catch {
        return false
      }
    }

    return false
  }

  /**
   * Unlock screen orientation
   */
  unlockOrientation() {
    if (this.webApp && typeof this.webApp.unlockOrientation === 'function') {
      try {
        this.webApp.unlockOrientation()
      } catch {
        // Ignored
      }
    }

    if (typeof screen !== 'undefined' && screen.orientation?.unlock) {
      try {
        screen.orientation.unlock()
      } catch {
        // Ignored
      }
    }
  }

  /**
   * Get Telegram user/theme data (safe access)
   */
  getUser() {
    return this.webApp?.initDataUnsafe?.user || null
  }

  getThemeParams() {
    return this.webApp?.themeParams || {}
  }

  getColorScheme() {
    return this.webApp?.colorScheme || 'dark'
  }

  onVisibilityChange(callback) {
    return this.onLifecycleEvent('visibilitychange', callback)
  }

  onLifecycleEvent(event, callback) {
    if (!this._lifecycleListeners.has(event)) {
      this._lifecycleListeners.set(event, new Set())
    }
    this._lifecycleListeners.get(event).add(callback)
    return () => {
      this._lifecycleListeners.get(event)?.delete(callback)
    }
  }

  _emitLifecycleEvent(event, payload) {
    const listeners = this._lifecycleListeners.get(event)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(payload)
        } catch (err) {
          console.error(`[TelegramPlatform] Lifecycle error for ${event}:`, err)
        }
      }
    }
  }

  _onActivated() {
    this._emitLifecycleEvent('activated', { isActive: true })
    this._emitLifecycleEvent('visibilitychange', { isVisible: true })
  }

  _onDeactivated() {
    this._emitLifecycleEvent('deactivated', { isActive: false })
    this._emitLifecycleEvent('visibilitychange', { isVisible: false })
  }

  _onThemeChanged() {
    this._emitLifecycleEvent('themeChanged', {
      colorScheme: this.getColorScheme(),
      themeParams: this.getThemeParams(),
    })
  }

  _onVisibilityChange() {
    const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible'
    this._emitLifecycleEvent('visibilitychange', { isVisible })
  }
}
