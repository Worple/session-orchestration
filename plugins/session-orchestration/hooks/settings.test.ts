import { expect, mock, test } from 'claude-code/testing'

import './register'
import { parseActions, parseOverride } from './register'

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

test('a project action can\'t take h or v, the pane\'s own Up and Down a rung', () => {
  expect(parseActions('[{"label":"X","hotkey":"h","command":"x"}]').errors[0]).toMatch(/pane's own/)
  expect(parseActions('[{"label":"X","hotkey":"v","command":"x"}]').errors[0]).toMatch(/pane's own/)
})

const PANE = { plugin: 'session-orchestration', component: 'Pane', requestId: 'coordinator' } as const
const PROPS = { title: 'Coordinator', isFocused: false, bodyColumns: 160, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} } as const
const NOW = Date.UTC(2026, 9, 13, 12, 0)
const ACT = ['11111111-aaaa', 'fix it', 'blocked', String(NOW / 1000 - 60), '', '0', 'Done.', '300000', '1000000', 'idle', 'background'].join('\t')
const STATUS = `PROJ-4157  Code Review    app#76 OPEN no-human-approval  | no-wt | sess:"fix it" blocked | Race to settle`

const press = async ($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1], key: string, exitCode: number, out: string, err = '') => {
  mock.clock(on, { now: NOW })
  const runs: string[][] = []
  const toasts: string[] = []
  on('ui.toast', async (_, e) => { toasts.push(String(e.text ?? e)); return { value: undefined } })
  on('process.run', async (_, e) => {
    const args = e.argv.slice(2)
    runs.push(args)
    const set = args[0] === '--set'
    const stdout = set ? out : args[0] === '--activity' ? ACT : args.length === 0 ? STATUS : ''
    return { value: { exitCode: set ? exitCode : 0, stdout, stderr: set ? err : '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  await $.tool.call({ tool: 'mcp__session-orchestration__open_pane' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS })
  await ui.press({ key: 'refresh' })
  await ui.press({ key: 'task-PROJ-4157' })
  await ui.press({ key })
  await ui.unmount()
  return { runs, toasts }
}

test('h (Up a rung) on a card runs session-status --set <id> --up --by pane and toasts the first line', async ($, on) => {
  const r = await press($, on, 'act-h', 0, '"rev" (22222222): model sonnet from its next request (live)\nmore\n')
  expect(r.runs).toContainEqual(['--set', '11111111-aaaa', '--up', '--by', 'pane'])
  expect(r.toasts).toContain('"rev" (22222222): model sonnet from its next request (live)')
})

test('a failure toasts its reason', async ($, on) => {
  const r = await press($, on, 'act-h', 3, '', 'busy')
  expect(r.toasts).toContain('Settings "fix it": busy')
})

test('v (Down a rung) runs --down; a failure with no output toasts the exit code', async ($, on) => {
  const r = await press($, on, 'act-v', 4, '')
  expect(r.runs).toContainEqual(['--set', '11111111-aaaa', '--down', '--by', 'pane'])
  expect(r.toasts).toContain('Settings "fix it": exit 4')
})
