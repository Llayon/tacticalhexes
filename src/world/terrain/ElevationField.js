/**
 * ElevationField - Deterministic macro elevation field generator for hex islands.
 * Pure JavaScript domain logic — no Three.js, DOM, or Telegram dependencies.
 */

import {
  CUBE_DIRS,
  cubeCoordsInRadius,
  cubeDistance,
  cubeKey,
  getEdgeLevel,
  HexWFCCell,
} from '../../hexmap/HexWFCCore.js'
import {
  TILE_LIST,
  TileType,
  HexDir,
  LEVELS_COUNT,
} from '../../hexmap/HexTileData.js'

/**
 * Pure Mulberry32 PRNG instance for deterministic field generation
 */
function createPRNG(seed) {
  let s = (Math.abs(seed) >>> 0) || 1
  return function() {
    s |= 0
    s = s + 0x6D2B79F5 | 0
    let t = Math.imul(s ^ s >>> 15, 1 | s)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/**
 * Supported terrain elevation profiles
 */
export const TerrainProfile = {
  ROLLING: 'ROLLING',     // Max Level 2: Gentle rolling hills, broad lower plateaus
  HIGHLAND: 'HIGHLAND',   // Max Level 3: Balanced tactical diorama with distinct plateau and high ground
  RUGGED: 'RUGGED',       // Max Level 3: Sharper ridges and cliff transitions
  MOUNTAIN: 'MOUNTAIN',   // Max Level 4: High peak accents and steep shoulders
}

export class ElevationField {
  constructor({ seed = 0, radius = 5, profile = null } = {}) {
    this.seed = seed
    this.radius = radius
    this.prng = createPRNG(seed)

    // Select profile deterministically if not provided
    if (profile && TerrainProfile[profile]) {
      this.profile = profile
    } else {
      const roll = this.prng()
      if (roll < 0.40) this.profile = TerrainProfile.HIGHLAND
      else if (roll < 0.70) this.profile = TerrainProfile.ROLLING
      else if (roll < 0.90) this.profile = TerrainProfile.RUGGED
      else this.profile = TerrainProfile.MOUNTAIN
    }

    // Map<cubeKey, number>
    this.levels = new Map()
    this.rawHeights = new Map()
    this.levelCounts = {}
    for (let l = 0; l < LEVELS_COUNT; l++) this.levelCounts[l] = 0

    this._generate()
  }

  /**
   * Get integer elevation level (0..4) for a cell
   */
  getLevel(q, r, s) {
    return this.levels.get(cubeKey(q, r, s)) ?? 0
  }

  /**
   * Get all levels as a Map<cubeKey, number>
   */
  getAllLevels() {
    return new Map(this.levels)
  }

  get minLevel() {
    let min = LEVELS_COUNT
    for (const lvl of this.levels.values()) {
      if (lvl < min) min = lvl
    }
    return min === LEVELS_COUNT ? 0 : min
  }

  get maxLevel() {
    let max = 0
    for (const lvl of this.levels.values()) {
      if (lvl > max) max = lvl
    }
    return max
  }

  get usedLevelCount() {
    let count = 0
    for (let l = 0; l < LEVELS_COUNT; l++) {
      if (this.levelCounts[l] > 0) count++
    }
    return count
  }

  /**
   * Internal macro field generation
   */
  _generate() {
    const radius = this.radius
    const allCells = cubeCoordsInRadius(0, 0, 0, radius)
    const prng = this.prng

    // 1. Primary uplift center (near center)
    const angle1 = prng() * Math.PI * 2
    const distCenter1 = prng() * Math.min(1.5, radius * 0.3)
    const uq1 = Math.round(Math.cos(angle1) * distCenter1)
    const ur1 = Math.round(Math.sin(angle1) * distCenter1)
    const us1 = -uq1 - ur1
    const sigma1 = 1.6 + prng() * 0.8

    // 2. Secondary uplift center (optional shoulder / secondary ridge)
    const hasSecondary = prng() < 0.70
    const angle2 = angle1 + Math.PI * (0.6 + prng() * 0.8)
    const distCenter2 = 1.0 + prng() * Math.min(1.8, radius * 0.4)
    const uq2 = Math.round(Math.cos(angle2) * distCenter2)
    const ur2 = Math.round(Math.sin(angle2) * distCenter2)
    const us2 = -uq2 - ur2
    const sigma2 = 1.1 + prng() * 0.7
    const peak2 = hasSecondary ? (0.45 + prng() * 0.4) : 0

    // 3. Directional spine angle
    const spineAngle = prng() * Math.PI

    // 4. Compute raw continuous height for each cell
    let minH = Infinity
    let maxH = -Infinity

    for (const { q, r, s } of allCells) {
      const distFromCenter = cubeDistance(0, 0, 0, q, r, s)
      const distFromEdge = radius - distFromCenter

      // Perimeter falloff: outer ring is 0, ring 4 is low
      const edgeFalloff = Math.max(0, Math.min(1, (distFromEdge - 0.5) / (radius * 0.7)))
      const smoothFalloff = edgeFalloff * edgeFalloff * (3 - 2 * edgeFalloff)

      const d1 = cubeDistance(q, r, s, uq1, ur1, us1)
      const g1 = Math.exp(-(d1 * d1) / (2 * sigma1 * sigma1))

      const d2 = cubeDistance(q, r, s, uq2, ur2, us2)
      const g2 = Math.exp(-(d2 * d2) / (2 * sigma2 * sigma2))

      // Spine & gentle undulating noise
      const spineProj = Math.cos(spineAngle) * q + Math.sin(spineAngle) * r
      const ridge = Math.cos(spineProj * 0.9) * 0.2
      const noise = (Math.sin(q * 1.2 + r * 0.7 + this.seed * 0.01) +
                     Math.cos(r * 1.1 - s * 0.8)) * 0.1

      let h = (g1 + peak2 * g2 + ridge + noise) * smoothFalloff
      if (distFromEdge === 0) h = 0

      this.rawHeights.set(cubeKey(q, r, s), h)
      if (h < minH) minH = h
      if (h > maxH) maxH = h
    }

    const rangeH = (maxH - minH) > 1e-5 ? (maxH - minH) : 1

    // 5. Quantize raw height into discrete levels according to profile
    for (const { q, r, s } of allCells) {
      const key = cubeKey(q, r, s)
      const distFromCenter = cubeDistance(0, 0, 0, q, r, s)
      const h = this.rawHeights.get(key)
      const normH = Math.max(0, Math.min(1, (h - minH) / rangeH))

      let level = 0

      if (distFromCenter === radius) {
        level = 0
      } else {
        switch (this.profile) {
          case TerrainProfile.ROLLING:
            if (normH < 0.32) level = 0
            else if (normH < 0.68) level = 1
            else level = 2
            break

          case TerrainProfile.RUGGED:
            if (normH < 0.25) level = 0
            else if (normH < 0.55) level = 1
            else if (normH < 0.82) level = 2
            else level = 3
            break

          case TerrainProfile.MOUNTAIN:
            if (normH < 0.20) level = 0
            else if (normH < 0.45) level = 1
            else if (normH < 0.70) level = 2
            else if (normH < 0.88) level = 3
            else level = 4
            break

          case TerrainProfile.HIGHLAND:
          default:
            if (normH < 0.25) level = 0
            else if (normH < 0.52) level = 1
            else if (normH < 0.80) level = 2
            else level = 3
            break
        }
      }

      this.levels.set(key, level)
    }

    // 6. Post-processing: smoothing, gradient bounding, and transition signature repair
    this._repairTopography(allCells)

    // 7. Update level counts
    for (let l = 0; l < LEVELS_COUNT; l++) this.levelCounts[l] = 0
    for (const lvl of this.levels.values()) {
      this.levelCounts[lvl] = (this.levelCounts[lvl] || 0) + 1
    }
  }

  /**
   * Topographical smoothing & gradient repair:
   * - Enforces max gradient of 1 between adjacent cells
   * - Eliminates single-cell pits/spikes
   * - Ensures perimeter is strictly Level 0
   */
  _repairTopography(allCells) {
    const radius = this.radius

    // Pass 1: Perimeter strictness
    for (const { q, r, s } of allCells) {
      const distFromCenter = cubeDistance(0, 0, 0, q, r, s)
      const key = cubeKey(q, r, s)
      if (distFromCenter === radius) {
        this.levels.set(key, 0)
      } else if (distFromCenter === radius - 1) {
        // Cap near-perimeter at level 1
        const cur = this.levels.get(key)
        if (cur > 1) this.levels.set(key, 1)
      }
    }

    // Pass 2: Gradient limiting (max neighbor step <= 1)
    let changed = true
    let iterations = 0
    while (changed && iterations < 10) {
      changed = false
      iterations++
      for (const { q, r, s } of allCells) {
        const key = cubeKey(q, r, s)
        const lvl = this.levels.get(key)

        for (const dir of CUBE_DIRS) {
          const nKey = cubeKey(q + dir.dq, r + dir.dr, s + dir.ds)
          if (!this.levels.has(nKey)) continue
          const nLvl = this.levels.get(nKey)

          if (nLvl - lvl > 1) {
            this.levels.set(key, nLvl - 1)
            changed = true
          }
        }
      }
    }

    // Pass 3: Pit and isolated spike smoothing
    for (const { q, r, s } of allCells) {
      const distFromCenter = cubeDistance(0, 0, 0, q, r, s)
      if (distFromCenter === radius) continue

      const key = cubeKey(q, r, s)
      const lvl = this.levels.get(key)

      const neighborLevels = []
      for (const dir of CUBE_DIRS) {
        const nKey = cubeKey(q + dir.dq, r + dir.dr, s + dir.ds)
        if (this.levels.has(nKey)) {
          neighborLevels.push(this.levels.get(nKey))
        }
      }

      if (neighborLevels.length >= 4) {
        const allHigher = neighborLevels.every(nl => nl > lvl)
        const allLower = neighborLevels.every(nl => nl < lvl)
        if (allHigher) {
          // Fill pit
          const minNeighbor = Math.min(...neighborLevels)
          this.levels.set(key, minNeighbor)
        } else if (allLower) {
          // Lower isolated spike
          const maxNeighbor = Math.max(...neighborLevels)
          this.levels.set(key, maxNeighbor)
        }
      }
    }

    // Final check: Perimeter must remain level 0
    for (const { q, r, s } of allCells) {
      if (cubeDistance(0, 0, 0, q, r, s) === radius) {
        this.levels.set(cubeKey(q, r, s), 0)
      }
    }
  }

  /**
   * Get desired edge elevation for each direction from a cell
   * @param {number} q
   * @param {number} r
   * @param {number} s
   * @returns {Object<string, number>} e.g. { NE: 1, E: 1, SE: 1, SW: 0, W: 0, NW: 0 }
   */
  getTargetEdgeLevels(q, r, s) {
    const baseLevel = this.getLevel(q, r, s)
    const edgeLevels = {}

    for (let i = 0; i < 6; i++) {
      const dir = CUBE_DIRS[i]
      const nq = q + dir.dq
      const nr = r + dir.dr
      const ns = s + dir.ds
      const nKey = cubeKey(nq, nr, ns)

      if (this.levels.has(nKey)) {
        const nLevel = this.levels.get(nKey)
        edgeLevels[dir.name] = nLevel > baseLevel ? nLevel : baseLevel
      } else {
        edgeLevels[dir.name] = baseLevel
      }
    }

    return edgeLevels
  }

  /**
   * Generate worker-safe per-cell allowed WFC state keys with designated access ramps
   * @param {number[]} [allowedTileTypes]
   * @returns {Object<string, string[]>} cubeKey -> array of stateKey strings ("type_rot_level")
   */
  createWfcAllowedStates(allowedTileTypes = null) {
    const types = allowedTileTypes ?? TILE_LIST.map((_, i) => i)
    const allowedByCell = {}
    const allCells = cubeCoordsInRadius(0, 0, 0, this.radius)

    for (const { q, r, s } of allCells) {
      const key = cubeKey(q, r, s)
      const baseLevel = this.getLevel(q, r, s)
      const distFromCenter = cubeDistance(0, 0, 0, q, r, s)
      const isPerimeter = distFromCenter === this.radius

      const states = []

      for (const type of types) {
        const def = TILE_LIST[type]
        if (!def) continue

        // Perimeter rule: only water and coast tiles allowed at outer radius
        if (isPerimeter) {
          const isWaterOrCoast = type === TileType.WATER || def.name.startsWith('COAST_')
          if (!isWaterOrCoast) continue
          for (let rot = 0; rot < 6; rot++) {
            states.push(`${type}_${rot}_0`)
          }
          continue
        }

        // Interior elevated land (baseLevel > 0): exclude pure water and flat coast
        if (baseLevel > 0 && (type === TileType.WATER || (def.name.startsWith('COAST_') && !def.highEdges?.length))) {
          continue
        }

        const isSlope = def.highEdges && def.highEdges.length > 0
        const increment = def.levelIncrement ?? 1

        if (isSlope) {
          if (baseLevel + increment >= LEVELS_COUNT) continue
          for (let rot = 0; rot < 6; rot++) {
            states.push(`${type}_${rot}_${baseLevel}`)
          }
        } else {
          for (let rot = 0; rot < 6; rot++) {
            states.push(`${type}_${rot}_${baseLevel}`)
          }
        }
      }

      allowedByCell[key] = states
    }

    // Designate 1-2 ramp cells for each level transition L -> L+1 to guarantee walkable routes
    for (let L = 0; L < LEVELS_COUNT - 1; L++) {
      const candidates = []
      for (const { q, r, s } of allCells) {
        if (this.getLevel(q, r, s) !== L) continue
        if (cubeDistance(0, 0, 0, q, r, s) === this.radius) continue

        for (const dir of CUBE_DIRS) {
          const nKey = cubeKey(q + dir.dq, r + dir.dr, s + dir.ds)
          if (this.levels.get(nKey) === L + 1) {
            candidates.push({ q, r, s, dir: dir.name })
            break
          }
        }
      }

      if (candidates.length > 0) {
        // Pick 1-2 ramp positions deterministically
        const pickIdx1 = Math.floor(candidates.length / 2)
        const rampPicks = [candidates[pickIdx1]]
        if (candidates.length >= 4) {
          const pickIdx2 = Math.floor(candidates.length / 4)
          if (pickIdx2 !== pickIdx1) rampPicks.push(candidates[pickIdx2])
        }

        for (const ramp of rampPicks) {
          const dirIdx = HexDir.indexOf(ramp.dir)
          const rot = (dirIdx - 1 + 6) % 6
          const key = cubeKey(ramp.q, ramp.r, ramp.s)

          // Restrict candidate to slope ramps oriented toward higher ground
          allowedByCell[key] = [
            `${TileType.GRASS_SLOPE_LOW}_${rot}_${L}`,
            `${TileType.ROAD_A_SLOPE_LOW}_${rot}_${L}`,
          ]
        }
      }
    }

    return allowedByCell
  }
}

/**
 * Convenience factory function
 */
export function generateElevationField(options) {
  return new ElevationField(options)
}
