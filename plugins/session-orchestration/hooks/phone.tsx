// Pure helpers for the phone inbox: the signed payload, the device thumbprint and the mirror document.
// No Node APIs: only crypto.subtle, TextEncoder and btoa; the I/O (phoneMirror and the rest) goes through $.tool.call and $.store.
import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, RenderNode } from 'claude-code'

import { hex16, projectRoot } from './register'

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

// The pane's asks and activity, read here by the same keys (the engine's read wants atoms declared in this file).
const asks = atom({ plugin: 'session-orchestration', key: 'asks' } as const, [])
const activity = atom({ plugin: 'session-orchestration', key: 'activity' } as const, '')

// What the pane shows of the phone inbox.
export const phone = atom({ plugin: 'session-orchestration', key: 'phone' } as const, { url: null, devices: [], pairing: [], last: null, error: null })

export const PHONE_URL = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9_-]{8,64}$/

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200)
const asObject = (v: unknown): Record<string, unknown> => (isObject(v) ? v : {})
// The first numeric `version` in a result (a get's document carries it where a write's result puts its own).
const findVersion = (v: unknown): number | undefined => {
  if (Array.isArray(v)) return v.map(findVersion).find(x => x !== undefined)
  if (!isObject(v)) return undefined
  if (typeof v.version === 'number') return v.version
  for (const x of Object.values(v)) {
    const f = findVersion(x)
    if (f !== undefined) return f
  }
  return undefined
}

// The engine follows $ only into functions declared at the top of a file of this module, so these are plain
// functions over module state (one phone inbox per module), not a factory taking callbacks.
// The last document text written (updatedAt left out) and the version it left, for the url they were written to.
let seenUrl: string | null = null
let lastText: string | undefined
let version: number | undefined
let running: Promise<void> | undefined
let again = false

const forget = () => {
  lastText = undefined
  version = undefined
}
type ViewPatch = { url?: string | null; last?: string | null; error?: string | null }
function patch($: EngineInterface, p: ViewPatch) {
  return update($, phone, v => ({ ...v, ...p }))
}
async function storedUrl($: EngineInterface) {
  const u = await $.store.get('phone.url')
  const url = typeof u === 'string' && u ? u : null
  if (url !== seenUrl) {
    seenUrl = url
    forget()
  }
  return url
}

// One ArtifactData call: its result object, and the refusal's line when it was refused. A throw (no such tool in
// a -p session) is the caller's error line.
async function artifactData($: EngineInterface, url: string, input: Record<string, unknown>) {
  const r = asObject(await $.tool.call({ tool: 'ArtifactData', url, ...input } as never))
  const text = String(r.text ?? (typeof r.result === 'string' ? r.result : ''))
  return { result: asObject(r.result), error: r.isError === true ? oneLine(text || 'refused') : undefined }
}

async function mirrorOnce($: EngineInterface) {
  let url: string | null = null
  try {
    url = await storedUrl($)
    if (!url) return
    const rootPath = await projectRoot($)
    if (!rootPath) return
    const root = await hex16(rootPath)
    const project = rootPath.split('/').filter(Boolean).at(-1) ?? ''
    const doc = mirrorDoc(project, await read($, asks), await read($, activity), await $.clock.now())
    const text = JSON.stringify({ ...doc, updatedAt: 0 })
    if (text === lastText) return
    const put = async (): Promise<{ error: string } | { version: number }> => {
      const r = await artifactData($, url, { action: 'set', collection: 'coordinators', doc_id: root, data: doc, ...(version !== undefined ? { if_version: version } : {}) })
      if (r.error) return { error: r.error }
      const v = asObject(r.result.db_write).version
      return typeof v === 'number' ? { version: v } : { error: 'ArtifactData answered without a version' }
    }
    let w = await put()
    if ('error' in w) {
      // A stale version (another writer), or a document this run has not read: read it, then once more.
      const g = await artifactData($, url, { action: 'get', collection: 'coordinators', doc_id: root })
      version = g.error ? undefined : findVersion(g.result.db_read ?? g.result)
      if (version !== undefined) w = await put()
    }
    if ('error' in w) {
      forget()
      await patch($, { url, error: `phone mirror failed: ${w.error}` })
      return
    }
    lastText = text
    version = w.version
    await patch($, { url, error: null })
  } catch (err) {
    forget()
    // A store that cannot be read leaves no url to show it under: the view keeps its last state.
    if (url) await patch($, { url, error: `phone mirror failed: ${oneLine(err instanceof Error ? err.message : String(err))}` }).catch(() => undefined)
  }
}

// Writes the document when it changed; a request made while one runs makes it run once more afterwards.
export function phoneMirror($: EngineInterface): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    do {
      again = false
      await mirrorOnce($)
    } while (again)
  })().finally(() => { running = undefined })
  return running
}

export async function phoneSetup($: EngineInterface, url: unknown): Promise<string> {
  const u = typeof url === 'string' ? url.trim() : undefined
  if (u === undefined || (u !== '' && !PHONE_URL.test(u))) {
    return 'phone_setup: url must be a private claude.ai artifact link, https://claude.ai/artifact/<id> (or https://claude.ai/code/artifact/<id>), or "" to turn the phone inbox off.'
  }
  if (!u) {
    await $.store.delete('phone.url')
    seenUrl = null
    forget()
    await patch($, { url: null, last: null, error: null })
    return 'Phone inbox off.'
  }
  await $.store.set('phone.url', u)
  await patch($, { url: u, error: null })
  await phoneMirror($)
  return `Phone inbox set: open ${u} on your phone, tap Pair this phone, and approve its code in the pane.`
}

let sweeping = false
// Each minute: the mirror again, so activity changes reach the phone. One sweep at a time; never throws.
export async function phoneSweep($: EngineInterface): Promise<string> {
  if (sweeping) return 'sweep running'
  sweeping = true
  try {
    const url = await storedUrl($)
    if (!url) return 'phone inbox off'
    await phoneMirror($)
    const line = (await read($, phone)).error ?? 'mirrored'
    const t = new Date(await $.clock.now()).toISOString().slice(11, 16)
    await patch($, { url, last: `${t} ${line}` })
    return line
  } catch (err) {
    const line = `phone sweep failed: ${oneLine(err instanceof Error ? err.message : String(err))}`
    await patch($, { error: line }).catch(() => undefined)
    return line
  } finally {
    sweeping = false
  }
}

// The status line (the url, the last sweep, any error) as plain text; the pane section that dims it comes with pairing.
export async function phoneRows($: EngineInterface, _accent: Color): Promise<RenderNode[]> {
  const v = await read($, phone)
  if (!v.url && !v.error) return []
  return [[v.url ?? 'phone inbox off', v.last, v.error].filter(Boolean).join(' · ')]
}
