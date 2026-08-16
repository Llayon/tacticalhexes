/**
 * IslandGenerator - Procedural island generation coordinator.
 * Deterministically generates an IslandData model from a seed and radius using WFC.
 */

import { IslandData, HexCell } from './IslandData.js'
import { cubeCoordsInRadius, cubeKey } from '../hexmap/HexWFCCore.js'
import { TileType, TILE_LIST } from '../hexmap/HexTileData.js'
import { setSeed, random } from '../SeededRandom.js'

export class IslandGenerator {
  constructor(wfcManager) {
    this.wfcManager = wfcManager
  }

  /**
   * Compute initial collapse seeds for a single island of given radius.
   * Places a center land seed and perimeter water seeds for natural island edges.
   */
  createInitialCollapses(radius) {
    const initialCollapses = [
      { q: 0, r: 0, s: 0, type: TileType.GRASS, rotation: 0, level: 0 },
    ]

    // 6 cube directions
    const dirs = [
      { q: 1, r: -1, s: 0 }, { q: 1, r: 0, s: -1 }, { q: 0, r: 1, s: -1 },
      { q: -1, r: 1, s: 0 }, { q: -1, r: 0, s: 1 }, { q: 0, r: -1, s: 1 },
    ]

    // Pick 1-2 random edge sides to seed water/bay entry
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
   * Generate an island data instance
   * @param {Object} options
   * @param {number} [options.seed]
   * @param {number} [options.radius=5]
   * @param {Array<number>} [options.tileTypes]
   * @returns {Promise<IslandData>}
   */
  async generate({ seed = Math.floor(Math.random() * 1000000), radius = 5, tileTypes = null } = {}) {
    setSeed(seed)

    const allSolveCells = cubeCoordsInRadius(0, 0, 0, radius)
    const initialCollapses = this.createInitialCollapses(radius)
    const allowedTypes = tileTypes || TILE_LIST.map((_, i) => i)

    const wfcResult = await this.wfcManager.solveWfcAsync(allSolveCells, [], {
      tileTypes: allowedTypes,
      weights: {},
      maxTries: 8,
      initialCollapses,
      gridId: `island_${seed}`,
      attemptNum: 1,
    })

    if (!wfcResult || !wfcResult.success || !wfcResult.tiles) {
      throw new Error(`[IslandGenerator] WFC solve failed for seed ${seed} with radius ${radius}`)
    }

    const island = new IslandData({ seed, radius })

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

    return island
  }
}
