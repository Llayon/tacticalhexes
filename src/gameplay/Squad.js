/**
 * Pure domain representation of a squad entity.
 * Completely decoupled from Three.js and rendering instances.
 */

export const SquadState = {
  IDLE: 'idle',
  MOVING: 'moving',
}

export class Squad {
  /**
   * @param {Object} options
   * @param {string} [options.id='player-squad-1']
   * @param {string} [options.team='player']
   * @param {import('../world/IslandData.js').HexCell} [options.cell=null] Canonical HexCell
   * @param {number} [options.moveSpeed=3.5] Movement speed in world units per second
   */
  constructor({ id = 'player-squad-1', team = 'player', cell = null, moveSpeed = 3.5 } = {}) {
    this.id = id
    this.team = team
    this.cell = cell // Authoritative canonical HexCell anchor (last reached node)
    this.destinationCell = null // Final goal HexCell
    this.state = SquadState.IDLE
    this.moveSpeed = moveSpeed // World units per second

    // Active path following state
    this.path = [] // Array of canonical HexCell [startNode, node1, node2, ..., goalNode]
    this.currentPathIndex = 0 // Index of current segment start in this.path
    this.segmentProgress = 0 // 0..1 progress along current segment

    // Pending reroute state (to be applied after reaching the next canonical node)
    this.pendingDestinationCell = null
    this.pendingPath = null
  }

  /**
   * Set a new traversal path of canonical HexCells immediately
   * @param {import('../world/IslandData.js').HexCell[]} pathCells
   */
  setPath(pathCells) {
    if (!pathCells || pathCells.length <= 1) {
      this.stop()
      if (pathCells && pathCells.length === 1) {
        this.cell = pathCells[0]
      }
      return
    }

    this.clearPendingDestination()
    this.path = pathCells
    this.currentPathIndex = 0
    this.segmentProgress = 0
    this.cell = pathCells[0]
    this.destinationCell = pathCells[pathCells.length - 1]
    this.state = SquadState.MOVING
  }

  /**
   * Register a pending reroute path to be seamlessly applied when the next node is reached.
   * Preserves the active in-progress visual segment without resetting progress.
   * @param {import('../world/IslandData.js').HexCell} destinationCell
   * @param {import('../world/IslandData.js').HexCell[]} pathFromNextNode
   */
  setPendingDestination(destinationCell, pathFromNextNode) {
    if (!destinationCell || !pathFromNextNode || pathFromNextNode.length < 1) {
      this.clearPendingDestination()
      return
    }

    this.pendingDestinationCell = destinationCell
    this.pendingPath = pathFromNextNode
    this.destinationCell = destinationCell
  }

  /**
   * Clear any pending reroute destination
   */
  clearPendingDestination() {
    this.pendingDestinationCell = null
    this.pendingPath = null
  }

  /**
   * Truncate the active path to end at the next immediate node
   */
  truncatePathAtNextNode() {
    const nextCell = this.getNextCell()
    if (nextCell) {
      this.path = this.path.slice(0, this.currentPathIndex + 2)
      this.destinationCell = nextCell
      this.clearPendingDestination()
    }
  }

  /**
   * Get the current in-flight segment (fromCell -> toCell)
   * @returns {{ fromCell: import('../world/IslandData.js').HexCell, toCell: import('../world/IslandData.js').HexCell } | null}
   */
  getCurrentSegment() {
    if (this.state !== SquadState.MOVING || this.currentPathIndex >= this.path.length - 1) {
      return null
    }
    const fromCell = this.path[this.currentPathIndex]
    const toCell = this.path[this.currentPathIndex + 1]
    if (!fromCell || !toCell) return null
    return { fromCell, toCell }
  }

  /**
   * Get the upcoming target HexCell for the current segment
   * @returns {import('../world/IslandData.js').HexCell | null}
   */
  getNextCell() {
    if (this.state !== SquadState.MOVING || this.currentPathIndex >= this.path.length - 1) {
      return null
    }
    return this.path[this.currentPathIndex + 1] || null
  }

  /**
   * Check if squad is actively moving along an in-flight segment
   * @returns {boolean}
   */
  isMovingSegment() {
    return this.state === SquadState.MOVING &&
      this.path.length > this.currentPathIndex + 1 &&
      this.segmentProgress < 1.0
  }

  /**
   * Advance authoritative cell to the next node in the path.
   * If a valid pending path starting at the new node exists, seamlessly switches routes.
   * @returns {boolean} True if more nodes remain to traverse, false if final destination reached
   */
  advanceToNextNode() {
    if (this.currentPathIndex < this.path.length - 1) {
      this.currentPathIndex++
      this.cell = this.path[this.currentPathIndex]
      this.segmentProgress = 0

      // Seamlessly switch to pending reroute if present and aligned with newly reached node
      if (this.pendingPath && this.pendingPath.length > 1) {
        if (this.pendingPath[0] === this.cell) {
          this.path = this.pendingPath
          this.currentPathIndex = 0
          this.destinationCell = this.pendingDestinationCell
          this.clearPendingDestination()
          return true
        } else {
          // Stale / foreign pending path that doesn't align with reached node -> drop it
          this.clearPendingDestination()
        }
      }

      if (this.currentPathIndex >= this.path.length - 1) {
        this.stop()
        return false
      }
      return true
    } else {
      this.stop()
      return false
    }
  }

  /**
   * Stop squad movement immediately and clear all paths
   */
  stop() {
    this.path = []
    this.currentPathIndex = 0
    this.segmentProgress = 0
    this.state = SquadState.IDLE
    this.destinationCell = null
    this.clearPendingDestination()
  }

  /**
   * Set squad anchor cell directly (e.g. on spawn or teleport)
   * @param {import('../world/IslandData.js').HexCell} cell
   */
  setPositionCell(cell) {
    this.stop()
    this.cell = cell
  }
}

