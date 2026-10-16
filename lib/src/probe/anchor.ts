// probe/anchor — moved to the root module anchor.ts in lib Stage 2 (PR 4a),
// where the holder's trust module builds on it too. This file keeps the
// probe's names, unchanged, for probe/trust.ts and the visibility barrel;
// nothing new is exported here.
export {
  macU, signRaw, verifyRaw, bindingOf, meetsBinding, makeSelfCard, makeAnchorRotation, verifyAnchorRotation,
  LINEAGE_MAX, verifyLineage, verifyBindings, lineageAnchors, mappingAnchors, lineageLinks, mappingBindings,
  classifyMapping, buildAnchorMapping, verifyAnchorMapping,
} from '../anchor.js'
export type { MappingInput } from '../anchor.js'
