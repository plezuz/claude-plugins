import { ago, elapsed, label, tokens, until } from './shared'
import type { ViewInput } from './shared'

// The Original view: centminmod's desktop-statusline band as published (v0.1.1), with only the
// ☰ menu button added at the end of its top row. Keep it in step with upstream; change Gray instead.

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

const tone = (percent: number) => (percent >= 95 ? 'error' : percent >= 80 ? 'warning' : undefined)

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

export function originalView({ ui, e, snap, turn, compactions: c, cacheTtlMs, menu }: ViewInput) {
  const { Box, Svg, Text } = ui

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

  const where =
    `📁 ${snap.dir}` +
    (snap.branch === null ? '' : `   🌿 ${snap.branch}${snap.isWorktree ? ' 🌳' : ''}`) +
    `${snap.ahead ? ` ↑${snap.ahead}` : ''}${snap.behind ? ` ↓${snap.behind}` : ''}` +
    `${snap.changed ? `   ● ${snap.changed} changed` : ''}`
  const session =
    `session ${ago(snap.at - snap.startedAt)} · ${snap.prompts} prompt${snap.prompts === 1 ? '' : 's'}` +
    (snap.costUsd === null ? '' : ` · $${snap.costUsd.toFixed(2)}`)

  // Bottom line parts: dim unless they need attention (warning) or are live (agents).
  const activity: { text: string; emphasis?: 'warning' | 'live' }[] = []
  if (turn !== null && turn.at >= snap.startedAt) {
    const idleMs = Math.max(0, snap.at - turn.at)
    const isCold = idleMs >= cacheTtlMs
    activity.push({ text: `Last turn ${elapsed(turn.durationMs)}${turn.model ? ` on ${turn.model}` : ''}` })
    if (turn.cacheHit !== null) {
      activity.push({ text: `cache ${turn.cacheHit}%`, emphasis: turn.cacheHit < 50 ? 'warning' : undefined })
    }
    if (!e.props.isWorking) {
      activity.push({ text: `idle ${ago(idleMs)}${isCold ? ' (cache cold)' : ''}`, emphasis: isCold ? 'warning' : undefined })
    }
  }
  if (c !== null && c.since === snap.startedAt) {
    const sizes = c.before === null || c.after === null ? '' : ` (last ${tokens(c.before)} → ${tokens(c.after)})`
    activity.push({ text: `compacted ${c.count}×${sizes}` })
  }
  // Running agents get rows of their own (description truncated, type kept), so a
  // long description never runs off the "Last turn" line.
  const agentRows = snap.agents.slice(0, AGENT_ROWS)
  const moreAgents = snap.agents.length - agentRows.length

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" justifyContent="space-between" width="100%">
        <Text wrap="truncate-end">{where}</Text>
        <Box marginLeft={2} flexShrink={0}>
          <Text dimColor>{session}</Text>
        </Box>
        <Box marginLeft={2} flexShrink={0}>
          {menu}
        </Box>
      </Box>
      {meter('Context', snap.contextPercent, used, contextBar)}
      {snap.limits.length > 0 && (
        <Box flexDirection={isStacked ? 'column' : 'row'} columnGap={METER_GAP}>
          {snap.limits.map((l, i) => meter(label(l.kind), l.percent, details[i] ?? '', limitBar))}
        </Box>
      )}
      {activity.length > 0 && (
        <Box flexDirection="row">
          {activity.map((a, i) => (
            <Box flexDirection="row">
              {i > 0 && <Text dimColor>{' · '}</Text>}
              <Text
                wrap="truncate-end"
                color={a.emphasis === 'warning' ? 'warning' : undefined}
                dimColor={a.emphasis === undefined}
              >
                {a.text}
              </Text>
            </Box>
          ))}
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
}
