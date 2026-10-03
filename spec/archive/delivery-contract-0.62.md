# RLTP Delivery Contract

**Real Life Trust Protocol — service contract: Delivery**

- **Status:** Editor's Draft
- **Version:** 0.62.0-draft (sixty-second casting — the answer to
  the **thirty-ninth** adversarial joint round: **2 observable ·
  2 internal**, triage in `design/traeger-review39-2026-08.md`.
  Identity is at **0.50** in casting but carries one substantive
  paragraph of this round (§9.3), because the promise that broke
  is stated there. **B-1 is the first genuine design defect in
  four rounds:** Identity §9.3 promises that losing the carrier
  entry *alone* is replaceable, but the lost entry **is**
  `{nonce, generation}` — so the holder's fresh `N` arrives at a
  generation it cannot know, and the state machine answers
  `refused(stale-generation)` where two documents promised
  success. The repair is one sentence and one exchange: **the
  refusal carries the generation the carrier holds.** That
  discloses nothing, because the verdict is reachable only after
  both possession proofs, and a party that can open the address
  challenge may rebind at any higher generation regardless —
  strict monotonicity is an **ordering** rule, and the address
  challenge is the **access** rule. **B-2 was the fourth
  consecutive break of one kind:** round 38 fixed the restart rule
  in §4.4 and left it standing in §9, §11 and a vector string. So
  this casting answers the *class* rather than the site — the §3c
  withdrawal guard now scans `schemas/` too, carries the wordings
  of rounds 36–39, and takes a per-entry retraction marker where
  the generic one is too broad to bite. It found two further sites
  in this document the moment it was armed.
- **Editors:** Anton Tranelis
- **Date:** 2026-08-27
- **Vocabulary namespace:** `https://real-life.org/rltp/v1`
- **Task-type namespace:** `https://real-life.org/trust-tasks/`
- **Target Trust Tasks framework version:** 0.4
- **Conformance profile:** `rltp-delivery@0.62` (draft)
- **Supersedes:** version 0.61 (archived as
  `archive/delivery-contract-0.61.md`) and versions 0.60–0.1,
  archived alongside it.
- **Position:** not a layer. Delivery is the service behind the port
  the Encounter Layer requires; every layer may use it, none depends
  on its internals.

## Abstract

This document specifies how RLTP documents travel between people. The
delivery service moves **signed, anchor-encrypted, typed documents**
from one person to another — eventually, at least once, never silently
lost — and tells both sides honestly what it knows: the sender its
transport state, the receiver nothing the content does not prove
itself, and the sender **never** what the receiver decided.

Messages are **Trust Task documents** of private, versioned types under
`https://real-life.org/trust-tasks/` (ToIP DTGWG Trust Tasks framework
0.4, §6.5 private specifications). This casting registers four types
of its own — `encounter-bundle`, `delivery-ack`,
`encounter-credential-delivery`, `registry-declaration` — the RLTP
document profile all types
share, the sealed envelope they travel in, and the **task registry**
(4.4) through which companion layers register theirs: the membership
and access types (registered in their own documents), the
introduction and continuity types of the network-visibility layer,
and the member-mapping disclosure of the access layer.

Addressing is a **triple**, never an account (Section 5a): the
`rkid` a sender seals to, one per relationship; a queue locator
that is the carrier's own business and appears in no rule of this
contract; and a **control principal**, derived per (relationship ×
carrier) by Identity §7a, under which a recipient registers
addresses and collects what arrives. Submission needs no sender
identity, and abuse is answered with resources rather than
accounts. The point is a modest one, stated plainly: a carrier of a
relationship knows that relationship — but relationships must not
converge into a person at whoever carries them.

## Status of This Document

This is an **Editor's Draft** with no standing beyond its own
argument. It is developed together with the Encounter Layer through
an adversarial convergence process — each casting is reviewed in full
by an independent adversarial reviewer and recast, never patched. The
seventeenth casting's review round returned no findings and the pair
was judged blocker-free and compatibly implementable.

The eighteenth and nineteenth castings carried this document
through the **M-DID loop**: the Encounter re-pin to the
fresh-always wire, and the **task registry** of 4.4 as an
implementable contract — registry-entry form, published
operational constants, and the `registry-declaration/0.1` type
that carries them per party. The twenty-second casting took two
cuts from the replication joint loop: the service-identity `rkid`
clause was withdrawn, and the registry gained its direct-effect
prohibition.

The twenty-third casting was the **carrier cut**, cast jointly
with **Identity 0.14** against the decomposition
`design/traeger-beziehungsidentitaet-zerlegung-2026-08.md`
(editor's decisions E1–E9, 27.08.2026). Its subject is not what a
carrier reads — a carrier is key-blind and always was — but **under
which identity one faces it**, and what it can therefore add up
about who corresponds with whom, how often. Three things were true
before this casting and are now said: the recipient address is
already per relationship and stays so; submission carries no
sender identity at all; and §10 promised a bound ("derived service
identities bound what a transport learns") that Identity §7 never
defined for a delivery relationship. Section 5a redeems the
promise with the addressing triple, decides the principal-free
submission, and adds the two prohibitions the decomposition found
to be load-bearing: the role separation between storage entry and
delivery pickup, and the discipline of not bundling principals
into one collection session. What remains correlatable is stated
in §10 rather than implied away.

The twenty-fourth casting answered the **first** adversarial joint
round against that cut — 7 blockers and 4 majors, triaged in
`design/traeger-review1-2026-08.md` — jointly with **Identity
0.15**. The round did not dispute the architecture; it found the
carrier *interface* underspecified in five places where an
implementer would have had to invent something, and one place
where the text claimed more than it delivered. Registration now
proves possession of both halves rather than asking for honesty
(5a.3), with rebind and a closed outcome set; the admission story
is written out — what a carrier may check, what it never may, a
closed deterministic refusal set, and the flooding residual named
(5a.5); the conclusion duty closes the loop that let a decided
document be redelivered forever and an admitted one be dropped in
silence (5a.8, with `give-up-horizon` registered in 4.4 beside
`orphan-horizon` and ordered against it); the metadata claim of
principal-free submission is narrowed to what any construction
without a mix network can carry (5a.4); and the mappings onto the
neighbouring carrier forms become normative adapter obligations
with one determinate object each (5a.10).

The twenty-fifth casting answered the **second** round — 6
blockers, 1 major, 1 minor, triaged in
`design/traeger-review2-2026-08.md` — jointly with **Identity
0.16**, and it is worth naming what the round was about, because
it is not what the first one was about. Round 1 found things that
were **missing**; round 2 found things that were **claimed**. One
finding is answered by taking a promise back: the recovery branch
told a holder who had lost the whole register to rebind an address
it can no longer prove possession of, which is not a hard step but
an impossible one — it is withdrawn, and Identity §9.3 now decides
which of the two losses leaves a way back (5a.3, 5a.9). Two more
are claims that outran their declarations: admission called itself
deterministic while declaring a bare resource *kind*, so the kinds
now carry the parameters that make them computable and the claim
is cut to exactly their reach (4.4, 5a.5); and the TSP mapping
called itself a bijection when the property it needed was
**exclusivity** — a public or reused outer VID satisfies a
bijection and hands over the join anyway (5a.10). The fourth
sharpens "a change of intermediary" to the **direct** carrier, so
a hop change beyond it changes nothing. Two editor's decisions
arrive with the same casting: the recipient-issued admission token
stays unbuilt but is now **remembered on the record** with its
trigger and its retrofit point (DO-6), and the last open line of
the delivery addendum — a submission may be undelivered for weeks
but not **undescribed** for forty minutes — becomes the
`status-horizon` constant and the pre-transport report (4.4, 6.1).

The twenty-sixth casting answered the **third** round — 4 blockers
and 1 minor, triaged in `design/traeger-review3-2026-08.md` —
jointly with **Identity 0.17**, and three of the four blockers make
one point three times: *a rule that is named is not yet a rule that
can be computed.* The registration proof said "byte-precisely" over
a paragraph that would have admitted JCS, CBOR, length-prefixed
fields and raw concatenation alike — it now has one signed object
with its domain tag inside the signed bytes, fixed-length
challenges, a closed `purpose` set, and shipped transplant
negatives, because a transplant vector cannot exist without a
canonical input to transplant (5a.3). `rate` had parameters but no
algorithm, so two byte-equal declarations could still disagree at a
window edge and a flooder could burst across one — it is now
exactly a token bucket, with the verdict reading state only, the
clock discipline written down, and no boundary left to exploit
(4.4). Orphan ageing rested on an inequality between two horizons
measured from different events, which proves nothing and left a
queue that anyone could keep alive by depositing into it — it is
now a two-phase wind-up whose termination follows from closing
admission at a definite instant (5a.9). The fourth blocker is the
targeted queue flood, and it is the one that stays open on purpose:
the residual is restated at full strength, the reason no resource
parameter can close it is written down, rotation is made a
normative and terminating cure, and the actual closure remains
DO-6.

The twenty-seventh casting answered the **fourth** round — 5
blockers and 1 major, triaged in
`design/traeger-review4-2026-08.md` — jointly with **Identity
0.18**. Two of its blockers were **arithmetic and lifecycle faults
in rules this document had just declared executable**, which is
the useful kind of finding: the token bucket lost fractional
remainders and made capacity depend on polling instants (it is now
counted in integer micro-tokens, with restart defined), and the
nonce convergence rule could settle a race but could not express a
rotation (the register entry now carries a generation, and entries
are superseded rather than deleted). Two more were bounds this
contract had left open at the *registration* side rather than the
submission side — arbitrarily many self-minted pairs, and
challenge state before any queue exists — now closed
resource-shaped, with `registration-refused(capacity)` and
evictable challenge slots. The fifth is the recurring pin drift,
answered this time by fixing the pins **and** teaching
`scripts/validate.mjs` to catch prose pins, so the class cannot
recur silently.

And one finding is answered by classification rather than by
construction, deliberately: the targeted queue flood. Against a
third party the rules terminate it. What is left is the
relationship **insider**, and that residual is now carried in the
same words this stack already uses for fork spam — the cost falls
on the attacker's own relationship, the artifacts are attributable
within it, and the answer is social rather than mechanical. Saying
so precisely is the closure; a delivery contract is not the
instrument for a person who has decided to wreck their own
channel.

The twenty-eighth casting answered the **fifth** round — 7
blockers, 1 major, 1 minor, triaged in
`design/traeger-review5-2026-08.md` — jointly with **Identity
0.19**, and its findings sit almost entirely at the two seams
where a contract is thinnest: where it meets a **neighbouring
protocol**, and where it bounds a **resource it does not own**.

At the resource seam, the registration defence was keyed to the
connection, and connections are free to mint — so the bound was a
bound in name only. The challenge store is now bounded
**carrier-wide** as well as per connection, the capacity constants
are stated as carrier-wide facts, they are required even where the
admission resource is `none`, and the one thing this contract
genuinely cannot bound — TCP and TLS accepts, below the port line
— is named rather than implied away (4.4, 5a.3).

At the protocol seam, three findings and one honest correction of
our own text. The DIDComm mapping had exclusivity rules for TSP
and none for itself, so a connection DID could be a value the
person already publishes, or be bound to a prior DID by
`from_prior` — both now forbidden (5a.10). "One session, one
principal" was a MUST here and a SHOULD three sections later,
which is resolved by separating **authorization session**,
**mediation connection** and **transport socket**, and by saying
that 5a.7 was always about *timing* (5a.3, 5a.7). The TSP
lifecycle had no exit when the direct peer changed under a stable
`C`; it does now, and it is the obvious one once "one VID per
principal" is read as *at a time* rather than *forever* (5a.10).
And the correction: **5a.4's prohibition is a statement about this
contract's port**, not a claim that neighbouring transports carry
no hop identifiers — read as the latter it made a conforming TSP
ingress impossible, which is a defect in our sentence and not in
TSP (5a.4, 5a.10).

The twenty-ninth casting answered the **sixth** round — 3
blockers and 1 major, triaged in
`design/traeger-review6-2026-08.md` — jointly with **Identity
0.20**. It is the first round under the corrected blocker
definition, and the shape of the findings changes accordingly:
nothing is re-argued, and all three blockers are the same species
of error — a rule that constrained the **wrong object**. The
challenge budget constrained stored slots rather than performed
work, and a limit answered by eviction is not a limit at all; the
TSP rule constrained the *visibility* of an outer VID, which in a
routed model is not ours to forbid, instead of its *linkability*,
which is; and the Live Delivery rule constrained a socket that
this contract's own session table had already placed below the
port line. Each is fixed by moving the constraint onto the object
it was always about — work, linkability, and the logical
mediation relationship — rather than by adding machinery.

The thirtieth casting answered the **seventh** round — 3 blockers,
1 major, 1 minor, triaged in
`design/traeger-review7-2026-08.md` — jointly with **Identity
0.21**. The round is worth reading for its shape: none of the
three blockers disputes a decision of the previous casting, and
all three are places where a recast rule left a **consumer**
standing in the old form. That is a known failure class in this
repository — the replication loop paid for it twice — and it has
one honest answer, which is to sweep the consumers deliberately
rather than to wait for a reviewer to enumerate them. This casting
therefore does both: it fixes the three (the challenge slot
becomes a non-refundable **charge**, so the rate the previous
casting claimed is finally true; the TSP **ingress** rule gets the
same three prohibitions the collecting side got; §11's second,
contradicting verdict on a shared transport is withdrawn), and it
then walks §5a and §7a against the 0.29 forms and repairs what the
round had not reached — a §11 ingress verdict still saying
"public", a Section 9 paragraph still saying "evictable", and a
sentence still listing Live Mode among the cross-principal
answers.

The thirty-first casting answered the **eighth** round — 2
blockers and 1 minor, triaged in
`design/traeger-review8-2026-08.md` — jointly with **Identity
0.22**, and the round is the smallest of the series. Its Delivery
blocker is the last piece of the charge introduced one casting
earlier: a charge that is never refunded still needs a **start**
and a **restart**, and 0.30 gave it neither, so a carrier could be
restarted in a loop to reissue its whole budget. The fix is
constrained by a property this document already holds — nothing
durable is written before both proofs verify — and it turns out
that property is not an obstacle but the shape of the answer: the
charge starts at the budget check, and a restart simply **assumes
the whole unreserved pool is held** for one `challenge-lifetime`
(the reserve of a held binding resumes free — 4.4 states why the
two populations differ). No record
survives a restart because none needs to, and a restarted carrier
has strictly less capacity than it had. The minor removes an
overstatement that had crept into the socket residual.

The thirty-second casting answered the **ninth** round — 2
blockers, triaged in `design/traeger-review9-2026-08.md` — jointly
with **Identity 0.23**. Both are about **saying what is true**
rather than about building anything. The first is a protection
claim this document made about itself and could not keep: the
registration-side denial was called bounded and self-healing, and
it is neither — an attacker re-takes the charges at every lapse
and can keep new onboarding at a carrier shut indefinitely. That
sentence is withdrawn, the attack is classified where it belongs
(the DO-6 family, with its reach written out), and the one thing
that *can* be done without asking who is calling is done: a floor
reserved for addresses the carrier already carries, so a person
coming back to an existing relationship is never in the queue
behind an attacker. The second is an outcome that had a name but
no condition — `duplicate` — now fixed to the only bytes a
key-blind carrier can compare, with its state and its metering
decided against the two hazards that shape them: a free replay
channel on one side, a single message counted many times on the
other.

The thirty-third casting answered the **tenth** round — 2 blockers
and 1 major, triaged in `design/traeger-review10-2026-08.md` —
jointly with **Identity 0.24**. Both blockers are of the kind the
previous round introduced and this one continues: a **protection
claim the constants did not support**. And both have the same
cause, which is worth naming: a pattern was adopted **halfway**.
The reserve was given a rule about *naming* an address without the
rule about *how many times* it may be named — so the public value
that an `rkid` is became a key to the floor. The global byte bound
was adopted without the floor that makes a global bound safe — so
one queue could take the carrier while this document went on
claiming a one-relationship blast radius. In both cases the
missing half already existed in this stack, in the Replication
Contract's §9, and this casting simply finishes taking it.

The thirty-fourth casting answered the **eleventh** round — 5
blockers, triaged in `design/traeger-review11-2026-08.md` —
jointly with **Identity 0.25**. The round is the largest since the
fifth, and the reason is worth stating plainly rather than
softening: three mechanisms introduced in the last four castings
were each **built to about eighty percent**, and this round found
all three remainders at once. A reserve that isolates nothing
because it is a pool. A floor that decides on the wrong side of
the deposit and forgets a state the same document defines two
sections later. A register ordering that never leaves the
register, so possession — which is not monotone — decides at the
carrier instead. In each case the missing piece is small and the
consequence was not, and in each case the fix removes machinery or
replaces it with arithmetic rather than adding to it: one
accounting quantity instead of two rules, one field in a proof
instead of a synchronization duty, one constant withdrawn.

The thirty-fifth casting answered the **twelfth** round — 2
blockers, 1 major, 1 minor, triaged in
`design/traeger-review12-2026-08.md` — jointly with **Identity
0.26**. Both blockers are a class this loop had not produced
before: **neither state machine is wrong, and their composition
is**. The register's tie rule is right; the carrier's monotonicity
rule is right; together they made the canonical principal
unregistrable. The generation check is right; the wind-up's
release is right; together they let a superseded generation return
by waiting. Findings of this shape are a good sign for the parts
and a warning about the seams, and the answer to both was to look
at what the *pair* does rather than to change either — which is
also why one of the two fixes is a **proof that a repair is
impossible** (the tie-breaker cannot travel without becoming a
cross-carrier join key) followed by naming the state correctly,
rather than a mechanism.

The thirty-sixth casting answered the **thirteenth** round — 3
blockers and 2 majors, triaged in
`design/traeger-review13-2026-08.md` — jointly with **Identity
0.27**, and it is largely a casting of **retractions**. Three
findings are claims the previous casting made and could not keep:
an impossibility argument that was simply invalid, an exit at the
generation maximum that contradicted the companion it cited, and a
residual bounded by a misreading of this document's own
`key-retention`. A fourth is a vector that tested a state sequence
which cannot occur.

There is a pattern in that, and it is worth naming rather than
letting the next round find it again: **all four failures are of
reasoning offered in support of a rule, not of the rule itself.**
The refusal-and-rotate path works; its justification was wrong.
The tombstone is right; its retention argument was wrong. The
maximum-generation corner has an exit; the one named was
unreachable. A rule that is right for a stated reason and the
reason is false is not a smaller problem than a wrong rule — it is
the same problem, discovered later. So this casting keeps every
mechanism and rewrites what is said about them, and where nothing
true was available it says so and records the question (DO-7)
instead of arguing.

The thirty-seventh casting answered the **fourteenth** round — 2
blockers and 2 majors, triaged in
`design/traeger-review14-2026-08.md` — jointly with **Identity
0.28**, and its first blocker is a lesson about corrections. One
casting ago this document removed an expiry edge from the binding
tombstone because the argument for that edge was false. It then
supplied a *new* argument for the opposite arrangement, and that
argument was false too: an attacker mints its own addresses,
proves both halves honestly, and accumulates permanent records at
will. **Two consecutive castings, two wrong justifications for the
same object** — which is why the fix this time is not a third
argument but the discipline every other resource in this contract
already follows: bound it, name the overflow rule, and compute
what the overflow costs and who can use it. The second blocker is
of a kind this document had not been asked before: its adapter
obligations point **outside** the stack, and an external target
without a version is not a target. Where a version can be named it
now is; where it cannot be named honestly, the duty to name it is
placed on the adapter profile that will know it, at the stage
where that becomes true.

The thirty-eighth casting answered the **fifteenth** round — 3
blockers, 2 majors and 1 minor, triaged in
`design/traeger-review15-2026-08.md` — jointly with **Identity
0.29**. Its blockers share a shape worth naming: each is a place
where this contract **said** something was fixed and had not
actually fixed it anywhere a machine could read. A signed artifact
described in prose but absent from the schema directory. An
eviction called "deterministic" whose order was partial. An
external reference whose permitted form — a date — does not
identify bytes. The repairs are correspondingly mechanical rather
than argumentative: ship the schema and put it in the gate, make
the order total and give the vector a tie that forces it, and
allow only identities that name bytes.

The schema is the one worth a second sentence. Adding it to the
local gate immediately produced two failures — a missing `sig` in
the validated object and a `generation` requirement that made no
sense for `collect` — neither of which any amount of re-reading
had caught. That is what a gate is for, and it is why "the vector
is green" was never the same claim as "the artifact is defined".

The thirty-ninth casting answered the **sixteenth** round — 3
blockers, 1 major, 1 minor, triaged in
`design/traeger-review16-2026-08.md` — jointly with **Identity
0.30**. Its blocker of substance is the third instance of one
pattern, and the pattern is worth stating because it has now cost
three castings: **a bound that is declared over a resource, and a
path to that resource that the declaration does not cover.** The
challenge budget bounded issuance and not verification, because
nothing said when a challenge is spent. Before that it bounded
concurrency and not work, because a completed exchange returned
its slot. Before that it bounded per connection, and connections
are free. Each time the arithmetic was right about what it
measured and the sentence around it claimed more. The repair here
is the same in kind as the other two — spend the resource at the
first moment the expensive path can be entered — and the
arithmetic now covers the whole exchange.

The other two blockers are consumer remnants of the previous
casting, both in **Section 11**, which has now been the forgotten
consumer three rounds in a row. That is no longer a coincidence to
note in a journal; it is a place a sweep must stop at every time,
and this casting's sweep does.

**This fortieth casting answers the seventeenth round** — 3
blockers, 3 majors, 1 minor, triaged in
`design/traeger-review17-2026-08.md` — jointly with **Identity
0.50**. Five of its seven findings are the same species, and it is
one this document has now met often enough to name without
flinching: **a claim that survived its own retraction.** A
regex that stayed wider than the prose it implements. A reference
that accumulated three statuses because each repair added a
sentence instead of removing one. Two vector fields still
asserting what the contract had already withdrawn. A companion
locator that a genealogy filter kept excusing. None of them is a
wrong decision; all of them are text that outlived the decision it
described.

Two of the repairs are therefore mechanical rather than
argumentative, and deliberately so. The canonical-encoding fix was
applied to **all 24 schemas** that carried the same latent gap
rather than only the one the round found. And the validator now
treats a pin followed by a section reference as a **locator** —
current by construction, never excusable as history — because
that single distinction is what let a stale companion pin sit
through three castings.

Known open questions are
collected in Section 12; the joint convergence loop with Identity
continues. Feedback is welcome via the issues
of the publication repository
(github.com/real-life-org/rltp-spec).

## 1. Introduction (informative)

### 1.1 Essence and principles

- **Eventually, at least once, never silently lost.** Delivery time is
  unbounded and never affects validity (Encounter 1.3). At-least-once
  makes duplicates and lost acknowledgements the *normal case*, so
  idempotency is law, not precaution. A document the service accepted
  is delivered or reported failed; silent loss is non-conformant.
- **Documents and promises, never pipes.** No normative statement
  mentions a relay, a broker, a socket, or a wire. Transport-internal
  signals never appear here.
- **Authenticity always has exactly one carrier.** Where a document's
  payload contains material signed under the Layer-1 binding rule
  (credentials, cards), that material is the carrier and the document
  needs no proof. Where it does not — the acknowledgement — the
  document itself carries a proof. Nothing is trusted because a
  channel said so.
- **The acknowledgement is arrival, and arrival only.** It is
  machine-generated at the durable recording of a document's defined
  effect, waits on no human, and carries no statement about any
  decision. The mutual-recognition moment of an encounter is carried
  by the counter-credential itself, not by any receipt.

### 1.2 The user experience this serves (informative)

After A scans and confirms, A's app shows a waiting state; the arrival
acknowledgement dissolves it ("nothing more to do on your side"), and
its absence within `ack-wait` flips A's screen to the optical
presentation of the sent card — the same enactment on another
carrier. When B's counter-credential later arrives, A sees the
relation confirmed; B's own view becomes mutual only when A's
credential reaches B (Encounter 4.2 — every view is local). Section 8
gives both state machines; a lost acknowledgement after B's commit
reconciles through redelivery and `duplicate-known`, never through a
second enactment (6.3).

## 2. Conventions and Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" are to be interpreted as described in BCP 14 [RFC2119]
[RFC8174] when, and only when, they appear in all capitals.

The **interim securing profile** of Encounter 2.3 applies (did:key
anchors, Ed25519/X25519 as Multikeys with decoded multicodec
verification, `eddsa-jcs-2022` embedded proofs, JCS, SHA-256,
multibase, RFC3339-UTC-`Z` timestamps).

**Document** — a Trust Task document conforming to the RLTP document
profile (Section 3). **Document digest** — the multibase-encoded
multihash (Encounter 2.3: emit `u`, accept `u`/`z`, SHA-256) over
`JCS(document)` of the plaintext document; the document's identity for
idempotency and acknowledgement reference, and format-identical to
DTGWG `digestMultibase` values. **Sealed
envelope** — the encrypted form in which a document travels
(Section 5). **Disposition** — the receiver's classification of a
processed envelope (Section 6).

**Carrier** — a party that holds delivery queues on behalf of
recipients: the adapter side of this contract, below the port
line, key-blind by construction (Section 5a). **Control
principal** — the carrier-relationship identity of Identity §7a,
the identity a recipient presents to one carrier for one
relationship. **Queue locator** — a carrier-local, opaque handle
for one queue (5a.1).

*Disambiguation, because the word does double duty in ordinary
English:* where 1.1 says authenticity "has exactly one carrier",
and where 1.2 and 6.3 speak of the **carrier switch** to the
optical leg (Encounter 5.8), the word means "that which carries"
and names no party. The role defined here is always the party of
Section 5a, and every normative sentence about it points there.

| Term | Fragment |
|---|---|
| Document digest | `#DocumentDigest` |
| Sealed envelope | `#SealedEnvelope` |
| Disposition | `#Disposition` |
| Delivery acknowledgement | `#DeliveryAck` |
| Carrier | `#Carrier` |
| Control principal | `#ControlPrincipal` |
| Queue locator | `#QueueLocator` |

## 3. The RLTP Document Profile

RLTP delivery documents are Trust Task documents [TT], target framework
version **0.4**, under the private task-type rules of TT §6.5. The
profile — normative wire form
`schemas/rltp-delivery-document.schema.json` — requires:

- `id` — REQUIRED; UUID v4.
- `type` — REQUIRED; a registered RLTP task type
  (`https://real-life.org/trust-tasks/<slug>/<MAJOR.MINOR>`). Slugs
  never match `^trust-task(-|/)?` (TT §6.1).
- `issuer`, `recipient` — REQUIRED, in-band, as anchors. A consumer
  MUST reject a document whose `recipient` is not its own anchor
  (TT §7.2 rule 5 — the receiver principle at the envelope level).
- `threadId` — REQUIRED: fresh (UUID v4) on thread-opening documents,
  equal to the answered document's `threadId` on responses.
- `ceremony` — OPTIONAL, and **entirely unconstrained by the task
  specifications**, per TT §4.11.1: a task specification declares
  nothing about ceremonies, absence is never grounds for rejection,
  and every framework-defined member (`enactment`, `step`, `round`,
  `terminal`, `prev`, …) passes through unrejected. One RLTP
  *profile-level* rule applies to consumers of this contract: **where
  the member is present and carries an `enactment`, that value MUST
  recompute** against the enclosed material or the document is
  `failed(validation-failed)`; a member that grants nothing can still
  not be allowed to lie. It grants no authority (TT §7.2 rule 9); the
  authoritative enactment binding always lives in the enclosed
  credential itself.
- `issuedAt` — REQUIRED.
- `expiresAt` — MUST be absent. Delivery time is unbounded; validity
  windows live in payloads and ceremonies, with issuance semantics.
- `proof` — REQUIRED on `delivery-ack` and on
  `registry-declaration` (4.4) — the two types whose authenticity
  has no other carrier (1.1); MUST be absent on the other types of
  this casting, whose authenticity is carried by the signed
  payloads inside. Where `proof` is present, TT §4.8.2 audience binding is
  satisfied by the in-band `recipient`.
- `payload` — REQUIRED; governed by the type's **payload schema**.
  For the types this document registers itself, the schema's `$id`
  is the Type URI (TT §6.3); companion-registered types dispatch
  through their registry entry (4.4), whose schema reference is
  authoritative — one dispatch rule, stated once. Payload schemas describe only
  the payload; the outer members are validated by the document-profile
  schema.

**Offline schema rule:** implementations MUST pre-register every
schema of this contract by its `$id` and MUST NOT resolve any `$ref`
over the network. The shipped `schemas/` directory is the complete
closure; a validator that cannot resolve a reference from its local
registry treats the document as `malformed`.

Unknown `type` → the document MUST be rejected with disposition
`failed(unknown-type)`; a document that would have an effect is never
silently ignored.

## 4. Registered Task Types

Each type below is a private Trust Task specification with: Type URI,
target framework 0.4, payload schema (shipped), proof declaration (per
Section 3), and the consistency rules stated here.

### 4.1 `encounter-bundle/0.1`

The transmission of the one-scan ceremony (Encounter 5.8): the
scanner's sent card and step credential.

- `payload`: `{ "card", "credential" }` per
  `schemas/payload-encounter-bundle.schema.json`.
- `threadId`: fresh (opens the exchange). `proof`: absent.
- **Declarations (TT §7.3):** side effects: *mutating* (creates the
  enactment record); exposure: recipient-only, never retained by
  third parties.
- **Outer/inner consistency (MUST, before any effect):**
  `issuer` = `card.anchor` = `credential.issuer`;
  `recipient` = `credential.credentialSubject.id`;
  the card carries a sent-challenge with `sentTo` = `recipient` and
  `boundTo` = `credential.credentialSubject.challenge`
  (Encounter 6); a present `ceremony.enactment` equals
  `credential.credentialSubject.enactmentBinding`. Under
  fresh-always enactment (Encounter §4.4) every anchor of these
  equalities is a **fresh pair anchor** of the enacting parties;
  the checks are anchor-class-neutral and stand unchanged.
- **Pre-lock validation (MUST, in order — validate, then consume:
  read-only against local state **except for Encounter 5.3's aging
  latch, which every resolution writes**, and consuming nothing;
  together with the authoritative in-lock resolution this implements
  the acceptance set of Encounter 5.6):**
  1. document profile + payload schema valid; timestamps
     calendar-valid; keys decode to correct multicodec + length;
  2. card proof verifies under `card.anchor`;
  3. credential proof verifies under its issuer anchor;
  4. `credential.credentialSubject.id` = the local anchor;
  5. the credential's bound challenge **resolves** (Encounter 5.3;
     the resolution itself latches any held aged value it observes —
     the latch is monotone and lock-free, so this provisional
     observation already stands) to `open` or `recorded` — an
     `unknown` resolution ends the pre-lock checks, but is **never
     final pre-lock**: the evaluation skips the remaining checks and
     proceeds directly to the serialization point (6.2 stage 9),
     where the authoritative resolution decides. If it is still
     `unknown`, the disposition is `failed(validation-failed)` — the
     one state-free outcome that covers garbage, foreign,
     rotated-away, and record-gone bundles alike, always produced
     under the lock. If it is **any other state** (the state moved —
     e.g. the optical record arrived between pre-lock and lock), the
     evaluation MUST NOT proceed on the skipped checks: it releases
     the lock and **re-enters at stage 4** (the waiter rule of 6.2),
     completing every check under the new state before any effect;
     **`credentialSubject.ceremony` equals this
     ceremony (`encounter-scan@0.25`)** — a credential labelled
     with any other ceremony is `failed(validation-failed)`, so the
     record's ceremony is grounded rather than copied from the
     sender's label; and the enactment binding recomputes per
     Encounter 5.4 from {the resolved own challenge, card's
     sent-challenge};
  6. **the issuance window (Encounter 5.6 step 6):** `validFrom` and
     `proof.created` inside the closed interval anchored at `t_ch`
     from the resolution — held with an `open` value by its owner,
     held in the record for a `recorded` one (Encounter 5.5/5.3) —
     and `proof.created ≥ validFrom − skew-tolerance`.

  This pre-lock resolution is **provisional**; the resolution
  repeated inside the critical section is authoritative and alone
  selects the effect.
  Only after 1–6 pass does evaluation reach the final stage (6.2
  stage 9), whose critical section is keyed for bundles on **both**
  the document digest and the credential's bound challenge — the
  **record key**, the same serialization point the optical input of
  Encounter 5.8 passes through. Inside that section, and only there,
  the bound challenge is **re-resolved authoritatively** (Encounter
  5.3), and the resolution selects the effect:

  **`open` → record-creating effect:** the explicit future check
  (Encounter 5.5) — an own challenge future-dated beyond
  `skew-tolerance` is `failed(gate-future)`; the expiry side is
  structural (an aged value never resolves `open`), so no
  `gate-expired` disposition exists — then the effect committed **as
  one durable transaction**: the enactment record, **the accepted
  credential itself with its direction and credential digest** (the
  state Encounter 4.2 needs to hold `received` across restarts), the
  completed-effect cache entry, **and the acknowledgement document
  itself, retained with the cache entry** (4.2). After commit the
  credential **is accepted**; no later check can fail it.

  **`recorded` → the record decides:** a record whose counterparty is
  **not** the document issuer means the challenge was consumed by a
  different enactment — `failed(consumed-challenge)`, the only way
  this disposition arises, and it is stable under waiter re-entry:
  the record survives, so re-resolution yields `recorded` again and
  the same disposition. Otherwise (the offline path completed first,
  Encounter 5.8) the enclosed card MUST be **JCS-identical to the
  counterparty card stored in that record** — a bundle combining a
  valid credential with any other card, however well signed, is
  `failed(validation-failed)`. The binding is verified against the
  record, and the credential MUST pass Encounter acceptance (5.6) in
  full, including uniqueness; `ERR_STALE_ISSUANCE` maps to
  `failed(stale-issuance)`, every other rejection to
  `failed(validation-failed)`, and nothing is consumed. On pass, the
  **record-aware effect** committed as one durable transaction: the
  accepted credential with direction and credential digest, the
  completed-effect cache entry, and the retained acknowledgement —
  **no gate, no record creation, no consumed-challenge conflict**.

  **`unknown` → `failed(validation-failed)`:** nothing exists to
  consume; a provisional pre-lock pass only means the state moved.

  Any failure before a committed effect consumes nothing and earns no
  acknowledgement (the poisoning rule). Documents with **distinct
  digests** competing for one challenge serialize on the record key:
  exactly one commits first; each later evaluation re-selects its
  branch against the new state — an identical enclosed credential
  (equal credential digest) lands idempotently via Encounter 5.6
  step 8 with its own effect and acknowledgement; a conflicting
  credential **from the record's counterparty** (it passed the
  counterparty check) is `failed(validation-failed)`; a foreign
  counterparty is always `failed(consumed-challenge)` (above) —
  never a second record.

### 4.2 `delivery-ack/0.1`

The arrival acknowledgement (DO-1).

- `payload`: `{ "ref": <document digest of the acknowledged document>,
  "meaning": "received" }` per
  `schemas/payload-delivery-ack.schema.json`.
- **Declarations (TT §7.3):** side effects: sender status update only;
  exposure: retained only by the acknowledged document's sender.
- `threadId`: = the acknowledged document's `threadId`.
- `proof`: **REQUIRED** — `eddsa-jcs-2022` under the ack's `issuer`
  anchor. An unsigned or foreign-signed acknowledgement is invalid.
- **Consistency (MUST, on receipt):** proof verifies under `issuer`;
  `issuer` = the acknowledged document's `recipient`; `recipient` =
  the acknowledged document's `issuer`; `threadId` matches; `ref`
  matches a document this sender actually sent on that thread. Any
  failure → the ack is discarded (`failed(validation-failed)`) and the
  sender's status is unchanged.
- Generation: **automatic at the durable recording of the referenced
  document's defined effect** (4.1: the committed bundle effect,
  record-creating or record-aware; 4.3: durable buffering). It MUST NOT wait for, depend on, or reveal any
  human decision, and MUST NOT be sent for a document rejected at
  document level. **The acknowledgement document is created inside
  the effect's transaction and retained together with the
  completed-effect cache entry it belongs to** — both persist at
  least `key-retention` after commit (Section 7), the bound that
  outlives every adapter's give-up horizon and therefore every live
  redelivery. Within that bound, redelivery of a `duplicate-known`
  document MUST re-send exactly this stored document, byte-identical
  — never a newly generated one. After the bound, entry and stored
  acknowledgement MAY be discarded together; a document redelivered
  later is re-evaluated as fresh, and byte-identity binds only within
  the retention bound. The re-evaluation is harmless in both possible
  states: a bundle whose enactment record still exists (records live
  for the life of the relation, Encounter 5.5) lands in the
  **record-aware effect** and is accepted idempotently (equal
  credential digest, Encounter 5.6 step 8), earning a **freshly
  generated** acknowledgement; a bundle whose record is gone fails
  **by derivation from the state model**: with the record deleted,
  the bound challenge resolves `unknown` (Encounter 5.3 — no
  challenge history exists beyond open values and records), so
  check 5 of 4.1 fails — `failed(validation-failed)` — and no gate
  is ever reached or needed. Its sender has long reported
  `failed` either way, and a late acknowledgement only transitions
  that status honestly (6.1).
- Meaning, normatively and honestly bounded: *the recipient's anchor
  **attests** that the document reached its authenticated device and
  that its defined effect is durably recorded.* It is an attestation,
  not a proof of causal receipt — a recipient who signs falsely harms
  only their own state, and the sender's `delivered` is exactly as
  strong as that attestation. Implementations MUST NOT present it as
  acceptance, verification beyond the recording gate, or any human
  act (Encounter 7.4). `meaning` is a closed one-value set in this
  version.
- **Terminal.** The acknowledgement is a **terminal document**: its
  defined effect (the sender-status update, idempotent by
  construction) earns a completed-effect cache entry like any other,
  retained at least `key-retention` after commit — the same bound as
  every cache entry — but it generates **no acknowledgement of its
  own**: there is no acknowledgement of an acknowledgement, and the
  chain ends here by rule, not by accident. A stage-4 duplicate of a
  terminal document is `duplicate-known` with **nothing to re-send**
  (6.2).

### 4.3 `encounter-credential-delivery/0.1`

Post-enactment delivery of a step credential: the counter-step of
`encounter-scan` (`"counter"`), or a standalone credential delivery
outside any bundle thread (`"deliver"`).

- `payload`: `{ "credential" }` per
  `schemas/payload-encounter-credential-delivery.schema.json`.
- **Declarations (TT §7.3):** side effects: buffering only; exposure:
  recipient-only.
- `threadId`: fresh for standalone deliveries (`ceremony.step` =
  `"deliver"` when the member is used); = the bundle's `threadId` for
  a one-scan counter-step (`"counter"`). `proof`: absent.
- **Outer/inner consistency (MUST, before any effect):**
  `issuer` = `credential.issuer`; `recipient` =
  `credential.credentialSubject.id`; if `ceremony` is present, its
  `enactment` = `credential.credentialSubject.enactmentBinding`.
  A document violating these is `failed(validation-failed)` and
  produces no acknowledgement — an acknowledgement never goes to a
  party other than the credential's own issuer.
- **Defined effect:** durable buffering of the enclosed credential for
  Encounter acceptance. The acknowledgement is sent at buffering;
  Encounter acceptance (5.6) runs separately, never acknowledges, and
  its outcome is never signaled to the issuer (Encounter 7.4).

### 4.4 The task registry — companion-registered types

Every type under the task-type namespace shares the document
profile (Section 3), the sealed envelope (Section 5), and the
disposition and acknowledgement rules (Section 6). Beyond the
four types this document registers itself, the registry's
members are registered **where their semantics live**, each as a
private Trust Task specification naming its type URI, payload
schema, proof declaration, and consistency rules:

- `membership-invite/0.2` · `membership-accept/0.2` ·
  `access-operation/0.1` · `membership-evidence/0.1` — Membership
  Tasks §3;
- `key-delivery/0.1` · `removal-notice/0.1` — Access §10;
- `introduction-request/0.1` · `introduction-forward/0.1` ·
  `introduction-reply/0.1` · `introduction-ack/0.1` ·
  `introduction-voucher/0.1` — Network Visibility §8.1; payload
  schemas `schemas/visibility-payload-introduction-request.schema.json`,
  `…-forward…`, `…-reply…`, `…-ack…`, `…-voucher….schema.json`;
  proofs per Visibility §2.1 (the artifacts carry their own MACs
  and signatures; the documents carry none — one carrier);
- `continuity-probe/0.1` · `continuity-mapping/0.1` — Network
  Visibility §6a.2/§6a.4; the payload is the artifact itself
  (`schemas/visibility-continuity-probe.schema.json`,
  `schemas/visibility-continuity-mapping.schema.json`), travelling
  on the enactment tuple's own channel (its §6a.3);
- `member-mapping/0.1` — Access §5.5; payload
  `schemas/member-mapping.schema.json`, travelling on the existing
  relationship channel between discloser and addressee, never a
  group space.

**The registry-entry form (normative):** a registry is a set of
entries, one per type, each carrying exactly: the **type URI**
(under the task-type namespace) · the **payload schema
reference** (the shipped schema file the receiver validates
against — dispatch resolves through the entry, so a companion
schema needs no `$id` equal to the type URI; §3's `$id` rule
binds the types this document registers itself) · the **proof
declaration** (proof present/absent and its carrier, per the
registering specification) · and optionally **operational
constants** of the role (below). A type absent from a receiver's
registry is `unknown-type` (6.2), exactly as for this document's
own types; registration creates no authority anywhere — every
type's effects are governed by its own specification, **under one
global rule no registration can waive: a registered type's
defined effect MUST NOT write replicated state directly. Where an
effect touches replicated state, it does so exclusively by
handing full entries with their closure to the Replication
Contract's ingest admission (Replication §7, I14) — the admission
verdict, not the delivery disposition, decides any replicated
effect.** A registry entry whose specification defines a direct
replicated write is not registrable.

**Operational constants and `registry-declaration/0.1`
(normative):** a party serving a role whose specification names a
published constant declares it **per party** — fixed,
non-adaptive — and its counterparts MUST hold it before they
depend on it. The carrier is this contract's own task type
`registry-declaration/0.1`: `payload`
`{ "declaration": { "role": <type URI of the served role>,
"revision": <int-string, ≥ 1>,
"constants": { <name>: <value string> } } }`
per `schemas/payload-registry-declaration.schema.json`;
`threadId` fresh; `proof` **REQUIRED**, verifying under the
document `issuer` (the declaring party — §3's proof rule names
this type). Defined effect: durable recording per (issuer,
role) under the **generic revision rule** (the pattern of
Visibility §6.4): a higher `revision` wins; an equal revision
with JCS-identical payload is idempotent; an equal revision with
a different payload is an equivocation error — reject, keep
state; a lower revision is rejected — so a delayed or redelivered
older declaration can never roll a value back. A replacement is
prospective, never retroactive for a running act. **Roles and
their constants are named by the registering specification**: the
role URI is the type URI of the task the party serves as
receiver — for the introduction mediator,
`https://real-life.org/trust-tasks/introduction-request/0.1` —
and the registering specification closes which constant names a
role admits and their domains; unknown constant names or
out-of-domain values reject the declaration. The first
registration: `ack-delay`, a duration in the grammar this section
fixes below, `PT1S ≤ ack-delay ≤ PT1H` (Visibility §8.4). **This declaration IS
the "task registration entry" Visibility §8.4 publishes from** —
that entry's per-party published form; one mechanism, two names.
**Act binding and revision skew, stated honestly:** each side of a
running act computes from the declaration it holds — the mediator
from its own current value at the act's arrival, the requester
from the highest revision it holds at send. A revision landing
between the two is safe by construction: the requester's early
`failed` is Visibility §8.4's named role divergence, converged by
the retry as a new act; a mediator that raises its `ack-delay`
SHOULD expect such retries until the new declaration reaches its
contacts. **A party MUST declare identical constants to all
counterparts** ("per party, fixed"); the declaration is
transferably signed for exactly this reason — two counterparts
comparing declarations hold attributable proof of an
equivocation. The first registered constant is the introduction
mediator's `ack-delay` (Visibility §8.4): a requester computes
its verdict window from the mediator's declared value and MUST
NOT send an `introduction-request` to a mediator whose
declaration it does not hold — asking first is the flow, not an
error path.

**The carrier role and its twelve mandatory slots (normative).**
*Terminology, once and for all, because two concepts wore one word
for several castings: a **slot** in this contract is a **required
field of the carrier declaration** — the twelve below — and
nothing else. The object the challenge budget allocates is a
**charge** (point 3 of the ordering), and the object a queue holds
is a **deposit**. Earlier castings called the charge a slot; those
sentences survive only where they narrate that history.* A
**carrier** (Section 5a) serves no task type — it is below the
port line and is nobody's document counterparty — but it does run
a role with published constants, and those constants belong in
this registry for the same reason every other constant does: a
counterpart must be able to check a declaration against a
**domain** it did not invent. The carrier role is therefore
registered here under the role URI
`https://real-life.org/trust-tasks/delivery-carrier/0.1`. **This
slug is a role identifier, not a task type:** it registers no
payload schema, is never a document `type`, and a document
carrying it as `type` is `failed(unknown-type)` like any unknown
slug. **Twelve constants** are **REQUIRED** of every carrier — a
carrier that declares fewer is nonconformant, and a principal MUST
hold all of them before it registers anything (5a.4, 5a.5, 5a.8,
5a.9):

- **`admission-resource`** — what the carrier spends to admit
  submissions and registrations. Closed domain: `none` · `size` ·
  `rate` · `work` · `payment`. Whatever the token, the metering
  scope is fixed by this contract and not by the carrier: it MUST
  be **per principal or per submission, never per person**. A
  carrier MUST NOT operate an account, an invitation, a device
  certificate, a device attestation, or any counter or quota that
  spans two principals — the precedent is Access §7.3, whose
  `divergenceQuota` is group-scoped for the same reason. `none` is
  a **declared** residual and a conformant value: a carrier that
  gates nothing says so, and the honest reading of §9's
  "adapters are untrusted" is that submission defence is
  resource-shaped, never identity-shaped. `payment` is admissible
  **only** where the instrument is itself per principal and
  carries no identifier common to two of them; a payment
  instrument that identifies the paying person across principals
  is a person-wide counter under another name and is nonconformant.

  **The kind alone declares nothing — parameters are REQUIRED per
  kind.** A carrier that publishes `"rate"` and stops has told a
  counterpart which *sort* of thing it spends and nothing it could
  compute with; two such carriers would have to invent their own
  windows and could decide oppositely on identical inputs, which
  makes the determinism this registry claims (below) false. Each
  kind therefore carries its own closed parameter set, and a
  declaration missing a parameter of its kind, or carrying a
  parameter of another kind, is **invalid**:
  - `none` — no parameters. Declared residual.
  - `size` — no parameters of its own: the size gate **is**
    `max-submission-bytes` below, which every carrier declares
    regardless. Choosing `size` says that this bound is the whole
    of the carrier's defence.
  - `rate` — `admission-rate-window` (a duration in the grammar
    of this section, `PT1S ≤ window ≤ P1D`) and `admission-rate-max` (an
    integer ≥ 1). The **bucket key is fixed by this contract, not
    by the carrier**: it is the queue — that is, the `rkid` — and
    never anything spanning two of them, which is the
    metering-scope rule above restated where it becomes operative.

    **The algorithm is fixed too, because parameters without one
    are still not deterministic.** "At most *max* per window"
    admits a sliding window, a tumbling window, and a token
    bucket, which disagree at boundaries — and a tumbling window
    would additionally let a flooder place nearly `2 × max`
    deposits across one boundary. `rate` is therefore **exactly a
    token bucket**, and it is specified as a closed state machine
    whose **verdict reads only state, never a clock**. It is
    counted in **integer micro-tokens**, and that is not a
    presentational choice: an earlier casting counted whole tokens
    and advanced a `lastRefill` cursor by `ceil(...)`, which
    **discards the fractional remainder** and makes the granted
    capacity depend on when a carrier happens to be asked. The
    counter-example is exact and worth keeping in the text, since
    it is what this rule now excludes — `window = 1000 ms`,
    `max = 3`, empty bucket: a request at 334 ms earns one token
    and spends it; a second at 667 ms sees `elapsed = 333` and
    earns nothing, so it is refused — while **two** requests
    arriving only at 667 ms both succeed, because
    `floor(667 × 3 / 1000) = 2`. Same declaration, same elapsed
    time, different capacity, decided by polling frequency. In
    micro-tokens no remainder exists to lose:

    - **State per queue:** a single integer `micro`, with
      `0 ≤ micro ≤ admission-rate-max × windowMs`, plus
      `lastRefill` (a monotonic instant) used only to measure
      elapsed time. `windowMs` is `admission-rate-window` in whole
      milliseconds. A queue is created **full**:
      `micro = admission-rate-max × windowMs`.
    - **Refill, computed before every verdict:** with `elapsed` =
      whole milliseconds since `lastRefill`,
      `micro := min(admission-rate-max × windowMs,
      micro + elapsed × admission-rate-max)`, and `lastRefill`
      advances to the instant just measured. **Nothing is rounded
      away**, because nothing is divided: one millisecond is worth
      exactly `admission-rate-max` micro-tokens, always.
    - **Price:** one admitted deposit costs exactly `windowMs`
      micro-tokens.
    - **Verdict:** `micro ≥ windowMs` admits and, **only on
      `admitted`**, subtracts `windowMs`. **A refusal subtracts no
      price**; it does not roll the refill back. Said as one
      sequence, because the two halves of this rule were once
      stated separately and could be read as contradicting each
      other: *refill first and commit it — `micro` and
      `lastRefill` both — then decide; on `admitted` subtract
      `windowMs`; on `refused(admission-resource)` subtract
      nothing.* **The committed refill is the only state a
      refusal leaves behind**, and it is exactly the state that
      elapsed time earned, so a flood of refused attempts cannot
      deepen a queue's own penalty, cannot earn extra capacity —
      the refill is a function of elapsed time, not of attempts —
      and repeated presentation of one submission is idempotent in
      the metering. The alternative reading, *roll the refill back
      on refusal*, is **rejected**: it makes the bucket a function
      of the polling pattern again, which is the very fault
      round 4 closed, and it is observable across a restart, since
      only `micro` is persisted.
    - **Why the counter-example is now closed:** at 334 ms the
      bucket holds `334 × 3 = 1002 ≥ 1000`, so one deposit is
      admitted and 2 micro-tokens remain; at 667 ms it holds
      `2 + 333 × 3 = 1001 ≥ 1000`, so the second is **admitted
      too** — exactly matching the two requests that arrive
      together at 667 ms (`0 + 667 × 3 = 2001`, two deposits, 1
      micro-token left). **Capacity is now a function of elapsed
      time alone**, independent of how often or at which instants
      the carrier is asked. Section 11 ships this configuration as
      the vector, deliberately choosing a `window`/`max` pair that
      does **not** divide evenly — the previous vector used
      `PT1M`/3 and could not have caught the fault.
    - **Clock discipline:** `elapsed` MUST be read from a
      **monotonic** source. A backwards step yields `elapsed = 0`
      — never a negative refill, never a rollback. A forward jump
      grants at most a full bucket, because the cap is applied
      before the verdict.
    - **Restart is defined, and defined conservatively.** Only
      `micro` is persisted; `lastRefill` is **not**, because a
      monotonic instant has no meaning across a process or host
      restart. On restart, `lastRefill` is set to the **first
      monotonic instant the carrier observes**, and **no elapsed
      credit is carried across the restart**. A carrier therefore
      never resumes with a bucket fuller than it stopped with, a
      restart never refills and never resets to full, and two
      carriers restarting from the same persisted `micro` behave
      identically. Losing `micro` entirely is not a licence to
      start full: a carrier that cannot recover it MUST start the
      queue **empty** (`micro = 0`), the fail-closed direction.
      **This is where the verdict rule above becomes
      observable**, which is why it is stated as one sequence: a
      refill committed immediately before a refusal is part of
      `micro`, so it **survives** the restart; under the rejected
      rollback reading the same history would resume with less.
      Section 11 ships the sequence that separates them.
    - **There is no window boundary at all**, which is the point:
      the burst-across-the-edge attack has no edge to cross, and
      two carriers holding byte-equal declarations and the same
      `micro` return the same verdict for the same elapsed time.
  - `work` and `payment` — `admission-scheme`, an absolute URI
    naming the proof-of-work or payment scheme, compared **byte-
    exactly** by the rule Identity §7a.2 gives for carrier
    identifiers (no normalization, no alias, no resolution), plus
    the parameters that scheme defines. **This contract defines no
    such scheme**, and says so rather than gesturing at one: a
    carrier declaring `work` or `payment` is predictable only to a
    counterpart that already holds that scheme's profile, and
    toward every other counterpart its admission is **not
    computable in advance**. That is a stated limit of these two
    values, not a hidden one — and it is the reason a carrier that
    wants interoperable, checkable admission today declares
    `none`, `size`, or `rate`.
- **`max-submission-bytes`** — an integer, `65536 ≤ n ≤ 16777216`,
  the largest envelope the carrier admits. It is what makes
  `refused(bounds)` (5a.5) a decidable outcome instead of a
  carrier's private opinion, and it is the constant Section 5's
  size gate has always presupposed.
- **`max-queue-bytes`** — an integer, `1048576 ≤ n ≤ 1073741824`,
  the storage one queue may occupy before further admissions meet
  `refused(queue-saturated)` (5a.5, retriable). Without it that
  outcome is unpredictable in exactly the way the flooding
  residual is unpleasant: a submitter could not tell a full queue
  from an arbitrary refusal.
- **`max-queues`** — an integer ≥ 1 and finite: how many bindings
  the carrier holds at once, `live` **and** `closing` — a
  wind-up occupies its binding until the release. It is also the
  bound on the **reserved** charges, one per binding (below).
- **`max-total-bytes`** — an integer, finite: the storage all
  queues together may occupy.
- **`queue-floor`** — an integer ≥ 65 536 and ≤ `max-queue-bytes`:
  the storage every live queue is **guaranteed**, whatever any
  other queue is doing.

  **The floor exists because the global bound alone let one queue
  take the carrier.** With `max-total-bytes` merely ≥
  `max-queue-bytes`, a conformant carrier could declare
  `max-queues = 2` and `max-total-bytes = max-queue-bytes`, and
  then whoever holds one queue's `rkid` could fill the whole
  carrier: every submission to the **other**, empty queue meets
  `refused(capacity)`. That is a flood crossing from one
  relationship into all the others, and it falsified this
  contract's own blast-radius claim (5a.5, Section 9). The answer
  is the Replication Contract's §9 pattern, taken whole this time
  rather than half:

  > **`max-total-bytes` ≥ `max-queues` × `queue-floor` is
  > REQUIRED**, and a declaration violating it is invalid. The
  > floor is thereby **logically reserved**: ordinary admission
  > for one queue MUST NOT consume another live queue's
  > **unreached** floor. A registration that would break the
  > inequality — one queue too many for the declared floor — is
  > refused with `registration-refused(capacity)`.

  **The accounting quantity, stated once so that every case falls
  out of it (normative).** A previous casting decided admission on
  the occupancy *before* the deposit and left the deposit that
  **crosses** the floor undecided — a queue at 65 535 bytes with a
  floor of 65 536 was simultaneously owed admission (it is below
  its floor) and unable to be given it (the carrier was at
  `max-total-bytes`). The ambiguity disappears when the carrier
  accounts one number instead of two:

  > **`committed` = Σ over live queues of `max(used, queue-floor)`
  > + Σ over closing queues of `used`**, where `used` is the
  > queue's occupancy. A submission of size `s` to queue `q` is
  > admissible only if, **computed on the occupancy after
  > admission**, `used(q) + s ≤ max-queue-bytes` and the resulting
  > `committed` is still ≤ `max-total-bytes`. Otherwise it is
  > `refused(queue-saturated)` for the first bound and
  > `refused(capacity)` for the second.

  Two consequences follow **arithmetically**, which is why they
  are worth more than the sentences they replace:

  - **A queue below its floor can always grow to its floor.** If
    `used(q) + s ≤ queue-floor`, then `max(used(q) + s, floor)` =
    `floor` = `max(used(q), floor)`, so `committed` **does not
    change** — the admission cannot break a bound it does not
    move. The floor guarantee is now a property of the accounting,
    not a promise laid on top of it.
  - **Above the floor, growth is exactly elastic.** Each admitted
    byte raises `committed` by one, so refusal begins precisely
    where the shared room ends — and never earlier for one queue
    because of another queue's unreached floor, which `committed`
    already holds back.

  The invariant `committed ≤ max-total-bytes` is established by
  the required inequality (with every queue at or below its floor,
  `committed` = `max-queues × queue-floor` at most) and preserved
  by the admission rule, which is the whole of the proof.

  **Closing queues (5a.9) count, and count as what they are.** A
  queue in the closing phase admits nothing and still holds bytes
  until each deposit reaches conclusion or give-up. It therefore
  contributes **`used`, not a floor** — it needs no guarantee,
  having nothing left to guarantee — while its bytes remain
  visible in `committed`, so they cannot be handed out twice.
  `max-queues` counts **every binding the carrier holds**,
  `live` and `closing` alike — a wind-up occupies its binding
  until the release — while only a **live** queue is given a
  floor; and a registration
  is admissible only if `committed` **including closing bytes**
  still satisfies the invariant with the new queue's floor added.
  Because closing bytes only ever shrink, an invariant that holds
  at registration keeps holding — which is exactly why counting
  them at that moment is sufficient, and why a live queue's floor
  can never be eaten by a wind-up in progress. (The Replication
  Contract reserves against every *accepted* group rather than a
  sub-state, and this is the same reservation, said in the two
  states this contract actually has.)

  **Floor is not quota**, and the two are kept apart exactly as
  they are there: the **floor** is what capacity must reserve, the
  **quota** (`max-queue-bytes`) is where refusal for that queue
  begins, and no physical preallocation is demanded — a carrier
  computes the reservation, it does not allocate it. Between its
  floor and its quota a queue draws on whatever global room is
  actually free, so a busy carrier can still meet
  `refused(capacity)` there; **below** its floor — that is,
  whenever the occupancy *after* admission is still within the
  floor — it never can.

  **What this restores, and what it honestly does not.** A queue's
  guaranteed capacity is now beyond the reach of every other
  queue, so the flooding residual of 5a.5 is again what it claims
  to be — **for the guaranteed floor**, which is what one
  relationship can count on: below it, a queue is beyond every
  other queue's reach. Above it the claim is narrower and this
  casting states it that way rather than repeating an absolute:
  the **elastic** range between floor and quota is shared
  carrier-wide, so a flood **can** take another relationship's
  entire headroom above its floor. What remains, named rather than
  discovered later: that elastic range is shared, so a flood can deny
  another queue its *headroom above the floor*, and a rotation
  does not free the old queue's bytes instantly, since admitted
  deposits stay until conclusion or give-up (5a.8, 5a.9). A
  recipient who wants more than the floor during someone else's
  flood is depending on room that is, by declaration, shared.

  Together `max-queues`, `max-total-bytes` and `queue-floor`
  close the **registration side**, which possession proofs alone
  do not:
  proving possession stops a stranger from taking *your* queue, it
  does not stop anyone from minting arbitrarily many `rkid`/
  principal pairs of their own and registering all of them.
  Beyond any of these bounds a registration is refused with the
  closed, deterministic outcome **`registration-refused(capacity)`**
  (5a.3, retriable) — never silently, never by a judgement about
  the presenter. The pattern is the Replication Contract's §9
  service capacity (`maxGroups` plus a global bound with
  `registration-refused(capacity)`), adopted rather than invented,
  and it is resource-shaped in the same way: it bounds **how
  much**, never **who**.
- **`max-binding-tombstones`** — an integer,
  `max-queues ≤ n ≤ 2^53 − 1`: how many binding tombstones the
  carrier retains after their bindings are released. Its rule, its
  eviction order and the consequence of an eviction are in 5a.3,
  where the tombstone itself is defined; it is named **here**
  because this list claims to be the closed set of required
  constants and a previous casting left it out — defining a
  required slot a thousand lines away from the list that promises
  to hold them all is the same defect as an unversioned reference.
- **`max-open-challenges`** — an integer ≥ 1 and finite: the
  **carrier-wide** number of outstanding **unreserved** charges
  the carrier holds at once, across every connection — the pot
  that requests naming an `rkid` the carrier holds **no** binding
  for share (step (b4) below). A carrier-wide constant cannot be churned,
  because there is nothing to churn it against.
- **`challenge-lifetime`** — a duration in this section's grammar,
  `PT5S ≤ challenge-lifetime ≤ PT5M`, after which an outstanding
  challenge expires and its **charge** ends by the first of the
  two ends point 3 names — that point defines the object and both
  of its ends, and this constant fixes the duration of the first. 5a.3 has always
  required challenges to expire; the duration is **declared** here
  because, together with the constant above, it is what bounds the
  *work* a carrier can be made to do — see immediately below.
- **The admission resource applies to the registration and
  challenge phase too.** An earlier casting created rate state "at
  the instant of its registration" and keyed it to the new queue,
  so the work *before* a queue exists was metered by nothing.
  A carrier MUST therefore meter registration attempts and
  challenge issuance under its declared `admission-resource`, with
  the **connection** as the bucket key for this phase (there is no
  queue yet to key it to, and there is deliberately no sender
  identity — the connection is the only resource-shaped handle
  available, and it identifies nobody). That is the *local* layer:
  it slows one connection down, and by itself it is churnable.
  **For `rate` this phase runs the same micro-token machine
  defined above**, and differs from it in exactly four stated
  points, so that two implementations compute the same verdict
  (round-25 B-2): the bucket is keyed to the **connection**
  instead of the queue and is **created full** when the
  connection is accepted; the price of `windowMs` micro-tokens is
  charged **once per request evaluated at step (b1)** — a
  registration attempt and the challenge issuance it triggers are
  **one** request and therefore one price, and the `admitted` of
  the deposit machine corresponds to *passing b1*; refill is
  computed and **committed** before the verdict and a refusal
  subtracts no price, exactly as above; and the bucket is
  **discarded when the connection closes** — a new connection
  starts full again, which is precisely why this layer is
  **not** the bound. The bound is carrier-wide and lives in
  `max-open-challenges`, `max-queues`, `max-total-bytes` and the
  charge rule below; this bucket only smooths one connection.
  `none` and `size` need no state here; `work` and `payment`
  carry the limits their own schemes state (below).
- **Bounding state was not enough: the ordering below bounds the
  work (normative).** A previous casting bounded the challenge
  *store* and then let a carrier at its limit **evict the oldest
  slot and issue anyway** — which caps memory and caps nothing
  else. The expensive part of this exchange is not the slot; it is
  the randomness, the X25519 seal, the HKDF/AES-GCM, the response
  bytes, and later the signature verification. An attacker who
  churns connections was therefore still able to make a carrier
  perform unbounded cryptography, and the earlier claim that a
  global budget bounds "all connections together" was true of
  state and false of work. Three rules close it:

  1. **Cheapest first, and the budget before the work.** For every
     registration or challenge request a carrier MUST evaluate, in
     this order: **(a)** syntactic checks only — shape, field
     presence, declared size and encoding bounds; **(b)** the
     budget, **which is two pots and not one, and the branch
     between them is part of the order**; **(c)** and only then
     any expensive operation — randomness,
     the sealing of the address challenge, any asymmetric
     operation at all — and only for a request that holds a
     **charge**. **A carrier MUST NOT begin an asymmetric
     operation, a key derivation, or the emission of challenge
     bytes for a request that has not already been charged.**
     **The requirement is evaluated at the atomic beginning of
     (c), and there only** (round-31 B-1): the charge meters the
     **issuance**, not the duration of the work it pays for, so a
     request that has begun (c) holding a live charge completes
     that step — a charge ending underneath it cannot un-issue
     what was already charged and begun, and re-checking mid-step
     would mean holding a linearized bracket across the
     cryptography, which serializes a carrier for no gain. Every
     issuance is charged exactly once, at its beginning, which is
     what the arithmetic of point 4 counts. Symmetrically,
     a response is verified only against a **live charge**;
     an unsolicited or expired response is discarded at step (a).

     **Step (b), written as one state sequence**, because stating
     the pool rule here and the reserve rule two pages below let
     the first read as if it governed both (round-20 B-1):

     > **b1.** Evaluate the declared `admission-resource` for this
     > phase. Exhausted → `refused(admission-resource)`, no charge
     > taken, no key operation performed.
     > **b2.** Determine which pot this request draws on — the
     > single question the carrier can answer from state it
     > already holds: **does the `rkid` named in this request
     > already have a binding at this carrier, `live` **or**
     > `closing`?** The question is **total, because every proof
     > names the queue it acts on**: `rkid` is carried by all four
     > purposes (5a.3, wire `…/0.3`), so a collection or
     > conclusion **of a binding this carrier holds** draws on
     > **that binding's own reserved charge**, exactly as its
     > rebind would, and a request naming an address the carrier
     > holds nothing for falls to b4. Both earlier readings are
     > withdrawn and both were wrong in the same way — by asking
     > about something other than the queue: sending every
     > `rkid`-less request to the pool let a held pool starve the
     > collections of every existing binding (round-35 B-1),
     > and resolving them through `principal` was **ambiguous**,
     > because one relationship may hold several addresses at one
     > carrier, so two conformant carriers could answer the same
     > bytes differently (round-36 B-1). The selector belongs in
     > the **signed bytes**, and now it is there. There is no
     > third pot and no unbudgeted door: every challenge this
     > carrier issues — for registration, rebind, collection or
     > conclusion — costs a charge before any of them is
     > generated. (Round-23 B-4: the predicate said "live", and
     > the paragraph below has always named *reopening a closing
     > queue* as a reserve case; with the narrower word an
     > attacker holding the unreserved pool could block every
     > return from `closing` without knowing a single address,
     > which is outside the residual's stated reach.)
     > **b3.** *Yes — the request draws on **that address's own
     > reserved charge**, and on nothing else.* If that charge is
     > free, take it; the request proceeds to step (c)
     > **regardless of how full the unreserved pool is**. If it
     > is already held — a second concurrent request for the same
     > address — the answer is `registration-refused(capacity)`,
     > and **no** unreserved charge is taken instead: a bound
     > address never falls back to the pool.
     > **b4.** *No — the request draws on the **unreserved
     > pool**.* If fewer than `max-open-challenges` unreserved
     > charges are held, take one; otherwise
     > `registration-refused(capacity)`, and **no** reserved
     > charge is taken instead: an unknown `rkid` never reaches a
     > reserve, which is the whole point of the reserve.
     >
     > **b0.** Steps b2–b4 **and the entry into step (c)** are
     > **one linearized check-and-commit step** against the
     > binding state, by the atomicity rule above — which is what
     > settles this branch against `closing × release`: in **one**
     > order the charge is taken first and the request is already
     > inside (c) when the release lands; in the other the release
     > lands first and b2 reads `released`, so the request draws
     > on the unreserved pool at b4. **Exactly one outcome per
     > order, and both keep the pointwise invariant** (round-28
     > B-1). The bracket ends at the **entry** into (c), not at
     > the end of the work: it exists to exclude the one window
     > in which a request could hold a charge that ends before
     > the work it pays for begins (round-30 B-1) — a carrier
     > working without a live charge, or an abort with no defined
     > outcome. Inside the bracket that window **cannot arise**;
     > after it, end (2) may still end the charge, and by then
     > the issuance it metered has already happened, so ending it
     > only ever *lowers* the count. **Entry and requirement are
     > the same boundary:** the charge requirement of (c) is
     > evaluated exactly where this bracket ends, so there is one
     > line and not two (round-31 B-1).
     >
     > A charge ends in **exactly two** ways (point 3 below):
     > the passage of `challenge-lifetime`, and — for the
     > reserved charge of a binding that is released — the end of
     > that binding. Never evicted to make room, never refunded
     > by completing the exchange.

     The two failures this branch exists to exclude are the two
     directions of collapsing it: **a bound address refused
     because the pool is full** — which would hand an attacker
     exactly the cross-address starvation the reserve was built
     against, and would make 5a.5's promise about restore and
     rebind false — and **an unknown address served out of a
     reserve**, which would make the reserve a pool again and
     restore the fault of the withdrawn `challenge-reserve`
     constant. Section 11 tests both directions.

     **A challenge never outlives the charge that paid for it**
     (round-33 B-1, corrected in round 34 to the direction that is
     true). The relation is **one-directional, and deliberately
     so**: the charge is what issuing the challenge cost, so it
     outlives the exchange by design — consumption ends the
     exchange, never the metering (point 3), which is the whole of
     "a slot is a charge, not a lock". What cannot happen is the
     other direction: a live challenge with a dead charge, which
     is exactly the case that would verify against nothing. So
     "verified only against a live charge" is the **stronger** of
     the two conditions and the one that governs; "names a live
     challenge" can never be satisfied where it is not. A charge ending by either end of point 3 therefore
     ends its challenge with it: after end (2) — the release of
     the binding whose reserved charge paid for it — a response
     that would have been valid a moment earlier names **nothing
     live** and is discarded at step (a), the outcome that already
     covers a consumed or unknown challenge; the party asks again,
     and the fresh challenge costs a fresh charge, which is what
     every other failed exchange costs. No new state edge and no
     third reading: the alternative — verifying against a dead
     charge — is the rule this ordering exists to enforce, and
     leaving the challenge alive without one is the case that had
     no defined outcome.

     **And a challenge is consumed by the first response attempt,
     before the verification, whatever the verification then
     says.** This is the half the previous casting left open, and
     it was load-bearing: "single-use" said what a challenge is
     for, not when it is spent, so an attacker holding its **own**
     `rkid` could take one challenge, open the sealed half
     legitimately, and then send response after response — each
     schema-shaped, each naming the live challenge, each with a
     junk Ed25519 signature — and each triggering a signature
     verification. One charge, unbounded asymmetric work, and the
     claim that the budget bounds the work was false a second
     time. The rule:

     > On receiving a response that names a live challenge, a
     > carrier MUST mark that challenge **consumed** — atomically,
     > and **before** any signature verification or other
     > asymmetric operation — and MUST then verify at most that
     > one response. **The liveness of the charge is read in that
     > same atomic step**, which is the verification's
     > linearization point exactly as the entry into (c) is the
     > issuance's (round-35 B-2): a response whose charge is
     > already dead when the step runs finds nothing live and is
     > discarded at step (a); one that begins verification with a
     > live charge **completes it**, and a charge ending
     > underneath cannot un-verify what was already begun — the
     > same reason (c) is not re-checked mid-step. **A failed verification does not restore
     > it.** A later response naming a consumed or unknown
     > challenge finds nothing live and is discarded at step (a),
     > at the cost of a lookup.

     So **one issued challenge buys at most one verification**,
     and a party that fails must pay for a fresh challenge — a
     fresh charge, against the same carrier-wide budget. With
     issuance and verification both bounded by it, the arithmetic
     of point 4 covers the whole exchange rather than half of it:
     a carrier can be made to perform at most
     `(max-open-challenges + max-queues) / challenge-lifetime`
     issuances **and at most as many verifications** per unit
     time. The honest cost falls where it should: an honest
     registrant that mistypes nothing never pays it twice, and one
     that suffers a genuine failure asks again.
  2. **At the budget, the answer is refusal — never eviction.**
     A request **on the unreserved branch (b4)** arriving while
     `max-open-challenges` **unreserved** charges are held is
     refused with `registration-refused(capacity)` (5a.3,
     retriable); a request on branch (b3) is not, its charge
     being its address's own. A charge is **never** released to make room for a
     newcomer.
  3. **A slot is a charge, not a lock, and completing the exchange
     does not refund it.** This is the sentence the previous
     casting was missing, and without it the rate below was simply
     false: if a completed registration returned its slot
     immediately, an attacker holding its own keys could open,
     answer, and complete exchanges **serially** — one slot,
     unbounded X25519, HKDF/AES-GCM and signature verification,
     with `max-queues` and `max-total-bytes` untouched because
     re-registering the same address is idempotent. So:

     > **A charge ends in exactly two ways, and in no other:**
     > **(1)** the passage of `challenge-lifetime` from the
     > moment it was taken — the ordinary end, and the only one
     > an unreserved charge has; **(2)** the **end of the
     > binding** a *reserved* charge belongs to, at
     > `closing × release` (5a.3). **Nothing else ends a
     > charge** — not success, not failure, not abandonment, not
     > the closing of a connection, and not room-making.
     >
     > End (2) exists because a reserved charge belongs to a
     > binding and the binding can end first; without it the
     > address leaves `live + closing` while its charge stays,
     > and "one reserved charge per held binding" is false the
     > moment bindings churn faster than `challenge-lifetime`
     > (round-25 B-1). It **cannot fall between a charge being
     > taken and the work it pays for beginning**, because b0
     > brackets exactly that window (round-30 B-1); it reaches a
     > charge only once that work has been accounted, where
     > ending it lowers the count and nothing is left working
     > uncharged. **It cannot be used to recycle work**,
     > which is what end (1) is for: an attacker reaches it only
     > by waiting out an `orphan-horizon` — **P7D at the
     > shortest, against a `challenge-lifetime` of at most
     > PT5M** — and the charge it recovers is its own address's,
     > which it could take anyway. **The bound is untouched
     > either way**, since (2) only ever *lowers* the number of
     > charges in flight.

     **When it is taken, exactly:** at step (b) of the ordering
     above — the budget check — and therefore **before** any
     randomness, sealing, or asymmetric operation of step (c). A
     request that is refused at (b) took no charge (it also caused
     no work); a request that passes (b) holds one whether or not
     step (c) or anything after it succeeds. The charge is taken
     first and released late, which is the only arrangement in
     which the budget can bound work that has not happened yet.

     Completion still ends the *exchange* (the challenge is
     single-use and cannot be replayed); it ends the **work**,
     which is what the budget meters. The instrument is the
     Replication Contract's charge, in its own words: a charge is
     a **retention instance**, not a lease on a live object.
  4. **The bound that results is therefore a rate, and now it
     actually follows — over the whole charge population, not
     only the pool.** Charges live in **two** places: the
     **unreserved pool**, bounded by `max-open-challenges`, which
     requests naming an unknown `rkid` share; and **one reserved
     charge per held binding**, `live` or `closing`, which only a
     request naming *that* `rkid` may take, bounded by
     `max-queues`, which counts both. **Neither kind can be
     recycled** — end (2) of point 3 costs an `orphan-horizon`
     and returns only that address's own charge — so a carrier
     can be made to issue at most
     `(max-open-challenges + max-queues) / challenge-lifetime`
     challenges per unit time, carrier-wide, **whatever the
     number of connections and whatever the attacker does with
     the exchanges it opens** — an attacker that knows bound
     `rkid`s can trigger their reserves *in addition to* the
     pool, and this sum is what that costs. Two declared
     constants, one arithmetic consequence, nothing
     per-connection to churn and nothing to reclaim early. The
     reserve is defined below; the bound is stated in its full
     form **here**, where it is first claimed, because the
     smaller form — the pool alone — was shipped in three places
     for six castings after the reserve stopped being a pool
     constant and became a per-address charge (round-19 B-1).

  **Restart, and why the conservative rule needs no durable
  state.** A bound that a process restart resets is not a bound: a
  carrier that forgot its charges could be restarted in a loop —
  issue `max-open-challenges`, restart, issue them again. But
  persisting a record per outstanding challenge would contradict
  Section 9's own property that **nothing durable is allocated
  before both proofs verify**, and that property is worth more
  than the convenience. The rule is therefore built so that no
  record is needed at all:

  > **On restart, a carrier MUST treat its full unreserved pool as
  > held, with a single deadline of `restart instant +
  > challenge-lifetime`, and issue no challenge from that pool
  > until that deadline passes. The reserved charge of a binding
  > it holds is NOT covered by this rule: it resumes free.** No
  > per-request state is persisted, nothing durable is written,
  > and the carrier resumes with strictly less **contended**
  > capacity than it had — never more.

  **Which population this rule covers is normative, not an
  implementation detail** (round-38 B-2): the two charge
  populations of (b3) and (b4) are conserved differently because
  what a restart can buy an attacker differs. The unreserved pool
  is the **contended** resource — it is carrier-wide and
  identity-free, so a second issuance there is a second slot taken
  from every newcomer at once, and that is what the conservative
  reading protects. A binding's reserved charge is reachable
  **only by naming that address** (5a.3, wire `…/0.3`), so the
  most a restart can hand out there is **one additional challenge
  to the holder of that binding, within one lifetime window** —
  and the only party that can spend it is the party the reserve
  exists for. Stated as the residual it is: **a restart may cost
  one extra reserved challenge per binding, and it buys the
  attacker nothing, because the attacker cannot name an address
  they do not know.** The alternative — treating reserves as held
  too — would refuse the collections and conclusions of **every**
  existing binding for up to a full `challenge-lifetime` after
  each restart, which is the availability failure of the
  withdrawn round-34 reading in another dress. A carrier is free
  to be more restrictive about its own reserves; it MUST NOT be
  less restrictive about the pool.

  This is the same direction the rate bucket takes across a
  restart (no elapsed credit crosses it; an unrecoverable counter
  starts empty), and it closes the loop attack by construction:
  restarting **cannot** be a way to obtain issuance, because the
  first thing a restarted carrier has is a full set of charges it
  did not use. The cost is bounded and lands where a restart
  already lands: registrations wait at most one
  `challenge-lifetime` after a restart — at most five minutes by
  the constant's own domain — and existing queues, deposits,
  collections and conclusions are untouched, because none of them
  passes through the **unreserved pool** — each reaches its own
  binding's reserve, which this rule leaves free. A carrier that wants that window shorter MAY
  persist charge deadlines and resume from them, but **only if
  doing so releases no more charges than it actually held**: an
  optional refinement may be more restrictive than this rule and
  never less.

  **The price, and it is larger than an earlier casting admitted.**
  An honest registrant carries its charge for the full duration
  after completing; that part is small, since registrations are
  rare per relationship and a carrier sizes `max-open-challenges`
  for its population rather than for one person's burst. The part
  that was **understated** is the other one: a previous casting
  called the resulting denial "bounded" and "self-healing, for at
  most one `challenge-lifetime`", and that is **false**. Nothing
  stops an attacker from re-taking every charge the moment it
  lapses, and repeating that forever. Neither possession proofs
  nor existing queues are needed for it, and `none` is a
  conformant admission resource. **Repeated carrier-wide challenge
  starvation is therefore possible, and it is named as a residual
  rather than dressed as a bound** — see 5a.5, which carries it
  with its exact limits.

  **What the contract does do about it — without reaching for an
  identity.** One partition is available that needs nothing an
  attacker can mint, because it reads only state the carrier
  already holds: whether the `rkid` named in a request **already
  has a binding**, `live` or `closing`. An attacker minting fresh keys never
  names one; a person restoring a device, rotating a nonce, or
  reopening a closing queue always does. Hence the reserve, in the
  shape the Replication Contract's §9 already uses for service
  capacity — a floor that ordinary traffic never consumes:

  - **The reserve is per address, not a pool.** Every `rkid` the
    carrier **already holds a binding for — `live` or
    `closing`** — has **its own single reserved charge**, which
    only a request naming *that* `rkid` may take. It is not drawn from `max-open-challenges`, which
    bounds the **unreserved** pool that unknown-`rkid` requests
    share.

  A previous casting made the reserve a **shared pool** with a
  declared size, and that was the error this round found: with
  `challenge-reserve = 1` — a conformant declaration — the
  counterpart of a *single* relationship could take that one
  charge at every lapse and thereby block the restore of **every
  other relationship at the carrier**, which is precisely the
  cross-relationship starvation the reserve existed to prevent. A
  pool cannot isolate; only per-address accounting can. The
  constant `challenge-reserve` is therefore **withdrawn**
  (never instantiated), and the reservation is a property of each
  bound address instead.

  **What that costs and what it bounds.** Reserved charges are at
  most one per binding, `live` or `closing`, so their number is
  bounded by `max-queues`, which counts both and is declared. That is the second term of the
  work bound stated in point 4 above — the one normative place
  this contract states it — and it is why that bound counts two
  declared constants rather than one: still independent of
  connections, still nothing to churn.

  **And the per-address cap stays, for the unreserved pool too:**

  > **At most one open charge exists per named `rkid`** — bound or
  > not. A request naming an `rkid` that already has a live charge
  > is refused with `registration-refused(capacity)` (retriable),
  > and no charge is taken. Parallel requests for one address do
  > not multiply into parallel charges.

  **Computed against the state machine, with the assumption
  written out.** The assumption a previous casting left unchecked
  was about what an attacker *names*; this one makes no assumption
  about that at all, because the accounting is per address:

  - **Minted keys reach no reserve.** A fresh X25519 key is an
    *unbound* `rkid` and has no reserved charge; it competes only
    in the unreserved pool.
  - **Knowing many bound addresses reaches no more than those
    addresses.** Each buys exactly one charge, and that charge is
    that address's own — it is not subtracted from anybody else's.
  - **What remains, exactly:** whoever knows one particular bound
    `rkid` can hold **its** reserved charge and re-take it at each
    lapse, delaying **that one relationship's** return. That party
    is its counterpart or someone who saw its card — the insider
    and leak class this contract already carries (5a.5) — and the
    cure is the same: the address is rotated, and the new one
    travels only inside the relationship.

  So the promise, and this time it is the state machine's own
  arithmetic rather than an inference about behaviour: **the
  reserved charge of a relationship is reachable only by naming
  that relationship's address, so no party can starve the return
  of a relationship whose address it does not know — whatever else
  it does, and however many addresses it knows.**

  Together with `max-queues` and `max-total-bytes`, which bound
  what survives verification, **every bound in this phase is a
  carrier-wide fact or a carrier-declared constant — none is
  per-connection alone**, which is what churn defeats. All of them
  are REQUIRED even where `admission-resource` is `none`:
  declaring no resource is a statement about *metering*, never a
  licence for unbounded state or unbounded work.
- **What this contract cannot bound, named rather than implied:**
  opening TCP connections and completing TLS handshakes costs a
  carrier work **below the port line**, and no rule here reaches
  it — connection admission is transport and deployment terrain,
  exactly like the network layer of 5a.4. What this contract owes
  and now delivers is that **nothing it defines grows with
  connection count**: not challenge charges, not queues, not bytes,
  and — since this casting — not cryptographic work either. A
  carrier under connection churn spends handshakes; it does not
  spend protocol state and does not spend key operations.
- **`give-up-horizon`** — a duration in this section's grammar,
  `P1D ≤ give-up-horizon ≤ P90D`, after which the carrier stops
  offering an admitted deposit for collection, measured from its
  admission. It has always existed in this contract as "the
  adapter's declared give-up bound" behind
  `failed(expired-by-adapter-policy)` (6.1) and as the lower bound
  of `key-retention` (Section 5); it is **registered** here so
  that it is a checkable declaration rather than an unstated
  local policy, which is what 5a.8's conclusion duty needs to be
  decidable at all. Reaching the horizon is the deposit's
  **conclusion**, not its silent disposal: the carrier releases
  the storage only after the deposit is given up (5a.8).
- **`orphan-horizon`** — a duration in this section's grammar,
  `P7D ≤ orphan-horizon ≤ P365D`, and REQUIRED to be ≥ the same
  carrier's declared `give-up-horizon` (a declaration violating
  this is invalid, and a principal MUST reject it), after which a
  principal's **registration binding** stops accepting new
  deposits and begins to be wound up, measured from the last
  successful collection under that principal, or from its
  registration if it never collected. **Reaching it is a
  transition, not a deletion** — the two-phase wind-up of 5a.9
  governs what happens next, and it is what actually bounds the
  orphan surface. The inequality above is kept as a sanity
  constraint on declarations, and it is explicitly **not** the
  proof of anything: an earlier casting argued from it that an
  orphaned queue must be empty when the binding ages out, which
  does not follow — the two horizons are measured from different
  events (the binding's from the last collection, a deposit's from
  its own admission), so a deposit admitted just before the orphan
  horizon still owns its full give-up life. The bound comes from
  closing admission, not from comparing durations.
  It exists because principals **do** go orphaned — a register
  lost without a state copy is unrecoverable for carrier nonces
  (Identity §9.3), and the relationship then re-registers or
  rebinds under a fresh principal (5a.3) — and without a published
  horizon the carrier's binding surface grows monotonically.
  Expiry is a **storage decision of the carrier** about a binding,
  never a verdict about a party, and it is reported to nobody: a
  sender learns only what §6.1 already gives it.
- **`status-horizon`** — a duration in this section's grammar,
  `PT5S ≤ status-horizon ≤ PT5M`, within which an adapter that has
  been handed a submission MUST report **some** honest state for
  it to the party it serves. It is declared by **every delivery
  adapter**, sending side included — the registry carries it under
  the carrier role because that is where this document keeps
  adapter constants, not because only carriers owe it.

  **Field provenance, because this constant exists for a
  reason.** A single-broker WebSocket adapter with no connect
  timeout left a socket in CONNECTING for roughly **forty
  minutes**, and for those forty minutes the sender received no
  status of any kind — not a failure, not a wait, nothing (field
  record wot#355/#357, follow-on wot#359). Nothing in this
  contract was violated, which was the problem: §7 says delivery
  time is unbounded, and no rule said anything about *statuslessness*.

  **The distinction this constant draws, stated so it cannot be
  read as a retreat:** *delivery* time stays unbounded and still
  never affects validity (§7, Encounter 1.3) — what is now bounded
  is the time a submission may spend with **no honest report at
  all**. A submission may legitimately be un-delivered for weeks;
  it may not be un-*described* for more than `status-horizon`.
- **An offline sender never violates this**, and the rule is built
  so that it cannot: what must be reached within the horizon is a
  **state**, not a success. `failed(…)` satisfies it, `accepted`
  satisfies it, and so does an honest **pre-transport report** —
  which is not a fourth status of the §6.1 trias but a statement
  about the adapter's own situation, from the closed set
  `awaiting-transport(offline)` ·
  `awaiting-transport(transport-unreachable)` ·
  `awaiting-transport(carrier-refused-retriable)` (the last is
  where 5a.5's retriable refusals surface). A device in a tunnel
  reports the first of these immediately and conforms; the forty
  silent minutes do not.

**Every carrier integer is canonical and bounded (normative).**
The constants above travel as **value strings**, and normative
rules multiply and compare them — so the lesson Identity §7a.3
already learned for `generation` applies here in full, and this
casting takes it rather than repeating the mistake in a second
place. An earlier casting left `max-queues`, `max-total-bytes`,
`max-open-challenges` and `admission-rate-max` with a lower bound
and no upper one and no spelling rule, which is enough for two
conformant carriers to disagree about the **same declaration**:
at `9007199254740993` an implementation using IEEE-754 doubles
cannot distinguish successive integers, so a product it rounds may
satisfy an inequality that exact arithmetic rejects. Therefore:

- **Domain.** Every integer-valued carrier constant lies in
  `[its own lower bound, 2^53 − 1]` — the largest integer every
  JSON implementation represents exactly, the same ceiling
  Identity §7a.3 uses and for the same reason.
- **Canonical form.** A decimal integer with no sign, no leading
  zero, no fractional part, no exponent, and no whitespace. A
  value string that is not byte-identical to the canonical
  spelling of its value is **invalid**.
- **Reject, never clamp.** A declaration carrying a value outside
  its domain, or in a non-canonical spelling, is invalid as a
  whole and MUST be rejected; a principal MUST NOT round, floor,
  or otherwise repair it. Clamping would manufacture agreement
  where the declaration asked for something the contract does not
  offer.
- **Exact arithmetic where the rules multiply.** The products and
  sums this section requires — `max-queues × queue-floor`,
  `Σ max(used, queue-floor)` — MUST be evaluated **exactly**,
  even where an intermediate exceeds `2^53 − 1`. Implementations
  use arbitrary-precision integers or an equivalent rearrangement;
  **a comparison that rounds is nonconformant**, and that is the
  whole point of pinning the inputs: with exact inputs and exact
  arithmetic, two carriers with byte-equal declarations reach the
  same verdict, which is what this section promises next.

**Atomicity, once for all of them (normative).** Every decision
this contract makes **against carrier state** — the registration
and capacity check (5a.3), admission against `committed` (5a.5),
the micro-token bucket (this section), the challenge budget and
its branch (step (b) below), and the binding-tombstone store
(5a.3 r1–r3) — is a **linearized check-and-commit step**, in the
shape Access §7.3 gives the acceptance commit (the
compare-and-swap whose expected-old is re-read inside the
commit); the Replication Contract's I9 supplies the neighbouring
half, the transaction boundary a durable state change binds to: **the read of the state and the write that follows it
take effect as one, and two transitions against the same state
see each other completely or not at all.** There is therefore no
interleaving in which two decisions each read a state that the
other is about to leave, and both commit — the shape every
concurrency finding of this loop has had (rounds 28 and 29).
Three consequences are worth naming because they were each found
separately: two concurrent first registrations at `max-queues`
yield **one** binding, not two, whatever their `rkid`s; two
concurrent deposits at `max-total-bytes` yield **one**
admission; and **releases run in sweeps** — a sweep is one
linearized `r1 → r2 → r3` with its own `k`, and two sweeps never
overlap, so independent releases are either **joined into one
sweep** with the combined `k` or **serialized** as separate
sweeps, and never interleave. Where a rule below states its own
atomicity — the consumption of a challenge, the rebind
compare-and-swap, step (b0) — it is naming **this** rule at that
place, not adding a second one.

**Durations, once for all of them (normative).** Every duration
this section declares — `challenge-lifetime`,
`admission-rate-window`, `give-up-horizon`, `orphan-horizon`,
`status-horizon`, `ack-delay` — is written in the **day/time subset
of ISO-8601** whose shape Access §7.3 fixes for
`terminalRetention`, with **both parts optional and at least one
component present**: `P`, then an optional `<d>D`, then an
optional `T` part carrying `<h>H`, `<m>M`, `<s>S` in descending
order — **and a `T` that is present carries at least one of the
three**, so a bare `P1DT` is not a value of this grammar
(round-35 B-3); each value 1–3 digits; **no years, no months, no weeks, and
no fractional component**. The day component is optional here and
that is not a detail (round-33 B-2): every value of
`challenge-lifetime` and `status-horizon` lies inside
`PT5S…PT5M`, so a grammar demanding `<d>D` would have **no
satisfiable value at all** for two of its own constants. Arithmetic is
fixed-length (`1D` = 86 400 s), so every value maps to an
**integer number of milliseconds** by construction — which is what
the micro-token bucket needs and what a fractional second would
destroy (`PT1.0005S` is not a value of this grammar and a
declaration carrying it **is rejected**, not rounded and not
truncated: 4.4's rule for every out-of-domain constant, and the
only reading under which two carriers with byte-equal
declarations compute the same `windowMs` — round-32 B-2).
RFC 3339 is **not** the reference here and never was: it
specifies timestamps and excludes durations.

**Determinism, once for all twelve.** Every outcome these constants
govern — registration (5a.3), admission (5a.5), give-up (5a.8),
orphan expiry (5a.9) — MUST be a function of the **declared**
values and the carrier's held state, and of nothing about the
party presenting a submission or a proof. That is what makes a
declaration worth checking: a counterpart can compute the answer
it will get, and a carrier that varies it by anything undeclared
has left the contract regardless of which value it declared.

**How a principal holds these, honestly:** the mediator case
travels as a `registry-declaration/0.1` over an existing
relationship channel, because a mediator *is* a document
counterparty. A carrier is not, so its declaration reaches a
principal through the carrier's own registration interface, which
is **below the port line and deliberately unspecified here**. What
this registry fixes is what the declaration must contain and which
values are admissible; where it fixes nothing, it says so rather
than pretending the carrier is a party it is not. A carrier MAY
additionally publish its declaration as a signed
`registry-declaration/0.1` where it happens to hold a relationship
channel; nothing in this contract requires it to.

## 5. The Sealed Envelope

A document travels sealed to its recipient:

```
seal = { "rkid":       <recipient key-agreement key, Multikey z6LS…>,
         "epk":        <ephemeral X25519 public key, base64url, 32 bytes>,
         "nonce":      <96-bit nonce, base64url>,
         "ciphertext": <AES-256-GCM ciphertext || 128-bit tag, base64url> }
```

Normative construction, exactly one way:

- **Plaintext** is the JCS canonicalization of the document (UTF-8),
  at most **65 536 bytes**; larger documents are non-conformant and
  oversize envelopes MUST be rejected without decryption
  (`failed(oversize)`).
- **Ephemeral key:** a fresh X25519 key pair MUST be generated per
  envelope from a CSPRNG and MUST NOT be reused. **Nonce:** 96 bits
  from a CSPRNG per envelope.
- **Shared secret:** X25519(ephemeral private, recipient public),
  where the recipient public key is the one identified by `rkid` —
  the key-agreement Multikey from the recipient's card. (A derived
  service identity is **not** admissible here: Identity §7 defines
  it Ed25519-only, and no sealing-to-service exists in the 0.x
  stack; a future service-seal capability needs its own X25519
  key, binding artifact, and flow.) An all-zero shared secret MUST be
  rejected on both sides.
- **Key derivation:** AES-256 key = HKDF-SHA-256(ikm = shared secret,
  salt = empty, info = ASCII `rltp/v1/seal`), 32 bytes.
- **Encryption:** AES-256-GCM, 128-bit tag, **AAD = empty (exactly
  zero bytes; nothing is authenticated outside the ciphertext by
  design — all binding lives inside the document)**. Ciphertext of a
  zero-length plaintext is invalid.
- **The document digest is computed over the plaintext, never the
  ciphertext** — re-sealing on retry changes `epk`, `nonce` and
  `ciphertext`, never the document's identity.
- **Key retention (bounded by the delivery horizon):** recipients
  MUST retain every key-agreement private key that ever appeared in a
  displayed or sent card, addressable by `rkid`, for at least
  `key-retention` (Section 7) after the key last appeared in any
  card — **including keys displayed before any relation or record
  existed**, because a scanner may hold the card before the recipient
  knows them. `key-retention` MUST be at least the longest give-up
  horizon any adapter in the deployment declares (6.1), so a key can
  never retire while a delivery sealed to it is still live; adapters
  therefore declare their horizon. **A retired identifier remains
  known indefinitely as a tombstone** — the `rkid` value alone, its
  private key destroyed; tombstones are a few bytes per card ever
  issued, and they keep the disposition honest: stage 2's "known"
  includes tombstones (6.2), so an envelope sealed to a retired key
  reaches decryption and fails as `failed(decryption-failed)` —
  never `malformed`, which is reserved for identifiers this party
  never issued.

A **shipped test vector** (`vectors/seal.json`) fixes recipient key,
ephemeral key, nonce, plaintext, ciphertext, and document digest;
implementations MUST reproduce it byte-for-byte. The vector's
plaintext document is a **seal-only sample** (type
`…/seal-vector-sample/0.1`, never a wire type): it exercises this
section's construction, not the document profile, and MUST NOT be
processed as a delivery document.

No channel authentication is required or assumed **of a sender**:
confidentiality comes from the seal, authenticity from proofs and
signed payloads bound to anchors by the Layer-1 binding rule. This
is a decision, not an omission, and 5a.4 states it as one. The
**recipient** side is the exact opposite and always has been:
registering, collecting from, and concluding a queue are
authorized acts under a control principal, and 5a.3 fixes the
proofs they require. The two are not in tension — they are the
asymmetry the whole section rests on: anyone may put something
into a queue, and exactly one party may take it out.

## 5a. Addressing, registration, and collection

A **carrier** holds queues for other people. It never reads a
document — the seal of Section 5 sees to that, and no rule of this
contract asks a carrier to be trusted with content. What it does
see is who registers which addresses and who comes to collect
them, and that is a social fact even when every byte is opaque.

This section fixes the identities involved. Its aim is bounded and
worth stating before the rules, so that nobody reads more into
them: **it is not a goal to hide from a carrier the relationship
it carries.** The carrier of a relationship knows the
relationship. The goal is that a person's relationships **do not
converge into a person** at whoever carries them — that a carrier
holding six of someone's relationships holds six relationships,
not a directory of one life.

### 5a.1 The addressing triple (normative)

Addressing is three identifiers with three different owners, and
conflating any two of them is where the previous generation went
wrong:

| Identifier | Owned by | Seen by | Governed in |
|---|---|---|---|
| `rkid` | the recipient | sender and carrier | Section 5, 5a.2 |
| queue locator | the carrier | the carrier, and whoever it hands it to | 5a.1 (below the port line) |
| **control principal** | the recipient | the carrier | Identity §7a, 5a.3–5a.10 |

- The **`rkid`** is the end-to-end address: the recipient's
  key-agreement Multikey, the only thing a sender needs, and the
  only one of the three a sender ever sees. Senders MUST use it and
  MUST NOT be required to know anything else about the carrier
  arrangement of the recipient.
- The **queue locator** is a carrier-local, opaque handle for one
  queue. It is **below the port line**: no rule of this contract
  constrains its form, lifetime, or allocation, and no document
  field carries it. It is named here only so that it is not
  silently fused with either of the other two — a locator that is
  the `rkid`, or that is the principal, is not a third identifier
  but a leak.
- The **control principal** is the identity a recipient presents
  to **one carrier** for **one relationship**, derived per
  (relationship × carrier) by **Identity §7a**. Registration,
  query, collection, and conclusion happen under it. It is
  Ed25519-only: it signs and authenticates, and nothing is ever
  sealed to it.

**The binding rule (MUST):** a principal registers, queries, and
collects **only the `rkid`s of its own relationship**. A carrier
MUST NOT expose any operation that answers, for one principal,
about another principal's registrations, and a conforming
recipient MUST NOT ask for one. A convenience query returning
"every key of this person" is the whole failure this section
exists to prevent, wearing a helpful face. **What makes this rule
enforceable rather than merely stated is 5a.3**: the carrier does
not take the claim "this is my relationship's address" on trust,
because it cannot check it by computation — it requires it to be
proved.

### 5a.2 The recipient address is per relationship (normative)

An `rkid` MUST NOT be reused across relationships. This is less a
new rule than a rule finally written down: under fresh-always
enactment (Encounter §4.4) every relationship-creation act derives
its own pair context with its own key-agreement key (Identity
§5.2), so encounter relationships already address differently by
construction. What this section adds is that the property is
**required**, not incidental: a `persona/` or `group/` context that
shows one card to many counterparts makes those counterparts
neighbours of one node at the carrier, and a recipient MUST NOT
register such a shared `rkid` at a carrier as if it were a
relationship address.

A recipient MAY hold arbitrarily many `rkid`s (this is the
recipient-managed property the contract has always allowed), and
Section 5's `key-retention` rule applies to every one of them
unchanged.

### 5a.3 Registration proves possession, of both halves (normative)

5a.1 states the binding rule — a principal registers only the
`rkid`s of **its own** relationship — as a duty of honest
behaviour. Duty is not enough here, and the gap is exactly the
kind this contract does not leave open: an `rkid` is a **public**
value. A sender sees it, a carrier sees it on every envelope, and
anyone who holds a contact card holds one. If registration is a
mere assertion, whoever observed an `rkid` registers it under a
principal of their own — a perfectly well-formed principal, since
principals are derived, not issued — and the carrier has no way to
tell the two claims apart, **because 7a.5's first prohibition
deliberately removed every computable relation between a principal
and the addresses it registers**. The consequence is not
confidentiality loss (the attacker decrypts nothing; sealing is to
the `rkid`) but it is queue hijack: collecting, concluding, and
thereby discarding another person's deliveries.

The answer follows from where the ambiguity comes from. The
binding cannot be **computed** — that is the privacy property — so
it MUST be **proved**. Registration is therefore a challenge
exchange in the shape Access §7.3 already uses for its authorized
identities, with one addition this contract's key types force:

> **A carrier MUST NOT bind an `rkid` to a principal without,
> in one exchange, a valid proof of possession of the
> principal's Ed25519 private key and a valid proof of possession
> of the `rkid`'s key-agreement private key.** A registration
> presenting one proof, or neither, is refused.

- **Principal possession** is a signature under the principal over
  a carrier-issued challenge — Access §7.3's proof of possession,
  adopted unchanged.
- **`rkid` possession** cannot be a signature: an `rkid` is an
  X25519 key-agreement key and signs nothing (Section 5, Identity
  §7a.1). It is proved by **decryption instead**: the carrier
  seals a second challenge to the `rkid` using exactly the
  envelope construction of Section 5 — the one construction both
  sides already implement — and the registrant returns the opened
  challenge value. Only a party holding that `rkid`'s private key
  can open it, and no observer of the wire, past or present, can.

**The proof exchange, byte-precisely — and this time the heading
is earned.** An earlier casting named the five values a signature
had to bind and left the bytes to the implementer, which is not a
signature specification: a JCS object, CBOR, length-prefixed
fields and raw concatenation would all have satisfied the prose,
raw concatenation would have left the boundary between a variable
`C` and two variable challenges ambiguous, and without a literal
domain tag nothing excluded transplanting a signature from another
protocol that happens to sign similar bytes. So the signed object
is fixed here, in the shape Access §7.3 and the key-rotation
statements already use — a **versioned artifact whose `v` constant
is inside the signed bytes**:

```json
{ "v": "rltp-carrier-proof/0.3",
  "type": "carrier-registration-proof",
  "purpose": "register",
  "carrier": "did:web:carrier.example",
  "principal": "did:key:z6Mk…",
  "rkid": "z6LS…",
  "generation": 1,
  "principalChallenge": "…43 base64url characters…",
  "addressChallenge": "…43 base64url characters…",
  "sig": "…" }
```

- **The signature input is the JCS serialization (RFC 8785) of
  this object with `sig` omitted**, and the signature is Ed25519
  under `principal`. JCS fixes field order, escaping, and number
  form, so the bytes are a function of the values and of nothing
  else — the same rule the Access registration core uses, adopted
  rather than re-invented. `sig` itself is canonical base58btc
  with the `z` multibase prefix, exactly 64 signature bytes, by
  the rule Encounter §2.3 imposes on every signature of this
  stack: a shortened or non-canonical rendering is not a
  signature.
- **`v` is the domain tag and it is inside the signed bytes.**
  `rltp-carrier-proof/0.3` appears in no other signed artifact of
  this stack, so a signature made here verifies as nothing else,
  and no signature made elsewhere verifies as this. A verifier
  MUST reject an object whose `v` is not byte-equal to the
  constant.
- **`purpose`** is a closed set: `register` · `rebind` ·
  `collect` · `conclude`. It is part of the signed bytes, so a
  proof made for one purpose is not a proof for another — a
  collection authorization can never be replayed as a
  registration. For `register` and `rebind` every field above is
  REQUIRED. For `collect` and `conclude`, **`rkid` is REQUIRED
  too** — it names the queue the act works on, and it must be in
  the **signed bytes**, because a relationship may hold several
  addresses at one carrier and a proof that named none would let
  two conformant carriers answer identical bytes differently
  (round-36 B-1; the `/0.2` form, which forbade it there, was
  never instantiated outside this repository's vectors). What
  stays **absent** in those two purposes is `generation` and
  `addressChallenge` — those acts are authorized
  per session against a binding that already exists, and they
  change no succession, so the field that carries succession has
  nothing to say in them — and their absence is part of the JCS
  bytes like everything else.
- **`generation` carries the register's succession to the
  carrier, and the carrier enforces it.** It is the `generation`
  of the holder's carrier-nonce entry (Identity §7a.3), an integer
  in that section's domain `[1, 2^53 − 1]`, and it is part of the
  signed bytes like everything else. Without it, possession alone
  decided which principal held an address — and possession is
  **not** monotone: a device restored from an older backup still
  holds the root IKM, the older nonce and the `rkid`'s private
  key, so it can prove everything a rebind requires and roll the
  binding **back** to a principal the register had already
  superseded, with the newer device rolling it forward again. The
  register's ordering was local, and nothing carried it across the
  port. Now it does:

  > **A rebind binds only with a `generation` strictly greater
  > than the one recorded for the current binding** — the
  > `live`/`closing`/`released` rows of the outcome table below,
  > which carry the equal and lower cases with them. The carrier
  > cannot decide a tie the register decides by nonce bytes, and
  > fails closed rather than guessing.

  **Why this contract does not carry a tie-breaker — and a
  retraction, because the previous casting claimed more than it
  had.** The obvious repair is to put the register's tie value
  into the proof so the carrier could recompute the ordering. The
  previous casting called that **impossible** and offered an
  argument: any order-preserving function of the nonce is the same
  at every carrier, hence a cross-carrier join key. **That
  argument is wrong**, and it is worth saying so plainly rather
  than quietly narrowing it: a carrier-scoped, order-preserving
  map exists trivially — `f_C(N) = N · 2^256 + k_C` for a
  per-carrier `k_C` orders identically to `N` within one carrier
  and differs across carriers. The categorical claim is
  **withdrawn**.

  What is true is smaller and is stated as what it is — a
  **deliberate omission, not a theorem**: a tie value that
  travelled would have to be (a) derivable identically by both
  devices from register state alone, (b) **authentically bound to
  the derivation**, or a carrier could be handed any ordering a
  presenter preferred, and (c) analysed for what it leaks to a
  carrier that also sees the principal and the address. No such
  construction is designed here, and inventing one under time
  pressure at the seam of two documents is exactly how this loop
  has previously produced half-built mechanisms. **So: this
  contract carries no tie-breaker, a carrier therefore cannot
  decide the tie, and whether a safe carrier-scoped ordering proof
  is constructible is an open question** — recorded in Section 12
  as DO-7 rather than settled by assertion. The refusal rule below
  does not depend on the answer.

  **`refused(stale-generation)` carries the generation the carrier
  holds for that `rkid`** (round-39 B-1). This is a disclosure and
  it is stated as one: the verdict is reachable only by a request
  that has **already** cleared both possession proofs — a
  signature under the principal it names, and the opened address
  challenge, which no one but the holder of that `rkid`'s private
  key can produce. What the number is for is **ordering**, not
  access: succession at an address is authorized by possession of
  that address, and a party who can open the challenge can rebind
  at any higher generation whether or not it knows the current
  one. The generation was therefore never a barrier, and treating
  it as one was an accident of not saying it out loud — while
  *withholding* it broke a promise this stack makes elsewhere
  (Identity §9.3), because a holder who lost their carrier entry
  has no other way to learn what to exceed. A carrier MUST include
  it; it discloses nothing to anyone who has not already proven
  they may take the binding.

  **`refused(stale-generation)` at an equal generation is
  therefore a wait state, not an end state**, and the healing path
  is the register's own machinery rather than a new mechanism:

  1. Two partitioned devices honestly create `N₁` and `N₂` at the
     same generation; the one that reaches the carrier first binds.
  2. The registers merge and converge — deterministically, by
     Identity §7a.3's rule — on one canonical entry, which may be
     the one that did **not** bind.
  3. The canonical device presents its rebind and is refused: same
     generation, different principal.
  4. **It rotates.** A rotation is `generation + 1` (Identity
     §7a.3), it wins the register by construction, and it binds at
     the carrier by strict monotonicity. One extra rotation, no
     new instrument, and the two orderings agree again.

  The cost is exactly that rotation, and it falls on the honest
  case that produced the tie; the carrier learns nothing it did
  not already see.

  **The corner where rotation is unavailable — and the exit that
  actually exists there.** At the very top of the generation
  domain Identity §7a.3 forbids a further rotation, so the healing
  path above is closed. A previous casting sent that case to
  "re-addressing", which **contradicted Identity's own promise**
  that the entry at the maximum "stays canonical and keeps working
  — indefinitely", and which asked the holder for a move it cannot
  make. Both were wrong, and the exit was already in the rules:

  > **The binding stands, and it stays collectable.** Entries are
  > **superseded, never deleted** (Identity §7a.3), so every
  > device of the person retains the losing entry and can derive
  > **its** principal — including the one the carrier is bound to.
  > Collection and conclusion require possession of that
  > principal's key (above), which every device has. Nothing is
  > lost: deposits arrive, are collected, and are concluded.

  What the tie costs at the maximum is therefore **not the
  relationship and not the queue**, but only the ability to
  *change which of two principals* holds the binding — and at that
  point there is nothing left to change it for. The distinction
  the register draws between canonical and superseded governs
  which entry is authoritative for **new** derivations; it was
  never a statement that a superseded principal stops working
  where it is already bound. A holder who nonetheless wants a
  different principal at that carrier has Identity §7a.2's move
  (a different configured `C` derives different principals
  without touching `N`), and a genuinely new relationship chain
  remains what §7a.3 says it is — a social event of the
  companions, named as a consequence and never as an instruction.

  Honestly labelled, and doubly so: this is a tie **at** a maximum
  that takes on the order of a hundred million years of per-second
  rotation to reach, entered from both sides at once. It is
  written down so the domain has no undefined corner, not because
  anyone will stand in it.

  The carrier therefore keeps, per binding, the `generation` it
  last accepted — one small integer beside the binding it already
  holds — and the two orderings agree: what the register
  supersedes locally, the carrier refuses to resurrect. "Possession
  is the authority; incumbency is not" stands unchanged, with the
  addition that **a superseded generation buys no new
  authorization** — stated exactly, because the shorter form
  ("possession of a superseded generation is possession of
  nothing") was **false** and is withdrawn (round-19 M-2). A
  principal whose generation the register has superseded but
  which the **carrier is still bound to** keeps working: it
  collects, it concludes, and it holds its queue until a proof
  carrying a strictly greater generation rebinds the address —
  which is exactly what the tie at the maximum relies on two
  paragraphs above, where the incumbent binding *stands and stays
  collectable*. What a superseded generation cannot do is
  **register, rebind, or resurrect**: it cannot take an address
  it does not already hold, cannot displace a higher generation,
  and cannot re-enter after release, because the tombstone
  outlives the binding. Supersession is a statement about
  **succession**, not about a live binding's ability to serve.

  **And the memory must outlive the binding, or the sentence above
  is only true while the binding lasts.** A binding is *released*
  at the end of the two-phase wind-up (5a.9); with it, the
  generation it recorded would go too, and the next proof — even
  one from an old backup carrying a long-superseded generation —
  would meet "no live binding" and be `registered`. Resurrection
  by patience, rather than by force. So the carrier keeps a
  **binding tombstone**, in the shape Access §7.3 already uses for
  exactly this purpose:

  > On releasing a binding, a carrier MUST retain, per `rkid`, the
  > **highest generation it ever accepted** for it, and MUST
  > refuse any later registration for that `rkid` whose
  > `generation` is not strictly greater —
  > `refused(stale-generation)`, as for a live binding. The
  > tombstone is `(rkid, generation)`: an address the carrier has
  > always held in the clear and one small integer.

  **Why this does not contradict Section 9's "nothing durable
  before both proofs verify".** That property is about the
  *pre*-verification phase — challenge state an attacker can force
  a carrier to allocate before proving anything. A tombstone is
  **post-acceptance** state: it exists only because a binding once
  existed, and a binding was durable by construction. Access §7.3
  draws the same line, keeping a tiny durable core through every
  discard while allocating nothing to an unproven presenter.
  Nothing here is reachable by a party that has not already
  completed both proofs at least once.

  **The tombstone does not expire, and the previous casting's
  reason for expiring it was wrong.** That casting gave the
  tombstone a declared retention and bounded the residual after it
  by claiming `key-retention` would have retired the address by
  then. Checked against Section 5, the claim does not hold:
  `key-retention` is a **minimum** duration after a key last
  appeared in a card, and **nothing** requires an orphaned `rkid`
  to leave current cards, requires its private key to be
  destroyed, or stops a conforming sender from still using it. The
  residual was therefore not "an address nobody uses" but a live
  address on which a superseded generation could return by
  waiting. The expiry edge is **withdrawn**:

  > A binding tombstone is retained **with no expiry in time** —
  > through every discard, as Access §7.3 retains its generation
  > tombstone — and leaves in exactly two ways: the capacity rule
  > below evicts it, or a registration carrying a **strictly
  > greater** generation **consumes** it (outcome table,
  > `released × register/rebind`). Nothing about it lapses because
  > a clock ran.

  **The growth this costs — and a second retraction, because the
  previous casting's argument for keeping them forever was also
  wrong.** That casting said a tombstone "can only come into
  existence through a completed registration ... not anything an
  attacker can mint", and concluded the store was safe to keep
  unbounded. The conclusion does not follow: an attacker mints its
  **own** `rkid`/principal pairs, proves both halves honestly —
  they are its own keys — never collects, lets the empty bindings
  release on the `orphan-horizon`, and repeats. Every cycle leaves
  a permanent record. That is a service-wide, permanent storage
  consumption which no other bound reaches, and DO-6 does not
  cover it. So the store is **bounded like every other resource in
  this contract**:

  - **`max-binding-tombstones`** — an integer, `max-queues ≤ n ≤
    2^53 − 1`: how many binding tombstones the carrier retains.
    At the bound, admitting a new one evicts by a **total order**,
    and it has to be total rather than merely "oldest": several
    empty bindings can be registered together, never collected,
    and released at the *same* `orphan-horizon`, so a release
    *moment* alone leaves ties — and two conformant carriers that
    broke a tie differently would keep different `rkid`s, so the
    same old registration would be `refused(stale-generation)` at
    one and accepted at the other. The order is therefore:

    > **evict the tombstone with the smallest release ordinal.**

    **The release ordinal, and why it is not a clock.** A previous
    casting said "earliest release time, measured in whole
    milliseconds", and that is **not an executable rule for state
    that outlives a restart** (round-19 B-3). The tombstone is
    durable post-acceptance state by construction; a *monotonic
    instant* has no meaning across a restart — 4.4 says so itself
    for the rate bucket and defines a restart rule there — and a
    *wall clock* steps backwards, so two restarts or one clock
    correction could name different "oldest" tombstones and the
    same old registration would then be `refused(stale-generation)`
    at one carrier and accepted at its replica. The order is
    therefore **not read from a clock at all**:

    - **`releaseOrdinal`** — an integer in `[1, 2^53 − 1]`, in the
      canonical decimal spelling 4.4 requires of every integer in
      this contract. It is **assigned when the binding is
      released** and **stored with the tombstone**, which is
      already durable, so this adds no new class of persisted
      state and nothing an attacker can aim at that the tombstone
      is not already.
    - **Strictly increasing, by one, per released binding.** The
      next value is `max(stored ordinals) + 1`, **and for an
      empty store it is `1`** — the base case, written down
      because a state machine this contract calls closed has no
      right to leave `max` of nothing to the implementer
      (round-20 B-2). A restarted carrier therefore recovers the
      counter **from the store itself**, including the case where
      the store is empty — exactly the discipline 4.4 uses for
      `micro`, and for the same reason: the only durable thing is
      the state, never a clock reading.
    - **Several bindings releasing at the same `orphan-horizon`
      get consecutive ordinals, assigned in ascending unsigned
      bytewise order of the decoded `rkid` key bytes.** This is
      where the byte order does its work. It is not a tie-break
      *after* the fact — it is the rule that fixes the assignment,
      so that a sweep releasing several bindings at once produces
      one determined sequence rather than an arbitrary one.
    - **Ties cannot occur, and a store containing two equal
      ordinals is malformed.** Should an implementation
      nevertheless face one, it MUST resolve it by the same
      ascending bytewise `rkid` order, so the rule stays total on
      any input.
    - **The release step, in the order its parts must run.** A
      release is not "assign an ordinal"; it is three acts, run
      as **one sweep** — the linearized check-and-commit step of
      4.4's atomicity rule, with its own `k`; two sweeps never
      overlap, so independent releases are joined into one sweep
      or serialized as separate ones (round-29 B-2). Only this
      order always has a legal successor state:

      > **r1. Evict first, smallest ordinal upward, until the
      > store holds at most `max-binding-tombstones − k`**, where
      > `k` is the number of bindings this step releases —
      > eviction is what makes room for **all** of them, and it
      > happens before anything is assigned.
      > **r2. Renumber, if the `k` assignments of r3 would not
      > fit** — that is, if `max(stored ordinals after r1) + k >
      > 2^53 − 1` — the whole store to `1..n` **in the current
      > order**. The condition is the **headroom the whole sweep
      > needs**, not equality with the top of the domain: a sweep
      > with `k = 2` against a store whose largest ordinal is
      > `2^53 − 2` fits neither assignment without renumbering,
      > and exact equality would not have fired (round-32 B-1).
      > Near the top of the domain this is a **MUST**, not a
      > courtesy: without it there is no next value inside the
      > closed domain, and a release is not optional.
      > **r3. Assign** the next ordinal(s) — `max(stored) + 1`,
      > or `1` for an empty store — to the released binding(s),
      > in ascending bytewise `rkid` order where several release
      > together.

      **Why this order always terminates**, including at the two
      places the previous casting left open: the store holds at
      most `max-binding-tombstones ≤ 2^53 − 1` entries, so after
      r1 it holds at most `max-binding-tombstones − k`, and after
      r2 its largest ordinal is at most that number — leaving at
      least `k` values **at or below** `2^53 − 1` (the top of the
      domain is itself assignable, which is what makes the count
      exact — round-34 m-1), which is exactly the
      headroom r3 consumes and exactly what r2's condition tests
      (round-32 B-1) — strictly below `2^53 − 1` for every
      `k ≥ 1`, and `k` is bounded by
      the live bindings it releases: at most one is live per
      address, so `k ≤ max-queues ≤ max-binding-tombstones` by
      4.4's own bound — so r3 always has `k` values inside the
      domain and the store never exceeds its capacity. Doing r2 *before* r1 is what fails at the extreme:
      a store of capacity `2^53 − 1` renumbered while still full
      occupies the whole domain and leaves nothing to assign.
      Renumbering is otherwise permitted at any time (a carrier
      MAY compact early) and is **required** only at the top.
    - **Renumbering is safe here in a way the register's
      generations are not**: an ordinal is carrier-local, travels
      in nothing, and is never compared across carriers, so
      renumbering preserves exactly the relation it encodes. Time
      is not involved, so no clock correction and no restart can
      change the answer.

    The rule is total, needs nothing but the store's own contents,
    and is stable under re-evaluation — the same three properties
    Identity §7a.3 asks of its own tie-break, and the same
    fallback. It is also the only eviction rule in this contract
    that is not a refusal, because refusing here would mean
    refusing to release a queue. Wall-clock **time still decides
    when a binding is released** — that is the `orphan-horizon`,
    and it is a duration, not an ordering; what the ordinal
    records is the *sequence* in which releases actually happened
    at this carrier, which is the only thing eviction needs.

  **What eviction costs, computed with its preconditions rather
  than asserted** — the discipline this loop learned the hard way,
  and the previous paragraph is why:

  1. **For an evicted `rkid`, the anti-resurrection guarantee
     ends.** That is the honest consequence and it is stated
     first.
  2. **Only one party can use it.** Re-installing a superseded
     generation needs **both** proofs — the principal's Ed25519
     key, derivable only from the root IKM and that nonce, and the
     `rkid`'s X25519 private key from its pair context. That is
     the person themself, or a device holding their state. **A
     third party gains nothing from an eviction**, whoever forced
     it.
  3. **Only `released` addresses are evictable, oldest first** —
     the states are exclusive (outcome table above), so eviction
     reaches the longest-dormant addresses first.
  4. **Forcing eviction is metered — but the waits do not add
     up, and the previous casting's arithmetic said they did.**
     Each attacker tombstone costs a full registration (both
     proofs, the challenge charge, the registration capacity of
     4.4) and passes through an `orphan-horizon` before its
     binding releases. **Those horizons run in parallel**: an
     attacker registers up to `max-queues` bindings at once,
     never collects, and they release together after **one**
     horizon — so at the smallest conformant configuration
     (`max-binding-tombstones` = `max-queues`) a single prepared
     wave can displace the whole store after one waiting period,
     not one period per tombstone. The claim "cannot flush the
     store in a burst" was therefore too strong and is withdrawn.
     What remains true is the part that matters: the cost is
     **one registration per tombstone** — proofs, charge and
     capacity, all of them metered and declared — and a carrier
     that does not want a one-wave flush declares
     `max-binding-tombstones` well above `max-queues`, which is
     exactly why the domain's floor is a floor and not the
     intended value.

  **The trade, stated plainly:** an unbounded permanent store
  (a real, unmetered attack) is exchanged for a bounded one whose
  overflow reopens resurrection **on the oldest dormant addresses,
  and only for the person who owns them**. That is the smaller
  residual by a wide margin, and unlike the previous arrangement
  it is one this contract can actually keep.
- **Both challenges are exactly 32 bytes** from a cryptographically
  secure source, carried as canonical unpadded base64url — exactly
  43 characters, fixed length, no padding, `mod 4 ≠ 1`, zero
  trailing bits, the same canonicity rule Section 5 applies to
  envelope fields. "At least 32" was the last variable length in
  the construction and it is gone: every field of the object is
  either a fixed-length encoding or a JCS string, so there is no
  concatenation left to be ambiguous about.
- Challenges MUST be **single-use**, and "single-use" is dated
  precisely in 4.4: a challenge is **consumed by the first
  response attempt, before that response is verified**, so one
  challenge buys at most one signature verification and a failed
  attempt buys a fresh challenge, not a retry. They MUST expire on
  the carrier's declared `challenge-lifetime` (4.4) — an unexpiring
  challenge is a standing forgery target, and an *undeclared*
  lifetime leaves the carrier's own work bound unstated: that
  bound is the one 4.4 point 4 states, over the unreserved pool
  **and** the per-address reserves, both metered by this same
  lifetime.
  **Issuing a challenge is itself a charged act** and follows
  4.4's ordering: syntactic checks, then the budget, then — only
  for a request that holds a charge — any randomness, sealing,
  or asymmetric operation at all (4.4 step (b)). A carrier MUST reject a proof whose
  `carrier` field is not byte-equal to its own configured
  identifier (Identity §7a.2), whose `principalChallenge` it did
  not issue for this exchange, or whose `addressChallenge` is not
  the value it sealed to exactly this `rkid`. **And it MUST
  reject — `refused(malformed)` — a proof whose `generation` is
  not in the canonical decimal form Identity §7a.3 requires (no
  sign, no leading zero, no fractional part, no exponent),
  checked on the **received bytes** and not on the parsed
  number.** That the check must be lexical is not a nicety: `1.0`
  and `1e0` parse to the same number, JCS canonicalizes both to
  `1`, and the shipped signature therefore **verifies** over
  them — so nothing later in this exchange can catch a
  non-canonical spelling, and the shipped schema cannot express
  it either (round-28 M-1). Section 11 ships the four negatives —
  two that reach the signature and two that die in the parser
  (round-30 M-1).
- **What stays below the port line is the carriage, not the
  bytes.** How the object travels — HTTP body, DIDComm message,
  socket frame — is unspecified here, deliberately. What it
  contains, how it is serialized, and what is signed are fixed
  above, because those are what two independent implementations
  must agree on and what a transplant vector needs in order to
  exist at all. **`schemas/carrier-proof.schema.json` is its
  normative shape** — the closed field set, the conditional
  presence of `rkid` and `addressChallenge` by `purpose`,
  `additionalProperties: false`, and the encoding bounds — because
  a signed artifact of this stack without a shipped schema is not
  a defined artifact, whatever its prose says.
- **Schema validity is not acceptance, and the schema says so.**
  The identifiers in this object are base58btc, which is **not a
  positional encoding**: unlike the base64url challenges — where
  six bits per character let a pattern forbid a non-canonical
  alias outright — a *decoded* multicodec prefix or a *decoded*
  byte length is a numeric interval, and no pattern in the shipped
  JSON-Schema dialect can express one. The consequence is stated
  rather than hidden: `did:key:z6Mk` followed by 44 `1`
  characters decodes to prefix `0xec 0xfe`, `z6LS` followed by 44
  `z` characters to `0xec 0x02`, and a base58btc string of 86 to
  88 characters may decode to 63, 64 or 65 bytes — **every one of
  those satisfies the schema and none of them is a valid carrier
  proof.** A carrier therefore MUST, before any other check,
  **decode** and require: `principal` = `did:key:` + multibase
  `z` over `0xed 0x01` followed by exactly 32 bytes; `rkid` =
  multibase `z` over `0xec 0x01` followed by exactly 32 bytes;
  `sig` = multibase `z` over exactly **64** bytes. A proof failing
  any of these is `refused(malformed)`. This is a **verifier
  obligation, not a schema property**, it is checked in Section
  11, and `vectors/carrier-proof.json` ships the schema-valid,
  normatively invalid aliases so that an implementation which
  stops at schema validation is detected rather than assumed
  absent.
  `vectors/carrier-proof.json` ships the values (Section 11):
  the object, its JCS bytes, its signature, and the negatives — the same proof
  presented for a second `rkid`, for a second principal, at a
  second carrier, and under a changed `purpose`, each of which
  changes the signed bytes and therefore fails.

**The queue belongs to the `rkid`; the principal is who may
collect from it.** This is already implied by 5a.1 — a sender
knows only the `rkid`, and the locator is a carrier-local handle
for one queue — and it is stated here because registration is
where it becomes operative. Registration does not create the
address; it names who is authorized to act on the queue that
address feeds.

**Outcomes are a closed, deterministic set**, in the manner of the
Replication Contract's §7.4 verdicts — a function of the proofs,
the carrier's declared constants, and its held state, and of
**nothing about the party presenting them**:

**Verdicts** — what a presenter is told:

`registered` · `registered(idempotent)` · `rebound` · `served` ·
`refused(no-such-queue)` · `refused(possession-failed)` ·
`refused(malformed)` · `refused(stale-generation)` ·
`registration-refused(capacity)` *(retriable)* ·
`refused(admission-resource)` *(retriable)*

**Internal transitions** — cells with **no presenter and no
verdict**, listed here so that the table below draws every cell
from **one** closed set and Section 11 can require exactly that:

`wind-up begins` · `obligations discharged` · `released` ·
`evicted` · `cannot arise`

**And the machine that produces them is cast here as one total
table**, in the shape the Replication Contract gives its fork
model — because this lifecycle was prose distributed over 5a.3,
4.4 and Identity §7a.3, and every round found another corner of
it. One `rkid` at one carrier is in **exactly one** state:

`unbound` (no binding, no tombstone) · `live(g, P)` · `closing(g,
P)` (5a.9's wind-up) · `released(t)` (no binding; a **binding
tombstone** recording the highest generation `t` ever accepted).
The tombstone store holds **exactly** the `rkid`s in `released` —
that mutual exclusion is what makes 5a.3's `k`-counting right.

The table is entered only by a request that has already passed
4.4 step (b) and both possession proofs; `refused(malformed)`,
`refused(possession-failed)` and `refused(admission-resource)` are
decided **before** the state is consulted and are therefore not
cells; a **submission** is not an input here either — it runs
5a.5's own outcome set. `g′`/`P′` are the generation and principal
the proof carries.

**`registration-refused(capacity)` is pre-ordered too, but only
against the transitions that can breach the bound it names**: the
`max-queues` and `max-total-bytes` check runs before the state is
consulted **for the two cells that create an additional
binding** — `unbound × register/rebind` and
`released × register/rebind` — and **not** for the `live` and
`closing` cells, which move a binding the carrier already holds
and leave the count where it was. Refusing a rebind at
`max-queues` would refuse the honest return path 5a.9 and Section
11 promise, for a bound the rebind does not touch.

| state | input | precondition | outcome | next state |
|---|---|---|---|---|
| `unbound` | register / rebind | — | `registered` | `live(g′, P′)` |
| `unbound` | collect / conclude | — | `refused(no-such-queue)` (5a.5) | `unbound` |
| `unbound` | orphan-expiry · give-up-sweep · release · eviction | — | `cannot arise` (no binding, no tombstone) | `unbound` |
| `live(g, P)` | register / rebind | `g′ > g` | `rebound` | `live(g′, P′)` |
| `live(g, P)` | register / rebind | `g′ = g`, `P′ = P` | `registered(idempotent)` | `live(g, P)` |
| `live(g, P)` | register / rebind | `g′ = g`, `P′ ≠ P` | `refused(stale-generation)` | `live(g, P)` |
| `live(g, P)` | register / rebind | `g′ < g` | `refused(stale-generation)` | `live(g, P)` |
| `live(g, P)` | collect / conclude | proof under `P` | `served` (5a.7, 5a.8) | `live(g, P)` |
| `live(g, P)` | orphan-expiry | no collection within `orphan-horizon` | `wind-up begins` (5a.9) | `closing(g, P)` |
| `live(g, P)` | give-up-sweep · release · eviction | — | `cannot arise` (the wind-up has not begun) | `live(g, P)` |
| `closing(g, P)` | register / rebind | as the three `live` rows above, verbatim | same outcome | on `rebound` / `registered(idempotent)`: **`live`**, admission reopens (5a.9); on a refusal: `closing(g, P)` |
| `closing(g, P)` | collect / conclude | proof under the bound principal | `served` — concluding is what `closing` is for | `closing(g, P)` |
| `closing(g, P)` | orphan-expiry · eviction | — | `cannot arise` (the wind-up has begun; only `released` is evictable) | `closing(g, P)` |
| `closing(g, P)` | give-up-sweep | every admitted deposit disposed, or `give-up-horizon` reached | `obligations discharged` | `closing(g, P)`, release due |
| `closing(g, P)` | release | the row above has run | `released` — queue and binding released; **one** tombstone created, `t := g`, ordinal by r1–r3 | `released(g)` |
| `released(t)` | register / rebind | `g′ > t` | `registered` | `live(g′, P′)`, and the tombstone is **consumed** — its store entry and ordinal go with it |
| `released(t)` | register / rebind | `g′ ≤ t` | `refused(stale-generation)` | `released(t)` |
| `released(t)` | collect / conclude | — | `refused(no-such-queue)` (5a.5) | `released(t)` |
| `released(t)` | eviction | the store is at `max-binding-tombstones` and this is the smallest ordinal | `evicted` — the anti-resurrection guarantee for this `rkid` ends | `unbound` |
| `released(t)` | orphan-expiry · give-up-sweep · release | — | `cannot arise` (no binding exists) | `released(t)` |

Three cells were found by composition rather than by reading, and
carry their reason with them. **Consumption** weakens nothing: the
only proof that consumes a tombstone is one the tombstone already
permits, and an `rkid` never holds both a binding and a tombstone.
**`rebound` names the succession, not a change of person**: with
`g′ > g` the recorded generation MUST advance, `P′ = P` or not.
And **`purpose` does not select a cell** — `register` and `rebind`
are distinct in the signed bytes and equivalent in effect, because
a holder recovering from a partial loss cannot know which state
the carrier is in and 5a.9's return path depends on its guess not
mattering; what purpose separation buys is transplantation
resistance, not intent.
- `refused(possession-failed)` — one or both proofs failed. The
  challenge is **already consumed** at this point (4.4), so this
  outcome is not retriable in the strongest sense available: the
  same response cannot be presented again against anything live,
  and another attempt begins with a fresh challenge and a fresh
  charge. A carrier MAY meter repeated failures under its declared
  admission resource in addition, per principal, never per
  person — but it does not need to in order to bound the work,
  which is the point of consuming first.
- `registration-refused(capacity)` — the carrier is at
  `max-queues` — every binding it holds, `live` and `closing`
  (4.4) — or the registration would take it past
  `max-total-bytes`. It is **retriable** (capacity is a
  state, not a judgement) and **deterministic**: a function of the
  declared bounds and the carrier's held state, never of anything
  about the presenter. It is the same closed outcome the
  Replication Contract's §9 uses for a service at `maxGroups`, and
  it exists because possession proofs bound *theft* and not
  *volume*: without it, minting fresh `rkid`/principal pairs is an
  unbounded Sybil surface.
- `refused(admission-resource)` — the declared resource is
  exhausted for this phase. **The registration and challenge phase
  is metered**, with the **connection** as the bucket key (4.4):
  before a queue exists there is nothing else resource-shaped to
  key it to, and there is deliberately no sender identity.
- `registration-refused(capacity)` also covers **the challenge
  budget**, on the pot that request draws on and on no other —
  4.4 step (b) decides which, and 4.4 point 3 is why a charge
  **ends in exactly two ways and is never refunded by completing
  the exchange**. A refused request costs a syntactic
  check and a counter, and no key operation at all.
- Both retriable refusals are the carrier's resource and capacity
  limits; they are named here so that a registration cannot be
  refused for a reason outside the closed set.

**Rebind, and the exact condition under which it exists.** A
rebind is the ordinary path, not an incident: the holder comes
back with a **new** principal for an address it already
registered, because its carrier nonce changed while the address
did not (Identity §7a.3, §9.3). Three situations produce it — a
carrier entry lost or corrupted, a deliberate rotation of `N`, and
the convergence of two concurrently created nonces in a
multi-device register (Identity §7a.3) — and all three share the
one property the proof rule needs:

> **A rebind requires the `rkid`'s private key, so it exists
> exactly where the pair context survived.** That key is the pair
> context's key-agreement half (Section 5, Identity §5.2); it does
> not live in the carrier entry and is not reconstructible from
> anything a counterpart holds — a counterpart holds the
> **public** address. **After a total register loss with no state
> copy there is therefore no rebind at all**: the pair contexts
> are gone with everything else, the sealed challenge cannot be
> opened by anyone, and the relationship re-addresses instead
> (5a.9). Which loss took the pair contexts with it is decided in
> Identity §9.3; an earlier casting called the private key
> "exactly what the holder still has", which is **withdrawn** for
> the total case.

An attacker never holds that key in **any** of these cases, so no
loss on the holder's side ever becomes an opportunity on the
attacker's. Two rules complete the mechanism:

1. **Possession is the authority; incumbency is not.** A live
   binding does not outrank a fresh valid pair of proofs. Any
   other rule would let a hijack that once succeeded become
   permanent, and would leave the honest holder with no way back
   short of abandoning the address.
2. **A rebind is one durable commit** — the linearizable
   compare-and-swap of Access §7.3's acceptance rule, for the same
   reason: verification, the displacement of the old binding, and
   the installation of the new one either all take effect or none
   do. Two concurrent valid registrations for one `rkid` yield one
   binding, never two, and never a queue with no authorized
   collector.

**The residual this creates, named.** A carrier that observes a
rebind learns that two principals successively controlled one
`rkid` — a link **within one relationship at one carrier**, which
is precisely what that carrier already carries and is not a join
across relationships (the same argument Identity §7a.3 makes for
one principal across a relationship chain). A holder who does not
want even that link rotates the `rkid` as well, which is the
ordinary Section 5 tombstone path and costs one card exchange.
And a rebind is only ever available to a party that can open a
challenge sealed to the address — so the rule buys the honest
holder a return path without buying an attacker anything.

**Collection is the same proof, without the sealed half.** Every
collection and every conclusion (5a.8) under a principal MUST be
authorized by a fresh proof of possession of that principal's key
— a signature over a carrier-issued challenge, Access §7.3 again.
A carrier MUST NOT grant standing to a bearer token that outlives
the session, and MUST NOT accept a collection for one principal
inside a session authorized for another.

**Three things have been called "session" here, and they are now
kept apart** — the ambiguity was real enough to make one behaviour
read as forbidden in this section and merely discouraged in 5a.7:

| Term | What it is | Rule |
|---|---|---|
| **Authorization session** | the scope of one proof of possession: what a carrier has been shown the right to act on | **MUST** carry exactly one principal. A collection or conclusion for a second principal inside it is nonconformant, full stop. |
| **Mediation connection** | the neighbouring protocol's long-lived relationship (a DIDComm connection, a TSP relationship) | **MUST** be one per principal (5a.10). |
| **Transport socket** | TCP, TLS, WebSocket, an HTTP connection | **below the port line**; it carries whatever the transport carries, and this contract says nothing about it. |

The MUST of the first row is what this section owns. What 5a.7
discusses is none of the three: it is the **timing** of separate
authorization sessions — whether a device runs its principals'
collections close together in time — and that is a SHOULD because
it is a scheduling cost, not an authorization question. Nothing is
both permitted and forbidden: sharing an authorization session is
forbidden, scheduling two of them back to back is discouraged and
priced.

### 5a.4 Submission is principal-free (normative)

**A sender presents no identity to a carrier.** There is no sender
principal, no sender account, no channel authentication, and no
carrier-visible sender identifier of any kind. **No protocol field
at or above this contract's port line identifies a submitter or
links two submissions to one**: a submission carries an `rkid`, a
size, and the sealed bytes, and that is the whole of what this
contract puts on the wire.

**What that sentence does not say, stated in the same breath**,
because an earlier casting of it claimed more than any
construction can deliver. Principal-free submission removes the
*identifier*; it does not remove the *observation*. A carrier
still sees, and this contract does not pretend otherwise:

- the **network layer** — source addresses, connection reuse,
  TLS session resumption, everything a transport carries beneath
  us; without network anonymity, a carrier that wants a submitter
  identity has one, and it did not need a protocol field for it;
- **timing and volume** — when submissions arrive, how large they
  are, in what bursts;
- **ack pairing** — the `delivery-ack` is a document in the
  opposite direction, so a carrier holding both directions pairs
  two `rkid`s by response time with no identity whatsoever;
- **collection patterns** — see 5a.7, where the residual is priced
  rather than defined away.

The honest formulation is therefore the narrow one: *this
contract contributes no submitter identifier, and no rule of it
requires one*. Unlinkability is a property of a mix network —
cover traffic, randomized delay, constant-rate collection, in the
manner of the Loopix line of work — and **this contract implements
none of it and claims none of it** (Section 10 restates the same
boundary from the privacy side; the two MUST NOT drift apart).

This is a decision with a price, and the price is named: there is
no sender quota, no sender ban, and no negotiated permission to
send. Defence is **resource-shaped**, and its form is the
`admission-resource` constant every carrier declares (4.4),
metered per principal or per submission and never per person. A
carrier that answers abuse by identifying senders has not hardened
this contract; it has replaced it.

The neighbours resolve this the same way, which is some comfort
that it is not eccentric: a DIDComm mediator does not authenticate
the sender at all and draws its permission from the *recipient's*
standing connection, and ToIP/TSP addresses a carrier under a
**per-relationship VID** rather than a person. Both authorize
**relationship-wise**, not person-wise. *(An earlier casting
called that VID "private", which crosses TSP's own taxonomy: the
**outer** VID of a direct carrier relationship is visible to that
carrier — it is the *nested inner* VID that is private, and 5a.10
forbids mapping the control principal onto that one. The property
that matters here is per-relationship scope, not privacy.)*

### 5a.5 Admission: what a carrier may check, and what it never may (normative)

A declaration slot is not an admission rule. 4.4 fixes **which**
resource a carrier spends and at **what scale** it meters it; this
section fixes what a carrier is allowed to look at when a
submission arrives, and closes the outcome set — otherwise
"principal-free submission" is a prohibition with no positive
story, and an implementer fills the silence with the first thing
that works, which is a sender identity.

**A carrier MAY consider exactly these, and MUST consider nothing
else:**

1. **Whether the `rkid` names a queue it holds** — live per 5a.3,
   or tombstoned per Section 5. This is a lookup on the value the
   envelope carries, not a judgement about anyone.
2. **The envelope's shape and size** against Section 5 and its own
   declared bounds.
3. **Its declared `admission-resource`** (4.4), evaluated at the
   fixed metering scale: per submission, or per principal — that
   is, per **queue** — and never per person.
4. **Its own held state**: the storage already occupied by that
   queue, and its overall capacity.

**A carrier MUST NOT consider, require, or record as an input to
this decision:** any sender identity, account, credential,
invitation, device certificate or attestation; any channel
authentication of the submitter; any counter, quota, or reputation
keyed to a submitter rather than to a submission or a queue; or
any correlation of two submissions to one submitter. The last one
is the subtle one and is stated as a rule about **inputs**: a
carrier inevitably *observes* addresses and timing (5a.4), and
this contract does not pretend to prevent that — but it MUST NOT
turn such an observation into an admission rule, because a rule
keyed to an inferred submitter is a sender account under another
name, reached by inference instead of by registration.

**The outcome set is closed and deterministic**, in the manner of
the Replication Contract's §7.4 verdicts, with retriability marked
because the sender's behaviour depends on it:

`admitted` · `duplicate` · `refused(no-such-queue)` ·
`refused(queue-closed)` · `refused(bounds)` ·
`refused(admission-resource)` *(retriable)* ·
`refused(queue-saturated)` *(retriable)* ·
`refused(capacity)` *(retriable)*

- **`duplicate`, byte-exactly** — an outcome cannot be part of a
  closed deterministic set while the condition that produces it is
  unstated. Three rules, and each is forced by the carrier being
  **key-blind**:
  - **Identity.** Two submissions to one queue are duplicates
    **iff their sealed envelopes are byte-identical** — the same
    `rkid`, `epk`, `nonce`, and `ciphertext`, compared as bytes.
    That is the only comparison a key-blind carrier can make, and
    it is therefore the only one this contract asks for. A carrier
    MAY hold the comparison as a digest over exactly those bytes;
    it MUST NOT derive the condition from anything else.
  - **What is *not* a duplicate, said explicitly because the two
    mechanisms are easy to confuse.** **Re-sealing the same
    document is a different envelope**: Section 5's construction
    draws a fresh `epk` and `nonce` every time, so two seals of
    one document share no bytes and are two **admitted**
    submissions. The receiver's duplicate machinery of §6.2 works
    on the **document digest after decryption**, and that is where
    re-sealed repetition is handled — precisely, and only, as far
    as §6.2 actually reaches: its cache holds the digests of
    effects whose **stage 9 completed**, so a repetition of a
    completed document is absorbed as `duplicate-known` with the
    stored acknowledgement re-sent, while a repetition of one that
    failed at any earlier stage is re-evaluated in full. Two
    layers, two comparisons, and neither pretends to do the
    other's work: a carrier that tried to see through the seal
    would be neither able nor permitted to.
  - **State.** A carrier holds the comparison value for a
    submission **exactly as long as it holds the deposit** —
    until collection and conclusion, or until give-up (5a.8). It
    is a value over bytes the carrier already stores, so it adds
    no storage class and no new retention question, and it is
    bounded by the two-phase wind-up like everything else in a
    queue. Once a deposit has left, a byte-identical
    re-presentation is a **new** submission and is `admitted`;
    the carrier has nothing left to compare it against, and
    pretending otherwise would require keeping digests forever.
  - **Metering, and why this direction and not the other.** A
    `duplicate` **consumes the admission resource** exactly like
    an `admitted` submission, and **consumes no storage**: no
    second copy is kept, and the queue's occupancy against
    `max-queue-bytes` does not move. Both halves are chosen
    against a specific failure. Not charging the resource would
    make byte-identical replay a **free amplification channel** —
    an attacker could force lookups at no cost, which is exactly
    the shape of hazard 4.4's ordering exists to prevent. Charging
    storage twice would let one deposit's bytes be counted many
    times and starve a queue with a single message. So: the work
    is charged because work happened; the storage is not, because
    no storage happened.
  - **Where the check sits in the order.** After the cheap
    syntactic checks and **after** the resource charge, and
    **before** storage admission. That position is what makes the
    two metering rules above true rather than aspirational: a
    duplicate cannot bypass the charge, and cannot reach the
    store.
  - **What the sender sees:** nothing new. The deposit is
    present, so the status stays `accepted` (6.1); `duplicate` is
    an outcome at the carrier interface, never a fourth status and
    never a statement about a party.

- **Determinism** means: the outcome is a function of the four
  admissible inputs above, the carrier's **declared** constants
  *including their parameters* (4.4), and its held state — so two
  carriers whose declarations are byte-equal answer the same on
  the same state, and a submitter can predict the answer without
  knowing anything about itself. A carrier that varies the outcome
  by anything else is nonconformant.

  **The claim is only as wide as the declaration, and this is
  where it ends.** An earlier casting asserted determinism while
  the admission resource was a bare kind — a carrier could publish
  `"rate"` and still choose its own window, so two conforming
  carriers could decide oppositely on identical inputs and the
  claim was simply false. 4.4 now requires the parameters that
  make each kind computable, and the claim holds **exactly** as
  far as they reach: fully for `none`, `size`, and `rate`; for
  `work` and `payment` only toward a counterpart that holds the
  named `admission-scheme`'s profile, since this contract defines
  no scheme. One outcome stays honestly unpredictable in every
  case: `refused(capacity)` is the carrier's global fill, which no
  carrier can publish in advance without publishing its
  occupancy — it is retriable, it is a resource statement, and it
  is named here rather than pretended away.
- **Retriable** means: the same submission, presented later, may
  be admitted; the resource was momentarily unavailable, and
  nothing about the submission was judged. **Non-retriable** means
  repetition changes nothing.
- `admitted` is what the sender sees as `accepted` (6.1) and
  carries the durability duty from that moment. The refusals map
  into the sender's closed status set without adding a state:
  `refused(no-such-queue)` and `refused(queue-closed)` →
  `failed(unroutable)` (the address no longer receives, and a
  sender learns exactly that much — never why, never that a
  wind-up is in progress);
  `refused(bounds)` → `failed(oversize)`; a retriable refusal is
  **not yet a status** — the sender retries until its adapter's
  declared `give-up-horizon` (4.4), at which point it is
  `failed(expired-by-adapter-policy)`.
- **No refusal ever carries a reason about a party**, and none is
  reported to the recipient. A carrier that answers "this sender
  is not allowed" has left this contract.

**The residual, stated at full strength rather than at a
comfortable one.** Because admission is resource-shaped and the
address is public, **anyone who holds an `rkid` can spend that
queue's budget** — sealed garbage is indistinguishable from sealed
content to a key-blind carrier. Two consequences follow, and the
second is sharper than earlier castings admitted:

- The queue fills and legitimate submissions meet
  `refused(queue-saturated)` until it drains.
- **The rate bucket is keyed to the queue, so a flooder spends the
  honest counterpart's allowance.** This is not a tuning problem
  to be fixed with a bigger bucket: it is what per-queue metering
  *means*. The flooder and the one legitimate sender share one
  budget, so the attack is a **denial of service against one
  relationship**, not merely a storage nuisance.

**And the reason no resource parameter closes it is worth writing
down, because it is the whole architecture in one sentence:**
telling the flooder apart from the honest sender **is** sender
identification. Every resource-shaped lever — a smaller bucket, a
larger one, `work`, `payment` — changes what the attack costs and
never who is allowed; a lever that distinguished them would be the
sender account 5a.4 abolishes, reached by another name. So the
defence available inside this design is not prevention but a
**cheap, terminating cure**, and the contract owes that path
precisely:

> **Rotation is the named healing path (normative).** A recipient
> whose queue is under flood **SHOULD rotate the `rkid`** of that
> relationship: it publishes a fresh key-agreement key to its
> counterpart in a new contact card **over the existing
> relationship channel** — not a new encounter, not an
> out-of-band meeting — and retires the flooded one by the
> ordinary Section 5 tombstone rule. The carrier then winds the
> old queue up by 5a.9's two phases: admission closes, everything
> already admitted is concluded or given up, nothing is silently
> lost, and the flooded address stops consuming anything. The
> counterpart's outbound path is uninterrupted, because it holds
> the new card before the old address dies (`key-retention`,
> Section 5, keeps the old key alive for exactly this overlap).

Three properties bound what remains, and none of them removes it:
the blast radius is **one relationship's guaranteed capacity at
one carrier** (the same granularity property Section 9 states for
key compromise), never the person — with the elastic room above
the floors honestly outside that bound, since it is shared; the attacker must **already hold the address**, which
means it was a counterpart or saw a card, so this is not a
broadcast attack on strangers; and rotation is repeatable and
in-relationship, so the cost of curing is bounded and does not
grow with the number of attempts.

**And the first of those three is a claim about storage that only
holds because 4.4 makes it hold.** Byte occupancy is the one
resource a flood could otherwise push *across* queues: with a
global bound and no per-queue reservation, filling one queue could
have made every other queue meet `refused(capacity)`, and the
"one relationship" boundary would have been false for exactly the
resource that matters most. `queue-floor` and the required
`max-total-bytes ≥ max-queues × queue-floor` (4.4) are what keep
it true: below its floor, a queue's admission is beyond the reach
of any other queue. Above the floor the room is shared and can be
denied — that part is stated in 4.4 and is not claimed away
here.

**Who is actually left, once rotation is in place — and this is
the classification, not an excuse.** An `rkid` is not a public
identifier in the way a phone number is: it travels only inside
the relationship it addresses (Section 5, Encounter §4.4), and a
rotated one travels only over the established end-to-end channel.
So the flood needs the address, and there are exactly two ways to
hold it:

- **A third party** who obtained an old address once — a leaked
  card, a compromised backup, an old device. Against this attacker
  **the rules do stop the attack**: rotation removes the address
  it holds, the new one never reaches it, the old queue winds up
  by 5a.9's two phases with everything in it concluded, and the
  attack **terminates**. There is nothing open here.
- **The relationship insider** — the counterpart itself, which
  receives every new address by construction. This one the rules
  do not stop, and it is a **named residual of exactly the class
  the Replication Contract carries for fork spam**, with the same
  three properties, which is why the answer is the same:

> **The insider residual, named and priced.** A counterpart that
> floods its own queue is submitting to the one relationship it
> holds. There is exactly **one** counterpart per queue
> (`rkid`s are per relationship, 5a.2), so the attacker is
> **known to the victim by name** — not a pseudonym to be
> unmasked, but the person on the other side of an encounter. The
> cost falls on **the attacker's own relationship**: it destroys
> the only channel it has, and it gains nothing it did not
> already have, since it may send legitimately whenever it likes.
> The artifacts are attributable **within** that relationship. And
> the answer is **social — ending the relationship — never
> mechanical suppression**: the recipient rotates and does not
> re-establish, the old queue is concluded and released, and the
> attacker addresses nothing. This is not a gap the contract
> failed to close; it is the point at which a delivery contract
> stops being the right instrument.

**The rotation observer, stated precisely rather than
vaguely.** An earlier casting worried about "an attacker
positioned to observe the new card". Made precise, that party is
not a third category: new `rkid`s travel **only** over the
existing end-to-end encrypted channel, so anyone who learns them
**continuously** either *is* the insider or has **compromised the
insider's endpoint**. The first is the residual above; the second
is an **endpoint-compromise residual**, which lies outside this
contract entirely — no carrier rule reaches a compromised device,
and Section 9 says so rather than implying otherwise.

**A second residual of the same family: registration starvation.**
The flood above aims at a queue; this one aims at the door. Because
the challenge budget is carrier-wide and identity-free, an
attacker can hold the whole **unreserved** pool
(`max-open-challenges` charges) continuously — re-taking each the moment it lapses — and keep doing
so indefinitely. An earlier casting called this bounded and
self-healing; it is neither, and the honest classification is the
one this contract already uses for the flood:

- **What it reaches:** *new* onboarding at **that one carrier**,
  **and the return of an address whose binding has already been
  released** — those two, and nothing else. Existing bindings,
  queues, admitted deposits,
  collections, conclusions and give-ups run untouched — **no
  deposit, no collected message and no conclusion passes through
  this budget**, which meters the issuance of challenges and
  nothing else; the short authorization exchange that precedes a
  collection does cost a charge, but it is **that binding's own
  reserved charge**, reached by naming that address (4.4 b2/b3),
  so a held pool cannot reach it — the promise above holds for
  collections exactly as it holds for the return of a known
  address (round-35 B-1) — and every `rkid` the carrier
  holds a binding for, `live` **or** `closing`, holds its **own**
  reserved charge (4.4 step (b3)), reachable
  only by naming that address and **not refusable because the
  unreserved pool is full**. The `closing` half of that is what
  makes the second clause true rather than nearly true: the return
  from a wind-up is a registration, and if it drew on the pool an
  attacker could block every recovery without knowing one address
  (round-23 B-4). So device restore, nonce rotation and
  rebind of any relationship whose address the attacker does not
  know cannot be starved at all. That promise rests entirely on
  the branch in 4.4 step (b); Section 11 tests both ways of
  collapsing it.
  **Past the release it stops, and this contract says so rather
  than letting the reserve's shape suggest otherwise**
  (round-27 B-2): a `released(t)` address holds **no binding**, so
  its re-registration is an unknown-`rkid` request and draws on
  the **unreserved pool** like any newcomer — the starvation
  reaches it. Two things bound what that costs, and neither is a
  bound on the starvation itself: that return **already** costs a
  generation rotation (Identity §9.3), so it is never the fast
  path a person is waiting on; and it is **not time-critical** —
  a tombstone does not expire, so nothing is lost by returning
  later. The residual is therefore *new onboarding **and**
  post-release return*, both at one carrier, both unbounded in
  time, and neither reaching a binding that still exists.
- **Why no rule here closes it:** every remedy that separates this
  attacker from an honest newcomer is a statement about **who is
  asking**, and that is the sender identity 5a.4 abolishes.
  Refusing to say so would be the same overclaim the flooding
  residual avoids.
- **What a carrier can actually do, today, without identity:** the
  `admission-resource` slot is the lever — `work` or `payment`
  makes sustained starvation cost the attacker continuously rather
  than once, which does not forbid the attack but prices it. And
  the deployment answer is the plural one this whole design
  assumes: **a person's relationships are not all at one carrier**,
  and a starved door is a reason to register at another rather
  than a reason to lose a relationship.

It is, in short, the DO-6 family: an attack the rules do not stop,
bounded in blast radius, priced rather than prevented, and
answered structurally rather than mechanically. The re-evaluation
trigger is DO-6's — evidence of it happening in operation, not the
possibility, which is conceded here.

**The road not taken, named rather than omitted — and named at its
true reach.** The
recipient-issued admission token — a secret capability a recipient
hands to counterparts it accepts, presented with each submission,
revoked by rotation — would close the part of this residual that
belongs to parties the recipient never accepted: an unknown sender
and a mere `rkid` leak. It would **not** close the rest, and
saying otherwise would be a false cure (round-33 B-3): an
**accepted insider holds the token by design** — that is what
accepting means, and Signal's own construction derives it from a
profile key shared with accepted contacts, rotated only on
blocking — so the insider flood this section names survives it
untouched; and the identity-free exhaustion of the **unreserved
registration budget** is not a submission question at all, so no
submission token reaches it without a further construction. What
the token buys is real and bounded, and this is its boundary — and it
is the shape the deployed neighbours converged on (Signal's
sealed-sender delivery token is exactly that). It is **deliberately not in this
casting**: it is a new artifact class with its own distribution,
rotation, and revocation surface, and it would make the carrier
interface a place where a *permission* is presented — the seam at
which "resource-shaped, never identity-shaped" starts to erode. If
it is ever adopted it belongs in a casting of its own, and the
property it must preserve is stated in advance: the token MUST be
per (relationship × carrier), like the principal beside it, or it
is a person-wide credential with a friendly name. **The editor's
decision for the 0.x line is: not now, and remembered** — carried
as candidate work in Section 12 (DO-6) rather than left as a
sentence that reads like an oversight.

### 5a.6 Two roles, one process, never one principal (normative)

A party may run both the storage a person recovers from and the
queues a person's relationships are delivered to. The deployed
previous-generation relay does exactly that in one process. The
port line between the two roles MUST therefore also be an
**identity line**:

> A party MUST NOT present, to the same carrier, one identity for
> both the storage-entry role (the recovery context, Identity §5.3)
> and any delivery-collection role (a control principal, Identity
> §7a). The two MUST be distinct identities even where one process,
> one operator, and one endpoint serve both.

The reason is not tidiness. The recovery context is, by
construction, the one identity of a person that is **derivable
with no register at all** — it must be, or recovery could not
start. It is therefore the closest thing a person has to a
person-wide constant. A service that saw a person's delivery
principals and their recovery context on one connection would join
every one of those relationships to that constant: not to a
pseudonym, but to the root of the person's own storage. That is
the strongest join available anywhere in this stack, and it is
available for free to any service that is asked to be both things
at once.

Two consequences, stated so that implementers do not have to
derive them: a device MUST NOT reuse a storage session for
collection or the reverse, and a carrier MUST NOT offer, and a
recipient MUST NOT accept, any "link your storage account"
convenience that establishes such a binding.

**What this MUST proves — and what it does not, which is the part
that must not be overstated.** The rule is written as an
**identity and interface** rule precisely because that is the part
that is *checkable*: the two identities are distinct values, the
sessions are distinct sessions, and no operation of either role
answers about the other. A conformance run can decide all three
from what crosses the interface, and 5a.3's session rule makes the
last one operative. What no rule reachable from here can decide is
**operator conduct behind the interface**: one company running
both roles can join a recovery context and a set of control
principals through source addresses, timing, device telemetry,
billing, or an internal account, and it needs no protocol field to
do it. That is a **named residual, not a MUST** — a MUST that a
conformance run cannot decide is a claim, not a requirement, and
this document would rather carry the residual honestly (Section
10 restates it from the privacy side). What the rule therefore
buys, exactly: it removes the **free** join — the one that needs
no analysis, only an equality check on two identifiers presented
on one connection — and it makes the remaining join a matter of
deployment trust, which a person can at least choose against by
choosing two operators. A recipient that wants the residual closed
rather than named uses a **different party** for storage and for
delivery, and this document RECOMMENDS exactly that.

**Migrated identities are the honest exception.** For an identity
migrated from the previous generation, the historic recovery
context already carries social attachments (Identity §10), and its
own storage is already bound to the person. The separation of this
section therefore works **prospectively** for them — new
principals are separate from the first day — and cannot undo what
the deployed generation already showed its relay.

### 5a.7 Collection discipline (normative, SHOULD)

**This section is about timing, and only about timing.** Serving
two principals inside **one authorization session** is already
forbidden by 5a.3's MUST, and sharing one mediation connection
between them is forbidden by 5a.10; neither is discussed here. The
join this section addresses is the one that survives all of those
rules being kept: a device that opens two perfectly separate,
perfectly authorized sessions **three seconds apart, every time**,
hands the carrier the same grouping through their shape in time.
No derivation can prevent that: it is scheduling, not
cryptography.

> A recipient SHOULD NOT correlate its collection times across
> principals more tightly than its traffic already requires — and
> an implementation that claims this discipline **MUST declare the
> policy by which it does so**: its minimum spacing between
> collection sessions for different principals, the range of the
> randomization it applies to that spacing, and **whether it
> multiplexes two principals' mediation relationships over one
> persistent transport** (5a.10's SHOULD, which lands here because
> a shared transport is a co-timing decision and nothing else).

**The declaration is what makes a SHOULD checkable**, which is the
half an earlier casting was missing: "more tightly than its
traffic already requires" can excuse any burst, so a conformance
run had nothing to test and the rule was decorative. It is
deliberately **not** a fixed number in this contract — a phone on
a metered link and a desktop on mains power have honestly
different answers, and a value invented here would be wrong for
both. What is required is that the answer be **stated and then
kept**: a run can check the declared spacing against observed
behaviour, and a party that declares `PT0S` has said plainly that
it does not take this discipline, which is information rather than
silence.

It stays a SHOULD for a reason this document would
rather write down than pretend away: separate, spaced sessions
cost connections, battery, and latency, and on a mobile device
that cost is real and recurring. A MUST that implementations
cannot afford is a MUST that gets quietly worked around, and a
specification that carries such a rule is less honest, not more.
**And the honest ceiling is named too:** spacing and jitter raise
the cost of the correlation, they do not remove it. Removing it is
mixnet terrain — cover traffic, Poisson delays, constant-rate
pulls, the Loopix line of work — and this contract implements none
of that and claims none of it (5a.4, §10).

*Several devices, one principal (informative).* Under the
shared-seed device model of Identity §3.2 every device of a person
derives the **same** principal for the same (relationship,
carrier). A carrier therefore sees one principal collected from
several sessions, which reveals device multiplicity for that one
relationship and nothing across relationships. This is DO-3's
question in the identity dimension, and it is answered the same
way: the principal is relationship-scoped, not device-scoped, and
whatever a future device model brings must keep it so.

### 5a.8 Conclusion: nothing admitted ends silently (normative)

The Abstract's promise — "eventually, at least once, **never
silently lost**" — has, until this casting, had no counterpart on
the carrier side of the interface. Two holes followed from that,
and the field record found both:

- **Nothing cleared a slot.** A receiver that terminally rejected
  a collected document simply did not acknowledge it, so the
  carrier redelivered it at every connection, forever, and the
  queue only grew. The deployed previous generation shows the
  end state of this: one address stalled at **1148 pending**
  documents, every one of them already decided and none of them
  concludable. This is a *contract* gap, not an implementation
  bug: 6.2 gives a closed, ordered disposition taxonomy from which
  "deterministically final" is derivable, but no duty existed to
  say so to the carrier.
- **Nothing bounded the other end.** A document nobody ever
  collects sat in a queue until a carrier decided, unilaterally
  and silently, to drop it.

Both are closed here, in one rule and its two directions.

**The receiver's duty (MUST).** A recipient that has reached a
**terminal** disposition for a collected document MUST conclude it
toward the carrier, under the principal that collected it, and a
carrier MUST offer that operation and MUST NOT redeliver what has
been concluded. Terminal means every 6.2 outcome that repetition
cannot change: the failure dispositions of stages 1–8, a stage-9
outcome that completed, and `duplicate-known`. A disposition that
is **transient** — the device could not complete the critical
section, storage was unavailable, the lock set was not obtained —
is expressly not terminal, is not concluded, and is redelivered;
that distinction is what keeps this rule from turning a local
fault into a silent loss.

**A conclusion carries no reason.** It says "this digest is
decided", and nothing else — not the disposition, not the stage,
not whether the document was accepted or rejected. The
carrier is key-blind and stays verdict-blind, and 6.1's rule that
the sender never learns what the receiver decided is untouched:
the sender's view of a concluded-but-rejected document is
`accepted` and, absent an acknowledgement, nothing more.

**The carrier's duty (MUST).** A carrier MUST NOT discard an
admitted deposit without first concluding it toward the sender
path. Concretely: a deposit that reaches the carrier's declared
`give-up-horizon` (4.4) without being collected and concluded is
**given up** — the carrier stops offering it and the sender's
status becomes `failed(expired-by-adapter-policy)`, the reason
6.1 has always carried for exactly this — and only then may its
storage be released. There is no other way for an admitted
deposit to leave a queue: it is collected and concluded, or it is
given up. **A carrier that silently drops an admitted deposit is
nonconformant**, and no other constant of 4.4 — the
`orphan-horizon` included (5a.9) — creates an exception.

*Why the sender path can be served at all here, since the carrier
knows no sender:* it does not need to. `failed(...)` is a
statement the sender's **own** adapter makes about a submission it
is tracking, from the carrier's refusal to keep offering it; the
carrier concludes the deposit, not the person. That is the same
asymmetry 6.1 already relies on, written down.

### 5a.9 Loss, re-registration, and orphans (normative)

The carrier nonce of a relationship lives in the holder's
register (Identity §7a.3), and its recovery is the recovery of the
register itself — which this stack does **not** get from the
Replication Contract's group rebind (that machinery rebinds a
stable *group* identity and presupposes held or recovered group
and member identity; it defines no path to a person's own
register). It gets it from the storage side of the S-DID cut, and
Identity §9.3 states it conditionally, which is the honest form
and is adopted here verbatim in substance: the recovery context of
Identity §5.3 is derivable with no register at all, and **with any
state copy it unlocks**, the register returns and every principal
re-derives, with no carrier involved. Ordinary device loss is that
case. The storage contract that makes the state copy exist is a
**named, still unwritten external prerequisite** (Identity §6.3),
satisfied in fact by today's encrypted vault rather than by a
referenceable specification — so this section claims recovery
exactly where §9.3 does, and not one sentence further.

**Two losses, and only one of them leaves a way back.** Which one
happened is decided in Identity §9.3, and this contract follows it
without adding anything:

- **A carrier entry is lost, the pair contexts are held** — a
  corrupted or selectively restored entry, a deliberate rotation
  of `N`, or the convergence of two concurrent nonces in a
  multi-device register (Identity §7a.3). The addresses and their
  **private** keys survive, so the holder can open a sealed
  challenge and re-registers under the new principal: this is the
  **rebind** of 5a.3, the binding moves, and **the queue's
  contents move with nothing, because they were never the old
  principal's**.
- **The whole register is lost with no state copy** — then the
  **pair contexts go with it**, and every `rkid`'s private key
  with them (Identity §9.3). A counterpart's copy of an address is
  the **public** value and re-derives nothing, so the sealed
  challenge of 5a.3 cannot be opened by anybody: **there is no
  rebind in this case, and this contract does not offer one.** An
  earlier casting claimed the opposite — that a surviving `rkid`
  carried the proof — which would have made the recovery branch a
  normative instruction to perform an impossible step. The
  relationship re-addresses by the ordinary Section 5 path
  (a new encounter or a new introduction act, Identity §9.3), and
  the old queues are collected by nobody.

- Old principals that are not rebound become **orphans**:
  bindings nobody will ever present again. A carrier MUST NOT
  offer to hand a person "their" principals back — such an
  operation is precisely the cross-principal answer 5a.1 forbids,
  and offering it would make every carrier a de-anonymization
  service for its own users. A rebind is not that operation and
  must not be confused with it: it answers about **one address
  whose possession was just proved**, and it names no principal to
  anyone.
- Orphaned bindings are aged out, never reclaimed, on the
  published `orphan-horizon` (4.4). Ageing out is a storage
  decision about a **binding**, is reported to no one, and changes
  no verdict about any party.

**The wind-up has two phases, and it needs both (normative).** A
single deadline cannot do this job, and the arithmetic shows why:
the orphan horizon runs from the last collection, a deposit's
give-up horizon runs from **its own admission**, so a deposit
admitted the day before the orphan horizon still owns its full
give-up life — with both constants at 90 days, a registration on
day 0 and a deposit on day 89, the deposit concludes on day 179
while the binding was due on day 90. Comparing the two durations
proves nothing. And forbidding the removal of a non-empty queue,
by itself, hands anyone holding the public `rkid` a way to keep it
non-empty forever: the orphan surface would then grow
monotonically *because* of the rule meant to bound it. So:

the three phases are the `live`, `closing` and `released` states
of 5a.3's outcome table, and what this section adds to those cells
is the one thing the table does not carry: in `closing` the
carrier **closes admission for that queue** — every further
submission to that `rkid` meets `refused(queue-closed)` (5a.5,
non-retriable, because nothing about the submission was wrong) —
while deposits already admitted are **kept**, each running out its
own `give-up-horizon` and concluded exactly as 5a.8 requires.

**The bound now follows from the construction rather than from a
comparison:** admission closes at a definite instant `T`, so the
newest deposit the queue can ever hold was admitted at or before
`T`, so every deposit is concluded by `T + give-up-horizon` at the
latest, so the wind-up terminates — **whatever a flooder does,
because after `T` it cannot add anything.** A carrier that
discards a binding together with undisposed admitted deposits has
violated 5a.8, whatever its horizons say; a carrier that keeps a
closing queue admitting has violated this section.

**A holder who comes back reopens it** — 5a.3's outcome table,
`closing × register/rebind`: possession is the authority here as
everywhere, and a person who recovers a device on day 91 should
not lose a relationship to a bookkeeping state. What was concluded
stays concluded; what is still held is collectable again.

Senders are unaffected in their contract: an envelope to a retired
address fails through the ordinary path (Section 5's tombstone
rule, §6.2 stage 2/3), with the ordinary status.

### 5a.10 Neighbouring carrier forms: adapter obligations (normative)

E9's decision stands — the control principal is mapped onto the
form the neighbouring layer already has, and **no second wire form
is added here**. What changes in this casting is the *status* of
the mapping: "an adapter maps it onto the relationship VID" and
"an adapter maps it onto the connection" were sentences that named
no unique object, and a naive adapter built exactly against the
neighbouring standard's defaults would re-create the very joins
5a.1 exists to prevent. The mapping stays adapter work; the
**obligations** of that work are normative, and they are stated
here because there is nowhere else they could live. An adapter
profile that does not declare them is not a conforming carrier
adapter.

**ToIP/TSP (deterministic mapping).** TSP names several distinct
relationships at once — the endpoint's relationship with its
direct intermediary, each intermediary-to-intermediary hop, the
end-to-end relationship, and private VIDs nested inside it — so
"the private relationship VID" was underdetermined. The rule:

- **One principal ↔ exactly one endpoint-side outer VID of the
  relationship with the *direct* carrier**, and the mapping is
  injective in both directions **at any one time**: an adapter MUST
  NOT serve two principals under one outer VID, and MUST NOT hold
  two **live** outer VIDs for one principal at one carrier. The
  words "at any one time" are load-bearing and were missing: TSP
  identifies the direct relationship by the VID pair with **that**
  intermediary, while `C` — and therefore the principal — is a
  string the holder configured and survives a proxy, a federation
  member, or a key rotation behind it (Identity §7a.2). So the
  direct TSP peer or its VID can change underneath a stable `C`,
  and an earlier casting left that case with three exits and no
  door: reusing the local VID broke exclusivity, minting a second
  one broke a 1:1 read over all time, and deriving a new principal
  contradicted the derivation. The resolution is the third of
  those, read correctly:

  > **When the direct TSP peer or its VID changes under an
  > unchanged `C`, the adapter establishes a fresh outer VID for
  > the *same* principal and retires the old one.** The old VID is
  > retired — never reused, never reassigned, never live beside
  > its successor. The principal does not change, because nothing
  > that enters its derivation changed; the registration does not
  > change either, because the carrier's identity is the
  > configured string and not its hop. It is one live VID per
  > principal, in sequence, and that is exactly what exclusivity
  > requires — exclusivity forbids *sharing* an identifier, not
  > succeeding one.
- **That outer VID MUST be exclusive to this principal — and
  "exclusive" is three prohibitions, not the word "public".** A
  mapping can be perfectly one-to-one *inside* the adapter and
  still hand over the whole join: an adapter could satisfy the
  bullet above with a VID the person already publishes, or with
  the same VID it uses for three other TSP relationships, and a
  carrier that recognizes it has joined those relationships
  without doing any analysis. An earlier casting tried to forbid
  that by forbidding a "public" VID — **which is unsatisfiable and
  was a mistake in our sentence, not in TSP**: in TSP's routed
  model the outer layer *is* the public layer, so the endpoint's
  outer VID toward its direct carrier is public **by
  construction**, and a rule requiring it not to be could never be
  met. Visibility to the direct carrier is inherent and is not the
  danger; **linkability beyond the relationship** is. The three
  MUSTs that actually say that:

  1. **Not well-known.** The VID MUST NOT be published in a
     directory, a well-known location, a profile, a card, or any
     place that resolves it for a party that is not this carrier
     — a VID an outsider can look up is a name, and a name joins.
  2. **Not person-wide.** It MUST NOT be used for a second
     principal, a second carrier, or any purpose of the same
     person beyond this one relationship — including, expressly,
     that it MUST NOT be, or be derivable from, a control
     principal (5a.4's ingress rule states the mirror image for
     the sending side).
  3. **Not reused outside this relationship.** It MUST NOT appear
     in another TSP relationship, application, or account, and it
     is **retired with the principal**, never reassigned.

  What remains permitted, and must remain permitted for the
  mapping to exist at all: the direct carrier **sees** this VID,
  observers of the outer envelope may see it, and TSP's own
  metadata-privacy properties in routed mode apply exactly as that
  specification defines them. One principal, one relationship, one
  carrier, one live VID — the sentence Identity §7a.5(4) makes
  about principals, carried through the mapping so it survives it.
  **Honest limit:** exclusivity is a property of what an adapter
  does with an identifier, and nothing at this contract's port
  line can observe an adapter reusing a VID elsewhere. It is a
  declared obligation of the adapter profile, checkable against
  that profile and against the adapter's own key management, not
  from the wire.
- **The nested private end-to-end VID is expressly NOT the
  principal.** It is hidden from intermediaries by construction,
  which is the opposite of what a control principal is for: the
  principal MUST be visible to the carrier — it is what
  registration, collection, and conclusion are authorized under
  (5a.3). Mapping the principal onto an inner VID is a category
  error and is nonconformant.
- **Per-hop VIDs beyond the first are never the principal.** The
  carrier identifier `C` is the string the holder configured for
  the **direct** carrier (Identity §7a.2, "never the next hop");
  what that carrier arranges beyond itself is below the port line
  and does not enter any derivation.
- **Lifecycle coupling is total — and "intermediary" here means
  the *direct* one, always.** TSP routes through hop lists that
  the carrier may vary at will, so the rule has to say which
  change matters:
  - A change of the **direct** carrier is a change of the
    configured string `C`, therefore a different principal,
    therefore a new registration (Identity §7a.2's move rule) —
    the adapter MUST establish a **new** outer VID and MUST NOT
    re-point the old one.
  - A change **beyond** the direct carrier — hop 2 and onward,
    including a carrier that adds, drops, or reorders its
    downstream intermediaries — changes **nothing here**: same
    configured string, same principal, same outer VID, no
    re-registration. It is the carrier's own arrangement, below
    the port line, and an adapter that re-derived on such a change
    would be deriving from something the holder does not control
    (Identity §7a.2). The two bullets are one rule read at two
    distances, and an earlier casting's bare "a change of
    intermediary" left them looking like two rules in conflict.
  - A rebind (5a.3) is likewise a new principal: the adapter
    establishes a new outer VID and retires the old one; an
    orphaned outer VID is retired, never reassigned.

**TSP ingress, and what "principal-free" was always a statement
about.** A complete TSP carrier adapter must also *deliver into*
a carrier, and there it meets a real collision: an outer TSP
envelope carries and authenticates the **sender-side VID of its
direct neighbour relationship**, and nesting hides the inner VIDs
from intermediaries, not the outer one from the direct carrier. A
reviewer reading 5a.4's "no carrier-visible sender identifier of
any kind" as a claim about **every layer beneath us** is reading
it correctly as written, and as written it made a conforming TSP
ingress impossible. So the rule is restated as what it always
was — **a statement about this contract's port**:

> This contract defines no sender identity, requires none, carries
> none in any field it specifies, and permits no rule of its own
> to depend on one (5a.4). It does **not** claim that a
> neighbouring transport carries no hop identifier; a transport
> that authenticates its own hops is not thereby nonconformant,
> and pretending otherwise would exclude every real protocol from
> the port.

What an adapter owes instead is that the hop identifier stays
**hop-local and relationship-scoped**, and these are MUSTs:

- the sender-side outer VID an adapter presents when depositing
  MUST be **per (relationship × carrier it deposits to)**, freshly
  established for that pair;
- it carries **the same three prohibitions the collecting side
  carries**, and for the same reason — the word "public" is not
  among them, because in TSP's routed model an outer VID is public
  by construction and a rule forbidding that could never be met
  (the collecting side was corrected for exactly this a few
  paragraphs above; the ingress side must not re-introduce it):
  **not well-known** (in no directory, profile, card, or other
  location that resolves it for a party which is not this
  carrier), **not person-wide** (no second relationship, no second
  carrier, and expressly never a **control principal** of the same
  person or a value derivable from one — the sending side and the
  collecting side of one person must never meet in one
  identifier), and **not reused outside this relationship** (no
  other TSP relationship, application, or account);
- being **visible** to the carrier it deposits to, and to
  observers of the outer envelope, is inherent and is not
  forbidden — linkability beyond the relationship is;
- it is retired with the relationship, never reassigned.

**What that buys, exactly, and what it does not.** A carrier then
sees, for one queue, deposits arriving under one stable
sender-side VID — which links those deposits **to each other**
inside a relationship the carrier already carries end to end
(there is exactly one counterpart per `rkid`, 5a.2). **Through
that VID** it learns nothing across relationships and nothing
about the person — and the qualifier is the whole sentence, not a
hedge: the same carrier can still group relationships by source
address, timing, volume, ack pairing or a shared transport,
exactly as §10 records. What the rule buys is that the
**identifier** contributes nothing to those joins; it does not buy
their absence, and this contract claims no unlinkability anywhere
(5a.4, §10). A
**fresh VID per deposit** is explicitly *not* required and *not*
better: it is equally visible, buys nothing the per-relationship
rule does not already buy, and costs an establishment handshake
per message. The residual is stated plainly: a TSP carrier sees a
per-relationship ingress identifier, and this contract's claim is
bounded accordingly — no join **across** a person's relationships,
never a claim that ingress is unobservable (§10).

**DIDComm mediation and pickup (the standard's defaults are the
attack).** Coordinate Mediation 2.0 and Message Pickup 3.0 are
**connection-scoped** protocols: a `keylist` belongs to a
connection, `keylist-query` returns everything registered for that
connection, `status-request` and `delivery-request` may omit
`recipient_did` and then speak for the whole connection, batches
and `messages-received` receipt lists span recipients, and Live
Mode is a state of a connection that a persistent transport
carries. Each of the first four is, in this contract's terms, a
cross-principal answer; the last is two things at once, and is
split accordingly below — the **logical** live state is governed
here, the **transport** underneath it is not. A conforming adapter
therefore MUST:

- maintain a **separate mediation relationship — its own
  connection and its own connection DID — per control principal**,
  and give that connection DID the **same exclusivity the TSP
  outer VID has above**, for the same reason: separating
  connections *internally* is worth nothing if the DID naming one
  of them is a value the person already publishes elsewhere. So
  the connection DID MUST be **created for this principal and for
  nothing else**, under the same three prohibitions the outer VID
  carries above and for the same reason — **not well-known** (in
  no directory, profile, or resolvable public location), **not
  person-wide** (no second principal, no second mediator, never a
  control principal or derivable from one), **not reused outside
  this connection** — and it is **retired with the principal**,
  never reassigned. As there, the mediator's *seeing* the
  connection DID is inherent and is not what is forbidden;
  linkability beyond this one relationship is.
  **`from_prior` is forbidden here** — DIDComm's DID rotation
  hands a mediator a signed statement binding a new DID to a prior
  one, which would re-identify the principal externally no matter
  how principal-local its keylist is. An adapter MUST NOT rotate
  *into* a principal's connection DID from any other DID, MUST NOT
  emit `from_prior` on such a connection, and where a new
  connection DID is needed it establishes a **fresh mediation
  relationship** and registers again (5a.3) rather than linking
  the two.
  This is the load-bearing rule, and everything below follows from
  it: once one connection carries exactly one principal, the
  standard's connection-scoped operations become principal-scoped
  by construction, which is the only way to use them at all;
- keep **keylists principal-local**: the `rkid`s registered on a
  connection are those of that principal's relationship and no
  others, and the adapter MUST NOT construct, cache, or answer any
  keylist view spanning two principals — including for its own
  operational convenience;
- **scope every status, pickup, batch, and receipt operation to
  one principal's connection.** An ungrouped `status-request`,
  an omitted `recipient_did`, a batched `delivery` and its
  `messages-received` acknowledgement are all admissible *only*
  because the connection they run on is one principal wide;
- **keep Live Mode a per-principal property of the mediation
  relationship (MUST), and treat the socket underneath it as what
  5a.3's table says it is (SHOULD).** An earlier casting wrote
  "never share a Live Delivery socket across principals" as a
  MUST, and that put the same object on both sides of the port
  line: the session table declares TCP, TLS and WebSocket
  **below** it, while this bullet made a property of a WebSocket
  nonconformant. **This contract settles which object is which, and
  says so in its own name** (round-33 M-1): Pickup 3.0 binds Live
  Mode to a **connection**, allows it only on a persistent
  transport, and brings it back **off** after a drop — it does not
  define a relationship state separate from that connection, so it
  is evidence for where the re-arming lives, not authority for the
  split. The split is this contract's adapter duty: live state
  belongs to the logical relationship, and its re-arming is
  transport behaviour. Split
  accordingly:
  - **MUST:** Live Mode is enabled per **mediation relationship**,
    and since one relationship carries exactly one principal, no
    live delivery ever spans two principals *logically*. An
    adapter MUST NOT activate live delivery for two principals
    within one mediation relationship, MUST NOT let a
    `status`/`delivery` flow on one relationship report or carry
    another's, and MUST NOT treat the re-arming of a reconnected
    transport as authorization for anything — authorization is
    5a.3's, and it is per session.
  - **SHOULD:** an adapter SHOULD NOT multiplex two principals'
    mediation relationships over **one persistent transport**. The
    reason it is a SHOULD and not a MUST is 5a.7's reason exactly,
    and it would be dishonest to pretend otherwise: a shared
    socket leaks no **identifiers** — the DIDs, keylists, pickups,
    batches and receipts stay separate by the rules above — but it
    does leak their **common transport grouping**, which is a
    correlation and not nothing: a carrier can tell that these two
    mediation relationships arrive together, and that is the
    residual 5a.7 prices and §10 records. The distinction the
    SHOULD rests on is that the grouping is a *timing* fact, not
    an identity one; saying it leaks "nothing about identity"
    overstated even that. And a mobile device that must hold one live
    socket per relationship pays in connections and battery
    exactly where E7 said an unaffordable MUST gets worked around.
    An implementation that multiplexes declares it under 5a.7's
    spacing policy, because that is what it is: a timing decision.
  - The honest note: a carrier that sees two mediation
    relationships arrive and re-arm on one transport can group
    them, and no identity rule prevents that. It is the same
    residual as bundled collection, reached through a socket
    instead of through a schedule;
- map conclusions (5a.8) onto the standard's `messages-received`
  and nothing more — the acknowledgement clears the **queue
  entry** and carries no verdict.

Both mappings remain adapter work, below the port line, and
neither adds a wire form to this contract. The vector debt they
create is named in Section 11: these obligations are decidable
only against an implementation with a carrier interface, and the
first place that exists is the mediator adapter itself.

## 6. Delivery Promises

### 6.1 Sender: the status trias

| State | Meaning |
|---|---|
| `accepted` | the service durably buffered it; delivery is owed |
| `delivered` | a **valid** `delivery-ack` (4.2 consistency) referencing its digest arrived |
| `failed(reason)` | the service gave up; reason from the closed set below |

Sender failure reasons (closed set): `unroutable` · `oversize` ·
`expired-by-adapter-policy` (the adapter's declared give-up bound) ·
`rejected-by-receiver(<receiver reason>)` where an adapter conveys
one. A late valid acknowledgement after `failed` transitions the
status to `delivered`; implementations MUST surface the transition.
No other states exist — in particular, no acceptance state.

**Before the trias there is a report, not a fourth state.** The
three states above describe a submission a service has **taken**.
A submission an adapter still holds — because it is offline, the
transport is unreachable, or the carrier refused retriably (5a.5)
— has no trias state yet, and inventing one would break the
closed set. What it MUST have, within the adapter's declared
`status-horizon` (4.4), is an honest **pre-transport report** from
the closed set `awaiting-transport(offline)` ·
`awaiting-transport(transport-unreachable)` ·
`awaiting-transport(carrier-refused-retriable)`. These are
adapter conditions, never verdicts about a party, never visible to
a receiver, and they end the moment the submission enters the
trias. Silence is not one of them: an adapter that reports nothing
within its declared horizon is nonconformant, and that rule —
not a shortened delivery time — is what the forty-minute
CONNECTING socket of the field record would have caught.

### 6.2 Receiver: dispositions, in mandatory order

The pipeline, as a picture (informative — the numbered stages below
are normative):

```mermaid
flowchart TD
    E[envelope arrives] --> S1{stage 1 size gate}
    S1 -- no --> F1[failed oversize]
    S1 --> S2{stage 2 envelope schema, rkid known}
    S2 -- no --> F2[failed malformed]
    S2 --> S3{stage 3 decryption}
    S3 -- no --> F3[failed decryption-failed]
    S3 --> S4{stage 4 parse, digest, dedup}
    S4 -- fails --> F4[failed malformed]
    S4 -- duplicate --> DK[duplicate-known, stored ack re-sent]
    S4 --> S5{stages 5 to 7 profile, recipient, type, payload}
    S5 -- no --> F5[failed at the failing stage]
    S5 --> S8{stage 8 consistency, pre-lock checks}
    S8 -- no --> F8[failed validation or stale-issuance]
    S8 --> S9[stage 9 critical section under the lock set]
    S9 --> EO[own challenge open: record-creating effect]
    S9 --> ER[recorded: the record decides]
    S9 --> EU[unknown: failed validation-failed]
    EO --> U[effect plus retained ack, one durable transaction]
    ER --> U
```

Every received envelope is evaluated in this order, and the first
failing stage names the disposition:

1. size bound (5) — else `failed(oversize)`;
2. envelope schema, **base64url canonicity** (lengths `mod 4 ≠ 1`,
   zero trailing bits) and `rkid` known — live or tombstoned
   (Section 5) — else `failed(malformed)`;
3. decryption (all-zero check, tag) — else `failed(decryption-failed)`;
4. document parse + digest computation — a plaintext that does not
   parse as JSON or defeats JCS/digest computation is
   `failed(malformed)`; **duplicate check against the
   completed-effect cache** — the cache contains ONLY digests whose
   stage 9 completed successfully; a digest previously rejected at
   any stage is NOT in it and is re-evaluated in full. Duplicate →
   `duplicate-known`: the prior outcome applies idempotently and the
   **stored** acknowledgement of the completed effect **MUST be
   re-sent, byte-identical** (it exists by construction for every
   acknowledging type: the ack document is retained inside the
   effect's transaction, stage 9; a crash between commit and
   transmission would otherwise lose it permanently — for a
   **terminal** document, 4.2, no acknowledgement exists and nothing
   is re-sent). Evaluation ends;
5. document-profile schema + `recipient` = own anchor — else
   `failed(malformed)` / `failed(wrong-recipient)`;
6. `type` known — else `failed(unknown-type)`;
7. payload schema — else `failed(malformed)`;
8. type consistency rules and pre-lock acceptance checks
   (Section 4, incl. the issuance window for bundles) — else
   `failed(validation-failed)` / `failed(stale-issuance)`; **one
   exception:** a bundle whose bound challenge provisionally
   resolves `unknown` (the resolution itself has already latched any
   held aged value — Encounter 5.3) skips the rest of this stage and
   enters stage 9, where the authoritative resolution decides:
   still `unknown` → dispose; any other state → release and
   re-enter at stage 4 (4.1 check 5);
9. **gates and effect, serialized per lock set:** stage 9 is a
   critical section whose **lock set** is the document digest and,
   for bundles, additionally the credential's bound challenge (the
   **record key**). The lock protocol, normatively:
   the full lock set is acquired **atomically, as one acquisition**
   — never one key after the other; an evaluation whose set overlaps
   a held set **holds nothing while waiting**; and when the way is
   free it does not resume — it **re-enters at stage 4**, rechecking
   the completed-effect cache and re-selecting its branch on the
   state actually found. One rule covers both keys; there is no
   ordering to get wrong and no lock held across the re-entry. The
   record-key namespace and lifetime are shared with the optical
   input of Encounter 5.8/5.5 — the same lock, not an equivalent one
   — so record creation, branch selection, and credential uniqueness
   are serialized with every competing trigger. The completed-effect
   cache therefore never holds provisional state: a waiter either
   finds a completed entry (→ `duplicate-known`, mandatory re-ack
   where one is retained — for a terminal document, 4.2, there is
   nothing to re-send) or finds nothing and proceeds as a fresh
   evaluation. Inside the critical section: the authoritative
   resolution and effects of 4.1 — `open` → record-creating behind
   the future check (else `failed(gate-future)`), `recorded` → the
   record decides (foreign counterparty: `failed(consumed-challenge)`;
   else record-aware), `unknown` → `failed(validation-failed)` —
   each effect committed as one durable
   transaction (record where created, accepted material, cache
   entry, **the acknowledgement document itself where the type
   acknowledges, retained together with the cache entry per 4.2**;
   4.1) → `unique`.

**Validate, then consume:** no stage before 9 consumes single-use
material, and stage 9 consumes only after 1–8 passed in full — for a
bundle that includes the issuance window, so **nothing that stage 9
records can subsequently fail** (the poisoning rule, closed).

**`incomplete(missing)`** exists in the taxonomy for types with
declared dependencies. **No type of this casting declares any**; a
future type that does MUST define its closed `missing` vocabulary,
its re-evaluation trigger, and its retention bound in its own
specification.

### 6.3 At-least-once and reconciliation

Adapters MAY deliver any envelope multiple times; receivers converge
via stage 4 (`duplicate-known`). A lost acknowledgement is
indistinguishable from a lost document to the sender; the sender's
remedy is the carrier switch of Encounter 5.8 — the **same
enactment** continues on the optical leg, and the late bundle is
accepted via the record (4.1). A **fresh enactment** arises only when
the optical leg's `boundTo` no longer resolves — the `gate-expired`
outcome of Encounter 5.8; the resulting parallel enactments are
reconciled by **Encounter 0.29 (wire 0.25), 4.2 and 5.8**: both are valid, a late
counter-credential to the first is accepted, and enactment
multiplicity never multiplies edges (one edge per anchor pair). This
contract adds nothing to those rules and relies on them.

## 7. Timing

| Parameter | Default | Meaning |
|---|---|---|
| `ack-wait` | PT30S | RECOMMENDED sender-side wait before **automatically** presenting the optical leg — the carrier switch within the same enactment (Encounter 5.8); presentation is permitted at any moment, and conformance never depends on when the switch happens; **cancelled by an arriving acknowledgement or counter-credential** |
| `key-retention` | max(P90D, longest adapter give-up horizon) | minimum retention of a key-agreement private key after it last appeared in any card (Section 5) |

`ack-wait` is a UX pacing parameter, not a validity rule: an
acknowledgement arriving after it is still valid (6.1 late
transition), and the record-aware effect (4.1) makes any switch
timing safe.
Delivery time itself is unbounded; no rule in this contract references
arrival time for validity.

## 8. State Machines (informative)

**Sender (A, one-scan):**
`scanning → confirmed/sent (waiting animation) → delivered ("nothing
more to do") → [counter-credential accepted] → relation confirmed`
— with `waiting --ack-wait elapsed--> optical presentation (show the
sent card as QR)`, and `failed --late valid ack--> delivered`.

**Receiver (B, one-scan):**
`envelope → staged evaluation (6.2) → recorded + auto-ack → prompt:
"verify A back?" → [human confirms] → counter-step issued → relation
confirmed` — any rejection before the final stage (6.2 stage 9) sends
no ack and consumes nothing; B's prompt is C4, never automated.

## 9. Security Considerations

- **The seal is to a card key.** Whoever holds the recipient's card
  can seal to them — including the bystander of the challenge race
  (Encounter §13). The seal provides confidentiality, never sender
  authenticity.
- **The acknowledgement is now a proof-carrying document.** Forging
  one requires the acknowledging anchor's key; replaying one is
  idempotent (same digest, same thread); redirecting one fails the
  4.2 consistency rules. Suppressing acknowledgements causes fallback,
  not loss, and the late-ack transition plus the Encounter merge rule
  bound the damage of selective suppression to UX, never to state
  divergence.
- **At-least-once is an attack surface made safe by idempotency.**
  Replayed envelopes converge by plaintext digest; re-sealed replays
  converge identically.
- **Oversize and garbage envelopes are rejected before expensive
  work** (6.2 order; size bound before decryption).
- **Adapters are untrusted for content.** A transport can delay, drop,
  duplicate, and observe metadata; it can never read, alter, or forge
  documents without detection.
- **Principal-free submission is a deliberate exposure, bounded by
  resources.** Without a sender identity there is no sender ban and
  no sender quota, so a carrier's only lever against flooding is the
  declared `admission-resource` (4.4). That constant is where this
  contract is most easily defeated **from behind**: an admission
  scheme keyed to an account, an invitation, a device certificate,
  or any person-wide counter would re-identify every principal of a
  person at the moment of admission and undo all of 5a at once.
  Hence the metering scope is fixed by this contract and not
  negotiable by the carrier (4.4, 5a.4) — the registration
  mechanism is the most dangerous surface of this design, and it is
  the one this document constrains most tightly. What the resource
  lever does **not** reach is named beside it in 5a.5: a party
  holding an `rkid` can spend that queue's budget and, because the
  bucket is keyed to the queue, spends the **honest counterpart's**
  allowance with it — a denial of service against one relationship.
  Its **storage** reach is bounded precisely, and not more
  broadly than 4.4 supports: **every other queue's guaranteed
  floor is beyond it**, because `queue-floor` reserves those bytes
  against exactly this (without the floor, one flood reached the
  whole carrier), while the **elastic** capacity above the floors
  is shared carrier-wide and **can** be taken from other
  relationships. Cured by rotation and never by identification. Separating the two senders would *be*
  identification, which is why no parameter of 4.4 closes it and
  why the closure is deferred as DO-6 rather than improvised.
- **A public address plus an unproved registration would be a
  queue hijack, and is not.** An `rkid` is public by construction —
  it is on every envelope and in every card — so a registration
  that merely *asserted* ownership would let any observer bind a
  stranger's address to a principal of its own and collect,
  conclude, and thereby destroy that relationship's deliveries
  (decrypting nothing). 5a.3 closes this with the only instrument
  available once the derivation deliberately shares no computable
  relation with the address: a **proof of possession of both
  halves** — a signature under the principal and the decryption of
  a challenge sealed to the `rkid` — bound into one signature over
  principal, address, carrier string, and both challenges, so that
  no half can be transplanted from another exchange.
- **Possession proofs bound theft, not volume — so the
  registration side is bounded separately.** Proving possession
  stops an attacker from taking *someone else's* queue; it says
  nothing about an attacker minting arbitrarily many pairs of its
  own. That is a Sybil surface, and it is closed the way this
  stack closes Sybil surfaces everywhere: **resource-shaped, with
  a declared bound and a deterministic refusal** — `max-queues`
  and `max-total-bytes` with `registration-refused(capacity)`
  (4.4, 5a.3), the admission resource metered over the
  registration and challenge phase with the **connection** as the
  bucket key, and **challenge charges that end in exactly the two
  ways 4.4 point 3 names** — the passage of `challenge-lifetime`,
  and for a reserved charge the end of its binding — and in **no
  other**: not by completion, not by abandonment, not by a closed
  connection, and not by a restart, which resumes with the
  **full unreserved pool held and each held binding's reserve
  free** (4.4, round-38 B-2) — which is what makes the issuance bound of 4.4 point 4 a
  bound on *work* rather than on concurrency, over **both** charge
  populations, since an attacker holding bound `rkid`s reaches the
  reserves as well as the pool. **Nothing durable is allocated before both proofs
  verify, and the restart rule is built so that this stays true:**
  it needs no per-request record, only a deadline the restarted
  carrier computes for itself, so the bound survives a restart
  without the interface acquiring durable state an attacker could
  aim at.
- **A second residual, and it is not the flood:** because the
  challenge budget is carrier-wide and identity-free, an attacker
  can hold the unreserved charges continuously and **keep new
  onboarding — and the return of an already-released address — at
  that carrier starved indefinitely** — re-taking
  them at every expiry. An earlier casting called this bounded and
  self-healing; it is neither, and 5a.5 now carries it with its
  exact limits. What bounds it is not time but **reach**: existing
  bindings, queues, deposits, collections and conclusions never
  pass through this budget, and each bound `rkid` holds its **own**
  reserved charge (4.4 step (b3)) — reachable only by naming that
  address, and not refusable because the unreserved pool is full —
  so restore, rotation and rebind of a relationship whose address
  the attacker does not know cannot be starved **while its
  binding exists**; past the release the address is a newcomer
  again and the starvation reaches it, which 5a.5 names as the
  second half of this residual. Every remedy
  beyond that would have to distinguish the attacker from an
  honest newcomer, which is sender identity by another name; the
  levers that remain are the priced ones (`work`, `payment`) and
  the plural carrier world.
- **The flooding residual is classified, not merely conceded**
  (5a.5): against a **third party** holding an old address the
  rules terminate the attack — rotation removes the address, the
  new one travels only inside the relationship, the old queue
  winds up and is concluded. What remains is the **relationship
  insider**, and it carries the three properties this stack
  already accepts for fork spam in the Replication Contract: the
  cost falls on the attacker's own relationship, the artifacts are
  attributable within it, and the answer is social — ending the
  relationship — never mechanical suppression. A party who learns
  rotated addresses *continuously* is either that insider or has
  **compromised the insider's endpoint**; endpoint compromise is
  outside this contract, and no carrier rule reaches it.
- **A control principal is a signing identity and nothing else.**
  Compromise of a principal's key lets an attacker collect and
  conclude for one relationship at one carrier; it decrypts
  nothing (sealing is to the `rkid`, Section 5) and reaches no
  other principal, because principals share no derivation path
  (Identity §7a.4). The blast radius is one relationship at one
  carrier — which is what per-(relationship × carrier)
  granularity buys on the compromise side, not only the privacy
  side.

## 10. Privacy Considerations

- **What a carrier sees, exactly.** From an envelope: the `rkid`,
  the size, and the time — and **not** the recipient's anchor,
  which travels inside the sealed document and never in the
  envelope (Section 5). From the registration and collection side:
  the control principals presented to it, the `rkid`s each one
  registers, and when each one collects. Earlier castings named
  the recipient anchor here and credited "derived service
  identities (A7)" with bounding what a transport learns. Both
  were wrong: the anchor is not on the envelope, and Identity §7's
  service identities are scoped **per group** and never applied to
  a delivery relationship. The bound is now real and has a name —
  the carrier-relationship identity of Identity §7a, consumed by
  5a — and this section states what it does and does not buy.
- **What the identity discipline buys.** A carrier cannot join two
  of a person's relationships through the identities it is shown:
  principals are per (relationship × carrier), the `rkid`s are per
  relationship, submission carries no sender identity, and no
  operation answers across principals (5a.1). Two carriers of one
  person see principal sets with no computable relation. That
  closes the **list join** — the one that needs no analysis at
  all, only a query — which was the cheapest and most dangerous of
  the four.
- **What it does not buy, named one by one.** *Timing and volume:*
  the `delivery-ack` is a document in the opposite direction, so a
  carrier holding both directions can pair two `rkid`s by response
  time with no identity whatsoever; no identity rule reaches this.
  *The collection pattern:* a device that serves several principals
  closely together gives back exactly what the derivation
  separated — this is why 5a.7 is a SHOULD with its price named,
  and it is the strongest residual join that remains. *The network
  layer:* without network anonymity a carrier sees addresses; that
  is deployment terrain and is not argued away here. *Colluding
  carriers:* two carriers comparing traffic correlate by time and
  volume — and, **stated exactly rather than left to the weaker
  word**, by something sharper than analysis. An `rkid` is per
  **relationship**, not per (relationship × carrier): a recipient
  may register the same address at two carriers, and those two
  then hold **byte-identical** values and can join their views by
  equality alone, with no timing and no inference. What that join
  reaches is bounded and worth being precise about: it links **the
  two carriers' views of one and the same relationship**, which is
  the relationship each of them already carries — it does **not**
  link two different relationships of one person, which is the
  property 5a.1 and Identity §7a.4 exist to protect and which the
  principals continue to protect (they share no derivation path
  across carriers). A recipient who does not want even that link
  uses **different `rkid`s at different carriers**, which the
  contract has always permitted (5a.2: arbitrarily many `rkid`s,
  one relationship). The derivation defeats the shared list; it
  was never claimed to defeat a shared address the recipient
  itself handed to both. *Migrated identities:* they carry the previous
  generation's exposure forward, and 5a.6 helps them prospectively
  only. *One operator in both roles:* 5a.6's MUST is an identity
  and interface rule and is checkable as one — distinct
  identities, distinct sessions, no cross-role answer — but it
  cannot reach an operator that joins a recovery context with a
  person's control principals **behind** that interface, through
  addresses, timing, telemetry, or billing; the residual is named
  there rather than defined away, and the only full answer to it
  is two operators. *A rebind:* a carrier that sees one `rkid`
  successively bound to two principals (5a.3) learns a link
  **within the one relationship it already carries**, and nothing
  across relationships. **No unlinkability claim follows from this
  section**, and implementations MUST NOT present one — the same
  boundary 5a.4 draws from the submission side, and the two
  statements MUST NOT drift apart.
- **An acknowledgement is a probe response, and this is stated
  precisely:** its presence tells the sender that the recipient's
  device was online **and** that the document passed every stage
  through recording — including, for a bundle, that either the
  displayed challenge was still unconsumed and the gate open
  (record-creating effect) or that the optical leg had already
  created the matching record (record-aware effect); the
  acknowledgement does not distinguish the two. A sender can
  distinguish "online but gate closed" from "recorded" by ack
  presence. This is inherent to the flow the acknowledgement serves.
  Its life differs by effect, and this is stated honestly: the **gate
  probe** ("was the challenge still open?") is bounded by the
  challenge's short life, but on the **record-aware path** an
  acknowledgement — stored or freshly generated after retention — can
  arise for as long as the enactment record lives, revealing arrival
  and the record's existence to its own counterparty, and nothing
  more. Implementations MUST NOT extend the ack with further detail.
- **Sealed content is opaque end to end.**

## 11. Conformance

- **Profile** `rltp-delivery@0.62`; the Identity pin is
  **Identity 0.50** (§7a, the control principal); the Encounter pin is
  `rltp-encounter@0.29` (wire 0.25); companion registrations per
  4.4 (Network Visibility 0.16, Access 0.53, Membership Tasks 0.16, Replication 0.26).
- **Classes:** *sender* (sealing, status trias, ack-wait switch
  trigger; principal-free submission, 5a.4) · *receiver*
  (unsealing, staged dispositions, ack generation; the addressing
  triple of 5a.1, per-relationship `rkid`s 5a.2, the registration
  proofs of 5a.3, the role separation of 5a.6, the collection
  discipline of 5a.7, the conclusion duty of 5a.8) ·
  adapters are below the port line, but **every** adapter declares
  `status-horizon` and reports a trias state or a pre-transport
  condition within it (4.4, 6.1). A **carrier** is an adapter
  and conforms through 4.4's carrier role: it declares all twelve
  required constants **with the parameters of its declared
  admission kind**, binds no address without both possession
  proofs (5a.3), admits on the closed deterministic outcome set
  and meters admission per principal or per submission and never
  per person (5a.5), answers no query across
  principals, concludes or gives up every admitted deposit rather
  than dropping it (5a.8), and ages orphaned bindings on its
  published horizon (5a.1, 5a.9). An adapter for a neighbouring
  carrier form conforms additionally through 5a.10.
- **Normative schemas (shipped, complete closure for offline
  registration):** `schemas/rltp-delivery-document.schema.json` ·
  `schemas/sealed-envelope.schema.json` ·
  `schemas/payload-encounter-bundle.schema.json` ·
  `schemas/payload-delivery-ack.schema.json` ·
  `schemas/payload-encounter-credential-delivery.schema.json` ·
  `schemas/payload-registry-declaration.schema.json` ·
  **`schemas/carrier-proof.schema.json`** (`rltp-carrier-proof/0.3`,
  the proof form of 5a.3 in all four of its purposes — the one artifact of this
  contract that travels below the port line and is nevertheless
  signed, so its bytes are fixed and its shape is shipped) —
  plus, by reference through 4.4, the companion-registered payload
  schemas named there.
- **Schema validity is not acceptance (5a.3).** A carrier
  conforms only if it **decodes** the base58btc identifiers of a
  proof before any other check and refuses `malformed` unless
  `principal` is `0xed 0x01` followed by exactly 32 bytes, `rkid`
  is `0xec 0x01` followed by exactly 32 bytes, and `sig` is
  exactly **64** bytes. The shipped schema **cannot** express
  these, and says so in its own description rather than leaving
  it to be discovered: base58btc is not positional, so a decoded
  prefix or a decoded length is a numeric interval and no pattern
  in this dialect states one.
  `vectors/carrier-proof.json` ships six schema-valid,
  normatively invalid aliases — two per field, including the
  86-character string that decodes to 63 bytes and the
  88-character one that decodes to 65 — and an implementation
  that stops at schema validation **fails this section**.

  *On the version string in that file:* `rltp-carrier-proof/0.3`
  names an artifact of this contract's own, versioned
  independently of the `rltp-delivery@` profile, so it is not a
  profile string and the coherence scan treats it as what it is —
  no exception entry is needed, unlike
  `access-registration/0.26`, which shares its family name with a
  profile.
- **Shipped vectors:** `vectors/seal.json` (5) ·
  **`vectors/carrier-proof.json`** (5a.3, 4.4) — the registration
  proof object, its JCS bytes and signature; the `collect` form
  with its absent fields; six transplant negatives (second `rkid`,
  second carrier, second principal, changed `purpose`, foreign
  domain tag, replaced challenge), each of which changes the
  signed bytes so the shipped signature fails; **six encoding
  aliases** that pass the schema and fail the decoded check
  (5a.3), each shipped with its decoded length and prefix, plus
  the positive control that the shipped proof itself decodes — so
  the negative cannot pass by refusing everything; and **four `rate`
  micro-token sequences on a deliberately non-divisible
  configuration** (`PT1S`, max 3): the round-4 counter-example
  polled at 334 ms and 667 ms, the same elapsed time asked for
  only at 667 ms — the two MUST admit the same number of deposits,
  which is the executable form of "capacity is a function of
  elapsed time alone" — a **restart** sequence showing that
  only `micro` persists and no elapsed credit crosses it, and a
  **refusal sequence** in which a refusal is preceded by positive
  elapsed time and is followed by a restart: the one history on
  which the adopted rule ("commit the refill, subtract no price")
  and the rejected one ("roll the refill back") resume with
  **different** budgets, replayed both ways so the divergence is
  shown and not asserted; and the
  **challenge-charge machine** (4.4) in two sequences: completing
  `max-open-challenges` exchanges in a row and still meeting a
  refusal (the charge is not refunded by success), and a restart
  after which the unreserved pool counts as held while a held
  binding's reserve resumes free (restarting buys no issuance at
  the contended pool, and denies no existing binding its
  collection); the **reserve and starvation** sequence (4.4, 5a.5),
  which shows both halves — unknown-`rkid` requests starved
  repeatedly across a lapse, and an already-bound `rkid` still
  getting through the reserve; the **challenge-consumption**
  sequence (4.4), in which a failed verification does not restore
  the challenge and every later response is discarded unverified;
  and the **duplicate** cases (5a.5),
  byte-identical replay against re-sealed repetition; the
  **generation-monotonicity** cases (5a.3), whose counter-vector
  is a device restored from an older backup presenting valid
  proofs and still not moving the binding; and the **queue-floor
  accounting** (4.4), including the case that decides the floor —
  a queue one byte below its floor, where `committed` does not
  move — and a closing queue's bytes counted without a floor; the
  **equal-generation tie** run end to end (converge, refuse,
  rotate with a **fresh nonce whose principal is derived in the
  vector**, bind — a rotation that reused a principal would be an
  impossible state sequence), together with the **tie at the
  generation maximum**, where no rotation exists and the binding
  stands and stays collectable and the **released-then-re-registered** case,
  where the tombstone refuses a superseded generation after the
  binding itself is gone.
- **Vector plan:** seal/unseal roundtrip against the shipped vector ·
  digest invariance under re-sealing · every disposition stage of 6.2
  as a distinct vector, in-order (including oversize before
  decryption, tag-only ciphertext as `malformed`, unknown `rkid`,
  all-zero secret rejection) · validate-then-consume (a bundle
  failing stage 8 consumes nothing) · duplicate and concurrent
  delivery converge with identical re-ack · **ack forgery matrix:**
  unsigned ack rejected, foreign-signed rejected, wrong-thread
  rejected, wrong-direction rejected, valid ack accepted, late valid
  ack transitions `failed → delivered` · ack generation at each
  type's defined effect, none on rejection, no dependency on the
  confirmation step · outer/inner consistency vectors per type
  (Mallory-wrapped credential produces no ack to Mallory) ·
  `ceremony` member absent (accepted), present-and-matching
  (accepted), present-and-wrong (rejected) · threadId rules per type
  · status trias transitions including every failure reason ·
  **record-aware effect:** bundle after optical completion → accepted
  via record + ack · binding mismatch against record → rejected,
  nothing consumed · enclosed card not JCS-identical to
  the record's stored counterparty card → `failed(validation-failed)`
  · conflicting or re-proofed credential on an existing record →
  `failed(validation-failed)`, no ack · every Encounter 5.6 rejection
  exercised on the record-aware path · optical record creation racing
  a bundle between stage 8 and stage 9 → branch re-selected inside
  the critical section, accepted via record, never
  `failed(consumed-challenge)` · two bundles with distinct digests
  competing for one challenge → exactly one record-creating effect;
  the other accepted idempotently (equal credential digest), or —
  **from the record's same counterparty** — a conflicting credential
  `failed(validation-failed)`, or — foreign counterparty —
  `failed(consumed-challenge)`; never a second record · crash after a
  record-aware commit and before ack transmission → redelivery yields
  the mandatory byte-identical re-ack · **state-model additions:**
  resolution selects every branch: `open` → record-creating,
  `recorded` → record decides, `unknown` → `failed(validation-failed)`
  · card `boundTo` ≠ credential's bound challenge →
  `failed(validation-failed)` at outer/inner consistency ·
  wrong-counterparty disposition stable under waiter re-entry
  (re-resolution yields `recorded` again → `failed(consumed-challenge)`
  both times) · aged-out challenge, no record → resolution `unknown`
  → `failed(validation-failed)`, no gate disposition · envelope
  sealed to a retired (tombstoned) `rkid` → passes stage 2, fails
  stage 3 `failed(decryption-failed)`; `rkid` never issued →
  `failed(malformed)` at stage 2 · **polish-round additions:**
  future-dated own challenge beyond skew at the record-creating gate
  → `failed(gate-future)` · record held by a different counterparty →
  `failed(consumed-challenge)`, nothing consumed anew · redelivered
  `delivery-ack` → `duplicate-known`, no ack-of-ack, sender status
  unchanged · post-retention redelivery with surviving record →
  record-aware idempotent acceptance, freshly generated ack;
  without surviving record → `failed(validation-failed)` at the
  pre-record checks (check 5), no gate reached · lock-set
  atomicity: interleaved bundle/optical triggers on one record key
  under load → no deadlock, one effect per document: every delivery
  waiter re-enters at stage 4, every optical waiter reacquires its
  singleton lock and reruns the record resolution of Encounter 5.5 ·
  invalid JSON inside a valid seal → `failed(malformed)` at stage 4 ·
  **polish-round additions:** framework-expanded `ceremony`
  (`round`/`terminal`/`prev` present → accepted) · credential with
  foreign ceremony label in a bundle → `failed(validation-failed)` ·
  concurrent first deliveries → exactly one `unique`, one
  `duplicate-known`, identical acks · crash between effect commit and
  ack transmission → redelivery yields the mandatory re-ack ·
  key retirement never precedes the declared adapter horizon ·
  **eighteenth-casting additions (the registry):** a
  companion-registered type with a registry entry → dispatched to
  its own specification's consistency rules; the same type absent
  from the registry → `failed(unknown-type)` per 6.2, no effect · a
  registry entry publishing an adaptive constant → nonconformant
  (constants are fixed) · `registry-declaration/0.1`: valid
  declaration recorded; unsigned or foreign-signed → discarded;
  replacement prospective-only · introduction-ack timing computed
  from the declared `ack-delay` (Visibility §8.4's verdict
  window); an introduction-request sent without holding the
  mediator's declaration → nonconformant at the sender ·
  a `member-mapping/0.1` document from a party the receiver holds
  no relationship with → rejected by the receiver's own
  acceptance list (Access §5.5 step 2 — the transport verdict is
  ordinary; the channel rule is the artifact's, stated honestly) ·
  **twenty-third-casting additions (the carrier cut, §5a):**
  the derivation seam itself is executable in
  `vectors/identity-derivation.json` (`carrierRelationship`) and
  MUST be reproduced by any implementation claiming this profile:
  one relationship at two carriers → two principals with no
  computable relation; a case-variant carrier string → a third
  principal (byte-exactness, Identity §7a.2); no key-agreement key
  derived for the class · one `rkid` registered under two
  principals → nonconformant (5a.2) · a cross-principal query
  (`list the keys of this principal's person`) offered by a carrier
  → nonconformant; the same query issued by a recipient →
  nonconformant (5a.1) · a submission carrying any sender
  identifier at the carrier interface → nonconformant (5a.4) ·
  an `admission-resource` metered by an account, invitation,
  device certificate, or any counter spanning two principals →
  nonconformant, `none` accepted as a declared value (4.4) · a
  carrier declaring fewer than the twelve required constants →
  nonconformant; a principal registering before it holds all twelve
  → nonconformant (4.4, 5a.9) · **declaration parameters:** a
  declaration of `rate` without `admission-rate-window` **and**
  `admission-rate-max`, of `work` or `payment` without
  `admission-scheme`, or carrying a parameter belonging to another
  kind → invalid; a `rate` bucket keyed to anything but the queue
  → nonconformant (4.4) · `orphan-horizon` outside
  `[P7D, P365D]`, `give-up-horizon` outside `[P1D, P90D]`,
  `status-horizon` outside `[PT5S, PT5M]`,
  `admission-rate-window` outside `[PT1S, P1D]`,
  `challenge-lifetime` outside `[PT5S, PT5M]`,
  a declared `challenge-reserve` (withdrawn — the reservation is
  per address, 4.4), any integer constant outside `[bound, 2^53−1]`
  or in a non-canonical decimal spelling, or a required product or
  sum evaluated with rounding rather than exactly,
  a declared `binding-tombstone-retention` (withdrawn — the
  tombstone does not expire in time, 5a.3),
  `max-binding-tombstones` outside `[max-queues, 2^53−1]`,
  `queue-floor` outside `[65536, max-queue-bytes]`, a declaration
  with `max-total-bytes < max-queues × queue-floor`,
  `max-open-challenges` absent or not finite,
  `max-submission-bytes` outside `[65536, 16777216]`,
  `max-queue-bytes` outside `[1048576, 1073741824]`, or a
  declaration with `orphan-horizon < give-up-horizon` → the
  declaration rejects, as for every out-of-domain constant (4.4) ·
  **status horizon:** a submission held with no report beyond the
  declared horizon → nonconformant; an offline or unreachable
  adapter reporting `awaiting-transport(...)` within it →
  conformant, and the report MUST NOT be surfaced as a trias state
  (4.4, 6.1) ·
  **registration:** a binding created without both possession
  proofs → nonconformant · a signature input that is not the JCS
  serialization of the 5a.3 object with `sig` omitted, an object
  whose `v` is not byte-equal to `rltp-carrier-proof/0.3`, a
  challenge that is not exactly 32 bytes in canonical unpadded
  base64url, or a `sig` that is not canonical 64-byte base58btc →
  nonconformant (**shipped transplant negatives**: the same
  signature against a second `rkid`, a second carrier, a second
  principal, a changed `purpose`, a foreign domain tag, a replaced
  challenge — each fails because the signed bytes differ) · a
  `collect` or `conclude` proof carrying **`generation`**
  or `addressChallenge`, a proof of **any** purpose omitting
  `rkid`, or a `register`/`rebind` proof omitting `generation` or
  `addressChallenge`, → nonconformant (5a.3 and
  `carrier-proof.schema.json` agree: every purpose names the queue
  it acts on — a collection that named none would leave two
  conformant carriers free to answer the same bytes differently,
  round-36 B-1 — while the two succession fields stay forbidden in
  the session-scoped purposes, which change no succession) · a challenge accepted twice, or without expiry →
  nonconformant · **rate metering:** an implementation whose
  admission sequence diverges from any shipped micro-token
  sequence → nonconformant; a refusal that **subtracts a price**,
  or that **rolls back the refill** computed before it, →
  nonconformant — 4.4 prescribes one sequence, *commit the refill,
  then decide, subtract only on `admitted`*, so an implementation
  whose refusal leaves `micro` where it stood before the refill is
  the **rejected** reading and fails here (this clause previously
  said "a refusal that changes bucket state", which condemned the
  prescribed behaviour: round-19 B-2, and the third time §11 has
  been the consumer left behind); a
  backwards clock step that grants tokens, a forward jump that
  exceeds the cap, or any window-boundary burst → nonconformant;
  **two sequences with equal elapsed time but different polling
  instants that admit different counts → nonconformant** (this is
  the arithmetic the whole-token casting failed); a restart that
  refills, resets to full, or carries elapsed credit across itself
  → nonconformant, and an unrecoverable counter MUST start the
  queue empty (4.4) · **registration capacity:** a registration
  beyond `max-queues` or `max-total-bytes` →
  `registration-refused(capacity)`, deterministic and retriable,
  never silent and never a judgement about the presenter; an
  unbounded challenge store → nonconformant; **challenge state or
  challenge *work* that grows with the number of connections** →
  nonconformant, since `max-open-challenges`,
  `max-queues` and `challenge-lifetime` are carrier-wide; **a
  claimed issuance bound of `max-open-challenges` per
  `challenge-lifetime` alone** → nonconformant, the reserved
  charges being one per **held** binding, `live` or `closing`, and
  therefore bounded by
  `max-queues`: the conformant bound is
  `(max-open-challenges + max-queues) / challenge-lifetime`, and
  an attacker holding bound `rkid`s reaches the whole of it
  (round-19 B-1); **a reserved charge outliving the binding it
  belongs to** → nonconformant, the release ending it (4.4 point
  3, end (2); 5a.3 `closing × release`), since otherwise
  *one reserved charge per held binding* — the statement this
  clause and 4.4 both make — is false at every instant between a
  release and that charge's expiry; **a `rate` carrier metering the
  registration and challenge phase with anything but the
  connection-keyed micro-token bucket of 4.4 — created full,
  one price per request evaluated at (b1), refill committed,
  refusal free, discarded with the connection** → nonconformant;
  **a challenge issued by
  evicting a live charge** → nonconformant; **a charge released by
  completing, abandoning, or dropping the connection of an
  exchange** → nonconformant; **a charge taken later than the
  budget check** — that is, after any randomness, sealing, or
  asymmetric operation — → nonconformant, and a request refused at
  the budget check takes no charge and causes no work; **a restart
  that resumes with fewer than all unreserved charges held** →
  nonconformant, the deadline being `restart instant +
  challenge-lifetime`; **a restart that resumes with the reserve
  of a held binding held** → also nonconformant, because that
  refuses the collections and conclusions of every existing
  binding for up to a full lifetime (4.4 states which population
  is conserved which way, and why the two differ; an
  implementation MAY persist real deadlines and resume from them,
  but only if that releases no more than it held, and MAY be
  stricter about its own reserves). Both are shipped counter-vectors: completing
  `max-open-challenges` exchanges in sequence must leave the next
  request refused, and the first request after a restart must be
  refused; **a request naming an
  already-bound `rkid` refused while **that `rkid` holds no charge**
  → nonconformant, its reserved charge being its own and drawn
  from no pool — **specifically, refusing it because the
  unreserved pool is full is nonconformant** (4.4 step (b3)), and
  so is the other direction, **serving a request for an `rkid`
  without any binding, `live` or `closing`, out of a reserved
  charge** (step (b4));
  both are shipped counter-vectors, and a request refused on its
  own pot MUST NOT then take a charge from the other; **two
  different bound `rkid`s competing for one
  reserve** → nonconformant, reserves do not compete; **a second
  open charge for one `rkid`** →
  nonconformant, parallel requests for one address yielding
  `registration-refused(capacity)` and taking no charge (4.4) —
  and the shipped sequence carries the residual honestly: after a
  lapse the attacker re-takes the unreserved charges, so a
  conformance run MUST NOT read the reserve as a bound on
  starvation; **any randomness, sealing, key
  derivation or other asymmetric operation performed for a request
  that has not been charged and holds no charge** →
  nonconformant, as is verifying a response against no live charge;
  the capacity constants REQUIRED even where `admission-resource`
  is `none` (4.4, 5a.3) · **`generation`:** a rebind accepted at a
  generation **not strictly greater** than the recorded one →
  nonconformant; equal generation with the same principal →
  `registered(idempotent)`; equal generation with a different
  principal, or any lower generation, →
  `refused(stale-generation)` and the binding does not move — the
  shipped counter-vector is a device restored from an older backup
  presenting **valid** proofs; **the equal-generation tie is a
  wait state, not an end state** — the composite vector runs it
  through: register convergence, refusal at the carrier, rotation
  to `generation + 1`, binding; a carrier that *decides* the tie
  → nonconformant, and a proof carrying any value from which the
  register's nonce ordering could be reconstructed →
  nonconformant, because **this contract defines no such field
  and no construction for one** (5a.3; whether a safe
  carrier-scoped ordering proof exists at all is DO-7, and the
  categorical impossibility argument an earlier casting gave here
  is withdrawn) · **the tombstone:** a
  registration for a released `rkid` accepted at a generation not
  strictly greater than the highest ever accepted for it →
  nonconformant; a tombstone dropped with the binding, or expiring
  **in time**, → nonconformant (the Access §7.3 shape); a
  tombstone leaves in **exactly two** ways — **consumed** by a
  registration carrying a strictly greater generation
  (`released × register/rebind`, and keeping it beside the new
  binding is nonconformant) or **evicted** by the capacity rule,
  which at
  `max-binding-tombstones` evicts by the **total order of
  5a.3** — the smallest `releaseOrdinal`, and by nothing else; an
  implementation that stops at "oldest by release time" is
  nonconformant, because that order is partial and two carriers
  breaking a tie differently keep different addresses. **An
  implementation that derives the eviction order from a clock —
  a wall clock, or a monotonic instant that a restart makes
  meaningless — is nonconformant**, whatever it does with ties:
  the ordinal is assigned at release, stored with the tombstone,
  recovered after a restart as `max(stored) + 1` — **and as `1`
  for an empty store**, the base case being part of the rule — and
  a sweep
  releasing several bindings at once assigns consecutive ordinals
  in ascending bytewise `rkid` order (5a.3). A store holding two
  equal ordinals is malformed; a carrier that renumbers MUST
  preserve the existing order exactly. **A release runs evict,
  then renumber, then assign** (5a.3 r1–r3): a carrier at
  `max-binding-tombstones` that assigns before evicting, one that
  evicts **one** entry for a sweep releasing `k` and thereby ends
  above its own capacity, or one
  whose largest ordinal is `2^53 − 1` and **does not** renumber —
  the renumbering is a MUST there, not a courtesy — is
  nonconformant, and so is one that renumbers a **full** store
  before evicting, which at capacity `2^53 − 1` leaves no value
  to assign.
  These are shipped counter-vectors: the ordinals are **derived**
  from the release sweeps rather than read from the vector, and
  the store is replayed across a restart and a backwards clock
  step, both of which MUST leave the victim unchanged
  (round-19 B-3). For an
  evicted `rkid` the
  anti-resurrection guarantee ends — a named consequence,
  reachable only by a party holding **both** halves, never a third
  party (4.4, 5a.3, 5a.9) · **the outcome table of 5a.3 is the
  conformance condition**: every cell is checked, a
  `(state, input)` answered with an outcome other than the one it
  names → nonconformant, and so is any outcome outside 5a.3's
  closed set — **the whole of it**: the ten verdicts and the five
  internal transitions, one list, from which every cell draws —
  in particular a `released` tombstone kept **beside**
  the binding that a strictly greater generation installed, a
  `g′ > g` proof under the **same** principal answered with
  anything but `rebound` and a recorded generation advanced to
  `g′`, a proof refused because its `purpose` disagreed with
  the state, **any check-and-commit against carrier state that is
  not linearized** → nonconformant (4.4's atomicity rule): two
  concurrent first registrations at `max-queues` yielding **two**
  bindings, two concurrent deposits at `max-total-bytes` both
  admitted, two overlapping release sweeps against one tombstone
  store — each is a shipped counter-order, and each breaks a bound
  this contract declares rather than a residual it names; a
  **`generation` accepted in a non-canonical decimal
  spelling** (the check is on the received bytes, 5a.3, and the
  schema cannot express it: `1.0` and `1e0` are valid JSON,
  pass the schema, canonicalize to `1` under JCS and the shipped
  signature **verifies** over them, so only the lexical check
  catches them; `01` and `+1` are not valid JSON at all and die
  in the parser — both classes ship, because a carrier that
  reaches the lexical check only for parseable input is exactly
  as wrong as one that omits it), a **reserved charge taken
  for a binding the release has already ended**, or **an
  asymmetric operation begun for a request whose charge ended
  between the budget check and the entry into step (c)** — the
  window 4.4's b0 bracket closes by ending at that entry
  (round-30 B-1); both are shipped as executed readings, or a **rebind
  refused at `max-queues`**, which is a
  bound the transition does not move (the capacity pre-check runs
  only for the two cells that create an additional binding) ·
  two concurrent valid registrations for one `rkid` →
  exactly one binding (the compare-and-swap vector) · **admission:** an
  outcome outside 5a.5's closed set, or one varying by any
  property of the submitter, → nonconformant; retriability
  reported per 5a.5 · **`duplicate`:** two submissions to one
  queue whose sealed envelopes are byte-identical → `duplicate`,
  **one** stored copy, and the admission resource charged for
  both; the **same document re-sealed** (fresh `epk`, `nonce`,
  `ciphertext`) → `admitted` twice, since a key-blind carrier
  cannot and must not see through the seal (§6.2 absorbs that
  repetition at the receiver); identical bytes to a **different**
  `rkid` → `admitted`, a different queue; a byte-identical
  re-presentation **after** the first deposit concluded or was
  given up → `admitted`; a duplicate that skips the resource
  charge, or that moves the queue's occupancy against
  `max-queue-bytes`, → nonconformant, as is a duplicate check
  placed before the charge or after storage admission (5a.5) · **conclusion:** a terminal 6.2
  disposition not concluded toward the carrier → nonconformant; a
  transient one concluded → nonconformant; a concluded digest
  redelivered by a carrier → nonconformant; a conclusion carrying
  any reason, stage, or verdict → nonconformant (5a.8) · an
  admitted deposit discarded without give-up or conclusion →
  nonconformant; give-up at the declared horizon →
  `failed(expired-by-adapter-policy)` and only then storage
  release (5a.8, 6.1) · one identity presented for both
  storage entry and delivery collection at one party → nonconformant
  under 5a.6, **including where one process serves both roles** ·
  a carrier operation offering to enumerate or restore a person's
  principals after register loss → nonconformant (5a.9); a rebind
  under proof of possession of one named `rkid` → conformant, and
  the two MUST NOT be conflated · **the two loss cases:** a
  rebind attempted after total register loss (no state copy, pair
  contexts gone) → the sealed challenge is unopenable and the
  attempt fails at `refused(possession-failed)`; a rebind after
  loss of a carrier entry alone, or after a nonce convergence
  (Identity §7a.3), with the pair context held → **succeeds in
  two steps, and a carrier that makes it succeed in fewer is not
  the conformant one** (round-39 B-1): the holder's fresh `N`
  yields a principal the carrier does not know at a generation it
  cannot guess, so the first attempt is `refused(stale-generation)`
  **carrying the held generation**, and the rebind at
  `generation + 1` is `rebound`. A carrier that omits the
  generation from that verdict → nonconformant, because it turns a
  recoverable loss into an unrecoverable one (5a.3, 5a.9, Identity
  §9.3; shipped as an executed vector) · orphan
  expiry produces no document, no disposition, and no status
  change beyond §6.1's ordinary path, and never discards an
  undisposed admitted deposit (5a.9) · **two-phase wind-up:** a
  queue still admitting after its `orphan-horizon` → nonconformant;
  a submission to a closing queue → `refused(queue-closed)`,
  non-retriable, mapped to `failed(unroutable)` and carrying no
  hint that a wind-up is in progress; a binding released while a
  held deposit is undisposed → nonconformant; a queue kept alive
  indefinitely by continued deposits → impossible by construction
  and tested as such (admission closed at `T` ⇒ release by
  `T + give-up-horizon`); a valid registration or rebind during
  closing → the binding returns to live and admission reopens
  (5a.9) · **queue floor:** a submission to a queue **below its
  `queue-floor`** refused for global occupancy → nonconformant,
  the floor being logically reserved against every other queue; a
  registration that would leave
  `max-total-bytes < max-queues × queue-floor` →
  `registration-refused(capacity)`; between floor and
  `max-queue-bytes` a `refused(capacity)` for global occupancy →
  conformant, and named as the elastic range it is; **admission
  decided on the occupancy *before* the deposit** → nonconformant,
  the rule being `committed` computed **after** admission; a
  submission whose post-admission occupancy stays within
  `queue-floor` refused for global occupancy → nonconformant
  (it does not move `committed` at all); a **closing** queue's
  bytes omitted from `committed`, or a closing queue **given a
  floor**, → nonconformant; and a closing queue **not** counted
  against `max-queues` → nonconformant too, since it still holds
  its binding and its reserved charge (4.4, 5a.9) ·
  **live delivery:** live mode activated for two principals
  inside one mediation relationship, a status or delivery flow
  reporting across relationships, or a reconnected transport's
  re-armed live mode treated as authorization → nonconformant; two
  mediation relationships **multiplexed over one persistent
  transport** → conformant but SHOULD-violating, declared under
  5a.7's spacing policy because it is a timing decision (5a.10) ·
  **the three sessions:** a
  collection or conclusion for a second principal inside one
  **authorization session** → **nonconformant** (5a.3), and an
  earlier casting's "conformant but SHOULD-violating" for this
  case is withdrawn as the contradiction it was; two principals on
  one **mediation connection** → nonconformant (5a.10); several
  messages on one **transport socket** → not this contract's
  business · two authorization sessions for different principals
  scheduled inside the declared spacing → conformant but
  SHOULD-violating, and reported as such rather than passed
  silently; an implementation claiming the discipline without
  declaring spacing and jitter → nonconformant (5a.7) · **an
  adapter** serving two principals under one TSP outer VID, or one
  DIDComm mediation connection, keylist, pickup scope, batch, or
  receipt list → nonconformant (5a.10) — **the persistent
  transport is not in this list, deliberately**: two mediation
  relationships sharing one socket is the SHOULD above, not a
  violation, and an earlier casting carried both verdicts for the
  same case ·
  a principal mapped onto a nested private end-to-end VID, or onto
  a per-hop VID beyond the direct carrier → nonconformant (5a.10) ·
  an outer VID that is **well-known** (resolvable in a directory,
  profile, or other public location), **person-wide** (a second
  principal, a second carrier, or any control principal of the
  same person or a value derivable from one), or **reused** in
  another TSP relationship, application, or account →
  nonconformant — while an outer VID merely being **visible** to
  the direct carrier or to an observer of the outer envelope is
  **conformant**, because in TSP's routed model it cannot be
  otherwise;
  and a retired one reassigned → nonconformant; **two live** outer
  VIDs for one principal → nonconformant, while a fresh one
  succeeding a retired one under an unchanged `C` (a changed
  direct TSP peer) → conformant, with the principal and the
  registration unchanged (5a.10) · a DIDComm **connection DID**
  that is well-known, person-wide, or used in any other
  connection, application, or account → nonconformant; `from_prior`
  emitted on a principal's connection, or a rotation into one from
  any other DID → nonconformant (5a.10) · **TSP ingress, in the same three
  prohibitions as the collecting side:** a sender-side outer VID
  that is **well-known**, **person-wide** (a second relationship,
  a second carrier, or any control principal of the same person or
  a value derivable from one), or **reused** in another TSP
  relationship, application, or account → nonconformant — while a
  sender-side outer VID being **visible** to the carrier it
  deposits to is **conformant**, because in TSP's routed model it
  cannot be otherwise; a per-(relationship × carrier) VID →
  conformant, and a carrier authenticating its own hop is
  **not** a violation of 5a.4, which speaks about this contract's
  port (5a.4, 5a.10) · a change
  of the **direct** carrier → new principal, new outer VID; a
  change of hops beyond it → **no** change of principal, VID, or
  registration (5a.10) ·
  `https://real-life.org/trust-tasks/delivery-carrier/0.1` used as
  a document `type` → `failed(unknown-type)` (4.4).

## 12. Open Issues

- **DO-2b HPKE.** Whether to align the seal with RFC 9180 in a future
  version; the 0.2 construction transcribes the deployed one.
- **DO-3 Multi-device delivery.** What `delivered` means when an
  anchor has several devices; adapter-defined until the Layer-1
  device model (IO-4) lands; the ack meaning is deliberately
  device-scoped.
- **DO-4 Third-party task types.** The first type retained by third
  parties beyond the ack's sender needs its proof rules stated per
  TT §4.7.1; the ack itself is retained only by its sender.
- **DO-5 Ordering.** No global ordering is promised; thread
  causality plus the merge rule cover every current flow.
- **DO-7 A carrier-scoped ordering proof.** *Open question, not a
  settled prohibition.* Where two register entries share a
  generation, Identity §7a.3 decides by nonce bytes and this
  contract carries no value that would let a carrier reproduce
  that decision — so an equal-generation rebind is refused and
  healed by a rotation (5a.3). A previous casting called a
  travelling tie-breaker *impossible*; that argument was wrong
  (a carrier-scoped order-preserving map exists trivially) and is
  withdrawn. What a usable construction would have to satisfy is
  written down instead, so the question can be answered rather
  than re-argued: derivable identically by both devices from
  register state alone · **authentically bound to the
  derivation**, so a presenter cannot hand a carrier an ordering
  of its choosing · analysed for what it discloses to a party that
  already holds the principal and the address · and per-carrier,
  so it is not a cross-carrier join key. Nothing in the current
  rules depends on the answer; the refusal-and-rotate path is
  complete without it, which is why this is a candidate and not a
  debt.
- **DO-6 Recipient-issued admission token.** *Deliberately not
  built in the 0.x line; kept as named candidate work rather than
  as an unstated gap.* The flooding residual of 5a.5 — anyone
  holding a public `rkid` can spend that queue's admission budget
  — is bounded to one relationship's guaranteed capacity at one
  carrier (the shared elastic room above the floors is not) and answered
  today by rotation and by a resource-shaped defence, never by
  identifying a sender. **Independent review has now twice judged
  this residual blocker-level under the rule "an attack the rules
  do not stop", and the record says so rather than softening it**:
  the sharpest form is a denial of service against **one
  relationship**, because the rate bucket is keyed to the queue
  and a flooder therefore spends the honest counterpart's
  allowance (5a.5). The editor's decision stands for the 0.x line,
  with the reasoning stated rather than assumed: the cure
  (rotation, in-relationship and terminating) is cheap and
  bounded, the blast radius is one relationship's **guaranteed**
  capacity at one carrier — the shared elastic room above the
  floors is honestly not covered — and the alternative changes
  what the carrier port *is*. The
  neighbouring deployed answer is a
  recipient-issued capability presented with each submission
  (Signal's sealed-sender delivery token), and it would close the
  part of the residual that belongs to parties the recipient never
  accepted — **not** the accepted insider, who holds such a token
  by design (Signal derives it from a profile key shared with
  accepted contacts and rotates it only on blocking), and not the
  identity-free exhaustion of the unreserved registration budget,
  which is no submission at all (round-33 B-3, stated here so the
  candidate is not mistaken for a cure). **Re-evaluation trigger, stated in advance so the
  decision is revisited by evidence rather than by mood:** adapter
  evidence of *real* floods in operation — a queue's budget
  repeatedly exhausted by a party the recipient did not accept —
  not the theoretical possibility, which is already conceded. **The
  retrofit point is already in place and needs no change to this
  contract:** a token would arrive as a further value and
  parameter set of the `admission-resource` declaration (4.4),
  which is precisely why that slot is a declaration with a closed
  domain rather than a fixed mechanism. Its non-negotiable
  property is fixed here in advance: per (relationship × carrier),
  or it is a person-wide credential under a friendlier name.

## Appendix A (informative): mapping to the current implementation

| This contract | Today (Sync 001/003, wot-core) |
|---|---|
| Document (Trust Task, profile §3) | `MessageEnvelope` / DIDComm plaintext + `MessageType` union |
| `threadId` | `thid`/`pthid` |
| Sealed envelope (5) | ECIES body `{epk, nonce, ciphertext}`, info `wot/ecies/v1` → `rltp/v1/seal`, plus new `rkid` |
| Status trias (6.1) | `RelayReceipt accepted/delivered/failed` |
| `delivery-ack` (4.2) | `attestation-receipt` (Häkchen 2) — semantics move to arrival-at-recording, **and the ack gains a proof** |
| Dispositions (6.2) | K1 `InboxAck*` taxonomy, now with mandatory order |
| Transport queue ack | relay `{type:'ack'}` — below the port line, unspecified here |

## References

[RFC2119] · [RFC8174] BCP 14 · [RFC3339] · [RFC8785] JCS · [RFC5869]
HKDF · **RLTP Identity Layer 0.50** (normative; §5.2 the `rkid`'s
key material, §5.3 the recovery context, §7 service identities,
**§7a the carrier-relationship identity**, §9.3 recovery) ·
[TT] ToIP DTGWG Trust Tasks framework specification 0.4
(§4.8.2, §4.11.1, §6.1, §6.3, §6.5, §7.2–7.3) · RLTP Encounter Layer
0.29, wire 0.25 (delivery port, binding 5.4, ceremony 5.8,
fresh-always §4.4, state model 5.3, merge rule 4.2) · RLTP Network
Visibility 0.16 (§2.1, §6a, §8) · RLTP Access Layer 0.53, wire
0.24 · RLTP Replication Contract 0.26 (§7/I14, the
direct-effect seam of 4.4) · RLTP Membership Tasks 0.16 (§3) · Sync
001/003 (superseded transport specs, Appendix A).

**External references of the adapter obligations (5a.10).** These
are the only normative rules of this contract that point *outside
the stack*, and they were the only ones with no reference entry at
all — so a reader could not tell which document "TSP-conformant"
meant:

| Reference | Identity | Version pin |
|---|---|---|
| **[TSP]** ToIP Trust Spanning Protocol | `trustoverip/tswg-tsp-specification` | commit **`ea01152425d281da944f40e8da799d7fa7a79f51`** (`spec/spec.md`). The VID taxonomy, the routed model, nested envelopes, and the direct-neighbour relationship are the surfaces 5a.10 consumes |
| **[DIDCOMM-MED]** Coordinate Mediation 2.0 | `decentralized-identity/aries-rfcs` / didcomm.org | the **immutable snapshot the adapter profile records** (below); the version label `2.0` names a moving target and is not by itself a pin |
| **[DIDCOMM-PICKUP]** Message Pickup 3.0 | didcomm.org | as above — label plus recorded snapshot, never the label alone |

**One status, stated once.** This document is read against the
commit named in the table above — `ea01152…` — and against nothing
else. Two earlier castings each added a sentence around that pin
without removing the previous one, so the same reference carried
three statuses at once: pinned, "written against the model, not a
fixed revision", and "honestly unpinned". All three cannot be
true, and only the first is: the surfaces 5a.10 consumes — outer
versus nested VIDs, routed mode, the direct-neighbour relationship
— are read **in that commit**.

What is *not* a second status but a duty on someone else:

> **A conforming adapter profile MUST identify every external
> specification it implements by an *immutable snapshot
> identity*** — a commit hash, a content digest, or another
> identifier that names **bytes** — and MUST state which of its
> constructs it maps 5a.10's obligations onto. A **version label
> is not a pin** and neither is a date: "Rev 2", "Latest Draft"
> and "2026-08-27" all admit more than one byte sequence, and two
> changes on one day are indistinguishable under the last of them.
> A profile that names only a label is not a conforming profile,
> for the same reason a carrier that declares only `"rate"` is not
> a conforming carrier (4.4): a rule whose external target is not
> reproducible is not reproducibly checkable. **No such profile
> exists in this corpus yet**, so the two DIDComm rows above are
> **not byte-reproducible today** — unlike the TSP row, which
> carries a commit. That is reference debt of the same kind §11
> records as vector debt, owed at the first adapter casting, and
> it is why 5a.10's obligations are written to stand on their own
> reading rather than on a clause number. **What that debt does
> and does not cover, since an unpinned reference is otherwise an
> open invitation to read it charitably** (round-25 M-2): 5a.10's
> obligations are **normative as written here** and their
> conformance is decided against this text, so nothing in this
> contract becomes uncheckable while the debt stands; what is
> **not** reproducibly checkable is the *mapping claim* — that
> those obligations land on the constructs those two documents
> actually define. A review of that claim can today only be read
> against the moving pages and is therefore **advisory until the
> adapter casting pins bytes**: a commit in the repository named
> above, or a content digest of the retrieved document. This
> contract does not guess one — and **no review round can supply
> it either**: a reviewer reads the same moving pages, so a
> reviewed mapping claim is advisory **by construction** until the
> adapter casting records bytes. That is why it is carried here as
> a **dated obligation on a future casting** rather than as an
> open question about this one (round-29 M-2).

(Two earlier repairs are folded into that one rule: "a commit
**or** a dated revision" was half a repair, since a commit
identifies bytes and a date does not; and a deferral of the whole
pin is not a status a pinned row can also have.)

**The direction of travel, which is not a second status:** an
adapter profile records the snapshot **it** implements, which may
be this commit or a later one; where it is later, **this document
is re-read against that snapshot at the adapter stage** and the
table above follows. Until such a re-reading happens, 5a.10 means
what it means against `ea01152…`, and nothing about a newer draft
is silently inherited.
