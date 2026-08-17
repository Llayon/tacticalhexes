/**
 * PathRenderer - Lightweight visualizer for tactical A* paths.
 * Renders waypoint markers and connecting line segments along HexCell[] paths.
 * Decoupled from pathfinding logic.
 */

import {
  Group,
  Mesh,
  CylinderGeometry,
  RingGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  LineSegments,
  LineBasicNodeMaterial,
  MeshBasicNodeMaterial,
  Color,
  DoubleSide,
} from 'three/webgpu'
import { getCellWorldPosition } from './WorldPosition.js'

export class PathRenderer {
  /**
   * @param {Scene} scene
   * @param {Object} [options]
   * @param {number} [options.color=0x38bdf8] Sky blue tactical color
   */
  constructor(scene, { color = 0x38bdf8 } = {}) {
    this.scene = scene
    this.color = color
    this.group = new Group()
    this.group.name = 'PathVisualGroup'

    this.dotMeshes = []
    this.lineSegments = null

    // Shared node dot geometry & material
    this.dotGeom = new CylinderGeometry(0.18, 0.18, 0.04, 16)
    this.destGeom = new RingGeometry(0.3, 0.44, 24)
    this.destGeom.rotateX(-Math.PI / 2)

    this.nodeMat = new MeshBasicNodeMaterial({
      color: new Color(this.color),
      transparent: true,
      opacity: 0.8,
      side: DoubleSide,
      depthWrite: false,
    })

    this.destMat = new MeshBasicNodeMaterial({
      color: new Color(0xffffff),
      transparent: true,
      opacity: 0.9,
      side: DoubleSide,
      depthWrite: false,
    })

    this.lineMat = new LineBasicNodeMaterial({
      color: new Color(this.color),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    })

    this.scene.add(this.group)
  }

  /**
   * Render a path of canonical HexCells
   * @param {import('../world/IslandData.js').HexCell[]} path
   */
  showPath(path) {
    this.clear()

    if (!path || path.length <= 1) {
      return
    }

    const positions = []

    // Build waypoint node dots along the path
    for (let i = 0; i < path.length; i++) {
      const cell = path[i]
      const pos = getCellWorldPosition(cell)
      const isDestination = i === path.length - 1

      // Slightly elevate above ground to prevent z-fighting
      const yElevated = pos.y + 0.05

      const mesh = new Mesh(
        isDestination ? this.destGeom : this.dotGeom,
        isDestination ? this.destMat : this.nodeMat
      )
      mesh.position.set(pos.x, yElevated, pos.z)
      this.group.add(mesh)
      this.dotMeshes.push(mesh)

      if (i > 0) {
        const prevCell = path[i - 1]
        const prevPos = getCellWorldPosition(prevCell)
        positions.push(prevPos.x, prevPos.y + 0.05, prevPos.z)
        positions.push(pos.x, yElevated, pos.z)
      }
    }

    // Connecting line segments between nodes
    if (positions.length > 0) {
      const lineGeom = new BufferGeometry()
      lineGeom.setAttribute('position', new Float32BufferAttribute(new Float32Array(positions), 3))
      this.lineSegments = new LineSegments(lineGeom, this.lineMat)
      this.group.add(this.lineSegments)
    }

    this.group.visible = true
  }

  /**
   * Clear active path visualization
   */
  clear() {
    for (const dot of this.dotMeshes) {
      this.group.remove(dot)
    }
    this.dotMeshes = []

    if (this.lineSegments) {
      this.group.remove(this.lineSegments)
      this.lineSegments.geometry.dispose?.()
      this.lineSegments = null
    }

    this.group.visible = false
  }

  /**
   * Full cleanup
   */
  dispose() {
    this.clear()
    if (this.group.parent) {
      this.group.parent.remove(this.group)
    }
    this.dotGeom.dispose?.()
    this.destGeom.dispose?.()
    this.nodeMat.dispose?.()
    this.destMat.dispose?.()
    this.lineMat.dispose?.()
  }
}
