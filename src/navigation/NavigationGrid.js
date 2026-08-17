/**
 * NavigationGrid - Spatial navigation abstraction constructed over IslandData.
 * Pure gameplay/simulation domain — no Three.js or rendering dependencies.
 */

import { CUBE_DIRS } from '../hexmap/HexWFCCore.js'
import { isCellWalkable, canTraverse, getMovementCost, TerrainCost } from './TerrainRules.js'

export class NavigationGrid {
  /**
   * @param {import('../world/IslandData.js').IslandData} islandData
   */
  constructor(islandData) {
    if (!islandData) {
      throw new Error('[NavigationGrid] islandData is required')
    }
    this.islandData = islandData
  }

  /**
   * Check if a specific HexCell instance belongs to this NavigationGrid's IslandData
   * @param {import('../world/IslandData.js').HexCell} cell
   * @returns {boolean}
   */
  containsCell(cell) {
    if (!cell || typeof cell !== 'object') return false
    const key = cell.key
    if (!key) return false
    return this.islandData.cells.get(key) === cell
  }

  /**
   * Get a cell by cube coordinates
   * @param {number} q
   * @param {number} r
   * @param {number} s
   * @returns {import('../world/IslandData.js').HexCell|null}
   */
  getCell(q, r, s) {
    return this.islandData.getCell(q, r, s)
  }

  /**
   * Get a cell by cube key string "q,r,s"
   * @param {string} key
   * @returns {import('../world/IslandData.js').HexCell|null}
   */
  getCellByKey(key) {
    return this.islandData.cells.get(key) || null
  }

  /**
   * Check if a cell is inherently walkable (e.g. not water)
   * @param {import('../world/IslandData.js').HexCell} cell
   * @returns {boolean}
   */
  isWalkable(cell) {
    if (!this.containsCell(cell)) return false
    return isCellWalkable(cell)
  }

  /**
   * Check if traversal is possible between two adjacent cells
   * @param {import('../world/IslandData.js').HexCell} fromCell
   * @param {import('../world/IslandData.js').HexCell} toCell
   * @returns {boolean}
   */
  canTraverse(fromCell, toCell) {
    if (!this.containsCell(fromCell) || !this.containsCell(toCell)) return false
    return canTraverse(fromCell, toCell)
  }

  /**
   * Get the movement cost between two adjacent cells
   * @param {import('../world/IslandData.js').HexCell} fromCell
   * @param {import('../world/IslandData.js').HexCell} toCell
   * @returns {number}
   */
  getMovementCost(fromCell, toCell) {
    if (!this.containsCell(fromCell) || !this.containsCell(toCell)) return Infinity
    return getMovementCost(fromCell, toCell)
  }

  /**
   * Get all traversable neighboring HexCells for a given cell
   * @param {import('../world/IslandData.js').HexCell} cell
   * @returns {import('../world/IslandData.js').HexCell[]}
   */
  getNeighbors(cell) {
    if (!this.containsCell(cell)) return []
    const neighbors = []
    for (let i = 0; i < CUBE_DIRS.length; i++) {
      const dir = CUBE_DIRS[i]
      const neighbor = this.islandData.getCell(cell.q + dir.dq, cell.r + dir.dr, cell.s + dir.ds)
      if (neighbor && canTraverse(cell, neighbor)) {
        neighbors.push(neighbor)
      }
    }
    return neighbors
  }

  /**
   * Get all physically adjacent HexCells in the island, regardless of traversability
   * @param {import('../world/IslandData.js').HexCell} cell
   * @returns {import('../world/IslandData.js').HexCell[]}
   */
  getAllAdjacentCells(cell) {
    if (!this.containsCell(cell)) return []
    const adjacent = []
    for (let i = 0; i < CUBE_DIRS.length; i++) {
      const dir = CUBE_DIRS[i]
      const neighbor = this.islandData.getCell(cell.q + dir.dq, cell.r + dir.dr, cell.s + dir.ds)
      if (neighbor) {
        adjacent.push(neighbor)
      }
    }
    return adjacent
  }

  /**
   * Get all walkable cells on the island
   * @returns {import('../world/IslandData.js').HexCell[]}
   */
  getWalkableCells() {
    return this.islandData.getCellsByPredicate(c => isCellWalkable(c))
  }

  /**
   * Flood-fill search from startCell up to a maximum movement budget/distance
   * @param {import('../world/IslandData.js').HexCell} startCell
   * @param {number} [maxCost=5]
   * @returns {Map<string, { cell: import('../world/IslandData.js').HexCell, cost: number, distance: number }>}
   */
  getReachableCells(startCell, maxCost = 5) {
    const reachable = new Map()
    if (!this.containsCell(startCell) || !this.isWalkable(startCell)) return reachable

    // Priority queue / min cost map
    const costMap = new Map()
    costMap.set(startCell.key, 0)
    reachable.set(startCell.key, { cell: startCell, cost: 0, distance: 0 })

    const queue = [{ cell: startCell, cost: 0, distance: 0 }]

    while (queue.length > 0) {
      // Smallest cost first
      queue.sort((a, b) => a.cost - b.cost)
      const current = queue.shift()

      if (current.cost > maxCost) continue

      const neighbors = this.getNeighbors(current.cell)
      for (const neighbor of neighbors) {
        const stepCost = this.getMovementCost(current.cell, neighbor)
        if (stepCost === Infinity || stepCost === TerrainCost.BLOCKED) continue

        const nextCost = current.cost + stepCost
        if (nextCost <= maxCost) {
          const prevCost = costMap.get(neighbor.key)
          if (prevCost === undefined || nextCost < prevCost) {
            costMap.set(neighbor.key, nextCost)
            const item = { cell: neighbor, cost: nextCost, distance: current.distance + 1 }
            reachable.set(neighbor.key, item)
            queue.push(item)
          }
        }
      }
    }

    return reachable
  }
}
