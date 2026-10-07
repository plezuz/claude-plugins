import { ago, label, tokens, until } from './shared'
import type { ViewInput } from './shared'

// The Gray view: our own band, changed freely. One line of plain gray text, no colors, emoji
// or bars. Within one item the parts are joined by a space ("W 95% 1d 4h"); separate items are
// joined by " · ". No folder (the app shows it), no agent rows, no last turn, no context (the
// app's own circle shows it).

const SEP = ' · '
// Short names for the plan limits ("5h 27% 2h 17m · W 95% 1d 4h").
const SHORT: Record<string, string> = { five_hour: '5h', seven_day: 'W' }

export function grayView({ ui, e, snap, turn, compactions: c, spent: s, cacheTtlMs, menu }: ViewInput) {
  const { Box, Text } = ui

  // Left: the most interesting first, so a narrow window cuts the least interesting end.
  const left: string[] = []
  for (const l of snap.limits) {
    left.push(`${SHORT[l.kind] ?? label(l.kind)} ${l.percent}%${l.resetsAt ? ` ${until(l.resetsAt, snap.at)}` : ''}`)
  }
  if (snap.changed) left.push(`${snap.changed} changed`)
  left.push(`${snap.prompts} prompt${snap.prompts === 1 ? '' : 's'}`)
  if (snap.costUsd !== null) left.push(`$${snap.costUsd.toFixed(2)}`)
  if (s !== null && s.since === snap.startedAt) left.push(`${tokens(s.tokens)} tokens`)
  const hasTurn = turn !== null && turn.at >= snap.startedAt
  let cache = ''
  if (hasTurn) {
    const leftMs = cacheTtlMs - Math.max(0, snap.at - turn.at)
    if (turn.cacheHit !== null) left.push(`hit ${turn.cacheHit}%`)
    if (e.props.isWorking) cache = 'cache live'
    else if (leftMs <= 0) cache = 'cache cold'
    else cache = `cache ${leftMs < 60_000 ? '<1m' : `${Math.floor(leftMs / 60_000)}m`} left`
  }
  if (c !== null && c.since === snap.startedAt) {
    const sizes = c.before === null || c.after === null ? '' : ` (last ${tokens(c.before)}→${tokens(c.after)})`
    left.push(`compacted ${c.count}×${sizes}`)
  }

  // Right, never cut: the session time, then the cache time left by ☰ at the far right.
  const right = [`session ${ago(snap.at - snap.startedAt)}`]
  if (cache !== '') right.push(cache)

  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%">
      <Box flexShrink={1}>
        <Text dimColor wrap="truncate-end">{left.join(SEP)}</Text>
      </Box>
      <Box flexDirection="row" marginLeft={1} columnGap={1} flexShrink={0}>
        <Text dimColor>{right.join(SEP)}</Text>
        {menu}
      </Box>
    </Box>
  )
}
