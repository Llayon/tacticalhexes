/**
 * TerrainAnalysis - Pure JavaScript diagnostic and analysis helper for macro terrain fields and islands.
 * Decoupled from Three.js, DOM, and Telegram.
 */

import {
  CUBE_DIRS,
  cubeCoordsInRadius,
  cubeDistance,
  cubeKey,
  cubeToOffset,
} from '../../hexmap/HexWFCCore.js'
import { LEVELS_COUNT } from '../../hexmap/HexTileData.js'
import { NavigationGrid } from '../../navigation/NavigationGrid.js'

export class TerrainAnalysis {
  /**
   * Analyze an ElevationField or an IslandData instance.
   * @param {import('./ElevationField.js').ElevationField | import('../IslandData.js').IslandData} source
   * @param {Object} [options]
   * @param {number} [options.radius=5]
   * @returns {Object} Comprehensive terrain metrics and region data
   */
  static analyze(source, { radius = 5 } = {}) {
    const isIslandData = typeof source.getCell === 'function' && typeof source.getAllCells === 'function'
    const actualRadius = source.radius || radius

    // 1. Collect all cell coordinates and levels
    const cellMap = new Map() // key -> { q, r, s, level, cell }
    const allCoords = cubeCoordsInRadius(0, 0, 0, actualRadius)

    for (const { q, r, s } of allCoords) {
      const key = cubeKey(q, r, s)
      let level = 0
      let cellObj = null

      if (isIslandData) {
        cellObj = source.getCell(q, r, s)
        level = cellObj?.level ?? 0
      } else if (typeof source.getLevel === 'function') {
        level = source.getLevel(q, r, s)
      }

      cellMap.set(key, { q, r, s, level, cell: cellObj, key })
    }

    // 2. Region Segmentation (same-level contiguous components)
    const visited = new Set()
    const regions = []
    let regionIdCounter = 0

    for (const [key, info] of cellMap.entries()) {
      if (visited.has(key)) continue

      const region = {
        id: ++regionIdCounter,
        level: info.level,
        size: 0,
        cells: [],
        center: { q: 0, r: 0, s: 0 },
      }

      const queue = [info]
      visited.add(key)

      let sumQ = 0
      let sumR = 0
      let sumS = 0

      while (queue.length > 0) {
        const curr = queue.shift()
        region.cells.push(curr)
        region.size++
        sumQ += curr.q
        sumR += curr.r
        sumS += curr.s

        for (const dir of CUBE_DIRS) {
          const nq = curr.q + dir.dq
          const nr = curr.r + dir.dr
          const ns = curr.s + dir.ds
          const nKey = cubeKey(nq, nr, ns)

          if (cellMap.has(nKey) && !visited.has(nKey)) {
            const neighborInfo = cellMap.get(nKey)
            if (neighborInfo.level === curr.level) {
              visited.add(nKey)
              queue.push(neighborInfo)
            }
          }
        }
      }

      region.center = {
        q: sumQ / region.size,
        r: sumR / region.size,
        s: sumS / region.size,
      }

      regions.push(region)
    }

    // Sort regions by level descending, then size descending
    regions.sort((a, b) => b.level - a.level || b.size - a.size)

    const elevatedRegions = regions.filter(r => r.level >= 1)
    const dominantPlateau = elevatedRegions.reduce((max, r) => (!max || r.size > max.size ? r : max), null)
    const largestPlateauSize = dominantPlateau?.size ?? 0
    const plateauCount = elevatedRegions.filter(r => r.size >= 2).length

    // 3. Isolated spikes / pits detection
    let isolatedSpikeCount = 0
    let isolatedPitCount = 0

    for (const [key, info] of cellMap.entries()) {
      const dist = cubeDistance(0, 0, 0, info.q, info.r, info.s)
      if (dist === actualRadius) continue // skip perimeter

      const neighborLevels = []
      for (const dir of CUBE_DIRS) {
        const nq = info.q + dir.dq
        const nr = info.r + dir.dr
        const ns = info.s + dir.ds
        const nKey = cubeKey(nq, nr, ns)
        if (cellMap.has(nKey)) {
          neighborLevels.push(cellMap.get(nKey).level)
        }
      }

      if (neighborLevels.length >= 3) {
        if (info.level > 0 && neighborLevels.every(l => l < info.level)) {
          isolatedSpikeCount++
        }
        if (neighborLevels.every(l => l > info.level)) {
          isolatedPitCount++
        }
      }
    }

    // 4. Cliff and Slope Edge Counting
    let cliffEdgeCount = 0
    let slopeAccessCount = 0
    const countedEdges = new Set()

    for (const [key, info] of cellMap.entries()) {
      const isSlopeCell = info.cell?.isSlope ?? false
      if (isSlopeCell) slopeAccessCount++

      for (const dir of CUBE_DIRS) {
        const nq = info.q + dir.dq
        const nr = info.r + dir.dr
        const ns = info.s + dir.ds
        const nKey = cubeKey(nq, nr, ns)

        if (!cellMap.has(nKey)) continue
        const nInfo = cellMap.get(nKey)

        const edgeKey = key < nKey ? `${key}->${nKey}` : `${nKey}->${key}`
        if (countedEdges.has(edgeKey)) continue
        countedEdges.add(edgeKey)

        if (info.level !== nInfo.level) {
          // If neither cell is a slope bridging the levels, this is a cliff face
          const bridgesLevels = (isSlopeCell || (nInfo.cell?.isSlope ?? false))
          if (!bridgesLevels) {
            cliffEdgeCount++
          }
        }
      }
    }

    // 5. Level counts
    const levelCounts = {}
    for (let l = 0; l < LEVELS_COUNT; l++) levelCounts[l] = 0
    for (const info of cellMap.values()) {
      levelCounts[info.level] = (levelCounts[info.level] || 0) + 1
    }
    const distinctLevels = Object.values(levelCounts).filter(c => c > 0).length

    // 6. Asymmetry calculation (Center of mass displacement from origin)
    let totalMass = 0
    let massX = 0
    let massZ = 0

    for (const info of cellMap.values()) {
      if (info.level > 0) {
        const offset = cubeToOffset(info.q, info.r, info.s)
        const weight = info.level
        totalMass += weight
        massX += offset.col * weight
        massZ += offset.row * weight
      }
    }

    let asymmetryScore = 0
    if (totalMass > 0) {
      const comX = massX / totalMass
      const comZ = massZ / totalMass
      const comDist = Math.sqrt(comX * comX + comZ * comZ)
      asymmetryScore = Math.min(1.0, comDist / (actualRadius * 0.8))
    }

    // 7. Radial pyramid correlation
    // Correlation between distance from center and elevation (negative slope = higher at center)
    let sumD = 0
    let sumL = 0
    let sumDD = 0
    let sumLL = 0
    let sumDL = 0
    const n = cellMap.size

    for (const info of cellMap.values()) {
      const dist = cubeDistance(0, 0, 0, info.q, info.r, info.s)
      const lvl = info.level
      sumD += dist
      sumL += lvl
      sumDD += dist * dist
      sumLL += lvl * lvl
      sumDL += dist * lvl
    }

    const varD = n * sumDD - sumD * sumD
    const varL = n * sumLL - sumL * sumL
    let radialCorrelation = 0
    if (varD > 1e-5 && varL > 1e-5) {
      // Invert sign so positive means higher at center (pyramidal)
      radialCorrelation = -(n * sumDL - sumD * sumL) / Math.sqrt(varD * varL)
    }

    // 8. Reachability & Navigation (if IslandData provided)
    let reachableElevatedCount = 0
    let reachableElevatedRatio = 1.0

    if (isIslandData) {
      const navGrid = new NavigationGrid(source)
      const walkable = source.getWalkableCells()
      const visitedWalkable = new Set()
      const components = []

      for (const cell of walkable) {
        if (visitedWalkable.has(cell.key)) continue
        const comp = []
        const queue = [cell]
        visitedWalkable.add(cell.key)

        while (queue.length > 0) {
          const curr = queue.shift()
          comp.push(curr)
          for (const neighbor of navGrid.getNeighbors(curr)) {
            if (!visitedWalkable.has(neighbor.key)) {
              visitedWalkable.add(neighbor.key)
              queue.push(neighbor)
            }
          }
        }
        components.push(comp)
      }

      components.sort((a, b) => b.length - a.length)
      // Pick largest landmass component (prefer component with elevated/land tiles over pure water perimeter)
      const mainLandComp = components.find(comp => comp.some(c => (c.level || 0) > 0 || !c.isWater)) || components[0] || []
      const mainCompKeys = new Set(mainLandComp.map(c => c.key))

      const totalElevatedWalkable = walkable.filter(c => (c.level || 0) >= 1)
      const reachableElevated = totalElevatedWalkable.filter(c => mainCompKeys.has(c.key))

      reachableElevatedCount = reachableElevated.length
      reachableElevatedRatio = totalElevatedWalkable.length > 0
        ? reachableElevated.length / totalElevatedWalkable.length
        : 1.0

      // Tag reachability on regions
      for (const region of regions) {
        region.reachable = region.cells.some(c => mainCompKeys.has(c.key))
      }
    }

    // 9. Overall Quality Score
    // Balances large plateau size, dramatic cliffs, asymmetry, and penalizes isolated spikes / pyramids
    let qualityScore = 0
    qualityScore += largestPlateauSize * 2.5
    qualityScore += (reachableElevatedRatio * 20.0)
    qualityScore += (cliffEdgeCount * 0.6)
    qualityScore += (asymmetryScore * 25.0)
    qualityScore += (distinctLevels * 6.0)

    // Penalties
    qualityScore -= (isolatedSpikeCount * 15.0)
    qualityScore -= (isolatedPitCount * 10.0)
    if (radialCorrelation > 0.65) {
      qualityScore -= (radialCorrelation - 0.65) * 50.0
    }
    if (slopeAccessCount > 6) {
      qualityScore -= (slopeAccessCount - 6) * 4.0
    }
    if (largestPlateauSize < 4 && distinctLevels >= 2) {
      qualityScore -= 20.0 // heavily penalize micro-fragmented highlands
    }

    return {
      regions,
      elevatedRegions,
      dominantPlateau,
      largestPlateauSize,
      plateauCount,
      isolatedSpikeCount,
      isolatedPitCount,
      cliffEdgeCount,
      slopeAccessCount,
      levelCounts,
      distinctLevels,
      asymmetryScore: Number(asymmetryScore.toFixed(3)),
      radialPyramidCorrelation: Number(radialCorrelation.toFixed(3)),
      reachableElevatedCount,
      reachableElevatedRatio: Number(reachableElevatedRatio.toFixed(3)),
      qualityScore: Number(qualityScore.toFixed(1)),
    }
  }
}
