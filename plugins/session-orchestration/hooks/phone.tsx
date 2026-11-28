// Pure helpers for the phone inbox: the signed payload, the device thumbprint and the mirror document.
// No Node APIs: only crypto.subtle, TextEncoder and btoa.
import type { Ask } from '../types'

export const PHONE_MAX_AGE_MS = 3_600_000
export const PHONE_SKEW_MS = 300_000
export const PAIR_MAX_AGE_MS = 600_000

const MAX_ASKS = 50
export const MIRROR_MAX_BYTES = 240_000
const MAX_TEXT = 4000

export type Jwk = { kty: 'EC'; crv: 'P-256'; x: string; y: string }
export type Payload = { v: 1; root: string; askId: string; key: string; question: string; option: string; at: number; device: string }
export type AnswerRow = { id: string; version: number; root: string; payload: string; sig: string; device: string; result?: string }
export type Device = { jwk: Jwk; label: string; code: string; pairedAt: number }
export type PhoneAsk = { id: string; key: string; question: string; options: string[]; at: number; details?: string; target?: string }

const digest = async (text: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

export const sha256hex = async (text: string) =>
  [...await digest(text)].map(b => b.toString(16).padStart(2, '0')).join('')

// RFC 7638: SHA-256 over the required members in lexicographic order, base64url without padding.
export const thumbprint = async (jwk: Jwk): Promise<{ fp: string; code: string }> => {
  const bytes = await digest(JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }))
  const fp = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const hex = [...bytes.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return { fp, code: hex.match(/.{4}/g)!.join('-') }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string'
const filled = (v: unknown): v is string => typeof v === 'string' && v !== ''
const B64URL43 = /^[A-Za-z0-9_-]{43}$/

export const publicJwk = (v: unknown): Jwk | null => {
  try {
    if (!isObject(v) || 'd' in v) return null
    if (v.kty !== 'EC' || v.crv !== 'P-256') return null
    if (!str(v.x) || !str(v.y) || !B64URL43.test(v.x) || !B64URL43.test(v.y)) return null
    return { kty: 'EC', crv: 'P-256', x: v.x, y: v.y }
  } catch { return null }
}

export const parseAnswerRow = (id: string, version: number, v: unknown): AnswerRow | null => {
  try {
    if (!isObject(v) || !Number.isInteger(version) || version < 0) return null
    if (!filled(v.root) || !filled(v.payload) || !filled(v.sig) || !filled(v.device)) return null
    const row: AnswerRow = { id, version, root: v.root, payload: v.payload, sig: v.sig, device: v.device }
    if (str(v.result)) row.result = v.result
    return row
  } catch { return null }
}

export const parsePayload = (text: string): Payload | null => {
  try {
    const o: unknown = JSON.parse(text)
    if (!isObject(o) || o.v !== 1) return null
    if (!str(o.root) || !str(o.askId) || !str(o.key) || !str(o.question) || !str(o.option) || !str(o.device)) return null
    if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return null
    return { v: 1, root: o.root, askId: o.askId, key: o.key, question: o.question, option: o.option, at: o.at, device: o.device }
  } catch { return null }
}

export const judgePayload = (
  p: Payload, row: AnswerRow,
  ctx: { root: string; now: number; hash: string; used: Record<string, number>; asks: Ask[] },
): { ok: true; ask: Ask } | { ok: false; reason: string } => {
  const no = (reason: string) => ({ ok: false as const, reason })
  if (p.device !== row.device || p.root !== row.root || row.root !== ctx.root) return no('malformed answer')
  if (ctx.now - p.at > PHONE_MAX_AGE_MS) return no('expired')
  if (p.at - ctx.now > PHONE_SKEW_MS) return no('clock ahead')
  if (Object.prototype.hasOwnProperty.call(ctx.used, ctx.hash)) return no('already used')
  const ask = ctx.asks.find(a => a.id === p.askId && a.key === p.key && a.question === p.question)
  if (!ask) return no('withdrawn or changed')
  if (ask.sending) return no('already answered')
  if (!ask.options.includes(p.option)) return no('not an option')
  return { ok: true, ask }
}

const enc = new TextEncoder()
const bytes = (s: string) => enc.encode(s).length

// Text over MAX_TEXT code points or MAX_TEXT UTF-8 bytes is cut at a code point to end in an ellipsis within both.
const cut = (s: string) => {
  const cps = Array.from(s)
  if (cps.length <= MAX_TEXT && bytes(s) <= MAX_TEXT) return s
  let out = '', n = 0, b = bytes('…')
  for (const c of cps) {
    const cb = bytes(c)
    if (n + 1 >= MAX_TEXT || b + cb > MAX_TEXT) break
    out += c; n++; b += cb
  }
  return `${out}…`
}

export const mirrorDoc = (project: string, asks: Ask[], activity: string, now: number):
  { v: 1; project: string; asks: PhoneAsk[]; activity: string; updatedAt: number } => {
  const doc = { v: 1 as const, project, asks: [] as PhoneAsk[], activity: cut(activity), updatedAt: now }
  let used = bytes(JSON.stringify(doc))
  for (const a of [...asks].sort((x, y) => x.at - y.at)) {
    if (doc.asks.length >= MAX_ASKS) break
    const o: PhoneAsk = { id: a.id, key: a.key, question: a.question, options: [...a.options], at: a.at }
    if (a.details !== undefined) o.details = cut(a.details)
    if (a.target !== undefined) o.target = a.target
    const next = used + bytes(JSON.stringify(o)) + (doc.asks.length > 0 ? 1 : 0)
    if (next > MIRROR_MAX_BYTES) continue
    doc.asks.push(o)
    used = next
  }
  return doc
}
