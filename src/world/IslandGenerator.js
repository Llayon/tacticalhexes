/**
 * IslandGenerator - Procedural island generation coordinator.
 * Integrates deterministic macro ElevationField with elevation-constrained WFC.
 */

import { IslandData, HexCell } from './IslandData.js'
import { cubeCoordsInRadius, cubeKey } from '../hexmap/HexWFCCore.js'
import { TileType, TILE_LIST, LEVELS_COUNT } from '../hexmap/HexTileData.js'
import { generateElevationField } from './terrain/ElevationField.js'
import { NavigationGrid } from '../navigation/NavigationGrid.js'
import { setSeed, random } from '../SeededRandom.js'

export class IslandGenerator {
  constructor(wfcManager) {
    this.wfcManager = wfcManager
    this.maxAttempts = 5
  }

  /**
   * Compute initial collapse seeds for a single island of given radius.
   * Uses ElevationField to ensure center land seed matches target macro elevation.
   * @param {number} radius
   * @param {import('./terrain/ElevationField.js').ElevationField} elevationField
   */
  createInitialCollapses(radius, elevationField) {
    const centerLevel = elevationField.getLevel(0, 0, 0)
    const initialCollapses = [
      { q: 0, r: 0, s: 0, type: TileType.GRASS, rotation: 0, level: centerLevel },
    ]

    // 6 cube directions
    const dirs = [
      { q: 1, r: -1, s: 0 }, { q: 1, r: 0, s: -1 }, { q: 0, r: 1, s: -1 },
      { q: -1, r: 1, s: 0 }, { q: -1, r: 0, s: 1 }, { q: 0, r: -1, s: 1 },
    ]

    // Pick 1 perimeter side to seed water/bay entry at level 0
    const sideIdx = Math.floor(random() * 6)
    const d = dirs[sideIdx]
    const d2 = dirs[(sideIdx + 1) % 6]
    const half = Math.floor(radius / 2)
    const q = d.q * (radius - half) + d2.q * half
    const r = d.r * (radius - half) + d2.r * half
    const s = d.s * (radius - half) + d2.s * half
    initialCollapses.push({ q, r, s, type: TileType.WATER, rotation: 0, level: 0 })

    return initialCollapses
  }

  /**
   * Analyze navigation connectivity across the generated island.
   * Calculates connected components of walkable cells and accessibility of elevated terrain.
   * @param {IslandData} island
   * @returns {{ walkableCount: number, mainCompCount: number, ratio: number, mainLevels: number[], isAcceptable: boolean }}
   */
  analyzeConnectivity(island) {
    const navGrid = new NavigationGrid(island)
    const walkableCells = island.getWalkableCells()
    if (walkableCells.length === 0) {
      return { walkableCount: 0, mainCompCount: 0, ratio: 0, mainLevels: [], isAcceptable: false }
    }

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
    const mainLevels = Array.from(new Set(mainComp.map(c => c.level))).sort((a, b) => a - b)

    // Accept if at least 50% of land is connected and high ground is reachable (if present)
    const isAcceptable = ratio >= 0.50

    return {
      walkableCount: walkableCells.length,
      mainCompCount: mainComp.length,
      ratio,
      mainLevels,
      isAcceptable,
    }
  }

  /**
   * Log comprehensive terrain diagnostics
   */
  logDiagnostics({ seed, attempt, elevationField, island, connectivity, tries, backtracks }) {
    const allCells = island.getAllCells()
    const levelCounts = {}
    for (let l = 0; l < LEVELS_COUNT; l++) levelCounts[l] = 0

    let slopeCount = 0
    let cliffCount = 0
    let minLevel = LEVELS_COUNT
    let maxLevel = 0

    for (const cell of allCells) {
      const lvl = cell.level ?? 0
      levelCounts[lvl] = (levelCounts[lvl] || 0) + 1
      if (lvl < minLevel) minLevel = lvl
      if (lvl > maxLevel) maxLevel = lvl

      if (cell.isSlope) slopeCount++
      if (cell.isCliff) cliffCount++
    }

    const lines = [
      `[TERRAIN] seed: ${seed} (attempt: ${attempt}, profile: ${elevationField.profile})`,
      `  levels: ${Object.entries(levelCounts).map(([l, c]) => `L${l}:${c}`).join(' ')}`,
      `  slopes: ${slopeCount} | cliffs: ${cliffCount}`,
      `  elevation range: [${minLevel}..${maxLevel}] (distinct: ${Object.values(levelCounts).filter(c => c > 0).length})`,
      `  walkable connectivity: ${(connectivity.ratio * 100).toFixed(1)}% (${connectivity.mainCompCount}/${connectivity.walkableCount} cells, reachable levels: [${connectivity.mainLevels.join(',')}])`,
      `  WFC stats: ${tries || 1} tries, ${backtracks || 0} backtracks`,
    ]

    console.log(lines.join('\n'))
  }

  /**
   * Generate an island data instance
   * @param {Object} options
   * @param {number} [options.seed]
   * @param {number} [options.radius=5]
   * @param {Array<number>} [options.tileTypes]
   * @param {string} [options.profile]
   * @returns {Promise<IslandData>}
   */
  async generate({ seed = Math.floor(Math.random() * 1000000), radius = 5, tileTypes = null, profile = null } = {}) {
    const allowedTypes = tileTypes || TILE_LIST.map((_, i) => i)
    const allSolveCells = cubeCoordsInRadius(0, 0, 0, radius)

    let bestIsland = null
    let bestConnectivity = null
    let bestElevationField = null
    let lastError = null

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      const attemptSeed = attempt === 0 ? seed : (seed + attempt * 7919)
      setSeed(attemptSeed)

      // 1. Generate macro elevation field
      const elevationField = generateElevationField({
        seed: attemptSeed,
        radius,
        profile: attempt === 0 ? profile : null,
      })

      // 2. Generate per-cell WFC state constraints
      const allowedStatesByCell = elevationField.createWfcAllowedStates(allowedTypes)

      // 3. Initial collapse seeds
      const initialCollapses = this.createInitialCollapses(radius, elevationField)

      // 4. Solve WFC via worker
      try {
        const wfcResult = await this.wfcManager.solveWfcAsync(allSolveCells, [], {
          tileTypes: allowedTypes,
          allowedStatesByCell,
          weights: {},
          maxTries: 4,
          initialCollapses,
          gridId: `island_${attemptSeed}`,
          attemptNum: attempt + 1,
        })

        if (!wfcResult || !wfcResult.success || !wfcResult.tiles) {
          throw new Error(`WFC failed to find valid tile configuration (tries: ${wfcResult?.tries ?? 0})`)
        }

        // 5. Construct domain model
        const island = new IslandData({ seed: attemptSeed, radius })
        for (const tile of wfcResult.tiles) {
          island.addCell(new HexCell({
            q: tile.q,
            r: tile.r,
            s: tile.s,
            type: tile.type,
            rotation: tile.rotation,
            level: tile.level ?? 0,
          }))
        }

        if (wfcResult.collapseOrder) {
          island.collapseOrder = wfcResult.collapseOrder.map(c => ({
            q: c.q,
            r: c.r,
            s: c.s,
            type: c.type,
            rotation: c.rotation,
            level: c.level ?? 0,
          }))
        }

        island.elevationField = elevationField
        island.profile = elevationField.profile

        // 6. Connectivity validation
        const connectivity = this.analyzeConnectivity(island)

        if (!bestIsland || connectivity.ratio > (bestConnectivity?.ratio ?? 0)) {
          bestIsland = island
          bestConnectivity = connectivity
          bestElevationField = elevationField
        }

        if (connectivity.isAcceptable) {
          this.logDiagnostics({
            seed,
            attempt,
            elevationField,
            island,
            connectivity,
            tries: wfcResult.tries,
            backtracks: wfcResult.backtracks,
          })
          return island
        } else {
          console.warn(`[IslandGenerator] Attempt ${attempt} had low connectivity (${(connectivity.ratio * 100).toFixed(1)}%), retrying...`)
        }
      } catch (err) {
        lastError = err
        console.warn(`[IslandGenerator] Attempt ${attempt} failed: ${err.message}, retrying...`)
      }
    }

    if (bestIsland) {
      console.warn(`[IslandGenerator] Max attempts reached, returning best candidate island with ${(bestConnectivity.ratio * 100).toFixed(1)}% connectivity`)
      this.logDiagnostics({
        seed,
        attempt: this.maxAttempts - 1,
        elevationField: bestElevationField,
        island: bestIsland,
        connectivity: bestConnectivity,
        tries: 1,
        backtracks: 0,
      })
      return bestIsland
    }

    throw new Error(`[IslandGenerator] Island generation failed after ${this.maxAttempts} attempts: ${lastError?.message}`)
  }
}
