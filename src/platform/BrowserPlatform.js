/**
 * BrowserPlatform - Standard web browser platform adapter.
 * Handles desktop/mobile browser lifecycle, fullscreen, orientation, and visibility.
 */
import { BrowserViewport } from './BrowserViewport.js'

export class BrowserPlatform {
  constructor() {
    this.name = 'browser'
    this.isTelegram = false
    this.viewport = new BrowserViewport()
    this._lifecycleListeners = new Map() // eventName -> Set<callback>
    this._onVisibilityChange = this._onVisibilityChange.bind(this)
    this._onDomFullscreenChange = this._onDomFullscreenChange.bind(this)
  }

  async init() {
    this.viewport.init()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibilityChange)
      document.addEventListener('fullscreenchange', this._onDomFullscreenChange)
      document.addEventListener('webkitfullscreenchange', this._onDomFullscreenChange)
    }
    return true
  }

  destroy() {
    this.viewport.destroy()
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
    if (typeof document !== 'undefined') {
      return Boolean(document.fullscreenElement || document.webkitFullscreenElement)
    }
    return false
  }

  async requestFullscreen() {
    if (this.isFullscreen) return true
    if (typeof document === 'undefined') return false
    try {
      const el = document.documentElement
      if (el.requestFullscreen) {
        await el.requestFullscreen()
        return this.isFullscreen
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen()
        return this.isFullscreen
      }
    } catch (err) {
      console.warn('[BrowserPlatform] Fullscreen request non-fatal error:', err?.message || err)
    }
    return false
  }

  async exitFullscreen() {
    if (!this.isFullscreen) return true
    if (typeof document === 'undefined') return false
    try {
      if (document.exitFullscreen) {
        await document.exitFullscreen()
        return !this.isFullscreen
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen()
        return !this.isFullscreen
      }
    } catch (err) {
      console.warn('[BrowserPlatform] Exit fullscreen error:', err?.message || err)
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

  async lockOrientation(orientation = 'landscape') {
    if (typeof screen !== 'undefined' && screen.orientation?.lock) {
      try {
        await screen.orientation.lock(orientation)
        return true
      } catch (err) {
        // Expected on desktop or browsers without orientation lock support
        return false
      }
    }
    return false
  }

  lockCurrentOrientation() {
    if (typeof screen !== 'undefined' && screen.orientation?.lock && screen.orientation?.type) {
      try {
        screen.orientation.lock(screen.orientation.type)
        return true
      } catch {
        return false
      }
    }
    return false
  }

  unlockOrientation() {
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

  // ==========================================
  // Closing Confirmation No-ops for Browser
  // ==========================================

  enableClosingConfirmation() {
    return false
  }

  disableClosingConfirmation() {
    return false
  }

  // ==========================================
  // User & Theme Info
  // ==========================================

  getUser() {
    return null
  }

  getThemeParams() {
    return {}
  }

  getColorScheme() {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'dark'
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
          console.error(`[BrowserPlatform] Lifecycle callback error for ${event}:`, err)
        }
      }
    }
  }

  _onDomFullscreenChange() {
    this._emitLifecycleEvent('fullscreenChanged', { isFullscreen: this.isFullscreen })
  }

  _onVisibilityChange() {
    const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible'
    this._emitLifecycleEvent('visibilitychange', { isVisible })
  }
}
