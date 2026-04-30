# enxoval

Shared libraries for dune-lab Node.js microservices. Published to npm under the `@enxoval` scope.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@enxoval/types`](#enxovaltypes) | 1.0.6 | Runtime validation schemas, branded UUID, fn/asyncFn wrappers |
| [`@enxoval/http`](#enxovalhttp) | 1.0.10 | Fastify wrapper, route helpers, kanly contract CLI |
| [`@enxoval/db`](#enxovaldb) | 1.0.3 | TypeORM wrapper, migration runner CLI |
| [`@enxoval/messaging`](#enxovalmessaging) | 1.0.2 | Kafka producer/consumer, topic setup |
| [`@enxoval/auth`](#enxovalauth) | 1.0.0 | JWT middleware, sign and verify helpers |
| [`@enxoval/observability`](#enxovalobservability) | 1.0.1 | Structured logger (pino) |

---

## @enxoval/types

Runtime validation schemas with TypeScript types. Use `createSchema` to define a wire type — it validates input and auto-generates the `contracts.json` used by kanly.

```ts
import { createSchema, field } from '@enxoval/types';

const CreateUserWireIn = createSchema({
  id: field.uuid(),
  name: field.string(),
  role: field.literal('student', 'admin'),
});

// parse and validate input
const user = CreateUserWireIn.parse(req.body);
```

Available field types: `field.uuid()`, `field.string()`, `field.number()`, `field.boolean()`, `field.date()`, `field.literal(...values)`.

---

## @enxoval/http

Fastify wrapper that exposes route helpers and `listen`. Also ships the `kanly` CLI for contract validation.

```ts
import { get, post, listen } from '@enxoval/http';

get('/health', async () => ({ ok: true }));
post('/users', async (req) => createUser(req.body));

listen({ port: 3000 });
```

Other exports: `getWith`, `getWithAuth`, `postOk`, `put`, `patch`, `del`, `html`, `inject`, `addPreHandler`.

### kanly CLI

Validates wire contract compatibility between services. Runs automatically in CI.

```bash
# validate against live services
ATREIDES_URL=http://localhost:3002 npx kanly

# validate against local contract registry
KANLY_LOCAL_DIR=./partners npx kanly
```

---

## @enxoval/db

TypeORM wrapper with Postgres support and a migration runner CLI.

```ts
import { createDataSource, defineEntity, column } from '@enxoval/db';

const dataSource = createDataSource({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [UserEntity],
  migrationsDir: __dirname + '/migrations',
});

await dataSource.initialize();
```

**Migration CLI** (via `postbuild` in each service):

```bash
npm run migration:generate -- add-user-table
npm run migration:run
npm run migration:revert
```

---

## @enxoval/messaging

Kafka producer/consumer wrapper. Resolves topic names from `config.json` at runtime, retries on failure and routes to a DLQ after max retries.

```ts
import { publish, subscribe, connect, disconnect, ensureTopics } from '@enxoval/messaging';

// produce
await publish('userCreated', { userId, email, role });

// consume
subscribe('userCreated', async (message) => {
  await handleUserCreated(message);
});

// ensure topics exist on startup (reads config.json)
await ensureTopics();
```

---

## @enxoval/auth

JWT HS256 middleware and helpers. Sets up auth on all routes and provides `signToken` and `getCurrentUser`.

```ts
import { setupAuth, signToken, getCurrentUser } from '@enxoval/auth';

// setup middleware (call once at startup, before listen)
setupAuth({ exclude: ['/health', '/auth/login'] });

// sign a token
const token = signToken(userId, role);

// read current user inside a request handler
const user = getCurrentUser(); // { userId, role }
```

Requires `JWT_SECRET` in environment. `JWT_EXPIRES_IN` is optional (default: `1h`).

---

## @enxoval/observability

Structured logger built on pino. Outputs JSON in production, pretty-prints in development.

```ts
import { logger } from '@enxoval/observability';

logger.info('server started');
logger.error({ err }, 'something went wrong');
```

Log level is controlled by `LOG_LEVEL` env var (default: `info`).

---

## Publishing

Packages are published to npm automatically when a tag `v*` is pushed:

```bash
git tag v1.0.17
git push origin v1.0.17
```

The `publish` workflow:
1. Builds all packages
2. Publishes any version not yet on npm
3. Opens bump PRs in all dune-lab service repos updating `@enxoval/*` dependencies

---

## Contract Validation

Each service exposes `wire/in` and `wire/out` schemas built with `createSchema`. After every build, `contracts.json` is generated automatically via the `postbuild` script and published to [dune-lab/contracts](https://github.com/dune-lab/contracts).

kanly reads this registry on every PR and validates that each service's `wire_in` fields are compatible with the partner's `wire_out`.
