import { GUI } from 'three/addons/libs/lil-gui.module.min.js'
import { setTreeNoiseFrequency, setTreeThreshold, setBuildingNoiseFrequency, setBuildingThreshold } from './hexmap/Decorations.js'
import { HexTile } from './hexmap/HexTiles.js'

export class GUIManager {
  constructor(app) {
    this.app = app
    this.gui = null
    this.fovController = null
  }

  // Default params - single source of truth
  static defaultParams = {
    camera: {
      fov: 20,
    },
    lighting: {
      envIntensity: 0.95,
      dirLight: 2.15,
      shadowIntensity: 1.0,
      lightX: 35,
      lightY: 50,
      lightZ: 45,
      showHelper: false,
    },
    material: {
      roughness: 1,
      metalness: 0,
      clearcoat: 0,
      clearcoatRoughness: 0,
      iridescence: 0,
    },
    fx: {
      ao: true,
      aoStrength: 2.7,
      aoRadius: 1,
      aoDenoise: 5,
      aoFullRes: false,
      vignette: true,
      dof: true,
      dofFocalLength: 50,
      dofBokehScale: 3,
      grain: true,
      grainStrength: 0.1,
      grainFPS: 0,
    },
    debug: {
      view: 'final',
      originHelper: false,
      debugCam: false,
      hexGrid: false,
      tileLabels: false,
      tileLabelMode: 'coords',
      floor: true,
      levelColors: false,
      whiteMode: false,
      blendNoiseScale: 0.03,
      blendOffset: 0.0,
    },
    renderer: {
      dpr: 1, // Will be set dynamically based on device
    },
    roads: {
      animateWFC: true,
      showOutlines: false,
    },
    decoration: {
      treeNoiseFreq: 0.05,
      treeThreshold: 0.5,
      buildingNoiseFreq: 0.02,
      buildingThreshold: 0.77,
    },
    water: {
      y: 0.88,
      opacity: 0.1,
      speed: 1.5,
      freq: 1.5,
      angle: 0,
      brightness: 0.53,
      contrast: 17.5,
    },
    waves: {
      speed: 2,
      count: 4,
      opacity: 0.35,
      break: 0.135,
      width: 0.27,
      offset: 0.3,
      gradientOpacity: 0.31,
      gradientColor: '#4770a1',
      showMask: false,
      coveCutoff: 0.978,
      coveRadius: 2.041,
      coveBlur: 2.624,
      coveStrength: 2.274,
      coveFade: true,
      coveThin: true,
      coveShow: false,
    },
  }

  init() {
    const { app } = this
    const gui = new GUI()
    this.gui = gui

    // Store params on app for single source of truth
    const allParams = app.params || JSON.parse(JSON.stringify(GUIManager.defaultParams))
    app.params = allParams

    // Initialize fx parameters based on active graphics profile baseline
    if (app.graphicsProfile) {
      const cfg = app.graphicsProfile.config
      allParams.fx.ao = cfg.ao
      allParams.fx.dof = cfg.dof
      allParams.fx.grain = cfg.grain
      allParams.fx.vignette = cfg.vignette
      allParams.renderer.dpr = app.graphicsProfile.getEffectivePixelRatio()
    }

    // Quality Profile dropdown (HIGH, MEDIUM, LOW)
    this.qualityController = gui.add({ quality: app.graphicsProfile?.currentPreset || 'HIGH' }, 'quality', ['HIGH', 'MEDIUM', 'LOW']).name('Quality Preset').onChange((preset) => {
      app.graphicsProfile?.setPreset(preset)
    })

    // Top-level controls (no folder)
    this.fovController = gui.add(allParams.camera, 'fov', 20, 90, 1).name('FOV').onChange((v) => {
      app.perspCamera.fov = v
      app.perspCamera.updateProjectionMatrix()
    })

    // Debug view
    const viewMap = { final: 0, color: 1, normal: 3, ao: 4, overlay: 5, mask: 6 }
    gui.add(allParams.debug, 'view', Object.keys(viewMap)).name('Debug View').onChange((v) => {
      app.debugView.value = viewMap[v]
    })

    // Visual toggles at top level
    gui.add(allParams.debug, 'originHelper').name('Axes Helpers').onChange((v) => {
      app.city.setAxesHelpersVisible(v)
    })
    gui.add(allParams.debug, 'hexGrid').name('Cell Outlines').onChange((v) => {
      app.city.setHelpersVisible(v)
    })
    gui.add(allParams.roads, 'showOutlines').name('Grid Outlines').onChange((v) => {
      app.city?.setOutlinesVisible(v)
    })
    gui.add(allParams.roads, 'animateWFC').name('Animate WFC')
    gui.add(allParams.debug, 'tileLabels').name('Tile Labels').onChange((v) => {
      app.city.setTileLabelsVisible(v)
    })
    gui.add(allParams.debug, 'tileLabelMode', ['coords', 'levels']).name('Label Mode').onChange((v) => {
      app.city.tileLabelMode = v
      if (allParams.debug.tileLabels) app.city.createTileLabels()
    })
    gui.add(allParams.debug, 'levelColors').name('Level Colors').onChange((v) => {
      HexTile.debugLevelColors = v
      app.city.updateTileColors()
    })
    gui.add(allParams.debug, 'whiteMode').name('White Mode').onChange((v) => {
      app.city.setWhiteMode(v)
    })

    // Biome texture pickers + level bias
    const biomeOptions = {
      'moody': './assets/textures/moody.png',
      'summer': './assets/textures/summer.png',
      'fall': './assets/textures/fall.png',
      'winter': './assets/textures/winter.png',
      'default': './assets/textures/default.png',
    }
    allParams.debug.biomeLo = 'moody'
    allParams.debug.biomeHi = 'winter'
    allParams.debug.levelBias = -0.3
    gui.add(allParams.debug, 'biomeLo', Object.keys(biomeOptions)).name('Biome Lo').onChange((v) => {
      app.city.swapBiomeTexture('lo', biomeOptions[v])
    })
    gui.add(allParams.debug, 'biomeHi', Object.keys(biomeOptions)).name('Biome Hi').onChange((v) => {
      app.city.swapBiomeTexture('hi', biomeOptions[v])
    })
    gui.add(allParams.debug, 'levelBias', -1, 1, 0.05).name('Level Bias').onChange((v) => {
      if (app.city._levelBias) app.city._levelBias.value = v
    })

    // Island Generation & Action buttons
    allParams.seed = app.city.currentSeed || 10001
    const seedCtrl = gui.add(allParams, 'seed').name('Island Seed').listen().onChange((v) => {
      const s = parseInt(v, 10)
      if (!isNaN(s)) {
        app.city.generateIsland({ seed: s })
      }
    })

    gui.add({ newIsland: () => {
      const nextSeed = Math.floor(Math.random() * 1000000)
      allParams.seed = nextSeed
      seedCtrl.updateDisplay()
      app.city.generateIsland({ seed: nextSeed })
    } }, 'newIsland').name('New Island (Random)')

    gui.add({ regenerate: () => {
      app.city.generateIsland({ seed: allParams.seed })
    } }, 'regenerate').name('Regenerate')

    gui.add({ exportPNG: () => app.exportPNG() }, 'exportPNG').name('Export JPG')

    gui.add({ resetCamera: () => {
      app.cameraController?.reset(app.city?.currentIsland || { radius: 5 }, { instant: true, aspect: app.viewport?.getAspect() || 1 })
    } }, 'resetCamera').name('Reset Camera')

    gui.add({
      copyState: () => {
        const c = app.cameraController
        const cam = app.camera
        const exportData = {
          ...allParams,
          cameraState: {
            position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
            target: { x: c?.currentTarget?.x ?? 0, y: c?.currentTarget?.y ?? 0, z: c?.currentTarget?.z ?? 0 },
            distance: c?.currentDistance ?? cam.position.distanceTo(c?.currentTarget || cam.position),
            pitch: c?.pitch ?? 0,
            yaw: c?.yaw ?? 0,
          }
        }
        const json = JSON.stringify(exportData, null, 2)
        navigator.clipboard.writeText(json)
        console.log('GUI State copied:\n', json)
      }
    }, 'copyState').name('Copy GUI State')
    gui.add({
      logNavState: () => {
        const nav = app.city?.navGrid
        const island = app.city?.currentIsland
        console.log('--- Navigation Grid State ---')
        console.log('  Total Cells:', island?.getCellCount?.() ?? 0)
        if (nav) {
          const walkable = nav.getWalkableCells()
          console.log('  Walkable Cells:', walkable.length)
          if (walkable.length >= 2) {
            import('./navigation/Pathfinder.js').then(({ Pathfinder }) => {
              const pf = new Pathfinder(nav)
              const start = walkable[0]
              const goal = walkable[walkable.length - 1]
              const path = pf.findPath(start, goal)
              console.log(`  Sample Path from (${start.q},${start.r},${start.s}) to (${goal.q},${goal.r},${goal.s}):`, path ? `${path.length} steps` : 'Unreachable')
            })
          }
        }
      }
    }, 'logNavState').name('Log Nav Grid')

    // Decoration folder
    const decorationFolder = gui.addFolder('Decoration').close()
    decorationFolder.add(allParams.decoration, 'treeNoiseFreq', 0.01, 0.2, 0.01).name('Tree Noise Freq').onChange((v) => {
      setTreeNoiseFrequency(v)
      app.city.repopulateDecorations()
    })
    decorationFolder.add(allParams.decoration, 'treeThreshold', 0, 1, 0.05).name('Tree Threshold').onChange((v) => {
      setTreeThreshold(v)
      app.city.repopulateDecorations()
    })
    decorationFolder.add(allParams.decoration, 'buildingNoiseFreq', 0.01, 0.2, 0.01).name('Building Noise Freq').onChange((v) => {
      setBuildingNoiseFrequency(v)
      app.city.repopulateDecorations()
    })
    decorationFolder.add(allParams.decoration, 'buildingThreshold', 0, 1, 0.01).name('Building Threshold').onChange((v) => {
      setBuildingThreshold(v)
      app.city.repopulateDecorations()
    })
    // Water folder
    const waterFolder = gui.addFolder('Water').close()
    waterFolder.add(allParams.water, 'y', 0.7, 1.0, 0.01).name('Y Height').onChange((v) => {
      if (app.city.waterPlane) app.city.waterPlane.position.y = v
    })
    waterFolder.add(allParams.water, 'opacity', 0, 1, 0.05).name('Opacity').onChange((v) => {
      if (app.city._waterOpacity) app.city._waterOpacity.value = v
    })
    waterFolder.add(allParams.water, 'speed', 0, 5, 0.05).name('Speed').onChange((v) => {
      if (app.city._waterSpeed) app.city._waterSpeed.value = v
    })
    waterFolder.add(allParams.water, 'freq', 0.1, 3, 0.05).name('Frequency').onChange((v) => {
      if (app.city._waterFreq) app.city._waterFreq.value = v
    })
    waterFolder.add(allParams.water, 'angle', 0, 360, 1).name('Angle').onChange((v) => {
      if (app.city._waterAngle) app.city._waterAngle.value = v * Math.PI / 180
    })
    waterFolder.add(allParams.water, 'brightness', 0.1, 0.9, 0.01).name('Brightness').onChange((v) => {
      if (app.city._waterBrightness) app.city._waterBrightness.value = v
    })
    waterFolder.add(allParams.water, 'contrast', 1, 40, 0.5).name('Contrast').onChange((v) => {
      if (app.city._waterContrast) app.city._waterContrast.value = v
    })
    // Waves folder
    const wavesFolder = gui.addFolder('Waves').close()
    wavesFolder.add(allParams.waves, 'speed', 0.1, 5.0, 0.05).name('Speed').onChange((v) => {
      if (app.city._waveSpeed) app.city._waveSpeed.value = v
    })
    wavesFolder.add(allParams.waves, 'count', 1, 20, 1).name('Count').onChange((v) => {
      if (app.city._waveCount) app.city._waveCount.value = v
    })
    wavesFolder.add(allParams.waves, 'opacity', 0, 1, 0.05).name('Opacity').onChange((v) => {
      if (app.city._waveOpacity) app.city._waveOpacity.value = v
    })
    wavesFolder.add(allParams.waves, 'break', 0, 0.5, 0.005).name('Break').onChange((v) => {
      if (app.city._waveNoiseBreak) app.city._waveNoiseBreak.value = v
    })
    wavesFolder.add(allParams.waves, 'width', 0.1, 0.98, 0.01).name('Width').onChange((v) => {
      if (app.city._waveWidth) app.city._waveWidth.value = 1 - v
    })
    wavesFolder.add(allParams.waves, 'offset', 0, 0.8, 0.01).name('Offset').onChange((v) => {
      if (app.city._waveOffset) app.city._waveOffset.value = v
    })
    wavesFolder.add(allParams.waves, 'gradientOpacity', 0, 1, 0.01).name('Gradient Opacity').onChange((v) => {
      if (app.city._waveGradientOpacity) app.city._waveGradientOpacity.value = v
    })
    wavesFolder.addColor(allParams.waves, 'gradientColor').name('Gradient Color').onChange((v) => {
      if (app.city._waveGradientColor) app.city._waveGradientColor.value.set(v)
    })
    wavesFolder.add(allParams.waves, 'showMask', false).name('Show Mask').onChange((v) => {
      if (app.wavesMask) app.wavesMask.showDebug = v
    })
    wavesFolder.add(allParams.waves, 'coveCutoff', 0, 3).name('Cove Cutoff').onChange((v) => {
      if (app.wavesMask) { app.wavesMask._coveCutoff = v; app.wavesMask.renderCoveOverlay() }
    })
    wavesFolder.add(allParams.waves, 'coveRadius', 0.5, 4).name('Cove Radius').onChange((v) => {
      if (app.wavesMask) { app.wavesMask._coveRadius = v; app.wavesMask.renderCoveOverlay() }
    })
    wavesFolder.add(allParams.waves, 'coveBlur', 0, 4).name('Cove Blur').onChange((v) => {
      if (app.wavesMask) { app.wavesMask._coveBlur = Math.round(v); app.wavesMask.renderCoveOverlay() }
    })
    wavesFolder.add(allParams.waves, 'coveStrength', 0, 3).name('Cove Strength').onChange((v) => {
      if (app.city._coveStrength) app.city._coveStrength.value = v
    })
    wavesFolder.add(allParams.waves, 'coveShow').name('Show Cove Mask').onChange((v) => {
      if (app.city._coveShow) app.city._coveShow.value = v ? 1 : 0
    })
    wavesFolder.add(allParams.waves, 'coveFade').name('Cove Fade').onChange((v) => {
      if (app.city._coveFade) app.city._coveFade.value = v ? 1 : 0
    })
    wavesFolder.add(allParams.waves, 'coveThin').name('Cove Thin').onChange((v) => {
      if (app.city._coveThin) app.city._coveThin.value = v ? 1 : 0
    })

    // Lights folder
    const lightsFolder = gui.addFolder('Lights').close()
    lightsFolder.add(allParams.lighting, 'envIntensity', 0, 2, 0.05).name('Env Intensity').onChange((v) => {
      app.scene.environmentIntensity = v
    })
    lightsFolder.add(allParams.lighting, 'dirLight', 0, 5, 0.05).name('Dir Light').onChange((v) => {
      if (app.lighting.dirLight) app.lighting.dirLight.intensity = v
    })
    lightsFolder.add(allParams.lighting, 'shadowIntensity', 0, 1, 0.05).name('Shadow Intensity').onChange((v) => {
      if (app.lighting.dirLight) app.lighting.dirLight.shadow.intensity = v
    })
    lightsFolder.add(allParams.lighting, 'lightX', -100, 100, 5).name('Light X').onChange((v) => {
      if (app.lighting.dirLightOffset) {
        app.lighting.dirLightOffset.x = v
        app.lighting.updateShadowFrustum()
      }
    })
    lightsFolder.add(allParams.lighting, 'lightY', 20, 200, 5).name('Light Y').onChange((v) => {
      if (app.lighting.dirLightOffset) {
        app.lighting.dirLightOffset.y = v
        app.lighting.updateShadowFrustum()
      }
    })
    lightsFolder.add(allParams.lighting, 'lightZ', -100, 100, 5).name('Light Z').onChange((v) => {
      if (app.lighting.dirLightOffset) {
        app.lighting.dirLightOffset.z = v
        app.lighting.updateShadowFrustum()
      }
    })
    lightsFolder.add(allParams.lighting, 'showHelper').name('Show Helper').onChange((v) => {
      if (app.lighting.dirLightHelper) app.lighting.dirLightHelper.visible = v
    })

    // Effects folder
    const fxFolder = gui.addFolder('Post Processing').close()
    fxFolder.add(allParams.fx, 'ao').name('AO').onChange((v) => {
      app.aoEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'aoStrength', 0, 5, 0.1).name('AO Strength').onChange((v) => {
      if (app.aoPass) app.aoPass.scale.value = v
    })
    fxFolder.add(allParams.fx, 'aoRadius', 0.01, 2, 0.01).name('AO Radius').onChange((v) => {
      if (app.aoPass) app.aoPass.radius.value = v
    })
    fxFolder.add(allParams.fx, 'aoDenoise', 0, 10, 1).name('AO Denoise').onChange((v) => {
      if (app.aoDenoiseRadius) app.aoDenoiseRadius.value = v
    })
    fxFolder.add(allParams.fx, 'aoFullRes').name('AO Full Res').onChange((v) => {
      if (app.postFX?.aoPass) app.postFX.aoPass.resolutionScale = v ? 1 : 0.5
    })
    fxFolder.add(allParams.fx, 'vignette').name('Vignette').onChange((v) => {
      app.vignetteEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'dof').name('DOF').onChange((v) => {
      app.dofEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'dofFocalLength', 1, 200, 1).name('DOF Focal Length').onChange((v) => {
      app.dofFocalLength.value = v
    })
    fxFolder.add(allParams.fx, 'dofBokehScale', 0.1, 5, 0.1).name('DOF Bokeh Scale').onChange((v) => {
      app.dofBokehScale.value = v
    })
    fxFolder.add(allParams.fx, 'grain').name('Grain').onChange((v) => {
      app.grainEnabled.value = v ? 1 : 0
    })
    fxFolder.add(allParams.fx, 'grainStrength', 0, 0.2, 0.005).name('Grain Strength').onChange((v) => {
      app.grainStrength.value = v
    })
    fxFolder.add(allParams.fx, 'grainFPS', 0, 60, 1).name('Grain FPS')

    return allParams
  }

  // Apply all GUI params to scene objects (called after init)
  applyParams() {
    const { app } = this
    const { params } = app

    // Lighting
    app.scene.environmentIntensity = params.lighting.envIntensity
    if (app.lighting.dirLight) {
      app.lighting.dirLight.intensity = params.lighting.dirLight
      app.lighting.dirLight.shadow.intensity = params.lighting.shadowIntensity
    }
    if (app.lighting.dirLightOffset) {
      app.lighting.dirLightOffset.x = params.lighting.lightX
      app.lighting.dirLightOffset.y = params.lighting.lightY
      app.lighting.dirLightOffset.z = params.lighting.lightZ
      app.lighting.updateShadowFrustum()
    }
    if (app.lighting.dirLightHelper) app.lighting.dirLightHelper.visible = params.lighting.showHelper
    // Material
    if (app.city.roadMaterial) {
      app.city.roadMaterial.roughness = params.material.roughness
      app.city.roadMaterial.metalness = params.material.metalness
      app.city.roadMaterial.clearcoat = params.material.clearcoat
      app.city.roadMaterial.clearcoatRoughness = params.material.clearcoatRoughness
      app.city.roadMaterial.iridescence = params.material.iridescence
    }

    // Post processing
    app.aoEnabled.value = params.fx.ao ? 1 : 0
    if (app.aoPass) {
      app.aoPass.scale.value = params.fx.aoStrength
      app.aoPass.radius.value = params.fx.aoRadius
    }
    if (app.aoDenoiseRadius) app.aoDenoiseRadius.value = params.fx.aoDenoise
    app.vignetteEnabled.value = params.fx.vignette ? 1 : 0
    app.dofEnabled.value = params.fx.dof ? 1 : 0
    app.dofFocalLength.value = params.fx.dofFocalLength
    app.dofBokehScale.value = params.fx.dofBokehScale
    app.grainEnabled.value = params.fx.grain ? 1 : 0
    app.grainStrength.value = params.fx.grainStrength

    // Camera
    app.perspCamera.fov = params.camera.fov
    app.perspCamera.updateProjectionMatrix()
    if (app.cameraController) {
      app.cameraController.minDistance = params.debug.debugCam ? 5 : 20
      app.cameraController.maxDistance = params.debug.debugCam ? 200 : 90
    }
    app.city.setAxesHelpersVisible(params.debug.originHelper)

    // Hex helper visibility
    app.city.setHelpersVisible(params.debug.hexGrid)

    // Level bias
    if (app.city._levelBias) app.city._levelBias.value = params.debug.levelBias

    // Water
    if (app.city.waterPlane) app.city.waterPlane.position.y = params.water.y
    if (app.city._waterOpacity) app.city._waterOpacity.value = params.water.opacity
    if (app.city._waterSpeed) app.city._waterSpeed.value = params.water.speed
    if (app.city._waterFreq) app.city._waterFreq.value = params.water.freq
    if (app.city._waterAngle) app.city._waterAngle.value = params.water.angle * Math.PI / 180
    if (app.city._waterBrightness) app.city._waterBrightness.value = params.water.brightness
    if (app.city._waterContrast) app.city._waterContrast.value = params.water.contrast
    // Waves
    if (app.city._waveSpeed) app.city._waveSpeed.value = params.waves.speed
    if (app.city._waveCount) app.city._waveCount.value = params.waves.count
    if (app.city._waveOpacity) app.city._waveOpacity.value = params.waves.opacity
    if (app.city._waveGradientOpacity) app.city._waveGradientOpacity.value = params.waves.gradientOpacity
    if (app.city._waveNoiseBreak) app.city._waveNoiseBreak.value = params.waves.break
    if (app.city._waveWidth) app.city._waveWidth.value = 1 - params.waves.width
    if (app.city._waveOffset) app.city._waveOffset.value = params.waves.offset
    if (app.city._waveGradientColor) app.city._waveGradientColor.value.set(params.waves.gradientColor)
    if (app.city._coveStrength) app.city._coveStrength.value = params.waves.coveStrength
    if (app.city._coveFade) app.city._coveFade.value = params.waves.coveFade ? 1 : 0
    if (app.city._coveThin) app.city._coveThin.value = params.waves.coveThin ? 1 : 0
    if (app.city._coveShow) app.city._coveShow.value = params.waves.coveShow ? 1 : 0
    if (app.wavesMask) app.wavesMask.showDebug = params.waves.showMask

    // Renderer
    app.renderer.setPixelRatio(params.renderer.dpr)
  }

  // Synchronize all GUI controls to match updated params/profile
  syncProfileDisplay(profile, effectiveDpr) {
    if (!this.gui) return
    for (const controller of this.gui.controllersRecursive()) {
      controller.updateDisplay()
    }
  }
}
