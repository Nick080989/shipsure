# ShipSure: Release Captain for Jira

ShipSure tells you whether a Jira release is ready to ship, what is blocking it, and what to do next. It is built on Atlassian Forge for Codegeist 2026.

- **Jira project page** (ShipSure, in the project's navigation). Pick a release to see:
  - a 0-100 readiness score and a verdict
  - progress and counts
  - ranked risks, each linked to its issue
  - next steps
  - one-click release notes
- **Rovo agent "ShipSure Release Captain"**: ask "Are we ready to ship 2.4.0?" or "What is blocking the release?"
- **Rovo MCP server**: five read-only release tools for MCP-aware agents.

## Scoring

`40 + 60 x done ratio`, minus capped penalties:

| Risk | Penalty | Cap |
|---|---|---|
| Blocked by an unfinished issue | 8 each | 40 |
| Open bug with Highest, High, Critical, Blocker or Urgent priority | 6 each | 30 |
| In progress with no update for 5+ days | 3 each | 15 |
| Unassigned open issue | 2 each | 10 |
| Release date passed | 10 | |

The verdict is **Ready to ship** at 85+ with no blockers, **Ship with caution** at 65+, and **Not ready** below that.

## Run it yourself

```bash
npm install
npm test
forge deploy
forge install
```

`demo/seed.js` creates a sample project (ORBIT) with releases, issues and blocking links. Paste it into the browser console on your Jira site.

## Privacy

ShipSure stores nothing and calls no external services. See [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md).

## License

MIT
