# plezuz / claude-plugins: a subtle gray status band

**A subtle gray, two-line status band** above the prompt in the Claude Desktop
app's Code tab. It is a fork of
[centminmod/claude-plugins](https://github.com/centminmod/claude-plugins). The
fork is finished, and no further plugins are planned.

```
mm_support · session 11m · 3 prompts · $0.40 · 1M tokens · hit 94%        cache 49m left ≡
5-hour 24% resets in 2h 50m · Weekly 94% resets in 1d 4h · last turn 1s on opus-5-5
```

How it differs from the original `desktop-statusline`:

- **Gray only.** No colors, no bars and no emoji: every meter is a plain
  percent.
- **Two lines.** Parts of one item are separated by a space, and separate
  items by ` · `.
- **Cache time left** (`cache 49m left`, then `cache cold`) sits on the right,
  and the session's **tokens** sit beside its cost.
- **Less noise.** It shows the folder name only, with no branch, and no
  context figure, because the app's own circle shows that.
- **The ≡ menu** switches back to the original band at any time. The choice is
  kept.
- **Read-only.** It makes no model calls and no network calls, so looking at
  the band never spends anything.

```
/plugin marketplace add plezuz/claude-plugins
/plugin install plezuz-statusline@plezuz
```

Details: [plugins/desktop-statusline](plugins/desktop-statusline).

---

*The upstream README follows.*

# centminmod / claude-plugins

- Site: <https://ai.georgeliu.com/p/claude-plugins>
- Article: <https://ai.georgeliu.com/p/my-claude-code-plugin-marketplace>

A personal Claude Code plugin marketplace. Each plugin is an independent, standalone unit that can be installed into any Claude Code project with a single command.

> Claude Code's plugin system supports multiple plugins per marketplace and handles install + update lifecycle automatically. See the [official plugin-marketplaces docs](https://code.claude.com/docs/en/plugin-marketplaces) for the broader ecosystem.

## Install the marketplace

Add this marketplace once, then install any plugin from it:

> **Run `/plugin` commands inside the Claude Code terminal CLI**
> (`claude` in your shell). They are not recognised in the desktop
> app, claude.ai/code, or IDE extensions — you'll see *"/plugin isn't
> a recognized command here"* if you try. Installed plugins then work
> from every surface; only the install step requires the CLI.

```
/plugin marketplace add centminmod/claude-plugins
```

## Available plugins

| Plugin | Description | Install |
|--------|-------------|---------|
| [`session-metrics`](plugins/session-metrics) | Per-turn token, cost, and cache metrics for Claude Code sessions. Multi-format export (text/JSON/CSV/MD/HTML) with 5-hour session blocks, weekly roll-up, hour-of-day punchcard, and pluggable chart libraries. | `/plugin install session-metrics@centminmod` |
| [`desktop-statusline`](plugins/desktop-statusline) | A mod that draws a status band above the prompt in the Claude Desktop app's Code tab, where the CLI `statusLine` doesn't run. Git state, context meter, session cost, 5-hour and weekly usage limits with reset countdowns, last-turn stats, and running agents. Needs Claude Code v2.1.287+. | `/plugin install desktop-statusline@centminmod` |

More plugins coming.

### Further reading — `session-metrics`

Background articles by the author on what the skill does and what it
surfaces in practice:

- [My Claude Code Plugin Marketplace Is Now Public. Install Session Metrics Skill Plugin](https://ai.georgeliu.com/p/my-claude-code-plugin-marketplace).
- [I built a token-cost analyzer skill for Claude Code](https://ai.georgeliu.com/p/i-built-a-token-cost-analyzer-skill) — how the skill was designed and what it reports.
- [I ran two Claude Opus 4.7 5-hour sessions](https://ai.georgeliu.com/p/i-ran-two-claude-opus-47-5hr-sessions) — real-world session-metrics output from two back-to-back Opus 4.7 sessions, with cache-hit, cost, and token-usage analysis.

## How the skill gets triggered

Plugin skills are namespaced as `plugin-name:skill-name` — for example
`/session-metrics:session-metrics`. In practice you rarely type that form:
each skill declares natural-language triggers in its `SKILL.md`, so Claude
Code auto-invokes the right one when you ask something like *"how much has
this session cost?"*.

## Licences

- Marketplace scaffold: MIT (see [`LICENSE`](LICENSE)).
- Each plugin under `plugins/*/` carries its own `LICENSE` and may bundle
  third-party assets under their upstream licences. For `session-metrics`
  specifically, the default Highcharts renderer ships under a
  non-commercial-free licence — commercial use requires a paid Highsoft
  licence. MIT-licensed alternatives (uPlot, Chart.js) are selectable via
  the `--chart-lib` flag. See
  [`plugins/session-metrics/skills/session-metrics/scripts/vendor/charts/README.md`](plugins/session-metrics/skills/session-metrics/scripts/vendor/charts/README.md)
  for per-library LICENSE.txt files.

## Contributing

This is a personal marketplace — issues and pull requests are welcome but
plugin additions are curated. Feel free to open an issue to discuss
bundling something new.

## Related

- [centminmod/my-claude-code-setup](https://github.com/centminmod/my-claude-code-setup) — personal Claude Code config template (bundles the same skills for direct copy)
