import { ago, label, tokens, until } from './shared'
import type { ViewInput } from './shared'

// The Gray view: our own band, changed freely. One line of plain gray text, no bars; the one
// color is a red "cache expired". Within one item the parts are joined by a space ("w 95% 1d 4h"); separate items are
// joined by " · ". No folder (the app shows it), no agent rows, no last turn, no context (the
// app's own circle shows it).

const SEP = ' · '
// Short names for the plan limits ("5h 27% 2h 17m · w 95% 1d 4h").
const SHORT: Record<string, string> = { five_hour: '5h', seven_day: 'w' }

export function grayView({ ui, snap, turn, request, compactions: c, spent: s, cacheTtlMs, menu }: ViewInput) {
  const { Box, Text } = ui

  // Left: the most interesting first, so a narrow window cuts the least interesting end.
  const left: string[] = []
  // Without a fresh reading, the last limits seen whose window has not reset yet, with their age.
  const saved = snap.savedLimits
  const isOld = snap.limits.length === 0 && saved !== null
  const limits = isOld
    ? saved.limits.filter(l => l.resetsAt === null || Date.parse(l.resetsAt) > snap.at)
    : snap.limits
  for (const l of limits) {
    left.push(`${SHORT[l.kind] ?? label(l.kind)} ${l.percent}%${l.resetsAt ? ` ${until(l.resetsAt, snap.at)}` : ''}`)
  }
  if (isOld && limits.length > 0) left.push(`limits ${ago(snap.at - saved.at)} ago`)
  if (snap.changed) left.push(`${snap.changed} changed`)
  left.push(`${snap.prompts} prompt${snap.prompts === 1 ? '' : 's'}`)
  if (snap.costUsd !== null) left.push(`$${snap.costUsd.toFixed(2)}`)
  if (s !== null && s.since === snap.startedAt) left.push(`${tokens(s.tokens)} tokens`)
  // The cache time counts from the last main model request, mid-turn too; a value saved before
  // requests were tracked falls back to the last turn.
  const last = request ?? turn
  let cache = ''
  let expired = false
  if (last !== null && last.at >= snap.startedAt) {
    const leftMs = cacheTtlMs - Math.max(0, snap.at - last.at)
    if (last.cacheHit !== null) left.push(`hit ${last.cacheHit}%`)
    if (leftMs <= 0) expired = true
    else cache = `cache ${leftMs < 60_000 ? '<1m' : `${Math.floor(leftMs / 60_000)}m`} left`
  }
  if (c !== null && c.since === snap.startedAt) {
    const sizes = c.before === null || c.after === null ? '' : ` (last ${tokens(c.before)}→${tokens(c.after)})`
    left.push(`compacted ${c.count}×${sizes}`)
  }
  // The least interesting last: a narrow window cuts it first.
  left.push(`session ${ago(snap.at - snap.startedAt)}`)

  // Far right, never cut: the cache time left, by ☰.

  return (
    <Box flexDirection="row" justifyContent="space-between" width="100%">
      <Box flexShrink={1}>
        <Text dimColor wrap="truncate-end">{left.join(SEP)}</Text>
      </Box>
      <Box flexDirection="row" marginLeft={1} columnGap={1} flexShrink={0}>
        {cache !== '' && <Text dimColor>{cache}</Text>}
        {expired && <Text color="error">{'🟥 cache expired'}</Text>}
        {menu}
      </Box>
    </Box>
  )
}
