/**
 * GraphicsProfile - Mobile-first graphics quality configuration layer.
 * Manages HIGH, MEDIUM, and LOW presets for WebGPU rendering, shadows, and post-processing.
 */

export const GraphicsPreset = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
})

export const GRAPHICS_PROFILES = Object.freeze({
  [GraphicsPreset.HIGH]: Object.freeze({
    name: 'HIGH',
    maxDpr: 2.0,
    shadows: true,
    shadowMapSize: 2048,
    ao: true,
    aoDenoise: 5,
    dof: true,
    grain: true,
    vignette: true,
    decorationDensityScale: 1.0,
    waterEffects: 'full',
  }),
  [GraphicsPreset.MEDIUM]: Object.freeze({
    name: 'MEDIUM',
    maxDpr: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    ao: false, // GTAO disabled on mobile medium for stable 60fps
    aoDenoise: 0,
    dof: false,
    grain: true,
    vignette: true,
    decorationDensityScale: 0.8,
    waterEffects: 'standard',
  }),
  [GraphicsPreset.LOW]: Object.freeze({
    name: 'LOW',
    maxDpr: 1.0,
    shadows: false,
    shadowMapSize: 512,
    ao: false,
    aoDenoise: 0,
    dof: false,
    grain: false,
    vignette: false,
    decorationDensityScale: 0.5,
    waterEffects: 'simple',
  }),
})

/**
 * Heuristic to detect a sensible default profile for the current platform/device.
 * Desktop -> HIGH
 * Mobile / Telegram -> MEDIUM
 * Low-end / constrained mobile -> LOW
 */
export function detectDefaultPreset(platform = null) {
  if (typeof window === 'undefined') return GraphicsPreset.HIGH

  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
  const isMobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
  const isSmallScreen = Math.min(window.innerWidth, window.innerHeight) < 600

  // Constrained devices (low memory / very small screen / low DPR)
  const isConstrained = isTouch && (isSmallScreen && (window.devicePixelRatio || 1) <= 1.5)

  if (isConstrained) {
    return GraphicsPreset.LOW
  }

  if (platform?.isTelegram || isTouch || isMobileUa) {
    return GraphicsPreset.MEDIUM
  }

  return GraphicsPreset.HIGH
}

export class GraphicsProfileManager {
  constructor(viewport = null, initialPreset = null) {
    this.viewport = viewport
    this.currentPreset = initialPreset || detectDefaultPreset()
    this.profile = GRAPHICS_PROFILES[this.currentPreset] || GRAPHICS_PROFILES[GraphicsPreset.MEDIUM]
    this._listeners = new Set()
  }

  get name() {
    return this.profile.name
  }

  get config() {
    return this.profile
  }

  /**
   * Get the effective device pixel ratio capped by the current profile.
   * Single source of truth for both WebGPURenderer and PostFX render targets.
   */
  getEffectivePixelRatio() {
    const rawDpr = this.viewport?.getPixelRatio() ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)
    return Math.min(rawDpr, this.profile.maxDpr)
  }

  /**
   * Set active graphics preset ('HIGH' | 'MEDIUM' | 'LOW')
   */
  setPreset(presetName) {
    const upper = String(presetName).toUpperCase()
    if (!GRAPHICS_PROFILES[upper]) {
      console.warn(`[GraphicsProfile] Unknown preset: ${presetName}, ignoring`)
      return false
    }

    if (this.currentPreset === upper) return false

    this.currentPreset = upper
    this.profile = GRAPHICS_PROFILES[upper]

    this._notifyListeners()
    return true
  }

  subscribe(listener) {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  _notifyListeners() {
    for (const listener of this._listeners) {
      try {
        listener(this.profile, this.getEffectivePixelRatio())
      } catch (err) {
        console.error('[GraphicsProfile] Listener error:', err)
      }
    }
  }
}
