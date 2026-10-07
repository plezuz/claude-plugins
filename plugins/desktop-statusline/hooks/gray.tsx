import { ago, elapsed, label, tokens, until } from './shared'
import type { ViewInput } from './shared'

// The Gray view: our own band, changed freely. Two lines of plain gray text, no colors, emoji
// or bars. Within one item the parts are joined by a space ("5-hour 24% resets in 2h 50m");
// separate items are joined by " · ".

const AGENT_ROWS = 3
const SEP = ' · '

export function grayView({ ui, e, snap, turn, compactions: c, spent: s, cacheTtlMs, menu }: ViewInput) {
  const { Box, Text } = ui

  // Line 1: where, the session and what it spent; the cache time left sits on the right, by ☰.
  const first: string[] = []
  // The last folder alone, on Windows paths too; no branch.
  first.push(snap.dir.split(/[\\/]/).filter(Boolean).pop() ?? snap.dir)
  if (snap.changed) first.push(`${snap.changed} changed`)
  first.push(`session ${ago(snap.at - snap.startedAt)}`)
  first.push(`${snap.prompts} prompt${snap.prompts === 1 ? '' : 's'}`)
  if (snap.costUsd !== null) first.push(`$${snap.costUsd.toFixed(2)}`)
  if (s !== null && s.since === snap.startedAt) first.push(`${tokens(s.tokens)} tokens`)
  const hasTurn = turn !== null && turn.at >= snap.startedAt
  let cache = ''
  if (hasTurn) {
    const leftMs = cacheTtlMs - Math.max(0, snap.at - turn.at)
    if (turn.cacheHit !== null) first.push(`hit ${turn.cacheHit}%`)
    if (e.props.isWorking) cache = 'cache live'
    else if (leftMs <= 0) cache = 'cache cold'
    else cache = `cache ${leftMs < 60_000 ? '<1m' : `${Math.floor(leftMs / 60_000)}m`} left`
  }

  // Line 2: the plan limits as percents, then the last turn and compactions. No context: the
  // app's own circle at the bottom right shows it.
  const second: string[] = []
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
        <Box flexDirection="row" marginLeft={1} columnGap={1} flexShrink={0}>
          {cache !== '' && <Text dimColor>{cache}</Text>}
          {menu}
        </Box>
      </Box>
      {second.length > 0 && <Text dimColor>{second.join(SEP)}</Text>}
      {agentRows.map(a => (
        <Text dimColor wrap="truncate-end">{`▸ ${a.description || a.type} (${a.type.split(':').pop()})`}</Text>
      ))}
      {moreAgents > 0 && <Text dimColor>{`+${moreAgents} more agent${moreAgents > 1 ? 's' : ''} running`}</Text>}
    </Box>
  )
}
