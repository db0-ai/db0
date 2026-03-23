# @db0-ai/backends-sqlite

SQLite backend for [db0](https://github.com/db0-ai/db0) — pure JavaScript via [sql.js](https://github.com/sql-js/sql.js), zero native dependencies.

## Install

```bash
npm install @db0-ai/core @db0-ai/backends-sqlite
```

## Usage

```typescript
import { createSqliteBackend } from "@db0-ai/backends-sqlite";

// Persistent — file-backed
const backend = await createSqliteBackend({ dbPath: "./db0.sqlite" });

// In-memory — for tests
const testBackend = await createSqliteBackend({ dbPath: ":memory:" });

// Default — persistent at ./db0.sqlite
const defaultBackend = await createSqliteBackend();
```

Works everywhere Node.js runs. No native compilation, no system SQLite dependency. Your data stays on your machine.

## Documentation

See the [main db0 README](https://github.com/db0-ai/db0) for full documentation.

## License

MIT
