/**
 * TelegramViewport - Viewport manager tailored for Telegram Mini App environment.
 * Leverages Telegram WebApp viewportHeight, isExpanded, safeAreaInset, and contentSafeAreaInset.
 */
export class TelegramViewport {
  constructor(webApp) {
    this.webApp = webApp
    this._listeners = new Set()
    this._onViewportChanged = this._onViewportChanged.bind(this)
    this._onSafeAreaChanged = this._onSafeAreaChanged.bind(this)
    this._onWindowResize = this._onWindowResize.bind(this)
    this._isListening = false
  }

  init() {
    if (this._isListening) return

    if (this.webApp) {
      if (typeof this.webApp.onEvent === 'function') {
        this.webApp.onEvent('viewportChanged', this._onViewportChanged)
        this.webApp.onEvent('safeAreaChanged', this._onSafeAreaChanged)
        this.webApp.onEvent('contentSafeAreaChanged', this._onSafeAreaChanged)
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._onWindowResize)
      window.addEventListener('orientationchange', this._onWindowResize)
    }

    this._isListening = true
    this.updateCssCustomProperties()
  }

  destroy() {
    if (!this._isListening) return

    if (this.webApp && typeof this.webApp.offEvent === 'function') {
      this.webApp.offEvent('viewportChanged', this._onViewportChanged)
      this.webApp.offEvent('safeAreaChanged', this._onSafeAreaChanged)
      this.webApp.offEvent('contentSafeAreaChanged', this._onSafeAreaChanged)
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onWindowResize)
      window.removeEventListener('orientationchange', this._onWindowResize)
    }

    this._listeners.clear()
    this._isListening = false
  }

  getWidth() {
    if (typeof window === 'undefined') return 800
    return window.innerWidth || document.documentElement?.clientWidth || 800
  }

  getHeight() {
    // In Telegram Mini App, webApp.viewportHeight gives the visible canvas height in px
    if (this.webApp?.viewportHeight && typeof this.webApp.viewportHeight === 'number') {
      return this.webApp.viewportHeight
    }
    if (typeof window !== 'undefined') {
      return window.innerHeight || document.documentElement?.clientHeight || 600
    }
    return 600
  }

  getStableHeight() {
    if (this.webApp?.viewportStableHeight && typeof this.webApp.viewportStableHeight === 'number') {
      return this.webApp.viewportStableHeight
    }
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
    // Telegram Bot API 8.0+ safeAreaInset
    const sa = this.webApp?.safeAreaInset
    if (sa && typeof sa === 'object') {
      return {
        top: typeof sa.top === 'number' ? sa.top : 0,
        right: typeof sa.right === 'number' ? sa.right : 0,
        bottom: typeof sa.bottom === 'number' ? sa.bottom : 0,
        left: typeof sa.left === 'number' ? sa.left : 0,
      }
    }
    return {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    }
  }

  getContentSafeArea() {
    // Telegram Bot API 8.0+ contentSafeAreaInset
    const csa = this.webApp?.contentSafeAreaInset
    if (csa && typeof csa === 'object') {
      return {
        top: typeof csa.top === 'number' ? csa.top : 0,
        right: typeof csa.right === 'number' ? csa.right : 0,
        bottom: typeof csa.bottom === 'number' ? csa.bottom : 0,
        left: typeof csa.left === 'number' ? csa.left : 0,
      }
    }
    return this.getSafeArea()
  }

  isExpanded() {
    return Boolean(this.webApp?.isExpanded)
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
      contentSafeArea: this.getContentSafeArea(),
      isExpanded: this.isExpanded(),
    }
    this.updateCssCustomProperties()
    for (const listener of this._listeners) {
      try {
        listener(size)
      } catch (err) {
        console.error('[TelegramViewport] Listener error:', err)
      }
    }
  }

  _onViewportChanged(event) {
    this._notify()
  }

  _onSafeAreaChanged() {
    this._notify()
  }

  _onWindowResize() {
    this._notify()
  }

  updateCssCustomProperties() {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const w = this.getWidth()
    const h = this.getHeight()

    root.style.setProperty('--app-viewport-width', `${w}px`)
    root.style.setProperty('--app-viewport-height', `${h}px`)

    // Only override CSS env() custom properties if Telegram explicitly provides safeAreaInset
    if (this.webApp?.safeAreaInset && typeof this.webApp.safeAreaInset === 'object') {
      const sa = this.getSafeArea()
      root.style.setProperty('--app-safe-top', `${sa.top}px`)
      root.style.setProperty('--app-safe-right', `${sa.right}px`)
      root.style.setProperty('--app-safe-bottom', `${sa.bottom}px`)
      root.style.setProperty('--app-safe-left', `${sa.left}px`)
    }

    if (this.webApp?.contentSafeAreaInset && typeof this.webApp.contentSafeAreaInset === 'object') {
      const csa = this.getContentSafeArea()
      root.style.setProperty('--app-content-safe-top', `${csa.top}px`)
      root.style.setProperty('--app-content-safe-right', `${csa.right}px`)
      root.style.setProperty('--app-content-safe-bottom', `${csa.bottom}px`)
      root.style.setProperty('--app-content-safe-left', `${csa.left}px`)
    }
  }
}
