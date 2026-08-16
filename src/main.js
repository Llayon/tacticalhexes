import { App } from './App.js'
import WebGPU from 'three/examples/jsm/capabilities/WebGPU.js'

const loadingEl = document.getElementById('loading')
const canvas = document.getElementById('canvas')

let app = null

async function init() {
  if (!WebGPU.isAvailable()) {
    if (loadingEl) {
      loadingEl.innerHTML = '<p style="color:#fff;font-family:sans-serif;text-align:center;padding:20px;max-width:400px;line-height:1.5;">WebGPU is not available in this browser or device.<br><span style="font-size:12px;color:#aaa;">Please enable WebGPU / hardware acceleration or try Chrome / Edge.</span></p>'
    }
    return
  }

  try {
    app = new App(canvas)
    await app.init()

    // Hide loading overlay
    if (loadingEl) loadingEl.style.display = 'none'

    // Fade in scene
    app.fadeIn(1000)

    // Start intro build animation
    app.city.startIntroAnimation(app.camera, app.controls, 4)
  } catch (err) {
    console.error('Error initializing app:', err)
    if (loadingEl) {
      loadingEl.innerHTML = `<p style="color:#fff;font-family:sans-serif;text-align:center;padding:20px;max-width:400px;line-height:1.5;">Failed to initialize 3D scene:<br><span style="font-size:12px;color:#f87171;">${err?.message || err}</span></p>`
    }
  }
}

init()

