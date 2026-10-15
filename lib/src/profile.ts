// profile — profile@1 as wire (Trust Layer 0.31 §6b): the directional key
// k_pr, the MAC, the closed body with its bounds, and the picture's
// dimensions read from its encoded header before any decoding. Pure: no
// state, no transport; the holder's profile duty and task
// (trust/profile.ts) build and verify through here, and the vector
// vectors/profile.json reproduces through here byte for byte.
//
//   · body  { type: 'profile@1', revision, name, image?, text? }, proof
//     { mac } (6430); name ≤ 64, text ≤ 256 characters, image a base64
//     data URI of image/jpeg or image/webp of ≤ 60 000 characters (6435) —
//     the schema trust-profile.schema.json
//   · k_pr = HKDF-SHA-256(X25519(pairX_sender, pairX_recipient), salt
//     empty, info "rltp/visibility/mac/profile/" || senderPairAnchor ||
//     "/" || recipientPairAnchor, 32 bytes); mac = macU(k_pr, JCS(body))
//     (6440, 2.1)
//   · the picture (6435, 6475): one still picture of the declared media
//     type whose every declared dimension is within 1024 × 1024, read from
//     the header alone — WebP: the VP8 or VP8L frame, and in the extended
//     (VP8X) container both its canvas and its frame; an animation (the
//     VP8X flag, ANIM, ANMF) is no still picture; JPEG: the first SOFn
//     marker. Unreadable is rejected. The library never decodes pixels;
//     re-encoding without metadata (6445) is the app's duty before
//     setProfile, as is ignoring metadata when it displays (6485)
import { jcs, makeValidator } from './core.js'
import { hkdf, platformSubtle } from './crypto.js'
import { macU } from './anchor.js'
import { SCHEMAS } from './schemas.js'

/** The registered task type that carries profile@1 (6495, Delivery §4.4). */
export const PROFILE_TYPE = 'https://real-life.org/trust-tasks/profile/0.1'

/** The bounds of 6435. */
export const PROFILE_LIMITS = Object.freeze({ name: 64, text: 256, imageChars: 60_000, pixels: 1024 })

/** The content of a profile as the human sets it (6b.1, without type and revision). */
export interface ProfileContent { name: string, image?: string, text?: string }
export interface ProfileBody extends ProfileContent { type: 'profile@1', revision: string }
export interface ProfileArtifact { body: ProfileBody, proof: { mac: string } }

const SCHEMA = 'trust-profile.schema.json'
const V = makeValidator(SCHEMAS)
/** 6430, 6435 (the schema): a closed body, a closed proof, the bounds. */
export const profileSchemaOk = (a: unknown): boolean => V.validate(a, SCHEMAS[SCHEMA], SCHEMAS[SCHEMA]).length === 0

// ── the picture's header (6475) ────────────────────────────────────────

export interface Dimensions { width: number, height: number }
/** A plain picture's dimensions, or a VP8X container's canvas and frame. */
export type ImageDimensions = Dimensions | { canvas: Dimensions, frame: Dimensions }

const base64 = (s: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) return null
  try {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch { return null }
}
const u16le = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8)
const u16be = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!
const u24le = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)
const u32le = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0
const ascii = (b: Uint8Array, o: number, n: number): string => String.fromCharCode(...b.subarray(o, o + n))

/** The frame of a VP8L or VP8 chunk at offset o (its payload at o + 8). */
function frameAt (b: Uint8Array, o: number): Dimensions | null {
  const fourcc = ascii(b, o, 4), p = o + 8
  if (fourcc === 'VP8L' && p + 5 <= b.length && b[p] === 0x2f) {
    const v = u32le(b, p + 1)
    return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 }
  }
  if (fourcc === 'VP8 ' && p + 10 <= b.length && b[p + 3] === 0x9d && b[p + 4] === 0x01 && b[p + 5] === 0x2a) {
    return { width: u16le(b, p + 6) & 0x3fff, height: u16le(b, p + 8) & 0x3fff }
  }
  return null
}

function webp (b: Uint8Array): ImageDimensions | null {
  if (b.length < 30 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP' || u32le(b, 4) + 8 !== b.length) return null
  if (ascii(b, 12, 4) !== 'VP8X') return frameAt(b, 12)
  // the extended container declares twice: the canvas here, the frame in
  // the VP8/VP8L chunk that follows; an animation is no still picture
  if (u32le(b, 16) !== 10 || (b[20]! & 0x02)) return null
  const canvas = { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  for (let o = 30; o + 8 <= b.length;) {
    const fourcc = ascii(b, o, 4), size = u32le(b, o + 4)
    if (fourcc === 'ANIM' || fourcc === 'ANMF') return null
    if (fourcc === 'VP8L' || fourcc === 'VP8 ') { const f = frameAt(b, o); return f === null ? null : { canvas, frame: f } }
    o += 8 + size + (size & 1)
  }
  return null
}

function jpeg (b: Uint8Array): Dimensions | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null
  for (let i = 2; i + 9 <= b.length;) {
    if (b[i] !== 0xff) return null
    const m = b[i + 1]!, len = u16be(b, i + 2)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: u16be(b, i + 7), height: u16be(b, i + 5) }
    i += 2 + len
  }
  return null
}

/**
 * The dimensions a data URI's picture declares in its header, read before
 * any decoding (6475): for WebP the frame, or a VP8X container's canvas
 * and frame; for JPEG the first SOFn. null: not an admitted media type, not
 * base64, not a single still picture of the declared type, or unreadable.
 */
export function imageDimensions (uri: string): ImageDimensions | null {
  if (typeof uri !== 'string') return null
  const m = /^data:(image\/(?:jpeg|webp));base64,/.exec(uri)
  if (!m) return null
  const b = base64(uri.slice(m[0].length))
  if (b === null) return null
  return m[1] === 'image/webp' ? webp(b) : jpeg(b)
}

const within = (d: Dimensions): boolean => d.width >= 1 && d.height >= 1 && d.width <= PROFILE_LIMITS.pixels && d.height <= PROFILE_LIMITS.pixels
/** 6435, 6475: every declared dimension within 1024 × 1024, the header readable. */
export const imageWithinBounds = (d: ImageDimensions | null): boolean =>
  d !== null && ('canvas' in d ? within(d.canvas) && within(d.frame) : within(d))

/** Why a profile body (or artifact) is refused: its rule, or null if it passes. */
export function profileProblem (artifact: unknown): 'RLTP-TRU-6430' | 'RLTP-TRU-6475' | null {
  if (!profileSchemaOk(artifact)) return 'RLTP-TRU-6430'
  const image = (artifact as ProfileArtifact).body.image
  if (image !== undefined && !imageWithinBounds(imageDimensions(image))) return 'RLTP-TRU-6475'
  return null
}

// ── k_pr and the MAC (6440) ────────────────────────────────────────────

/** The info string of k_pr: sender first (the direction, 6440). */
export const profileInfo = (senderPairAnchor: string, recipientPairAnchor: string): string =>
  `rltp/visibility/mac/profile/${senderPairAnchor}/${recipientPairAnchor}`

/** k_pr from the X25519 shared secret of the two pair keys (6440). */
export const profileKey = (shared: Uint8Array, senderPairAnchor: string, recipientPairAnchor: string, subtle: SubtleCrypto = platformSubtle()): Promise<Uint8Array> =>
  hkdf(shared, profileInfo(senderPairAnchor, recipientPairAnchor), 32, subtle)

/** profile@1 under k_pr: the body and its mac over JCS(body) (6430, 6440). */
export async function assembleProfile (body: ProfileBody, shared: Uint8Array, senderPairAnchor: string, recipientPairAnchor: string, subtle: SubtleCrypto = platformSubtle()): Promise<ProfileArtifact> {
  const k = await profileKey(shared, senderPairAnchor, recipientPairAnchor, subtle)
  return { body, proof: { mac: await macU(k, jcs(body), subtle) } }
}

/** Whether the artifact's mac verifies under k_pr of (sender → recipient). */
export async function profileMacOk (a: ProfileArtifact, shared: Uint8Array, senderPairAnchor: string, recipientPairAnchor: string, subtle: SubtleCrypto = platformSubtle()): Promise<boolean> {
  const k = await profileKey(shared, senderPairAnchor, recipientPairAnchor, subtle)
  return (await macU(k, jcs(a.body), subtle)) === a.proof.mac
}
