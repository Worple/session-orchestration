// Pure helpers for the phone inbox: the signed payload, the device thumbprint and the mirror document.
// No Node APIs: only crypto.subtle, TextEncoder and btoa; the I/O (phoneMirror and the rest) goes through $.tool.call and $.store.
import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, RenderElement, RenderNode } from 'claude-code'

import { clean, hex16, projectRoot } from './register'

import type { Ask, PhoneView } from '../types'

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
// The engine follows $ only into functions declared at the top of a file of this module, so these are plain
// functions over module state (one phone inbox per module), not a factory taking callbacks.
// The last document text written (updatedAt left out) and the version it left, for the url they were written to.
let seenUrl: string | null = null
let lastText: string | undefined
let version: number | undefined
let running: Promise<void> | undefined
let again = false
let gen = 0 // bumped whenever the phone url changes or is cleared

const forget = () => {
  lastText = undefined
  version = undefined
}
type ViewPatch = { url?: string | null; last?: string | null; error?: string | null; pairing?: PhoneView['pairing']; devices?: PhoneView['devices'] }
function patch($: EngineInterface, p: ViewPatch) {
  return update($, phone, v => ({ ...v, ...p }))
}
async function storedUrl($: EngineInterface) {
  const u = await $.store.get('phone.url')
  const url = typeof u === 'string' && u ? u : null
  if (url !== seenUrl) {
    seenUrl = url
    forget()
    gen++
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
  const mine = gen
  try {
    url = await storedUrl($)
    if (!url) return
    // A url change or "" while this run was in flight: its url is no longer the phone's, so it commits nothing.
    const current = () => mine === gen
    const rootPath = await projectRoot($)
    if (!rootPath) {
      if (current()) await patch($, { url, error: 'no project root: nothing mirrored' })
      return
    }
    const root = await hex16(rootPath)
    const project = rootPath.split('/').filter(Boolean).at(-1) ?? ''
    const doc = mirrorDoc(project, await read($, asks), await read($, activity), await $.clock.now())
    const text = JSON.stringify({ ...doc, updatedAt: 0 })
    if (text === lastText) return
    const put = async (pin: number | undefined): Promise<{ error: string; stale: boolean } | { version: number }> => {
      const r = await artifactData($, url, { action: 'set', collection: 'coordinators', doc_id: root, data: doc, ...(pin !== undefined ? { if_version: pin } : {}) })
      if (r.error) return { error: r.error, stale: r.error.includes('version_mismatch') }
      const v = asObject(r.result.db_write).version
      return typeof v === 'number' ? { version: v } : { error: 'ArtifactData answered without a version', stale: false }
    }
    const pinned = version
    let w = await put(pinned)
    // Read the document and write once more only for a version refusal, or for a first write (no version known: after
    // a start or a url change) that may have met a document that already exists. Any other refusal is final.
    if ('error' in w && (w.stale || pinned === undefined)) {
      const g = await artifactData($, url, { action: 'get', collection: 'coordinators', doc_id: root })
      if (g.error) {
        w = { error: g.error, stale: false }
      } else {
        const d = Array.isArray(asObject(g.result.db_read).docs) ? (asObject(g.result.db_read).docs as unknown[])[0] : undefined
        const v = asObject(d).version
        w = await put(typeof v === 'number' ? v : undefined)
      }
    }
    if (!current()) return
    if ('error' in w) {
      forget()
      await patch($, { url, error: `phone mirror failed: ${w.error}` })
      return
    }
    lastText = text
    version = w.version
    await patch($, { url, error: null })
  } catch (err) {
    if (mine !== gen) return
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
  // `running` is cleared inside, right after the loop's last check, so a request can't land between the two.
  running = (async () => {
    try {
      do {
        again = false
        await mirrorOnce($)
      } while (again)
    } finally {
      running = undefined
    }
  })()
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
    gen++
    await patch($, { url: null, last: null, error: null })
    return 'Phone inbox off.'
  }
  await $.store.set('phone.url', u)
  seenUrl = u
  forget()
  gen++
  await patch($, { url: u, error: null })
  await phoneMirror($)
  const v = await read($, phone)
  if (v.error === 'no project root: nothing mirrored') {
    return 'Phone inbox set, but this folder has no project root, so nothing is mirrored yet: run it from the coordinator\'s project folder.'
  }
  return `Phone inbox set: open ${u} on your phone, tap Pair this phone, and approve its code in the pane.`
}

// Pairing. The page writes devices/<fp>; the sweep lists the requests that are fresh, valid and not yet decided.
const DEV_ERR = 'phone devices failed'
const LABEL_MAX = 40
const labelOf = (v: unknown) => {
  const cps = Array.from(clean(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim() || 'Phone')
  return cps.length > LABEL_MAX ? `${cps.slice(0, LABEL_MAX - 1).join('')}…` : cps.join('')
}
const storedDevices = (v: unknown): Record<string, Device> => {
  const out: Record<string, Device> = {}
  for (const [fp, d] of Object.entries(asObject(v))) {
    const o = asObject(d)
    const jwk = publicJwk(o.jwk)
    if (jwk && str(o.label) && str(o.code) && typeof o.pairedAt === 'number') out[fp] = { jwk, label: o.label, code: o.code, pairedAt: o.pairedAt }
  }
  return out
}
const storedRejected = (v: unknown): string[] => (Array.isArray(v) ? v.filter(str) : [])
const deviceViews = (d: Record<string, Device>): PhoneView['devices'] =>
  Object.entries(d).sort((a, b) => a[1].pairedAt - b[1].pairedAt).map(([fp, x]) => ({ fp, label: x.label, code: x.code }))
// The documents behind the pairing rows (their JWK and version), as the last sweep read them.
let pairDocs = new Map<string, { jwk: Jwk; version: number | undefined }>()

// Writes the decision to the device's document; the refusal's line, if any.
async function markDoc($: EngineInterface, url: string, fp: string, state: 'paired' | 'rejected', version: number | undefined, now: number) {
  try {
    const r = await artifactData($, url, { action: 'update', collection: 'devices', doc_id: fp, data: { state, stateAt: now }, ...(version !== undefined ? { if_version: version } : {}) })
    return r.error
  } catch (err) {
    return oneLine(err instanceof Error ? err.message : String(err))
  }
}

// Lists the pairing requests and the paired devices in the view; sends a decision again to a document that lost it.
// Returns its error line, if any.
async function sweepDevices($: EngineInterface, url: string): Promise<string | undefined> {
  const mine = gen
  const q = await artifactData($, url, { action: 'query', collection: 'devices', query: { order_by: { field: 'createdAt', direction: 'desc' }, limit: 50 } })
  if (q.error) return `${DEV_ERR}: ${q.error}`
  const raw = asObject(q.result.db_read).docs
  const now = await $.clock.now()
  const paired = storedDevices(await $.store.get('phone.devices'))
  const rejected = storedRejected(await $.store.get('phone.rejected'))
  const rows: PhoneView['pairing'] = []
  const docs = new Map<string, { jwk: Jwk; version: number | undefined }>()
  const heals: Promise<string | undefined>[] = []
  for (const doc of Array.isArray(raw) ? raw : []) {
    const id = asObject(doc).id
    const data = asObject(asObject(doc).data)
    const version = asObject(doc).version
    const ver = typeof version === 'number' ? version : undefined
    const jwk = publicJwk(data.jwk)
    if (!str(id) || !jwk) continue
    const { fp, code } = await thumbprint(jwk) // never the doc's own idea of its fp
    if (fp !== id) continue
    if (Object.prototype.hasOwnProperty.call(paired, fp)) {
      if (data.state !== 'paired') heals.push(markDoc($, url, fp, 'paired', ver, now))
      continue
    }
    if (rejected.includes(fp)) {
      if (data.state !== 'rejected') heals.push(markDoc($, url, fp, 'rejected', ver, now))
      continue
    }
    const at = data.createdAt
    if (data.state !== undefined || typeof at !== 'number' || !Number.isFinite(at) || now - at > PAIR_MAX_AGE_MS) continue
    rows.push({ fp, label: labelOf(data.label), code, at })
    docs.set(fp, { jwk, version: ver })
  }
  const healed = (await Promise.all(heals)).find(e => e)
  if (mine !== gen) return undefined
  pairDocs = docs
  await patch($, { pairing: rows.sort((a, b) => a.at - b.at), devices: deviceViews(paired) })
  return healed ? `${DEV_ERR}: ${healed}` : undefined
}

let sweeping = false
// Each minute: the mirror again, so activity changes reach the phone, then the devices. One sweep at a time; never throws.
export async function phoneSweep($: EngineInterface): Promise<string> {
  if (sweeping) return 'sweep running'
  sweeping = true
  try {
    const url = await storedUrl($)
    if (!url) return 'phone inbox off'
    await phoneMirror($)
    const devErr = await sweepDevices($, url).catch(err => `${DEV_ERR}: ${oneLine(err instanceof Error ? err.message : String(err))}`)
    // The mirror owns the error line it left; a devices error from an earlier sweep is replaced by this one's.
    const cur = (await read($, phone)).error
    const err = (cur && !cur.startsWith(DEV_ERR) ? cur : undefined) ?? devErr ?? null
    const t = new Date(await $.clock.now()).toISOString().slice(11, 16)
    await patch($, { url, last: `${t} ${err ?? 'mirrored'}`, error: err })
    return err ?? 'mirrored'
  } catch (err) {
    const line = `phone sweep failed: ${oneLine(err instanceof Error ? err.message : String(err))}`
    await patch($, { error: line }).catch(() => undefined)
    return line
  } finally {
    sweeping = false
  }
}

// Pair a request listed in the pane: stored first (so a lost document write is sent again by the sweep), then the document.
export async function phonePair($: EngineInterface, fp: string): Promise<void> {
  try {
    const url = await storedUrl($)
    const row = (await read($, phone)).pairing.find(r => r.fp === fp)
    const doc = pairDocs.get(fp)
    if (!url || !row || !doc) return // a stale press
    pairDocs.delete(fp)
    const t = await thumbprint(doc.jwk)
    if (t.fp !== fp) return
    const now = await $.clock.now()
    const paired = storedDevices(await $.store.get('phone.devices'))
    paired[fp] = { jwk: doc.jwk, label: row.label, code: t.code, pairedAt: now }
    await $.store.set('phone.devices', paired)
    await update($, phone, v => ({ ...v, pairing: v.pairing.filter(r => r.fp !== fp), devices: deviceViews(paired) }))
    const err = await markDoc($, url, fp, 'paired', doc.version, now)
    if (err) await patch($, { error: `${DEV_ERR}: ${err}` })
  } catch (err) {
    await patch($, { error: `${DEV_ERR}: ${oneLine(err instanceof Error ? err.message : String(err))}` }).catch(() => undefined)
  }
}

export async function phoneReject($: EngineInterface, fp: string): Promise<void> {
  try {
    const url = await storedUrl($)
    const row = (await read($, phone)).pairing.find(r => r.fp === fp)
    if (!url || !row) return
    const now = await $.clock.now()
    const rejected = storedRejected(await $.store.get('phone.rejected'))
    if (!rejected.includes(fp)) await $.store.set('phone.rejected', [...rejected, fp])
    const version = pairDocs.get(fp)?.version
    pairDocs.delete(fp)
    await update($, phone, v => ({ ...v, pairing: v.pairing.filter(r => r.fp !== fp) }))
    const err = await markDoc($, url, fp, 'rejected', version, now)
    if (err) await patch($, { error: `${DEV_ERR}: ${err}` })
  } catch (err) {
    await patch($, { error: `${DEV_ERR}: ${oneLine(err instanceof Error ? err.message : String(err))}` }).catch(() => undefined)
  }
}

export async function phoneUnpair($: EngineInterface, fp: string): Promise<void> {
  try {
    const paired = storedDevices(await $.store.get('phone.devices'))
    delete paired[fp]
    await $.store.set('phone.devices', paired)
    await update($, phone, v => ({ ...v, devices: v.devices.filter(d => d.fp !== fp) }))
  } catch (err) {
    await patch($, { error: `${DEV_ERR}: ${oneLine(err instanceof Error ? err.message : String(err))}` }).catch(() => undefined)
  }
}

// The status line (the url, the last sweep, any error) as plain text; phoneSection draws it dim.
export async function phoneRows($: EngineInterface, _accent: Color): Promise<RenderNode[]> {
  const v = await read($, phone)
  if (!v.url && !v.error) return []
  return [[v.url ?? 'phone inbox off', v.last, v.error].filter(Boolean).join(' · ')]
}

// The pane's Phone section: nothing while the inbox is off; else a row per pairing request (Pair, Reject), a line per
// paired device (Unpair) and a dim status line. `ui` is the pane's resolved components.
export async function phoneSection($: EngineInterface, ui: Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Text' | 'Button'>): Promise<{ count: number; nodes: RenderElement[] }> {
  // A store that can't be read (a session without one) is an inbox that is off: the pane draws without the section.
  const url = await storedUrl($).catch(() => null)
  if (!url) return { count: 0, nodes: [] }
  const { Box, Text, Button } = ui
  const v = await read($, phone)
  const first = (await phoneRows($, 'inactive'))[0]
  const status = typeof first === 'string' ? first : url
  const nodes: RenderElement[] = [
    ...v.pairing.map(r => (
      <Box key={`phone-row-${r.fp}`} flexDirection="column">
        <Text>{`Pair phone "${r.label}" ${r.code}? Pair only if your phone shows this code.`}</Text>
        <Box columnGap={2}>
          <Button key={`phone-pair-${r.fp}`} plain label="Pair" onPress={() => phonePair($, r.fp)} />
          <Button key={`phone-reject-${r.fp}`} plain label="Reject" onPress={() => phoneReject($, r.fp)} />
        </Box>
      </Box>
    )),
    ...v.devices.map(d => (
      <Box key={`phone-dev-${d.fp}`} columnGap={2}>
        <Text>{`Paired: ${d.label} ${d.code}`}</Text>
        <Button key={`phone-unpair-${d.fp}`} plain label="Unpair" onPress={() => phoneUnpair($, d.fp)} />
      </Box>
    )),
    <Text key="phone-status" dimColor wrap="truncate-end">{status}</Text>,
  ]
  return { count: v.pairing.length + v.devices.length, nodes }
}
