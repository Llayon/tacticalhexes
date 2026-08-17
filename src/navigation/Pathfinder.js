/**
 * Pathfinder - Deterministic Hex A* pathfinder.
 * Pure gameplay/simulation domain — no Three.js or rendering dependencies.
 */

import { cubeDistance } from '../hexmap/HexWFCCore.js'
import { TerrainCost } from './TerrainRules.js'

/**
 * Minimum cost per hex step across any terrain type (ensures heuristic admissibility).
 */
const MIN_STEP_COST = TerrainCost.ROAD // 0.8

/**
 * Admissible cube-distance heuristic for hex grid A*
 */
export function hexHeuristic(cellA, cellB) {
  const dist = cubeDistance(cellA.q, cellA.r, cellA.s, cellB.q, cellB.r, cellB.s)
  return dist * MIN_STEP_COST
}

/**
 * Binary MinHeap for deterministic O(log N) priority queue operations.
 */
class MinHeap {
  constructor(comparator) {
    this.heap = []
    this.comparator = comparator
  }

  get size() {
    return this.heap.length
  }

  isEmpty() {
    return this.heap.length === 0
  }

  push(item) {
    this.heap.push(item)
    this._siftUp(this.heap.length - 1)
  }

  pop() {
    if (this.heap.length === 0) return null
    const top = this.heap[0]
    const bottom = this.heap.pop()
    if (this.heap.length > 0) {
      this.heap[0] = bottom
      this._siftDown(0)
    }
    return top
  }

  _siftUp(index) {
    let child = index
    while (child > 0) {
      const parent = (child - 1) >> 1
      if (this.comparator(this.heap[child], this.heap[parent]) < 0) {
        const temp = this.heap[child]
        this.heap[child] = this.heap[parent]
        this.heap[parent] = temp
        child = parent
      } else {
        break
      }
    }
  }

  _siftDown(index) {
    let parent = index
    const length = this.heap.length
    while (true) {
      const left = (parent << 1) + 1
      const right = left + 1
      let smallest = parent

      if (left < length && this.comparator(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left
      }
      if (right < length && this.comparator(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right
      }

      if (smallest !== parent) {
        const temp = this.heap[parent]
        this.heap[parent] = this.heap[smallest]
        this.heap[smallest] = temp
        parent = smallest
      } else {
        break
      }
    }
  }
}

/**
 * Deterministic node comparator for A*:
 * 1. Lower fScore
 * 2. Lower hScore (closer to destination)
 * 3. Deterministic coordinate tie-break (q, then r, then s)
 */
function nodeComparator(a, b) {
  const fDiff = a.fScore - b.fScore
  if (Math.abs(fDiff) > 1e-7) return fDiff

  const hDiff = a.hScore - b.hScore
  if (Math.abs(hDiff) > 1e-7) return hDiff

  if (a.cell.q !== b.cell.q) return a.cell.q - b.cell.q
  if (a.cell.r !== b.cell.r) return a.cell.r - b.cell.r
  return a.cell.s - b.cell.s
}

export class Pathfinder {
  /**
   * @param {import('./NavigationGrid.js').NavigationGrid} navGrid
   */
  constructor(navGrid) {
    if (!navGrid) {
      throw new Error('[Pathfinder] navGrid is required')
    }
    this.navGrid = navGrid
  }

  /**
   * Find a path between startCell and goalCell using deterministic A*.
   *
   * @param {import('../world/IslandData.js').HexCell} startCell
   * @param {import('../world/IslandData.js').HexCell} goalCell
   * @param {Object} [options]
   * @param {number} [options.maxIterations=5000] Maximum search steps before aborting
   * @param {number} [options.costLimit=Infinity] Maximum allowable total path cost
   * @returns {import('../world/IslandData.js').HexCell[]|null} Array of HexCells from start to goal, or null if unreachable
   */
  findPath(startCell, goalCell, options = {}) {
    if (!startCell || !goalCell) return null
    if (!this.navGrid.isWalkable(startCell) || !this.navGrid.isWalkable(goalCell)) return null

    // Trivial case: start is already goal
    if (startCell.key === goalCell.key) {
      return [startCell]
    }

    const maxIterations = options.maxIterations ?? 5000
    const costLimit = options.costLimit ?? Infinity

    const openSet = new MinHeap(nodeComparator)
    const closedSet = new Set() // Set of cell.key

    const gScore = new Map() // cell.key -> number
    const cameFrom = new Map() // cell.key -> HexCell

    gScore.set(startCell.key, 0)
    const startH = hexHeuristic(startCell, goalCell)

    openSet.push({
      cell: startCell,
      gScore: 0,
      hScore: startH,
      fScore: startH,
    })

    let iterations = 0

    while (!openSet.isEmpty()) {
      if (++iterations > maxIterations) {
        console.warn(`[Pathfinder] Exceeded maxIterations (${maxIterations}) searching path`)
        return null
      }

      const current = openSet.pop()
      const currentCell = current.cell
      const currentKey = currentCell.key

      // Reached goal!
      if (currentKey === goalCell.key) {
        return this._reconstructPath(cameFrom, currentCell)
      }

      if (closedSet.has(currentKey)) {
        continue
      }
      closedSet.add(currentKey)

      const currentG = gScore.get(currentKey) ?? Infinity
      const neighbors = this.navGrid.getNeighbors(currentCell)

      for (let i = 0; i < neighbors.length; i++) {
        const neighbor = neighbors[i]
        const neighborKey = neighbor.key

        if (closedSet.has(neighborKey)) {
          continue
        }

        const stepCost = this.navGrid.getMovementCost(currentCell, neighbor)
        if (stepCost === Infinity || stepCost === TerrainCost.BLOCKED) {
          continue
        }

        const tentativeG = currentG + stepCost
        if (tentativeG > costLimit) {
          continue
        }

        const previousG = gScore.get(neighborKey) ?? Infinity
        if (tentativeG < previousG) {
          cameFrom.set(neighborKey, currentCell)
          gScore.set(neighborKey, tentativeG)

          const h = hexHeuristic(neighbor, goalCell)
          const f = tentativeG + h

          openSet.push({
            cell: neighbor,
            gScore: tentativeG,
            hScore: h,
            fScore: f,
          })
        }
      }
    }

    // Goal unreachable
    return null
  }

  /**
   * Reconstruct path array from cameFrom map
   */
  _reconstructPath(cameFrom, current) {
    const path = [current]
    let curr = current
    while (cameFrom.has(curr.key)) {
      curr = cameFrom.get(curr.key)
      path.push(curr)
    }
    path.reverse()
    return path
  }
}

/**
 * Convenience helper function
 */
export function findPath(navGrid, startCell, goalCell, options = {}) {
  const pathfinder = new Pathfinder(navGrid)
  return pathfinder.findPath(startCell, goalCell, options)
}
