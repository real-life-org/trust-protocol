// fixtures — test states and helper modules for ./testing (lib Stage 2, PR 2).
//
// sampleState() is a populated, valid HolderState for view tests: it
// passes the codec, but it is assembled by hand, not by acts, and its
// keys and anchors are placeholders, not derivations. The real test-state
// builder (stateBuilder) arrives in PR 4. openPromptModule stands in for
// the domain modules that open prompts in later PRs.
import { CODEC } from './codec.js'
import type { HolderModule } from './engine.js'
import { emptyState } from './state.js'
import type { HolderState, Prompt, PromptKind, Tuple } from './state.js'

const T = Date.parse('2026-10-14T09:00:00Z')

// placeholder key material: strings of the right family, no keys behind them
const KA_ALICE = 'z6LSaliceAliceAliceAliceAliceAliceAliceAliceAlic'
const KA_BOB = 'z6LSbobBobBobBobBobBobBobBobBobBobBobBobBobBobBob'
const OWN_ALICE = 'z6LSownAliceOwnAliceOwnAliceOwnAliceOwnAliceOwnA'
const OWN_BOB_1 = 'z6LSownBobOneOwnBobOneOwnBobOneOwnBobOneOwnBobOn'
const OWN_BOB_2 = 'z6LSownBobTwoOwnBobTwoOwnBobTwoOwnBobTwoOwnBobTw'
const ALICE_PAIR = 'did:key:z6MkalicePairAlicePairAlicePairAlicePairAli'
const BOB_PAIR_1 = 'did:key:z6MkbobPairOneBobPairOneBobPairOneBobPairOn'
const BOB_PAIR_2 = 'did:key:z6MkbobPairTwoBobPairTwoBobPairTwoBobPairTw'
const ALICE_ANCHOR = 'did:key:z6MkaliceAnchorAliceAnchorAliceAnchorAliceA'
const BOB_ANCHOR_0 = 'did:key:z6MkbobAnchorZeroBobAnchorZeroBobAnchorZero'
const BOB_ANCHOR_1 = 'did:key:z6MkbobAnchorOneBobAnchorOneBobAnchorOneBo'
const OWN_ANCHOR = 'did:key:z6MkownAnchorOwnAnchorOwnAnchorOwnAnchorOw'

const seqOut = () => ({ lastSalt: '0', exhausted: false, hwm: '0', snapshot: null, snapshotDigest: null, inflight: {} })
const seqIn = () => ({ hwm: '0', lowerBound: '0', assembly: null, accepted: null })

interface TupleSpec {
  label: string
  counterpartAnchor: string
  counterpartKeyAgreement: string
  rkid: string
  entryId: string
  /** the counterpart's community anchor its verified mapping carries */
  self?: string
  issued?: boolean
  profile?: { rev: string, name: string, text?: string }
}

const tuple = (t: TupleSpec): Tuple => ({
  ownPairLabel: t.label,
  counterpartAnchor: t.counterpartAnchor,
  counterpartKeyAgreement: t.counterpartKeyAgreement,
  rkid: t.rkid,
  entryId: t.entryId,
  priorCandidates: [],
  starOut: seqOut(),
  starIn: seqIn(),
  groupStarOut: seqOut(),
  groupStarIn: seqIn(),
  probeOut: { seq: '0', inflight: {}, done: false },
  probeIn: { hwm: '0', lowerBound: '0', assembly: null },
  continuityOut: { rev: '0', body: null, proof: null, sent: [], chosen: null, reported: null, aligned: false, due: null },
  continuityIn: { rev: '0', body: null, recordPrior: null },
  mappingOut: t.issued
    ? { rev: '1', body: { type: 'anchor-mapping@4', placeholder: true }, underAnchor: OWN_ANCHOR }
    : { rev: '0', body: null, underAnchor: null },
  mappingIn: t.self
    ? { rev: '1', body: { type: 'anchor-mapping@4', placeholder: true }, self: t.self, card: { type: 'self-card@2', anchor: t.self } }
    : { rev: '0', body: null, self: null, card: null },
  profileIn: t.profile
    ? { rev: t.profile.rev, body: { type: 'profile@1', revision: t.profile.rev, name: t.profile.name, ...(t.profile.text ? { text: t.profile.text } : {}) }, verifiedSeq: '4' }
    : { rev: '0', body: null, verifiedSeq: '0' },
  deactivated: false,
})

/**
 * A populated, valid HolderState, fresh on every call:
 *   - c-alice: met in a ceremony, trusted (anchor mapping on), mappings
 *     both ways, a verified profile
 *   - c-bob: introduced via c-alice, an alias e-bob-old, two relationships
 *     of which r-bob-2 lags (its anchor head is a superseded prev on
 *     r-bob-1), trusted and paused (star and group star off)
 *   - one group g-garden, the own profile (revision 3), one accepted
 *     outbox item to c-alice, one group-invite prompt
 */
export function sampleState (): HolderState {
  const s = emptyState(CODEC)
  s.commitSeq = '12'
  s.lastWhen = T + 60_000
  s.register.labels = ['pair/alice', 'pair/bob-1', 'pair/bob-2']
  s.register.pairNonces = { 'pair/alice': 'AAAA', 'pair/bob-1': 'BBBB', 'pair/bob-2': 'CCCC' }
  s.register.community = { genesis: 'uCommunityGenesis', head: '1' }
  s.addresses.keys = {
    [OWN_ALICE]: { label: 'pair/alice', lastShown: T },
    [OWN_BOB_1]: { label: 'pair/bob-1', lastShown: T },
    [OWN_BOB_2]: { label: 'pair/bob-2', lastShown: T },
  }
  const settings = { star: 'default', groupStar: 'default', anchorMapping: 'on', sealedGroupStar: 'default', profile: 'default' } as const
  s.contacts = {
    'c-alice': { id: 'c-alice', pos: '0', status: 'admitted', aliases: [], relIds: ['r-alice'], anchorHead: ALICE_ANCHOR, settings: { ...settings }, groupSettings: {} },
    'c-bob': {
      id: 'c-bob', pos: '1', status: 'admitted', aliases: ['e-bob-old'], relIds: ['r-bob-1', 'r-bob-2'], anchorHead: BOB_ANCHOR_1,
      settings: { ...settings, star: 'off', groupStar: 'off' }, groupSettings: { 'g-garden': 'off' },
    },
  }
  const rel = (id: string, contactId: string, tuples: Tuple[], extra: Partial<HolderState['relationships'][string]> = {}) => ({
    id, contactId, tuples, activeHead: tuples[tuples.length - 1].ownPairLabel, earliestAnchor: OWN_ANCHOR,
    links: [], bindings: {}, heldCounterpartHead: null, memory: {}, provenance: { kind: 'ceremony' as const, at: T }, chainedInto: null, firstVerified: null,
    ...extra,
  })
  s.relationships = {
    'r-alice': rel('r-alice', 'c-alice', [tuple({
      label: 'pair/alice', counterpartAnchor: ALICE_PAIR, counterpartKeyAgreement: KA_ALICE, rkid: OWN_ALICE, entryId: 'c-alice',
      self: ALICE_ANCHOR, issued: true, profile: { rev: '2', name: 'Alice', text: 'hello' },
    })], { heldCounterpartHead: ALICE_ANCHOR }),
    'r-bob-1': rel('r-bob-1', 'c-bob', [tuple({
      label: 'pair/bob-1', counterpartAnchor: BOB_PAIR_1, counterpartKeyAgreement: KA_BOB, rkid: OWN_BOB_1, entryId: 'c-bob',
      self: BOB_ANCHOR_1, issued: true,
    })], {
      heldCounterpartHead: BOB_ANCHOR_1,
      links: [{ prev: BOB_ANCHOR_0, next: BOB_ANCHOR_1 }],
      provenance: { kind: 'introduced', via: 'c-alice', at: T + 1000 },
    }),
    'r-bob-2': rel('r-bob-2', 'c-bob', [tuple({
      label: 'pair/bob-2', counterpartAnchor: BOB_PAIR_2, counterpartKeyAgreement: KA_BOB, rkid: OWN_BOB_2, entryId: 'c-bob',
      self: BOB_ANCHOR_0, issued: true,
    })], { heldCounterpartHead: BOB_ANCHOR_0, provenance: { kind: 'ceremony', at: T + 2000 } }),
  }
  s.entryOrder = { nextPos: '2', heads: ['r-alice', 'r-bob-1', 'r-bob-2'] }
  s.groups = {
    'g-garden': { id: 'g-garden', memberLabel: 'group/g-garden', rules: { vouchThreshold: '2' }, listed: true, membership: null, memberAnchor: 'did:key:z6MkGardenMemberSampleOnly', memberOp: 'oid:garden-admission-sample' },
  }
  s.profile = { body: { name: 'Me', text: 'about me' }, revision: '3' }
  s.outbox = {
    uDocAlice1: {
      type: 'https://real-life.org/trust-tasks/profile/0.1',
      threadId: 'thread-alice-1',
      recipient: { contactId: 'c-alice', rkid: OWN_ALICE, keyAgreement: KA_ALICE },
      envelope: { rkid: KA_ALICE, epk: 'epk', nonce: 'nonce', ciphertext: 'ciphertext' },
      attempt: 1,
      history: [{ status: 'submitted', at: T + 10_000, attempt: 1 }, { status: 'accepted', at: T + 11_000 }],
    },
  }
  s.prompts = {
    'p-invite': { id: 'p-invite', kind: 'group-invite', contactId: 'c-alice', groupId: 'g-garden', openedAt: T + 20_000, expiresAt: T + 86_400_000 },
  }
  return s
}

/** The command of openPromptModule. */
export const OPEN_PROMPT = 'test.prompt.open'

/** Input of OPEN_PROMPT: the prompt without openedAt, which is `when`. */
export interface OpenPromptInput { id: string, kind: PromptKind, contactId?: string, groupId?: string, expiresAt?: number }

/**
 * A module for tests: its non-human command OPEN_PROMPT opens a prompt
 * the way a domain module will, and announces prompt.opened. An id that
 * is already open is a programming error and throws.
 */
export const openPromptModule: HolderModule = Object.freeze({
  name: 'test-prompts',
  commands: Object.freeze({
    [OPEN_PROMPT]: {
      human: false,
      apply (state: Readonly<HolderState>, _p: unknown, input: OpenPromptInput, when: number) {
        if (Object.hasOwn(state.prompts, input.id)) throw new Error(`${OPEN_PROMPT}: prompt ${input.id} is already open`)
        const p: Prompt = {
          id: input.id, kind: input.kind, openedAt: when,
          ...(input.contactId !== undefined ? { contactId: input.contactId } : {}),
          ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
          ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        }
        return {
          state: { ...state, prompts: { ...state.prompts, [p.id]: p } },
          events: [{ type: 'prompt.opened' as const, promptId: p.id, kind: p.kind }],
        }
      },
    },
  }),
})
