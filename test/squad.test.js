import test from 'node:test'
import assert from 'node:assert/strict'
import { IslandData, HexCell } from '../src/world/IslandData.js'
import { TileType } from '../src/hexmap/HexTileData.js'
import { NavigationGrid } from '../src/navigation/NavigationGrid.js'
import { Pathfinder } from '../src/navigation/Pathfinder.js'
import { Squad, SquadState } from '../src/gameplay/Squad.js'
import { findDeterministicSpawnCell } from '../src/gameplay/SpawnSelector.js'
import { getCellWorldPosition } from '../src/render/WorldPosition.js'

function createSampleIsland() {
  const island = new IslandData({ seed: 42, radius: 2 })

  // Center flat grass cell (0, 0, 0)
  const center = island.addCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0, rotation: 0 })

  // Neighbors
  const ne = island.addCell({ q: 1, r: -1, s: 0, type: TileType.GRASS, level: 0, rotation: 0 })
  const e  = island.addCell({ q: 1, r: 0, s: -1, type: TileType.ROAD_A, level: 0, rotation: 0 })
  const se = island.addCell({ q: 0, r: 1, s: -1, type: TileType.GRASS, level: 0, rotation: 0 })
  const sw = island.addCell({ q: -1, r: 1, s: 0, type: TileType.WATER, level: 0, rotation: 0 })
  const w  = island.addCell({ q: -1, r: 0, s: 1, type: TileType.GRASS, level: 0, rotation: 0 })
  const nw = island.addCell({ q: 0, r: -1, s: 1, type: TileType.GRASS, level: 0, rotation: 0 })

  // Outer cells for extended paths
  const farNE = island.addCell({ q: 2, r: -2, s: 0, type: TileType.GRASS, level: 0, rotation: 0 })
  const farE  = island.addCell({ q: 2, r: -1, s: -1, type: TileType.GRASS, level: 0, rotation: 0 })
  const farSE = island.addCell({ q: 1, r: 1, s: -2, type: TileType.GRASS, level: 0, rotation: 0 })

  // Elevated cell (2, 0, -2) with level 1
  const highGrass = island.addCell({ q: 0, r: 2, s: -2, type: TileType.GRASS, level: 1, rotation: 0 })

  return { island, center, ne, e, se, sw, w, nw, farNE, farE, farSE, highGrass }
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
    assert.equal(squad.pendingDestinationCell, null)
    assert.equal(squad.pendingPath, null)
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
    assert.equal(squad.isMovingSegment(), true)
    assert.deepEqual(squad.getCurrentSegment(), { fromCell: center, toCell: ne })
    assert.equal(squad.getNextCell(), ne)
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
    assert.equal(squad.path.length, 0)
  })

  await t.test('stop halts movement immediately and clears pending routes', () => {
    const { center, ne, e } = createSampleIsland()
    const squad = new Squad({ cell: center })

    squad.setPath([center, ne, e])
    squad.setPendingDestination(e, [ne, e])
    squad.stop()

    assert.equal(squad.state, SquadState.IDLE)
    assert.equal(squad.path.length, 0)
    assert.equal(squad.destinationCell, null)
    assert.equal(squad.pendingDestinationCell, null)
    assert.equal(squad.pendingPath, null)
  })
})

test('Squad Mid-Movement Rerouting Semantics', async (t) => {
  await t.test('preserves active segment progress and authoritative cell during reroute request', () => {
    const { island, center, ne, farNE, e } = createSampleIsland()
    const navGrid = new NavigationGrid(island)
    const pathfinder = new Pathfinder(navGrid)

    const squad = new Squad({ cell: center })
    // Active path: center (A) -> ne (B) -> farNE (C)
    squad.setPath([center, ne, farNE])

    // Simulate traveling half-way along A -> B
    squad.segmentProgress = 0.55
    assert.equal(squad.cell, center) // Authoritative cell is STILL center (A)
    assert.equal(squad.getNextCell(), ne) // Next target node is ne (B)

    // Mid-movement reroute to e (D)
    const pathFromB = pathfinder.findPath(ne, e)
    assert.ok(pathFromB && pathFromB.length > 1)

    squad.setPendingDestination(e, pathFromB)

    // Verify domain state during in-flight segment:
    assert.equal(squad.cell, center, 'Authoritative cell must remain last reached cell A')
    assert.equal(squad.segmentProgress, 0.55, 'Segment progress must NOT be reset to 0')
    assert.equal(squad.destinationCell, e, 'Destination cell updates to target D')
    assert.equal(squad.pendingDestinationCell, e, 'Pending destination is stored')
    assert.equal(squad.pendingPath, pathFromB, 'Pending path from B is stored')
    assert.equal(squad.state, SquadState.MOVING)
  })

  await t.test('newest pending destination replaces older pending destination without snapping', () => {
    const { island, center, ne, farNE, e, se } = createSampleIsland()
    const navGrid = new NavigationGrid(island)
    const pathfinder = new Pathfinder(navGrid)

    const squad = new Squad({ cell: center })
    squad.setPath([center, ne, farNE])
    squad.segmentProgress = 0.3

    // First reroute to e
    const pathToE = pathfinder.findPath(ne, e)
    squad.setPendingDestination(e, pathToE)
    assert.equal(squad.pendingDestinationCell, e)

    // Newer reroute to se replaces e
    const pathToSE = pathfinder.findPath(ne, se)
    squad.setPendingDestination(se, pathToSE)

    assert.equal(squad.pendingDestinationCell, se, 'Newest destination must replace older pending destination')
    assert.equal(squad.pendingPath, pathToSE)
    assert.equal(squad.segmentProgress, 0.3, 'Segment progress must remain untouched')
    assert.equal(squad.cell, center, 'Authoritative cell remains center')
  })

  await t.test('seamlessly transitions to new path once B is reached', () => {
    const { island, center, ne, farNE, e } = createSampleIsland()
    const navGrid = new NavigationGrid(island)
    const pathfinder = new Pathfinder(navGrid)

    const squad = new Squad({ cell: center })
    squad.setPath([center, ne, farNE])
    squad.segmentProgress = 0.8

    const pathToE = pathfinder.findPath(ne, e) // [ne, center, e] or direct if connected
    squad.setPendingDestination(e, pathToE)

    // Complete the segment into node B (ne)
    squad.segmentProgress = 1.0
    const hasMore = squad.advanceToNextNode()

    assert.equal(hasMore, true, 'Movement must continue on new path')
    assert.equal(squad.cell, ne, 'Authoritative cell becomes B upon arrival')
    assert.equal(squad.segmentProgress, 0, 'New segment starts at progress 0')
    assert.deepEqual(squad.path, pathToE, 'Path becomes the rerouted path from B')
    assert.equal(squad.pendingDestinationCell, null, 'Pending destination cleared after application')
    assert.equal(squad.pendingPath, null, 'Pending path cleared after application')
    assert.equal(squad.destinationCell, e)
  })

  await t.test('truncates path cleanly when player clicks the immediate upcoming node', () => {
    const { center, ne, farNE } = createSampleIsland()
    const squad = new Squad({ cell: center })
    squad.setPath([center, ne, farNE])
    squad.segmentProgress = 0.4

    // Player clicks ne (immediate next node)
    squad.truncatePathAtNextNode()

    assert.deepEqual(squad.path, [center, ne])
    assert.equal(squad.destinationCell, ne)
    assert.equal(squad.segmentProgress, 0.4)
    assert.equal(squad.cell, center)

    // Reaching ne terminates path cleanly
    squad.segmentProgress = 1.0
    const hasMore = squad.advanceToNextNode()
    assert.equal(hasMore, false)
    assert.equal(squad.cell, ne)
    assert.equal(squad.state, SquadState.IDLE)
  })

  await t.test('rejects stale or foreign pending path cleanly upon arrival', () => {
    const { center, ne, farNE, w } = createSampleIsland()
    const foreignCell = new HexCell({ q: 99, r: -99, s: 0, type: TileType.GRASS, level: 0 })

    const squad = new Squad({ cell: center })
    squad.setPath([center, ne, farNE])

    // Malformed/foreign pending path that does not start at ne
    squad.setPendingDestination(w, [foreignCell, w])

    squad.segmentProgress = 1.0
    const hasMore = squad.advanceToNextNode()

    // Since pending path start (foreignCell) did not match reached node (ne), pending path was dropped
    assert.equal(squad.pendingPath, null)
    assert.equal(squad.pendingDestinationCell, null)
    assert.equal(squad.cell, ne)
    assert.equal(hasMore, true) // Continues previous path [center, ne, farNE] to farNE
    assert.equal(squad.path[squad.currentPathIndex + 1], farNE)
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
    const cell = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0, rotation: 0 })
    const pos = getCellWorldPosition(cell)

    assert.equal(typeof pos.x, 'number')
    assert.equal(typeof pos.y, 'number')
    assert.equal(typeof pos.z, 'number')
    assert.equal(pos.y, 1.0) // Level 0 ground surface at Y=1.0
  })

  await t.test('calculates higher elevation for elevated cells', () => {
    const cell0 = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 0, rotation: 0 })
    const cell1 = new HexCell({ q: 0, r: 0, s: 0, type: TileType.GRASS, level: 1, rotation: 0 })

    const pos0 = getCellWorldPosition(cell0)
    const pos1 = getCellWorldPosition(cell1)

    assert.equal(pos1.y, pos0.y + 0.5) // LEVEL_HEIGHT = 0.5
  })
})
