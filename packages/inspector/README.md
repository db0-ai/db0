# @db0-ai/inspector

Visual memory inspector for db0 — browse, search, and manage your agent's memories in a web UI.

## Quick Start

```bash
# Auto-detects db0.sqlite from ~/.openclaw/
npx @db0-ai/inspector
```

The inspector opens in your browser at `http://127.0.0.1:6460`.

## CLI Options

```
db0-inspect [options]

Options:
  --db <path>       Path to db0.sqlite file (auto-detected from OpenClaw)
  --port <number>   Port to bind (default: 6460)
  --host <string>   Host to bind (default: 127.0.0.1)
  --agent <id>      Agent ID to inspect (default: main)
  --no-open         Don't open browser automatically
  -h, --help        Show this help
```

### Auto-detection

If `--db` is not provided, the CLI searches for `db0.sqlite` in:

1. `$DB0_SQLITE_PATH` (env var)
2. `$OPENCLAW_HOME/db0.sqlite`
3. `~/.openclaw/db0.sqlite`
4. `~/.config/openclaw/db0.sqlite`

## Remote Access

By default the inspector binds to `127.0.0.1` (localhost only). To access it from another machine on your network:

```bash
db0-inspect --host 0.0.0.0
```

Then open `http://<your-machine-ip>:6460` from the remote browser.

You can combine with a custom port:

```bash
db0-inspect --host 0.0.0.0 --port 8080
```

> **Note:** There is no built-in authentication. If exposing on a network, consider tunneling through SSH instead:
>
> ```bash
> # On your local machine — forward remote port 6460 to localhost
> ssh -L 6460:127.0.0.1:6460 user@remote-host
>
> # Then on the remote host, run normally (no --host needed):
> db0-inspect
> ```

## Views

The inspector has three views, toggled from the sidebar:

### Memories

Browse and filter all stored memories. Features:

- **Scope / status / source / extraction filters** in the sidebar
- **Time range pills** (7d / 30d / 90d / All) above the list
- **Semantic search** — type in the search box (or press `/` to focus it)
- **Confidence badges** — color-coded percentage on each card
- **Search scores** — similarity scores shown when searching
- **Click any card** to open the detail modal with version history, relationships, quality signals, and actions (confirm / correct / delete)

### Dashboard

Charts showing distribution of memories by scope, extraction method, source type, and confidence level.

### Health

Integrity report surfacing anomalies:

- Contradiction candidates
- Active memories without summaries
- Missing scope or provenance
- Superseded memories without `validTo`

Click any anomaly card to jump to a sample memory.

## Export

Click the **Export** button in the top bar to download all memories as a JSON file.

## Programmatic Usage

```ts
import { createInspector } from "@db0-ai/inspector";
import { createSqliteBackend } from "@db0-ai/backends-sqlite";

const backend = await createSqliteBackend({ dbPath: "./db0.sqlite" });

const inspector = createInspector({
  backend,
  agentId: "main",
  port: 6460,
  host: "0.0.0.0",     // remote access
  // token: "secret",   // optional auth — requires Authorization: Bearer <token> header
  runtime: {
    profile: "openclaw",
  },
});

const { url } = await inspector.start();
console.log(`Inspector at ${url}`);

// Later:
await inspector.stop();
```

### Auth Token

Pass a `token` to require `Authorization: Bearer <token>` on all API requests. The web UI does not send this header automatically, so token auth is primarily for programmatic API access.

## Keyboard Shortcuts

| Key     | Action             |
|---------|--------------------|
| `/`     | Focus search       |
| `Esc`   | Close detail modal |
