/**
 * Deterministic spawn cell selector for squads on procedural hex islands.
 * Pure domain logic - zero Three.js / DOM dependencies.
 */

import { cubeDistance } from '../hexmap/HexWFCCore.js'

/**
 * Deterministically find a central, accessible, walkable spawn cell on an island
 * @param {import('../world/IslandData.js').IslandData} islandData
 * @param {import('../navigation/NavigationGrid.js').NavigationGrid} navGrid
 * @returns {import('../world/IslandData.js').HexCell|null}
 */
export function findDeterministicSpawnCell(islandData, navGrid) {
  if (!islandData || !navGrid) return null

  const center = { q: 0, r: 0, s: 0 }
  const allCells = islandData.getAllCells()

  // Filter walkable cells that belong to the navigation grid
  const walkableCells = allCells.filter(cell => navGrid.isWalkable(cell))
  if (walkableCells.length === 0) return null

  // Score cells:
  // 1. Distance from center (q:0, r:0, s:0) - lower is better
  // 2. Number of walkable neighbors - higher is better (avoids isolated choke points / corners)
  // 3. Flat land preferred over slopes
  // 4. Stable tie-break by coordinate key for strict determinism
  const scored = walkableCells.map(cell => {
    const dist = cubeDistance(cell.q, cell.r, cell.s, center.q, center.r, center.s)
    const neighbors = navGrid.getNeighbors(cell)
    const neighborCount = neighbors.length
    const isFlat = !cell.isSlope && !cell.isCliff

    return {
      cell,
      dist,
      neighborCount,
      isFlat,
      key: cell.key,
    }
  })

  // Filter for cells with adequate connectivity if available
  let candidates = scored.filter(s => s.neighborCount >= 3)
  if (candidates.length === 0) {
    candidates = scored.filter(s => s.neighborCount >= 2)
  }
  if (candidates.length === 0) {
    candidates = scored
  }

  // Sort deterministically:
  // Priority: lowest center distance -> highest neighbor count -> flat preferred -> lexicographical key
  candidates.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist
    if (b.isFlat !== a.isFlat) return (b.isFlat ? 1 : 0) - (a.isFlat ? 1 : 0)
    if (b.neighborCount !== a.neighborCount) return b.neighborCount - a.neighborCount
    return a.key.localeCompare(b.key)
  })

  return candidates[0]?.cell || null
}
