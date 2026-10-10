import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { RequestStat, SavedLimits, Snapshot, TurnStat, View } from '../types'
import { grayView } from './gray'
import { originalView } from './original'

const snapshot = atom({ plugin: 'plezuz-statusline', key: 'snap' } as const, null)
const lastTurn = atom({ plugin: 'plezuz-statusline', key: 'lastTurn' } as const, null)
const lastRequest = atom({ plugin: 'plezuz-statusline', key: 'lastRequest' } as const, null)
const compactions = atom({ plugin: 'plezuz-statusline', key: 'compactions' } as const, null)
const spent = atom({ plugin: 'plezuz-statusline', key: 'spent' } as const, null)
const view = atom({ plugin: 'plezuz-statusline', key: 'view' } as const, 'gray')
const menuOpen = atom({ plugin: 'plezuz-statusline', key: 'menuOpen' } as const, false)

const REFRESH_MS = 60_000
const LIMITS_KEY = 'limits'
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

// The store is a file on disk; one left broken (say, emptied by a crash) makes every call
// throw, writes included. Its values are conveniences, so the band goes on without them
// until the file is moved aside.
const storeGet = async ($: EngineInterface, key: string) => {
  try {
    return await $.store.get(key)
  } catch {
    return undefined
  }
}

const storeSet = async ($: EngineInterface, key: string, value: unknown) => {
  try {
    await $.store.set(key, value)
  } catch {}
}

const storeDelete = async ($: EngineInterface, key: string) => {
  try {
    await $.store.delete(key)
  } catch {}
}

const storeKeys = async ($: EngineInterface) => {
  try {
    return await $.store.keys()
  } catch {
    return []
  }
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
  // The app reports no limits before its first reading or when a window drops out; Gray then
  // shows the last limits seen, in any session, with their age.
  let saved = (await storeGet($, LIMITS_KEY)) as SavedLimits | undefined
  if (limits.length > 0) {
    saved = { at: now, limits }
    await storeSet($, LIMITS_KEY, saved)
  }

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
    savedLimits: saved ?? null,
    agents: agents
      .filter(a => a.status === 'running')
      .map(a => ({ type: a.type, description: a.description })),
  }

  await update($, snapshot, () => snap)
}

// The view picked in the ☰ menu is kept across sessions.
async function loadView($: EngineInterface) {
  const saved = await storeGet($, 'view')
  if (saved === 'original' || saved === 'gray') await update($, view, () => saved)
}

// The last main turn and the last main model request are also saved per session, so the cache
// time survives a restart of the app.
const TURN_KEY = 'turn:'
const REQUEST_KEY = 'request:'
const KEEP_SAVED_MS = 2 * 24 * 3_600_000

async function loadSaved($: EngineInterface) {
  const id = await $.session.id()
  if ((await read($, lastTurn)) === null) {
    const saved = await storeGet($, TURN_KEY + id)
    if (saved) await update($, lastTurn, () => saved as TurnStat)
  }
  if ((await read($, lastRequest)) === null) {
    const saved = await storeGet($, REQUEST_KEY + id)
    if (saved) await update($, lastRequest, () => saved as RequestStat)
  }
}

async function save($: EngineInterface, prefix: string, stat: { at: number }) {
  await storeSet($, prefix + (await $.session.id()), stat)
  for (const key of await storeKeys($)) {
    if (!key.startsWith(prefix)) continue
    const old = (await storeGet($, key)) as { at: number } | undefined
    if (!old || stat.at - old.at > KEEP_SAVED_MS) await storeDelete($, key)
  }
}

async function chooseView($: EngineInterface, name: View) {
  await update($, view, () => name)
  await update($, menuOpen, () => false)
  await storeSet($, 'view', name)
}

export const register: Register = (on, options) => {
  // The main conversation's prompt-cache TTL (the `cache_ttl` option): 1 hour on a Claude
  // subscription within plan usage, 5 minutes with an API key, a cloud provider or usage credits.
  const cacheTtlMs = options.cache_ttl === '5m' ? 5 * 60_000 : 60 * 60_000

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await loadView($)
    await loadSaved($)
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))

    return started
  })

  on('session.attach', { surface: 'desktop' }, async ($, e, next) => {
    const attached = await next(e)
    await loadView($)
    await loadSaved($)
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
      const stat: TurnStat = {
        at: await $.clock.now(),
        durationMs: e.durationMs,
        model: e.usage?.model ?? null,
        cacheHit: e.usage ? cacheHit(e.usage) : null,
      }
      await update($, lastTurn, () => stat)
      await save($, TURN_KEY, stat)
    }
    await refresh($)

    return completed
  })

  // Every model request of the main conversation reads and refreshes its prompt cache, so the
  // cache time counts from the last one, mid-turn too (subagents have caches of their own).
  on('turn.step', async function* ($, e, next) {
    const at = await $.clock.now()
    const result = yield* next(e)
    if (!e.agentId && result.usage) {
      const stat: RequestStat = { at, cacheHit: cacheHit(result.usage) }
      await update($, lastRequest, () => stat)
      await save($, REQUEST_KEY, stat)
    }

    return result
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

  // A click on the ≡ (menu-button.tsx) opens or closes the view menu.
  on('ui.message', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.data !== 'toggle') return next(e)
    await update($, menuOpen, o => !o)
    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'desktop' || e.props.hasSurvey) return next(e)

    const snap = await read($, snapshot)
    if (snap === null) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Client, Text } = ui
    const current = await read($, view)
    const isOpen = await read($, menuOpen)
    const menu = <Client key="menu" module="./menu-button.tsx" />
    const input = {
      ui,
      e,
      snap,
      turn: await read($, lastTurn),
      request: await read($, lastRequest),
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
              <Button key={`view-${v.name}`} plain onPress={() => chooseView($, v.name)}>
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
