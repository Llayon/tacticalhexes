/**
 * ElevationField - Deterministic macro elevation field generator for hex islands.
 * Produces coherent macro plateaus, dramatic vertical cliffs, and controlled access ramps
 * inspired by compact tactical diorama design (Bad North visual principles).
 *
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
import { TerrainArchetype, ARCHETYPE_LIST } from './TerrainArchetype.js'
import { TerrainAnalysis } from './TerrainAnalysis.js'

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
  constructor({ seed = 0, radius = 5, profile = null, archetype = null } = {}) {
    this.seed = seed
    this.radius = radius
    this.prng = createPRNG(seed)

    // Select profile deterministically if not provided
    if (profile && TerrainProfile[profile]) {
      this.profile = profile
    } else {
      const roll = this.prng()
      if (roll < 0.45) this.profile = TerrainProfile.HIGHLAND
      else if (roll < 0.70) this.profile = TerrainProfile.ROLLING
      else if (roll < 0.90) this.profile = TerrainProfile.RUGGED
      else this.profile = TerrainProfile.MOUNTAIN
    }

    // Select archetype deterministically if not provided
    if (archetype && TerrainArchetype[archetype]) {
      this.archetype = archetype
    } else {
      const archRoll = this.prng()
      if (archRoll < 0.25) this.archetype = TerrainArchetype.HIGH_CORNER
      else if (archRoll < 0.45) this.archetype = TerrainArchetype.FORTRESS
      else if (archRoll < 0.65) this.archetype = TerrainArchetype.TWIN_PLATEAUS
      else if (archRoll < 0.82) this.archetype = TerrainArchetype.RIDGE
      else if (archRoll < 0.92) this.archetype = TerrainArchetype.TERRACES
      else this.archetype = TerrainArchetype.BASIN
    }

    // Target max elevation for current profile
    this.targetMaxLevel = this.profile === TerrainProfile.ROLLING ? 2
      : this.profile === TerrainProfile.MOUNTAIN ? 4
      : 3

    // Map<cubeKey, number>
    this.levels = new Map()
    this.rawHeights = new Map()
    this.levelCounts = {}
    for (let l = 0; l < LEVELS_COUNT; l++) this.levelCounts[l] = 0

    this.designatedRamps = [] // Array<{ lowKey, highKey, levelLow, levelHigh, rot, slopeType }>
    this.analysis = null

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

  getAnalysis() {
    if (!this.analysis) {
      this.analysis = TerrainAnalysis.analyze(this, { radius: this.radius })
    }
    return this.analysis
  }

  /**
   * Internal macro field generation based on Region Anchors & Archetypes
   */
  _generate() {
    const radius = this.radius
    const allCells = cubeCoordsInRadius(0, 0, 0, radius)
    const prng = this.prng
    const maxLvl = this.targetMaxLevel

    // 1. Build Region Anchors for chosen archetype
    const anchors = this._buildArchetypeAnchors(prng, radius, maxLvl)

    // 2. Sample continuous elevation with macro regional influence and organic distortion
    for (const { q, r, s } of allCells) {
      const distFromCenter = cubeDistance(0, 0, 0, q, r, s)
      const key = cubeKey(q, r, s)

      // Strict perimeter rule: outer rings are Level 0
      if (distFromCenter >= radius - 1) {
        this.rawHeights.set(key, 0)
        this.levels.set(key, 0)
        continue
      }

      // Broad organic boundary distortion (low-frequency seeded sinusoid)
      const distort = (Math.sin(q * 0.85 + r * 0.55 + this.seed * 0.05) +
                       Math.cos(r * 0.75 - s * 0.65 + this.seed * 0.03)) * 0.35

      // Evaluate influence from all regional anchors
      let totalWeight = 0
      let weightedLevel = 0
      let maxAnchorInfluence = -Infinity
      let dominantAnchorLevel = 0

      for (const anchor of anchors) {
        const d = cubeDistance(q, r, s, anchor.q, anchor.r, anchor.s) + distort * anchor.noiseWeight
        // Sharp sigmoid falloff for clean plateau surfaces
        const effDist = Math.max(0, d - anchor.coreRadius)
        const influence = Math.exp(-(effDist * effDist) / (2 * anchor.spread * anchor.spread))

        totalWeight += influence
        weightedLevel += influence * anchor.level

        if (influence > maxAnchorInfluence) {
          maxAnchorInfluence = influence
          dominantAnchorLevel = anchor.level
        }
      }

      // Blend plateau core with smooth falloff
      const rawHeight = totalWeight > 0.001 ? (weightedLevel / totalWeight) : 0
      // Plateau snap: strongly bias towards dominant integer level
      const snappedHeight = (rawHeight * 0.35) + (dominantAnchorLevel * 0.65)

      this.rawHeights.set(key, snappedHeight)
    }

    // 3. Discrete Plateau Quantization
    for (const { q, r, s } of allCells) {
      const key = cubeKey(q, r, s)
      const distFromCenter = cubeDistance(0, 0, 0, q, r, s)

      if (distFromCenter >= radius - 1) {
        this.levels.set(key, 0)
        continue
      }

      const h = this.rawHeights.get(key)
      let lvl = 0

      if (maxLvl === 2) {
        if (h > 1.25) lvl = 2
        else if (h > 0.45) lvl = 1
        else lvl = 0
      } else if (maxLvl === 4) {
        if (h > 3.1) lvl = 4
        else if (h > 2.1) lvl = 3
        else if (h > 1.1) lvl = 2
        else if (h > 0.4) lvl = 1
        else lvl = 0
      } else { // maxLvl === 3
        if (h > 2.05) lvl = 3
        else if (h > 1.05) lvl = 2
        else if (h > 0.40) lvl = 1
        else lvl = 0
      }

      this.levels.set(key, lvl)
    }

    // 4. Macro Repair & Plateau Coherence Pass
    this._repairMacroTopography(allCells)

    // 5. Update level counts & analysis
    for (let l = 0; l < LEVELS_COUNT; l++) this.levelCounts[l] = 0
    for (const lvl of this.levels.values()) {
      this.levelCounts[lvl] = (this.levelCounts[lvl] || 0) + 1
    }

    this.analysis = TerrainAnalysis.analyze(this, { radius: this.radius })
  }

  /**
   * Build regional anchor points based on deterministic Archetype
   */
  _buildArchetypeAnchors(prng, radius, maxLvl) {
    const anchors = []

    switch (this.archetype) {
      case TerrainArchetype.HIGH_CORNER: {
        // High dominant plateau strongly biased toward one corner/flank
        const angle = prng() * Math.PI * 2
        const cornerDist = 1.4 + prng() * 0.7
        const cq = Math.round(Math.cos(angle) * cornerDist)
        const cr = Math.round(Math.sin(angle) * cornerDist)
        const cs = -cq - cr

        anchors.push({
          q: cq, r: cr, s: cs,
          level: maxLvl,
          coreRadius: 1.6 + prng() * 0.5,
          spread: 1.1,
          noiseWeight: 0.7,
        })

        // Secondary intermediate shoulder extending towards center/side
        const shoulderAngle = angle + (prng() < 0.5 ? 0.9 : -0.9)
        const sq = Math.round(Math.cos(shoulderAngle) * 1.2)
        const sr = Math.round(Math.sin(shoulderAngle) * 1.2)
        const ss = -sq - sr

        anchors.push({
          q: sq, r: sr, s: ss,
          level: Math.max(1, maxLvl - 1),
          coreRadius: 1.1,
          spread: 1.0,
          noiseWeight: 0.5,
        })

        // Broad lowland on opposite side
        const oppAngle = angle + Math.PI
        const lq = Math.round(Math.cos(oppAngle) * 1.8)
        const lr = Math.round(Math.sin(oppAngle) * 1.8)
        const ls = -lq - lr
        anchors.push({
          q: lq, r: lr, s: ls,
          level: 0,
          coreRadius: 1.8,
          spread: 1.4,
          noiseWeight: 0.3,
        })
        break
      }

      case TerrainArchetype.FORTRESS: {
        // Massive central/offset stronghold plateau surrounded by sheer drops
        const offsetAngle = prng() * Math.PI * 2
        const offsetDist = 0.3 + prng() * 0.6
        const fq = Math.round(Math.cos(offsetAngle) * offsetDist)
        const fr = Math.round(Math.sin(offsetAngle) * offsetDist)
        const fs = -fq - fr

        anchors.push({
          q: fq, r: fr, s: fs,
          level: maxLvl,
          coreRadius: 1.8 + prng() * 0.4,
          spread: 0.9,
          noiseWeight: 0.6,
        })

        // Lowland buffer
        const bufferAngle = offsetAngle + Math.PI
        const bq = Math.round(Math.cos(bufferAngle) * 2.0)
        const br = Math.round(Math.sin(bufferAngle) * 2.0)
        anchors.push({
          q: bq, r: br, s: -bq - br,
          level: 0,
          coreRadius: 1.5,
          spread: 1.2,
          noiseWeight: 0.5,
        })
        break
      }

      case TerrainArchetype.TWIN_PLATEAUS: {
        // Two distinct elevated masses separated by a low saddle/valley
        const axisAngle = prng() * Math.PI
        const dist1 = 1.4 + prng() * 0.5
        const p1q = Math.round(Math.cos(axisAngle) * dist1)
        const p1r = Math.round(Math.sin(axisAngle) * dist1)

        anchors.push({
          q: p1q, r: p1r, s: -p1q - p1r,
          level: maxLvl,
          coreRadius: 1.3 + prng() * 0.3,
          spread: 0.9,
          noiseWeight: 0.5,
        })

        const dist2 = 1.4 + prng() * 0.5
        const p2q = Math.round(Math.cos(axisAngle + Math.PI) * dist2)
        const p2r = Math.round(Math.sin(axisAngle + Math.PI) * dist2)

        anchors.push({
          q: p2q, r: p2r, s: -p2q - p2r,
          level: Math.max(1, maxLvl - 1),
          coreRadius: 1.2 + prng() * 0.3,
          spread: 0.9,
          noiseWeight: 0.5,
        })

        // Saddle center at level 0
        anchors.push({
          q: 0, r: 0, s: 0,
          level: 0,
          coreRadius: 0.9,
          spread: 1.0,
          noiseWeight: 0.4,
        })
        break
      }

      case TerrainArchetype.RIDGE: {
        // Elongated elevated spine crossing the island
        const spineAngle = prng() * Math.PI
        const spineOffset = (prng() - 0.5) * 1.2
        const orthAngle = spineAngle + Math.PI / 2

        const sq1 = Math.round(Math.cos(spineAngle) * 1.5 + Math.cos(orthAngle) * spineOffset)
        const sr1 = Math.round(Math.sin(spineAngle) * 1.5 + Math.sin(orthAngle) * spineOffset)
        const sq2 = Math.round(Math.cos(spineAngle + Math.PI) * 1.5 + Math.cos(orthAngle) * spineOffset)
        const sr2 = Math.round(Math.sin(spineAngle + Math.PI) * 1.5 + Math.sin(orthAngle) * spineOffset)

        anchors.push({
          q: sq1, r: sr1, s: -sq1 - sr1,
          level: maxLvl,
          coreRadius: 1.3,
          spread: 1.0,
          noiseWeight: 0.6,
        })
        anchors.push({
          q: sq2, r: sr2, s: -sq2 - sr2,
          level: maxLvl,
          coreRadius: 1.3,
          spread: 1.0,
          noiseWeight: 0.6,
        })
        anchors.push({
          q: Math.round(Math.cos(orthAngle) * spineOffset),
          r: Math.round(Math.sin(orthAngle) * spineOffset),
          s: -Math.round(Math.cos(orthAngle) * spineOffset) - Math.round(Math.sin(orthAngle) * spineOffset),
          level: maxLvl,
          coreRadius: 1.4,
          spread: 0.9,
          noiseWeight: 0.6,
        })
        break
      }

      case TerrainArchetype.TERRACES: {
        // Broad multi-tier stepped terraces
        const terraceAngle = prng() * Math.PI * 2
        const t1q = Math.round(Math.cos(terraceAngle) * 1.6)
        const t1r = Math.round(Math.sin(terraceAngle) * 1.6)

        anchors.push({
          q: t1q, r: t1r, s: -t1q - t1r,
          level: maxLvl,
          coreRadius: 1.5,
          spread: 1.0,
          noiseWeight: 0.5,
        })
        anchors.push({
          q: 0, r: 0, s: 0,
          level: Math.max(1, maxLvl - 1),
          coreRadius: 1.5,
          spread: 1.2,
          noiseWeight: 0.5,
        })
        anchors.push({
          q: -t1q, r: -t1r, s: t1q + t1r,
          level: 0,
          coreRadius: 1.5,
          spread: 1.2,
          noiseWeight: 0.5,
        })
        break
      }

      case TerrainArchetype.BASIN:
      default: {
        // Crescent / horseshoe wrapping around open bay
        const crescentAngle = prng() * Math.PI * 2
        for (let i = -1; i <= 1; i++) {
          const a = crescentAngle + i * 1.0
          const bq = Math.round(Math.cos(a) * 1.8)
          const br = Math.round(Math.sin(a) * 1.8)
          anchors.push({
            q: bq, r: br, s: -bq - br,
            level: maxLvl,
            coreRadius: 1.2,
            spread: 0.9,
            noiseWeight: 0.5,
          })
        }
        // Center bay
        anchors.push({
          q: 0, r: 0, s: 0,
          level: 0,
          coreRadius: 1.3,
          spread: 1.1,
          noiseWeight: 0.4,
        })
        break
      }
    }

    return anchors
  }

  /**
   * Coherence and macro repair:
   * - Eliminates single-cell spikes / pits
   * - Reduces narrow 1-cell staircases
   * - Guarantees strict Level 0 perimeter and coastline
   */
  _repairMacroTopography(allCells) {
    const radius = this.radius

    // Pass 1: Strict Perimeter and coastline ring clamp
    for (const { q, r, s } of allCells) {
      const distFromCenter = cubeDistance(0, 0, 0, q, r, s)
      const key = cubeKey(q, r, s)
      if (distFromCenter >= radius - 1) {
        this.levels.set(key, 0)
      }
    }

    // Pass 2: Single-cell isolated spike and pit elimination
    for (let pass = 0; pass < 2; pass++) {
      for (const { q, r, s } of allCells) {
        const distFromCenter = cubeDistance(0, 0, 0, q, r, s)
        if (distFromCenter >= radius - 1) continue

        const key = cubeKey(q, r, s)
        const lvl = this.levels.get(key)

        const neighborLevels = []
        for (const dir of CUBE_DIRS) {
          const nq = q + dir.dq
          const nr = r + dir.dr
          const ns = s + dir.ds
          const nKey = cubeKey(nq, nr, ns)
          if (this.levels.has(nKey)) {
            neighborLevels.push(this.levels.get(nKey))
          }
        }

        if (neighborLevels.length >= 4) {
          const allLower = neighborLevels.every(nl => nl < lvl)
          const allHigher = neighborLevels.every(nl => nl > lvl)

          if (allLower) {
            // Lower isolated spike to max neighbor level
            this.levels.set(key, Math.max(...neighborLevels))
          } else if (allHigher) {
            // Fill pit
            this.levels.set(key, Math.min(...neighborLevels))
          }
        }
      }
    }

    // Pass 3: Maximum gradient enforcement (max step <= 2 between adjacent hexes)
    // Adjacent hexes can have a cliff step of 1 or 2 (which match slope mesh heights).
    // Steps >= 3 are smoothed down to step <= 2.
    let changed = true
    let iters = 0
    while (changed && iters < 12) {
      changed = false
      iters++
      // Keep perimeter ring clamped to 0
      for (const { q, r, s } of allCells) {
        if (cubeDistance(0, 0, 0, q, r, s) >= radius - 1) {
          this.levels.set(cubeKey(q, r, s), 0)
        }
      }
      for (const { q, r, s } of allCells) {
        const key = cubeKey(q, r, s)
        const lvl = this.levels.get(key)

        for (const dir of CUBE_DIRS) {
          const nKey = cubeKey(q + dir.dq, r + dir.dr, s + dir.ds)
          if (!this.levels.has(nKey)) continue
          const nLvl = this.levels.get(nKey)

          if (lvl - nLvl > 2) {
            this.levels.set(key, nLvl + 2)
            changed = true
          }
        }
      }
    }

    // Pass 4: Final perimeter clamp
    for (const { q, r, s } of allCells) {
      if (cubeDistance(0, 0, 0, q, r, s) >= radius - 1) {
        this.levels.set(cubeKey(q, r, s), 0)
      }
    }
  }

  /**
   * Get desired edge elevation for each direction from a cell
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
   * Generate worker-safe per-cell allowed WFC state keys.
   *
   * KEY ARCHITECTURAL PRINCIPLE:
   * - Large plateau interiors: strictly allowed flat terrain at the plateau's base level.
   * - Plateau perimeters: sheer vertical cliffs (flat tiles of different levels with bottom-fill meshes).
   * - Controlled ramps: designated slope access points per level boundary to ensure tactical access.
   *
   * @param {number[]} [allowedTileTypes]
   * @returns {Object<string, string[]>} cubeKey -> array of stateKey strings ("type_rot_level")
   */
  createWfcAllowedStates(allowedTileTypes = null) {
    const types = allowedTileTypes ?? TILE_LIST.map((_, i) => i)
    const allowedByCell = {}
    const allCells = cubeCoordsInRadius(0, 0, 0, this.radius)

    // 1. Collect all boundary step transitions
    const boundaryPairs = [] // Array<{ low: {q,r,s}, high: {q,r,s}, dir: string, diff: number }>
    for (const { q, r, s } of allCells) {
      const dist = cubeDistance(0, 0, 0, q, r, s)
      if (dist >= this.radius - 1) continue
      const lvl = this.getLevel(q, r, s)

      for (const dir of CUBE_DIRS) {
        const nq = q + dir.dq
        const nr = r + dir.dr
        const ns = s + dir.ds
        const nDist = cubeDistance(0, 0, 0, nq, nr, ns)
        if (nDist > this.radius) continue
        const nLvl = this.getLevel(nq, nr, ns)

        if (nLvl > lvl) {
          boundaryPairs.push({
            low: { q, r, s },
            high: { q: nq, r: nr, s: ns },
            dir: dir.name,
            diff: nLvl - lvl,
            lvlLow: lvl,
            lvlHigh: nLvl,
          })
        }
      }
    }

    // 2. Select well-separated designated access ramps per distinct level step
    const designatedRampMap = new Map() // cubeKey -> Array<{ rot, type, level }>
    this.designatedRamps = []

    // Group boundary pairs by transition (e.g. "0->1", "1->2", "0->2", etc.)
    const transitions = new Map()
    for (const bp of boundaryPairs) {
      const tKey = `${bp.lvlLow}->${bp.lvlHigh}`
      if (!transitions.has(tKey)) transitions.set(tKey, [])
      transitions.get(tKey).push(bp)
    }

    const chosenRampPositions = []

    for (const [tKey, pairs] of transitions.entries()) {
      if (pairs.length === 0) continue

      // Determine ramp count based on boundary size (1 for small, 2 for medium, max 3 for large)
      const rampCount = pairs.length <= 3 ? 1 : (pairs.length <= 7 ? 2 : 3)
      const step = Math.max(1, Math.floor(pairs.length / (rampCount + 1)))

      for (let i = 0; i < pairs.length && designatedRampMap.size < 6; i++) {
        const pickIdx = (step * (i + 1)) % pairs.length
        const bp = pairs[pickIdx]
        const lowKey = cubeKey(bp.low.q, bp.low.r, bp.low.s)

        // Ensure ramps are not immediately adjacent to prevent slope-edge collisions
        const tooClose = chosenRampPositions.some(pos => cubeDistance(bp.low.q, bp.low.r, bp.low.s, pos.q, pos.r, pos.s) < 2)
        if (tooClose && i < pairs.length - 1) continue

        const dirIdx = HexDir.indexOf(bp.dir)
        const rot = (dirIdx - 1 + 6) % 6

        // Determine slope type based on height step
        const isTwoStep = bp.diff >= 2
        const slopeType = isTwoStep ? TileType.GRASS_SLOPE_HIGH : TileType.GRASS_SLOPE_LOW
        const roadSlopeType = isTwoStep ? TileType.ROAD_A_SLOPE_HIGH : TileType.ROAD_A_SLOPE_LOW

        if (!designatedRampMap.has(lowKey)) {
          designatedRampMap.set(lowKey, [])
          chosenRampPositions.push({ q: bp.low.q, r: bp.low.r, s: bp.low.s })
        }

        designatedRampMap.get(lowKey).push({
          rot,
          slopeType,
          roadSlopeType,
          level: bp.lvlLow,
        })

        this.designatedRamps.push({
          lowKey,
          highKey: cubeKey(bp.high.q, bp.high.r, bp.high.s),
          levelLow: bp.lvlLow,
          levelHigh: bp.lvlHigh,
          rot,
          slopeType,
        })

        if (designatedRampMap.get(lowKey).length >= 1 && chosenRampPositions.length >= rampCount) {
          break
        }
      }
    }

    // 3. Build per-cell allowed state sets
    for (const { q, r, s } of allCells) {
      const key = cubeKey(q, r, s)
      const baseLevel = this.getLevel(q, r, s)
      const distFromCenter = cubeDistance(0, 0, 0, q, r, s)
      const isPerimeter = distFromCenter === this.radius

      const states = []

      // If cell is a designated ramp, strictly provide designated slope ramp states
      const ramps = designatedRampMap.get(key)
      if (ramps && ramps.length > 0) {
        for (const ramp of ramps) {
          states.push(`${ramp.slopeType}_${ramp.rot}_${ramp.level}`)
          states.push(`${ramp.roadSlopeType}_${ramp.rot}_${ramp.level}`)
        }
        allowedByCell[key] = Array.from(new Set(states))
        continue
      }

      // Level 0 cells (perimeter water + beaches): allow coast, water, and flat ground
      if (baseLevel === 0) {
        for (const type of types) {
          const def = TILE_LIST[type]
          if (!def) continue

          if (isPerimeter) {
            const isWaterOrCoast = type === TileType.WATER || def.name.startsWith('COAST_')
            if (!isWaterOrCoast) continue
          }

          const isSlope = def.highEdges && def.highEdges.length > 0
          if (isSlope) continue

          for (let rot = 0; rot < 6; rot++) {
            states.push(`${type}_${rot}_0`)
          }
        }
        allowedByCell[key] = Array.from(new Set(states))
        continue
      }

      // Interior elevated land (Level >= 1)
      for (const type of types) {
        const def = TILE_LIST[type]
        if (!def) continue

        // Exclude pure water and flat water coasts on elevated land
        if (type === TileType.WATER || (def.name.startsWith('COAST_') && !def.highEdges?.length)) {
          continue
        }

        const isSlope = def.highEdges && def.highEdges.length > 0
        // Strict Plateau Rule: DO NOT allow slope tiles in plateau interior
        if (isSlope) continue

        // Flat tile at base level
        for (let rot = 0; rot < 6; rot++) {
          states.push(`${type}_${rot}_${baseLevel}`)
        }
      }

      allowedByCell[key] = Array.from(new Set(states))
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
