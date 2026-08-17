/**
 * PlayerSquadController - Orchestrates player squad lifecycle, selection,
 * input handling, deterministic A* pathfinding, and movement updates.
 */

import { Squad, SquadState } from './Squad.js'
import { findDeterministicSpawnCell } from './SpawnSelector.js'
import { Pathfinder } from '../navigation/Pathfinder.js'
import { getCellWorldPosition } from '../render/WorldPosition.js'
import { SquadRenderer } from '../render/SquadRenderer.js'
import { PathRenderer } from '../render/PathRenderer.js'
import { Sounds } from '../lib/Sounds.js'

export class PlayerSquadController {
  /**
   * @param {Object} options
   * @param {Scene} options.scene Three.js Scene
   * @param {import('../hexmap/HexMap.js').HexMap} options.hexMap
   */
  constructor({ scene, hexMap }) {
    this.scene = scene
    this.hexMap = hexMap

    this.squad = null
    this.isSelected = false
    this.islandData = null
    this.navGrid = null
    this.pathfinder = null

    this.squadRenderer = null
    this.pathRenderer = null
  }

  /**
   * Initialize or re-initialize player squad on a freshly generated island
   * @param {import('../world/IslandData.js').IslandData} islandData
   * @param {import('../navigation/NavigationGrid.js').NavigationGrid} navGrid
   */
  initIsland(islandData, navGrid) {
    this.invalidate()

    if (!islandData || !navGrid) {
      return
    }

    this.islandData = islandData
    this.navGrid = navGrid
    this.pathfinder = new Pathfinder(navGrid)

    // Select deterministic spawn cell
    const spawnCell = findDeterministicSpawnCell(islandData, navGrid)
    if (!spawnCell) {
      console.warn('[PlayerSquadController] No valid spawn cell found on island')
      return
    }

    // Create domain Squad
    this.squad = new Squad({
      id: 'player-squad-alpha',
      team: 'player',
      cell: spawnCell,
      moveSpeed: 3.5, // 3.5 world units/sec for crisp tactical pace
    })

    // Create Visual Renderers
    this.squadRenderer = new SquadRenderer(this.scene, { teamColor: 0x38bdf8 })
    this.pathRenderer = new PathRenderer(this.scene, { color: 0x38bdf8 })

    const spawnPos = getCellWorldPosition(spawnCell)
    this.squadRenderer.setPosition(spawnPos.x, spawnPos.y, spawnPos.z)
    this.squadRenderer.setSelected(false)
    this.isSelected = false
  }

  /**
   * Handle canonical cell clicks from HexMapInteraction
   * @param {import('../world/IslandData.js').HexCell} cell
   * @returns {boolean} True if click was consumed by squad gameplay
   */
  handleCellClicked(cell) {
    if (!this.squad || !this.navGrid || !cell) {
      return false
    }

    // Validate cell belongs to the active island
    if (!this.navGrid.containsCell(cell)) {
      return false
    }

    // Case 1: Tapping the squad's own current cell or upcoming segment node
    const isCurrentCell = (cell === this.squad.cell) || (cell.key === this.squad.cell.key)
    const nextCell = this.squad.getNextCell()
    const isNextCell = this.squad.isMovingSegment() && nextCell && (cell === nextCell || cell.key === nextCell.key)

    if (isCurrentCell && !this.squad.isMovingSegment()) {
      this.selectSquad(!this.isSelected)
      return true
    }

    // Case 2: Tapping terrain while squad is NOT selected
    if (!this.isSelected) {
      if (isCurrentCell || isNextCell) {
        this.selectSquad(true)
        return true
      }
      return false // Permit normal unhandled interaction (e.g. camera)
    }

    // Case 3: Squad IS selected -> Issue Move / Reroute Command
    if (!this.navGrid.isWalkable(cell)) {
      // Non-walkable terrain (e.g. water) -> reject move command
      Sounds.play('incorrect')
      return true
    }

    // Check if squad is currently moving between nodes
    if (this.squad.isMovingSegment()) {
      const currentSegment = this.squad.getCurrentSegment()
      if (!currentSegment) return false

      const fromCell = currentSegment.fromCell
      const targetNextCell = currentSegment.toCell

      // If clicked the exact cell we are already traveling towards
      if (cell === targetNextCell || cell.key === targetNextCell.key) {
        this.squad.truncatePathAtNextNode()
        this.pathRenderer?.showPath([fromCell, targetNextCell])
        Sounds.play('pop', 0.9, 0.2, 0.8)
        return true
      }

      // Compute A* path from upcoming node to new destination
      const pathFromNext = this.pathfinder.findPath(targetNextCell, cell)
      if (pathFromNext && pathFromNext.length > 1) {
        this.squad.setPendingDestination(cell, pathFromNext)
        // Coherent visualization: current segment [fromCell, targetNextCell] + remainder of new path
        this.pathRenderer?.showPath([fromCell, ...pathFromNext])
        Sounds.play('pop', 0.9, 0.2, 0.8)
        return true
      } else {
        // Unreachable from upcoming node
        Sounds.play('incorrect')
        return true
      }
    } else {
      // Squad is idle (or stopped at a node)
      if (isCurrentCell) {
        this.selectSquad(false)
        return true
      }

      const path = this.pathfinder.findPath(this.squad.cell, cell)
      if (path && path.length > 1) {
        this.squad.setPath(path)
        this.pathRenderer?.showPath(path)
        Sounds.play('pop', 0.9, 0.2, 0.8)
        return true
      } else {
        Sounds.play('incorrect')
        return true
      }
    }
  }

  /**
   * Toggle or set squad selection state
   * @param {boolean} selected
   */
  selectSquad(selected) {
    this.isSelected = !!selected
    if (this.squadRenderer) {
      this.squadRenderer.setSelected(this.isSelected)
    }
    if (this.isSelected) {
      Sounds.play('roll', 1.0, 0.2, 0.6)
    }
  }

  /**
   * Per-frame simulation & visual update
   * @param {number} dt Delta time in seconds
   */
  update(dt) {
    if (!this.squad || !this.squadRenderer) {
      return
    }

    const squad = this.squad
    // Clamp delta time to avoid large jumps, NaN, or skipping simulation during tab switches
    const safeDt = Math.min(Math.max(Number.isFinite(dt) ? dt : 0, 0), 0.1)

    if (squad.state === SquadState.MOVING && squad.path.length > 1) {
      const segment = squad.getCurrentSegment()

      if (segment && segment.fromCell && segment.toCell) {
        const p0 = getCellWorldPosition(segment.fromCell)
        const p1 = getCellWorldPosition(segment.toCell)

        const dx = p1.x - p0.x
        const dy = p1.y - p0.y
        const dz = p1.z - p0.z
        const segmentDist = Math.hypot(dx, dy, dz)

        const step = segmentDist > 0.0001 ? (squad.moveSpeed * safeDt) / segmentDist : 1.0
        squad.segmentProgress += step

        // Facing rotation towards movement direction
        if (Math.abs(dx) > 0.001 || Math.abs(dz) > 0.001) {
          const angleY = Math.atan2(dx, dz)
          this.squadRenderer.setTargetRotation(angleY)
        }

        // Interpolate visual position
        const t = Math.min(Math.max(squad.segmentProgress, 0), 1)
        const visualX = p0.x + dx * t
        const visualY = p0.y + dy * t
        const visualZ = p0.z + dz * t
        this.squadRenderer.setPosition(visualX, visualY, visualZ)

        // Check if node is reached
        if (squad.segmentProgress >= 1.0) {
          const hasMore = squad.advanceToNextNode()
          if (hasMore) {
            if (this.pathRenderer) {
              const remainingPath = squad.path.slice(squad.currentPathIndex)
              this.pathRenderer.showPath(remainingPath)
            }
          } else {
            // Reached final destination!
            const finalPos = getCellWorldPosition(squad.cell)
            this.squadRenderer.setPosition(finalPos.x, finalPos.y, finalPos.z)
            if (this.pathRenderer) {
              this.pathRenderer.clear()
            }
          }
        }
      } else {
        squad.stop()
        if (this.pathRenderer) {
          this.pathRenderer.clear()
        }
      }
    } else {
      // Idle on current cell
      const pos = getCellWorldPosition(squad.cell)
      this.squadRenderer.setPosition(pos.x, pos.y, pos.z)
    }

    this.squadRenderer.update(safeDt, squad.state === SquadState.MOVING)
  }

  /**
   * Invalidate squad and renderers during island regeneration
   */
  invalidate() {
    if (this.squad) {
      this.squad.stop()
      this.squad = null
    }
    this.isSelected = false

    if (this.pathRenderer) {
      this.pathRenderer.dispose()
      this.pathRenderer = null
    }

    if (this.squadRenderer) {
      this.squadRenderer.dispose()
      this.squadRenderer = null
    }

    this.islandData = null
    this.navGrid = null
    this.pathfinder = null
  }

  /**
   * Full cleanup
   */
  dispose() {
    this.invalidate()
  }
}
