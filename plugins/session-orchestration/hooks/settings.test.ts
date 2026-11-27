import { expect, mock, test } from 'claude-code/testing'

import './register'
import { parseOverride } from './register'

test('parseOverride keeps valid fields, drops bad ones, and rejects the rest', () => {
  expect(parseOverride('{"model":"sonnet","effort":"low"}')).toEqual({ model: 'sonnet', effort: 'low' })
  expect(parseOverride('{"model":"opus[1m]"}')).toEqual({ model: 'opus[1m]' })
  expect(parseOverride('{"model":"rm -rf /","effort":"low"}')).toEqual({ effort: 'low' })
  expect(parseOverride('{"effort":"extreme"}')).toBeUndefined()
  expect(parseOverride('{')).toBeUndefined()
  expect(parseOverride('null')).toBeUndefined()
  expect(parseOverride('[1]')).toBeUndefined()
  expect(parseOverride('{"model":5,"effort":{}}')).toBeUndefined()
})

const PATH = '/h/.cache/session-status/settings/s1.json'
const step = async (
  $: Parameters<Parameters<typeof test>[1]>[0], extra: { agentId?: string } = {},
) => {
  const s = $.turn.step({ turnId: 't', index: 0, model: 'opus', effort: 'max', messageCount: 1, ...extra })
  for await (const _ of s) { /* drain */ }
}

const setup = (on: Parameters<Parameters<typeof test>[1]>[1], file: string | undefined) => {
  mock.env(on, { HOME: '/h' })
  on('session.id', async () => ({ value: 's1' }))
  on('fs.read', async (_, e) => {
    if (e.path === PATH && file !== undefined) return { value: file }
    throw new Error('ENOENT')
  })
  const seen: [string | undefined, string | undefined][] = []
  on('turn.step', async function* (_, e) {
    seen.push([e.model, e.effort])
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] }
  })
  return seen
}

test('a main-loop step takes the override file\'s model and effort', async ($, on) => {
  const seen = setup(on, '{"model":"sonnet","effort":"low","by":"x","why":"y","at":"z"}')
  await step($)
  expect(seen).toEqual([['sonnet', 'low']])
})

test('an effort-only file leaves the model alone', async ($, on) => {
  const seen = setup(on, '{"effort":"low"}')
  await step($)
  expect(seen).toEqual([['opus', 'low']])
})

test('a subagent step is untouched', async ($, on) => {
  const seen = setup(on, '{"model":"sonnet","effort":"low"}')
  await step($, { agentId: 'a1' })
  expect(seen).toEqual([['opus', 'max']])
})

test('no file, or a malformed one, passes the step through', async ($, on) => {
  const none = setup(on, undefined)
  await step($)
  expect(none).toEqual([['opus', 'max']])
})

test('a malformed file passes the step through', async ($, on) => {
  const seen = setup(on, '{"model":')
  await step($)
  expect(seen).toEqual([['opus', 'max']])
})
