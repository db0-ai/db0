# @db0-ai/backends-postgres

PostgreSQL + pgvector backend for [db0](https://github.com/db0-ai/db0) — production-grade with native hybrid vector search.

## Install

```bash
npm install @db0-ai/core @db0-ai/backends-postgres
```

## Usage

```typescript
import { createPostgresBackend } from "@db0-ai/backends-postgres";

const backend = await createPostgresBackend("postgresql://user:pass@host/db0");
```

Use any hosted Postgres with pgvector: Neon, Supabase, Railway, or your own. Provides cross-device memory sync, disaster recovery, and native hybrid search (vector similarity + SQL filters in a single query).

## Requires

- PostgreSQL with [pgvector](https://github.com/pgvector/pgvector) extension enabled
- Connection string as the only required argument

## Documentation

See the [main db0 README](https://github.com/db0-ai/db0) for full documentation.

## License

MIT
