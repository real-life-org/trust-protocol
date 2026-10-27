// GENERATED from lib/dist by scripts/build-simulator-lib.mjs — DO NOT EDIT.
// Source of truth: lib/src/*.ts. CI enforces freshness (--check).
// task-uri — the namespace of RLTP's Trust Task types (Delivery
// RLTP-DEL-3010): every Type URI is this prefix, the type's slug and its
// MAJOR.MINOR version. One place, so no module names a type in another
// form.
/** The prefix of every RLTP Type URI: `https://real-life.org/trust-tasks/spec/`. */
export const TASK_NAMESPACE = 'https://real-life.org/trust-tasks/spec/';
/** The carried document of Delivery 4.6: a sealed envelope as the payload
 *  of a Trust Task document, in a carrier that carries such documents. */
export const SEALED_ENVELOPE_TYPE = TASK_NAMESPACE + 'sealed-envelope/0.1';
