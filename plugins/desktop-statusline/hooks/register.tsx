import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Limit, Snapshot } from '../types'

const snapshot = atom({ plugin: 'desktop-statusline', key: 'snap' } as const, null)
const warned = atom({ plugin: 'desktop-statusline', key: 'warned' } as const, [])
const lastTurn = atom({ plugin: 'desktop-statusline', key: 'lastTurn' } as const, null)
const compactions = atom({ plugin: 'desktop-statusline', key: 'compactions' } as const, null)
const spent = atom({ plugin: 'desktop-statusline', key: 'spent' } as const, null)

const REFRESH_MS = 60_000
const WARN_AT = [95, 80]
const LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly' }
const LABEL_CELLS = 8
const PERCENT_CELLS = 5
const DETAIL_GAP = 2
const METER_GAP = 3
const AGENT_ROWS = 3
// Desktop metrics in CSS px, measured from screenshots of the band: a Box `width` cell, one
// column of `bodyColumns`, and an average glyph of the band's proportional font. Bars are SVG
// in px, so the limits row is fitted in px, keeping 5% spare for the estimate.
const CELL_PX = 15
const COL_PX = 12.5
const CHAR_PX = 13
const SPARE = 0.95
const MIN_BAR_PX = 60
const MAX_BAR_PX = 180

const label = (kind: string) => LABELS[kind] ?? kind.replace(/_/g, ' ')
const tone = (percent: number) => (percent >= 95 ? 'error' : percent >= 80 ? 'warning' : undefined)

const tokens = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

// Drawn as an image, so it cannot follow the theme: a translucent track reads on light and dark.
const bar = (percent: number, width: number) => {
  const fill = percent >= 95 ? '#e5484d' : percent >= 80 ? '#e0a030' : '#2f7de1'
  const filled = Math.round((Math.min(percent, 100) / 100) * width)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="8" viewBox="0 0 ${width} 8">` +
    `<rect width="${width}" height="8" rx="4" fill="#808080" fill-opacity="0.3"/>` +
    `<rect width="${filled}" height="8" rx="4" fill="${fill}"/></svg>`
  )
}

const until = (iso: string, now: number) => {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
}

const elapsed = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

const ago = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
}

const cacheHit = (u: ModelUsage) => {
  const input = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens
  return input === 0 ? null : Math.round((u.cache_read_input_tokens / input) * 100)
}

// Every token a request processed: fresh input, cache writes, cache reads and output.
const processed = (u: ModelUsage) =>
  u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

// The `show_*` options. Each defaults to the compact profile: cost, tokens, cache time left and
// hit rate, limits and agents on; location, branch, session age, prompts, context and last turn off.
const SHOW_DEFAULTS = {
  show_location: false,
  show_branch: false,
  show_session_age: false,
  show_prompt_count: false,
  show_context: false,
  show_limits: true,
  show_cost: true,
  show_tokens: true,
  show_cache_hit: true,
  show_cache_remaining: true,
  show_last_turn: false,
  show_compactions: true,
  show_agents: true,
}
type Show = Record<keyof typeof SHOW_DEFAULTS, boolean>
const readShow = (options: Readonly<Record<string, unknown>>): Show => {
  const show = { ...SHOW_DEFAULTS }
  for (const key of Object.keys(show) as (keyof Show)[]) {
    const value = options[key]
    if (typeof value === 'boolean') show[key] = value
    else if (value === 'true' || value === 'false') show[key] = value === 'true'
  }
  return show
}

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

const refresh = async ($: EngineInterface, needsGit: boolean) => {
  if (!(await isOnDesktop($))) return

  const [usage, cwd, now, agents, prompts] = await Promise.all([
    $.session.usage(),
    $.session.cwd(),
    $.clock.now(),
    $.agent.list(),
    $.session.turns(),
  ])
  // Git runs only when the location or branch is shown.
  const [status, dirs] = needsGit
    ? await Promise.all([
        git($, cwd, ['status', '--porcelain=v2', '--branch']),
        git($, cwd, ['rev-parse', '--git-dir', '--git-common-dir']),
      ])
    : [null, null]

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

export const register: Register = (on, options) => {
  // The main conversation's prompt-cache TTL (the `cache_ttl` option): 1 hour on a Claude
  // subscription within plan usage, 5 minutes with an API key, a cloud provider or usage credits.
  const cacheTtlMs = options.cache_ttl === '5m' ? 5 * 60_000 : 60 * 60_000
  const show = readShow(options)
  const needsGit = show.show_location || show.show_branch

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refresh($, needsGit)
    $.clock.every(REFRESH_MS, () => void refresh($, needsGit))

    return started
  })

  on('session.attach', { surface: 'desktop' }, async ($, e, next) => {
    const attached = await next(e)
    await refresh($, needsGit)

    return attached
  })

  on('session.measure', async ($, e, next) => {
    const measured = await next(e)
    await refresh($, needsGit)

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
    await refresh($, needsGit)

    return completed
  })

  // A spawned agent shows as running only once it has started; look again shortly after.
  on('tool.call', { tool: 'Agent' }, ($, e, next) => {
    $.clock.after(2000, () => void refresh($, needsGit))

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

    const { Box, Svg, Text } = $.ui.resolve(e)

    const meter = (name: string, percent: number | null, detail: string, barPx: number) => (
      <Box flexDirection="row" alignItems="center">
        <Box width={LABEL_CELLS} flexShrink={0}>
          <Text>{name}</Text>
        </Box>
        {percent === null ? (
          <Text dimColor>{'waiting for first response'}</Text>
        ) : (
          <Box flexDirection="row" alignItems="center" flexShrink={0}>
            <Svg source={bar(percent, barPx)} alt={`${name} ${percent}% used`} width={barPx} height={8} />
            <Box width={PERCENT_CELLS} justifyContent="flex-end">
              <Text color={tone(percent)}>{`${percent}%`}</Text>
            </Box>
          </Box>
        )}
        <Box marginLeft={DETAIL_GAP} flexShrink={0}>
          <Text dimColor>{detail}</Text>
        </Box>
      </Box>
    )

    // Fit the limit meters on one row: try "resets in 2h 8m", then "↻ 2h 8m", and stack them
    // (the one case of 5 lines) only when even the short form leaves a bar under MIN_BAR_PX.
    const availPx = e.props.bodyColumns * COL_PX * SPARE
    const fixedPx = (LABEL_CELLS + PERCENT_CELLS + DETAIL_GAP) * CELL_PX
    const n = Math.max(1, snap.limits.length)
    const fit = (isLong: boolean) => {
      const details = snap.limits.map(l => (l.resetsAt ? `${isLong ? 'resets in ' : '↻ '}${until(l.resetsAt, snap.at)}` : ''))
      const textPx = details.reduce((sum, d) => sum + d.length * CHAR_PX, 0)
      const barPx = Math.floor((availPx - n * fixedPx - (n - 1) * METER_GAP * CELL_PX - textPx) / n)
      return { details, barPx: Math.min(MAX_BAR_PX, barPx) }
    }
    const long = fit(true)
    const { details, barPx: sharedBar } = long.barPx >= MIN_BAR_PX ? long : fit(false)
    const isStacked = sharedBar < MIN_BAR_PX
    const longestPx = Math.max(0, ...details.map(d => d.length * CHAR_PX))
    const limitBar = isStacked
      ? Math.max(40, Math.min(MAX_BAR_PX, Math.floor(availPx - fixedPx - longestPx)))
      : sharedBar
    const used = snap.contextTokens === null ? '' : `${tokens(snap.contextTokens)} / ${tokens(snap.contextWindow)}`
    const contextRoomPx = Math.floor(availPx - fixedPx - used.length * CHAR_PX)
    const contextBar = Math.max(40, Math.min(isStacked ? limitBar : 2 * limitBar, contextRoomPx))

    const where = [
      show.show_location ? `📁 ${snap.dir}` : '',
      show.show_branch && snap.branch !== null
        ? `🌿 ${snap.branch}${snap.isWorktree ? ' 🌳' : ''}` +
          `${snap.ahead ? ` ↑${snap.ahead}` : ''}${snap.behind ? ` ↓${snap.behind}` : ''}`
        : '',
      show.show_location && snap.changed ? `● ${snap.changed} changed` : '',
    ]
      .filter(Boolean)
      .join('   ')

    // The summary line's parts, in order: dim unless they need attention (warning).
    const parts: { text: string; emphasis?: 'warning' }[] = []
    if (show.show_session_age) parts.push({ text: `session ${ago(snap.at - snap.startedAt)}` })
    if (show.show_prompt_count) parts.push({ text: `${snap.prompts} prompt${snap.prompts === 1 ? '' : 's'}` })
    if (show.show_cost && snap.costUsd !== null) parts.push({ text: `$${snap.costUsd.toFixed(2)}` })
    const s = await read($, spent)
    if (show.show_tokens && s !== null && s.since === snap.startedAt) parts.push({ text: `${tokens(s.tokens)} tokens` })

    const turn = await read($, lastTurn)
    if (turn !== null && turn.at >= snap.startedAt) {
      // A running turn keeps the cache warm; otherwise it lives cache_ttl after the last turn.
      const leftMs = cacheTtlMs - Math.max(0, snap.at - turn.at)
      if (show.show_cache_remaining) {
        if (e.props.isWorking) parts.push({ text: 'cache live' })
        else if (leftMs <= 0) parts.push({ text: 'cache cold', emphasis: 'warning' })
        else {
          const minutes = Math.floor(leftMs / 60_000)
          parts.push({
            text: `cache ${minutes < 1 ? '<1m' : `${minutes}m`} left`,
            emphasis: leftMs <= cacheTtlMs / 10 ? 'warning' : undefined,
          })
        }
      }
      if (show.show_cache_hit && turn.cacheHit !== null) {
        parts.push({ text: `hit ${turn.cacheHit}%`, emphasis: turn.cacheHit < 50 ? 'warning' : undefined })
      }
      if (show.show_last_turn) {
        parts.push({ text: `last turn ${elapsed(turn.durationMs)}${turn.model ? ` on ${turn.model}` : ''}` })
      }
    }
    const c = await read($, compactions)
    if (show.show_compactions && c !== null && c.since === snap.startedAt) {
      const sizes = c.before === null || c.after === null ? '' : ` (last ${tokens(c.before)} → ${tokens(c.after)})`
      parts.push({ text: `compacted ${c.count}×${sizes}` })
    }
    // Running agents get rows of their own (description truncated, type kept).
    const agentRows = show.show_agents ? snap.agents.slice(0, AGENT_ROWS) : []
    const moreAgents = show.show_agents ? snap.agents.length - agentRows.length : 0
    const showLimits = show.show_limits && snap.limits.length > 0

    if (!where && parts.length === 0 && !show.show_context && !showLimits && agentRows.length === 0) return next(e)

    const summary = (
      <Box flexDirection="row" flexShrink={0}>
        {parts.map((p, i) => (
          <Box flexDirection="row">
            {i > 0 && <Text dimColor>{' · '}</Text>}
            <Text color={p.emphasis} dimColor={p.emphasis === undefined}>
              {p.text}
            </Text>
          </Box>
        ))}
      </Box>
    )

    return (
      <Box flexDirection="column">
        {where ? (
          <Box flexDirection="row" justifyContent="space-between" width="100%">
            <Text wrap="truncate-end">{where}</Text>
            {parts.length > 0 && <Box marginLeft={2}>{summary}</Box>}
          </Box>
        ) : (
          parts.length > 0 && summary
        )}
        {show.show_context && meter('Context', snap.contextPercent, used, contextBar)}
        {showLimits && (
          <Box flexDirection={isStacked ? 'column' : 'row'} columnGap={METER_GAP}>
            {snap.limits.map((l, i) => meter(label(l.kind), l.percent, details[i] ?? '', limitBar))}
          </Box>
        )}
        {agentRows.map(a => (
          <Box flexDirection="row" justifyContent="space-between" width="100%">
            <Text wrap="truncate-end">{`⏳ ${a.description || a.type}`}</Text>
            <Box marginLeft={2} flexShrink={0}>
              <Text dimColor>{a.type.split(':').pop()}</Text>
            </Box>
          </Box>
        ))}
        {moreAgents > 0 && <Text dimColor>{`   +${moreAgents} more agent${moreAgents > 1 ? 's' : ''} running`}</Text>}
      </Box>
    )
  })
}
