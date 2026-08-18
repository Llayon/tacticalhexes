/**
 * TerrainArchetype - Macro terrain layout archetypes for tactical island generation.
 * Pure JavaScript domain models — decoupled from Three.js, DOM, and Telegram.
 */

export const TerrainArchetype = {
  FORTRESS: 'FORTRESS',           // Dominant massive high plateau, lower surrounding ground, 1-2 access ramps
  HIGH_CORNER: 'HIGH_CORNER',     // High plateau strongly biased to one flank/corner, broad opposite lowlands
  TWIN_PLATEAUS: 'TWIN_PLATEAUS', // Two separated elevated areas with valley/saddle between them
  RIDGE: 'RIDGE',                 // Elongated elevated spine crossing part of island
  TERRACES: 'TERRACES',           // Two large major elevation bands (broad L1 lowland + large L2/L3 plateau)
  BASIN: 'BASIN',                 // High horseshoe/crescent enclosing a lower open basin/bay
}

export const ARCHETYPE_LIST = Object.values(TerrainArchetype)
