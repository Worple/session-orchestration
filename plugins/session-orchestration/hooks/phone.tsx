// Pure helpers for the phone inbox: the signed payload, the device thumbprint and the mirror document.
// No Node APIs: only crypto.subtle, TextEncoder and btoa; the I/O (phoneMirror and the rest) goes through $.tool.call and $.store.
import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, RenderElement, RenderNode } from 'claude-code'

import { claimAndSubmit, clean, hex16, projectRoot, runBash } from './register'

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

// Page integrity. The phone page holds the signing key, so answers (and pairing requests) are taken only while the
// published page is byte for byte the plugin's own inbox.html. The read-back's text carries the page between the
// publish skeleton's `</head><body>` and `</body></html>` inside <cowritten-artifact-html>, equal to the source
// after trimming; nothing else is normalised.
const PAGE_FILE = 'skills/orchestrating-sessions/phone-inbox/inbox.html'
const PAGE_CHANGED = 'page changed'
const CANT_CHECK = "can't check the phone page"
const refusalText = (url: string) => `The page at ${url} isn't the plugin's inbox.html: republish it from the plugin (phone-inbox.md), then call phone_setup again.`
type PagePin = { sha: string; ver: string }
type PageVerdict = { kind: 'match'; hash: string; ver: string } | { kind: 'mismatch' } | { kind: 'unreadable'; why: string }

// The body of the published page from the Artifact read's text, or why there is none.
function pageBody(text: string): { body: string } | { why: string } {
  const start = '\n<cowritten-artifact-html>\n'
  const open = text.indexOf(start)
  const end = text.lastIndexOf('</cowritten-artifact-html>')
  if (open < 0 || end < open) return { why: 'no page content in the answer' }
  const block = text.slice(open + start.length, end)
  const head = '</head><body>'
  const tail = '</body></html>'
  const a = block.indexOf(head)
  const b = block.lastIndexOf(tail)
  if (a < 0 || b < a + head.length) return { why: "the page isn't in the expected layout" }
  return { body: block.slice(a + head.length, b).trim() }
}

// With `pin` (the sha and published version id phone_setup accepted), the page also has to be that very version: a
// republish of identical content still changes the version id, so an altered page put back between sweeps is caught.
async function pageVerdict($: EngineInterface, url: string, pin?: PagePin): Promise<PageVerdict> {
  try {
    const mine = (await $.fs.read(`${$.plugin.root}/${PAGE_FILE}`)) as unknown
    if (typeof mine !== 'string') return { kind: 'unreadable', why: "the plugin's inbox.html is not text" }
    const r = asObject(await $.tool.call({ tool: 'Artifact', action: 'read', url } as never))
    const text = typeof r.text === 'string' ? r.text : ''
    if (r.isError === true) return { kind: 'unreadable', why: oneLine(text || 'refused') }
    const got = pageBody(text)
    if ('why' in got) return { kind: 'unreadable', why: got.why }
    const ver = asObject(asObject(r.result).artifactRead).ver
    if (!filled(ver)) return { kind: 'unreadable', why: 'no version id in the answer' }
    const hash = await sha256hex(got.body)
    if (hash !== (await sha256hex(mine.trim()))) return { kind: 'mismatch' }
    if (pin && (pin.sha !== hash || pin.ver !== ver)) return { kind: 'mismatch' }
    return { kind: 'match', hash, ver }
  } catch (err) {
    return { kind: 'unreadable', why: errText(err) }
  }
}

// One read per sweep, made only when something needs it.
function pageGate($: EngineInterface, url: string): () => Promise<PageVerdict> {
  let once: Promise<PageVerdict> | undefined
  return () => (once ??= pageGateRead($, url))
}
async function pageGateRead($: EngineInterface, url: string): Promise<PageVerdict> {
  try {
    const o = asObject(await $.store.get('phone.page'))
    if (!filled(o.sha) || !filled(o.ver)) return { kind: 'unreadable', why: 'the page was not accepted by phone_setup: call it again' }
    return await pageVerdict($, url, { sha: o.sha, ver: o.ver })
  } catch (err) {
    return { kind: 'unreadable', why: errText(err) }
  }
}
const pageError = (v: PageVerdict, url: string) =>
  v.kind === 'mismatch' ? refusalText(url) : v.kind === 'unreadable' ? `${CANT_CHECK}: ${v.why}` : undefined
const isPageError = (e: string) => e.startsWith(CANT_CHECK) || e.startsWith("The page at ")

export async function phoneSetup($: EngineInterface, url: unknown): Promise<string> {
  const u = typeof url === 'string' ? url.trim() : undefined
  if (u === undefined || (u !== '' && !PHONE_URL.test(u))) {
    return 'phone_setup: url must be a private claude.ai artifact link, https://claude.ai/artifact/<id> (or https://claude.ai/code/artifact/<id>), or "" to turn the phone inbox off.'
  }
  if (!u) {
    await $.store.delete('phone.url')
    await $.store.delete('phone.page')
    seenUrl = null
    forget()
    gen++
    await patch($, { url: null, last: null, error: null })
    return 'Phone inbox off.'
  }
  const verdict = await pageVerdict($, u)
  if (verdict.kind === 'mismatch') return refusalText(u)
  if (verdict.kind === 'unreadable') return `Couldn't read the page at ${u} back (${verdict.why}): check the URL, then call phone_setup again.`
  await $.store.set('phone.url', u)
  await $.store.set('phone.page', { sha: verdict.hash, ver: verdict.ver })
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
async function sweepDevices($: EngineInterface, url: string, gate: () => Promise<PageVerdict>): Promise<string | undefined> {
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
  const cands: (PhoneView['pairing'][number] & { jwk: Jwk; version: number | undefined })[] = []
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
    cands.push({ fp, label: labelOf(data.label), code, at, jwk, version: ver })
  }
  // A request is listed only while the page is the plugin's own: a changed or unreadable page lists none.
  if (cands.length > 0 && (await gate()).kind === 'match') {
    for (const c of cands) {
      rows.push({ fp: c.fp, label: c.label, code: c.code, at: c.at })
      docs.set(c.fp, { jwk: c.jwk, version: c.version })
    }
  }
  const healed = (await Promise.all(heals)).find(e => e)
  if (mine !== gen) return undefined
  pairDocs = docs
  await patch($, { pairing: rows.sort((a, b) => a.at - b.at), devices: deviceViews(paired) })
  return healed ? `${DEV_ERR}: ${healed}` : undefined
}

// The answers. The phone writes answers/<id>; this sweep verifies each row's signature (in Node: verify-sig.mjs),
// judges it against the asks, and submits it exactly as a pane click does (claimAndSubmit), so the approval gate that
// trusts that text works unchanged. Every write to a row is pinned to the version this sweep last saw: that is the lock
// between two coordinators of one project (a handover's overlap).
const ANS_ERR = "can't verify phone answers"
const ANS_FAIL = 'phone answers failed'
const NOTHING = 'Phone: nothing new'
const ANSWER_KEEP_MS = 86_400_000
const errText = (err: unknown) => oneLine(err instanceof Error ? err.message : String(err))
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const storedUsed = (v: unknown, now: number): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const [h, at] of Object.entries(asObject(v))) {
    if (typeof at === 'number' && Number.isFinite(at) && now - at <= PHONE_MAX_AGE_MS + PHONE_SKEW_MS) out[h] = at
  }
  return out
}

// 'valid', 'bad' (exit 1) and 'malformed' (exit 2) are the verifier's verdicts; anything else (no node, a crash, a
// timeout, another code) is that it couldn't verify.
async function runNode($: EngineInterface, jwk: Jwk, payload: string, sig: string): Promise<'valid' | 'bad' | 'malformed' | { cant: string }> {
  try {
    const r = await runBash($, ['-c', 'exec node "$0"', `${$.plugin.root}/hooks/verify-sig.mjs`], { stdin: JSON.stringify({ jwk, payload, sig }), timeoutMs: 10_000 })
    if (r.exitCode === 0) return 'valid'
    if (r.exitCode === 1) return 'bad'
    if (r.exitCode === 2) return 'malformed'
    return { cant: `verifier exited ${r.exitCode}${r.stderr.trim() ? `: ${oneLine(r.stderr)}` : ''}` }
  } catch (err) {
    return { cant: errText(err) }
  }
}

// One versioned update of an answer row: its new version, a version refusal (another session took the row), or an error line.
async function writeRow($: EngineInterface, url: string, id: string, version: number, data: Record<string, unknown>): Promise<{ version: number } | { stale: true } | { error: string }> {
  try {
    const r = await artifactData($, url, { action: 'update', collection: 'answers', doc_id: id, data, if_version: version })
    if (r.error) return r.error.includes('version_mismatch') ? { stale: true } : { error: r.error }
    const v = asObject(r.result.db_write).version
    return typeof v === 'number' ? { version: v } : { error: 'ArtifactData answered without a version' }
  } catch (err) {
    return { error: errText(err) }
  }
}

// When the answer's submit settles (the turn started, or it was dropped): the row says delivered or why not. Never throws.
async function settleRow($: EngineInterface, url: string, id: string, version: number, sent: Promise<string | undefined>): Promise<void> {
  try {
    let data: Record<string, unknown>
    try {
      const why = await sent
      data = why === undefined ? { result: 'delivered' } : { result: 'refused', reason: `not delivered: ${oneLine(why)}` }
    } catch (err) {
      data = { result: 'refused', reason: `not delivered: ${errText(err)}` }
    }
    const w = await writeRow($, url, id, version, { ...data, resultAt: await $.clock.now() })
    if ('error' in w) await patch($, { error: `${ANS_FAIL}: ${w.error}` })
  } catch {
    // the view can't be written either: nothing more to do
  }
}

async function sweepAnswers($: EngineInterface, url: string, gate: () => Promise<PageVerdict>): Promise<{ line: string; error?: string }> {
  const rootPath = await projectRoot($)
  if (!rootPath) return { line: NOTHING }
  const root = await hex16(rootPath)
  const q = await artifactData($, url, { action: 'query', collection: 'answers', query: { where: [['root', '==', root]], order_by: { field: 'createdAt', direction: 'desc' }, limit: 100 } })
  if (q.error) return { line: NOTHING, error: `${ANS_FAIL}: ${q.error}` }
  const raw = asObject(q.result.db_read).docs
  // Only this project's rows are ever read further or written, whatever the query returned.
  // The newest 100 come back (a batch of old or junk rows can't push out newer answers); the unhandled ones are
  // handled oldest first, so the first tap on an ask wins.
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const docs = (Array.isArray(raw) ? raw : []).map(asObject).filter(d => str(d.id) && asObject(d.data).root === root)
    .sort((a, b) => Number(asObject(a.data).createdAt ?? 0) - Number(asObject(b.data).createdAt ?? 0))
  const devices = storedDevices(await $.store.get('phone.devices'))
  const mine: Record<string, number> = {} // the hashes this sweep accepted
  const keys: string[] = []
  const reasons: string[] = []
  let refused = 0
  let error: string | undefined
  const refuse = async (id: string, version: number, reason: string) => {
    const w = await writeRow($, url, id, version, { result: 'refused', reason, resultAt: await $.clock.now() })
    if ('version' in w) {
      refused++
      reasons.push(reason)
    } else if ('error' in w) {
      error ??= `${ANS_FAIL}: ${w.error}`
    }
  }
  const gone = new Set<string>()
  const drop = async (d: Record<string, unknown>) => {
    gone.add(d.id as string)
    try {
      const r = await artifactData($, url, { action: 'delete', collection: 'answers', doc_id: d.id as string, if_version: d.version })
      if (r.error && !r.error.includes('version_mismatch')) error ??= `${ANS_FAIL}: ${r.error}`
    } catch (err) {
      error ??= `${ANS_FAIL}: ${errText(err)}`
    }
  }
  const t0 = await $.clock.now()
  for (const d of docs) {
    const data = asObject(d.data)
    const id = d.id as string
    const ver = d.version
    if (typeof ver !== 'number' || !Number.isInteger(ver)) continue
    if (!finite(data.createdAt)) { await drop(d); continue } // not a row the phone's page writes
    // A result is one this module wrote; anything else is junk, and as unhandled-looking rows it would fill the page for good.
    if (data.result !== undefined && !(typeof data.result === 'string' && ['queued', 'delivered', 'refused'].includes(data.result))) { await drop(d); continue }
    if (data.result !== undefined) continue
    try {
      // An unhandled row of this root is work: the page is read (once per sweep) before anything is verified or submitted.
      const page = await gate()
      if (page.kind === 'unreadable') continue // untouched; the sweep's error line says why
      if (page.kind === 'mismatch') { await refuse(id, ver, PAGE_CHANGED); continue }
      if (data.createdAt - t0 > PHONE_SKEW_MS) { await refuse(id, ver, 'clock ahead'); continue } // no verifier spawned for it
      const row = parseAnswerRow(id, ver, data)
      if (!row) { await refuse(id, ver, 'malformed answer'); continue }
      if (!hasOwn(devices, row.device)) { await refuse(id, ver, 'unpaired device'); continue }
      const verdict = await runNode($, devices[row.device]!.jwk, row.payload, row.sig)
      if (typeof verdict === 'object') {
        error = `${ANS_ERR}: ${verdict.cant}`
        break // the rest wait for a sweep that can verify
      }
      if (verdict === 'bad') { await refuse(id, ver, 'bad signature'); continue }
      if (verdict === 'malformed') { await refuse(id, ver, 'malformed answer'); continue }
      const p = parsePayload(row.payload)
      if (!p) { await refuse(id, ver, 'malformed answer'); continue }
      const now = await $.clock.now()
      const hash = await sha256hex(row.payload)
      // The used hashes are read again for each row: another coordinator may have added some since the sweep began.
      const used = { ...storedUsed(await $.store.get('phone.used'), now), ...mine }
      const judged = judgePayload(p, row, { root, now, hash, used, asks: await read($, asks) })
      if (!judged.ok) { await refuse(id, ver, judged.reason); continue }
      // The lock: queued, pinned to the version read. A refusal means another session has the row.
      const queued = await writeRow($, url, id, ver, { result: 'queued', resultAt: now })
      if ('stale' in queued) continue
      if ('error' in queued) {
        error ??= `${ANS_FAIL}: ${queued.error}`
        continue
      }
      mine[hash] = now
      await $.store.set('phone.used', { ...used, [hash]: now })
      const claim = await claimAndSubmit($, judged.ask, p.option, 'Phone answer')
      if (!claim) { await refuse(id, queued.version, 'already answered'); continue }
      keys.push(judged.ask.key)
      // The submit queues until this coordinator's turn ends: awaiting it here would hold the turn that has to end first.
      void settleRow($, url, id, queued.version, claim.sent)
    } catch (err) {
      error ??= `${ANS_FAIL}: ${errText(err)}`
      break
    }
  }
  // Answered rows are kept a day for the phone to show, then deleted; so is a row dated in the future or with no
  // usable time (the page never writes one): a batch of them could otherwise fill the query's page for good.
  const now = await $.clock.now()
  for (const d of docs) {
    const data = asObject(d.data)
    if (gone.has(d.id as string) || typeof data.result !== 'string' || typeof d.version !== 'number') continue
    const old = !finite(data.resultAt) || now - data.resultAt > ANSWER_KEEP_MS || data.resultAt - now > PHONE_SKEW_MS
    const future = finite(data.createdAt) && data.createdAt - t0 > PHONE_SKEW_MS
    if (old || future) await drop(d)
  }
  const line = keys.length + refused === 0 ? NOTHING
    : `Phone: ${keys.length} delivered${keys.length ? ` (${keys.join(', ')})` : ''}, ${refused} refused${refused ? ` (${[...new Set(reasons)].join(', ')})` : ''}`
  return { line, error }
}

let sweepRun: Promise<string> | undefined
let rerun = false
// The mirror again, so activity changes reach the phone, then the devices, then the answers. Never throws.
async function runSweep($: EngineInterface): Promise<string> {
  try {
    const url = await storedUrl($)
    if (!url) return 'phone inbox off'
    await phoneMirror($)
    const gate = pageGate($, url)
    let checked: PageVerdict | undefined
    const seen = () => gate().then(v => (checked = v))
    const devErr = await sweepDevices($, url, seen).catch(err => `${DEV_ERR}: ${errText(err)}`)
    const ans = await sweepAnswers($, url, seen).catch(err => ({ line: NOTHING, error: `${ANS_FAIL}: ${errText(err)}` }))
    // The mirror owns the error line it left; the devices' and answers' from an earlier sweep are replaced by this one's.
    const cur = (await read($, phone)).error
    const own = cur && ![DEV_ERR, ANS_ERR, ANS_FAIL].some(p => cur.startsWith(p)) && !isPageError(cur)
    // A page check made by this sweep replaces an earlier verdict; with no work to gate, the earlier one stands.
    const kept = cur && isPageError(cur) && !checked ? cur : undefined
    const err = (own ? cur : undefined) ?? (checked ? pageError(checked, url) : undefined) ?? kept ?? ans.error ?? devErr ?? null
    const t = new Date(await $.clock.now()).toISOString().slice(11, 16)
    // What the sweep did with the answers shows beside the time: the pane's status line is where the person (and a test) reads it.
    await patch($, { url, last: `${t} ${err ?? 'mirrored'}${ans.line === NOTHING ? '' : ` · ${ans.line}`}`, error: err })
    return err ?? 'mirrored'
  } catch (err) {
    const line = `phone sweep failed: ${errText(err)}`
    await patch($, { error: line }).catch(() => undefined)
    return line
  }
}

// Each minute. One sweep at a time. `now` (phone_answers) asks for one more run when one is already going, so rows
// written since it began are read too.
export async function phoneSweep($: EngineInterface, now = false): Promise<string> {
  if (sweepRun) {
    if (now) rerun = true
    return 'sweep running'
  }
  let status = ''
  do {
    rerun = false
    const run = runSweep($)
    sweepRun = run
    try {
      status = await run
    } finally {
      sweepRun = undefined
    }
  } while (rerun)
  return status
}

// phone_answers: why there is nothing to sweep, or undefined. The sweep itself does not run in the tool's hook: the
// host refuses a prompt.submit made while a tool.call hook runs (it would wait on the turn the hook holds), and a
// sweep submits. register.tsx runs it from a timer.
export async function phoneOff($: EngineInterface): Promise<string | undefined> {
  const url = await storedUrl($).catch(() => null)
  return url ? undefined : 'Phone inbox is off: call phone_setup first.'
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
