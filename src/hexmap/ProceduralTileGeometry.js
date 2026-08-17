/**
 * ProceduralTileGeometry - Generates high-quality stylized low-poly 3D meshes
 * for all hex tiles, elevation transitions, slopes, roads, rivers, coasts,
 * and diorama decorations (trees, buildings, rocks, hills, mountains).
 *
 * Provides a robust, self-contained geometry baseline that guarantees 100%
 * rendering reliability across all environments.
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from 'three/webgpu'
import { TILE_LIST, TileType, HexDir } from './HexTileData.js'

const HEX_RADIUS = 2.0 / Math.sqrt(3) // ~1.1547005
const HEX_WIDTH = 2.0

// 6 Corners of pointy-top regular hexagon in XZ plane
export function getHexCorners(radius = HEX_RADIUS) {
  const corners = []
  for (let i = 0; i < 6; i++) {
    // Pointy top: angles at 90, 30, 330, 270, 210, 150 deg (or 0, 60, 120...)
    // Corner 0: top/north point (0, R)
    // Corner 1: top-right (W/2, R/2)
    // Corner 2: bottom-right (W/2, -R/2)
    // Corner 3: bottom/south point (0, -R)
    // Corner 4: bottom-left (-W/2, -R/2)
    // Corner 5: top-left (-W/2, R/2)
    const angle = (Math.PI / 2) - (i * Math.PI / 3)
    corners.push(new Vector3(
      radius * Math.cos(angle),
      0,
      radius * Math.sin(angle)
    ))
  }
  return corners
}

// Edge index to Direction name mapping matching HexDir ['NE', 'E', 'SE', 'SW', 'W', 'NW']
// Edge 0: C0 -> C1 = NE
// Edge 1: C1 -> C2 = E
// Edge 2: C2 -> C3 = SE
// Edge 3: C3 -> C4 = SW
// Edge 4: C4 -> C5 = W
// Edge 5: C5 -> C0 = NW
const EDGE_TO_DIR = ['NE', 'E', 'SE', 'SW', 'W', 'NW']

/**
 * Helper to build BufferGeometry from vertex arrays
 */
function createGeometry(positions, normals, uvs, indices) {
  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute(positions, 3))
  if (normals && normals.length === positions.length) {
    geom.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  } else {
    geom.computeVertexNormals()
  }
  if (uvs && uvs.length > 0) {
    geom.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  } else {
    // Generate simple planar UVs
    const genUvs = []
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i]
      const z = positions[i + 2]
      genUvs.push((x / HEX_WIDTH) + 0.5, (z / (HEX_RADIUS * 2)) + 0.5)
    }
    geom.setAttribute('uv', new Float32BufferAttribute(genUvs, 2))
  }
  if (indices && indices.length > 0) {
    geom.setIndex(indices)
  }
  geom.computeBoundingBox()
  geom.computeBoundingSphere()
  return geom
}

/**
 * Procedurally construct a hex prism geometry
 */
export function buildHexPrism({
  topY = 0,
  bottomY = -1.0,
  bevel = 0.05,
  highEdges = [],
  levelIncrement = 0.5,
  recess = 0,
  paletteUv = [0.2, 0.8],
} = {}) {
  const corners = getHexCorners(HEX_RADIUS)
  const innerCorners = getHexCorners(HEX_RADIUS * (1 - bevel))

  const positions = []
  const normals = []
  const uvs = []
  const indices = []

  const highEdgeSet = new Set(highEdges)

  // Calculate top elevation for each corner based on high edges
  const cornerY = [0, 0, 0, 0, 0, 0].map((_, i) => {
    // A corner is elevated if either adjacent edge is in highEdgeSet
    const edgeBefore = (i + 5) % 6
    const edgeAfter = i
    const isHigh = highEdgeSet.has(EDGE_TO_DIR[edgeBefore]) || highEdgeSet.has(EDGE_TO_DIR[edgeAfter])
    return topY - recess + (isHigh ? levelIncrement : 0)
  })

  // Center top vertex
  const centerHigh = highEdgeSet.size > 0
  const centerY = topY - recess + (centerHigh ? levelIncrement * 0.5 : 0)
  const centerIdx = 0
  positions.push(0, centerY, 0)
  normals.push(0, 1, 0)
  uvs.push(paletteUv[0], paletteUv[1])

  // Top surface inner ring
  const topRingStart = 1
  for (let i = 0; i < 6; i++) {
    const c = innerCorners[i]
    positions.push(c.x, cornerY[i], c.z)
    normals.push(0, 1, 0)
    uvs.push(paletteUv[0], paletteUv[1])
  }

  // Top center triangles
  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6
    indices.push(centerIdx, topRingStart + i, topRingStart + next)
  }

  // Top bevel outer ring
  const outerTopRingStart = positions.length / 3
  for (let i = 0; i < 6; i++) {
    const c = corners[i]
    positions.push(c.x, cornerY[i] - bevel * 0.5, c.z)
    normals.push(c.x, 0.5, c.z)
    uvs.push(paletteUv[0], paletteUv[1])
  }

  // Bevel quad strip
  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6
    const iTopInner = topRingStart + i
    const nextTopInner = topRingStart + next
    const iTopOuter = outerTopRingStart + i
    const nextTopOuter = outerTopRingStart + next

    indices.push(iTopInner, iTopOuter, nextTopOuter)
    indices.push(iTopInner, nextTopOuter, nextTopInner)
  }

  // Bottom ring
  const bottomRingStart = positions.length / 3
  for (let i = 0; i < 6; i++) {
    const c = corners[i]
    positions.push(c.x, bottomY, c.z)
    normals.push(c.x, 0, c.z)
    uvs.push(paletteUv[0] + 0.1, paletteUv[1])
  }

  // Side quads
  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6
    const iTop = outerTopRingStart + i
    const nextTop = outerTopRingStart + next
    const iBot = bottomRingStart + i
    const nextBot = bottomRingStart + next

    // Quad (iTop, iBot, nextBot, nextTop)
    indices.push(iTop, iBot, nextBot)
    indices.push(iTop, nextBot, nextTop)
  }

  // Bottom cap
  const bottomCenterIdx = positions.length / 3
  positions.push(0, bottomY, 0)
  normals.push(0, -1, 0)
  uvs.push(paletteUv[0], paletteUv[1])

  for (let i = 0; i < 6; i++) {
    const next = (i + 1) % 6
    indices.push(bottomCenterIdx, bottomRingStart + next, bottomRingStart + i)
  }

  return createGeometry(positions, normals, uvs, indices)
}

/**
 * Build low poly stylized tree geometry
 */
export function buildTreeGeometry(scale = 1.0, foliageLayers = 3) {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []

  const trunkR = 0.08 * scale
  const trunkH = 0.4 * scale

  // Trunk (cylinder)
  const trunkSides = 5
  for (let y of [0, trunkH]) {
    for (let i = 0; i < trunkSides; i++) {
      const a = (i / trunkSides) * Math.PI * 2
      positions.push(Math.cos(a) * trunkR, y, Math.sin(a) * trunkR)
      normals.push(Math.cos(a), 0, Math.sin(a))
      uvs.push(0.6, 0.4) // Wood palette UV
    }
  }

  for (let i = 0; i < trunkSides; i++) {
    const next = (i + 1) % trunkSides
    indices.push(i, i + trunkSides, next + trunkSides)
    indices.push(i, next + trunkSides, next)
  }

  // Foliage cones (stacked)
  for (let l = 0; l < foliageLayers; l++) {
    const baseH = trunkH * 0.7 + l * 0.25 * scale
    const topH = baseH + 0.45 * scale
    const r = (0.35 - l * 0.06) * scale
    const sides = 6
    const baseStart = positions.length / 3

    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2
      positions.push(Math.cos(a) * r, baseH, Math.sin(a) * r)
      normals.push(Math.cos(a), 0.3, Math.sin(a))
      uvs.push(0.15, 0.85) // Foliage green UV
    }

    const tipIdx = positions.length / 3
    positions.push(0, topH, 0)
    normals.push(0, 1, 0)
    uvs.push(0.15, 0.85)

    for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides
      indices.push(baseStart + i, tipIdx, baseStart + next)
    }
  }

  return createGeometry(positions, normals, uvs, indices)
}

/**
 * Build low poly stylized building geometry (house / cottage)
 */
export function buildBuildingGeometry({ w = 0.6, h = 0.5, d = 0.6, roofH = 0.4 } = {}) {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []

  const hw = w * 0.5
  const hd = d * 0.5

  // Wall box vertices
  const wallCorners = [
    [-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd],
    [-hw, h, -hd], [hw, h, -hd], [hw, h, hd], [-hw, h, hd],
  ]

  for (const [x, y, z] of wallCorners) {
    positions.push(x, y, z)
    normals.push(x, 0, z)
    uvs.push(0.7, 0.7) // Plaster/yellow wall UV
  }

  // Wall faces
  const wallQuads = [
    [0, 1, 5, 4], // Back
    [1, 2, 6, 5], // Right
    [2, 3, 7, 6], // Front
    [3, 0, 4, 7], // Left
  ]
  for (const [a, b, c, d_] of wallQuads) {
    indices.push(a, b, c)
    indices.push(a, c, d_)
  }

  // Roof ridge
  const roofApex1 = positions.length / 3
  positions.push(-hw * 1.1, h + roofH, 0)
  normals.push(0, 1, 0)
  uvs.push(0.85, 0.3) // Red/orange roof tile UV

  const roofApex2 = positions.length / 3
  positions.push(hw * 1.1, h + roofH, 0)
  normals.push(0, 1, 0)
  uvs.push(0.85, 0.3)

  // Roof faces
  const rL1 = 4, rR1 = 5, rR2 = 6, rL2 = 7
  // Roof slope 1 (toward -Z)
  indices.push(rL1, rR1, roofApex2)
  indices.push(rL1, roofApex2, roofApex1)
  // Roof slope 2 (toward +Z)
  indices.push(rR2, rL2, roofApex1)
  indices.push(rR2, roofApex1, roofApex2)
  // Roof gables
  indices.push(rL2, rL1, roofApex1)
  indices.push(rR1, rR2, roofApex2)

  return createGeometry(positions, normals, uvs, indices)
}

/**
 * Build low poly rock / boulder geometry
 */
export function buildRockGeometry(scale = 0.25) {
  const positions = []
  const uvs = []
  const indices = []

  // Low poly faceted rock (perturbed sphere/icosahedron)
  const numRings = 4
  const numSegments = 6

  for (let r = 0; r <= numRings; r++) {
    const phi = (r / numRings) * Math.PI
    const y = Math.cos(phi) * scale * 0.7 + scale * 0.5
    for (let s = 0; s < numSegments; s++) {
      const theta = (s / numSegments) * Math.PI * 2
      // Jitter
      const jitter = 0.8 + ((r * 7 + s * 13) % 5) * 0.08
      const radius = Math.sin(phi) * scale * jitter
      const x = Math.cos(theta) * radius
      const z = Math.sin(theta) * radius
      positions.push(x, Math.max(0, y), z)
      uvs.push(0.45, 0.45) // Grey rock UV
    }
  }

  for (let r = 0; r < numRings; r++) {
    for (let s = 0; s < numSegments; s++) {
      const nextS = (s + 1) % numSegments
      const curr = r * numSegments + s
      const next = r * numSegments + nextS
      const currBelow = (r + 1) * numSegments + s
      const nextBelow = (r + 1) * numSegments + nextS

      indices.push(curr, currBelow, nextBelow)
      indices.push(curr, nextBelow, next)
    }
  }

  return createGeometry(positions, null, uvs, indices)
}

/**
 * Build low poly hill / mountain geometry
 */
export function buildHillGeometry({ radius = 0.8, height = 0.6, peakScale = 0.3 } = {}) {
  const positions = []
  const uvs = []
  const indices = []

  const sides = 7
  const baseStart = 0
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2
    positions.push(Math.cos(a) * radius, 0, Math.sin(a) * radius)
    uvs.push(0.2, 0.8)
  }

  const midStart = positions.length / 3
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + 0.2
    positions.push(Math.cos(a) * radius * 0.6, height * 0.5, Math.sin(a) * radius * 0.6)
    uvs.push(0.3, 0.7)
  }

  const peakIdx = positions.length / 3
  positions.push(0, height, 0)
  uvs.push(0.4, 0.5)

  for (let i = 0; i < sides; i++) {
    const next = (i + 1) % sides
    indices.push(baseStart + i, midStart + i, midStart + next)
    indices.push(baseStart + i, midStart + next, baseStart + next)
    indices.push(midStart + i, peakIdx, midStart + next)
  }

  return createGeometry(positions, null, uvs, indices)
}

/**
 * Generate complete fallback scene containing all 3D mesh definitions
 * for both tiles and decorations.
 */
export function createFallbackTileScene() {
  const root = new Group()
  root.name = 'FallbackScene'

  const defaultMat = new MeshStandardMaterial({ roughness: 0.9, metalness: 0.1 })

  // 1. Base Hex Tiles
  const tileMeshes = new Map()

  // Grass
  tileMeshes.set('hex_grass', buildHexPrism({ topY: 0, bottomY: -1, bevel: 0.05, paletteUv: [0.2, 0.8] }))
  // Water
  tileMeshes.set('hex_water', buildHexPrism({ topY: -0.2, bottomY: -1, recess: 0.1, paletteUv: [0.8, 0.2] }))
  // Grass Bottom
  tileMeshes.set('hex_grass_bottom', buildHexPrism({ topY: 0, bottomY: -3.0, bevel: 0.0, paletteUv: [0.4, 0.4] }))

  // Slopes
  tileMeshes.set('hex_grass_sloped_low', buildHexPrism({ topY: 0, bottomY: -1, highEdges: ['NE', 'E', 'SE'], levelIncrement: 0.5 }))
  tileMeshes.set('hex_grass_sloped_high', buildHexPrism({ topY: 0, bottomY: -1, highEdges: ['NE', 'E', 'SE'], levelIncrement: 1.0 }))
  tileMeshes.set('hex_road_A_sloped_low', buildHexPrism({ topY: 0, bottomY: -1, highEdges: ['NE', 'E', 'SE'], levelIncrement: 0.5, paletteUv: [0.5, 0.5] }))
  tileMeshes.set('hex_road_A_sloped_high', buildHexPrism({ topY: 0, bottomY: -1, highEdges: ['NE', 'E', 'SE'], levelIncrement: 1.0, paletteUv: [0.5, 0.5] }))
  tileMeshes.set('hex_road_A_sloped_low.002', buildHexPrism({ topY: 0, bottomY: -1, highEdges: ['NE', 'E', 'SE'], levelIncrement: 0.5, paletteUv: [0.5, 0.5] }))

  // Roads
  const roadNames = ['hex_road_A', 'hex_road_B', 'hex_road_D', 'hex_road_E', 'hex_road_F', 'hex_road_M']
  for (const name of roadNames) {
    tileMeshes.set(name, buildHexPrism({ topY: 0, bottomY: -1, bevel: 0.04, paletteUv: [0.5, 0.5] }))
  }

  // Rivers & Coasts
  const riverNames = [
    'hex_river_A', 'hex_river_A_curvy', 'hex_river_A_curvy.003', 'hex_river_B',
    'hex_river_D', 'hex_river_E', 'hex_river_F', 'hex_river_crossing_A', 'hex_river_crossing_B'
  ]
  for (const name of riverNames) {
    tileMeshes.set(name, buildHexPrism({ topY: 0, bottomY: -1, recess: 0.05, paletteUv: [0.75, 0.25] }))
  }

  const coastNames = [
    'hex_coast_A', 'hex_coast_A.003', 'hex_coast_A.004', 'hex_coast_B',
    'hex_coast_C', 'hex_coast_C.001', 'hex_coast_D', 'hex_coast_E'
  ]
  for (const name of coastNames) {
    tileMeshes.set(name, buildHexPrism({ topY: 0, bottomY: -1, recess: 0.08, paletteUv: [0.35, 0.65] }))
  }

  // 2. Decorations
  // Trees
  const treeNames = [
    'tree_single_A', 'tree_single_B', 'trees_A_small', 'trees_A_medium', 'trees_A_large',
    'trees_B_small', 'trees_B_medium', 'trees_B_large', 'tree_C', 'tree_D', 'tree_E',
    'Tree1_0', 'Tree2_0', 'Tree4_0'
  ]
  for (const name of treeNames) {
    const s = name.includes('large') ? 1.2 : name.includes('small') ? 0.7 : 1.0
    tileMeshes.set(name, buildTreeGeometry(s))
  }

  // Buildings
  tileMeshes.set('building_home_A_yellow', buildBuildingGeometry({ w: 0.5, h: 0.4, d: 0.5, roofH: 0.35 }))
  tileMeshes.set('building_home_B_yellow', buildBuildingGeometry({ w: 0.6, h: 0.45, d: 0.55, roofH: 0.4 }))
  tileMeshes.set('building_church_yellow', buildBuildingGeometry({ w: 0.6, h: 0.7, d: 0.8, roofH: 0.6 }))
  tileMeshes.set('building_tower_A_yellow', buildBuildingGeometry({ w: 0.45, h: 0.9, d: 0.45, roofH: 0.2 }))
  tileMeshes.set('building_tower_A_top_yellow', buildBuildingGeometry({ w: 0.48, h: 0.3, d: 0.48, roofH: 0.1 }))
  tileMeshes.set('building_townhall_yellow', buildBuildingGeometry({ w: 0.8, h: 0.6, d: 0.8, roofH: 0.5 }))
  tileMeshes.set('building_well_yellow', buildBuildingGeometry({ w: 0.3, h: 0.25, d: 0.3, roofH: 0.15 }))
  tileMeshes.set('building_market_yellow', buildBuildingGeometry({ w: 0.7, h: 0.35, d: 0.6, roofH: 0.25 }))
  tileMeshes.set('building_blacksmith_yellow', buildBuildingGeometry({ w: 0.55, h: 0.4, d: 0.55, roofH: 0.3 }))
  tileMeshes.set('building_watchtower_yellow', buildBuildingGeometry({ w: 0.4, h: 0.8, d: 0.4, roofH: 0.2 }))
  tileMeshes.set('building_mine_yellow', buildBuildingGeometry({ w: 0.6, h: 0.4, d: 0.6, roofH: 0.3 }))
  tileMeshes.set('building_shipyard_yellow', buildBuildingGeometry({ w: 0.7, h: 0.4, d: 0.9, roofH: 0.3 }))
  tileMeshes.set('building_windmill_yellow', buildBuildingGeometry({ w: 0.5, h: 0.5, d: 0.5, roofH: 0.2 }))
  tileMeshes.set('building_windmill_top_yellow', buildBuildingGeometry({ w: 0.35, h: 0.3, d: 0.35, roofH: 0.2 }))
  tileMeshes.set('building_windmill_top_fan_yellow', buildBuildingGeometry({ w: 0.8, h: 0.8, d: 0.1, roofH: 0.1 }))
  tileMeshes.set('building_bridge_A', buildBuildingGeometry({ w: 0.4, h: 0.2, d: 0.9, roofH: 0.1 }))
  tileMeshes.set('building_bridge_B', buildBuildingGeometry({ w: 0.4, h: 0.2, d: 0.9, roofH: 0.1 }))

  // Rocks
  const rockNames = ['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'rock_single_E']
  for (let i = 0; i < rockNames.length; i++) {
    tileMeshes.set(rockNames[i], buildRockGeometry(0.15 + i * 0.04))
  }

  // Hills & Mountains
  const hillNames = [
    'hills_A', 'hills_B', 'hills_C', 'hill_single_A', 'hill_single_B', 'hill_single_C',
    'hills_A_trees', 'hills_B_trees', 'hills_C_trees'
  ]
  for (const name of hillNames) {
    tileMeshes.set(name, buildHillGeometry({ radius: 0.7, height: 0.4 }))
  }

  const mountainNames = [
    'mountain_A', 'mountain_B', 'mountain_C',
    'mountain_A_grass', 'mountain_B_grass', 'mountain_C_grass'
  ]
  for (const name of mountainNames) {
    tileMeshes.set(name, buildHillGeometry({ radius: 0.9, height: 0.9 }))
  }

  // Foliage / Waterplants
  const plantNames = ['waterplant_A', 'waterplant_B', 'waterplant_C', 'bush_A', 'bush_B', 'bush_C', 'waterlily_A', 'waterlily_B']
  for (const name of plantNames) {
    tileMeshes.set(name, buildRockGeometry(0.1))
  }

  // Attach all meshes to root group
  for (const [name, geom] of tileMeshes) {
    const mesh = new Mesh(geom, defaultMat)
    mesh.name = name
    root.add(mesh)
  }

  return root
}
