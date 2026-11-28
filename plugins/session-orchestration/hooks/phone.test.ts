import { expect, test } from 'claude-code/testing'

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
