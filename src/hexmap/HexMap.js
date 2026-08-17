import {
  Object3D,
  MeshPhysicalNodeMaterial,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Mesh,
  TextureLoader,
  SRGBColorSpace,
} from 'three/webgpu'
import { uniform, varyingProperty, materialColor, diffuseColor, materialOpacity, vec3, vec4, texture, uv, mix, select, positionGeometry, float, clamp } from 'three/tsl'
import { cubeKey, parseCubeKey, cubeCoordsInRadius, offsetToCube, cubeToOffset } from './HexWFCCore.js'
import { WFCManager } from './WFCManager.js'
import { HexMapDebug } from './HexMapDebug.js'
import { HexMapInteraction } from './HexMapInteraction.js'
import { setStatus, setStatusAsync, log, App } from '../App.js'
import { TILE_LIST, TileType, LEVELS_COUNT } from './HexTileData.js'
import { HexTileGeometry } from './HexTiles.js'
import { HexGrid, HexGridState } from './HexGrid.js'
import { initGlobalTreeNoise, rebuildNoiseTables, Decorations } from './Decorations.js'
import { Water } from './effects/Water.js'
import { random, setSeed } from '../SeededRandom.js'
import { Sounds } from '../lib/Sounds.js'
import { IslandGenerator } from '../world/IslandGenerator.js'
import { NavigationGrid } from '../navigation/NavigationGrid.js'

const LEVEL_HEIGHT = 0.5
const TILE_SURFACE = 1

/**
 * HexMap - Single Island World Manager.
 * Orchestrates pure island data generation, visual representation (HexGrid),
 * water simulation, lighting, and terrain materials.
 */
export class HexMap {
  constructor(scene, params) {
    this.scene = scene
    this.params = params

    // Island grid radius: radius 5 = 91 hex cells
    this.hexGridRadius = 5
    this.currentSeed = 10001
    this.currentIsland = null

    // Grid management - single active island grid
    this.grids = new Map() // key: "0,0", value: HexGrid instance
    this.roadMaterial = null

    // Global cell map — all collapsed cells on current island
    // key: "q,r,s" cube coords, value: { q, r, s, type, rotation, level, gridKey }
    this.globalCells = new Map()

    // WFC solver (owns worker, rules, and cell helpers)
    this.wfcManager = new WFCManager(this.globalCells)
    this.islandGenerator = new IslandGenerator(this.wfcManager)

    // Debug tile labels
    this.tileLabels = new Object3D()
    this.tileLabels.visible = false
    this.tileLabelMode = 'coords'
    this.failedCells = new Set()
    this.conflictCount = 0
    this.droppedCells = new Set()
    this.replacedCells = new Set()
    this.seededCells = new Set()

    // Interaction (hover, pointer events)
    this.interaction = new HexMapInteraction(this)

    // Debug/display manager
    this.debug = new HexMapDebug(this)

    // Helper visibility state
    this.helpersVisible = false
    this.axesHelpersVisible = false

    // Regeneration state (prevents overlay rendering during disposal)
    this.isRegenerating = false
    this._buildCancelled = false
    this._buildEpoch = 0

    // WFC solve queue
    this._wfcBusy = false
    this._wfcQueue = []
    this._wfcIdleResolve = null
    this._waterSideIndex = null

    this.hexWfcRules = null
  }

  async init() {
    // Load primary terrain assets
    try {
      await HexTileGeometry.init('./assets/models/hex-terrain.glb')
    } catch (err) {
      console.warn('Fallback loading tiles.glb...', err)
      await HexTileGeometry.init('./assets/models/tiles.glb')
    }

    if (HexTileGeometry.gltfScene) {
      Decorations.initGeometries(HexTileGeometry.gltfScene)
    }

    this.createFloor()
    this.water = new Water(this.scene, this.coastMaskTexture, this.coveMaskTexture)
    this.water.init()
    await this.initMaterial()
    this.initWfcRules()
    this.initWfcWorker()
    initGlobalTreeNoise()

    // Hover highlight
    this.interaction.initHoverHighlight()

    this.scene.add(this.tileLabels)

    // Generate initial single island
    await this.generateIsland({ seed: this.currentSeed, animate: false })
  }

  /**
   * Generate a single procedural island from seed
   * @param {Object} options
   * @param {number} [options.seed]
   * @param {boolean} [options.animate=true]
   * @returns {Promise<IslandData>}
   */
  async generateIsland({ seed = Math.floor(Math.random() * 1000000), animate = true } = {}) {
    this.currentSeed = seed
    setSeed(seed)
    rebuildNoiseTables()

    log(`[HexMap] Generating Island (seed: ${seed}, radius: ${this.hexGridRadius})...`, 'color: #4a9eff')

    this.isRegenerating = true
    this.currentIsland = null
    this.navGrid = null
    this.onBeforeIslandGenerated?.()
    this.onBeforeTilesChanged?.()

    this.globalCells.clear()
    this.failedCells.clear()
    this.conflictCount = 0
    this.droppedCells.clear()
    this.replacedCells.clear()
    this.seededCells.clear()
    this.clearTileLabels()

    // Dispose old visual grid
    const oldGrids = Array.from(this.grids.values())
    this.grids.clear()
    for (const g of oldGrids) {
      this.scene.remove(g.group)
      setTimeout(() => g.dispose(), 400)
    }

    // Step 1: Generate domain data via IslandGenerator
    let islandData = null
    try {
      islandData = await this.islandGenerator.generate({
        seed,
        radius: this.hexGridRadius,
        tileTypes: this.getDefaultTileTypes(),
      })
      this.currentIsland = islandData
      this.navGrid = new NavigationGrid(islandData)
    } catch (e) {
      console.error('[HexMap] Island generation failed, falling back:', e)
      Sounds.play('incorrect')
      this.currentIsland = null
      this.navGrid = null
      this.isRegenerating = false
      return null
    }

    // Step 2: Create visual HexGrid
    const grid = new HexGrid(
      this.scene,
      this.roadMaterial,
      this.hexGridRadius,
      { x: 0, z: 0 }
    )
    grid.gridCoords = { x: 0, z: 0 }
    grid.state = HexGridState.POPULATED
    this.grids.set('0,0', grid)
    await grid.init(HexTileGeometry.geoms, { hidden: false })

    // Step 3: Populate cells
    const solvedTiles = islandData.getAllCells().map(c => ({
      q: c.q,
      r: c.r,
      s: c.s,
      type: c.type,
      rotation: c.rotation,
      level: c.level,
    }))

    this.addToGlobalCells('0,0', solvedTiles)

    const center = { q: 0, r: 0, s: 0 }
    const collapseOrder = islandData.collapseOrder.length > 0 ? islandData.collapseOrder : solvedTiles

    await grid.populateFromCubeResults(solvedTiles, collapseOrder, center, {
      animate,
      animateDelay: this.params?.roads?.animateDelay ?? 15,
    })

    grid.setHelperVisible(this.helpersVisible)
    if (grid.outline && this.debug._outlinesVisible !== undefined) {
      grid.outline.visible = this.debug._outlinesVisible
    }

    this.isRegenerating = false

    // Notify listeners for water mask, wave rebuilding, and gameplay controllers
    const animPromise = grid.animationDone || Promise.resolve()
    this.onTilesChanged?.(animPromise)
    this.onIslandGenerated?.(islandData, this.navGrid, animPromise)

    log(`[HexMap] Island generated: ${islandData.getCellCount()} cells`, 'color: #2ed573')
    return islandData
  }

  async regenerate(options = {}) {
    const seed = options.seed ?? Math.floor(Math.random() * 1000000)
    const animate = options.animate ?? (this.params?.roads?.animateWFC ?? true)
    return this.generateIsland({ seed, animate })
  }

  async reset() {
    return this.generateIsland({ seed: this.currentSeed, animate: false })
  }

  /**
   * Initialize shared material
   */
  async initMaterial() {
    if (!HexTileGeometry.loaded || HexTileGeometry.geoms.size === 0) {
      console.warn('HexTileGeometry not loaded')
      return
    }

    const mat = new MeshPhysicalNodeMaterial()
    mat.roughness = 1
    mat.metalness = 0
    this.roadMaterial = mat

    this.roadMaterial.setupDiffuseColor = function(builder) {
      const colorNode = this.colorNode ? vec4(this.colorNode) : materialColor
      diffuseColor.assign(colorNode)
      const opacityNode = this.opacityNode ? float(this.opacityNode) : materialOpacity
      diffuseColor.a.assign(diffuseColor.a.mul(opacityNode))
    }

    this.waterMaskMaterial = new MeshBasicNodeMaterial({ color: 0xffffff })

    await this._initTextureBlend()
    this.roadMaterial.colorNode = this._combinedColor
  }

  async _initTextureBlend() {
    const loader = new TextureLoader()
    const loadTex = (path) => new Promise((resolve) => {
      loader.load(path, (tex) => {
        tex.flipY = false
        tex.colorSpace = SRGBColorSpace
        tex.needsUpdate = true
        resolve(tex)
      })
    })

    const loadMask = (path) => new Promise((resolve) => {
      loader.load(path, (tex) => {
        tex.flipY = false
        tex.needsUpdate = true
        resolve(tex)
      })
    })

    const [texA, texB, texMask] = await Promise.all([
      loadTex('./assets/textures/moody.png'),
      loadTex('./assets/textures/winter.png'),
      loadMask('./assets/textures/water-mask.png'),
    ])

    this._texA = texA
    this._texB = texB
    this._texMask = texMask

    const texNodeA = texture(texA, uv())
    const texNodeB = texture(texB, uv())
    this._texNodeA = texNodeA
    this._texNodeB = texNodeB

    const batchColor = varyingProperty('vec3', 'vBatchColor')
    const levelVal = batchColor.r.mul(10.0)

    const levelBias = uniform(this.params?.debug?.levelBias ?? -0.3)
    this._levelBias = levelBias

    const adjustedLevel = clamp(levelVal.add(levelBias.mul(3.0)), float(0), float(3))
    const blendFactor = clamp(adjustedLevel.div(3.0), float(0), float(1))

    this._combinedColor = mix(texNodeA, texNodeB, blendFactor)
  }

  createFloor() {
    const geom = new PlaneGeometry(600, 600)
    geom.rotateX(-Math.PI / 2)
    const mat = new MeshBasicNodeMaterial({ color: 0x0a1628 })
    this.floor = new Mesh(geom, mat)
    this.floor.position.y = -0.5
    this.floor.receiveShadow = false
    this.scene.add(this.floor)
  }

  initWfcRules() {
    this.wfcManager.initWfcRules()
    this.hexWfcRules = this.wfcManager.hexWfcRules
  }

  initWfcWorker() {
    this.wfcManager.initWfcWorker()
  }

  getDefaultTileTypes() {
    return TILE_LIST.map((_, i) => i)
  }

  addToGlobalCells(gridKey, tiles) {
    for (const tile of tiles) {
      const key = cubeKey(tile.q, tile.r, tile.s)
      this.globalCells.set(key, {
        q: tile.q,
        r: tile.r,
        s: tile.s,
        type: tile.type,
        rotation: tile.rotation,
        level: tile.level ?? 0,
        gridKey,
      })
    }
  }

  update(dt) {
    // Frame updates if needed
  }

  // === Water uniform proxies ===
  get waterPlane() { return this.water?.mesh }
  get _waterOpacity() { return this.water?._waterOpacity }
  get _waterSpeed() { return this.water?._waterSpeed }
  get _waterFreq() { return this.water?._waterFreq }
  get _waterAngle() { return this.water?._waterAngle }
  get _waterBrightness() { return this.water?._waterBrightness }
  get _waterContrast() { return this.water?._waterContrast }
  get _waveSpeed() { return this.water?._waveSpeed }
  get _waveCount() { return this.water?._waveCount }
  get _waveOpacity() { return this.water?._waveOpacity }
  get _waveNoiseBreak() { return this.water?._waveNoiseBreak }
  get _waveWidth() { return this.water?._waveWidth }
  get _waveOffset() { return this.water?._waveOffset }
  get _waveGradientOpacity() { return this.water?._waveGradientOpacity }
  get _waveGradientColor() { return this.water?._waveGradientColor }
  get _waveMaskStrength() { return this.water?._waveMaskStrength }
  get _coveStrength() { return this.water?._coveStrength }
  get _coveFade() { return this.water?._coveFade }
  get _coveThin() { return this.water?._coveThin }
  get _coveShow() { return this.water?._coveShow }

  // === Accessors ===
  get hexTiles() {
    const allTiles = []
    for (const grid of this.grids.values()) {
      allTiles.push(...grid.hexTiles)
    }
    return allTiles
  }

  get hexGrid() {
    return this.grids.get('0,0')?.hexGrid ?? null
  }

  get activeGrid() {
    return this.grids.get('0,0') ?? null
  }

  // ---- HexMapDebug delegators ----
  clearTileLabels() { this.debug?.clearTileLabels() }
  createTileLabels() { this.debug?.createTileLabels() }
  setTileLabelsVisible(visible) { this.debug?.setTileLabelsVisible(visible) }
  setHelpersVisible(visible) {
    this.helpersVisible = visible
    this.debug?.setHelpersVisible(visible)
  }
  setAxesHelpersVisible(visible) {
    this.axesHelpersVisible = visible
    this.debug?.setAxesHelpersVisible(visible)
  }
  setOutlinesVisible(visible) { this.debug?.setOutlinesVisible(visible) }
  repopulateDecorations() { this.debug?.repopulateDecorations() }
  setWhiteMode(enabled) { this.debug?.setWhiteMode(enabled) }
  _updateColorNode() { this.debug?._updateColorNode() }
  updateTileColors() { this.debug?.updateTileColors() }
  getOverlayObjects() { return this.debug?.getOverlayObjects() || [] }
  getWaterObjects() {
    const water = []
    if (this.water?.mesh) water.push(this.water.mesh)
    return water
  }

  swapBiomeTexture(slot, path) {
    const node = slot === 'lo' ? this._texNodeA : this._texNodeB
    if (!node) return
    const ref = this._texA
    const loader = new TextureLoader()
    loader.load(path, (tex) => {
      if (ref) {
        tex.flipY = ref.flipY
        tex.colorSpace = ref.colorSpace
        tex.wrapS = ref.wrapS
        tex.wrapT = ref.wrapT
      }
      tex.needsUpdate = true
      node.value = tex
      if (slot === 'lo') this._texA = tex
      else this._texB = tex
      if (this.roadMaterial) this.roadMaterial.needsUpdate = true
    })
  }

  // Pointer interactions
  onPointerMove(pointer, camera) { this.interaction.onPointerMove(pointer, camera) }
  onPointerDown(pointer, camera) { return this.interaction.onPointerDown(pointer, camera) }
  clearHoverHighlight() { this.interaction.clearHoverHighlight() }
  onHover() {}
  onPointerUp() {}
  onRightClick() {}
  startIntroAnimation() {}
}
