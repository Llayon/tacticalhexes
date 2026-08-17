/**
 * TerrainRules - Centralized rules for terrain walkability, elevation transitions, and movement costs.
 * Decoupled from Three.js and rendering instances.
 */

import { HexOpposite } from '../hexmap/HexTileData.js'
import { CUBE_DIRS, getEdgeLevel } from '../hexmap/HexWFCCore.js'

/**
 * Standard movement costs for tactical traversal
 */
export const TerrainCost = {
  ROAD: 0.8,      // Roads provide a movement bonus
  NORMAL: 1.0,    // Standard open land / grass / coast
  SLOPE: 1.4,     // Traversing slopes requires extra effort
  BLOCKED: Infinity,
}

/**
 * Check if a single cell is walkable in principle (e.g. not pure water).
 * @param {import('../world/IslandData.js').HexCell} cell
 * @returns {boolean}
 */
export function isCellWalkable(cell) {
  if (!cell) return false
  // Pure water is impassable for land units
  if (cell.isWater || cell.name === 'WATER') return false
  return true
}

/**
 * Get the effective elevation of a cell's edge in a given direction.
 * @param {import('../world/IslandData.js').HexCell} cell
 * @param {string} dir One of 'NE', 'E', 'SE', 'SW', 'W', 'NW'
 * @returns {number}
 */
export function getCellEdgeLevel(cell, dir) {
  if (!cell) return 0
  return getEdgeLevel(cell.type, cell.rotation, dir, cell.level)
}

/**
 * Determine the hex direction from fromCell to toCell.
 * Returns null if the cells are not immediate neighbors (cube distance != 1).
 * @param {import('../world/IslandData.js').HexCell} fromCell
 * @param {import('../world/IslandData.js').HexCell} toCell
 * @returns {string|null} Direction name ('NE', 'E', 'SE', 'SW', 'W', 'NW') or null
 */
export function getDirectionBetween(fromCell, toCell) {
  if (!fromCell || !toCell) return null

  const dq = toCell.q - fromCell.q
  const dr = toCell.r - fromCell.r
  const ds = toCell.s - fromCell.s

  for (let i = 0; i < CUBE_DIRS.length; i++) {
    const d = CUBE_DIRS[i]
    if (d.dq === dq && d.dr === dr && d.ds === ds) {
      return d.name
    }
  }

  return null
}

/**
 * Check if a land unit can traverse from fromCell to an adjacent toCell.
 * Accounts for walkability, elevation continuity, valid slope ramps, and cliff drops.
 *
 * @param {import('../world/IslandData.js').HexCell} fromCell
 * @param {import('../world/IslandData.js').HexCell} toCell
 * @returns {boolean}
 */
export function canTraverse(fromCell, toCell) {
  if (!fromCell || !toCell) return false
  if (!isCellWalkable(fromCell) || !isCellWalkable(toCell)) return false

  const dirFrom = getDirectionBetween(fromCell, toCell)
  if (!dirFrom) return false // Not adjacent

  const dirTo = HexOpposite[dirFrom]
  const edgeLevelFrom = getCellEdgeLevel(fromCell, dirFrom)
  const edgeLevelTo = getCellEdgeLevel(toCell, dirTo)

  // 1. Elevation must match at the boundary
  if (edgeLevelFrom !== edgeLevelTo) {
    return false // Sheer cliff / vertical elevation mismatch
  }

  // 2. Cliff tile handling: cliff tiles represent vertical blocked boundaries on their high edges.
  // A cliff-facing high edge represents a sheer vertical cliff face and is NOT traversable.
  // A low edge at the cliff tile's actual base level may connect to compatible same-level terrain.
  if (fromCell.isCliff && edgeLevelFrom > fromCell.level) {
    return false // High edge of cliff is a sheer vertical wall
  }

  if (toCell.isCliff && edgeLevelTo > toCell.level) {
    return false // High edge of cliff is a sheer vertical wall
  }

  return true
}

/**
 * Get the movement cost between two adjacent cells.
 * Returns Infinity if traversal is blocked.
 *
 * @param {import('../world/IslandData.js').HexCell} fromCell
 * @param {import('../world/IslandData.js').HexCell} toCell
 * @returns {number}
 */
export function getMovementCost(fromCell, toCell) {
  if (!canTraverse(fromCell, toCell)) {
    return TerrainCost.BLOCKED
  }

  // Roads provide faster traversal
  if (fromCell.isRoad && toCell.isRoad) {
    return TerrainCost.ROAD
  }

  // Slopes require more effort to traverse
  if (fromCell.isSlope || toCell.isSlope) {
    return TerrainCost.SLOPE
  }

  return TerrainCost.NORMAL
}
