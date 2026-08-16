# Hexmap WFC Notes

## WFC (Wave Function Collapse) Implementation

### Core Algorithm
1. Initialization: All cells start with ALL possible states (tile × 6 rotations × levels)
2. Collapse: Pick cell with lowest entropy (log(possibilities) + noise), randomly select weighted state
3. Propagate: Remove incompatible states from neighbors via edge matching
4. Repeat: Until all cells collapsed or conflict detected
5. Recovery: On conflict, backtrack (undo decisions and try alternative states)

### Edge Matching System
Each tile defines 6 edges (NE, E, SE, SW, W, NW) with types: `grass | road | river | ocean | coast`. Adjacent edges must match type AND level (except grass which allows any level). Slopes have `highEdges` array — edges facing uphill have `baseLevel + levelIncrement`.

All solved tiles are stored in a global `Map<cubeKey, cell>` (`HexMap.globalCells`). When expanding to a new grid, boundary matching uses **neighbor cells** — solved tiles from adjacent grids that border the solve region (1 cell out). Each has **anchors** — its own neighbors (2 cells out).

### Backtracking
Trail-based delta backtracking (no full state copies):
- **Trail**: Array of `{ key, stateKey }` — records each possibility removed during propagation
- **Decision stack**: Each entry stores the collapsed cell, its previous possibilities, trail position, and tried states
- On conflict: `undoLastDecision()` rewinds the trail, restores the cell, then retries with an excluded state
- If all states exhausted for a cell, pops the decision and backtracks further up the stack
- `maxBacktracks = 500`

### WFC Recovery

Each grid solve has two levels: an inner **solve loop** that handles simple failures, and an outer **recovery loop** that restructures the problem when the solve loop can't fix it.

#### Solve Loop
Retries the WFC up to `maxTries` times (2 for Grid-WFC, 5 for Local-WFC/Rebuild-WFC/Build All):
1. Propagate from neighbor cells to constrain solve cells
2. If a **neighbor conflict** occurs, try **unfixing** — convert the problem neighbor into a solve cell, using its anchors (2 cells out) as constraints. This is the most common recovery mechanism and handles the vast majority of cross-grid conflicts.
3. If propagation succeeds, run WFC with backtracking
4. If WFC fails, retry from step 1. If all tries exhausted → fail.

#### Recovery Loop
Wraps the solve loop with escalating strategies when the solve loop fails entirely:
1. Run the solve loop. If it succeeds, done.
2. **Local-WFC** (max 5 attempts) — re-solve a radius-2 region (~19 cells) around a neighbor cell to create a more compatible boundary, then retry the solve loop.
   - First attempt targets the neighbor cell that caused the conflict
   - Subsequent attempts target the nearest untried neighbor cell to the failure point
   - If Local-WFC itself fails, skip to next candidate
3. **Drop phase** (last resort) — drop neighbor cells one by one nearest the failure point, placing mountains to hide mismatches, retrying the solve loop after each drop. In practice this never fires — unfixing and Local-WFC handle all cases across 50-run benchmarks.

### Build All
`populateAllGrids()` creates all 19 grids upfront, collects all cells, and runs a single WFC pass with zero neighbor cells. No constraints or fallbacks needed — just one big solve relying on backtracking.

## Seeded RNG

`SeededRandom.js` exposes `setSeed(n)` and `random()`. A single seed is set once at startup in `Demo.js`. After that, every call to `random()` returns the next number in the deterministic sequence — there is no re-seeding.

The WFC worker runs in a separate thread with its own copy of `SeededRandom.js` (Web Workers have independent module scope). The seed is passed to the worker once via `{ type: 'init', seed }` message in `initWfcWorker()`. After that, the worker's RNG advances naturally across all solves.

**Never re-seed the worker per solve** — that resets the sequence to position 0 and causes identical random choices across solves, making retries and Rebuild-WFC produce the same output.

## Naming Conventions

### Hex Grid
- HexMap — The entire world, manages multiple Grids (`src/HexMap.js`)
- HexGrid — A hexagonal grid of hex cells, one WFC solve = one Grid (`src/HexGrid.js`)
- GridHelper — Visual overlay (lines + dots) for a grid (`src/HexGridHelper.js`)
- Placeholder — Clickable hexagonal button to expand into adjacent grid slot (`src/Placeholder.js`)
- Cell — A position in the grid that can hold a Tile
- Tile — The actual mesh placed in a Cell (`src/HexTiles.js`)
- RNG Seed — The number that initializes the random number generator (global)

### WFC
- Grid-WFC — WFC solve for a single grid (click to expand a placeholder). Has neighbor cells and full recovery.
- Local-WFC — Mini-WFC solve on a radius-2 region around a neighbor cell during recovery.
- Rebuild-WFC — Mini-WFC solve on a radius-2 region triggered by clicking a tile in Rebuild mode.
- Build All — Single WFC solve for all 19 grids at once. No neighbor cells or recovery.
- Auto Build — Builds all grids sequentially, each as a separate Grid-WFC.
- Neighbor Cell — Solved tile from an adjacent grid that borders the solve region (1 cell out). Used as a constraint during WFC. Can be unfixed if it causes a conflict.
- Anchor — Neighbor of a neighbor cell (2 cells out). Becomes a constraint when the neighbor cell is unfixed.
- Propagation — After a cell is collapsed, remove incompatible states from its neighbors. Cascades outward until no more states can be removed.
- Unfixing — Convert a problem neighbor cell from a constraint into a solve cell, with its anchors as new constraints.
- Neighbor Conflict — Neighbor cells' edges are incompatible, detected before WFC starts.
- Solve Conflict — WFC ran out of backtracks during the collapse loop.

## Map Dimensions

The hex map is 19 grids arranged in 2 rings around a central grid (hex radius 2).

Each grid is a hex with cell radius 8 → diameter 17 cells → **217 cells per grid**.
Total: 19 × 217 = **4,123 cells** (minus shared boundary cells used as neighbor constraints).

Grid centers are spaced 17 cells apart in cube coords (2R+1). Max cell distance from map center: grid ring 2 center (34) + cell radius (8) = **42 cells** hex radius.

### World Units
- `HEX_WIDTH` = 2, `HEX_HEIGHT` = 2/√3 × 2 ≈ 2.309
- Map is hexagonal — radius ≈ 42 × 2 ≈ **84 WU** from center to edge

### Tile Surface Heights
- Land (grass, road, cliff): **1.0 WU** above tile base
- River / Coast: **0.9 WU** above tile base
- Ocean (WATER): **0.8 WU** above tile base

## Coordinate Systems

### Blender (Z-up)
- +X = East, +Y = North, +Z = Up

### Three.js / App (Y-up)
- +X = East, +Y = Up, +Z = South (-Z = North)

### glTF Export Transform ("+Y Up" checked)
| Blender | Three.js |
|---------|----------|
| +X | +X (East) |
| +Y | -Z (North) |
| +Z | +Y (Up) |

### Hex Orientation
- Cells/Tiles: Pointy-top (pointy vertices face ±Z North/South, flat edges face ±X East/West)
- HexGrids: Flat-top (flat edges face ±Z North/South, pointy vertices face ±X East/West)

### Hex Coordinate Systems

Cube/Axial Coordinates (q, r, s where s = -q-r) — PRIMARY
- Used for: WFC solver, global cell map, cross-grid references, distance/neighbor calculations
- Hex distance = max(|q|, |r|, |s|)
- Neighbors: addition via CUBE_DIRS (no row parity needed)

Offset Coordinates (col, row)
- Used for: rendering positions, local grid tile placement
- Row parity affects neighbor calculations

Conversion (pointy-top odd-row offset):
- Offset → Axial: `q = col - floor(row/2)`, `r = row`
- Axial → Offset: `col = q + floor(r/2)`, `row = r`

### Scale
- Blender: Tiles are 2m on X, 2.31m on Y, 1m on Z
- App: 1:1 scale, hex tile is 2 WU wide on X axis

## Debug Label Colors
- Purple = Neighbor conflict (0 possibilities during initial propagation from neighbor cells)
- Orange = Replaced neighbor cell (changed during unfixing or persisted-unfixed)
- Red = Dropped neighbor cell (mountain placed to hide mismatch)
