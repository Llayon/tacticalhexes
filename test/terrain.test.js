/**
 * Terrain Relief & Macro Elevation Field Test Suite
 * Pure JavaScript execution — no WebGPU, DOM, Telegram, or Three.js dependencies.
 */

import { test, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  ElevationField,
  TerrainProfile,
  generateElevationField,
} from '../src/world/terrain/ElevationField.js'
import {
  CUBE_DIRS,
  cubeCoordsInRadius,
  cubeDistance,
  cubeKey,
  HexWFCCell,
  HexWFCAdjacencyRules,
} from '../src/hexmap/HexWFCCore.js'
import { HexWFCSolver } from '../src/workers/wfc.worker.js'
import { TileType, TILE_LIST, LEVELS_COUNT } from '../src/hexmap/HexTileData.js'
import { IslandData, HexCell } from '../src/world/IslandData.js'
import { NavigationGrid } from '../src/navigation/NavigationGrid.js'
import { setSeed } from '../src/SeededRandom.js'

describe('ElevationField Determinism & Profiles', () => {
  it('generates identical elevation fields for identical seeds', () => {
    const seed = 12345
    const radius = 5
    const fieldA = new ElevationField({ seed, radius })
    const fieldB = new ElevationField({ seed, radius })

    assert.equal(fieldA.profile, fieldB.profile)
    assert.equal(fieldA.minLevel, fieldB.minLevel)
    assert.equal(fieldA.maxLevel, fieldB.maxLevel)
    assert.equal(fieldA.usedLevelCount, fieldB.usedLevelCount)

    const allCells = cubeCoordsInRadius(0, 0, 0, radius)
    for (const { q, r, s } of allCells) {
      assert.equal(fieldA.getLevel(q, r, s), fieldB.getLevel(q, r, s))
    }
  })

  it('respects explicitly provided profiles', () => {
    const seed = 42
    const radius = 5

    const rolling = new ElevationField({ seed, radius, profile: TerrainProfile.ROLLING })
    assert.equal(rolling.profile, TerrainProfile.ROLLING)
    assert.ok(rolling.maxLevel <= 2)

    const highland = new ElevationField({ seed, radius, profile: TerrainProfile.HIGHLAND })
    assert.equal(highland.profile, TerrainProfile.HIGHLAND)
    assert.ok(highland.maxLevel <= 3)

    const mountain = new ElevationField({ seed, radius, profile: TerrainProfile.MOUNTAIN })
    assert.equal(mountain.profile, TerrainProfile.MOUNTAIN)
    assert.ok(mountain.maxLevel <= 4)
  })

  it('enforces Level 0 on island perimeter', () => {
    const seeds = [10001, 206212, 77824, 3332, 55555]
    const radius = 5

    for (const seed of seeds) {
      const field = new ElevationField({ seed, radius })
      const allCells = cubeCoordsInRadius(0, 0, 0, radius)

      for (const { q, r, s } of allCells) {
        if (cubeDistance(0, 0, 0, q, r, s) === radius) {
          assert.equal(field.getLevel(q, r, s), 0, `Perimeter cell (${q},${r},${s}) must be level 0`)
        }
      }
    }
  })

  it('smooths adjacent neighbor gradient to maximum step of 1', () => {
    const seeds = [10001, 206212, 77824, 3332, 55555, 99999]
    const radius = 5

    for (const seed of seeds) {
      const field = new ElevationField({ seed, radius })
      const allCells = cubeCoordsInRadius(0, 0, 0, radius)

      for (const { q, r, s } of allCells) {
        const lvl = field.getLevel(q, r, s)
        for (const dir of CUBE_DIRS) {
          const nq = q + dir.dq
          const nr = r + dir.dr
          const ns = s + dir.ds
          if (cubeDistance(0, 0, 0, nq, nr, ns) <= radius) {
            const nLvl = field.getLevel(nq, nr, ns)
            const diff = Math.abs(nLvl - lvl)
            assert.ok(diff <= 1, `Gradient between (${q},${r},${s}) [${lvl}] and (${nq},${nr},${ns}) [${nLvl}] exceeds 1`)
          }
        }
      }
    }
  })
})

describe('WFC Allowed States Generation', () => {
  it('generates non-empty candidate states for all cells', () => {
    const seed = 10001
    const radius = 5
    const field = new ElevationField({ seed, radius })
    const allowed = field.createWfcAllowedStates()
    const allCells = cubeCoordsInRadius(0, 0, 0, radius)

    for (const { q, r, s } of allCells) {
      const key = cubeKey(q, r, s)
      const states = allowed[key]
      assert.ok(Array.isArray(states), `Allowed states for ${key} must be an array`)
      assert.ok(states.length > 0, `Allowed states for ${key} must not be empty`)

      // Check base level match
      const baseLevel = field.getLevel(q, r, s)
      for (const stateKey of states) {
        const parsed = HexWFCCell.parseKey(stateKey)
        assert.equal(parsed.level, baseLevel, `State ${stateKey} level must match baseLevel ${baseLevel}`)
      }
    }
  })

  it('restricts perimeter cells to water and coast tiles', () => {
    const seed = 77824
    const radius = 5
    const field = new ElevationField({ seed, radius })
    const allowed = field.createWfcAllowedStates()
    const allCells = cubeCoordsInRadius(0, 0, 0, radius)

    for (const { q, r, s } of allCells) {
      if (cubeDistance(0, 0, 0, q, r, s) === radius) {
        const key = cubeKey(q, r, s)
        const states = allowed[key]
        for (const stateKey of states) {
          const parsed = HexWFCCell.parseKey(stateKey)
          const def = TILE_LIST[parsed.type]
          const isWaterOrCoast = parsed.type === TileType.WATER || def.name.startsWith('COAST_')
          assert.ok(isWaterOrCoast, `Perimeter state ${stateKey} (${def.name}) must be water or coast`)
          assert.equal(parsed.level, 0, `Perimeter state level must be 0`)
        }
      }
    }
  })
})

describe('Elevation-Constrained WFC Solving & Multi-Level Relief', () => {
  it('successfully solves WFC across multiple seeds with 3+ elevation levels', () => {
    const testSeeds = [10001, 206212, 77824, 3332, 55555, 99999, 12345, 67890]
    const radius = 5
    const allSolveCells = cubeCoordsInRadius(0, 0, 0, radius)
    const rules = HexWFCAdjacencyRules.fromTileDefinitions()

    for (const seed of testSeeds) {
      setSeed(seed)
      const field = generateElevationField({ seed, radius })
      const allowedStatesByCell = field.createWfcAllowedStates()

      const solver = new HexWFCSolver(rules, {
        maxTries: 3,
        allowedStatesByCell,
        quiet: true,
      })

      const centerLevel = field.getLevel(0, 0, 0)
      const initialCollapses = [
        { q: 0, r: 0, s: 0, type: TileType.GRASS, rotation: 0, level: centerLevel },
        { q: 5, r: -5, s: 0, type: TileType.WATER, rotation: 0, level: 0 },
      ]

      const result = solver.solve(allSolveCells, [], initialCollapses)
      assert.ok(result, `Solver must succeed for seed ${seed}`)
      assert.equal(result.length, allSolveCells.length)

      const usedLevels = new Set(result.map(t => t.level))
      assert.ok(usedLevels.size >= 3, `Seed ${seed} must use at least 3 distinct elevation levels (got ${usedLevels.size}: [${[...usedLevels]}])`)
      assert.ok(usedLevels.has(0), `Seed ${seed} must include Level 0`)
    }
  })

  it('produces navigable multi-level terrain with connected plateaus', () => {
    const testSeeds = [10001, 77824, 3332, 55555]
    const radius = 5
    const allSolveCells = cubeCoordsInRadius(0, 0, 0, radius)
    const rules = HexWFCAdjacencyRules.fromTileDefinitions()

    for (const seed of testSeeds) {
      setSeed(seed)
      const field = generateElevationField({ seed, radius })
      const allowedStatesByCell = field.createWfcAllowedStates()

      const solver = new HexWFCSolver(rules, {
        maxTries: 3,
        allowedStatesByCell,
        quiet: true,
      })

      const centerLevel = field.getLevel(0, 0, 0)
      const initialCollapses = [
        { q: 0, r: 0, s: 0, type: TileType.GRASS, rotation: 0, level: centerLevel },
        { q: 5, r: -5, s: 0, type: TileType.WATER, rotation: 0, level: 0 },
      ]

      const result = solver.solve(allSolveCells, [], initialCollapses)
      assert.ok(result)

      const island = new IslandData({ seed, radius })
      for (const t of result) island.addCell(new HexCell(t))

      const navGrid = new NavigationGrid(island)
      const walkableCells = island.getWalkableCells()
      assert.ok(walkableCells.length > 50, 'Island should have substantial walkable land')

      // Connected component check
      const visited = new Set()
      const components = []
      for (const cell of walkableCells) {
        if (visited.has(cell.key)) continue
        const comp = []
        const queue = [cell]
        visited.add(cell.key)
        while (queue.length > 0) {
          const curr = queue.shift()
          comp.push(curr)
          for (const neighbor of navGrid.getNeighbors(curr)) {
            if (!visited.has(neighbor.key)) {
              visited.add(neighbor.key)
              queue.push(neighbor)
            }
          }
        }
        components.push(comp)
      }

      components.sort((a, b) => b.length - a.length)
      const mainComp = components[0] || []
      const ratio = mainComp.length / walkableCells.length

      assert.ok(ratio >= 0.50, `Main walkable component ratio (${ratio.toFixed(2)}) should be >= 0.50 for seed ${seed}`)
      const mainLevels = new Set(mainComp.map(c => c.level))
      assert.ok(mainLevels.size >= 2, `Main walkable component should reach across multiple levels (got [${[...mainLevels]}])`)
    }
  })
})
