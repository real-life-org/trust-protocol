# Coverage of the deleted probe-world tests

The probe API left with lib Stage 2 (PR 7b), and three suites with it:
`probe.test.mjs`, `encounter.test.mjs` and the probe-world part of
`anchor.test.mjs` (as of commit 29c37b3). This table says where each
deleted test's behaviour is tested now on the holder, or why its
expectation does not hold any more. "ported" names a test in
`encounter-ported.test.mjs` or `trust-ported.test.mjs` by its tag.

Counts: 81 deleted cases (79 declarations; two anchor tests ran twice).
56 are ported to named holder tests, some with an obsolete part named in
their row; 23 were already covered by existing holder tests; 2 are
obsolete as a whole (encounter review 9, the anchor head after a split).

## probe.test.mjs

| Old test (line) | Now |
|---|---|
| ceremony, trust act, group, continuity (14) | encounter-holder "show → scan → bundle …", trust-mapping "A trusts B …", membership-holder "found → invite …", trust-continuity "re-encounter …" |
| a transient seal failure (75) | ported: "a transient seal failure never consumes the act" |
| concurrent setTrust, distinct salts (111) | ported: "concurrent trust acts — exactly one disclosure" |
| departure of one strand (124) | trust-entries "departure: an admitted entry leaves …", "departure of one relationship of a merged entry …" |
| re-issue after chaining from the earliest generation (141) | trust-continuity "2145: the appended tuple …", identity "rotation: during an open 2145 …" |
| stage 7 before stage 8 (192) | ported: "stage 7 (malformed) before stage 8" over mapping, star, group star, probe, continuity mapping |
| merge at the earlier position (239) | trust-entries "net merge …" (two tests) |
| poisoned salt (251) | trust-star "a byte-identical repeat …", "duplicate-known of a chunk cached before …", "a completing chunk failing 5300 …"; obsolete: the receiver's silence (now a duplicate-known re-ack, Delivery 6.2) and the poison set (now the 5366 lower bound) |
| continuity resend byte-identical (280) | ported: "a continuity mapping travels again byte-identical" |
| a higher in-flight salt for another view (298) | ported: "a higher in-flight salt with another view" |
| deactivation during buildStar (315) | ported: "deactivation during the star production" |
| review-7 edges: latch, order, flush (324) | ported: "review-7 edges" |
| hidden own properties (341) | vectors2 "core — hidden own properties never collide …" |
| malformed probe and star, state and cache unchanged (349) | ported: "authenticated but malformed values never corrupt state or cache" |
| chunk form, voucher form, welcome digest (385) | ported: the empty probe (in "authenticated but malformed …") and "a signed welcome with a garbage genesis digest"; obsolete: the numeric offer voucher (the rendezvous-drop offer is not the Trust §8 act) |
| baseline only by the ack (431) | trust-star "the baseline automaton …", "a late ack after the sender reported failed …", "late completions …" |
| monotonicity, re-ack, admission dedup (480) | trust-star "a byte-identical repeat …", "one open assembly per tuple …", trust-mapping "a replayed mapping envelope …" |
| admission bound (502) | trust-admission "a first verified mapping at a full set …", trust-entries "merging k admitted entries …", "departure: an admitted entry leaves …" |
| late record probe after the verified choice (521) | ported: "a late record-side probe after the verified choice" |
| a welcome without an accepted invitation (570) | membership-holder "a welcome without an accepted invitation creates no group …" |
| a second welcome rewrites nothing (585) | the same membership-holder test |
| a repeated consent keeps the channel (609) | ported: "a repeated consent keeps the released channel"; obsolete: the drop log |
| concurrent consent, one release (633) | ported: "concurrent consent calls share one release" |

## encounter.test.mjs

| Old test (line) | Now |
|---|---|
| connected path (24) | encounter-holder "show → scan → bundle → confirm prompt → counter-step → mutual …", "a duplicate bundle is duplicate-known …" |
| optical leg, the late bundle (49) | encounter-holder "the offline path …" |
| optical first, the counter waits (67) | encounter-holder "the offline path …", "decline closes …" |
| negatives consume nothing (89) | ported: "negatives" (enactment lie, wrong recipient before malformed, malformed); encounter-holder: consumed, gate-expired, unknown, stale, card differs |
| uniqueness (134) | encounter-holder "uniqueness (5.6 step 8) …" |
| review 1 (158) | ported: "review 1" ×4 (stale counter, z-binding on both paths, cards outside their profile with 6070, ERR_SIG first), "review 1/3/4" (the Entropy port) |
| review 2 (225) | ported: "review 2" (undecodable keyAgreement; the z-rendered ack ref, which found and fixed a library defect), "review 2/3/5", "review 2/14", "review 2" concurrent counters; obsolete: B-1 "show never resurrects an aged value" (aged values are removed, 5230; freshness is the Entropy port's) |
| review 3 (291) | ported: "review 3/16", "review 3/6", "review 1/3/4", "review 2/3/5"; receive "the ack form follows the acked document's class …"; obsolete: B-4 the latch on the delivery path (the holder's delivery path reads records only, 5.6 step 4) |
| review 4 (355) | ported: "review 4/5", "review 1/3/4" |
| review 5 (377) | ported: "review 4/5", "review 2/3/5", "review 5/6" |
| review 6 (415) | ported: "review 5/6", "review 3/6", "review 6/10" |
| review 7 (455) | ported: "review 7/12/13/20"; obsolete: M-3 "the optical result exposes no record" (an ActResult carries outbound and events only; the state is opaque) |
| review 8 (483) | ported: "review 8/16", "review 5/6"; obsolete: the trust-path re-ack (one receive path) |
| review 9 (503) | obsolete: the probe's lock mechanics (the engine's queue and CAS replace them); acks independent of the acceptance outcome are in "review 1", "review 2/3/5", "review 3/6" |
| review 10 (525) | ported: "review 10", "review 6/10", "negatives" |
| review 11 (553) | ported: "review 11" (six state changes between preparation and commit) |
| review 12 (612) | ported: "review 7/12/13/20", "review 12/22" ×2; obsolete: the resumable half-state (record and issuance commit together) |
| review 13 (654) | ported: "review 13" ×3 (unknown step, sentTo redirect with 6050 optically and 4100 in a bundle, parallel resumes), "review 7/12/13/20"; encounter-holder "a duplicate bundle … after the cache's retention" |
| review 14 (700) | ported: "review 2/14"; obsolete: the resume variant |
| review 15 (728) | ported: "review 15" |
| review 16 (742) | ported: "review 8/16", "review 3/16", "review 16" (six re-entries); obsolete: the resumed sent card |
| review 17 (791) | ported: "review 17"; obsolete: B-2/B-3 lock waiters (CAS equivalents in "review 11") |
| review 18 (831) | ported: "review 18" ×2 (c_A = c_B in a bundle, the record vanishing); encounter-holder "a sent card whose own challenge equals the displayed one …" |
| review 19 (856) | ported: "review 19" |
| review 20 (869) | ported: "review 7/12/13/20" |
| review 21 (887) | ported: "review 21"; obsolete: injected non-UUID ids (ids come from the Entropy port) |
| review 22 (905) | ported: "review 22/24", "review 12/22"; obsolete: "resume never backdates" and the surviving pending flag (no resumable half-state) |
| review 23 (942) | ported: "review 23" ×2 |
| review 24 (964) | ported: "review 22/24" (20 parallel scans on one scanner and on 20 scanners) |
| review 25 (976) | ported: "review 25"; encounter-holder "an aged challenge …" (the scanner's stale issuance); obsolete: the resume past c_B and the direction after a seal failure (no resumable half-state) |

## anchor.test.mjs, the probe-world part

| Old test (line) | Now |
|---|---|
| the founder in the roster (371) | membership-holder "the founder stands in the roster …" |
| trust act, rotation, every generation (384) | identity "rotation: happy path end to end …", trust-mapping "two recipients, two segment starts …", trust-star "tested against every anchor held …", "a star that blinds an anchor the holder learns only later …" |
| an unlinked change of self, the merged entry unchanged (489) | ported |
| the convergence net, both arrival orders (530) | ported |
| a copied superseded key (555) | trust-entries "N4: a copied old anchor …" |
| the same head, an extension, another successor (567) | ported |
| 65 rotations, the last 64 travel (610) | ported (real rotations over the log) |
| more than 64 rotations missed (635) | ported (6170 at stage 9, no ack, state byte-equal, refused again) |
| a copied key presenting A → X (683) | ported |
| the first foreign mapping splits off (718) | trust-entries "split (2080–2115) …" |
| split, the leaver is an alias (742) | ported |
| split, the leaver bears the identity (755) | ported (ordered by firstVerified) |
| departure of the identity bearer (780) | trust-entries "departure of one relationship of a merged entry …" |
| one relationship: an unlinked change refused, a rotation stays (791) | trust-mapping "condition 8 …", identity "rotation: happy path …" |
| review 4: the three-step copy attack (807) | ported |
| review 4: two heads, a superseded head does not merge (828) | ported |
| review 4: the other direction merges (848) | ported with today's behaviour pinned (no merge in the 6580 direction); open point for Trust 0.32: 6540/6580/6590 in the rotation direction, not justified normatively |
| review 4: a higher revision with an unchanged self (864) | ported |
| two successors, r1 then r2 (903) | ported; changed: the forged A → X is refused on its relationship (6118, the binding held since its first mapping, 6610) instead of splitting off |
| two successors, r2 then r1 (903) | ported, as above |
| review 5 M2: a rotation extends another entry (919) | ported |
| review 5 M2: the same head, newly connecting lineage (933) | ported |
| review 5 M2: a lagging strand is no evidence (945) | ported |
| review 5 M3: the head after a departure (981) | ported |
| review 5 M3: the head after a split (981) | obsolete: the holder splits only at a relationship's first verified mapping, so a relationship that moved the entry's head never splits later; the head at a split is in trust-entries "split (2080–2115) …" |
| split by binding (995) | ported |
| chaining merges only comparable heads (1014) | trust-continuity "2145 …", "B1 …", trust-entries "2145: a relationship behind two entries …" |
| a wrong rotation binding, bindings across a chaining (1059) | trust-mapping "a lineage over three generations …", "a refused mapping names the rule …", trust-continuity "B1 …" |

## The simulator suites

The vouch negatives of the old `simulator/trust-test.mjs` (a vouch over a
foreign accept digest, a non-member's vouch) are back in that suite and in
membership-holder (3810, 3750, 3755, and the inviter's 3270). The
rendezvous drop of the old `introduce-test.mjs` is obsolete: Trust §8
relays the act through the mediator.
