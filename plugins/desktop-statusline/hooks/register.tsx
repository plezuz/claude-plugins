import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Limit, Snapshot, View } from '../types'
import { grayView } from './gray'
import { originalView } from './original'
import { label, until } from './shared'

const snapshot = atom({ plugin: 'plezuz-statusline', key: 'snap' } as const, null)
const warned = atom({ plugin: 'plezuz-statusline', key: 'warned' } as const, [])
const lastTurn = atom({ plugin: 'plezuz-statusline', key: 'lastTurn' } as const, null)
const compactions = atom({ plugin: 'plezuz-statusline', key: 'compactions' } as const, null)
const spent = atom({ plugin: 'plezuz-statusline', key: 'spent' } as const, null)
const view = atom({ plugin: 'plezuz-statusline', key: 'view' } as const, 'gray')
const menuOpen = atom({ plugin: 'plezuz-statusline', key: 'menuOpen' } as const, false)

const REFRESH_MS = 60_000
const WARN_AT = [95, 80]
const VIEWS: { name: View; title: string }[] = [
  { name: 'original', title: 'Original' },
  { name: 'gray', title: 'Gray' },
]

const cacheHit = (u: ModelUsage) => {
  const input = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
  return input === 0 ? null : Math.round((u.cache_read_input_tokens / input) * 100)
}

// Every token a request processed: fresh input, cache writes, cache reads and output.
const processed = (u: ModelUsage) =>
  u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

const isOnDesktop = async ($: EngineInterface) => (await $.session.surfaces()).includes('desktop')

const git = async ($: EngineInterface, cwd: string, args: string[]) => {
  try {
    const ran = await $.process.run(['git', ...args], { cwd, timeoutMs: 5000 })
    return ran.exitCode === 0 ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

const warn = async ($: EngineInterface, limits: Limit[], now: number) => {
  const seen = await read($, warned)
  const fresh: string[] = []

  for (const limit of limits) {
    const threshold = WARN_AT.find(t => limit.percent >= t)
    const key = `${limit.kind}@${threshold}@${limit.resetsAt}`
    if (threshold === undefined || seen.includes(key)) continue

    fresh.push(key)
    const resets = limit.resetsAt ? ` · resets in ${until(limit.resetsAt, now)}` : ''
    $.ui.toast(`${label(limit.kind)} usage limit at ${limit.percent}%${resets}`, { timeoutMs: 8000 })
  }

  if (fresh.length > 0) await update($, warned, s => [...s, ...fresh].slice(-50))
}

const refresh = async ($: EngineInterface) => {
  if (!(await isOnDesktop($))) return

  const [usage, cwd, now, agents, prompts] = await Promise.all([
    $.session.usage(),
    $.session.cwd(),
    $.clock.now(),
    $.agent.list(),
    $.session.turns(),
  ])
  const [status, dirs] = await Promise.all([
    git($, cwd, ['status', '--porcelain=v2', '--branch']),
    git($, cwd, ['rev-parse', '--git-dir', '--git-common-dir']),
  ])

  const lines = status?.split('\n') ?? []
  const head = lines.find(l => l.startsWith('# branch.head '))?.slice(14)
  const ab = lines.find(l => l.startsWith('# branch.ab '))?.match(/\+(\d+) -(\d+)/)
  const [gitDir, commonDir] = dirs?.split('\n') ?? []
  const limits = usage.rateLimits.map(r => ({
    kind: r.kind,
    percent: r.percentUsed,
    resetsAt: r.resetsAt ?? null,
  }))

  const snap: Snapshot = {
    at: now,
    startedAt: usage.startedAt,
    prompts,
    dir: cwd.split('/').pop() || cwd,
    branch: head && head !== '(detached)' ? head : null,
    isWorktree: gitDir !== commonDir,
    ahead: Number(ab?.[1] ?? 0),
    behind: Number(ab?.[2] ?? 0),
    changed: lines.filter(l => l && !l.startsWith('#')).length,
    contextPercent: usage.context.percent ?? null,
    contextTokens: usage.context.tokens ?? null,
    contextWindow: usage.context.window,
    costUsd: usage.cost?.usd ?? null,
    limits,
    agents: agents
      .filter(a => a.status === 'running')
      .map(a => ({ type: a.type, description: a.description })),
  }

  await update($, snapshot, () => snap)
  await warn($, limits, now)
}

// The view picked in the ☰ menu is kept across sessions.
async function loadView($: EngineInterface) {
  const saved = await $.store.get('view')
  if (saved === 'original' || saved === 'gray') await update($, view, () => saved)
}

async function chooseView($: EngineInterface, name: View) {
  await update($, view, () => name)
  await update($, menuOpen, () => false)
  await $.store.set('view', name)
}

export const register: Register = (on, options) => {
  // The main conversation's prompt-cache TTL (the `cache_ttl` option): 1 hour on a Claude
  // subscription within plan usage, 5 minutes with an API key, a cloud provider or usage credits.
  const cacheTtlMs = options.cache_ttl === '5m' ? 5 * 60_000 : 60 * 60_000

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await loadView($)
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))

    return started
  })

  on('session.attach', { surface: 'desktop' }, async ($, e, next) => {
    const attached = await next(e)
    await loadView($)
    await refresh($)

    return attached
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    await refresh($)

    return measured
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    // Tokens count every turn, subagents' included: they are spent all the same.
    if (e.usage) {
      const { startedAt } = await $.session.usage()
      const turnTokens = processed(e.usage)
      await update($, spent, s => ({ since: startedAt, tokens: (s?.since === startedAt ? s.tokens : 0) + turnTokens }))
    }
    if (!e.agentId) {
      const at = await $.clock.now()
      await update($, lastTurn, () => ({
        at,
        durationMs: e.durationMs,
        model: e.usage?.model ?? null,
        cacheHit: e.usage ? cacheHit(e.usage) : null,
      }))
    }
    await refresh($)

    return completed
  })

  // A spawned agent shows as running only once it has started; look again shortly after.
  on('tool.call', { tool: 'Agent' }, ($, e, next) => {
    $.clock.after(2000, () => void refresh($))

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.trigger === 'precompute' || e.agentId || result.messages === undefined) return result

    const { startedAt } = await $.session.usage()
    await update($, compactions, c => ({
      since: startedAt,
      count: (c?.since === startedAt ? c.count : 0) + 1,
      before: result.tokensBefore ?? null,
      after: result.tokensAfter ?? null,
    }))

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)

    const snap = await read($, snapshot)
    if (snap === null) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const current = await read($, view)
    const isOpen = await read($, menuOpen)
    const menu = (
      // Gray at rest; "≡" is a plain text glyph (☰ can come out as a black emoji on Windows).
      <Button key="menu" plain dimColor variant="secondary" onPress={() => update($, menuOpen, o => !o)}>
        {'≡'}
      </Button>
    )
    const input = {
      ui,
      e,
      snap,
      turn: await read($, lastTurn),
      compactions: await read($, compactions),
      spent: await read($, spent),
      cacheTtlMs,
      menu,
    }
    const band = current === 'gray' ? grayView(input) : originalView(input)

    return (
      <Box flexDirection="column">
        {isOpen && (
          <Box flexDirection="row" columnGap={2}>
            <Text dimColor>{'View:'}</Text>
            {VIEWS.map(v => (
              <Button key={`view-${v.name}`} plain dimColor variant="secondary" onPress={() => chooseView($, v.name)}>
                {`${v.name === current ? '●' : '○'} ${v.title}`}
              </Button>
            ))}
          </Box>
        )}
        {band}
      </Box>
    )
  })
}
