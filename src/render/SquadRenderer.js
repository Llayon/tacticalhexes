/**
 * SquadRenderer - Visual representation of a tactical squad in Three.js scene.
 * Decoupled from authoritative Squad domain state.
 *
 * Renders:
 * - A compact formation of 7 low-poly soldier figures
 * - A tactical selection indicator beneath the squad
 * - Facing direction and smooth movement/idle bobbing animations
 */

import {
  Group,
  Mesh,
  CylinderGeometry,
  SphereGeometry,
  RingGeometry,
  MeshStandardNodeMaterial,
  MeshBasicNodeMaterial,
  Color,
  Vector3,
  AdditiveBlending,
  DoubleSide,
} from 'three/webgpu'

export class SquadRenderer {
  /**
   * @param {Scene} scene
   * @param {Object} [options]
   * @param {number} [options.teamColor=0x38bdf8] Player team primary color (tactical sky blue)
   */
  constructor(scene, { teamColor = 0x38bdf8 } = {}) {
    this.scene = scene
    this.teamColor = teamColor
    this.group = new Group()
    this.group.name = 'SquadVisualGroup'

    this.soldiersGroup = new Group()
    this.group.add(this.soldiersGroup)

    this.selectionRing = null
    this.isSelected = false

    this.currentPosition = new Vector3()
    this.targetRotationY = 0
    this.currentRotationY = 0

    this.animTime = 0
    this.isMoving = false

    this.soldierMeshes = []
    this.geometries = []
    this.materials = []

    this.initVisuals()
    this.scene.add(this.group)
  }

  initVisuals() {
    // 1. Tactical selection ring underneath the squad
    const ringGeom = new RingGeometry(0.72, 0.84, 32)
    ringGeom.rotateX(-Math.PI / 2) // Lie flat on ground
    this.geometries.push(ringGeom)

    const ringMat = new MeshBasicNodeMaterial({
      color: new Color(0x38bdf8),
      transparent: true,
      opacity: 0.85,
      side: DoubleSide,
      depthWrite: false,
    })
    this.materials.push(ringMat)

    this.selectionRing = new Mesh(ringGeom, ringMat)
    this.selectionRing.position.set(0, 0.04, 0)
    this.selectionRing.visible = false
    this.group.add(this.selectionRing)

    // 2. Shared soldier geometries & materials
    // Body: stylized conical cylinder (lower coat/torso)
    const bodyGeom = new CylinderGeometry(0.08, 0.12, 0.32, 8)
    bodyGeom.translate(0, 0.16, 0)
    this.geometries.push(bodyGeom)

    // Head / Helmet: sphere
    const headGeom = new SphereGeometry(0.09, 8, 6)
    headGeom.translate(0, 0.38, 0)
    this.geometries.push(headGeom)

    // Shield / Shoulder badge: small side box
    const shieldGeom = new CylinderGeometry(0.09, 0.09, 0.04, 6)
    shieldGeom.rotateZ(Math.PI / 2)
    shieldGeom.translate(-0.13, 0.24, 0)
    this.geometries.push(shieldGeom)

    // Materials
    const armorMat = new MeshStandardNodeMaterial({
      color: new Color(0x475569), // Slate armor
      roughness: 0.6,
      metalness: 0.3,
    })
    const helmetMat = new MeshStandardNodeMaterial({
      color: new Color(0x94a3b8), // Silver helm
      roughness: 0.4,
      metalness: 0.6,
    })
    const teamMat = new MeshStandardNodeMaterial({
      color: new Color(this.teamColor), // Tactical team highlight
      roughness: 0.5,
      metalness: 0.2,
    })
    this.materials.push(armorMat, helmetMat, teamMat)

    // 3. Compact 7-soldier formation layout within roughly 0.8 hex radius
    const formationOffsets = [
      { x: 0, z: 0 },         // Leader (center)
      { x: 0.28, z: 0.06 },   // Right flank
      { x: -0.28, z: 0.06 },  // Left flank
      { x: 0.14, z: 0.26 },   // Rear right
      { x: -0.14, z: 0.26 },  // Rear left
      { x: 0.14, z: -0.24 },  // Front right
      { x: -0.14, z: -0.24 }, // Front left
    ]

    for (let i = 0; i < formationOffsets.length; i++) {
      const offset = formationOffsets[i]
      const soldier = new Group()

      const body = new Mesh(bodyGeom, i === 0 ? teamMat : armorMat)
      const head = new Mesh(headGeom, helmetMat)
      const shield = new Mesh(shieldGeom, teamMat)

      soldier.add(body, head, shield)
      soldier.position.set(offset.x, 0, offset.z)

      // Slight random scale variation for natural tactical squad look
      const s = i === 0 ? 1.08 : (0.94 + ((i * 37) % 10) * 0.015)
      soldier.scale.set(s, s, s)

      this.soldiersGroup.add(soldier)
      this.soldierMeshes.push({ group: soldier, baseY: 0, baseZ: offset.z, baseX: offset.x, index: i })
    }
  }

  /**
   * Set selection highlight state
   * @param {boolean} selected
   */
  setSelected(selected) {
    this.isSelected = !!selected
    if (this.selectionRing) {
      this.selectionRing.visible = this.isSelected
    }
  }

  /**
   * Set world position directly
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  setPosition(x, y, z) {
    this.currentPosition.set(x, y, z)
    this.group.position.copy(this.currentPosition)
  }

  /**
   * Set facing rotation around Y axis
   * @param {number} angleY Target radians
   */
  setTargetRotation(angleY) {
    this.targetRotationY = angleY
  }

  /**
   * Update animation and visual transforms
   * @param {number} dt Delta time in seconds
   * @param {boolean} isMoving Whether the squad is actively moving along path
   */
  update(dt, isMoving = false) {
    this.isMoving = isMoving
    this.animTime += dt

    // Smooth rotation interpolation
    let rotDiff = this.targetRotationY - this.currentRotationY
    // Wrap to [-PI, PI]
    while (rotDiff > Math.PI) rotDiff -= Math.PI * 2
    while (rotDiff < -Math.PI) rotDiff += Math.PI * 2
    this.currentRotationY += rotDiff * Math.min(1, dt * 10)
    this.soldiersGroup.rotation.y = this.currentRotationY

    // Animate soldiers
    if (this.isMoving) {
      // Running animation: bobbing and stride stride
      const bobFreq = 14
      for (const sm of this.soldierMeshes) {
        const phase = sm.index * 0.9
        const bob = Math.abs(Math.sin(this.animTime * bobFreq + phase)) * 0.05
        sm.group.position.y = sm.baseY + bob
        sm.group.rotation.x = Math.sin(this.animTime * bobFreq + phase) * 0.12
        sm.group.rotation.z = Math.cos(this.animTime * bobFreq + phase) * 0.06
      }
    } else {
      // Idle animation: subtle breathing
      const idleFreq = 2.5
      for (const sm of this.soldierMeshes) {
        const phase = sm.index * 0.7
        const bob = Math.sin(this.animTime * idleFreq + phase) * 0.012
        sm.group.position.y = sm.baseY + bob
        sm.group.rotation.x = 0
        sm.group.rotation.z = 0
      }
    }

    // Selection ring pulse when selected
    if (this.isSelected && this.selectionRing) {
      const pulse = 1.0 + Math.sin(this.animTime * 4) * 0.04
      this.selectionRing.scale.set(pulse, pulse, pulse)
    }
  }

  /**
   * Dispose visual meshes, geometries, and materials
   */
  dispose() {
    if (this.group.parent) {
      this.group.parent.remove(this.group)
    }
    for (const g of this.geometries) {
      g.dispose?.()
    }
    for (const m of this.materials) {
      m.dispose?.()
    }
    this.soldierMeshes = []
    this.geometries = []
    this.materials = []
  }
}
