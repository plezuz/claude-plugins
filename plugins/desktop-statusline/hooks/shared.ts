import type { Elements, RenderElement, RenderInputOf } from 'claude-code'

import type { Compactions, Snapshot, Spent, TurnStat } from '../types'

export type Band = RenderInputOf<'AbovePrompt', 'desktop'>

// Everything a view draws from, read by the render hook: a view gets no `$`.
export type ViewInput = {
  ui: Elements['desktop']
  e: Band
  snap: Snapshot
  turn: TurnStat | null
  compactions: Compactions | null
  spent: Spent | null
  cacheTtlMs: number
  menu: RenderElement
}

const LABELS: Record<string, string> = { five_hour: '5-hour', seven_day: 'Weekly' }

export const label = (kind: string) => LABELS[kind] ?? kind.replace(/_/g, ' ')

export const tokens = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`

export const until = (iso: string, now: number) => {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000))
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
}

export const elapsed = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export const ago = (ms: number) => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`
}
