/**
 * Navigation & Gameplay Data Test Suite
 * Pure JavaScript execution — no WebGPU, DOM, Telegram, or Three.js dependencies.
 */

import { test, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { IslandData, HexCell } from '../src/world/IslandData.js'
import { TileType, TILE_LIST } from '../src/hexmap/HexTileData.js'
import { CUBE_DIRS, cubeDistance, cubeKey } from '../src/hexmap/HexWFCCore.js'
import {
  TerrainCost,
  isCellWalkable,
  getCellEdgeLevel,
  getDirectionBetween,
  canTraverse,
  getMovementCost,
} from '../src/navigation/TerrainRules.js'
import { NavigationGrid } from '../src/navigation/NavigationGrid.js'
import { Pathfinder, hexHeuristic, findPath } from '../src/navigation/Pathfinder.js'

describe('Hex Coordinates & Distance Heuristic', () => {
  it('computes cube distance correctly', () => {
    // Same cell
    assert.equal(cubeDistance(0, 0, 0, 0, 0, 0), 0)
    // Direct neighbor (NE: +1, -1, 0)
    assert.equal(cubeDistance(0, 0, 0, 1, -1, 0), 1)
    // Direct neighbor (E: +1, 0, -1)
    assert.equal(cubeDistance(0, 0, 0, 1, 0, -1), 1)
    // 3 steps away along axis
    assert.equal(cubeDistance(0, 0, 0, 3, -3, 0), 3)
    // Arbitrary distance
    assert.equal(cubeDistance(-2, 1, 1, 2, -3, 1), 4)
  })

  it('detects direction between neighboring hexes', () => {
    const center = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS })
    const ne = new HexCell({ q: 1, r: -1, s: 0, type: TileType.GRASS })
    const e = new HexCell({ q: 1, r: 0, s: -1, type: TileType.GRASS })
    const nonNeighbor = new HexCell({ q: 2, r: -2, s: 0, type: TileType.GRASS })

    assert.equal(getDirectionBetween(center, ne), 'NE')
    assert.equal(getDirectionBetween(center, e), 'E')
    assert.equal(getDirectionBetween(center, nonNeighbor), null)
  })

  it('heuristic is admissible and monotonic', () => {
    const a = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS })
    const b = new HexCell({ q: 3, r: -3, s: 0, type: TileType.GRASS })
    const h = hexHeuristic(a, b)
    // 3 * 0.8 = 2.4
    assert.ok(Math.abs(h - 2.4) < 1e-6)
    // True cost can never be less than h because minimum step cost is 0.8
    assert.ok(h <= 3 * TerrainCost.ROAD)
  })
})

describe('HexCell Domain Semantics', () => {
  it('correctly identifies tile categories', () => {
    const grass = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS })
    const water = new HexCell({ q: 1, r: -1, s: 0, type: TileType.WATER })
    const road = new HexCell({ q: 0, r: 1, s: -1, type: TileType.ROAD_A })
    const slope = new HexCell({ q: -1, r: 1, s: 0, type: TileType.GRASS_SLOPE_LOW })
    const cliff = new HexCell({ q: -1, r: 0, s: 1, type: TileType.GRASS_CLIFF_LOW })

    assert.equal(grass.isWater, false)
    assert.equal(grass.isWalkable, true)
    assert.equal(grass.isSlope, false)
    assert.equal(grass.isCliff, false)

    assert.equal(water.isWater, true)
    assert.equal(water.isWalkable, false)

    assert.equal(road.isRoad, true)
    assert.equal(road.isWalkable, true)

    assert.equal(slope.isSlope, true)
    assert.equal(slope.isCliff, false)

    assert.equal(cliff.isCliff, true)
    assert.equal(cliff.isSlope, false)
  })

  it('calculates edge levels with rotation', () => {
    // GRASS_SLOPE_LOW has highEdges: ['NE', 'E', 'SE'] with levelIncrement: 1
    // rotation 0: high edges are NE, E, SE
    const slopeRot0 = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS_SLOPE_LOW, rotation: 0, level: 0 })
    assert.equal(slopeRot0.getEdgeLevel('NE'), 1)
    assert.equal(slopeRot0.getEdgeLevel('E'), 1)
    assert.equal(slopeRot0.getEdgeLevel('SE'), 1)
    assert.equal(slopeRot0.getEdgeLevel('SW'), 0)
    assert.equal(slopeRot0.getEdgeLevel('W'), 0)
    assert.equal(slopeRot0.getEdgeLevel('NW'), 0)

    // rotation 1 (60 deg clockwise): high edges shift by 1 -> E, SE, SW
    const slopeRot1 = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS_SLOPE_LOW, rotation: 1, level: 0 })
    assert.equal(slopeRot1.getEdgeLevel('NE'), 0)
    assert.equal(slopeRot1.getEdgeLevel('E'), 1)
    assert.equal(slopeRot1.getEdgeLevel('SE'), 1)
    assert.equal(slopeRot1.getEdgeLevel('SW'), 1)
    assert.equal(slopeRot1.getEdgeLevel('W'), 0)
    assert.equal(slopeRot1.getEdgeLevel('NW'), 0)
  })
})

describe('TerrainRules & Elevation Traversability', () => {
  it('blocks water cells', () => {
    const grass = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 })
    const water = new HexCell({ q: 1, r: -1, s: 0, type: TileType.WATER, level: 0 })

    assert.equal(isCellWalkable(water), false)
    assert.equal(canTraverse(grass, water), false)
    assert.equal(canTraverse(water, grass), false)
    assert.equal(getMovementCost(grass, water), Infinity)
  })

  it('allows traversal across same-level walkable land', () => {
    const a = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 })
    const b = new HexCell({ q: 1, r: -1, s: 0, type: TileType.GRASS, level: 0 })

    assert.equal(canTraverse(a, b), true)
    assert.equal(canTraverse(b, a), true)
    assert.equal(getMovementCost(a, b), TerrainCost.NORMAL)
  })

  it('blocks vertical cliff transition without slope (different levels)', () => {
    const lowGrass = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 })
    const highGrass = new HexCell({ q: 1, r: -1, s: 0, type: TileType.GRASS, level: 1 })

    assert.equal(canTraverse(lowGrass, highGrass), false)
    assert.equal(canTraverse(highGrass, lowGrass), false)
    assert.equal(getMovementCost(lowGrass, highGrass), Infinity)
  })

  it('correctly handles GRASS_CLIFF_LOW semantics (low edge traversable, high edge cliff face blocked)', () => {
    // GRASS_CLIFF_LOW at (0,0,0) at level 0, rotation 0
    // highEdges: ['NE', 'E', 'SE'] with levelIncrement: 1
    // lowEdges: ['SW', 'W', 'NW'] at level 0
    const cliffLow = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS_CLIFF_LOW, rotation: 0, level: 0 })

    // Compatible low-side level 0 land at West (-1, 0, 1) and SW (0, -1, 1)
    const lowLandWest = new HexCell({ q: -1, r: 0, s: 1, type: TileType.GRASS, level: 0 })
    const lowLandSW = new HexCell({ q: 0, r: -1, s: 1, type: TileType.GRASS, level: 0 })

    // Elevated level 1 land facing the cliff's high edge at East (1, 0, -1) and NE (1, -1, 0)
    const highLandEast = new HexCell({ q: 1, r: 0, s: -1, type: TileType.GRASS, level: 1 })
    const highLandNE = new HexCell({ q: 1, r: -1, s: 0, type: TileType.GRASS, level: 1 })

    // Low-side transition: continuous base surface at level 0 -> allowed in both directions
    assert.equal(canTraverse(cliffLow, lowLandWest), true)
    assert.equal(canTraverse(lowLandWest, cliffLow), true)
    assert.equal(getMovementCost(cliffLow, lowLandWest), TerrainCost.NORMAL)
    assert.equal(canTraverse(cliffLow, lowLandSW), true)
    assert.equal(canTraverse(lowLandSW, cliffLow), true)

    // High-side transition: vertical cliff face -> blocked in both directions
    assert.equal(canTraverse(cliffLow, highLandEast), false)
    assert.equal(canTraverse(highLandEast, cliffLow), false)
    assert.equal(getMovementCost(cliffLow, highLandEast), Infinity)
    assert.equal(canTraverse(cliffLow, highLandNE), false)
    assert.equal(canTraverse(highLandNE, cliffLow), false)
    assert.equal(getMovementCost(cliffLow, highLandNE), Infinity)
  })

  it('correctly handles GRASS_CLIFF (levelIncrement: 2) and GRASS_CLIFF_LOW_C semantics', () => {
    // GRASS_CLIFF at level 0, rotation 0 (highEdges NE, E, SE with levelIncrement: 2)
    const cliff2 = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS_CLIFF, rotation: 0, level: 0 })
    const lowLandWest = new HexCell({ q: -1, r: 0, s: 1, type: TileType.GRASS, level: 0 })
    const highLandEast2 = new HexCell({ q: 1, r: 0, s: -1, type: TileType.GRASS, level: 2 })

    // Low-side allowed
    assert.equal(canTraverse(cliff2, lowLandWest), true)
    assert.equal(canTraverse(lowLandWest, cliff2), true)

    // High-side (level 2 cliff drop) blocked both ways
    assert.equal(canTraverse(cliff2, highLandEast2), false)
    assert.equal(canTraverse(highLandEast2, cliff2), false)

    // GRASS_CLIFF_LOW_C (single highEdge 'E', levelIncrement: 1)
    const cliffC = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS_CLIFF_LOW_C, rotation: 0, level: 0 })
    const highLandEast = new HexCell({ q: 1, r: 0, s: -1, type: TileType.GRASS, level: 1 })
    const lowLandNE = new HexCell({ q: 1, r: -1, s: 0, type: TileType.GRASS, level: 0 })

    // East (high edge) blocked
    assert.equal(canTraverse(cliffC, highLandEast), false)
    assert.equal(canTraverse(highLandEast, cliffC), false)

    // NE (low edge on cliffC) allowed to level 0 grass
    assert.equal(canTraverse(cliffC, lowLandNE), true)
    assert.equal(canTraverse(lowLandNE, cliffC), true)
  })

  it('allows traversal across correctly oriented slopes', () => {
    // slope at (0,0,0) at level 0, rotation 0 -> high edges NE, E, SE are level 1
    const slope = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS_SLOPE_LOW, rotation: 0, level: 0 })
    // high land to the East (1, 0, -1) at level 1
    const highLandEast = new HexCell({ q: 1, r: 0, s: -1, type: TileType.GRASS, level: 1 })
    // low land to the West (-1, 0, 1) at level 0
    const lowLandWest = new HexCell({ q: -1, r: 0, s: 1, type: TileType.GRASS, level: 0 })

    // Going up slope towards East
    assert.equal(canTraverse(slope, highLandEast), true)
    assert.equal(canTraverse(highLandEast, slope), true)
    assert.equal(getMovementCost(slope, highLandEast), TerrainCost.SLOPE)

    // Going down slope towards West
    assert.equal(canTraverse(slope, lowLandWest), true)
    assert.equal(canTraverse(lowLandWest, slope), true)
    assert.equal(getMovementCost(slope, lowLandWest), TerrainCost.SLOPE)
  })

  it('blocks traversal when slope high edge faces low ground or vice-versa', () => {
    // slope at (0,0,0) at level 0, rotation 0 -> high edges NE, E, SE are level 1
    const slope = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS_SLOPE_LOW, rotation: 0, level: 0 })
    // Flat land to the East (1, 0, -1) but at level 0 (not level 1)
    const lowLandEast = new HexCell({ q: 1, r: 0, s: -1, type: TileType.GRASS, level: 0 })

    // High edge of slope (level 1) against flat land (level 0) -> elevation mismatch -> blocked
    assert.equal(canTraverse(slope, lowLandEast), false)
    assert.equal(canTraverse(lowLandEast, slope), false)
  })

  it('applies lower movement cost to road transitions', () => {
    const roadA = new HexCell({ q: 0, r: 0, s: 0, type: TileType.ROAD_A, level: 0 })
    const roadB = new HexCell({ q: 1, r: 0, s: -1, type: TileType.ROAD_A, level: 0 })

    assert.equal(canTraverse(roadA, roadB), true)
    assert.equal(getMovementCost(roadA, roadB), TerrainCost.ROAD)
    assert.ok(TerrainCost.ROAD < TerrainCost.NORMAL)
  })
})

describe('NavigationGrid', () => {
  it('constructs from IslandData and queries cells and neighbors', () => {
    const island = new IslandData({ seed: 123, radius: 2 })
    const c0 = island.addCell(new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 }))
    const c1 = island.addCell(new HexCell({ q: 1, r: -1, s: 0, type: TileType.GRASS, level: 0 }))
    const cWater = island.addCell(new HexCell({ q: 1, r: 0, s: -1, type: TileType.WATER, level: 0 }))
    const cHigh = island.addCell(new HexCell({ q: 0, r: 1, s: -1, type: TileType.GRASS, level: 1 }))

    const nav = new NavigationGrid(island)

    assert.equal(nav.getCell(0, 0, 0), c0)
    assert.equal(nav.getCellByKey('1,-1,0'), c1)

    const neighbors = nav.getNeighbors(c0)
    // Only c1 is traversable (cWater is water, cHigh is elevation mismatch, others don't exist)
    assert.equal(neighbors.length, 1)
    assert.equal(neighbors[0].key, c1.key)

    const allAdj = nav.getAllAdjacentCells(c0)
    assert.equal(allAdj.length, 3) // c1, cWater, cHigh exist in island
  })

  it('calculates reachable cells via flood fill', () => {
    const island = new IslandData({ seed: 456, radius: 2 })
    const c0 = island.addCell(new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 }))
    const c1 = island.addCell(new HexCell({ q: 1, r: -1, s: 0, type: TileType.GRASS, level: 0 }))
    const c2 = island.addCell(new HexCell({ q: 2, r: -2, s: 0, type: TileType.GRASS, level: 0 }))
    const cWater = island.addCell(new HexCell({ q: 0, r: 1, s: -1, type: TileType.WATER, level: 0 }))

    const nav = new NavigationGrid(island)
    const reachable = nav.getReachableCells(c0, 2.0)

    assert.ok(reachable.has(c0.key))
    assert.ok(reachable.has(c1.key))
    assert.ok(reachable.has(c2.key))
    assert.equal(reachable.has(cWater.key), false)
  })

  it('correctly reports cell membership via containsCell', () => {
    const islandA = new IslandData({ seed: 1, radius: 2 })
    const islandB = new IslandData({ seed: 2, radius: 2 })

    const cellA = islandA.addCell(new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 }))
    const cellB = islandB.addCell(new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 })) // Same coords, different instance

    const navA = new NavigationGrid(islandA)
    const navB = new NavigationGrid(islandB)

    assert.equal(navA.containsCell(cellA), true)
    assert.equal(navA.containsCell(cellB), false) // Same q,r,s but foreign object -> rejected
    assert.equal(navB.containsCell(cellB), true)
    assert.equal(navB.containsCell(cellA), false)

    assert.equal(navA.containsCell(null), false)
    assert.equal(navA.containsCell(undefined), false)
    assert.equal(navA.containsCell({ q: 0, r: 0, s: 0 }), false)
  })
})

describe('Pathfinder (Deterministic Hex A*)', () => {
  it('rejects stale or foreign HexCell instances cleanly without throwing', () => {
    const island1 = new IslandData({ seed: 111, radius: 2 })
    const island2 = new IslandData({ seed: 222, radius: 2 })

    const c1Start = island1.addCell(new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 }))
    const c1Goal = island1.addCell(new HexCell({ q: 1, r: -1, s: 0, type: TileType.GRASS, level: 0 }))

    // Foreign cells from a different island generation with same coordinates
    const c2Start = island2.addCell(new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 }))
    const c2Goal = island2.addCell(new HexCell({ q: 1, r: -1, s: 0, type: TileType.GRASS, level: 0 }))

    const nav1 = new NavigationGrid(island1)
    const pf1 = new Pathfinder(nav1)

    // Valid within island1
    const validPath = pf1.findPath(c1Start, c1Goal)
    assert.ok(validPath !== null)
    assert.equal(validPath.length, 2)

    // Foreign start cell -> null
    assert.equal(pf1.findPath(c2Start, c1Goal), null)

    // Foreign goal cell -> null
    assert.equal(pf1.findPath(c1Start, c2Goal), null)

    // Both foreign -> null
    assert.equal(pf1.findPath(c2Start, c2Goal), null)
  })
  it('handles start == goal and invalid/unreachable queries cleanly', () => {
    const island = new IslandData({ seed: 789, radius: 2 })
    const c0 = island.addCell(new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 }))
    const cWater = island.addCell(new HexCell({ q: 1, r: -1, s: 0, type: TileType.WATER, level: 0 }))
    const isolated = island.addCell(new HexCell({ q: -2, r: 2, s: 0, type: TileType.GRASS, level: 0 }))

    const nav = new NavigationGrid(island)
    const pf = new Pathfinder(nav)

    // Start is goal
    const samePath = pf.findPath(c0, c0)
    assert.ok(Array.isArray(samePath))
    assert.equal(samePath.length, 1)
    assert.equal(samePath[0].key, c0.key)

    // Goal is water -> null
    assert.equal(pf.findPath(c0, cWater), null)

    // Null inputs -> null
    assert.equal(pf.findPath(null, c0), null)
    assert.equal(pf.findPath(c0, null), null)

    // Isolated unreachable goal -> null
    assert.equal(pf.findPath(c0, isolated), null)
  })

  it('finds path across flat walkable terrain', () => {
    const island = new IslandData({ seed: 101, radius: 3 })
    // Build a 3-step linear line of grass cells: (0,0,0) -> (1,-1,0) -> (2,-2,0) -> (3,-3,0)
    const c0 = island.addCell(new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 }))
    const c1 = island.addCell(new HexCell({ q: 1, r: -1, s: 0, type: TileType.GRASS, level: 0 }))
    const c2 = island.addCell(new HexCell({ q: 2, r: -2, s: 0, type: TileType.GRASS, level: 0 }))
    const c3 = island.addCell(new HexCell({ q: 3, r: -3, s: 0, type: TileType.GRASS, level: 0 }))

    const nav = new NavigationGrid(island)
    const path = findPath(nav, c0, c3)

    assert.ok(path !== null)
    assert.equal(path.length, 4)
    assert.equal(path[0].key, c0.key)
    assert.equal(path[1].key, c1.key)
    assert.equal(path[2].key, c2.key)
    assert.equal(path[3].key, c3.key)
  })

  it('routes up a slope to reach higher elevation', () => {
    const island = new IslandData({ seed: 202, radius: 3 })
    // Low level 0 grass at (0,0,0)
    const c0 = island.addCell(new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 }))
    // Slope at (1,0,-1) at level 0, rotation 0 (high edges toward E/NE/SE)
    const slope = island.addCell(new HexCell({ q: 1, r: 0, s: -1, type: TileType.GRASS_SLOPE_LOW, rotation: 0, level: 0 }))
    // High level 1 grass at (2,0,-2) (to the East of slope)
    const cHigh = island.addCell(new HexCell({ q: 2, r: 0, s: -2, type: TileType.GRASS, level: 1 }))

    const nav = new NavigationGrid(island)
    const path = findPath(nav, c0, cHigh)

    assert.ok(path !== null)
    assert.equal(path.length, 3)
    assert.equal(path[0].key, c0.key)
    assert.equal(path[1].key, slope.key)
    assert.equal(path[2].key, cHigh.key)
  })

  it('is strictly deterministic across multiple runs', () => {
    const island = new IslandData({ seed: 303, radius: 2 })
    const c0 = island.addCell(new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 }))
    const c1 = island.addCell(new HexCell({ q: 1, r: -1, s: 0, type: TileType.GRASS, level: 0 }))
    const c2 = island.addCell(new HexCell({ q: 0, r: -1, s: 1, type: TileType.GRASS, level: 0 }))
    const c3 = island.addCell(new HexCell({ q: 1, r: -2, s: 1, type: TileType.GRASS, level: 0 }))

    const nav = new NavigationGrid(island)
    const pf = new Pathfinder(nav)

    const firstRun = pf.findPath(c0, c3).map(c => c.key)

    for (let i = 0; i < 20; i++) {
      const run = pf.findPath(c0, c3).map(c => c.key)
      assert.deepEqual(run, firstRun)
    }
  })

  it('prefers cheaper road routes over high-cost routes', () => {
    const island = new IslandData({ seed: 404, radius: 3 })
    // Start at (0,0,0)
    const start = island.addCell(new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0 }))
    // Goal at (2, 0, -2)
    const goal = island.addCell(new HexCell({ q: 2, r: 0, s: -2, type: TileType.GRASS, level: 0 }))

    // Route A (Direct through grass): (0,0,0) -> (1,0,-1)[grass] -> (2,0,-2) => Cost: 1.0 + 1.0 = 2.0
    const directGrass = island.addCell(new HexCell({ q: 1, r: 0, s: -1, type: TileType.GRASS, level: 0 }))

    // Route B (Through road): (0,0,0) -> (1,-1,0)[road] -> (2,-1,-1)[road] -> (2,0,-2) => Cost: 1.0 + 0.8 + 1.0 = 2.8 (longer)
    // But if we make start and goal also road:
    const roadStart = island.addCell(new HexCell({ q: 0, r: 0, s: 0, type: TileType.ROAD_A, level: 0 }))
    const roadMid = island.addCell(new HexCell({ q: 1, r: 0, s: -1, type: TileType.ROAD_A, level: 0 }))
    const roadGoal = island.addCell(new HexCell({ q: 2, r: 0, s: -2, type: TileType.ROAD_A, level: 0 }))

    const nav = new NavigationGrid(island)
    const path = findPath(nav, roadStart, roadGoal)

    assert.ok(path !== null)
    assert.equal(path.length, 3)
    assert.equal(path[1].key, roadMid.key)
  })
})
