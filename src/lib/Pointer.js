import { Raycaster, Vector2, Vector3 } from 'three/webgpu'
import { uniform } from 'three/tsl'

const CLICK_THRESHOLD = 5 // Max pixels between pointerdown and pointerup to count as a click

/**
 * Helper class to handle pointer position and "down" with output exposed in vector3 and uniforms
 */
export class Pointer {
  constructor(renderer, camera, plane, viewport = null) {
    this.camera = camera
    this.renderer = renderer
    this.viewport = viewport
    this.rayCaster = new Raycaster()
    this.initPlane = plane
    this.iPlane = plane.clone()
    this.clientPointer = new Vector2()
    this.pointer = new Vector2()
    this.scenePointer = new Vector3()
    this.pointerDown = false
    this.uPointerDown = uniform(0)
    this.uPointer = uniform(new Vector3())

    // Raycast targets for hover detection
    this.raycastTargets = []
    this.onHoverCallback = null

    // Click vs drag tracking
    this.downClientX = 0
    this.downClientY = 0

    renderer.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this))
    renderer.domElement.addEventListener('pointerup', this.onPointerUp.bind(this))
    window.addEventListener('pointermove', this.onPointerMove.bind(this))
    renderer.domElement.addEventListener('contextmenu', this.onContextMenu.bind(this))
  }

  getNormalizedDeviceCoords(clientX, clientY, target = this.pointer) {
    const dom = this.renderer?.domElement
    if (dom) {
      const rect = dom.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        return target.set(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          -((clientY - rect.top) / rect.height) * 2 + 1
        )
      }
    }

    const width = this.viewport?.getWidth() || (typeof window !== 'undefined' ? window.innerWidth : 800)
    const height = this.viewport?.getHeight() || (typeof window !== 'undefined' ? window.innerHeight : 600)

    return target.set(
      (clientX / width) * 2 - 1,
      -(clientY / height) * 2 + 1
    )
  }

  setRaycastTargets(targets, callbacks) {
    this.raycastTargets = targets
    this.onHoverCallback = callbacks.onHover
    this.onPointerDownCallback = callbacks.onPointerDown
    this.onPointerUpCallback = callbacks.onPointerUp
    this.onPointerMoveCallback = callbacks.onPointerMove
    this.onRightClickCallback = callbacks.onRightClick
  }

  onPointerDown(e) {
    if (e.pointerType !== 'mouse' || e.button === 0) {
      this.pointerDown = true
      this.uPointerDown.value = 1
      this.isTouch = e.pointerType === 'touch'

      // Store down position for click vs drag detection
      this.downClientX = e.clientX
      this.downClientY = e.clientY
    }
    this.clientPointer.set(e.clientX, e.clientY)
    this.updateScreenPointer(e)
  }

  onPointerUp(e) {
    this.clientPointer.set(e.clientX, e.clientY)
    this.updateScreenPointer(e)

    if (this.pointerDown) {
      // Check if pointer moved less than threshold — it's a click, not a drag
      const dx = e.clientX - this.downClientX
      const dy = e.clientY - this.downClientY
      const isClick = (dx * dx + dy * dy) < CLICK_THRESHOLD * CLICK_THRESHOLD

      if (isClick && this.onPointerDownCallback) {
        // Raycast using the pointerup position
        this.getNormalizedDeviceCoords(e.clientX, e.clientY, this.pointer)
        this.rayCaster.setFromCamera(this.pointer, this.camera)
        const intersects = this.raycastTargets.length > 0
          ? this.rayCaster.intersectObjects(this.raycastTargets, false)
          : []
        const intersection = intersects.length > 0 ? intersects[0] : null
        this.onPointerDownCallback(intersection, e.clientX, e.clientY, this.isTouch)
      }

      if (this.onPointerUpCallback) {
        this.onPointerUpCallback(this.isTouch)
      }
    }

    this.pointerDown = false
    this.uPointerDown.value = 0
  }

  onPointerMove(e) {
    this.clientPointer.set(e.clientX, e.clientY)
    this.updateScreenPointer(e)

    // Notify callback of pointer move (for hover detection and drag)
    if (this.onPointerMoveCallback) {
      this.onPointerMoveCallback(e.clientX, e.clientY)
    }
  }

  updateScreenPointer(e) {
    if (e == null || e == undefined) {
      e = { clientX: this.clientPointer.x, clientY: this.clientPointer.y }
    }
    this.getNormalizedDeviceCoords(e.clientX, e.clientY, this.pointer)
    this.rayCaster.setFromCamera(this.pointer, this.camera)
    this.rayCaster.ray.intersectPlane(this.iPlane, this.scenePointer)
    this.uPointer.value.x = this.scenePointer.x
    this.uPointer.value.y = this.scenePointer.y
    this.uPointer.value.z = this.scenePointer.z

    // Raycast for hover detection
    if (this.raycastTargets.length > 0 && this.onHoverCallback) {
      const intersects = this.rayCaster.intersectObjects(this.raycastTargets, false)
      this.onHoverCallback(intersects.length > 0 ? intersects[0] : null)
    }
  }

  onContextMenu(e) {
    e.preventDefault()

    // Raycast for right-click detection
    if (this.raycastTargets.length > 0 && this.onRightClickCallback) {
      this.getNormalizedDeviceCoords(e.clientX, e.clientY, this.pointer)
      this.rayCaster.setFromCamera(this.pointer, this.camera)
      const intersects = this.rayCaster.intersectObjects(this.raycastTargets, false)
      if (intersects.length > 0) {
        this.onRightClickCallback(intersects[0])
        // Block the subsequent touch tap (long press triggers contextmenu then pointerup)
        this.downClientX = Infinity
      }
    }
  }

  update(dt, elapsed) {
    this.iPlane.normal.copy(this.initPlane.normal).applyEuler(this.camera.rotation)
    this.updateScreenPointer()
  }
}
