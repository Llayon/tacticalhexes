/**
 * TelegramPlatform - Telegram Mini App platform adapter.
 * Centralizes all interactions with window.Telegram.WebApp without leaking SDK calls elsewhere.
 */
import { TelegramViewport } from './TelegramViewport.js'

export class TelegramPlatform {
  constructor(webApp = (typeof window !== 'undefined' ? window.Telegram?.WebApp : null)) {
    this.name = 'telegram'
    this.isTelegram = true
    this.webApp = webApp
    this.viewport = new TelegramViewport(this.webApp)
    this._lifecycleListeners = new Map()

    this._onActivated = this._onActivated.bind(this)
    this._onDeactivated = this._onDeactivated.bind(this)
    this._onThemeChanged = this._onThemeChanged.bind(this)
    this._onVisibilityChange = this._onVisibilityChange.bind(this)
    this._onFullscreenChanged = this._onFullscreenChanged.bind(this)
    this._onFullscreenFailed = this._onFullscreenFailed.bind(this)
    this._onDomFullscreenChange = this._onDomFullscreenChange.bind(this)
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

        // Set background / header colors if supported
        if (typeof this.webApp.setBackgroundColor === 'function') {
          this.webApp.setBackgroundColor('#000000')
        }
        if (typeof this.webApp.setHeaderColor === 'function') {
          this.webApp.setHeaderColor('#000000')
        }

        // Bind Telegram lifecycle & fullscreen events
        if (typeof this.webApp.onEvent === 'function') {
          this.webApp.onEvent('activated', this._onActivated)
          this.webApp.onEvent('deactivated', this._onDeactivated)
          this.webApp.onEvent('themeChanged', this._onThemeChanged)
          this.webApp.onEvent('fullscreenChanged', this._onFullscreenChanged)
          this.webApp.onEvent('fullscreenFailed', this._onFullscreenFailed)
        }
      } catch (err) {
        console.warn('[TelegramPlatform] Initialization warning:', err?.message || err)
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibilityChange)
      document.addEventListener('fullscreenchange', this._onDomFullscreenChange)
      document.addEventListener('webkitfullscreenchange', this._onDomFullscreenChange)
    }

    return true
  }

  destroy() {
    this.viewport.destroy()

    if (this.webApp && typeof this.webApp.offEvent === 'function') {
      this.webApp.offEvent('activated', this._onActivated)
      this.webApp.offEvent('deactivated', this._onDeactivated)
      this.webApp.offEvent('themeChanged', this._onThemeChanged)
      this.webApp.offEvent('fullscreenChanged', this._onFullscreenChanged)
      this.webApp.offEvent('fullscreenFailed', this._onFullscreenFailed)
    }

    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange)
      document.removeEventListener('fullscreenchange', this._onDomFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', this._onDomFullscreenChange)
    }

    this._lifecycleListeners.clear()
  }

  // ==========================================
  // Fullscreen Management
  // ==========================================

  get isFullscreen() {
    if (this.webApp && typeof this.webApp.isFullscreen === 'boolean') {
      return this.webApp.isFullscreen
    }
    if (typeof document !== 'undefined') {
      return Boolean(document.fullscreenElement || document.webkitFullscreenElement)
    }
    return false
  }

  /**
   * Request fullscreen mode (Telegram Bot API 8.0+ / WebApp v8.0+)
   * Falls back to standard browser fullscreen if available.
   * Fullscreen results are asynchronous and confirmed via fullscreenChanged / fullscreenFailed events.
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

    // Fallback to standard DOM fullscreen
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
      } catch (err) {
        console.warn('[TelegramPlatform] DOM requestFullscreen non-fatal error:', err?.message || err)
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
      } catch (err) {
        console.warn('[TelegramPlatform] DOM exitFullscreen error:', err?.message || err)
      }
    }
    return false
  }

  onFullscreenChange(callback) {
    return this.onLifecycleEvent('fullscreenChanged', callback)
  }

  onFullscreenFailed(callback) {
    return this.onLifecycleEvent('fullscreenFailed', callback)
  }

  // ==========================================
  // Orientation Management
  // ==========================================

  /**
   * Lock orientation to the CURRENT screen orientation in Telegram Mini Apps (Bot API 8.0+).
   * Note: Telegram.WebApp.lockOrientation() locks to the current device orientation;
   * it does not support targeting a specific orientation name like 'landscape'.
   */
  lockCurrentOrientation() {
    if (this.webApp && typeof this.webApp.lockOrientation === 'function') {
      try {
        this.webApp.lockOrientation()
        return true
      } catch (err) {
        console.warn('[TelegramPlatform] Telegram lockOrientation non-fatal error:', err?.message || err)
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
        return true
      } catch {
        return false
      }
    }

    if (typeof screen !== 'undefined' && screen.orientation?.unlock) {
      try {
        screen.orientation.unlock()
        return true
      } catch {
        return false
      }
    }
    return false
  }

  /**
   * Browser Screen Orientation API fallback for requesting a specific orientation
   * @param {'landscape'|'portrait'} orientation
   */
  async lockOrientation(orientation = 'landscape') {
    if (typeof screen !== 'undefined' && screen.orientation?.lock) {
      try {
        await screen.orientation.lock(orientation)
        return true
      } catch {
        // Expected if device/browser doesn't support orientation locking
      }
    }

    // Fallback: lock to current orientation in Telegram
    return this.lockCurrentOrientation()
  }

  // ==========================================
  // Closing Confirmation Management
  // ==========================================

  /**
   * Enable closing confirmation dialog to prevent accidental exit during active gameplay.
   */
  enableClosingConfirmation() {
    if (this.webApp && typeof this.webApp.enableClosingConfirmation === 'function') {
      try {
        this.webApp.enableClosingConfirmation()
        return true
      } catch (err) {
        console.warn('[TelegramPlatform] enableClosingConfirmation error:', err)
      }
    }
    return false
  }

  /**
   * Disable closing confirmation dialog.
   */
  disableClosingConfirmation() {
    if (this.webApp && typeof this.webApp.disableClosingConfirmation === 'function') {
      try {
        this.webApp.disableClosingConfirmation()
        return true
      } catch (err) {
        console.warn('[TelegramPlatform] disableClosingConfirmation error:', err)
      }
    }
    return false
  }

  // ==========================================
  // User & Theme Info
  // ==========================================

  getUser() {
    return this.webApp?.initDataUnsafe?.user || null
  }

  getThemeParams() {
    return this.webApp?.themeParams || {}
  }

  getColorScheme() {
    return this.webApp?.colorScheme || 'dark'
  }

  // ==========================================
  // Event Subscriptions & Lifecycle Dispatch
  // ==========================================

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

  _onFullscreenChanged() {
    this._emitLifecycleEvent('fullscreenChanged', { isFullscreen: this.isFullscreen })
  }

  _onFullscreenFailed(eventData) {
    this._emitLifecycleEvent('fullscreenFailed', {
      error: eventData?.error || 'FULLSCREEN_REQUEST_FAILED',
    })
  }

  _onDomFullscreenChange() {
    this._emitLifecycleEvent('fullscreenChanged', { isFullscreen: this.isFullscreen })
  }

  _onVisibilityChange() {
    const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible'
    this._emitLifecycleEvent('visibilitychange', { isVisible })
  }
}
