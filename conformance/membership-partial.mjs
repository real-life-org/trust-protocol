// Rules of Membership Tasks 0.17 that the vectors check only in part: a
// case or check names such a rule in `rulesPartial` with the obligation
// that stays unchecked, never in `rules`. Only `rules` counts as coverage
// (RLTP-MT-10080); the specification lists these rules as partially
// checked in Section 10.3. Shared by scripts/gen-membership-tasks-vector.mjs
// and conformance/runner.mjs so both split a rule list the same way.
export const PARTIAL = {
  'RLTP-MT-2110': 'the Encounter 2.3 profile is checked through DI proofs, did:key decoding, canonical signatures and decoded-digest equality on the vector artifacts; its timestamp profile is not tested negatively on them',
  'RLTP-MT-2120': 'duplicate-known only after a completed effect, and the stage order of Contract 6.2, need a receiver with state',
  'RLTP-MT-2180': 'consumption and idempotency keyed by the credential digest are materialization and store behaviour',
  'RLTP-MT-2240': 'no schema-valid linear/0.1 welcome reaches the bound, so the rejection of an oversized welcome is not vectored',
  'RLTP-MT-3010': 'conformance to DTGWG Core Credentials WD01 is checked through the schema only',
  'RLTP-MT-3020': 'that the issuer is a member anchor of the group is checked positively against the genesis; a non-member issuer is rejected at materialization',
  'RLTP-MT-3035': 'an invite naming another group DID than the genesis is rejected at bootstrap against the fetched genesis',
  'RLTP-MT-3040': 'a fetched genesis that differs from the pinned digest is a bootstrap scenario with state',
  'RLTP-MT-3055': 'that validFrom is the issuance time, and the retention validUntil bounds, are sender behaviour',
  'RLTP-MT-3075': 'freshness of the opening threadId is a sender property',
  'RLTP-MT-3200': 'validity of the enclosed accept beyond schema and the invitee\'s own-accept check is judged at materialization',
  'RLTP-MT-3205': 'non-conformance of issuing a member.add without a valid accept is judged at materialization',
  'RLTP-MT-3245': 'card ownership at materialization is not vectored here',
  'RLTP-MT-3355': 'the cap of 2048 JCS bytes per credential and the ban on a merged proof are prose; no schema-valid vouch reaches the cap',
  'RLTP-MT-3815': 'that a sender issues membership-evidence/0.2 is sender behaviour',
}
export const splitRules = (ids) => {
  const rules = []; const rulesPartial = {}
  for (const id of ids) { if (PARTIAL[id]) rulesPartial[id] = PARTIAL[id]; else rules.push(id) }
  return { rules, rulesPartial }
}
