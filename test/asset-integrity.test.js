/**
 * GLB Asset Integrity Test Suite
 * Validates canonical terrain GLB binary structure, header, magic, version, and required mesh assets.
 * Pure JavaScript execution — no WebGPU, DOM, Telegram, or Three.js dependencies.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const MODEL_PATH = path.resolve(process.cwd(), 'public/assets/models/hex-terrain.glb')

describe('Canonical Terrain GLB Asset Integrity', () => {
  it('exists on disk and is non-empty', () => {
    assert.ok(fs.existsSync(MODEL_PATH), `GLB asset file must exist at ${MODEL_PATH}`)
    const stat = fs.statSync(MODEL_PATH)
    assert.ok(stat.size > 0, `GLB file size must be greater than 0, got ${stat.size}`)
  })

  it('has valid GLB 12-byte header with glTF magic and version 2', () => {
    const buffer = fs.readFileSync(MODEL_PATH)
    assert.ok(buffer.length >= 12, 'GLB file must be at least 12 bytes')

    const magic = buffer.toString('utf8', 0, 4)
    assert.equal(magic, 'glTF', `GLB magic must be 'glTF', got '${magic}'`)

    const version = buffer.readUInt32LE(4)
    assert.equal(version, 2, `GLB version must be 2, got ${version}`)

    const length = buffer.readUInt32LE(8)
    assert.equal(length, buffer.length, `GLB header length (${length}) must match file size (${buffer.length})`)
  })

  it('does not contain UTF-8 replacement sequences (no text-mode corruption)', () => {
    const buffer = fs.readFileSync(MODEL_PATH)
    const replacementSequence = Buffer.from([0xef, 0xbf, 0xbd])
    const index = buffer.indexOf(replacementSequence)
    assert.equal(index, -1, `GLB contains UTF-8 replacement byte sequence at offset ${index} indicating corruption`)
  })

  it('contains valid JSON chunk and required terrain mesh names', () => {
    const buffer = fs.readFileSync(MODEL_PATH)
    assert.ok(buffer.length >= 20, 'GLB must contain at least one chunk header')

    const chunk0Length = buffer.readUInt32LE(12)
    const chunk0Type = buffer.toString('utf8', 16, 20)
    assert.equal(chunk0Type, 'JSON', `First GLB chunk must be JSON, got '${chunk0Type}'`)

    const jsonBuffer = buffer.subarray(20, 20 + chunk0Length)
    const jsonStr = jsonBuffer.toString('utf8')
    let gltfJson
    assert.doesNotThrow(() => {
      gltfJson = JSON.parse(jsonStr)
    }, 'GLB JSON chunk must be valid JSON')

    assert.ok(gltfJson.meshes && Array.isArray(gltfJson.meshes), 'GLTF JSON must contain meshes array')
    const meshNames = new Set(gltfJson.meshes.map((m) => m.name))

    // Base geometries required for rendering
    const requiredBaseMeshes = [
      'hex_grass',
      'hex_water',
      'hex_grass_bottom',
      'hex_grass_sloped_low',
      'hex_grass_sloped_high',
      'hex_road_A_sloped_low',
      'hex_road_A_sloped_high',
    ]

    for (const req of requiredBaseMeshes) {
      assert.ok(
        meshNames.has(req),
        `GLB asset must contain required terrain mesh: '${req}' (found ${meshNames.size} meshes)`
      )
    }
  })

  it('contains valid binary chunk (BIN)', () => {
    const buffer = fs.readFileSync(MODEL_PATH)
    const chunk0Length = buffer.readUInt32LE(12)
    const chunk1Offset = 20 + chunk0Length

    assert.ok(buffer.length >= chunk1Offset + 8, 'GLB must contain binary chunk header')
    const chunk1Length = buffer.readUInt32LE(chunk1Offset)
    const chunk1Type = buffer.toString('utf8', chunk1Offset + 4, chunk1Offset + 8)
    assert.equal(chunk1Type, 'BIN\0', `Second GLB chunk must be BIN\\0, got '${chunk1Type}'`)
    assert.ok(chunk1Length > 0, 'Binary chunk length must be greater than 0')
  })
})
