/**
 * IslandData - Pure domain representation of a tactical hex island.
 * Completely decoupled from Three.js scene graphs and rendering instances.
 */

import { cubeKey, parseCubeKey, cubeToOffset, getEdgeLevel } from '../hexmap/HexWFCCore.js'
import { TILE_LIST } from '../hexmap/HexTileData.js'

export class HexCell {
  constructor({ q, r, s, type, rotation = 0, level = 0 }) {
    this.q = q
    this.r = r
    this.s = s
    this.type = type
    this.rotation = rotation
    this.level = level

    // Axial / Offset coordinates
    const offset = cubeToOffset(q, r, s)
    this.col = offset.col
    this.row = offset.row
  }

  get key() {
    return cubeKey(this.q, this.r, this.s)
  }

  get tileDef() {
    return TILE_LIST[this.type] || null
  }

  get name() {
    return this.tileDef?.name || 'UNKNOWN'
  }

  get isWater() {
    return this.name === 'WATER'
  }

  get isCoast() {
    return this.name.startsWith('COAST_')
  }

  get isRoad() {
    return this.name.startsWith('ROAD_')
  }

  get isCliff() {
    return this.name.includes('CLIFF')
  }

  get isSlope() {
    return !this.isCliff && (this.name.includes('SLOPE') || !!(this.tileDef?.highEdges && this.tileDef.highEdges.length > 0))
  }

  get isWalkable() {
    // Basic walkability predicate: pure water is not walkable for land units
    return !this.isWater
  }

  /**
   * Get the elevation level of an edge in a given direction
   * @param {string} dir One of 'NE', 'E', 'SE', 'SW', 'W', 'NW'
   * @returns {number}
   */
  getEdgeLevel(dir) {
    return getEdgeLevel(this.type, this.rotation, dir, this.level)
  }
}

export class IslandData {
  constructor({ seed = 0, radius = 5 } = {}) {
    this.seed = seed
    this.radius = radius
    this.cells = new Map() // cubeKey -> HexCell
    this.collapseOrder = [] // HexCell[] in solve order
    this.createdAt = Date.now()
  }

  addCell(cellData) {
    const cell = cellData instanceof HexCell ? cellData : new HexCell(cellData)
    this.cells.set(cell.key, cell)
    return cell
  }

  getCell(q, r, s) {
    return this.cells.get(cubeKey(q, r, s)) || null
  }

  hasCell(q, r, s) {
    return this.cells.has(cubeKey(q, r, s))
  }

  getAllCells() {
    return Array.from(this.cells.values())
  }

  getCellCount() {
    return this.cells.size
  }

  getCellsByPredicate(predicate) {
    const results = []
    for (const cell of this.cells.values()) {
      if (predicate(cell)) results.push(cell)
    }
    return results
  }

  getWalkableCells() {
    return this.getCellsByPredicate(c => c.isWalkable)
  }

  getCoastCells() {
    return this.getCellsByPredicate(c => c.isCoast)
  }

  getWaterCells() {
    return this.getCellsByPredicate(c => c.isWater)
  }

  getLandCells() {
    return this.getCellsByPredicate(c => !c.isWater && !c.isCoast)
  }

  toJSON() {
    return {
      seed: this.seed,
      radius: this.radius,
      cellCount: this.cells.size,
      cells: Array.from(this.cells.values()).map(c => ({
        q: c.q,
        r: c.r,
        s: c.s,
        col: c.col,
        row: c.row,
        type: c.type,
        rotation: c.rotation,
        level: c.level,
        name: c.name,
      })),
    }
  }
}
