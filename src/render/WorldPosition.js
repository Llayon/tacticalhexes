/**
 * Single reusable conversion seam from HexCell domain objects to 3D world positions.
 * Decoupled from Three.js scene creation — returns plain { x, y, z } objects.
 */

import { cubeToOffset } from '../hexmap/HexWFCCore.js'
import { HexTileGeometry } from '../hexmap/HexTiles.js'

export const LEVEL_HEIGHT = 0.5

/**
 * Convert a HexCell to 3D world space coordinates
 * @param {import('../world/IslandData.js').HexCell} cell
 * @returns {{ x: number, y: number, z: number }}
 */
export function getCellWorldPosition(cell) {
  if (!cell) {
    return { x: 0, y: 0, z: 0 }
  }

  const col = cell.col !== undefined ? cell.col : (cell.q + Math.floor(cell.r / 2))
  const row = cell.row !== undefined ? cell.row : cell.r

  const pos = HexTileGeometry.getWorldPosition(col, row)

  // Surface elevation:
  // Base tile top is placed at Y = 1.0 above its instance origin (level * LEVEL_HEIGHT)
  const baseLevelY = (cell.level || 0) * LEVEL_HEIGHT + 1.0

  // For slopes, the mid-point anchor is half the level increment higher than base level
  const levelInc = cell.tileDef?.levelIncrement ?? 1
  const slopeBonus = cell.isSlope ? (levelInc * 0.5 * LEVEL_HEIGHT) : 0

  return {
    x: pos.x,
    y: baseLevelY + slopeBonus,
    z: pos.z,
  }
}
