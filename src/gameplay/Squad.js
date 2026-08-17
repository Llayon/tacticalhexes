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
    this.cell = cell // Authoritative canonical HexCell anchor
    this.destinationCell = null // Final goal HexCell
    this.state = SquadState.IDLE
    this.moveSpeed = moveSpeed // World units per second

    // Path following state
    this.path = [] // Array of canonical HexCell
    this.currentPathIndex = 0 // Index of current segment start in this.path
    this.segmentProgress = 0 // 0..1 progress along current segment
  }

  /**
   * Set a new traversal path of canonical HexCells
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

    this.path = pathCells
    this.currentPathIndex = 0
    this.segmentProgress = 0
    this.cell = pathCells[0]
    this.destinationCell = pathCells[pathCells.length - 1]
    this.state = SquadState.MOVING
  }

  /**
   * Advance authoritative cell to the next node in the path
   * @returns {boolean} True if more nodes remain, false if destination reached
   */
  advanceToNextNode() {
    if (this.currentPathIndex < this.path.length - 1) {
      this.currentPathIndex++
      this.cell = this.path[this.currentPathIndex]
      this.segmentProgress = 0

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
   * Stop squad movement immediately
   */
  stop() {
    this.path = []
    this.currentPathIndex = 0
    this.segmentProgress = 0
    this.state = SquadState.IDLE
    this.destinationCell = null
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
