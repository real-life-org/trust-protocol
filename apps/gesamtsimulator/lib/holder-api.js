// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// holder-api — createHolder, the facade over the engine (lib Stage 2,
// note §4.1, §4.5). Domain modules (identity, encounter, trust, continuity,
// membership, profile) register with the engine as they graduate; today
// the facade carries the engine's built-ins, the prompts module, the
// encounter module (encounter/ceremony.ts: show, scan, the optical leg, the
// counter-step, the bundle and the credential delivery), the membership
// module (membership/holder.ts: founding, the prelude and invite, the
// accept on a group-invite prompt, admission and welcome, evidence and
// vouches; and the in-library Access over the holder's groups where no
// Access port is given), the introduction module (introduction/holder.ts:
// the three roles of Trust §8 and the mediator's start), the identity module (identity-state.ts: device names, the rotation), the trust
// module (trust/mapping.ts: the Trust act, the class settings, the anchor
// mapping's issuance and reception, the entry commit; trust/star.ts and
// trust/group-star.ts: the star and the group star, reconciled on resume
// and received with their assemblies; trust/entries.ts: merge, split and
// departure; trust/continuity.ts: the probe, the continuity mapping and
// the chaining; trust/profile.ts: profile@1) and the modules given.
//
// The human acts (note §4.2) are typed methods with an options object
// `{when, actId}`; actId is required, minted by the app when the human
// acts, and journaled with the act's result (a repeat with the same actId
// replays it, another input under it is actid-conflict). They wrap `act`
// with the trust module's command names, which stays for modules and
// tests:
//   trust(contactId, opts)                    trust.set {on: true}      human
//   untrust(contactId, opts)                  trust.set {on: false}     human
//   pauseTrust(contactId, paused, opts)       trust.pause               human
//   setClass(contactId, cls, setting, opts)   trust.setClass            human
//   setGroupClass(contactId, groupId, setting, opts)  trust.setGroupClass human
//   merge(contactIds, opts)                   trust.merge               human
//   depart(contactId, opts{relationshipId?})  trust.depart              human
//   decide(promptId, choice, opts)            prompt.decide             human
//   addDevice(name, opts)                     identity.addDevice        human
//   revokeDevice(name, opts)                  identity.revokeDevice     human
//   rotateAnchor(opts)                        identity.rotate           human
//   setProfile({name, image?, text?}, opts)   profile.set               human
//   show(opts{name?})                         encounter.show            human
//   scan(card, opts{name?})                   encounter.scan            human
//   captureSentCard(card, opts)               encounter.capture         human
//   counter(contactId, opts)                  encounter.counter         human
//   foundGroup({name, vouchThreshold?, listed?}, opts)  membership.found human
//   invite(groupId, contactId, opts)          membership.invite         human
//   vouchFor(groupId, member, opts{provenance?})  membership.vouch      human
//   introduce(requesterId, targetId, opts)    introduction.introduce    human
//   recover({when})                           trust.recover          not human
// and the read deviceKey(name, contextLabel): the device key of a held,
// unrevoked name under an own anchor context (identity-state.ts).
// A missing actId is refused at runtime as actid-missing.
//
// Reading: the views (views.ts) over one snapshot each, carrying its
// commitSeq. `subscribe` announces every commit with its commitSeq and
// events; the app re-reads the views it shows, and a view read after the
// announcement is at that commitSeq or later.
//
// Delivery: `receive(env, when)` runs Delivery §6.2 in the core and
// dispatches through the task register (receive.ts); `report` takes the
// adapter's reports (on an ack's digest it marks the ack sent); `resume`
// re-emits, runs due duties and re-emits unsent acks; `tick` expires and
// retains (engine.ts).
import { createEngine } from './engine.js';
import { DECIDE, collectDecisions, promptsModule } from './prompts.js';
import { InfraError } from './results.js';
import { commitViolations } from './invariants.js';
import { toOpaque } from './state.js';
import { trustModule } from './trust/mapping.js';
import { IDENTITY_COMMANDS, deviceKeyOf, identityModule } from './identity-state.js';
import { PROFILE_SET } from './trust/profile.js';
import { TRUST_COMMANDS } from './trust/mapping.js';
import { ENTRY_COMMANDS } from './trust/entries.js';
import { ENCOUNTER_COMMANDS, encounterModule } from './encounter/ceremony.js';
import { MEMBERSHIP_COMMANDS, localAccess, membershipModule } from './membership/holder.js';
import { INTRODUCTION_COMMANDS, introductionModule } from './introduction/holder.js';
import { contactView, contactsView, deliveryStatusView, groupsView, profileView, promptsView } from './views.js';
/** A holder over its ports: `{store, keys, entropy?, log?, access?, retry?, crypto?}`.
 *  The crypto handle (default globalThis.crypto) is resolved and probed
 *  here and also feeds the default entropy; an app that injects one
 *  passes the same handle to seedKeys(seed, crypto). */
export async function createHolder(ports, opts = {}) {
    const modules = [identityModule(), trustModule(), encounterModule(), membershipModule(), introductionModule(), ...(opts.modules ?? [])];
    const check = opts.invariants === true
        ? (before, after, op) => {
            const v = commitViolations(before, after, op);
            if (v.length)
                throw new InfraError('invariant-violated', `invariants broken by ${op.kind}: ${v.map((x) => `[${x.invariant}] ${x.detail}`).join('; ')}`, { cause: v });
        }
        : undefined;
    const engine = await createEngine(ports, [promptsModule(collectDecisions(modules)), ...modules], { ...(check ? { check } : {}), accessFrom: localAccess });
    const read = async () => (await engine.snapshot()).state;
    /** a human act: `when` and actId from the options, a missing actId refused by the engine */
    const human = (command, input, o) => engine.act(command, input, o?.when, o?.actId === undefined ? {} : { actId: o.actId });
    return Object.freeze({
        act: (command, input, when, o) => engine.act(command, input, when, o),
        decide: (promptId, choice, o) => human(DECIDE, { promptId, choice }, o),
        trust: (contactId, o) => human(TRUST_COMMANDS.set, { contactId, on: true }, o),
        untrust: (contactId, o) => human(TRUST_COMMANDS.set, { contactId, on: false }, o),
        pauseTrust: (contactId, paused, o) => human(TRUST_COMMANDS.pause, { contactId, paused }, o),
        setClass: (contactId, cls, setting, o) => human(TRUST_COMMANDS.setClass, { contactId, cls, setting }, o),
        setGroupClass: (contactId, groupId, setting, o) => human(TRUST_COMMANDS.setGroupClass, { contactId, groupId, setting }, o),
        merge: (contactIds, o) => human(ENTRY_COMMANDS.merge, { contactIds }, o),
        depart: (contactId, o) => human(ENTRY_COMMANDS.depart, o?.relationshipId === undefined ? { contactId } : { contactId, relationshipId: o.relationshipId }, o),
        recover: (o) => engine.act(TRUST_COMMANDS.recover, {}, o?.when),
        rotateAnchor: (o) => human(IDENTITY_COMMANDS.rotate, {}, o),
        setProfile: (content, o) => human(PROFILE_SET, content, o),
        show: (o) => human(ENCOUNTER_COMMANDS.show, o?.name === undefined ? {} : { name: o.name }, o),
        scan: (card, o) => human(ENCOUNTER_COMMANDS.scan, o?.name === undefined ? { card } : { card, name: o.name }, o),
        captureSentCard: (card, o) => human(ENCOUNTER_COMMANDS.capture, { card }, o),
        counter: (contactId, o) => human(ENCOUNTER_COMMANDS.counter, { contactId }, o),
        foundGroup: (g, o) => human(MEMBERSHIP_COMMANDS.found, g, o),
        invite: (groupId, contactId, o) => human(MEMBERSHIP_COMMANDS.invite, { groupId, contactId }, o),
        vouchFor: (groupId, member, o) => human(MEMBERSHIP_COMMANDS.vouch, o?.provenance === undefined ? { groupId, member } : { groupId, member, provenance: o.provenance }, o),
        introduce: (requesterId, targetId, o) => human(INTRODUCTION_COMMANDS.introduce, { requesterId, targetId }, o),
        addDevice: (name, o) => human(IDENTITY_COMMANDS.addDevice, { name }, o),
        revokeDevice: (name, o) => human(IDENTITY_COMMANDS.revokeDevice, { name }, o),
        deviceKey: async (name, contextLabel) => deviceKeyOf(await read(), ports.keys, name, contextLabel),
        tick: (when) => engine.tick(when),
        resume: (when) => engine.resume(when),
        report: (report, when) => engine.report(report, when),
        receive: (env, when) => engine.receive(env, when),
        subscribe: (listener) => engine.subscribe(listener),
        snapshot: async () => {
            const s = await engine.snapshot();
            return Object.freeze({ commitSeq: s.commitSeq, state: toOpaque(s.state) });
        },
        contacts: async () => contactsView(await read()),
        contact: async (id) => contactView(await read(), id),
        groups: async () => groupsView(await read()),
        profile: async () => profileView(await read()),
        prompts: async () => promptsView(await read()),
        deliveryStatus: async (x) => deliveryStatusView(await read(), x),
    });
}
