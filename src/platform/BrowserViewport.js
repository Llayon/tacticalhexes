/**
 * BrowserViewport - Standard browser viewport manager.
 * Provides unified dimensions, safe area metrics, and resize subscriptions.
 */
export class BrowserViewport {
  constructor() {
    this._listeners = new Set()
    this._onWindowResize = this._onWindowResize.bind(this)
    this._isListening = false
  }

  init() {
    if (this._isListening || typeof window === 'undefined') return
    window.addEventListener('resize', this._onWindowResize)
    window.addEventListener('orientationchange', this._onWindowResize)
    this._isListening = true
    this.updateCssCustomProperties()
  }

  destroy() {
    if (!this._isListening || typeof window === 'undefined') return
    window.removeEventListener('resize', this._onWindowResize)
    window.removeEventListener('orientationchange', this._onWindowResize)
    this._listeners.clear()
    this._isListening = false
  }

  getWidth() {
    if (typeof window === 'undefined') return 800
    return window.innerWidth || document.documentElement?.clientWidth || 800
  }

  getHeight() {
    if (typeof window === 'undefined') return 600
    return window.innerHeight || document.documentElement?.clientHeight || 600
  }

  getStableHeight() {
    return this.getHeight()
  }

  getAspect() {
    const h = this.getHeight()
    return h > 0 ? this.getWidth() / h : 1
  }

  getPixelRatio() {
    if (typeof window === 'undefined') return 1
    return Math.min(window.devicePixelRatio || 1, 2)
  }

  getSafeArea() {
    return {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    }
  }

  getContentSafeArea() {
    return {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    }
  }

  subscribe(callback) {
    this._listeners.add(callback)
    return () => this._listeners.delete(callback)
  }

  _notify() {
    const size = {
      width: this.getWidth(),
      height: this.getHeight(),
      stableHeight: this.getStableHeight(),
      aspect: this.getAspect(),
      safeArea: this.getSafeArea(),
    }
    this.updateCssCustomProperties()
    for (const listener of this._listeners) {
      try {
        listener(size)
      } catch (err) {
        console.error('[BrowserViewport] Listener error:', err)
      }
    }
  }

  _onWindowResize() {
    this._notify()
  }

  updateCssCustomProperties() {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const sa = this.getSafeArea()
    const w = this.getWidth()
    const h = this.getHeight()

    root.style.setProperty('--app-safe-top', `${sa.top}px`)
    root.style.setProperty('--app-safe-right', `${sa.right}px`)
    root.style.setProperty('--app-safe-bottom', `${sa.bottom}px`)
    root.style.setProperty('--app-safe-left', `${sa.left}px`)
    root.style.setProperty('--app-viewport-width', `${w}px`)
    root.style.setProperty('--app-viewport-height', `${h}px`)
  }
}
