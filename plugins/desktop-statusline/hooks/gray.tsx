import { ago, elapsed, label, tokens, until } from './shared'
import type { ViewInput } from './shared'

// The Gray view: a full copy of the Original view to change freely. No colors, no emoji, no
// bars (each meter is its percent alone), cache time left instead of idle time, and the
// session's tokens beside its cost.

const LABEL_CELLS = 8
const PERCENT_CELLS = 5
const DETAIL_GAP = 2
const METER_GAP = 3
const AGENT_ROWS = 3

export function grayView({ ui, e, snap, turn, compactions: c, spent: s, cacheTtlMs, menu }: ViewInput) {
  const { Box, Text } = ui

  const meter = (name: string, percent: number | null, detail: string) => (
    <Box flexDirection="row" alignItems="center">
      <Box width={LABEL_CELLS} flexShrink={0}>
        <Text dimColor>{name}</Text>
      </Box>
      {percent === null ? (
        <Text dimColor>{'waiting for first response'}</Text>
      ) : (
        <Box width={PERCENT_CELLS} justifyContent="flex-end" flexShrink={0}>
          <Text dimColor>{`${percent}%`}</Text>
        </Box>
      )}
      {detail !== '' && (
        <Box marginLeft={DETAIL_GAP} flexShrink={0}>
          <Text dimColor>{detail}</Text>
        </Box>
      )}
    </Box>
  )

  const details = snap.limits.map(l => (l.resetsAt ? `resets in ${until(l.resetsAt, snap.at)}` : ''))
  const used = snap.contextTokens === null ? '' : `${tokens(snap.contextTokens)} / ${tokens(snap.contextWindow)}`

  const where =
    `${snap.dir}` +
    (snap.branch === null ? '' : `   ${snap.branch}${snap.isWorktree ? ' (worktree)' : ''}`) +
    `${snap.ahead ? ` ↑${snap.ahead}` : ''}${snap.behind ? ` ↓${snap.behind}` : ''}` +
    `${snap.changed ? `   ${snap.changed} changed` : ''}`
  const session =
    `session ${ago(snap.at - snap.startedAt)} · ${snap.prompts} prompt${snap.prompts === 1 ? '' : 's'}` +
    (snap.costUsd === null ? '' : ` · $${snap.costUsd.toFixed(2)}`) +
    (s === null || s.since !== snap.startedAt ? '' : ` · ${tokens(s.tokens)} tokens`)

  const activity: string[] = []
  if (turn !== null && turn.at >= snap.startedAt) {
    const leftMs = cacheTtlMs - Math.max(0, snap.at - turn.at)
    activity.push(`Last turn ${elapsed(turn.durationMs)}${turn.model ? ` on ${turn.model}` : ''}`)
    if (turn.cacheHit !== null) activity.push(`hit ${turn.cacheHit}%`)
    if (e.props.isWorking) activity.push('cache live')
    else if (leftMs <= 0) activity.push('cache cold')
    else activity.push(`cache ${leftMs < 60_000 ? '<1m' : `${Math.floor(leftMs / 60_000)}m`} left`)
  }
  if (c !== null && c.since === snap.startedAt) {
    const sizes = c.before === null || c.after === null ? '' : ` (last ${tokens(c.before)} → ${tokens(c.after)})`
    activity.push(`compacted ${c.count}×${sizes}`)
  }
  const agentRows = snap.agents.slice(0, AGENT_ROWS)
  const moreAgents = snap.agents.length - agentRows.length

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" width="100%">
        <Text dimColor wrap="truncate-end">{where}</Text>
        <Box marginLeft={2} flexShrink={0}>
          <Text dimColor>{session}</Text>
        </Box>
        <Box marginLeft={2} flexShrink={0}>
          {menu}
        </Box>
      </Box>
      <Box flexDirection="row" columnGap={METER_GAP}>
        {meter('Context', snap.contextPercent, used)}
        {snap.limits.map((l, i) => meter(label(l.kind), l.percent, details[i] ?? ''))}
      </Box>
      {activity.length > 0 && (
        <Text dimColor wrap="truncate-end">
          {activity.join(' · ')}
        </Text>
      )}
      {agentRows.map(a => (
        <Box flexDirection="row" justifyContent="space-between" width="100%">
          <Text dimColor wrap="truncate-end">{`▸ ${a.description || a.type}`}</Text>
          <Box marginLeft={2} flexShrink={0}>
            <Text dimColor>{a.type.split(':').pop()}</Text>
          </Box>
        </Box>
      ))}
      {moreAgents > 0 && <Text dimColor>{`   +${moreAgents} more agent${moreAgents > 1 ? 's' : ''} running`}</Text>}
    </Box>
  )
}
