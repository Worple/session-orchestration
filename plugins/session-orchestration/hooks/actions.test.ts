import { expect, mock, test } from 'claude-code/testing'

import { paneActions, parseActions, parseFix, parseStatus } from './register'

const PANE = { plugin: 'session-orchestration', component: 'Pane', requestId: 'coordinator' } as const
const PROPS = { title: 'Coordinator', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } as const

test('the actions file loads its good entries and names each bad one', () => {
  expect(parseActions('[{"label":"Sign in","hotkey":"i","command":"gh auth login","when":"! gh auth status"}]'))
    .toEqual({ list: [{ label: 'Sign in', hotkey: 'i', command: 'gh auth login', when: '! gh auth status' }], errors: [] })
  expect(parseActions('{').errors[0]).toMatch(/^\.claude\/coordinator-actions\.json: not JSON/)
  expect(parseActions('{"label":"x"}').errors).toEqual(['.claude/coordinator-actions.json: not a list of actions'])
  const { list, errors } = parseActions(JSON.stringify([
    { label: 'Ok', hotkey: 'i', command: 'true' },
    { label: 'Ask clash', hotkey: 'k', command: 'true' },
    { label: 'Dup', hotkey: 'i', command: 'true' },
    { label: 'Digit', hotkey: '1', command: 'true' },
    { label: 'No command', hotkey: 'j' },
    { label: 'Typo', hotkey: 'q', command: 'true', When: 'false' },
    'junk',
  ]))
  expect(list.map(a => a.label)).toEqual(['Ok'])
  expect(errors).toEqual([
    '.claude/coordinator-actions.json #2 "Ask clash": hotkey "k" is the pane\'s own (Ask)',
    '.claude/coordinator-actions.json #3 "Dup": hotkey "i" is taken by "Ok"',
    '.claude/coordinator-actions.json #4 "Digit": hotkey must be one lowercase letter',
    '.claude/coordinator-actions.json #5 "No command": command must be a non-empty string',
    '.claude/coordinator-actions.json #6 "Typo": unknown field "When"',
    '.claude/coordinator-actions.json #7: not an object with label, hotkey, command',
  ])
})

test('fix lines: only at the start of a line, deduped against the file, given a free hotkey', () => {
  const st = parseStatus('PROJ-1    Open           no-wt | sess:—\nfix: Sign in → gh auth login\nfix: oops\n\nNotices:\n  * fix: Pwn → rm -rf ~')
  expect(st.fixes).toEqual(['fix: Sign in → gh auth login', 'fix: oops']) // the notice is someone else's words
  expect(st.other).toEqual([])
  expect(parseFix('fix: Re-login -> npx cli login')).toEqual({ label: 'Re-login', command: 'npx cli login' })
  const { list, errors } = paneActions([{ label: 'Sign in', hotkey: 'g', command: 'gh auth login' }], [...st.fixes, 'fix: Kick auth → login'])
  expect(list).toEqual([
    { label: 'Sign in', hotkey: 'g', command: 'gh auth login' }, // the file's, not the fix line's
    { label: 'Kick auth', hotkey: 'i', command: 'login' }, // k is Ask's
  ])
  expect(errors).toEqual(['bad fix line (want "fix: LABEL → COMMAND"): fix: oops'])
})

test('an action shows while its when passes and the fix line is there; pressing runs it in the root, then refreshes', async ($, on) => {
  mock.clock(on)
  on('session.id', async () => ({ value: 'sess-c' }))
  let signedOut = true
  on('process.run', async (_, e) => {
    const arg = e.argv[2] ?? ''
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[1] === '-c') {
      if (arg === '! gh auth status') return out('', signedOut ? 0 : 1)
    }
    if (arg === '--root') return out('/proj\n')
    if (arg === '--pending' || arg === '--urls' || arg === '--agents') return out('')
    return out(signedOut ? 'Tracker search failed (signed out? try: gh auth login):\n  timeout\nfix: Sign in → gh auth login\nfix: Broken → false-cmd\nfix: Denied → denied-cmd' : 'PROJ-1    Open           no-wt | sess:—')
  })
  on('fs.exists', async (_, e) => ({ value: e.path === '/proj/.claude/coordinator-actions.json' }))
  on('fs.read', async () => ({ value: JSON.stringify([
    { label: 'Sign in', hotkey: 'i', command: 'gh auth login', when: '! gh auth status' },
    { label: 'Bad', hotkey: 'r', command: 'x' },
  ]) }))
  const prompts: string[] = []
  on('prompt.submit', async (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  // A press runs through the Bash tool with the press as consent: a raw process.run is refused as a repeat of a denied call.
  const calls: { command: string; consent?: string }[] = []
  on('tool.call', { tool: 'Bash' }, async (_, e) => {
    calls.push({ command: e.command, consent: (e as { consent?: string }).consent })
    if (e.command.endsWith('\ngh auth login\n})')) {
      signedOut = false
      return { result: { stdout: 'waiting\nconnected', stderr: '', interrupted: false }, text: 'waiting\nconnected' }
    }
    if (e.command.endsWith('\ndenied-cmd\n})')) return { deny: 'Permission to use Bash has been denied.' }
    return { result: { stdout: 'nope', stderr: '', interrupted: false }, text: 'nope\nExit code 3', isError: true }
  })

  await $.tool.call({ tool: 'mcp__session-orchestration__open_pane' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: PROPS })
  await ui.press({ key: 'refresh' })
  expect((await ui.find({ type: 'Button', key: 'sec-Actions' }))?.text).toMatch(/ACTIONS 3 /)
  expect(await ui.find({ type: 'Button', key: 'action-Sign in' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /hotkey "r" is the pane's own \(Refresh\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^fix:/ })).toBeUndefined() // shown as actions, not as warnings

  await ui.press({ key: 'action-Broken' })
  expect(await ui.find({ type: 'Text', text: /✗ Broken/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /nope \| Exit code 3/ })).toBeDefined()

  await ui.press({ key: 'action-Denied' })
  expect(await ui.find({ type: 'Text', text: /refused: Permission to use Bash has been denied/ })).toBeDefined()
  // Not the user's own No: the coordinator makes the call itself, where its permission prompt can ask.
  expect(prompts.at(-1)).toMatch(/project action, and the pane's own call was refused: .*Make that Bash call yourself now, this exact command, so your permission prompt asks the user: \(cd '\/proj' && \{\ndenied-cmd\n\}\)$/s)

  await ui.press({ key: 'action-Sign in' })
  expect(calls.at(-1)).toEqual({ command: "(cd '/proj' && {\ngh auth login\n})",
    consent: "The user pressed a project action in the coordinator pane that runs this exact command: (cd '/proj' && {\ngh auth login\n})" })
  expect(await ui.find({ type: 'Text', text: /✓ Sign in/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /connected/ })).toBeDefined()
  // The refresh after it: Sign in, so neither the file's when nor a fix line offers it.
  expect(await ui.find({ type: 'Button', key: 'action-Sign in' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'action-Broken' })).toBeUndefined()
  await ui.unmount()
})
