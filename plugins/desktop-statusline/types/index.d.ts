export type Limit = { kind: string; percent: number; resetsAt: string | null }

export type SavedLimits = { at: number; limits: Limit[] }

export type Agent = { type: string; description: string }

export type Snapshot = {
  at: number
  startedAt: number
  prompts: number
  dir: string
  branch: string | null
  isWorktree: boolean
  ahead: number
  behind: number
  changed: number
  contextPercent: number | null
  contextTokens: number | null
  contextWindow: number
  costUsd: number | null
  limits: Limit[]
  // The last limits the app reported, in this or an earlier session.
  savedLimits: SavedLimits | null
  agents: Agent[]
}

export type TurnStat = {
  at: number
  durationMs: number
  model: string | null
  cacheHit: number | null
}

// The last model request of the main conversation: the cache time counts from it.
export type RequestStat = {
  at: number
  cacheHit: number | null
}

export type View = 'original' | 'gray'

export type Spent = { since: number; tokens: number }

export type Compactions = { since: number; count: number; before: number | null; after: number | null }

declare module 'claude-code' {
  interface PluginState {
    'plezuz-statusline': {
      snap: Snapshot | null
      warned: string[]
      lastTurn: TurnStat | null
      lastRequest: RequestStat | null
      compactions: Compactions | null
      spent: Spent | null
      view: View
      menuOpen: boolean
    }
  }
}
