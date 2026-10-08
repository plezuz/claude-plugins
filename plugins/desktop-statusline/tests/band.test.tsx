import { test, expect, mock } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const T0 = 1_800_000_000_000

const USAGE = {
  model: 'claude-opus-5-5',
  input_tokens: 1_000,
  output_tokens: 500,
  cache_read_input_tokens: 99_000,
  cache_creation_input_tokens: 0,
}

const FIVE_HOUR = [{ kind: 'five_hour', percentUsed: 42, resetsAt: new Date(T0 + 3 * 3_600_000).toISOString() }]

const engine = (on: On, saved: Record<string, unknown>, rateLimits: unknown[] = FIVE_HOUR) => {
  const clock = mock.clock(on)
  mock.store(on, saved)
  on('session.usage', () => ({
    value: {
      startedAt: T0,
      context: { percent: 10, tokens: 20_000, window: 200_000 },
      rateLimits,
      cost: { usd: 0.4 },
    },
  }))
  on('session.surfaces', () => ({ value: ['desktop'] as const }))
  on('session.id', () => ({ value: 's1' }))
  on('session.turns', () => ({ value: 3 }))
  on('session.cwd', () => ({ value: 'C:\\work\\proj' }))
  on('agent.list', () => ({ value: [] }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer, usage: e.usage }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'tool_use' as const, usage: USAGE }
  })
  on('ui.render', () => null as never)
  return clock
}

const start = async ($: Engine, on: On, saved: Record<string, unknown> = {}) => {
  const clock = engine(on, saved)
  await clock.set(T0)
  await $.session.start({ cwd: '/work/proj', surface: 'desktop', isInteractive: true })
  await $.turn.complete({
    answer: 'ok',
    durationMs: 1200,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: {
      model: 'claude-opus-5-5',
      input_tokens: 1_000,
      output_tokens: 9_000,
      cache_read_input_tokens: 930_000,
      cache_creation_input_tokens: 60_000,
    },
  })
  await clock.advance(11 * 60_000 + 30_000)
  return clock
}

// One model request of the main conversation, read to its end.
const step = async ($: Engine, index: number) => {
  const stream = $.turn.step({ turnId: 't2', index, model: 'claude-opus-5-5', messageCount: 3 + index })
  for await (const _ of stream);
  return stream.result
}

const band = ($: Engine, isWorking = false) =>
  $.ui.mount({
    plugin: 'plezuz-statusline',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 120, scroll: undefined as never, view: undefined as never },
  })

test('Gray is the default: one dotted line, percent only, no bars', async ($, on) => {
  await start($, on)
  const ui = await band($)
  expect(await ui.find({ text: /^5h 42% 2h 49m · 3 prompts · \$0\.40 · 1M tokens · hit 94% · session 11m$/ })).toBeDefined()
  expect(await ui.find({ text: 'cache 49m left' })).toBeDefined()
  expect(await ui.find({ text: /proj|last turn/ })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
})

test('the ≡ menu switches to Original, which keeps its bars', async ($, on) => {
  await start($, on)
  const ui = await band($)
  expect(await ui.find({ key: 'view-original' })).toBeUndefined()
  await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'menu' })
  await ui.pointer({ type: 'up', x: 0, y: 0, button: 'left', in: 'menu' })
  await ui.press({ key: 'view-original' })
  expect(await ui.find({ key: 'view-original' })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ text: /idle 11m/ })).toBeDefined()
})

test('a saved choice is used at the next session start', async ($, on) => {
  await start($, on, { view: 'original' })
  const ui = await band($)
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
})

test('past the cache time Gray shows a red cache expired', async ($, on) => {
  const clock = await start($, on)
  await clock.advance(50 * 60_000)
  const ui = await band($)
  expect(await ui.find({ text: '🟥 cache expired' })).toBeDefined()
  expect(await ui.find({ text: /cache .*left/ })).toBeUndefined()
})

test('the cache time is remembered after a restart of the app', async ($, on) => {
  const clock = engine(on, { 'turn:s1': { at: T0, durationMs: 1, model: null, cacheHit: 90 } })
  await clock.set(T0 + 11 * 60_000 + 30_000)
  await $.session.start({ cwd: '/work/proj', surface: 'desktop', isInteractive: true })
  const ui = await band($)
  expect(await ui.find({ text: 'cache 48m left' })).toBeDefined()
})

test('mid-turn, an hour after the last model request Gray shows red', async ($, on) => {
  const clock = await start($, on)
  await step($, 0)
  await clock.advance(61 * 60_000)
  const ui = await band($, true)
  expect(await ui.find({ text: '🟥 cache expired' })).toBeDefined()
  expect(await ui.find({ text: /cache live|cache .*left/ })).toBeUndefined()
})

test('while the first turn still runs Gray shows the cache time left', async ($, on) => {
  const clock = engine(on, {})
  await clock.set(T0)
  await $.session.start({ cwd: '/work/proj', surface: 'desktop', isInteractive: true })
  await step($, 0)
  await clock.advance(10 * 60_000)
  const ui = await band($, true)
  expect(await ui.find({ text: 'cache 50m left' })).toBeDefined()
  expect(await ui.find({ text: /hit 99%/ })).toBeDefined()
})

test('without a reading Gray shows the last limits seen, with their age', async ($, on) => {
  const old = {
    at: T0 - 20 * 60_000,
    limits: [
      { kind: 'five_hour', percent: 27, resetsAt: new Date(T0 + 2 * 3_600_000).toISOString() },
      { kind: 'seven_day', percent: 95, resetsAt: new Date(T0 + 28 * 3_600_000).toISOString() },
      { kind: 'spend_limit', percent: 10, resetsAt: new Date(T0 - 60_000).toISOString() },
    ],
  }
  const clock = engine(on, { limits: old }, [])
  await clock.set(T0)
  await $.session.start({ cwd: '/work/proj', surface: 'desktop', isInteractive: true })
  const ui = await band($)
  expect(await ui.find({ text: /^5h 27% 2h 0m · w 95% 1d 4h · limits 20m ago · 3 prompts/ })).toBeDefined()
  expect(await ui.find({ text: /spend/ })).toBeUndefined()
})

test('a fresh reading wins over an older saved one and has no age', async ($, on) => {
  await start($, on, { limits: { at: T0 - 60_000, limits: [{ kind: 'seven_day', percent: 95, resetsAt: null }] } })
  const ui = await band($)
  expect(await ui.find({ text: /^5h 42% 2h 49m · 3 prompts/ })).toBeDefined()
  expect(await ui.find({ text: /ago|w 95%/ })).toBeUndefined()
})
