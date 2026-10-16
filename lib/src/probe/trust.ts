// trust — der GRADUIERTE Vertrauensakt auf Trust Layer 0.31 + Delivery
// 0.81: dieses Modul baut die ECHTEN Wire-Artefakte (anchor-mapping@4
// mit self-card@2 und Lineage aus anchor-rotation@2 · star@2 mit
// 5.2a-Chunks), getragen von den registrierten Task-Dokumenten
// (Delivery §4.4: anchor-mapping/0.3 · star/0.2 — Payload = das
// Artefakt, Dokument proof-frei, ein Träger), quittiert mit dem
// deniablen delivery-ack (4.2-Klassenregel). Formen und Schlüssel sind
// byte-kompatibel zu vectors/visibility.json (vectors3.test.mjs rechnet
// sie unabhängig nach).
//
// Die Rotation des Gemeinschaftsankers (Identity 0.54 §5.4, Trust 0.31
// §6.5): rotateCommunityAnchor leitet die nächste Generation ab, hält
// die Lineage und stellt jedem vertrauten Kontakt ein anchor-mapping@4
// mit höherer Revision neu aus; jede Generation trägt die Bindung
// (Pre-Rotation) an die nächste. Die Lineage beginnt je Beziehung bei
// der ersten Generation, unter der dort ein Mapping ausgestellt wurde
// (6420, 2285), sonst ist sie leer. Der Empfänger prüft die Bindungen
// gegen die, die diese Beziehung hält (6.3 Bedingung 4b), und nimmt
// einen geänderten self nur als Rotation an (Bedingung 8, 6170: die
// Lineage trägt den gehaltenen self als prev eines Glieds — der Anker
// rückt vor, Merges bleiben, Sterntests laufen gegen jede gehaltene
// Generation); ein Wechsel ohne solches Segment wird abgewiesen, ohne
// Ack und ohne Mutation. Eine per manuellem Merge eingetretene
// Beziehung, deren erstes Mapping keinen der Anker der übrigen
// Beziehungen nennt oder für einen eine andere Bindung hält, verlässt
// den Eintrag (2080: der Eintrag behält Position und Status, sie tritt
// per Promotion-Commit neu ein). Halten zwei Beziehungen für einen
// Anker verschiedene Bindungen, verschmelzen sie nicht (6605, die
// Bindungsregel); ein
// Eintrag hält so nie zwei Nachfolger eines Ankers, sein Ankerkopf ist
// immer definiert.
//
// Die Zustandsmaschinen sind die konvergierten:
//   · Admissionsschicht (Sektion 2): Promotion-Commit beim ERSTEN
//     verifizierten anchor-mapping@4 einer BEZIEHUNG (relId = die
//     Kette, der Idempotenzschlüssel); genau ein Eintrag je Beziehung,
//     self-Korrektur per höherer Revision in place; gleiche self auf
//     zweiter Beziehung = Weg-2-Merge (früheste Position überlebt,
//     Aliase); EINE totale Verifikations-Commit-Ordnung (a.seq).
//   · Rekonziliation (5.4): Sicht = {(member, Ankerkopf)} der
//     admittierten Mitglieder, ab dem Commit, der sie admittiert;
//     Baseline-Automat monoton über Ack-Completions, highWater überlebt
//     ⊥, kein Failure-Ereignis, nie Rollback.
//   · Byte-identische Redelivery (4.2): jede unquittierte Zustellung
//     wird als DASSELBE Dokument erneut gesendet (outbox hält die Envs);
//     der Empfänger re-ackt duplicate-known byte-identisch (ackStore).
// Noch nicht implementiert (Stufe 2): die Trust-Klassen (2a) als API —
// der Trust-Akt steht hier für „Mapping-Klasse an" —, profile@1 (6b),
// das Nachlaufen (6595/6596): die Sendepfade halten auf einer
// nachlaufenden Beziehung nichts zurück, auch nicht die Neuausgabe nach
// einer Rotation.
import { jcs, makeValidator, sameDigest } from '../core.js'
import { SCHEMAS } from '../schemas.js'
import * as C from './deps.js'
import type { Person } from './deps.js'
import { buildAck, verifyAck, ACK_TYPE } from './acks.js'
import { makeSelfCard, makeAnchorRotation, buildAnchorMapping, verifyAnchorMapping, classifyMapping, mappingAnchors, mappingBindings, lineageLinks, LINEAGE_MAX } from './anchor.js'
import { platformSubtle } from '../crypto.js'

const te = new TextEncoder()
const S = platformSubtle
const TT = 'https://real-life.org/trust-tasks/'
const say = (p: Person, m: string) => p.log.push(m)
const uuid = (ent?: any) => ent ?? globalThis.crypto.randomUUID()
const V = makeValidator(SCHEMAS)
const schemaOk = (file: string, data: any) => V.validate(data, SCHEMAS[file], SCHEMAS[file]).length === 0
export const ADMISSION_BOUND = 10n ** 18n - 1n  // Sektion 2 — unerreichbar, geführt für die Totalität
const CHUNK_MAX = 1024                // 5.2a: blinded[] je Chunk
// registrierte Task-Versionen (Delivery 0.81 §4.4): anchor-mapping/0.3
// trägt anchor-mapping@4, star/0.2 trägt star@2; die übrigen Tasks der
// Familie bleiben 0.1
const TASK_VERSION: Record<string, string> = { 'anchor-mapping': '0.3', 'star': '0.2' }
const taskOf = (slug: string) => slug + '/' + (TASK_VERSION[slug] ?? '0.1')

// ── Primitiven ──────────────────────────────────────────────────────────
export async function hmac (keyBytes: Uint8Array, msg: string) {
  const k = await S().importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return C.b64uOf(new Uint8Array(await S().sign('HMAC', k, te.encode(msg))))
}
export const hmacU = async (keyBytes: Uint8Array, msg: string) => 'u' + await hmac(keyBytes, msg)
/** Der Gemeinschaftsanker in seiner AKTUELLEN Generation (Identity §5.4). */
export async function communityContext (p: Person) {
  if (!p.selfCtx) p.selfCtx = await C.communityContext(p.rootIkm, p.communityGenesis, p.communityGeneration ?? 1)
  return p.selfCtx
}
export const selfCard = async (p: Person, whenIso: string) => {
  const s = await communityContext(p)
  return C.signCard(s, C.cardBody(s, { name: p.name }), whenIso)
}
/** Die Generation nach der aktuellen — ihre Bindung trägt die Karte (Identity §5.4). */
export const nextCommunityContext = (p: Person) => C.communityContext(p.rootIkm, p.communityGenesis, (p.communityGeneration ?? 1) + 1)
// self-card@2 (§6.2): { body: {type, anchor, keyAgreement, commit},
// proof: {proofValue} } — ROHE Ed25519-Signatur über JCS(body),
// 'z'+base58 (§2.1: bewusst KEINE DI-Suite; zwei Artefakt-Familien);
// commit = die Bindung an die nächste Generation
export async function selfCard2 (p: Person) {
  return makeSelfCard(await communityContext(p), await nextCommunityContext(p))
}
const chShared = (contact: any) => C.ecdh(contact.channel.own.x.priv, C.xRawOfMk(contact.channel.counterpartKa)!)
const relKey = async (contact: any, info: string) => C.hkdf(await chShared(contact), info)

// ── anchor-mapping@4 — die normative Wire-Form (§6.1–6.3) ──────────────
// body = { type, pair, self, to, card, lineage, revision, issuedAt } ·
// proof = { mac1 (Kanal-DH, info map1) · mac2 (selfX der AKTUELLEN
// Generation × pairX-Adressat, info map2) }, beide 'u'-MACs über
// JCS(body). Card und Lineage reisen IM Body (anchor.ts baut und prüft).
// der reine BAU (fehlbar, mutiert nichts) — modul-lokal: nur Aufrufer,
// die den Issue-Lock halten und selbst committen (setTrust/
// reissueTrust), erreichen ihn mit vorreservierter Revision. Der
// explizite Revisionspfad ist NICHT mehr exportiert (Review 9, B-2:
// er umging Lock, Deaktivierungs-Check und Persistenz).
// das Lineage-Segment je Beziehung (6420, 2285): ab der frühesten
// Generation, unter der auf DIESER Beziehung ein Mapping ausgestellt
// wurde (contact.mapFirstGen, Ketten-Zustand) — nie davor; eine
// Beziehung, die keine frühere Generation hielt, bekommt keine Lineage.
// p.lineage hält jede eigene Rotation in Kettenreihenfolge; ihr erstes
// Glied verlässt die Generation (aktuell − Länge).
export const lineageFor = (p: Person, firstGen: number | undefined): any[] => {
  const all = p.lineage ?? []
  const g = p.communityGeneration ?? 1
  if (firstGen === undefined || firstGen >= g) return []
  const offset = g - all.length               // die Generation, die das erste Glied verlässt
  return all.slice(Math.max(0, firstGen - offset)).slice(-LINEAGE_MAX)   // höchstens die LINEAGE_MAX jüngsten (§6.1)
}
async function buildMappingArtifact (p: Person, contact: any, counterpartAnchor: string, when: number, revision: string) {
  return buildAnchorMapping({
    pair: contact.channel.own, to: counterpartAnchor, toKeyAgreement: contact.channel.counterpartKa,
    self: await communityContext(p), nextGen: await nextCommunityContext(p),
    lineage: lineageFor(p, contact.mapFirstGen), revision, issuedAt: C.iso(when),
  })
}
// die früheste Generation dieser Beziehung, synchron mit dem Commit der
// Ausstellung festgehalten (2285: Ketten-Zustand, die frühere gewinnt)
const noteFirstGen = (p: Person, contact: any) => {
  const g = p.communityGeneration ?? 1
  if (contact.mapFirstGen === undefined || g < contact.mapFirstGen) contact.mapFirstGen = g
}
export async function makeMapping (p: Person, counterpartAnchor: string, when: number) {
  const contact = p.contacts.get(counterpartAnchor)
  // Ausstellungs-Disziplin (Review 8/9): Peek → fehlbar bauen →
  // Zähler UND Body synchron committen (sentMapping = der persistierte
  // ausgestellte Body, §6.4: one step per scope), seriell je Kontakt;
  // ein deaktiviertes Tupel stellt nichts aus
  return withIssueLock(contact, async () => {
    if (contact.deactivated) throw new Error('tuple deactivated — issues nothing (§6.4)')
    const revision = peekRev(contact, 'mapRevOut')
    const m = await buildMappingArtifact(p, contact, counterpartAnchor, when, revision)
    if (contact.deactivated) throw new Error('tuple deactivated — issues nothing (§6.4)')
    contact.mapRevOut = revision
    contact.sentMapping = m
    noteFirstGen(p, contact)
    return m
  })
}
// Verifikation ist EMPFÄNGER-PRIVAT (§6.3, geschlossene Liste) — und
// die Liste wird IN IHRER REIHENFOLGE ausgewertet (Review 19, B-1:
// „all of the following hold, evaluated in this order"): 1 Schema
// (anchor-mapping@1 bis @3 sind nicht implementiert) · 2 to · 3 pair ·
// 4 Card verifiziert unter IHREM Anker · 4a Lineage · 4b Pre-Rotation
// gegen die Bindungen, die DIESE Beziehung hält (6610) · 5 card.anchor
// == self · 6 k2 aus card.keyAgreement · 7 MACs (anchor.ts).
// arrivalKey = das Ankunftstupel (Empfangspfad); standalone wählt
// body.pair (Schritt 3 dann trivial).
export async function verifyMapping (p: Person, m: any, arrivalKey?: string) {
  const key = arrivalKey ?? m?.body?.pair
  const entry = p.contacts.get(key)
  if (!entry?.channel?.own || entry.deactivated) return false
  return (await verifyAnchorMapping(m, { own: entry.channel.own, pair: key, pairKeyAgreement: entry.channel.counterpartKa, held: entry.heldBindings })).ok
}
// Abstreitbarkeits-Demo: der Empfänger fabriziert ein identisch
// verifizierendes Mapping — ein Leak beweist Dritten nichts (Klasse V)
export async function forgeMapping (forger: Person, victimCard: any, pairAnchor: string, when: number) {
  const entry = forger.contacts.get(pairAnchor)
  const whenIso = C.iso(when)
  const body = { type: 'anchor-mapping@4', pair: pairAnchor, self: victimCard.body.anchor, to: entry.channel.own.anchor, card: victimCard, lineage: [], revision: '1', issuedAt: whenIso }
  const msg = jcs(body)
  const k2 = await C.hkdf(await C.ecdh(entry.channel.own.x.priv, C.xRawOfMk(victimCard.body.keyAgreement)!), 'rltp/visibility/mac/map2')
  return { body, proof: {
    mac1: await hmacU(await relKey(entry, 'rltp/visibility/mac/map1'), msg),
    mac2: await hmacU(k2, msg) } }
}

// ── die Admissionsschicht (Sektion 2) ───────────────────────────────────
const relIdOf = (p: Person, contactKey: string): string => {
  const c = p.contacts.get(contactKey)
  return c ? (c.relId ??= contactKey) : contactKey
}
// Bound testbar: p.admissionBound (BigInt) überschreibt den
// unerreichbaren Spec-Bound — die MECHANIK (pending, k−1, Departure)
// ist dieselbe (Sektion 2, „the rule exists for totality")
// relOrder: die Promotion-Reihenfolge der BEZIEHUNGEN (ihr erster
// Promotion-Commit) — sie bestimmt die Identität eines Eintrags, dessen
// namensgebende Beziehung geht (Sektion 2, Review 3 M3)
const admission = (p: Person): { seq: bigint, byRel: Map<string, any>, admitted: bigint, relSeq: bigint, relOrder: Map<string, bigint> } =>
  ((p as any).admission ??= { seq: 0n, byRel: new Map(), admitted: 0n, relSeq: 0n, relOrder: new Map() })
// geht die namensgebende Beziehung eines verschmolzenen Eintrags (Split
// oder Departure), wird die älteste VERBLEIBENDE Beziehung in
// Promotion-Reihenfolge seine Identität; jeder holder-lokale Schlüssel
// des Eintrags löst über byRel auf, die alte Identität gehört danach dem
// Austreter (Sektion 2). Ketten-Aliase sind keine Beziehungen
const reidentify = (p: Person, a: any, e: any) => {
  if (e.relIds.has(e.id)) return
  const rels = [...e.relIds].filter((rid: string) => (p.contacts.get(rid)?.relId ?? rid) === rid)
  const order = (rid: string) => a.relOrder.get(rid) ?? BigInt(Number.MAX_SAFE_INTEGER)
  const next = rels.sort((x: string, y: string) => (order(x) < order(y) ? -1 : order(x) > order(y) ? 1 : 0))[0]
  if (next !== undefined) e.id = next
}
const boundOf = (p: Person): bigint => (p as any).admissionBound ?? ADMISSION_BOUND
// jede Zustandsoperation verlangt eine endliche Uhr (Review 5, MAJOR)
const finite = (when: number): number => {
  if (!Number.isFinite(when)) throw new Error('admission requires a finite clock')
  return when
}
// Scope-Preflight (Review 5, B-5): prüft OHNE zu verbrauchen — ein Akt,
// der in einem erschöpften Scope ausstellen müsste, suspendiert atomar
const scopeOk = (cur?: string) => BigInt(cur ?? '0') < ADMISSION_BOUND
// EIN atomarer Merge zweier Einträge: früheste Position überlebt,
// Aliase lösen auf; k admitted → k−1 Slots frei → die nächsten Pending
// admittieren (Set-Änderung via reconcile)
function mergeEntries (p: Person, a: any, survivorIn: any, goneIn: any, when: number) {
  const survivor = goneIn.pos < survivorIn.pos ? goneIn : survivorIn
  const gone = survivor === goneIn ? survivorIn : goneIn
  for (const rid of gone.relIds) { survivor.relIds.add(rid); a.byRel.set(rid, survivor) }
  for (const ck of gone.rels) survivor.rels.add(ck)
  // jede gehaltene Generation, jedes Glied und jede Bindung bleibt bei SEINER Beziehung (§6a.1, 6610)
  for (const [rid, h] of heldOf(gone)) heldOf(survivor).set(rid, h)
  settle(a, survivor)
  if (survivor.status === 'admitted' && gone.status === 'admitted') { a.admitted -= 1n; admitPending(p, a, when) }
  else if (gone.status === 'admitted') { survivor.status = 'admitted' }
  return survivor
}
const admitPending = (p: Person, a: any, _when: number) => {
  // k−1-Nachrücken in Promotion-Commit-Ordnung (Sektion 2)
  while (a.admitted < boundOf(p)) {
    const next = [...new Set(a.byRel.values())].filter((x: any) => x.status === 'pending').sort((x: any, y: any) => x.pos < y.pos ? -1 : 1)[0]
    if (!next) break
    ;(next as any).status = 'admitted'
    a.admitted += 1n
  }
}
/** Departure (Sektion 2): der Abgang EINER Beziehung entfernt nur
 *  ihren Alias — „the relationships themselves remain fully active"
 *  (Review 16, B-3): der verschmolzene Eintrag (und sein Slot) stirbt
 *  erst mit der LETZTEN Beziehung */
export function departMember (p: Person, relId: string, when: number) {
  finite(when)
  const a = admission(p)
  const e = a.byRel.get(relId)
  if (!e) return
  // die KETTE ist EINE Beziehung (Review 35): ihr Abgang entfernt auch
  // die Ketten-Aliase (byRel-Schlüssel, deren Kontakt sich als DIESE
  // Beziehung identifiziert — z. B. der frische Tupelschlüssel nach
  // einer Kettung mit vorbestehendem Eintrag); Aliase ANDERER
  // Beziehungen (Weg-2-Merge) bleiben
  for (const rid of [...e.relIds]) {
    if (rid === relId || (p.contacts.get(rid)?.relId ?? rid) === relId) { e.relIds.delete(rid); a.byRel.delete(rid) }
  }
  e.relIds.delete(relId)
  a.byRel.delete(relId)
  // die Kontaktschlüssel der GEGANGENEN Beziehung verlassen den Eintrag
  for (const ck of [...e.rels]) {
    const c = p.contacts.get(ck)
    if ((c?.relId ?? ck) === relId) e.rels.delete(ck)
  }
  // was die gegangene Beziehung hielt, geht mit ihr (§6a.1)
  for (const rid of [...heldOf(e).keys()]) if (rid === relId || (p.contacts.get(rid)?.relId ?? rid) === relId) heldOf(e).delete(rid)
  settle(a, e)   // der Kopf des Rests aus dem, was seine Beziehungen halten (§2)
  if (e.relIds.size > 0) { reidentify(p, a, e); return }   // Aliase bleiben, der Member bleibt admittiert
  if (e.status === 'admitted') { a.admitted -= 1n; admitPending(p, a, when) }
}
// die Glieder prev → next, die eine verifizierte Ankermenge in
// Kettenreihenfolge trägt (leer, wenn sie nur self ist)
const linksOfHeld = (held: string[]): [string, string][] => held.slice(1).map((n, i) => [held[i]!, n])
// was ein Eintrag hält, JE BEZIEHUNG (§6a.1, 6610): ihre Anker, ihre
// Glieder, ihre Pre-Rotation-Bindungen (Anker → commit) und ihren Kopf
// (den aktuellen self dieser Beziehung). Herkunft bleibt bei der
// Beziehung — ein Split nimmt sie mit
type Held = { anchors: Set<string>, links: Map<string, string>, head: string, bindings: Map<string, string> }
const heldOf = (x: any): Map<string, Held> => (x.held ??= new Map([[x.id, { anchors: new Set([x.self]), links: new Map(), head: x.self, bindings: new Map() }]]))
// was ein Eintrag als überholt hält (§6a.1 rung 2, 6540): jedes prev
// eines Glieds irgendeiner seiner Beziehungen
const supersededIn = (x: any, skip: (rid: string) => boolean = () => false): Set<string> =>
  new Set(linksOfEntry(x, skip).map(([prv]) => prv))
// das Lineage-Wissen eines Eintrags: die Glieder ALLER seiner Beziehungen
// (ohne die Beziehungen, die `skip` als eigene ausweist)
const linksOfEntry = (x: any, skip: (rid: string) => boolean = () => false): [string, string][] =>
  [...heldOf(x)].filter(([rid]) => !skip(rid)).flatMap(([, h]) => [...h.links])
// das Wissen, das die Bindungsregel vergleicht (6605): Glieder und
// Bindungen eines Eintrags (ohne `skip`) oder einer einzelnen Beziehung
type Know = { links: [string, string][], bindings: [string, string][] }
const knowOf = (x: any, skip: (rid: string) => boolean = () => false): Know => {
  const held = [...heldOf(x)].filter(([rid]) => !skip(rid)).map(([, h]) => h)
  return { links: held.flatMap((h) => [...h.links]), bindings: held.flatMap((h) => [...h.bindings]) }
}
const knowOfHeld = (h: Held): Know => ({ links: [...h.links], bindings: [...h.bindings] })
// die Bindungsregel (6605): zwei Wissensstände halten für einen Anker
// verschiedene Pre-Rotation-Bindungen. Ein gehaltenes Glied prev → next
// legt die Bindung von prev fest (6610) — zwei verschiedene next zu
// einem prev sind darum ebenfalls verschiedene Bindungen
const conflicts = (k1: Know, k2: Know): boolean =>
  k1.links.some(([p1, n1]) => k2.links.some(([p2, n2]) => p1 === p2 && n1 !== n2))
  || k1.bindings.some(([a1, c1]) => k2.bindings.some(([a2, c2]) => a1 === a2 && c1 !== c2))
// die neuesten Köpfe einer Menge gehaltener Beziehungs-Stände: die, von
// denen entlang der gehaltenen Glieder kein anderer Kopf erreichbar ist
const newestHeads = (held: Held[]): string[] => {
  const next = new Map<string, string[]>()
  for (const h of held) for (const [prv, nxt] of h.links) next.set(prv, [...(next.get(prv) ?? []), nxt])
  const reaches = (from: string, to: string) => {
    const seen = new Set<string>(); const todo = [...(next.get(from) ?? [])]
    while (todo.length) { const n = todo.pop()!; if (n === to) return true; if (!seen.has(n)) { seen.add(n); todo.push(...(next.get(n) ?? [])) } }
    return false
  }
  const heads = [...new Set(held.map((h) => h.head))]
  return heads.filter((h) => !heads.some((o) => o !== h && reaches(h, o)))
}
// Kopf und Anker eines Eintrags, IMMER aus dem bestimmt, was seine
// Beziehungen halten (§6a.1 rung 2, §2): die Anker = die Vereinigung
// ihrer gehaltenen Anker (was keine Beziehung mehr hält, fällt heraus);
// der Ankerkopf = der neueste ihrer Köpfe entlang der gehaltenen Glieder
// (6560). Er ist immer genau einer: jeder Merge-Pfad lässt nur Stände
// zusammen, die die Kopfregel und die Bindungsregel zulassen, und eine
// Beziehung, die im Eintrag eine andere Bindung vorlegt, verlässt ihn
// (2080) — ein Eintrag hält nie zwei Nachfolger eines Ankers (6605)
const settle = (_a: any, x: any) => {
  const held = [...heldOf(x)]
  if (held.length === 0) { x.anchors = new Set([x.self]); return }
  x.anchors = new Set(held.flatMap(([, h]) => [...h.anchors]))
  const newest = newestHeads(held.map(([, h]) => h))
  if (newest.length !== 1) throw new Error('entry without exactly one anchor head (6560, 6605) — a merge path admitted incomparable heads')
  x.self = newest[0]
}
// die Kopfregel (§6a.1 rung 2, 6530/6540), eintragsweit: ein Kopf `head`
// mit der getragenen Lineage `links` schließt an den Eintrag x an, wenn
// (a) er x' aktueller Kopf ist oder die Lineage diesen fortsetzt (als
// prev trägt) UND (b) x ihn nicht als überholt hält
const joins = (head: string, links: [string, string][], x: any, skip?: (rid: string) => boolean) =>
  (head === x.self || links.some(([prv]) => prv === x.self)) && !supersededIn(x, skip).has(head)
// die übrigen Einträge in Positionsreihenfolge (die früheste zuerst)
const entriesByPos = (a: any): any[] => [...new Set<any>(a.byRel.values())].sort((x, y) => (x.pos < y.pos ? -1 : x.pos > y.pos ? 1 : 0))
// die Kopfregel nach einem akzeptierten Update des Eintrags e (§6a.1 rung 2, 6580),
// in beiden Verarbeitungsrichtungen:
//   · die EINGEHENDE Beziehung `relId` gegen jeden anderen Eintrag — bei
//     JEDEM akzeptierten Mapping, nicht nur bei einer Kopfänderung (auch
//     neu getragene verbindende Lineage zählt). Beweiskraft hat sie nur,
//     wenn ihr Kopf der Kopf ihres Eintrags ist: der Kopf einer
//     nachhinkenden Beziehung ist in ihrem eigenen Eintrag überholt
//     (6550). Und sie zieht keinen Eintrag herein, dessen Kopf ihr Eintrag
//     SCHON VOR diesem Mapping als überholt hielt — der wurde unter einem
//     überholten Anker abgewiesen und tritt erst bei, wenn er selbst einen
//     aktuellen Kopf vorlegt (6590)
//   · die Gegenrichtung, wenn sich e's Kopf geändert hat (`before`): ein
//     anderer Eintrag schließt sich nur an, wenn ER die Kopfregel gegen e
//     erfüllt
// beide mit der eintragsweiten Bindungsregel (6605)
const converge = (p: Person, a: any, e: any, before: string | undefined, when: number, incoming?: { relId: string, supersededBefore: Set<string> }) => {
  const mine = incoming && heldOf(e).get(incoming.relId)
  if (incoming && mine && mine.head === e.self) {
    const twin = entriesByPos(a).find((x) => x !== e && !incoming.supersededBefore.has(x.self) && joins(mine.head, [...mine.links], x) && !conflicts(knowOf(e), knowOf(x)))
    if (twin) e = mergeEntries(p, a, e, twin, when)
  }
  if (e.self === before) return e
  const twin = entriesByPos(a).find((x) => x !== e && joins(x.self, linksOfEntry(x), e) && !conflicts(knowOf(x), knowOf(e)))
  return twin ? mergeEntries(p, a, e, twin, when) : e
}
/**
 * Promotion-Commit (Sektion 2). `held` = alle Generationen, die die
 * verifizierte Abbildung trägt (self + Lineage, Kettenreihenfolge),
 * `kind` = die §6.3-Klassifikation (Bedingung 8) gegen den self, den
 * DIESE Beziehung hielt, `bindings` = die Pre-Rotation-Bindungen, die
 * die Abbildung nennt (6610, anchor.mappingBindings). Nur angenommene
 * Abbildungen kommen hierher: 'first' (die Beziehung hielt noch keinen
 * self), 'same' und 'rotation' — ein geänderter self ohne Segment, das
 * den gehaltenen erreicht, ist schon in Bedingung 8 abgewiesen (6170)
 * und mutiert nichts. Fortgesetzt wird in place akkumuliert, jeder
 * Merge bleibt. Der Split (2080): das erste Mapping auf einer Beziehung,
 * die ohne eigenes Mapping im Eintrag sitzt, und das keinen Anker der
 * übrigen Beziehungen nennt, oder eine Beziehung, die für einen Anker
 * eine andere Bindung hält als die übrigen — sie verlässt den Eintrag
 * atomar (der Eintrag behält Position, Status und die übrigen
 * Beziehungen) und tritt per gewöhnlichem Promotion-Commit neu ein
 * (2090).
 */
export function promotionCommit (p: Person, relId: string, self: string, contactKey: string, when: number, held: string[] = [self], kind: 'first' | 'same' | 'rotation' = 'first', bindings: Map<string, string> = new Map()) {
  finite(when)
  const a = admission(p)
  const heldSet = new Set([self, ...held])
  const links = linksOfHeld(held)
  // gehört ein Aliasschlüssel zu DIESER Beziehung (Ketten-Aliase, Review 35)?
  const own = (rid: string) => rid === relId || (p.contacts.get(rid)?.relId ?? rid) === relId
  const ownRel = (ck: string) => ck === contactKey || (p.contacts.get(ck)?.relId ?? ck) === relId
  const foreign = (x: any) => [...x.relIds].some((rid: string) => !own(rid))
  if (!a.relOrder.has(relId)) a.relOrder.set(relId, (a.relSeq += 1n))
  let e = a.byRel.get(relId)
  // der Kopf, den DIESE Beziehung hielt — nicht das gemeinsame Eintragsfeld
  // (Review 4, M2): auf einem verschmolzenen Eintrag können die Köpfe der
  // Beziehungen auseinanderliegen
  const mine0 = e ? heldOf(e).get(relId) : undefined
  // Bedingung 8 (6170): eine Beziehung, die einen self hält, ändert ihn nur
  // als Rotation; 'first' auf einer solchen wäre ein unverketteter Wechsel
  if (kind === 'first' && mine0 !== undefined && mine0.head !== self) throw new Error('promotionCommit: a relationship that holds a self changes it only by a rotation (6.3 condition 8, 6170)')
  // was diese Beziehung danach hält (6610): über Rotationen akkumuliert
  const next: Held = mine0
    ? { anchors: new Set([...mine0.anchors, ...heldSet]), links: new Map([...mine0.links, ...links]), head: self, bindings: new Map([...mine0.bindings, ...bindings]) }
    : { anchors: new Set(heldSet), links: new Map(links), head: self, bindings: new Map(bindings) }
  // 2080: das erste Mapping einer Beziehung, die ohne eigenes Mapping im
  // Eintrag sitzt, nennt keinen Anker, den die übrigen Beziehungen halten
  const unlinked = e !== undefined && mine0 === undefined && ![...heldOf(e)].some(([rid, h]) => !own(rid) && [...heldSet].some((x) => h.anchors.has(x)))
  const leaves = unlinked || (e !== undefined && conflicts(knowOfHeld(next), knowOf(e, own)))
  if (e && leaves && foreign(e)) {
    // der Split (2080): nichts verbindet sie mehr mit den übrigen
    // Beziehungen, oder sie hält für einen Anker eine andere Bindung — die
    // Beziehung (samt Ketten-Aliasen, Herkunfts- und Kontinuitätsfakten)
    // verlässt den Eintrag, ohne dessen Slot, Position oder Status zu berühren
    for (const rid of [...e.relIds]) if (own(rid)) { e.relIds.delete(rid); a.byRel.delete(rid) }
    for (const ck of [...e.rels]) if (ownRel(ck)) e.rels.delete(ck)
    for (const rid of [...heldOf(e).keys()]) if (own(rid)) heldOf(e).delete(rid)
    settle(a, e)   // der Kopf des Rests aus dem, was seine Beziehungen halten (§2)
    reidentify(p, a, e)
    e = undefined
  }
  if (e) {
    // spätere Verifikation derselben Beziehung: in place — eine höhere
    // Revision oder eine Rotation ändert nur den Inhalt, nie Position oder
    // Status (Sektion 2)
    const supersededBefore = supersededIn(e)
    heldOf(e).set(relId, next)
    const before = e.self
    settle(a, e)
    e.rels.add(contactKey)
    return converge(p, a, e, before, when, { relId, supersededBefore })
  }
  // erreicht die eingehende Abbildung den aktuellen Kopf eines ANDEREN
  // Eintrags, ohne dort überholt zu sein und ohne eine andere Bindung zu
  // halten = der Weg-2-Merge
  const twin = entriesByPos(a).find((x) => foreign(x) && joins(self, links, x, own) && !conflicts(knowOfHeld(next), knowOf(x, own)))
  if (twin) {
    const before = twin.self
    twin.relIds.add(relId); twin.rels.add(contactKey); a.byRel.set(relId, twin)
    heldOf(twin).set(relId, next)
    settle(a, twin)
    return converge(p, a, twin, before, when)
  }
  // Admission ist TOTAL: unter dem Bound admitted (der Normalfall —
  // die Promotion selbst ist die Admission), am Bound
  // deliverable-pending (triggert nichts, rückt bei Abgang nach)
  const status = a.admitted < boundOf(p) ? 'admitted' : 'pending'
  if (status === 'admitted') a.admitted += 1n
  e = { id: relId, pos: (a.seq += 1n), relIds: new Set([relId]), self, held: new Map([[relId, next]]), rels: new Set([contactKey]), status }  // id = kanonische Identität (Review 36)
  settle(a, e)
  a.byRel.set(relId, e)
  return e
}
/** Kettung (B-4): der neue Kopf löst über die überlebende Beziehung auf;
 *  hält die frische Beziehung schon einen EIGENEN Eintrag, verschmilzt
 *  er atomar mit dem der alten (früheste Position, Aliase, k−1) — nur,
 *  wenn ihre Köpfe über die gehaltene Lineage vergleichbar sind und sie
 *  keine verschiedenen Bindungen halten (6605). Sonst bleibt die frische
 *  Beziehung ein eigener Eintrag, bis eine Abbildung auf ihr die Lineage
 *  ab der gehaltenen Generation trägt und das Netz sie zusammenführt
 *  (review5 R5-5; kein Konfliktzustand) */
export function chainAdmission (p: Person, survivingRelId: string, freshRelId: string, newContactKey: string, when: number) {
  finite(when)
  const a = admission(p)
  const oldE = a.byRel.get(survivingRelId)
  const freshE = a.byRel.get(freshRelId)
  let e = oldE
  if (oldE && freshE && oldE !== freshE) {
    const both = [...heldOf(oldE).values(), ...heldOf(freshE).values()]
    if (conflicts(knowOf(oldE), knowOf(freshE)) || newestHeads(both).length !== 1) return freshE
    e = mergeEntries(p, a, oldE, freshE, when)
  }
  else if (!oldE && freshE) { e = freshE; freshE.relIds.add(survivingRelId); a.byRel.set(survivingRelId, freshE) }
  if (e) { e.relIds.add(freshRelId); a.byRel.set(freshRelId, e); e.rels.add(newContactKey) }
  return e
}
/**
 * Die Rekonziliations-Sicht (5.4, 5610/5620): die Paare (member,
 * Ankerkopf seines Eintrags) aller admittierten Mitglieder, ab dem
 * Commit, der sie admittiert; deliverable-pending nie. member = die
 * Position des Eintrags (sie überlebt Merge und Umbenennung).
 */
export function viewOf (p: Person, _when?: number): { member: string, anchor: string }[] {
  const seen = new Set<any>()
  const out: { member: string, anchor: string }[] = []
  for (const e of admission(p).byRel.values()) {
    if (seen.has(e)) continue
    seen.add(e)
    if (e.status !== 'admitted') continue   // deliverable-pending triggert nichts (Sektion 2)
    out.push({ member: String(e.pos), anchor: e.self })
  }
  return out.sort((x, y) => x.member < y.member ? -1 : x.member > y.member ? 1 : 0)
}

// ── star@2 — die normative Wire-Form (5.2/5.2a) ────────────────────────
const kStar = (contact: any, counterpartAnchor: string, salt: string) =>
  relKey(contact, `rltp/visibility/blind/star/${contact.channel.own.anchor}/${counterpartAnchor}/${salt}`)
const kStarIn = (contact: any, counterpartAnchor: string, salt: string) =>
  relKey(contact, `rltp/visibility/blind/star/${counterpartAnchor}/${contact.channel.own.anchor}/${salt}`)
// reine Berechnung: die 5.2a-Chunk-Serie einer Zustellung — jedes
// Mitglied der Sicht in genau einer Form, geblendet: der Ankerkopf seines
// Eintrags (5010); Mitglieder mit demselben Ankerkopf ergeben EINEN
// Eintrag (5050); die Union einmal sortiert, dann geschnitten (5220)
async function buildStarChunks (contact: any, counterpartAnchor: string, salt: string, view: { member: string, anchor: string }[]) {
  const k = await kStar(contact, counterpartAnchor, salt)
  const blinded: string[] = []
  for (const anchor of new Set(view.map((v) => v.anchor))) blinded.push(await hmacU(k, anchor))
  blinded.sort()
  const n = Math.max(1, Math.ceil(blinded.length / CHUNK_MAX))
  const chunks = []
  for (let i = 0; i < n; i++) {
    const body = { type: 'star@2', salt, seq: String(i + 1), last: i === n - 1, blinded: blinded.slice(i * CHUNK_MAX, (i + 1) * CHUNK_MAX) }
    chunks.push({ body, proof: { mac: await hmacU(k, jcs(body)) } })
  }
  return chunks
}
export async function buildStar (p: Person, contact: any, when: number) {
  if (contact.deactivated) return null   // deaktivierte Tupel stellen nichts aus (Review 9, B-3)
  return withStarLock(contact, async () => {
    if (contact.deactivated) return null // Re-Check nach dem Lock-Erwerb
    const salt = peekStarSeq(contact)    // nur gepeekt (Review 25)
    const key = [...p.contacts.entries()].find(([, c]) => c === contact)?.[0]
    // dieselbe Commit-Revalidierung wie reconcile (Review 26): wanderte
    // die Sicht während der MAC-Awaits, wird mit der aktuellen neu
    // gebaut — „every delivery carries the set current at its
    // production commit"
    for (;;) {
      const view = viewOf(p, when)
      const chunks = await buildStarChunks(contact, key!, salt, view)
      if (contact.deactivated) return null // Re-Check nach den MAC-Awaits (Review 10) — danach kein await
      if (!sameView(view, viewOf(p, when))) continue
      contact.starSeqNext = salt           // COMMIT synchron mit der Ausgabe
      return chunks[0].body
    }
  })
}
// Empfängerseite: denselben Lieferschlüssel nachrechnen, EINEN Anker testen
export async function starMatch (p: Person, entry: any, snap: any, anchor: string) {
  const key = [...p.contacts.entries()].find(([, c]) => c === entry)?.[0]
  const k = await kStarIn(entry, key!, snap.salt)
  return snap.blinded.includes(await hmacU(k, anchor))
}
export async function refreshStarInfo (p: Person) {
  for (const [key, entry] of p.contacts) {
    if (!entry.starReceived || !entry.channel?.own) continue
    const known = []
    const seen = new Set()
    for (const [k2, e] of p.contacts) {
      if (k2 === key || !e.selfAnchor || seen.has(e.selfAnchor)) continue
      seen.add(e.selfAnchor)
      // gegen JEDE gehaltene Generation dieses Kontakts (§6.3 Nr. 8): ein
      // Sender, der die Rotation noch nicht kennt, blindet die ältere
      let hit = false
      for (const anchor of e.selfAnchors ?? [e.selfAnchor]) if (!hit && await starMatch(p, entry, entry.starReceived, anchor)) hit = true
      if (hit) known.push(e.name)
    }
    // count = die Zahl der geblendeten Einträge des Empfangenen (lokal
    // abgeleitet; star@2 trägt keinen Zähler)
    entry.starInfo = { count: entry.starReceived.count, knownNames: known.sort() }
  }
}

// ── Dokumente, Outbox, byte-identische Redelivery (Delivery §3/4.2/4.4) ─
// Payload = das Artefakt selbst; das Dokument trägt KEINEN Proof (die
// Artefakt-MACs sind der eine Träger). threadId frisch je Zustellung;
// Chunks eines Salts teilen sie. Die outbox hält jede unquittierte
// Zustellung als DENSELBEN Env — Redelivery ist byte-identisch (4.2).
const outboxOf = (contact: any) => (contact.outbox ??= new Map<string, any>())
async function sendDoc (p: Person, counterpartAnchor: string, slug: string, payload: any, when: number, threadId: string, meta: any = {}, ent: any = {}) {
  const contact = p.contacts.get(counterpartAnchor)
  const doc = {
    id: uuid(ent.id), type: TT + taskOf(slug),
    issuer: contact.channel.own.anchor, recipient: counterpartAnchor,
    threadId, issuedAt: C.iso(when), payload,
  }
  const env = await C.seal(doc, contact.channel.counterpartKa, ent)
  const digest = await C.digestDoc(doc)
  outboxOf(contact).set(digest, { env, threadId, kind: slug, ...meta })
  return { to: contact, kind: taskOf(slug), env }
}
// ── die Ausstellungs-Disziplin (Review 7, B-1/B-2) ─────────────────────
// „Assigning a revision and persisting the issued body are one step per
// scope" (§6.4): je Kontakt serialisiert EIN Issue-Lock alle
// Revisions-Producer; die Revision wird nur GEPEEKT, alles Fehlbare
// (Bau, Seal, Digest) läuft davor, und Zähler + Outbox + Zustand
// committen in EINEM synchronen Zug am Ende — ein Fehlschlag
// verbraucht NICHTS.
export const withIssueLock = <T>(contact: any, fn: () => Promise<T>): Promise<T> => {
  const run = (contact.issueLock ?? Promise.resolve()).then(fn, fn)
  contact.issueLock = run.catch(() => {})
  return run
}
export const peekRev = (contact: any, field: string): string => {
  const next = BigInt(contact[field] ?? '0') + 1n
  if (next > ADMISSION_BOUND) throw new Error('scope exhausted — issues nothing further (2.1)')
  return String(next)
}
// prepare (fehlbar: Seal + Digest) / commit (synchron: Outbox-Eintrag)
async function prepareDoc (p: Person, counterpartAnchor: string, slug: string, payload: any, when: number, threadId: string, meta: any = {}, ent: any = {}) {
  const contact = p.contacts.get(counterpartAnchor)
  const doc = {
    id: uuid(ent.id), type: TT + taskOf(slug),
    issuer: contact.channel.own.anchor, recipient: counterpartAnchor,
    threadId, issuedAt: C.iso(when), payload,
  }
  const env = await C.seal(doc, contact.channel.counterpartKa, ent)
  const digest = await C.digestDoc(doc)
  return { contact, digest, entry: { env, threadId, kind: slug, ...meta }, out: { to: contact, kind: taskOf(slug), env } }
}
const commitDoc = (prep: any) => { outboxOf(prep.contact).set(prep.digest, prep.entry); return prep.out }
// Salt nur GEPEEKT (Review 25): strikt monoton, nie dicht (5.2) —
// aber „taking the set snapshot, assigning the salt, and committing
// are one step": ein Bau-Fehler verbraucht nichts, auch am letzten
// Wert entsteht nie falsche Erschöpfung. Der Aufrufer committet
// synchron mit der Persistenz (unter dem Star-Lock serialisiert).
const peekStarSeq = (contact: any): string => {
  const next = BigInt(contact.starSeqNext ?? '0') + 1n
  if (next > ADMISSION_BOUND) throw new Error('scope exhausted — issues nothing further (2.1)')
  return String(next)
}
// EIN Lock je Kontakt für Produktion UND Empfang, geteilt mit dem
// Continuity-Pfad (Review 4, B-1/B-2: Trust- und Continuity-Effekte
// desselben Kontakts serialisieren gemeinsam; Reentry-Checks im Lock)
export const withContactLock = <T>(contact: any, fn: () => Promise<T>): Promise<T> => {
  const run = (contact.contLock ?? Promise.resolve()).then(fn, fn)
  contact.contLock = run.catch(() => {})
  return run
}
const withStarLock = withContactLock
// der Baseline-Automat (5.4, totale Tabelle): completion(salt), sobald
// JEDER Chunk-Digest des Salts quittiert ist
const subOf = (contact: any) => (contact.sub ??= { highWater: 0n, baseline: null as null | { member: string, anchor: string }[], inFlight: new Map<string, any>() })
const sameView = (a: any[], b: any[]) => a.length === b.length && a.every((x, i) => x.member === b[i].member && x.anchor === b[i].anchor)

/**
 * reconcile (5.4 — die eine Regel): divergiert die Sicht von der
 * Baseline (⊥ = divergent, das New-Head-Korollar), und ist nicht
 * pausiert, wird der AKTUELLE Stand geliefert — an JEDEM weiteren
 * Delivery-Kontakt unter frischem, höherem Salt (5.4 wörtlich,
 * Review 23; Salts sind ausdrücklich nicht dicht). Es gibt keinen
 * Same-View-Retry; die 4.4-Byte-Identität ist eine Formvorschrift
 * für Chunk-Retries, keine Anordnung.
 */
export async function reconcile (p: Person, counterpartAnchor: string, when: number, ent: any = {}) {
  const contact = p.contacts.get(counterpartAnchor)
  if (!contact || contact.deactivated || !contact.trustGiven || contact.trustPaused) return null
  return withStarLock(contact, async () => {
    // Re-Check nach dem Lock-Erwerb (Review 9 B-3 / Review 11 B-1):
    // auch die Pause — „while paused, the delivery duty is suppressed"
    if (contact.deactivated || contact.trustPaused) return null
    let view = viewOf(p, when)
    const s = subOf(contact)
    if (s.baseline && sameView(s.baseline, view)) return null
    // überholte In-Flight-Salts (≤ highWater) sind tot: der Empfänger
    // MUSS sie ablehnen — purgen, nie wiederverwenden (Review 2, B-7)
    for (const [salt, f] of [...s.inFlight]) {
      if (BigInt(salt) <= s.highWater) { for (const d of f.pending.keys()) outboxOf(contact).delete(d); s.inFlight.delete(salt) }
    }
    // KEIN Same-View-Retry (Review 23, B-1): 5.4 wörtlich — „a
    // delivery whose chunks are never all acknowledged … simply never
    // completes … and the next available delivery contact ships the
    // current view under a fresh, higher salt." Die 4.4-Byte-
    // Identitäts-Regel ist eine FORMVORSCHRIFT für den Fall eines
    // Chunk-Retries, keine Anordnung eines solchen — jeder weitere
    // Delivery-Kontakt prägt frisch und höher (Salts sind ausdrücklich
    // nicht dicht). So löst der Sender auch ein beim Empfänger
    // vergiftetes in-flight-Salt ab, ohne je vom Gift zu wissen; alte
    // Ack-Referenzen bleiben bis zur Completion-Purge sicher stehen.
    const salt = peekStarSeq(contact)   // nur gepeekt (Review 25) — committet synchron mit Outbox + inFlight
    const threadId = ent.threadId ?? globalThis.crypto.randomUUID()
    // „taking the set snapshot, assigning the salt, and committing are
    // one step" (Review 9, B-4): der Bau ist fehlbar und wartet — am
    // Commit wird die Sicht SYNCHRON neu verglichen; wanderte sie
    // während des Baus (Promotion/Declaration eines ANDEREN Kontakts),
    // wird mit der aktuellen Sicht neu gebaut, unter demselben Salt
    // (nichts wurde persistiert). Jede Zustellung trägt so den Stand
    // ihres Production-Commits.
    for (;;) {
      const chunks = await buildStarChunks(contact, counterpartAnchor, salt, view)
      const preps = []
      for (const chunk of chunks) preps.push(await prepareDoc(p, counterpartAnchor, 'star', chunk, when, threadId, { salt }, ent))
      // Re-Check (Review 9 B-3 / Review 11 B-1), danach kein await:
      // eine während des Baus gesetzte Pause supprimiert die Zustellung
      if (contact.deactivated || contact.trustPaused) return null
      const now = viewOf(p, when)
      if (!sameView(view, now)) {
        view = now
        if (s.baseline && sameView(s.baseline, view)) return null  // konvergiert während des Baus → Schweigen
        continue
      }
      // COMMIT — ein synchroner Zug: Salt + Outbox + inFlight + Sicht
      contact.starSeqNext = salt
      const pending = new Map<string, any>()
      const envs = []
      for (const prep of preps) { const out = commitDoc(prep); pending.set(prep.digest, { env: out.env }); envs.push(out.env) }
      s.inFlight.set(salt, { view, pending, threadId })
      return { to: contact, kind: taskOf('star'), envs, salt }
    }
  })
}

// ── der Vertrauensakt (register no. 3: EIN menschlicher Akt) ────────────
// setTrust stellt aus: anchor-mapping@4 (Offenlegung) — ein
// registriertes Dokument. Der Akt steht hier für „Mapping-Klasse an"
// (Sektion 2a; die Klassen-API ist Stufe 2). Der Stern folgt über
// reconcile (5.4: die Promotion der Gegenseite erzeugt dort die
// Divergenz; hier entsteht nur die eigene Sicht).
export async function setTrust (p: Person, counterpartAnchor: string, when: number, ent: any = {}) {
  const contact = p.contacts.get(counterpartAnchor)
  if (!contact) return { error: 'kein Kontakt' }
  if (!contact.channel?.own) return { error: 'kein eigener Kanal — einseitig (◇) hast du nichts freigegeben' }
  // GANZER Akt unter dem Issue-Lock (Review 7, B-1/B-2): Revisionen
  // werden nur gepeekt, alles Fehlbare läuft davor, Zähler + Outbox +
  // Zustand committen synchron am Ende — ein Seal-Fehler verbraucht
  // NICHTS, und kein Producer schiebt sich zwischen Peek und Commit
  return withIssueLock(contact, async () => {
    // ein deaktiviertes Tupel stellt nichts aus (Review 8, B-2 —
    // §6.4/„a chain append is atomic with the deactivation"): geprüft
    // nach dem Lock-Erwerb UND synchron vor dem Commit
    if (contact.deactivated) return { error: 'tuple deactivated — Kopf der Beziehung ist gewandert' }
    if (contact.trustGiven) return { error: 'bereits geschenkt (Einweg-Tür)' }
    if (contact.trustPending) return { error: 'bereits unterwegs (Einweg-Tür)' }  // Latch (Review 6, B-1)
    if (!scopeOk(contact.mapRevOut)) return { error: 'scope exhausted — act suspended (2.1)' }
    contact.trustPending = true
    try {
      const mapRev = peekRev(contact, 'mapRevOut')
      const whenIso = C.iso(when)
      const mapping = await buildMappingArtifact(p, contact, counterpartAnchor, when, mapRev)
      const prepM = await prepareDoc(p, counterpartAnchor, 'anchor-mapping', mapping, when, uuid(ent.threadId), {}, ent)
      if (contact.deactivated) return { error: 'tuple deactivated — Kopf der Beziehung ist gewandert' }  // Re-Check (B-2), danach kein await
      // COMMIT — ein synchroner Zug (§6.4: assigning + persisting = one step)
      contact.mapRevOut = mapRev
      const outbound = [commitDoc(prepM)]
      contact.trustGiven = whenIso
      contact.sentMapping = mapping
      noteFirstGen(p, contact)
      say(p, `Vertrauen geschenkt an ${contact.name}: Anker offengelegt (anchor-mapping@4)`)
      return { to: contact, outbound, env: outbound[0]!.env }
    } finally { contact.trustPending = false }
  })
}
// Pause (5.4): initial unpaused, EINZIGE Transition ist dieser Akt;
// Unpause re-evaluiert die Divergenz (Producer: starRefreshAll)
export function setTrustPaused (p: Person, counterpartAnchor: string, paused: boolean) {
  const contact = p.contacts.get(counterpartAnchor)
  if (!contact?.trustGiven) return
  contact.trustPaused = !!paused
  say(p, paused ? `Kontakt-Updates an ${contact.name} pausiert (Geliefertes bleibt)` : `Kontakt-Updates an ${contact.name} wieder aktiv`)
}
/**
 * Nach einer Kettung (6980): auf dem neuen Kopf stellt der Sender sein
 * anchor-mapping@4 ohne neue Nutzerfrage neu aus, solange der
 * Trust-Akt steht (Mapping-Klasse an) — mit der Lineage ab der frühesten
 * Generation, die die Beziehung hielt (2285, 6420); so werden die Köpfe
 * beim Empfänger über die Lineage vergleichbar (review5 R5-5). Revision
 * startet im neuen Tupel-Scope. Die Pause supprimiert nur die
 * Stern-Delivery; die Pflicht (trustReissueDue) stirbt erst mit der
 * QUITTIERTEN Zustellung.
 */
export async function reissueTrust (p: Person, counterpartAnchor: string, when: number, ent: any = {}) {
  const contact = p.contacts.get(counterpartAnchor)
  if (!contact?.channel?.own || contact.deactivated || !contact.trustGiven) return null
  if (contact.reissuePending) return null                   // Single-Flight
  contact.reissuePending = true
  try {
    return await withIssueLock(contact, async () => {
      if (contact.deactivated) return null   // Re-Check nach dem Lock-Erwerb (Review 8, B-2)
      // unquittierte Neuausstellung → byte-identischer Retry
      for (const [, o] of outboxOf(contact)) if (o.kind === 'anchor-mapping' && o.v2) {
        return { to: contact, outbound: [{ to: contact, kind: taskOf('anchor-mapping') + ' (Retry, byte-identisch)', env: o.env }] }
      }
      // Scope erschöpft → Pflicht suspendiert (2.1, trustReissueDue
      // bleibt); Revision nur gepeekt, Commit synchron (Review 7, B-1)
      if (!scopeOk(contact.mapRevOut)) return null
      const mapRev = peekRev(contact, 'mapRevOut')
      const mapping = await buildMappingArtifact(p, contact, counterpartAnchor, when, mapRev)
      const prepM = await prepareDoc(p, counterpartAnchor, 'anchor-mapping', mapping, when, uuid(), { v2: true }, ent)
      if (contact.deactivated) return null   // Re-Check (B-2), danach kein await
      // COMMIT — ein synchroner Zug (§6.4)
      contact.mapRevOut = mapRev
      const outbound = [commitDoc(prepM)]
      contact.sentMapping = mapping
      noteFirstGen(p, contact)
      say(p, `Vertrauen auf dem neuen Kopf neu ausgestellt an ${contact.name} (6980 — ohne neue Nutzerfrage)`)
      return { to: contact, outbound }
    })
  } finally { contact.reissuePending = false }
}
/**
 * Die Rotation des Gemeinschaftsankers (Identity §5.4, Trust §6.5):
 * Generation g → g + 1, die Generation, an die g gebunden ist; die
 * Rotation trägt die Bindung von g + 1 an g + 2. Reihenfolge der
 * Senderpflichten: erst das Label persistieren (hier: der Registerkopf
 * `communityGeneration`), dann die Lineage halten, dann jedem VERTRAUTEN
 * Kontakt ein anchor-mapping@4 mit höherer Revision neu ausstellen (die
 * Self-Card reist darin, unter dem neuen Anker, mit der Bindung an die
 * Generation danach), je Beziehung mit dem Lineage-Segment ab ihrer
 * frühesten Generation (6370, 6420). Alles Fehlbare (Ableitung, beide
 * Signaturen) läuft vor der ersten Mutation. Der Log-Eintrag
 * `anchor.rotate` (Access §5.6) gehört ins Log der persönlichen
 * Community unter dem Gründer-Paar-Anker — die Probe-Welt führt dieses
 * Log nicht (COMMUNITY_GENESIS ist eine Fixture), der Eintrag entsteht
 * hier nicht. Rotation ist Schlüsselhygiene, kein Kompromittierungsweg:
 * sie braucht den Schlüssel der aktuellen Generation (Identity §8.6).
 */
export async function rotateCommunityAnchor (p: Person, when: number, ent: any = {}) {
  finite(when)
  const g = p.communityGeneration ?? 1
  // jede Generation trägt eine Bindung an die nächste: die Rotation endet
  // bei 2^53 − 2, deren Bindung an 2^53 − 1 geht (review5, Generationsbereich)
  if (g + 2 > Number.MAX_SAFE_INTEGER) throw new Error('rotation ends at generation 2^53 − 2 (Identity §5.4)')
  const prev = await communityContext(p)
  const next = await C.communityContext(p.rootIkm, p.communityGenesis, g + 1)
  const after = await C.communityContext(p.rootIkm, p.communityGenesis, g + 2)
  const rotation = await makeAnchorRotation(prev, next, after)
  // COMMIT — ein synchroner Zug: Label, Lineage, aktueller Kontext
  p.communityGeneration = g + 1
  p.lineage = [...(p.lineage ?? []), rotation]
  p.selfCtx = next
  say(p, `Gemeinschaftsanker erneuert: Generation ${g + 1}`)
  const outbound: any[] = []
  const failures: { to: string, error: string }[] = []
  for (const [anchor, contact] of p.contacts) {
    if (!contact.trustGiven || contact.deactivated || !contact.channel?.own) continue
    try {
      const out = await withIssueLock(contact, async () => {
        if (contact.deactivated) return null
        const mapRev = peekRev(contact, 'mapRevOut')
        const mapping = await buildMappingArtifact(p, contact, anchor, when, mapRev)
        const prep = await prepareDoc(p, anchor, 'anchor-mapping', mapping, when, uuid(), {}, ent)
        if (contact.deactivated) return null   // Re-Check, danach kein await
        contact.mapRevOut = mapRev
        contact.sentMapping = mapping
        noteFirstGen(p, contact)
        return commitDoc(prep)
      })
      if (out) outbound.push(out)
    } catch (e: any) { failures.push({ to: contact.name ?? anchor, error: String(e?.message ?? e) }) }
  }
  return { rotation, outbound, failures }
}
/**
 * Der Producer-Sweep (Host-Vertrag): erst die V2-Pflichten, dann die
 * 5.4-Rekonziliation je Empfänger. Idempotent, per-recipient resilient,
 * Retries byte-identisch.
 */
export async function starRefreshAll (p: Person, when: number, ent: any = {}) {
  const outbound: any[] = []
  const failures: { to: string, error: string }[] = []
  for (const [anchor, contact] of p.contacts) {
    if (contact.deactivated) continue
    try {
      // die Neuausstellungs-Pflicht nach einer Kettung läuft AUCH
      // pausiert (Review 12, B-4); die Stern-Delivery braucht trustGiven
      if (contact.trustReissueDue) {
        const r = await reissueTrust(p, anchor, when, ent)
        if (r) outbound.push(...r.outbound)
      }
      if (!contact.trustGiven || contact.trustPaused) continue
      const r = await reconcile(p, anchor, when, ent)
      if (r) for (const env of r.envs) outbound.push({ to: contact, kind: r.kind, env })
    } catch (e: any) { failures.push({ to: contact.name ?? anchor, error: String(e?.message ?? e) }) }
  }
  return Object.assign(outbound, { failures })
}

// ── Empfang: registrierte Dokumente, Schema-validiert, atomar geackt ────
const asmOf = (contact: any) => contact.asm
export async function receiveTrustDoc (p: Person, env: any, when: number, ent: any = {}) {
  const opened = await C.openEnvelope(p, env)
  if (opened.error) return { handled: false }
  const ctx = p.contexts.get(env.rkid)
  const fromEntry = ctx && [...p.contacts.entries()].find(([, c]) => c.channel?.own?.anchor === ctx.anchor)
  if (!fromEntry) return { handled: false }
  const [fromKey, from] = fromEntry
  const doc = opened.doc
  if (opened.duplicate) {
    // 4.2: innerhalb der Retention wird EXAKT der gespeicherte Ack
    // byte-identisch erneut gesendet — nie ein neu erzeugter
    const stored = from.ackStore?.get(opened.digest)
    // der Store behält sein Exemplar — der Host bekommt eine Kopie (Encounter-Review 8, B-1)
    return { handled: true, duplicate: true, ack: stored ? { to: from, kind: 'delivery-ack/0.1 (Re-Ack, byte-identisch)', env: structuredClone(stored) } : undefined }
  }
  // Acks laufen durch dieselbe kritische Sektion (Delivery §6.2:
  // „stage 9 is a critical section whose lock set is the document
  // digest … it re-enters at stage 4"): der Verlierer zweier
  // gleichzeitiger identischer Acks sieht nach der Lock-Wartezeit den
  // completed-effect cache und meldet duplicate-known — nie
  // 'ack unknown ref' (Review 13, B-3)
  if (doc?.type === ACK_TYPE) {
    // deaktivierte Tupel nehmen keine NEUEN Acks für VISIBILITY-Dokumente
    // an (Review 37, B-3: „not the active head … MUST be rejected") —
    // ein Ack auf ein ENCOUNTER-Dokument bleibt gültig (Delivery 6.1:
    // „a late valid acknowledgement … transitions the status to
    // delivered"); die Unterscheidung fällt am referenzierten
    // Outbox-Eintrag in receiveAckInner (Encounter-Review 2, B-5)
    // Stufe 5 VOR dem Payload-Gate auch für Acks (Review 33, B-2), in
    // ihrer Ordnung: erst das DOKUMENTPROFIL (malformed), dann recipient =
    // eigener Anker (Empfänger-Prinzip) — Encounter-Review 8, B-2
    if (!schemaOk('rltp-delivery-document.schema.json', doc)) return { handled: true, error: 'malformed document' }
    if (doc.recipient !== from.channel.own.anchor) return { handled: true, error: 'wrong-recipient' }   // 6.2 stage 5 disposition
    return withContactLock(from, async () => {
      if ((p.deliveryCache ?? new Set()).has(opened.digest!)) return { handled: true, duplicate: true }
      return receiveAckInner(p, fromKey, from, opened)
    })
  }
  if (typeof doc?.type !== 'string' || !doc.type.startsWith(TT)) return { handled: false, doc }
  const slug = doc.type.slice(TT.length)
  if (![taskOf('anchor-mapping'), taskOf('star')].includes(slug)) return { handled: false, doc }
  // Dokumentprofil (Delivery §3): Schema-validiert, proof-frei, Bindungen
  if (!schemaOk('rltp-delivery-document.schema.json', doc)) return { handled: true, error: 'malformed document' }
  if (doc.proof !== undefined) return { handled: true, error: 'document proof forbidden (one carrier)' }
  // Stufe 5: recipient = eigener Anker (Empfänger-Prinzip). Die
  // issuer-Bindung ist eine TYP-Konsistenzregel (Stufe 8) und läuft je
  // Zweig NACH dem Payload-Schema (Review 32)
  if (doc.recipient !== from.channel.own.anchor) return { handled: true, error: 'wrong-recipient' }   // 6.2 stage 5 disposition
  // Kalender-Validität des DOKUMENTS (Review 12, B-3): „a verifier
  // MUST reject a date its RFC 3339 parser refuses" — das Dokument-
  // Schema lief bereits; die PAYLOAD-Kalenderprüfung sitzt je Typ NACH
  // dem Payload-Schema (Review 31: Stufe 7 vor Stufe 8)
  if (!C.calOK(doc.issuedAt)) return { handled: true, error: 'calendar-invalid issuedAt' }
  // Ack erst NACH der Payload-Validierung bauen (M-3: keine Krypto
  // für formwidrige Fracht), aber VOR jeder Zustandsmutation
  // (poisoning rule: ein Ack-Bau-Fehler konsumiert nichts); Effekt +
  // Cache + ackStore committen in EINEM synchronen Zug (4.2/§6.2)
  const mkAck = () => buildAck(p, from, opened.digest!, doc.threadId, when).then((a) => a.env)
  const commit = (result: any, ackEnv: any) => {
    C.effectDone(p, opened.digest)
    ;(from.ackStore ??= new Map()).set(opened.digest, ackEnv)
    return { ...result, ack: { to: from, kind: 'delivery-ack/0.1', env: ackEnv } }
  }
  const r0: any = await (async () => { switch (slug) {
    case taskOf('anchor-mapping'): {
      return withContactLock(from, async () => {
      // Reentry (B-1/B-2): Kopf noch aktiv? Duplikat inzwischen? Revision noch frisch?
      if (from.deactivated) return { handled: true, error: 'tuple deactivated' }
      if ((p.deliveryCache ?? new Set()).has(opened.digest!)) {
        const stored = from.ackStore?.get(opened.digest)
        return { handled: true, duplicate: true, ack: stored ? { to: from, kind: 'delivery-ack/0.1 (Re-Ack, byte-identisch)', env: stored } : undefined }
      }
      const m = doc.payload
      // Stufe 7 zuerst: Payload-Schema → failed(malformed) (Review 30)
      if (!schemaOk('visibility-anchor-mapping.schema.json', m)) return { handled: true, error: 'malformed mapping' }
      if (doc.issuer !== fromKey) return { handled: true, error: 'outer binding (issuer, Stufe 8)' }
      if (!C.calOK(m.body.issuedAt)) return { handled: true, error: 'calendar-invalid issuedAt' }  // Stufe 8, nach dem Schema (Review 31)
      if (doc.ceremony?.enactment !== undefined) return { handled: true, error: 'ceremony.enactment kann nicht nachrechnen (validation-failed)' }  // Stufe 8 — NACH dem Payload-Schema (Review 30)
      // §6.3 in Spec-REIHENFOLGE (Review 19, B-1), Tupel = Ankunftskanal
      // (Review 9, B-1: Cross-Tupel-Bindung = Schritt 3 der Liste)
      if (!(await verifyMapping(p, m, fromKey))) { say(p, `Mapping von ${from.name} verifiziert NICHT — verworfen`); return { handled: true, error: 'mapping' } }
      // 6.4, die GENERISCHE Revisionsregel (Review 11, B-2): höher
      // ersetzt · gleich + JCS-identischer Body = idempotenter Repeat
      // (No-op-Effekt, geackt — resends bleiben harmlos) · gleich +
      // anderer Body = Äquivokation (reject, Zustand bleibt) ·
      // niedriger = reject
      if (BigInt(m.body.revision) === BigInt(from.mapRevIn ?? '0')) {
        if (from.mapping && jcs(m.body) === jcs(from.mapping.body)) {
          const ackEnv = await mkAck()
          if (from.deactivated) return { handled: true, error: 'tuple deactivated' }
          return commit({ handled: true, idempotent: true }, ackEnv)
        }
        return { handled: true, error: 'equivocation (gleiche Revision, anderer Body)' }
      }
      if (BigInt(m.body.revision) < BigInt(from.mapRevIn ?? '0')) return { handled: true, error: 'mapping revision (niedriger)' }
      // §6.3 Bedingung 8 (6170): ein GEÄNDERTER self ohne Segment, das den
      // gehaltenen self als prev erreicht, wird abgewiesen wie jede
      // Abbildung, die eine Bedingung verfehlt — kein Ack, keine Mutation;
      // auch nach mehr als 64 verpassten Rotationen (6400)
      if (classifyMapping(from.selfAnchor, m.body) === 'rejected') { say(p, `Mapping von ${from.name} ändert den Anker ohne Kette zum gehaltenen — verworfen (6170)`); return { handled: true, error: 'mapping (6.3 condition 8, 6170: unlinked change of self)' } }
      const bindings = await mappingBindings(m.body)   // die Bindungen, die die Abbildung nennt (6610)
      const ackEnv = await mkAck()             // fehlbar VOR jeder Mutation
      // synchroner Re-Check nach dem LETZTEN await (Review 5, B-1): eine
      // Kettung unter dem Lock eines ANDEREN Kontakts kann dieses Tupel
      // während verify/mkAck deaktiviert haben — danach kein await mehr
      if (from.deactivated) return { handled: true, error: 'tuple deactivated' }
      if (BigInt(m.body.revision) <= BigInt(from.mapRevIn ?? '0')) return { handled: true, error: 'mapping revision (nicht strikt größer)' }
      // §6.3 Bedingung 8 nach dem LETZTEN await erneut: 'first', 'same'
      // (unveränderter self) oder 'rotation' (die Lineage trägt den
      // gehaltenen self als prev, 6160); ein unverketteter Wechsel bleibt
      // abgewiesen (6170). Ein Segment, das einen anderen Nachfolger eines
      // Ankers nennt, dessen Bindung die Beziehung hält, hat Bedingung 4b
      // schon verworfen
      const classification = classifyMapping(from.selfAnchor, m.body)
      if (classification === 'rejected') return { handled: true, error: 'mapping (6.3 condition 8, 6170: unlinked change of self)' }
      const held = mappingAnchors(m.body)   // die verifizierte Ankermenge (§6a.1 rung 2)
      from.mapRevIn = m.body.revision
      from.selfAnchors = [...new Set([...(from.selfAnchors ?? (from.selfAnchor === undefined ? [] : [from.selfAnchor])), ...held])]
      // Glieder und Bindungen der Beziehung (6610): über Rotationen
      // akkumuliert — Ketten-Zustand (2280)
      from.heldLinks = new Map([...(from.heldLinks ?? []), ...lineageLinks(m.body.lineage)])
      from.heldBindings = new Map([...(from.heldBindings ?? []), ...bindings])
      from.selfAnchor = m.body.self
      from.mapping = m
      from.trustReceived = doc.issuedAt
      promotionCommit(p, relIdOf(p, fromKey), m.body.self, fromKey, when, held, classification, bindings)
      say(p, classification === 'rotation' ? `${from.name} hat den Anker erneuert: neue Generation geprüft übernommen, die Kette bleibt gehalten`
        : `${from.name} vertraut dir: stabiler Anker geprüft übernommen (nur für dich beweisend)`)
      // der Producer-Sweep läuft NACH der Lock-Sektion (Reentranz!)
      return commit({ handled: true, disclosed: m.body.self, classification, fromName: from.name, __sweep: true }, ackEnv)
      })
    }
    case taskOf('star'): {
      // Stage-9-Lockmenge in kind: konkurrierende Chunks derselben
      // Assembly serialisieren über den Kontakt-Lock (§4.4)
      return withStarLock(from, async () => {
      if (from.deactivated) return { handled: true, error: 'tuple deactivated' }  // §6.4 — auch der Star-Pfad (Review 5, B-1)
      // Stage-4-Reentry nach Lock-Wartezeit (§6.2): ein inzwischen
      // verarbeitetes Duplikat erhält den gespeicherten Ack byte-identisch
      if ((p.deliveryCache ?? new Set()).has(opened.digest!)) {
        const stored = from.ackStore?.get(opened.digest)
        return { handled: true, duplicate: true, ack: stored ? { to: from, kind: 'delivery-ack/0.1 (Re-Ack, byte-identisch)', env: stored } : undefined }
      }
      const chunk = doc.payload
      if (!schemaOk('visibility-star.schema.json', chunk)) return { handled: true, error: 'malformed star' }
      if (doc.issuer !== fromKey) return { handled: true, error: 'outer binding (issuer, Stufe 8)' }
      if (doc.ceremony?.enactment !== undefined) return { handled: true, error: 'ceremony.enactment kann nicht nachrechnen (validation-failed)' }  // Stufe 8 — NACH dem Payload-Schema (Review 30)
      const b = chunk.body
      // Empfänger-Monotonie (5.2): nicht strikt größer als der
      // completed High-Water → verworfen
      if (BigInt(b.salt) <= BigInt(from.starSaltIn ?? '0')) return { handled: true, error: 'star replay (nicht strikt größer)' }
      // VERGIFTETER Salt (Review 21): nach einem Assembly-Konflikt
      // wird KEIN weiterer Chunk dieser Lieferung quittiert — sonst
      // kombinieren früh geackte, verlorene Pufferwirkungen mit
      // späteren Acks zu einer falschen Completion („the delivery
      // simply cannot complete until every seq is held")
      if (from.starPoison?.has(b.salt)) return { handled: true, error: 'star salt vergiftet (assembly conflict)' }
      const k = await kStarIn(from, fromKey, b.salt)
      if ((await hmacU(k, jcs(b))) !== chunk.proof.mac) return { handled: true, error: 'star mac' }
      // Re-Check nach den MAC-Awaits (Review 6, B-1): ab hier wird bis
      // zum jeweils nächsten await NUR NOCH LOKAL entschieden — die
      // Assembly ist Tupel-Zustand und darf nach einer Deaktivierung
      // keinen Chunk mehr aufnehmen („dies, atomically, with its
      // tuple's deactivation")
      if (from.deactivated) return { handled: true, error: 'tuple deactivated' }
      // 5.2a-Entscheidungen auf LOCALS (Review 6, B-1): höherer Salt
      // verdrängt, niedrigerer wird verworfen, threadId-Dissens
      // verwirft, Lücken puffern — GESCHRIEBEN wird erst nach Ack-Bau
      // und letztem Re-Check, in einem synchronen Zug
      const cur = asmOf(from)
      const displaced = cur && BigInt(b.salt) > BigInt(cur.salt)
      if (cur && !displaced && BigInt(b.salt) < BigInt(cur.salt)) return { handled: true, error: 'below open assembly' }
      const a = (!cur || displaced) ? { salt: b.salt, threadId: doc.threadId, chunks: new Map(), lastSeq: undefined as string | undefined } : cur
      if (doc.threadId !== a.threadId) { from.asm = undefined; (from.starPoison ??= new Set()).add(b.salt); return { handled: true, error: 'assembly conflict (threadId)' } }
      const seq = b.seq
      if (a.chunks.has(seq)) { from.asm = undefined; (from.starPoison ??= new Set()).add(b.salt); return { handled: true, error: 'assembly conflict (seq)' } }
      if (b.last && a.lastSeq !== undefined) { from.asm = undefined; (from.starPoison ??= new Set()).add(b.salt); return { handled: true, error: 'assembly conflict (two last)' } }
      const candLast = b.last ? seq : a.lastSeq
      if (candLast !== undefined && BigInt(seq) > BigInt(candLast)) { from.asm = undefined; (from.starPoison ??= new Set()).add(b.salt); return { handled: true, error: 'seq beyond last' } }
      // auch BEREITS GEPUFFERTE Chunks oberhalb von last verwerfen die
      // Assembly (Review 16, B-1): „a seq greater than the held last
      // chunk's … reject" gilt unabhängig von der Ankunftsreihenfolge
      if (candLast !== undefined) for (const s of a.chunks.keys()) if (BigInt(s) > BigInt(candLast)) { from.asm = undefined; (from.starPoison ??= new Set()).add(b.salt); return { handled: true, error: 'seq beyond last (gepuffert)' } }
      let ackEnv: any
      const complete0 = candLast !== undefined && (() => { for (let i = 1n; i <= BigInt(candLast); i++) if (String(i) !== seq && !a.chunks.has(String(i))) return false; return true })()
      if (!complete0) {
        ackEnv = await mkAck()
        if (from.deactivated) return { handled: true, error: 'tuple deactivated' }  // Re-Check (B-1), danach kein await
        from.asm = a                             // Übernahme JETZT — synchron mit dem Puffern
        if (b.last) a.lastSeq = seq
        a.chunks.set(seq, b)
        return commit({ handled: true, partial: true }, ackEnv)
      }
      // der KOMPLETTIERENDE Chunk: Union aus Puffer + aktuellem Chunk
      // OHNE Mutation berechnen und validieren, dann Ack + Re-Check,
      // dann Übernahme + completed-salt + Cache + Ack in EINEM
      // SYNCHRONEN Zug (§4.4); die UI-Auffrischung läuft NACH dem Commit
      const union: string[] = []
      for (let i = 1n; i <= BigInt(candLast!); i++) union.push(...(String(i) === seq ? b : a.chunks.get(String(i))).blinded)
      const sorted = [...union].every((x, i, arr) => i === 0 || arr[i - 1] < x)
      // 5300/5310: strikt aufsteigend über die ganze Union — Ordnung und
      // Duplikatfreiheit in einem
      if (!sorted) { from.asm = undefined; (from.starPoison ??= new Set()).add(a.salt); return { handled: true, error: 'assembly invalid (order/duplicate)' } }
      ackEnv = await mkAck()   // JETZT ist alles validiert (M-2), vor der Übernahme
      if (from.deactivated) return { handled: true, error: 'tuple deactivated' }  // Re-Check (B-1), danach kein await
      from.asm = undefined
      from.starSaltIn = a.salt
      // count: die Zahl der empfangenen geblendeten Einträge, lokal abgeleitet
      from.starReceived = { salt: a.salt, count: String(union.length), blinded: union }
      if (from.starPoison) for (const ps of from.starPoison) if (BigInt(ps) <= BigInt(a.salt)) from.starPoison.delete(ps)  // Gift unterhalb des High-Water ist gegenstandslos
      const out = commit({ handled: true, star: true }, ackEnv)
      await refreshStarInfo(p)
      say(p, `Kontakt-Update von ${from.name}: ${union.length} Kontakte (geblendet)`)
      return out
      })
    }
  }
  return { handled: false, doc } })()
  // Effekt fertig, Lock frei — jetzt der Producer-Sweep (5.4), dessen
  // reconcile die Empfänger-Locks selbst nimmt
  if (r0?.__sweep) {
    delete r0.__sweep
    const outbound = await starRefreshAll(p, when, ent)
    r0.outbound = [...outbound]
    if (outbound.failures.length) r0.outboundError = outbound.failures.map((f: any) => `${f.to}: ${f.error}`).join(' · ')
  }
  return r0
}
// completion (5.4-Automat): jeder Chunk-Ack streicht seinen Digest;
// der letzte lässt den Automaten laufen
async function receiveAckInner (p: Person, fromKey: string, from: any, opened: any) {
  // der referenzierte Outbox-Eintrag zuerst — seine KLASSE wählt die
  // Proof-Form des Acks (4.2/4.4: Encounter-Payloads tragen übertragbare
  // Signaturen → signierter Ack; Visibility-Payloads sind DV → MAC).
  // Digest-Gleichheit über die dekodierten Multihash-Bytes (Encounter
  // 2.3) — ein `z`-gerenderter ref trifft den `u`-Outbox-Schlüssel
  // Stufe 7 zuerst: das Payload-Schema (malformed) — VOR jeder Klassen-
  // oder Konsistenzregel der Stufe 8 (Encounter-Review 16, B-1)
  if (!schemaOk('payload-delivery-ack.schema.json', opened.doc?.payload)) return { handled: true, error: 'malformed' }
  const ref0 = opened.doc.payload.ref
  let refKey: string | undefined, o: any
  for (const [k, e] of outboxOf(from)) if (sameDigest(k, ref0)) { refKey = k; o = e; break }
  if (!o) return { handled: true, error: 'ack unknown ref' }   // Stufe 8: ref trifft kein gesendetes Dokument — keine Klasse wählbar
  const ENCOUNTER_KIND = o.kind === 'encounter-bundle' || o.kind === 'encounter-credential-delivery'
  const v = await verifyAck(p, from, opened.doc, ENCOUNTER_KIND ? 'signature' : 'dv')
  if (!v) return { handled: true, error: 'ack invalid' }
  if (o.threadId !== v.threadId) return { handled: true, error: 'ack unknown ref' }
  if (from.deactivated && !ENCOUNTER_KIND) return { handled: true, error: 'tuple deactivated' }   // nach den Awaits (Review 37, B-3), danach kein await
  // ZWEI Pflicht-Ebenen (Review 19, B-3): der Delivery-Ack erledigt den
  // TRANSPORT — die Visibility-Pflicht eines choice/report-Mappings
  // („resent … until answered by the counterpart's aligned mapping")
  // lebt weiter: der Eintrag bleibt für byte-identische Resends, bis
  // die Alignment-Antwort ihn retired. Die ALIGNMENT-Pflicht selbst
  // stirbt mit dem Ack (completed delivery, §6a.3).
  if (o.kind === 'continuity-mapping' && o.duty !== 'align' && !o.retired) o.acked = true
  else outboxOf(from).delete(refKey!)
  C.effectDone(p, opened.digest)
  if (o.kind === 'star') {
    const s = subOf(from)
    const f = s.inFlight.get(o.salt)
    if (f) {
      f.pending.delete(refKey!)
      if (f.pending.size === 0) {
        s.inFlight.delete(o.salt)
        if (BigInt(o.salt) > s.highWater) { s.highWater = BigInt(o.salt); s.baseline = f.view }
        // Completion räumt alle niedrigeren In-Flights (tot beim Empfänger)
        for (const [salt2, f2] of [...s.inFlight]) if (BigInt(salt2) < s.highWater) { for (const d of f2.pending.keys()) outboxOf(from).delete(d); s.inFlight.delete(salt2) }
        return { handled: true, completed: o.salt, advanced: true }
      }
      return { handled: true, partialAck: true }
    }
  }
  if (o.v2) delete from.trustReissueDue        // die V2-Pflicht stirbt mit der QUITTIERTEN Zustellung
  if (o.duty === 'align') from.contAligned = true   // 6a.3: Alignment-Pflicht stirbt mit der Completion
  // Encounter (Delivery 6.1): „delivered" ist der Sender-Status NUR auf
  // den gültigen Ack — der Host liest diese Marken, nie die Ankunft
  if (o.kind === 'encounter-bundle') from.bundleAcked = true
  if (o.kind === 'encounter-credential-delivery') from.counterAcked = true
  // the host correlates the ack with ITS active encounter (Encounter-Review 11, B-3):
  // the acked document's digest, thread and the counterpart anchor travel along
  return { handled: true, acked: o.kind, ref: refKey, threadId: o.threadId, peerAnchor: fromKey }
}
export async function receiveAck (p: Person, env: any) {
  return receiveTrustDoc(p, env, 0)
}