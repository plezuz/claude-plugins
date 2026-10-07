import { ago, label, tokens, until } from './shared'
import type { ViewInput } from './shared'

// The Gray view: our own band, changed freely. Two lines of plain gray text, no colors, emoji
// or bars. Within one item the parts are joined by a space ("W 95% 1d 4h");
// separate items are joined by " · ". No agent rows: the app lists running agents itself.

const SEP = ' · '
// Short names for the plan limits on line 2 ("5h 27% 2h 17m · W 95% 1d 4h").
const SHORT: Record<string, string> = { five_hour: '5h', seven_day: 'W' }

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

  // Line 2: the plan limits as percents, then compactions. No context: the app's own circle at
  // the bottom right shows it. No last turn either.
  const second: string[] = []
  for (const l of snap.limits) {
    second.push(`${SHORT[l.kind] ?? label(l.kind)} ${l.percent}%${l.resetsAt ? ` ${until(l.resetsAt, snap.at)}` : ''}`)
  }
  if (c !== null && c.since === snap.startedAt) {
    const sizes = c.before === null || c.after === null ? '' : ` (last ${tokens(c.before)}→${tokens(c.after)})`
    second.push(`compacted ${c.count}×${sizes}`)
  }

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
    </Box>
  )
}
