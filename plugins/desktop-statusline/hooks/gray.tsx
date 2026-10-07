import { ago, elapsed, label, tokens, until } from './shared'
import type { ViewInput } from './shared'

// The Gray view: our own band, changed freely. Two lines of plain gray text, no colors, emoji
// or bars. Within one item the parts are joined by a space ("5-hour 24% resets in 2h 50m");
// separate items are joined by " · ".

const AGENT_ROWS = 3
const SEP = ' · '

export function grayView({ ui, e, snap, turn, compactions: c, spent: s, cacheTtlMs, menu }: ViewInput) {
  const { Box, Text } = ui

  // Line 1: where, the session, what it spent, and the cache.
  const first: string[] = []
  first.push(
    `${snap.dir}` +
      (snap.branch === null ? '' : ` ${snap.branch}${snap.isWorktree ? ' (worktree)' : ''}`) +
      `${snap.ahead ? ` ↑${snap.ahead}` : ''}${snap.behind ? ` ↓${snap.behind}` : ''}`,
  )
  if (snap.changed) first.push(`${snap.changed} changed`)
  first.push(`session ${ago(snap.at - snap.startedAt)}`)
  first.push(`${snap.prompts} prompt${snap.prompts === 1 ? '' : 's'}`)
  if (snap.costUsd !== null) first.push(`$${snap.costUsd.toFixed(2)}`)
  if (s !== null && s.since === snap.startedAt) first.push(`${tokens(s.tokens)} tokens`)
  const hasTurn = turn !== null && turn.at >= snap.startedAt
  if (hasTurn) {
    const leftMs = cacheTtlMs - Math.max(0, snap.at - turn.at)
    if (turn.cacheHit !== null) first.push(`hit ${turn.cacheHit}%`)
    if (e.props.isWorking) first.push('cache live')
    else if (leftMs <= 0) first.push('cache cold')
    else first.push(`cache ${leftMs < 60_000 ? '<1m' : `${Math.floor(leftMs / 60_000)}m`} left`)
  }

  // Line 2: the meters as percents, then the last turn and compactions.
  const second: string[] = []
  second.push(
    snap.contextPercent === null
      ? 'Context waiting for first response'
      : `Context ${snap.contextPercent}%` +
          (snap.contextTokens === null ? '' : ` ${tokens(snap.contextTokens)}/${tokens(snap.contextWindow)}`),
  )
  for (const l of snap.limits) {
    second.push(`${label(l.kind)} ${l.percent}%${l.resetsAt ? ` resets in ${until(l.resetsAt, snap.at)}` : ''}`)
  }
  if (hasTurn) {
    second.push(`last turn ${elapsed(turn.durationMs)}${turn.model ? ` on ${turn.model.replace(/^claude-/, '')}` : ''}`)
  }
  if (c !== null && c.since === snap.startedAt) {
    const sizes = c.before === null || c.after === null ? '' : ` (last ${tokens(c.before)}→${tokens(c.after)})`
    second.push(`compacted ${c.count}×${sizes}`)
  }

  const agentRows = snap.agents.slice(0, AGENT_ROWS)
  const moreAgents = snap.agents.length - agentRows.length

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" width="100%">
        <Text dimColor>{first.join(SEP)}</Text>
        <Box marginLeft={1} flexShrink={0}>
          {menu}
        </Box>
      </Box>
      <Text dimColor>{second.join(SEP)}</Text>
      {agentRows.map(a => (
        <Text dimColor wrap="truncate-end">{`▸ ${a.description || a.type} (${a.type.split(':').pop()})`}</Text>
      ))}
      {moreAgents > 0 && <Text dimColor>{`+${moreAgents} more agent${moreAgents > 1 ? 's' : ''} running`}</Text>}
    </Box>
  )
}
