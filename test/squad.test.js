import test from 'node:test'
import assert from 'node:assert/strict'
import { IslandData, HexCell } from '../src/world/IslandData.js'
import { NavigationGrid } from '../src/navigation/NavigationGrid.js'
import { Pathfinder } from '../src/navigation/Pathfinder.js'
import { Squad, SquadState } from '../src/gameplay/Squad.js'
import { findDeterministicSpawnCell } from '../src/gameplay/SpawnSelector.js'
import { getCellWorldPosition } from '../src/render/WorldPosition.js'

function createSampleIsland() {
  const island = new IslandData({ seed: 42, radius: 2 })

  // Center flat grass cell (0, 0, 0)
  const center = island.addCell({ q: 0, r: 0, s: 0, type: 0, level: 0, rotation: 0 })

  // Neighbors
  const ne = island.addCell({ q: 1, r: -1, s: 0, type: 0, level: 0, rotation: 0 }) // GRASS
  const e  = island.addCell({ q: 1, r: 0, s: -1, type: 26, level: 0, rotation: 0 }) // ROAD_A
  const se = island.addCell({ q: 0, r: 1, s: -1, type: 0, level: 0, rotation: 0 }) // GRASS
  const sw = island.addCell({ q: -1, r: 1, s: 0, type: 1, level: 0, rotation: 0 }) // WATER
  const w  = island.addCell({ q: -1, r: 0, s: 1, type: 0, level: 0, rotation: 0 }) // GRASS
  const nw = island.addCell({ q: 0, r: -1, s: 1, type: 0, level: 0, rotation: 0 }) // GRASS

  // Elevated cell (2, -1, -1) with slope at (2, 0, -2)
  const highGrass = island.addCell({ q: 2, r: -1, s: -1, type: 0, level: 1, rotation: 0 })

  return { island, center, ne, e, se, sw, w, nw, highGrass }
}

test('Squad Domain Entity', async (t) => {
  await t.test('initializes with idle state and authoritative cell', () => {
    const { center } = createSampleIsland()
    const squad = new Squad({ id: 'squad-1', team: 'player', cell: center })

    assert.equal(squad.id, 'squad-1')
    assert.equal(squad.team, 'player')
    assert.equal(squad.cell, center)
    assert.equal(squad.state, SquadState.IDLE)
    assert.equal(squad.destinationCell, null)
    assert.equal(squad.path.length, 0)
  })

  await t.test('setPath sets moving state and destination cell', () => {
    const { center, ne, e } = createSampleIsland()
    const squad = new Squad({ cell: center })

    squad.setPath([center, ne, e])
    assert.equal(squad.state, SquadState.MOVING)
    assert.equal(squad.destinationCell, e)
    assert.equal(squad.path.length, 3)
    assert.equal(squad.currentPathIndex, 0)
    assert.equal(squad.segmentProgress, 0)
  })

  await t.test('advanceToNextNode progresses authoritative cell and terminates at goal', () => {
    const { center, ne, e } = createSampleIsland()
    const squad = new Squad({ cell: center })

    squad.setPath([center, ne, e])

    // Advance to node 1 (ne)
    const hasMore = squad.advanceToNextNode()
    assert.equal(hasMore, true)
    assert.equal(squad.cell, ne)
    assert.equal(squad.currentPathIndex, 1)
    assert.equal(squad.state, SquadState.MOVING)

    // Advance to destination (e)
    const finished = squad.advanceToNextNode()
    assert.equal(finished, false)
    assert.equal(squad.cell, e)
    assert.equal(squad.state, SquadState.IDLE)
    assert.equal(squad.destinationCell, null)
  })

  await t.test('stop halts movement immediately', () => {
    const { center, ne, e } = createSampleIsland()
    const squad = new Squad({ cell: center })

    squad.setPath([center, ne, e])
    squad.stop()

    assert.equal(squad.state, SquadState.IDLE)
    assert.equal(squad.path.length, 0)
    assert.equal(squad.destinationCell, null)
  })
})

test('Deterministic Spawn Selector', async (t) => {
  await t.test('picks central walkable cell with high connectivity', () => {
    const { island, center } = createSampleIsland()
    const navGrid = new NavigationGrid(island)

    const spawnCell = findDeterministicSpawnCell(island, navGrid)
    assert.ok(spawnCell)
    assert.equal(spawnCell.isWalkable, true)
    assert.equal(spawnCell.key, center.key)
  })

  await t.test('returns strictly identical result on multiple runs for same island', () => {
    const { island } = createSampleIsland()
    const navGrid = new NavigationGrid(island)

    const spawn1 = findDeterministicSpawnCell(island, navGrid)
    const spawn2 = findDeterministicSpawnCell(island, navGrid)
    assert.equal(spawn1.key, spawn2.key)
  })
})

test('World Position Conversion Seam', async (t) => {
  await t.test('calculates correct world position and surface elevation for flat cell', () => {
    const cell = new HexCell({ q: 0, r: 0, s: 0, type: 0, level: 0, rotation: 0 })
    const pos = getCellWorldPosition(cell)

    assert.equal(typeof pos.x, 'number')
    assert.equal(typeof pos.y, 'number')
    assert.equal(typeof pos.z, 'number')
    assert.equal(pos.y, 1.0) // Level 0 ground surface at Y=1.0
  })

  await t.test('calculates higher elevation for elevated cells', () => {
    const cell0 = new HexCell({ q: 0, r: 0, s: 0, type: 0, level: 0, rotation: 0 })
    const cell1 = new HexCell({ q: 0, r: 0, s: 0, type: 0, level: 1, rotation: 0 })

    const pos0 = getCellWorldPosition(cell0)
    const pos1 = getCellWorldPosition(cell1)

    assert.equal(pos1.y, pos0.y + 0.5) // LEVEL_HEIGHT = 0.5
  })
})
