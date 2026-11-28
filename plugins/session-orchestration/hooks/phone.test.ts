import { expect, mock, test } from 'claude-code/testing'

import type { Ask } from '../types'
import { MIRROR_MAX_BYTES, PAIR_MAX_AGE_MS, judgePayload, mirrorDoc, parseAnswerRow, parsePayload, publicJwk, sha256hex, thumbprint } from './phone'
import type { AnswerRow, Payload } from './phone'

const X = 'CxijAnQFbFv29yvXuSU527dJRP1-fkjFNuFGLj9mbdw'
const Y = 'cMplI_UDWlXdeRMubUmOKJj7yQ_QgWVvNdP0kYrE58Y'
const JWK = { kty: 'EC', crv: 'P-256', x: X, y: Y } as const

test('thumbprint of a fixed JWK is the pinned fp and code', async () => {
  const want = { fp: 'h3lQ9rYMb8Y4b1jtz1xMXr8nWCFztltYAKjaYNRNJs0', code: '8779-50F6-B60C-6FC6' }
  expect(await thumbprint(JWK)).toEqual(want)
  // member order of the input does not matter: the canonical string is built by thumbprint
  const shuffled = { y: Y, x: X, crv: 'P-256', kty: 'EC' } as const
  expect(await thumbprint(shuffled)).toEqual(want)
})

test('publicJwk refuses d, P-384 and bad base64url', () => {
  expect(publicJwk({ ...JWK, extra: 1 })).toEqual(JWK)
  expect(publicJwk({ ...JWK, d: X })).toBeNull()
  expect(publicJwk({ ...JWK, crv: 'P-384' })).toBeNull()
  expect(publicJwk({ ...JWK, x: X.slice(1) })).toBeNull()
  expect(publicJwk({ ...JWK, y: `${Y.slice(1)}+` })).toBeNull()
  expect(publicJwk({ ...JWK, kty: 'RSA' })).toBeNull()
  expect(publicJwk(null)).toBeNull()
  expect(publicJwk('x')).toBeNull()
})

const P: Payload = { v: 1, root: 'r', askId: 'a1', key: 'k', question: 'Q?', option: 'yes', at: 1_000_000, device: 'fp' }

test('parsePayload refuses a missing field, v 2 and a non-number at', () => {
  expect(parsePayload(JSON.stringify(P))).toEqual(P)
  expect(parsePayload(JSON.stringify({ ...P, extra: 1 }))).toEqual(P)
  const { device: _d, ...noDevice } = P
  expect(parsePayload(JSON.stringify(noDevice))).toBeNull()
  expect(parsePayload(JSON.stringify({ ...P, v: 2 }))).toBeNull()
  expect(parsePayload(JSON.stringify({ ...P, at: '5' }))).toBeNull()
  expect(parsePayload('{')).toBeNull()
  expect(parsePayload('null')).toBeNull()
})

const ROW: AnswerRow = { id: 'x', version: 1, root: 'r', payload: '', sig: 's', device: 'fp' }
const ask = (o: Partial<Ask> = {}): Ask => ({ id: 'a1', key: 'k', question: 'Q?', options: ['yes', 'no'], at: 1, ...o })
const ctx = (o: Partial<Parameters<typeof judgePayload>[2]> = {}) =>
  ({ root: 'r', now: 1_000_000, hash: 'h', used: {}, asks: [ask()], ...o })

test('judgePayload gives each reason in order', () => {
  const why = (p: Payload, row: AnswerRow, c: ReturnType<typeof ctx>) => {
    const r = judgePayload(p, row, c)
    return r.ok ? 'ok' : r.reason
  }
  expect(why(P, ROW, ctx())).toBe('ok')
  expect(why({ ...P, device: 'z' }, ROW, ctx())).toBe('malformed answer')
  expect(why({ ...P, root: 'z' }, ROW, ctx())).toBe('malformed answer')
  expect(why(P, ROW, ctx({ root: 'z' }))).toBe('malformed answer')
  expect(why({ ...P, at: 1_000_000 - 3_600_001 }, ROW, ctx())).toBe('expired')
  expect(why({ ...P, at: 1_000_000 + 300_001 }, ROW, ctx())).toBe('clock ahead')
  expect(why(P, ROW, ctx({ used: { h: 1 } }))).toBe('already used')
  expect(why(P, ROW, ctx({ asks: [ask({ question: 'Other?' })] }))).toBe('withdrawn or changed')
  expect(why(P, ROW, ctx({ asks: [] }))).toBe('withdrawn or changed')
  expect(why(P, ROW, ctx({ asks: [ask({ sending: true })] }))).toBe('already answered')
  expect(why({ ...P, option: 'maybe' }, ROW, ctx())).toBe('not an option')
  const r = judgePayload(P, ROW, ctx())
  expect(r.ok && r.ask.id).toBe('a1')
})

test('mirrorDoc keeps 50 oldest asks, cuts details and activity at 4000 with …', () => {
  const asks = Array.from({ length: 60 }, (_, i) =>
    ask({ id: `a${i}`, at: 100 - i, details: 'd'.repeat(20_000), seen: true, sending: true, body: undefined }))
  const copy = JSON.stringify(asks)
  const doc = mirrorDoc('proj', asks, 'a'.repeat(20_000), 5)
  expect(JSON.stringify(asks)).toBe(copy)
  expect(doc.asks).toHaveLength(50)
  expect(doc.asks[0].id).toBe('a59')
  expect(doc.asks[0].at).toBeLessThan(doc.asks[1].at)
  expect(doc.asks[0].details).toBe(`${'d'.repeat(3997)}…`)
  expect(doc.activity).toBe(`${'a'.repeat(3997)}…`)
  expect(doc.updatedAt).toBe(5)
  expect(doc.project).toBe('proj')
  expect('seen' in doc.asks[0]).toBe(false)
  expect('sending' in doc.asks[0]).toBe(false)
  expect(JSON.stringify(doc).length).toBeLessThan(210_000)
  const short = mirrorDoc('p', [ask()], 'ok', 1)
  expect(short.asks[0]).toEqual({ id: 'a1', key: 'k', question: 'Q?', options: ['yes', 'no'], at: 1 })
  expect(short.activity).toBe('ok')
  const emoji = mirrorDoc('p', [], '😀'.repeat(4001), 1).activity
  expect(Array.from(emoji).length).toBeLessThanOrEqual(4000)
  expect(new TextEncoder().encode(emoji).length).toBeLessThanOrEqual(4000)
  expect(emoji.endsWith('…')).toBe(true)
})

test('parseAnswerRow keeps a good row and refuses the rest', () => {
  const v = { root: 'r', payload: 'p', sig: 's', device: 'd' }
  expect(parseAnswerRow('i', 3, v)).toEqual({ id: 'i', version: 3, ...v })
  expect(parseAnswerRow('i', 0, { ...v, result: 'done', extra: 1 })).toEqual({ id: 'i', version: 0, ...v, result: 'done' })
  expect(parseAnswerRow('i', 1, { ...v, result: 5 })).toEqual({ id: 'i', version: 1, ...v })
  for (const k of ['root', 'payload', 'sig', 'device']) {
    expect(parseAnswerRow('i', 1, { ...v, [k]: '' })).toBeNull()
    const { [k]: _gone, ...rest } = v as Record<string, string>
    expect(parseAnswerRow('i', 1, rest)).toBeNull()
    expect(parseAnswerRow('i', 1, { ...v, [k]: 7 })).toBeNull()
  }
  expect(parseAnswerRow('i', -1, v)).toBeNull()
  expect(parseAnswerRow('i', 1.5, v)).toBeNull()
  expect(parseAnswerRow('i', Number.NaN, v)).toBeNull()
  expect(parseAnswerRow('i', 1, null)).toBeNull()
  expect(parseAnswerRow('i', 1, [v])).toBeNull()
})

test('sha256hex is the lowercase digest of the UTF-8 bytes', async () => {
  expect(await sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  expect(await sha256hex('héllo ж 😀')).toBe('da08a38b01435a5c58c45a42f4098a8c1b390a1e1ed8cda078fdd9d324e986ac')
  expect(PAIR_MAX_AGE_MS).toBe(600_000)
})

test('mirrorDoc stays within the byte budget for non-ASCII text and skips an ask too big to fit', () => {
  const size = (d: unknown) => new TextEncoder().encode(JSON.stringify(d)).length
  for (const ch of ['ж', '😀']) {
    const asks = Array.from({ length: 60 }, (_, i) => ask({ id: `a${i}`, at: i, details: ch.repeat(4000) }))
    const doc = mirrorDoc('p', asks, ch.repeat(4000), 1)
    expect(size(doc)).toBeLessThanOrEqual(MIRROR_MAX_BYTES)
    expect(doc.asks.length).toBeGreaterThan(0)
    for (const a of doc.asks) expect(new TextEncoder().encode(a.details).length).toBeLessThanOrEqual(4000)
    expect(new TextEncoder().encode(doc.activity).length).toBeLessThanOrEqual(4000)
  }
  const asks = [ask({ id: 'big', at: 1, question: 'q'.repeat(300_000) }), ask({ id: 'n1', at: 2 }), ask({ id: 'n2', at: 3 })]
  const doc = mirrorDoc('p', asks, '', 1)
  expect(doc.asks.map(a => a.id)).toEqual(['n1', 'n2'])
  expect(size(doc)).toBeLessThanOrEqual(MIRROR_MAX_BYTES)
})

// The phone inbox's I/O, through the plugin's tools: the mirror goes out as ArtifactData calls.
const URL1 = 'https://claude.ai/artifact/abcdef123456'
const TOOL = 'mcp__session-orchestration__'
type Call = Record<string, unknown>
const harness = ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], answer: (c: Call, n: number) => unknown, root = '/work/app') => {
  mock.clock(on)
  mock.env(on, { HOME: '/h' })
  mock.store(on)
  on('session.id', async () => ({ value: 'sess-p' }))
  on('ui.status', async () => ({ value: undefined }))
  const calls: Call[] = []
  on('tool.call', { tool: 'ArtifactData' }, async (_, e) => {
    calls.push(e as unknown as Call)
    return answer(e as unknown as Call, calls.length) as never
  })
  on('process.run', async (_, e) => ({ value: { exitCode: 0, stdout: e.argv.includes('--root') ? root : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('fs.read', async () => { throw new Error('ENOENT') })
  on('fs.write', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const ask = (key: string, question: string) =>
    $.tool.call({ tool: `${TOOL}ask_approval`, key, question, options: [`Yes, ${question}`, `No, ${key}`] })
  return { calls, ask }
}
const written = (v: number) => ({ result: { db_write: { op: 'set', collection: 'coordinators', doc_id: 'x', committed: true, version: v } } })

test('phone_setup stores the url and mirrors the asks once', async ($, on) => {
  const h = harness($, on, (_, n) => written(n))
  await $.tool.call({ tool: `${TOOL}open_pane` })
  await h.ask('PROJ-1', 'merge app#1')
  const r = await $.tool.call({ tool: `${TOOL}phone_setup`, url: URL1 })
  expect(r.result).toBe(`Phone inbox set: open ${URL1} on your phone, tap Pair this phone, and approve its code in the pane.`)
  expect(h.calls).toHaveLength(1)
  expect(h.calls[0]).toMatchObject({ action: 'set', url: URL1, collection: 'coordinators' })
  expect(h.calls[0]!.if_version).toBeUndefined()
  expect(h.calls[0]!.doc_id).toMatch(/^[0-9a-f]{16}$/)
  const doc = h.calls[0]!.data as { v: number; project: string; asks: { key: string }[] }
  expect(doc).toMatchObject({ v: 1, project: 'app' })
  expect(doc.asks.map(a => a.key)).toEqual(['PROJ-1'])
  await new Promise(r => setTimeout(r, 60)) // the ask's own background mirrors finish inside the test
})

test('a new ask mirrors; an unchanged list writes nothing', async ($, on) => {
  const h = harness($, on, (_, n) => written(n))
  await $.tool.call({ tool: `${TOOL}open_pane` })
  await $.tool.call({ tool: `${TOOL}phone_setup`, url: URL1 })
  expect(h.calls).toHaveLength(1) // the empty list
  await h.ask('PROJ-1', 'merge app#1')
  await new Promise(r => setTimeout(r, 60))
  expect(h.calls).toHaveLength(2)
  expect(h.calls[1]!.if_version).toBe(1) // pinned to the version the first write returned
  expect((h.calls[1]!.data as { asks: unknown[] }).asks).toHaveLength(1)
  // Queueing the same ask again changes nothing in the document: no write.
  await h.ask('PROJ-1', 'merge app#1')
  await new Promise(r => setTimeout(r, 60))
  expect(h.calls).toHaveLength(2)
})


test('no url: nothing is written', async ($, on) => {
  const h = harness($, on, (_, n) => written(n))
  await $.tool.call({ tool: `${TOOL}open_pane` })
  await h.ask('PROJ-1', 'merge app#1')
  await new Promise(r => setTimeout(r, 60))
  expect(h.calls).toEqual([])
})

test('phone_setup refuses a non-artifact url', async ($, on) => {
  const h = harness($, on, (_, n) => written(n))
  for (const url of ['http://claude.ai/artifact/abcdef123456', 'https://evil.example/artifact/abcdef123456', 'https://claude.ai/artifact/short', 'https://claude.ai/artifact/abcdef123456/x']) {
    const r = await $.tool.call({ tool: `${TOOL}phone_setup`, url })
    expect(r.result).toMatch(/^phone_setup: url must be .*https:\/\/claude\.ai\/artifact\/<id>/)
  }
  expect(h.calls).toEqual([])
})

test('phone_setup with "" turns it off', async ($, on) => {
  const h = harness($, on, (_, n) => written(n))
  await $.tool.call({ tool: `${TOOL}open_pane` })
  await $.tool.call({ tool: `${TOOL}phone_setup`, url: URL1 })
  const r = await $.tool.call({ tool: `${TOOL}phone_setup`, url: '' })
  expect(r.result).toBe('Phone inbox off.')
  const n = h.calls.length
  await h.ask('PROJ-1', 'merge app#1')
  await new Promise(r => setTimeout(r, 60))
  expect(h.calls).toHaveLength(n)
})

test('a -p session (no ArtifactData tool) does not throw and retries on the next change', async ($, on) => {
  const h = harness($, on, () => { throw new Error('no tool named ArtifactData') })
  await $.tool.call({ tool: `${TOOL}open_pane` })
  const r = await $.tool.call({ tool: `${TOOL}phone_setup`, url: URL1 })
  expect(r.result).toMatch(/^Phone inbox set/)
  expect(h.calls).toHaveLength(1)
  // The failure is kept as the view's error and nothing is remembered as written: the next change tries again.
  await h.ask('PROJ-1', 'merge app#1')
  await new Promise(r => setTimeout(r, 60))
  expect(h.calls).toHaveLength(2)
})

const got = (version: number) => ({ result: { db_read: { op: 'get', collection: 'coordinators', doc_id: 'x', found: true, docs: [{ id: 'x', data: {}, version }] } } })
const mismatch = { result: 'Error: db write failed (version_mismatch): … now at version 7 …', text: 'Error: db write failed (version_mismatch): … now at version 7 …', isError: true }
const settle = () => new Promise(r => setTimeout(r, 60))

test('a version refusal re-reads (docs[0].version) and retries once', async ($, on) => {
  const h = harness($, on, (c, n) => (c.action === 'get' ? got(7) : n === 2 ? mismatch : written(n === 1 ? 1 : 8)))
  await $.tool.call({ tool: `${TOOL}open_pane` })
  await $.tool.call({ tool: `${TOOL}phone_setup`, url: URL1 })
  await h.ask('PROJ-1', 'merge app#1')
  await settle()
  expect(h.calls.map(c => c.action)).toEqual(['set', 'set', 'get', 'set'])
  expect(h.calls[1]!.if_version).toBe(1)
  expect(h.calls[3]!.if_version).toBe(7)
  await h.ask('PROJ-2', 'merge app#2')
  await settle()
  expect(h.calls.at(-1)!.if_version).toBe(8)
})

test('a failed first write (no if_version) reads the document and retries with its version', async ($, on) => {
  const h = harness($, on, (c, n) => (c.action === 'get' ? got(3) : n === 1 ? { result: 'Error: read the document first', text: 'Error: read the document first', isError: true } : written(4)))
  await $.tool.call({ tool: `${TOOL}open_pane` })
  await $.tool.call({ tool: `${TOOL}phone_setup`, url: URL1 })
  expect(h.calls.map(c => c.action)).toEqual(['set', 'get', 'set'])
  expect(h.calls[2]!.if_version).toBe(3)
  await settle()
})

test('any other refusal of a pinned write is one call: no get, no retry', async ($, on) => {
  const h = harness($, on, (_, n) => (n === 1 ? written(1) : { result: 'Error: too big', text: 'Error: too big', isError: true }))
  await $.tool.call({ tool: `${TOOL}open_pane` })
  await $.tool.call({ tool: `${TOOL}phone_setup`, url: URL1 })
  await h.ask('PROJ-1', 'merge app#1')
  await settle()
  expect(h.calls.map(c => c.action)).toEqual(['set', 'set'])
})

test('a change made while a write is in flight is mirrored once more, with the latest list', async ($, on) => {
  let release: () => void = () => undefined
  let first = true
  const h = harness($, on, (_, n) => {
    if (!first) return written(n)
    first = false
    return new Promise(r => { release = () => r(written(1)) })
  })
  await $.tool.call({ tool: `${TOOL}open_pane` })
  const setup = $.tool.call({ tool: `${TOOL}phone_setup`, url: URL1 })
  await settle()
  await h.ask('PROJ-1', 'merge app#1') // while the first write is pending
  release()
  await setup
  await settle()
  expect(h.calls).toHaveLength(2)
  expect((h.calls[1]!.data as { asks: unknown[] }).asks).toHaveLength(1)
  expect(h.calls[1]!.if_version).toBe(1)
})

test('a write in flight when phone_setup "" runs commits nothing; the next url starts unpinned', async ($, on) => {
  let release: () => void = () => undefined
  let first = true
  const h = harness($, on, (_, n) => {
    if (!first) return written(n)
    first = false
    return new Promise(r => { release = () => r(written(5)) })
  })
  await $.tool.call({ tool: `${TOOL}open_pane` })
  const pending = $.tool.call({ tool: `${TOOL}phone_setup`, url: URL1 })
  await settle()
  expect((await $.tool.call({ tool: `${TOOL}phone_setup`, url: '' })).result).toBe('Phone inbox off.')
  release()
  await pending
  await settle()
  await $.tool.call({ tool: `${TOOL}phone_setup`, url: 'https://claude.ai/artifact/zyxwvu987654' })
  expect(h.calls).toHaveLength(2)
  expect(h.calls[1]).toMatchObject({ action: 'set', url: 'https://claude.ai/artifact/zyxwvu987654' })
  expect(h.calls[1]!.if_version).toBeUndefined()
})

test('phone_setup with no project root says nothing is mirrored and writes nothing', async ($, on) => {
  const h = harness($, on, (_, n) => written(n), '')
  const r = await $.tool.call({ tool: `${TOOL}phone_setup`, url: URL1 })
  expect(r.result).toBe("Phone inbox set, but this folder has no project root, so nothing is mirrored yet: run it from the coordinator's project folder.")
  expect(h.calls).toEqual([])
  await settle()
})
