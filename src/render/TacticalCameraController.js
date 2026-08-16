/**
 * TacticalCameraController - Mobile-first tactical diorama camera controller.
 * Features:
 * - Stable, fixed tactical viewing angle (pitch & yaw) to ensure battle clarity.
 * - Ground-projected pan with smooth damping and world-boundary clamping.
 * - Multi-touch pinch-to-zoom and desktop wheel-to-zoom with terrain clipping limits.
 * - Clear distinction between tap (for unit/tile selection) and drag (for panning).
 * - Automatic island framing taking aspect ratio and orientation into account.
 * - Platform and viewport agnostic (consumes DOM events and viewport dimensions).
 */

import { Vector3, MathUtils } from 'three/webgpu'

export class TacticalCameraController {
  constructor(camera, domElement, options = {}) {
    this.camera = camera
    this.domElement = domElement

    // Mode: 'tactical' (fixed angle, pan/zoom) | 'free' (free rotation allowed for debug)
    this.mode = options.mode || 'tactical'

    // Fixed viewing angles (radians)
    // Yaw: 45° gives classic isometric diagonal orientation
    // Pitch: 42° gives optimal tabletop diorama depth for cliffs & elevation
    this.yaw = options.yaw ?? (Math.PI / 4)
    this.pitch = options.pitch ?? (42 * Math.PI / 180)

    // Distance limits (units)
    this.minDistance = options.minDistance ?? 20
    this.maxDistance = options.maxDistance ?? 90
    this.defaultDistance = options.defaultDistance ?? 52

    // Pan boundary limits (units from origin)
    this.panLimitRadius = options.panLimitRadius ?? 35

    // State vectors
    this.target = new Vector3(0, 0, 0)
    this.currentTarget = new Vector3(0, 0, 0)
    this.distance = this.defaultDistance
    this.currentDistance = this.defaultDistance

    // Damping factor for smooth interpolation (0 = instant, higher = slower)
    this.damping = options.damping ?? 0.12

    // Tap vs Drag threshold in pixels
    this.dragThreshold = options.dragThreshold ?? 6
    this.isDragging = false

    // Input tracking state
    this._pointers = new Map()
    this._startPointers = new Map()
    this._previousTouchDistance = null
    this._isPointerDown = false
    this._lastPointerPos = { x: 0, y: 0 }

    // Bind event handlers
    this._onPointerDown = this._onPointerDown.bind(this)
    this._onPointerMove = this._onPointerMove.bind(this)
    this._onPointerUp = this._onPointerUp.bind(this)
    this._onPointerCancel = this._onPointerCancel.bind(this)
    this._onWheel = this._onWheel.bind(this)

    this.attach(domElement)
    this._updateCameraTransform(true)
  }

  attach(domElement) {
    if (!domElement) return
    this.domElement = domElement

    domElement.addEventListener('pointerdown', this._onPointerDown, { passive: false })
    window.addEventListener('pointermove', this._onPointerMove, { passive: false })
    window.addEventListener('pointerup', this._onPointerUp, { passive: false })
    window.addEventListener('pointercancel', this._onPointerCancel, { passive: false })
    domElement.addEventListener('wheel', this._onWheel, { passive: false })
  }

  detach() {
    if (!this.domElement) return
    this.domElement.removeEventListener('pointerdown', this._onPointerDown)
    window.removeEventListener('pointermove', this._onPointerMove)
    window.removeEventListener('pointerup', this._onPointerUp)
    window.removeEventListener('pointercancel', this._onPointerCancel)
    this.domElement.removeEventListener('wheel', this._onWheel)
    this._pointers.clear()
    this._startPointers.clear()
  }

  dispose() {
    this.detach()
  }

  // ==========================================
  // Auto Framing
  // ==========================================

  /**
   * Frame the island in the center of the viewport based on island size and aspect ratio.
   * @param {Object} [islandData] Optional IslandData domain object
   * @param {Object} [options] { instant: boolean, aspect: number }
   */
  frameIsland(islandData = null, options = {}) {
    const radius = islandData?.radius ?? 5
    const aspect = options.aspect ?? (this.camera.aspect || 1.0)
    const instant = options.instant ?? false

    // Center on island origin
    this.target.set(0, 0, 0)

    // Base framing distance for radius 5 island
    // In landscape (aspect >= 1), diorama fits well at ~50-54
    // In portrait (aspect < 1), we pull back proportionally so island edges don't clip
    const baseDistance = 50 + (radius - 5) * 8
    let idealDistance = baseDistance

    if (aspect < 1.0) {
      // Portrait mode adjustment
      idealDistance = Math.min(baseDistance / Math.max(aspect, 0.55), this.maxDistance - 5)
    }

    this.distance = MathUtils.clamp(idealDistance, this.minDistance, this.maxDistance)

    if (instant) {
      this.currentTarget.copy(this.target)
      this.currentDistance = this.distance
      this._updateCameraTransform(true)
    }
  }

  /**
   * Update projection matrix on viewport resize
   */
  updateProjection(aspect) {
    if (this.camera && aspect > 0) {
      this.camera.aspect = aspect
      this.camera.updateProjectionMatrix()
    }
  }

  // ==========================================
  // Per-Frame Update
  // ==========================================

  update(_dt) {
    const lerpFactor = 1.0 - Math.pow(1.0 - this.damping, 2)

    // Smoothly interpolate target pan and zoom distance
    this.currentTarget.lerp(this.target, lerpFactor)
    this.currentDistance += (this.distance - this.currentDistance) * lerpFactor

    this._updateCameraTransform(false)
  }

  _updateCameraTransform(_force) {
    if (!this.camera) return

    // Direction vector from target to camera at fixed pitch and yaw
    const cosPitch = Math.cos(this.pitch)
    const sinPitch = Math.sin(this.pitch)
    const cosYaw = Math.cos(this.yaw)
    const sinYaw = Math.sin(this.yaw)

    const dirX = sinYaw * cosPitch
    const dirY = sinPitch
    const dirZ = cosYaw * cosPitch

    this.camera.position.set(
      this.currentTarget.x + dirX * this.currentDistance,
      this.currentTarget.y + dirY * this.currentDistance,
      this.currentTarget.z + dirZ * this.currentDistance
    )

    this.camera.lookAt(this.currentTarget)
  }

  // ==========================================
  // Pan Math (Ground Plane Projection)
  // ==========================================

  _applyPanDelta(deltaScreenX, deltaScreenY) {
    const el = this.domElement
    const height = el?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 600)
    const fovRad = (this.camera.fov || 24) * (Math.PI / 180)

    // Frustum height at current distance projected on ground plane
    const sinPitch = Math.max(Math.sin(this.pitch), 0.2)
    const groundUnitsPerPixel = (2 * Math.tan(fovRad / 2) * this.currentDistance) / (height * sinPitch)

    // Camera basis vectors on ground (Y=0)
    const cosYaw = Math.cos(this.yaw)
    const sinYaw = Math.sin(this.yaw)

    // Right vector on ground: (cosYaw, 0, -sinYaw)
    // Forward vector on ground: (-sinYaw, 0, -cosYaw)
    const dx = deltaScreenX * groundUnitsPerPixel
    const dy = deltaScreenY * groundUnitsPerPixel

    // Move target opposite to drag to move the world under pointer
    const moveX = -cosYaw * dx + sinYaw * dy
    const moveZ = sinYaw * dx + cosYaw * dy

    this.target.x += moveX
    this.target.z += moveZ

    // Clamp pan bounds so island cannot be lost off-screen
    const distFromOrigin = Math.sqrt(this.target.x * this.target.x + this.target.z * this.target.z)
    if (distFromOrigin > this.panLimitRadius) {
      const scale = this.panLimitRadius / distFromOrigin
      this.target.x *= scale
      this.target.z *= scale
    }
  }

  // ==========================================
  // Pointer & Touch Events
  // ==========================================

  _onPointerDown(e) {
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    this._startPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (this._pointers.size === 1) {
      this._isPointerDown = true
      this.isDragging = false
      this._lastPointerPos = { x: e.clientX, y: e.clientY }
    } else if (this._pointers.size === 2) {
      // Start two-finger pinch
      this._previousTouchDistance = this._getTouchDistance()
      this.isDragging = true
    }
  }

  _onPointerMove(e) {
    if (!this._pointers.has(e.pointerId)) return

    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (this._pointers.size === 1 && this._isPointerDown) {
      const start = this._startPointers.get(e.pointerId) || this._lastPointerPos
      const totalDx = e.clientX - start.x
      const totalDy = e.clientY - start.y
      const moveDistanceSq = totalDx * totalDx + totalDy * totalDy

      // Check if threshold exceeded to start drag
      if (!this.isDragging && moveDistanceSq >= this.dragThreshold * this.dragThreshold) {
        this.isDragging = true
      }

      if (this.isDragging) {
        const deltaX = e.clientX - this._lastPointerPos.x
        const deltaY = e.clientY - this._lastPointerPos.y
        this._applyPanDelta(deltaX, deltaY)
      }

      this._lastPointerPos = { x: e.clientX, y: e.clientY }
    } else if (this._pointers.size === 2) {
      // Two-finger pinch to zoom + pan
      const currentTouchDistance = this._getTouchDistance()
      if (this._previousTouchDistance != null && currentTouchDistance != null) {
        const touchDelta = this._previousTouchDistance - currentTouchDistance
        const zoomSensitivity = 0.15
        this.distance = MathUtils.clamp(
          this.distance + touchDelta * zoomSensitivity,
          this.minDistance,
          this.maxDistance
        )
      }
      this._previousTouchDistance = currentTouchDistance
    }
  }

  _onPointerUp(e) {
    this._pointers.delete(e.pointerId)
    this._startPointers.delete(e.pointerId)

    if (this._pointers.size === 0) {
      this._isPointerDown = false
      this.isDragging = false
      this._previousTouchDistance = null
    } else if (this._pointers.size === 1) {
      // Switched from pinch to 1 finger
      const remaining = Array.from(this._pointers.values())[0]
      this._lastPointerPos = { x: remaining.x, y: remaining.y }
      this._previousTouchDistance = null
    }
  }

  _onPointerCancel(e) {
    this._onPointerUp(e)
  }

  _onWheel(e) {
    e.preventDefault()
    const zoomSensitivity = 0.04
    this.distance = MathUtils.clamp(
      this.distance + e.deltaY * zoomSensitivity,
      this.minDistance,
      this.maxDistance
    )
  }

  _getTouchDistance() {
    const pts = Array.from(this._pointers.values())
    if (pts.length < 2) return null
    const dx = pts[0].x - pts[1].x
    const dy = pts[0].y - pts[1].y
    return Math.sqrt(dx * dx + dy * dy)
  }
}
