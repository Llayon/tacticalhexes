import {
  Timer,
  OrthographicCamera,
  PerspectiveCamera,
  Vector2,
  Vector3,
  Scene,
  Plane,
  WebGPURenderer,
  PCFShadowMap,
} from 'three/webgpu'
import { CSS2DRenderer } from 'three/examples/jsm/Addons.js'
import Stats from 'three/addons/libs/stats.module.js'
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js'
import { Pointer } from './lib/Pointer.js'
import { GUIManager } from './GUI.js'
import { HexMap } from './hexmap/HexMap.js'
import { Lighting } from './Lighting.js'
import { PostFX } from './PostFX.js'
import { WavesMask } from './hexmap/effects/WavesMask.js'
import { setSeed } from './SeededRandom.js'
import { LEVELS_COUNT } from './hexmap/HexTileData.js'
import { getPlatform } from './platform/index.js'
import { GraphicsProfileManager } from './render/GraphicsProfile.js'
import { TacticalCameraController } from './render/TacticalCameraController.js'
import { PlayerSquadController } from './gameplay/PlayerSquadController.js'
import gsap from 'gsap'

// Global status update function
export function setStatus(text) {
  if (App.instance?.statusElement) {
    App.instance.statusElement.textContent = text
  }
}

// Set status and yield to browser so the paint is visible
export function setStatusAsync(text) {
  setStatus(text)
  return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
}

// Log to both console and status bar
export function log(text, style = '') {
  if (style) {
    console.log(`%c${text}`, style)
  } else {
    console.log(text)
  }
  setStatus(text, style)
}

export class App {
  static instance = null

  constructor(canvas, platform = null) {
    this.canvas = canvas
    this.platform = platform || getPlatform()
    this.viewport = this.platform.viewport
    this._unsubscribeViewport = null
    this._unsubscribeProfile = null
    this.graphicsProfile = new GraphicsProfileManager({ viewport: this.viewport, platform: this.platform })
    this.renderer = null
    this.orthoCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
    this.perspCamera = new PerspectiveCamera(30, 1, 1, 1000)
    this.camera = this.perspCamera
    this.cameraController = null
    this.controls = null // Alias for backward compatibility
    this.postFX = null
    this.scene = new Scene()
    this.pointerHandler = null
    this.timer = new Timer()
    // Module instances
    this.gui = null
    this.city = null
    this.lighting = null
    this.params = null
    this.cssRenderer = null  // CSS2DRenderer for debug labels
    this.buildMode = false  // false = Move (camera only), true = Build (click to WFC)

    if (App.instance != null) {
      console.warn('App instance already exists')
      return null
    }
    App.instance = this
    window.app = this  // Expose for console debugging
  }

  async init() {
    await this.platform.init()

    let renderer = null
    const hasWebGPU = WebGPU.isAvailable()

    if (hasWebGPU) {
      try {
        renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true })
        await renderer.init()
        console.log('[Renderer] WebGPU backend initialized')
      } catch (err) {
        console.warn('[Renderer] WebGPU initialization failed, attempting WebGL2 fallback:', err)
        renderer = null
      }
    }

    if (!renderer) {
      try {
        renderer = new WebGPURenderer({ canvas: this.canvas, antialias: true, forceWebGL: true })
        await renderer.init()
        console.log('[Renderer] WebGL2 fallback backend initialized')
      } catch (fallbackErr) {
        console.error('[Renderer] Both WebGPU and WebGL2 backends failed:', fallbackErr)
        if (this.statusElement) {
          this.statusElement.textContent = 'Graphics initialization failed: WebGPU / WebGL2 not supported.'
        }
        return
      }
    }

    this.renderer = renderer

    const seed = Math.floor(Math.random() * 100000)
    setSeed(seed)
    console.log(`%c[SEED] ${seed}`, 'color: black')
    console.log(`%c[LEVELS] ${LEVELS_COUNT}`, 'color: black')

    const initialDpr = this.graphicsProfile.getEffectivePixelRatio()
    this.renderer.setPixelRatio(initialDpr)
    this.renderer.setSize(this.viewport.getWidth(), this.viewport.getHeight())
    this.renderer.shadowMap.enabled = this.graphicsProfile.config.shadows
    this.renderer.shadowMap.type = PCFShadowMap

    this._unsubscribeViewport = this.viewport.subscribe(this.onResize.bind(this))

    // Initialize params from defaults and sync initial state with active profile
    this.params = JSON.parse(JSON.stringify(GUIManager.defaultParams))
    this.params.fx.ao = this.graphicsProfile.config.ao
    this.params.fx.dof = this.graphicsProfile.config.dof
    this.params.fx.grain = this.graphicsProfile.config.grain
    this.params.fx.vignette = this.graphicsProfile.config.vignette
    this.params.renderer.dpr = initialDpr

    this.initCamera()
    this.initPostProcessing()
    this.initStats()
    this.initCSSRenderer()
    this.initStatusOverlay()
    this.initModeButtons()

    this.seedElement.textContent = `seed: ${seed}`

    this.onResize()
    this.pointerHandler = new Pointer(
      this.renderer,
      this.camera,
      new Plane(new Vector3(0, 1, 0), 0),
      this.viewport,
      { cameraController: this.cameraController }
    )

    // Initialize modules
    this.lighting = new Lighting(this.scene, this.renderer, this.params)
    this.city = new HexMap(this.scene, this.params)
    // Pass coast mask RT texture so water shader can sample it directly
    this.city.coastMaskTexture = this.wavesMask.texture
    this.city.coveMaskTexture = this.wavesMask.coveTexture

    await this.lighting.init()
    await this.city.init()

    // Initialize gameplay player squad controller
    this.squadController = new PlayerSquadController({
      scene: this.scene,
      hexMap: this.city,
    })

    // Hook squad controller to hex map cell clicks
    this.city.interaction.onCellClicked = (cell) => {
      return this.squadController.handleCellClicked(cell)
    }

    // Invalidate squad on regeneration start
    this.city.onBeforeIslandGenerated = () => {
      this.squadController.invalidate()
    }

    // Initialize squad when island generation completes
    this.city.onIslandGenerated = (islandData, navGrid) => {
      this.squadController.initIsland(islandData, navGrid)
    }

    if (this.city.currentIsland && this.city.navGrid) {
      this.squadController.initIsland(this.city.currentIsland, this.city.navGrid)
    }

    // Water mask: swap tile materials to unlit B&W mask material for mask RT render
    this._savedMats = new Map()
    this.postFX.onWaterMaskRender = (enabled) => {
      if (enabled) {
        const maskMat = this.city?.waterMaskMaterial
        if (!maskMat || !this.city?.grids) return
        for (const grid of this.city.grids.values()) {
          if (grid.hexMesh && grid.hexMesh.material) {
            this._savedMats.set(grid.hexMesh, grid.hexMesh.material)
            grid.hexMesh.material = maskMat
          }
          if (grid.decorations?.mesh && grid.decorations.mesh.material) {
            this._savedMats.set(grid.decorations.mesh, grid.decorations.mesh.material)
            grid.decorations.mesh.material = maskMat
          }
        }
      } else {
        for (const [mesh, mat] of this._savedMats) {
          if (mesh && mat) mesh.material = mat
        }
        this._savedMats.clear()
      }
    }

    // Shared tween target for wave uniforms — gsap.to overwrites previous tweens automatically
    this._waveFade = { opacity: 0, gradOpacity: 0, mask: 0 }

    // Fade out waves immediately when a new grid starts building
    this.city.onBeforeTilesChanged = () => {
      if (this.city._autoBuilding) return
      const opacity = this.city._waveOpacity
      if (!opacity || opacity.value === 0) return

      // Cancel any pending mask render from a previous build
      if (this._pendingMaskRender) {
        this._pendingMaskRender.cancelled = true
        this._pendingMaskRender = null
      }

      // Kill any running wave tweens and sync target with current uniforms
      gsap.killTweensOf(this._waveFade)
      this._waveFade.opacity = opacity.value
      this._waveFade.gradOpacity = this.city._waveGradientOpacity?.value ?? 0
      this._waveFade.mask = this.city._waveMaskStrength?.value ?? 1

      gsap.to(this._waveFade, {
        opacity: 0, gradOpacity: 0, mask: 0,
        duration: 0.5,
        onUpdate: () => {
          opacity.value = this._waveFade.opacity
          if (this.city._waveGradientOpacity) this.city._waveGradientOpacity.value = this._waveFade.gradOpacity
          if (this.city._waveMaskStrength) this.city._waveMaskStrength.value = this._waveFade.mask
        },
      })
    }

    // After tiles drop, re-render mask and fade waves back in
    this._pendingMaskRender = null
    this.city.onTilesChanged = (animDonePromise) => {
      if (this.city._autoBuilding) return
      const opacity = this.city._waveOpacity
      if (!opacity) return

      // Kill previous pending mask render (e.g. during rapid sequential builds)
      if (this._pendingMaskRender) {
        this._pendingMaskRender.cancelled = true
        this._pendingMaskRender = null
      }

      const token = { cancelled: false }
      this._pendingMaskRender = token

      const renderMask = () => {
        if (token.cancelled) return

        // Kill any running wave tweens, snap to 0, render mask, fade back up
        gsap.killTweensOf(this._waveFade)
        opacity.value = 0
        if (this.city._waveGradientOpacity) this.city._waveGradientOpacity.value = 0
        if (this.city._waveMaskStrength) this.city._waveMaskStrength.value = 0
        this._waveFade.opacity = 0
        this._waveFade.gradOpacity = 0
        this._waveFade.mask = 0

        const tileMeshes = []
        if (this.city?.grids) {
          for (const grid of this.city.grids.values()) {
            if (grid.hexMesh) tileMeshes.push(grid.hexMesh)
          }
        }
        if (this.wavesMask && this.city?.waterPlane && this.city?.globalCells) {
          this.wavesMask.render(this.scene, tileMeshes, this.city.waterPlane, this.city.globalCells)
        }

        gsap.to(this._waveFade, {
          opacity: this.params.waves.opacity,
          gradOpacity: this.params.waves.gradientOpacity,
          mask: 1,
          duration: 2, delay: 1,
          onUpdate: () => {
            opacity.value = this._waveFade.opacity
            if (this.city._waveGradientOpacity) this.city._waveGradientOpacity.value = this._waveFade.gradOpacity
            if (this.city._waveMaskStrength) this.city._waveMaskStrength.value = this._waveFade.mask
          },
        })
      }

      // Wait for drop animation to finish, then render mask
      const promise = animDonePromise || Promise.resolve()
      promise.then(renderMask)
    }

    // Set up hover and click detection on hex tiles and placeholders
    this.pointerHandler.setRaycastTargets(
      [],  // Dynamic targets - we'll handle raycasting in callbacks
      {
        onHover: (intersection) => this.city.onHover(intersection),
        onPointerDown: (intersection, clientX, clientY, isTouch) => {
          // Convert client coords to normalized device coordinates
          const pointer = this.pointerHandler.getNormalizedDeviceCoords(clientX, clientY, new Vector2())
          // Check placeholders
          if (this.city.onPointerDown(pointer, this.camera)) {
            return true  // Placeholder was clicked
          }
          return false
        },
        onPointerUp: (isTouch, touchIntersection) => this.city.onPointerUp(isTouch, touchIntersection),
        onPointerMove: (clientX, clientY) => {
          // Convert client coords to normalized device coordinates
          const pointer = this.pointerHandler.getNormalizedDeviceCoords(clientX, clientY, new Vector2())
          // Update placeholder hover state
          this.city.onPointerMove(pointer, this.camera)
        },
        onRightClick: (intersection) => this.city.onRightClick(intersection)
      }
    )

    // Initialize GUI after modules are ready
    this.gui = new GUIManager(this)
    this.gui.init()
    this.gui.gui.domElement.classList.add('gui-hidden')
    this.gui.applyParams()

    // Consistently apply active GraphicsProfile across all systems now that Renderer, PostFX, Lighting, GUI exist
    this.applyGraphicsProfile(this.graphicsProfile.config, initialDpr)

    // Subscribe to profile changes (HIGH, MEDIUM, LOW)
    this._unsubscribeProfile = this.graphicsProfile.subscribe((profile, dpr) => {
      this.applyGraphicsProfile(profile, dpr)
    })

    // Move FPS meter into GUI panel, above DPR
    this.stats.dom.style.display = ''
    this.stats.dom.style.position = 'relative'
    this.stats.dom.style.top = ''
    this.stats.dom.style.left = '106px'
    const guiChildren = this.gui.gui.domElement.querySelector('.children')
    const dprEl = guiChildren?.firstElementChild
    if (dprEl) guiChildren.insertBefore(this.stats.dom, dprEl)
    else this.gui.gui.domElement.prepend(this.stats.dom)

    // Pre-render full pipeline to compile GPU shaders while screen is still black
    // BatchedMeshes already have a dummy instance from initMeshes()
    const tileMeshes = []
    if (this.city?.grids) {
      for (const grid of this.city.grids.values()) {
        if (grid.hexMesh) tileMeshes.push(grid.hexMesh)
      }
    }
    if (this.wavesMask && this.city?.waterPlane && this.city?.globalCells) {
      this.wavesMask.render(this.scene, tileMeshes, this.city.waterPlane, this.city.globalCells)
    }
    if (this.city) {
      this.postFX.setOverlayObjects(this.city.getOverlayObjects?.() || [])
      this.postFX.setWaterObjects(this.city.getWaterObjects?.() || [])
    }
    this.postFX.render()

    this.timer.connect(document)

    // Frame rate limiting with drift compensation
    const targetFPS = 60
    const frameInterval = 1000 / targetFPS
    let lastFrameTime = 0

    const loop = (currentTime) => {
      requestAnimationFrame(loop)
      const delta = currentTime - lastFrameTime
      if (delta >= frameInterval) {
        lastFrameTime = currentTime - (delta % frameInterval)
        this.animate()
      }
    }
    requestAnimationFrame(loop)
  }

  initCamera() {
    // Tactical perspective camera setup
    this.perspCamera.position.set(0, 48, 36)
    this.perspCamera.fov = 24
    this.updatePerspFrustum()

    // Instantiate mobile-first TacticalCameraController
    this.cameraController = new TacticalCameraController(this.perspCamera, this.canvas, {
      mode: 'tactical',
      minDistance: 20,
      maxDistance: 90,
      defaultDistance: 52,
      panLimitRadius: 35,
    })
    this.controls = this.cameraController // Backward-compatible alias

    // Frame initial island
    const aspect = this.viewport?.getAspect() || 1.0
    this.cameraController.frameIsland({ radius: 5 }, { instant: true, aspect })
  }

  updateOrthoFrustum() {
    const frustumSize = 100
    const aspect = this.viewport?.getAspect() || ((typeof window !== 'undefined' ? window.innerWidth : 800) / (typeof window !== 'undefined' ? window.innerHeight : 600))
    this.orthoCamera.left = -frustumSize * aspect / 2
    this.orthoCamera.right = frustumSize * aspect / 2
    this.orthoCamera.top = frustumSize / 2
    this.orthoCamera.bottom = -frustumSize / 2
    this.orthoCamera.updateProjectionMatrix()
  }

  updatePerspFrustum() {
    const aspect = this.viewport?.getAspect() || ((typeof window !== 'undefined' ? window.innerWidth : 800) / (typeof window !== 'undefined' ? window.innerHeight : 600))
    this.cameraController?.updateProjection(aspect)
    this.perspCamera.aspect = aspect
    this.perspCamera.updateProjectionMatrix()
  }

  initPostProcessing() {
    this.postFX = new PostFX(this.renderer, this.scene, this.camera, this.viewport)
    this.postFX.fadeOpacity.value = 0 // Start black
    this.wavesMask = new WavesMask(this.renderer)

    // Expose uniforms for GUI access (aliased from PostFX)
    this.aoEnabled = this.postFX.aoEnabled
    this.vignetteEnabled = this.postFX.vignetteEnabled
    this.debugView = this.postFX.debugView
    this.aoDenoiseRadius = this.postFX.aoDenoiseRadius
    this.aoIntensity = this.postFX.aoIntensity
    this.aoPass = this.postFX.aoPass
    this.dofEnabled = this.postFX.dofEnabled
    this.dofFocus = this.postFX.dofFocus
    this.dofFocalLength = this.postFX.dofFocalLength
    this.dofBokehScale = this.postFX.dofBokehScale
    this.grainEnabled = this.postFX.grainEnabled
    this.grainStrength = this.postFX.grainStrength
  }

  applyGraphicsProfile(profile, effectiveDpr) {
    if (this.renderer) {
      this.renderer.setPixelRatio(effectiveDpr)
      if (this.renderer.shadowMap) {
        this.renderer.shadowMap.enabled = profile.shadows
      }
    }

    if (this.postFX) {
      this.postFX.setEffectivePixelRatio(effectiveDpr)
      this.postFX.aoEnabled.value = profile.ao ? 1 : 0
      this.postFX.dofEnabled.value = profile.dof ? 1 : 0
      this.postFX.grainEnabled.value = profile.grain ? 1 : 0
      this.postFX.vignetteEnabled.value = profile.vignette ? 1 : 0
    }

    if (this.lighting) {
      this.lighting.setShadowsEnabled(profile.shadows)
      this.lighting.setShadowMapSize(profile.shadowMapSize)
    }

    // Sync app.params so GUI controls and internal state match the profile baseline
    if (this.params) {
      if (this.params.fx) {
        this.params.fx.ao = profile.ao
        this.params.fx.dof = profile.dof
        this.params.fx.grain = profile.grain
        this.params.fx.vignette = profile.vignette
      }
      if (this.params.renderer) {
        this.params.renderer.dpr = effectiveDpr
      }
    }

    if (this.gui) {
      this.gui.syncProfileDisplay(profile, effectiveDpr)
    }

    this.onResize()
  }

  initStats() {
    this.stats = new Stats()
    this.stats.showPanel(0) // 0: fps, 1: ms, 2: mb
    this.stats.dom.style.display = 'none'
    document.body.appendChild(this.stats.dom)
  }

  initCSSRenderer() {
    const width = this.viewport?.getWidth() || (typeof window !== 'undefined' ? window.innerWidth : 800)
    const height = this.viewport?.getHeight() || (typeof window !== 'undefined' ? window.innerHeight : 600)
    this.cssRenderer = new CSS2DRenderer()
    this.cssRenderer.setSize(width, height)
    this.cssRenderer.domElement.style.position = 'absolute'
    this.cssRenderer.domElement.style.top = '0'
    this.cssRenderer.domElement.style.left = '0'
    this.cssRenderer.domElement.style.pointerEvents = 'none'
    this.cssRenderer.domElement.style.zIndex = '1'  // Below GUI (lil-gui uses z-index 9999)
    document.body.appendChild(this.cssRenderer.domElement)
  }

  initStatusOverlay() {
    this.statusElement = document.getElementById('status-text')
    this.seedElement = { textContent: '' } // no-op stub (seed hidden in HTML)
  }

  initModeButtons() {
    const addHover = (btn) => {
      btn.addEventListener('mouseenter', () => {
        if (!btn._noHoverBorder) btn.style.borderColor = 'rgba(255,255,255,0.7)'
      })
      btn.addEventListener('mouseleave', () => {
        btn.style.borderColor = btn._activeBorder || 'rgba(255,255,255,0.3)'
      })
    }

    const btnBase = `
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.3);
      background: transparent;
      color: rgba(255,255,255,0.8);
      font-family: 'Inter', sans-serif;
      font-size: 12px;
      cursor: pointer;
      backdrop-filter: blur(4px);
      padding: 8px 13px;
      text-shadow: 0 1px 3px rgba(0,0,0,0.48);
    `

    // Buttons container (bottom-left)
    const container = document.createElement('div')
    container.id = 'ui-menu'
    container.style.cssText = `
      position: fixed;
      bottom: calc(10px + var(--app-safe-bottom, 0px));
      left: calc(10px + var(--app-safe-left, 0px));
      display: flex;
      flex-direction: row;
      gap: 9px;
      z-index: 1000;
    `
    document.body.appendChild(container)

    // Mode toggle (Move | Build)
    const toggle = document.createElement('div')
    toggle.style.cssText = `
      display: flex;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.3);
      background: transparent;
      overflow: hidden;
      backdrop-filter: blur(4px);
    `
    const modeButtons = {}
    const setMode = (key) => {
      this.buildMode = key === 'build'
      for (const [k, btn] of Object.entries(modeButtons)) {
        btn.style.background = k === key ? 'rgba(255,255,255,0.3)' : 'transparent'
      }
    }
    for (const { key, label } of [{ key: 'move', label: 'Move' }, { key: 'build', label: 'Build' }]) {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.style.cssText = `
        padding: 8px 13px;
        border: none;
        background: ${key === 'move' ? 'rgba(255,255,255,0.3)' : 'transparent'};
        color: rgba(255,255,255,0.8);
        font-family: 'Inter', sans-serif;
        font-size: 12px;
        cursor: pointer;
        text-shadow: 0 1px 3px rgba(0,0,0,0.48);
      `
      btn.addEventListener('mouseenter', () => { toggle.style.borderColor = 'rgba(255,255,255,0.7)' })
      btn.addEventListener('mouseleave', () => { toggle.style.borderColor = 'rgba(255,255,255,0.3)' })
      btn.addEventListener('pointerdown', (e) => e.stopPropagation())
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        setMode(key)
      })
      modeButtons[key] = btn
      toggle.appendChild(btn)
      if (key === 'move') {
        const divider = document.createElement('div')
        divider.style.cssText = 'width: 1px; background: rgba(255,255,255,0.3); align-self: stretch;'
        toggle.appendChild(divider)
      }
    }
    container.appendChild(toggle)

    // Action buttons for Single Island
    const actions = [
      { label: 'New Island', action: () => {
        const nextSeed = Math.floor(Math.random() * 1000000)
        if (this.params) this.params.seed = nextSeed
        if (this.seedElement) this.seedElement.textContent = `seed: ${nextSeed}`
        this.city.generateIsland({ seed: nextSeed })
      }},
      { label: 'Regenerate', action: () => {
        this.city.regenerate({ seed: this.city.currentSeed })
      }},
    ]

    for (const { label, action } of actions) {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.style.cssText = btnBase
      addHover(btn)
      btn.addEventListener('pointerdown', (e) => e.stopPropagation())
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        action()
      })
      container.appendChild(btn)
    }

    // Settings toggle
    const guiBtn = document.createElement('button')
    guiBtn.textContent = 'Controls'
    guiBtn.style.cssText = btnBase
    let guiVisible = false
    const guiEl = this.gui?.gui?.domElement
    if (guiEl) guiEl.classList.add('gui-hidden')
    const updateGuiBtn = () => {
      guiBtn.style.background = guiVisible ? 'rgba(255,255,255,0.3)' : 'transparent'
    }
    updateGuiBtn()
    addHover(guiBtn)
    guiBtn.addEventListener('pointerdown', (e) => e.stopPropagation())
    guiBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const guiEl = this.gui?.gui?.domElement
      if (!guiEl) return
      guiVisible = !guiVisible
      guiEl.classList.toggle('gui-hidden', !guiVisible)
      updateGuiBtn()
    })
    container.appendChild(guiBtn)
  }

  onResize(_e, toSize) {
    const { renderer, cssRenderer, postFX, viewport, graphicsProfile } = this
    const width = toSize?.width ?? toSize?.x ?? viewport?.getWidth() ?? (typeof window !== 'undefined' ? window.innerWidth : 800)
    const height = toSize?.height ?? toSize?.y ?? viewport?.getHeight() ?? (typeof window !== 'undefined' ? window.innerHeight : 600)
    const effectiveDpr = graphicsProfile?.getEffectivePixelRatio() ?? (viewport?.getPixelRatio() || 1)

    this.updateOrthoFrustum()
    this.updatePerspFrustum()

    if (renderer) {
      renderer.setPixelRatio(effectiveDpr)
      renderer.setSize(width, height)
      renderer.domElement.style.width = `${width}px`
      renderer.domElement.style.height = `${height}px`
    }

    if (cssRenderer) {
      cssRenderer.setSize(width, height)
    }

    // Resize overlay and postfx render targets with effective DPR
    if (postFX) {
      postFX.resize(width, height, effectiveDpr)
    }
  }

  animate() {
    this.stats.begin()

    const { timer, postFX, cameraController } = this

    timer.update()
    const dt = timer.getDelta()

    if (cameraController) {
      cameraController.update(dt)
      if (cameraController.target.y < 0) cameraController.target.y = 0
      this.lighting.updateShadowCamera(cameraController.currentTarget, this.camera, this.orthoCamera, this.perspCamera)

      // Auto-focus DOF on tactical camera target, scale focal length with zoom
      const dist = this.camera.position.distanceTo(cameraController.currentTarget)
      postFX.dofFocus.value = dist
      const t = Math.min(Math.max((dist - 20) / (90 - 20), 0), 1) // 0=zoomed in, 1=zoomed out
      postFX.dofFocalLength.value = 20 + t * 80 // 20 at close, 100 at far
    }

    // Animate grain noise — quantize to noiseFPS for film-like grain (0 = static)
    const noiseFPS = this.params.fx.grainFPS
    if (noiseFPS > 0) {
      postFX.grainTime.value = Math.floor(timer.getElapsed() * noiseFPS) / noiseFPS
    }

    // Update debris physics
    this.city?.update(dt)

    // Update gameplay squad simulation & visuals
    this.squadController?.update(dt)

    // Update render layers
    const maskObjects = []
    if (this.city?.grids) {
      for (const grid of this.city.grids.values()) {
        if (grid.hexMesh) maskObjects.push(grid.hexMesh)
        if (grid.decorations?.mesh) maskObjects.push(grid.decorations.mesh)
      }
    }
    if (this.postFX && this.city) {
      postFX.setWaterMaskObjects(maskObjects)
      postFX.setOverlayObjects(this.city.getOverlayObjects?.() || [])
      postFX.setWaterObjects(this.city.getWaterObjects?.() || [])
      postFX.render()
    }

    // Debug: show coast mask RT in bottom-left corner
    if (this.wavesMask?.showDebug) this.wavesMask.renderDebug()

    // Always render CSS labels (individual label.visible controls what shows)
    if (this.cssRenderer) {
      this.cssRenderer.render(this.scene, this.camera)
    }

    this.stats.end()
  }

  exportPNG({ format = 'image/jpeg', quality = 0.85, filename } = {}) {
    // Render one frame to ensure canvas is up to date
    this.postFX.render()

    // Get canvas data
    const canvas = this.renderer.domElement
    const ext = format === 'image/png' ? 'png' : 'jpg'
    const name = filename || `city-${Date.now()}.${ext}`
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)
    }, format, quality)
  }

  fadeIn(duration = 1000) {
    gsap.to(this.postFX.fadeOpacity, { value: 1, duration: duration / 1000 })
  }
}
