import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const T0 = 1_800_000_000_000

const engine = (on: On) => {
  const clock = mock.clock(on)
  on('session.usage', () => ({
    value: {
      startedAt: T0,
      context: { percent: 10, tokens: 20_000, window: 200_000 },
      rateLimits: [],
      cost: { usd: 0.4 },
    },
  }))
  on('session.surfaces', () => ({ value: ['desktop'] as const }))
  on('session.turns', () => ({ value: 3 }))
  on('session.cwd', () => ({ value: '/work/proj' }))
  on('agent.list', () => ({ value: [] }))
  // Stands in for the original desktop-statusline band beneath this plugin.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{'original band'}</Text>
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer, usage: e.usage }))
  return clock
}

const turn = ($: Engine, agentId?: string) =>
  $.turn.complete({
    answer: 'ok',
    durationMs: 1200,
    isAborted: false,
    turnId: `t${agentId ?? ''}`,
    reason: 'answer',
    ...(agentId ? { agentId } : {}),
    usage: {
      model: 'claude-opus-5-5',
      input_tokens: 1_000,
      output_tokens: 9_000,
      cache_read_input_tokens: 930_000,
      cache_creation_input_tokens: 60_000,
    },
  })

const band = ($: Engine, isWorking = false) =>
  $.ui.mount({
    plugin: 'plezuz-statusline',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 120, scroll: undefined as never, view: undefined as never },
  })

test('compact line: cost, tokens, cache time left and hit rate', async ($, on) => {
  const clock = engine(on)
  await clock.set(T0)
  await $.session.start({ cwd: '/work/proj', surface: 'desktop', isInteractive: true })
  await turn($)
  await turn($, 'agent-1')
  await clock.advance(11 * 60_000 + 30_000)

  const ui = await band($)
  expect((await ui.find({ text: '$0.40' }))).toBeDefined()
  expect((await ui.find({ text: '2M tokens' }))).toBeDefined()
  expect((await ui.find({ text: 'cache 49m left' }))).toBeDefined()
  expect((await ui.find({ text: 'hit 94%' }))).toBeDefined()
  expect((await ui.find({ text: /📁|Context/ }))).toBeUndefined()
  expect((await ui.find({ text: 'original band' }))).toBeDefined()
})

test('cache turns cold after the TTL', async ($, on) => {
  const clock = engine(on)
  await clock.set(T0)
  await $.session.start({ cwd: '/work/proj', surface: 'desktop', isInteractive: true })
  await turn($)
  await clock.advance(61 * 60_000)

  const ui = await band($)
  expect((await ui.find({ text: 'cache cold' }))).toBeDefined()
})

test('5m TTL and the full profile switched back on', { options: { cache_ttl: '5m', show_location: true, show_context: true } }, async ($, on) => {
  const clock = engine(on)
  await clock.set(T0)
  await $.session.start({ cwd: '/work/proj', surface: 'desktop', isInteractive: true })
  await turn($)
  await clock.advance(2 * 60_000)

  const ui = await band($)
  expect((await ui.find({ text: 'cache 3m left' }))).toBeDefined()
  expect((await ui.find({ text: /📁 proj/ }))).toBeDefined()
  expect((await ui.find({ text: 'Context' }))).toBeDefined()
})
