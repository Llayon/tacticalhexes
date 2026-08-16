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
  }

  async init() {
    this.viewport.init()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibilityChange)
    }
    return true
  }

  destroy() {
    this.viewport.destroy()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange)
    }
    this._lifecycleListeners.clear()
  }

  async requestFullscreen() {
    if (typeof document === 'undefined') return false
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
      console.warn('[BrowserPlatform] Fullscreen request non-fatal error:', err?.message || err)
    }
    return false
  }

  async exitFullscreen() {
    if (typeof document === 'undefined') return false
    try {
      if (document.exitFullscreen) {
        await document.exitFullscreen()
        return true
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen()
        return true
      }
    } catch (err) {
      console.warn('[BrowserPlatform] Exit fullscreen error:', err?.message || err)
    }
    return false
  }

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

  unlockOrientation() {
    if (typeof screen !== 'undefined' && screen.orientation?.unlock) {
      try {
        screen.orientation.unlock()
      } catch {
        // Ignored
      }
    }
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
          console.error(`[BrowserPlatform] Lifecycle callback error for ${event}:`, err)
        }
      }
    }
  }

  _onVisibilityChange() {
    const isVisible = typeof document !== 'undefined' && document.visibilityState === 'visible'
    this._emitLifecycleEvent('visibilitychange', { isVisible })
  }
}
