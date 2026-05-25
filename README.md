# enxoval

Shared libraries for dune-lab Node.js microservices. Published to npm under the `@enxoval` scope.

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@enxoval/types`](#enxovaltypes) | 1.0.25 | Runtime validation schemas, branded UUID, fn/asyncFn wrappers |
| [`@enxoval/http`](#enxovalhttp) | 1.0.31 | Fastify wrapper, route helpers, kanly contract CLI |
| [`@enxoval/db`](#enxovaldb) | 1.0.3 | TypeORM wrapper, migration runner CLI |
| [`@enxoval/messaging`](#enxovalmessaging) | 1.0.7 | Kafka producer/consumer, topic setup, DLQ schemas |
| [`@enxoval/auth`](#enxovalauth) | 1.0.3 | JWT middleware, sign and verify helpers |
| [`@enxoval/observability`](#enxovalobservability) | 1.0.3 | Structured logger (pino) |
| [`@enxoval/quality`](#enxovalquality) | 1.0.2 | ESLint + Prettier config, layer boundary enforcement |
| [`@enxoval/testing`](#enxovaltesting) | 1.0.4 | Vitest re-exports, generate, itCases, in-memory data source |

---

## @enxoval/types

Runtime validation and typed function wrappers. The core of dune-lab's type safety — every value that crosses a boundary is validated at runtime and typed at compile time.

### createSchema + field

Define a schema with `createSchema`. Call `.parse(raw)` to validate and get a fully typed value.

```ts
import { createSchema, field } from '@enxoval/types';

const CreateUserWireIn = createSchema({
  name:  field.string(),
  email: field.string(),
  role:  field.literal('student', 'admin'),
});

const input = CreateUserWireIn.parse(req.body);
// input is typed: { name: string; email: string; role: 'student' | 'admin' }
```

Available field types: `field.uuid()`, `field.string()`, `field.number()`, `field.boolean()`, `field.date()`, `field.literal(...values)`, `field.nullable(inner)`, `field.array(inner)`.

---

### fn and asyncFn

Schema-bounded function wrappers. They validate input before execution and output before returning — catching both bad incoming data and programmer mistakes in one place.

**`fn`** — synchronous transform between two schemas:

```ts
import { fn } from '@enxoval/types';

// adapter: DB row → domain model
export const fromDbWire = fn(UserDbWire, User, (wire) => ({
  id:            asUUID(wire.id),
  name:          wire.name,
  email:         wire.email,
  emailVerified: wire.email_verified,
  role:          wire.role as Role,
  createdAt:     wire.created_at,
}));

// adapter: domain model → HTTP wire out
export const toWireOut = fn(User, UserWireOut, (u) => ({
  id:        u.id,
  name:      u.name,
  email:     u.email,
  role:      u.role,
  createdAt: u.createdAt.toISOString(),
}));
```

**`asyncFn` with output schema** — for controllers that return a value:

```ts
import { asyncFn, asUUID } from '@enxoval/types';

export const createUser = asyncFn(CreateUserWireIn, User, async (input) => {
  const existing = await userDb.findByEmail(input.email);
  if (existing) return existing;

  const passwordHash = await hashPassword(input.password);
  return userDb.insert(buildUser({ ...input, passwordHash }));
});
```

**`asyncFn` without output schema** — for Kafka consumers and fire-and-forget side effects:

```ts
export const journeyStarted = asyncFn(Event, async (event) => {
  await journeyDb.updateStep({ id: event.journeyId, currentStep: 'DIAGNOSTIC_TRIGGERED' });
  await publish('diagnosticTriggered', event);
});
```

**Why this matters:**

| Without fn/asyncFn | With fn/asyncFn |
|--------------------|-----------------|
| Manual `.parse()` scattered across every handler | Single declaration — parse happens automatically |
| TypeScript types must be repeated manually | Types inferred from schemas — no duplication |
| Output shape only caught by TypeScript | Output validated at runtime — catches shape mismatches |
| `unknown` leaks into business logic | Function body always receives a typed, validated value |

The pattern covers every layer: adapters validate DB ↔ model transforms, controllers validate wire_in ↔ model, Kafka consumers validate message payloads. No raw `unknown` ever reaches business logic.

---

### UUID

Branded `UUID` type that prevents plain strings from being passed where a UUID is expected.

```ts
import { UUID, toUUID, asUUID, isUUID } from '@enxoval/types';

// throws if not a valid UUID format
const id: UUID = toUUID(req.params.id);

// cast without validation (use when value is already trusted)
const id: UUID = asUUID(row.id);

// type guard
if (isUUID(value)) { ... }
```

---

### Error classes

Typed errors that map to HTTP status codes in `@enxoval/http`.

```ts
import { NotFoundError, ConflictError, UnauthorizedError } from '@enxoval/types';

throw new NotFoundError('User not found');
throw new ConflictError('Email already registered');
throw new UnauthorizedError('Invalid credentials');
```

| Class | HTTP status |
|-------|------------|
| `AppError` | 500 (base class) |
| `NotFoundError` | 404 |
| `ConflictError` | 409 |
| `ValidationError` | 400 |
| `UnprocessableError` | 422 |
| `UnauthorizedError` | 401 |

---

## @enxoval/http

Fastify wrapper that exposes typed route helpers and `listen`. Also ships the `kanly` CLI for contract validation.

Every route helper requires a third `ContractArg` argument that declares the input and output schemas used for contract generation. Pass `null` on either side to opt out of contract tracking for that direction.

```ts
import { get, post, listen } from '@enxoval/http';
import type { ContractArg } from '@enxoval/http';

get('/health', async () => ({ ok: true }), { in: null, out: null });

post(
  '/users',
  async (body) => createUser(body),
  { in: { schema: CreateUserWireIn, name: 'CreateUserWireIn' }, out: { schema: UserWireOut, name: 'UserWireOut' } },
);

listen({ port: 3000 });
```

Other exports: `getWith`, `getWithAuth`, `postOk`, `put`, `patch`, `del`, `html`, `sseRoute`, `inject`, `addPreHandler`.

### ContractArg

```ts
import type { ContractArg, ContractSide, SchemaLike } from '@enxoval/http';

// ContractSide = { schema: SchemaLike; name: string } | null
// ContractArg  = { in: ContractSide; out: ContractSide }
```

### kanly CLI

Validates wire contract compatibility between services. Runs automatically in CI via the `postbuild` script.

```bash
# validate against live services
ATREIDES_URL=http://localhost:3002 npx kanly

# validate against local contract registry
KANLY_LOCAL_DIR=./partners npx kanly
```

The `postbuild` hook in each service generates `contracts.json` and publishes it to the contracts registry:

```json
"postbuild": "node node_modules/@enxoval/http/dist/cli/kanly.js"
```

---

## @enxoval/db

TypeORM wrapper with Postgres support and a migration runner CLI.

```ts
import { createDataSource, defineEntity, column } from '@enxoval/db';

const dataSource = createDataSource({
  host:          process.env.DB_HOST,
  port:          Number(process.env.DB_PORT),
  username:      process.env.DB_USER,
  password:      process.env.DB_PASSWORD,
  database:      process.env.DB_NAME,
  entities:      [UserEntity],
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

Kafka producer/consumer wrapper. Resolves topic names from `config.json` at runtime, retries on failure, and routes to a `*-dlq` topic after max retries. Also exports the DLQ message schemas used by harkonnen.

```ts
import { publish, consume, connect, disconnect, ensureTopics } from '@enxoval/messaging';

// produce
await publish('userCreated', { userId, email, role });

// consume
consume('userCreated', async (message) => {
  await handleUserCreated(message);
});

// ensure topics exist on startup (reads config.json)
await ensureTopics();
```

### publishRaw

Publishes a raw message payload directly to a named Kafka topic, bypassing the `config.json` topic registry. Used by harkonnen to reprocess DLQ messages back to their original topic.

```ts
import { publishRaw } from '@enxoval/messaging';

await publishRaw('some-service-dlq', rawPayload);
```

### DLQ schemas

Shared types that both harkonnen and each service's embedded DLQ consumer use to validate persisted messages.

```ts
import { HarkonnenMessage, HarkonnenMessageInput, HARKONNEN_STATUSES } from '@enxoval/messaging';

// HarkonnenMessage — full record with id, cid, serviceName, retryCount, reprocessCount, status, etc.
// HarkonnenMessageInput — subset used when persisting a new failure: originalTopic, name, payload, error, failedAt
// HARKONNEN_STATUSES — tuple ['pending', 'reprocessed', 'dismissed']
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

## @enxoval/quality

ESLint flat config and Prettier config. Enforces dune-lab's code quality rules and Diplomat Architecture layer boundaries.

### Usage

```ts
// eslint.config.ts
import { base, makeBoundaries } from '@enxoval/quality/eslint';

export default [
  ...base(),
  ...makeBoundaries([
    { name: 'diplomat', pattern: ['src/diplomat/**'], allow: ['controller', 'adapter'] },
    { name: 'controller', pattern: ['src/controllers/**'], allow: ['adapter', 'model'] },
    { name: 'adapter',    pattern: ['src/adapters/**'],    allow: ['model', 'wire'] },
    { name: 'model',      pattern: ['src/model/**'],       allow: [] },
    { name: 'wire',       pattern: ['src/wire/**'],        allow: [] },
  ]),
];
```

```ts
// prettier.config.ts
export { default } from '@enxoval/quality/prettier';
```

### What `base()` enforces

- `@typescript-eslint/no-explicit-any` — error in `src/**`, off in tests
- `@typescript-eslint/no-unsafe-assignment`, `no-unsafe-argument`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return` — error in domain layers
- `no-restricted-imports` — blocks direct use of `typeorm`, `kafkajs`, `fastify`, `pino`, `vitest` in `src/**`; each must be accessed through the corresponding `@enxoval/*` wrapper

### What `makeBoundaries()` enforces

Prevents layers from importing each other in the wrong direction. Diplomat Architecture: diplomat → controller → adapter → model/wire (no upward or cross-layer imports).

---

## @enxoval/testing

Vitest re-exports, property-based test helpers, and an in-memory SQLite data source for integration tests.

### Vitest re-exports

```ts
import { describe, it, expect, beforeAll, afterAll, test } from '@enxoval/testing';

test.fn()       // vi.fn()
test.mock()     // vi.mock()
test.spy()      // vi.spyOn()
test.clearAll() // vi.clearAllMocks()
```

### generate

Generates a random valid value from any `createSchema` schema. Useful for unit tests that need valid input without caring about specific values.

```ts
import { generate } from '@enxoval/testing';
import { CreateUserWireIn } from '../wire/in/user';

const input = generate(CreateUserWireIn);
// input is typed and valid: { name: '...', email: '...', role: 'student' | 'admin' }
```

Supports all field types including `field.nullable()` and `field.array()`. Accepts an optional `overrides` map to pin specific fields.

### itCases

Property-based test runner. Generates 50–150 random inputs from a schema and asserts the provided function does not throw for any of them.

```ts
import { itCases, generate } from '@enxoval/testing';
import { fromDbWire } from '../../src/adapters/user';
import { UserDbWire } from '../../src/db/wire/user';

itCases('fromDbWire never throws on valid DB rows', UserDbWire, (wire) => {
  fromDbWire(wire);
});

// with pinned fields
itCases('maps status correctly', UserDbWire, { status: 'active' }, (wire) => {
  const user = fromDbWire(wire);
  expect(user.status).toBe('active');
});
```

### createTestDataSource

SQLite in-memory data source for integration tests. Runs migrations automatically on initialization.

```ts
import { createTestDataSource } from '@enxoval/testing';
import { UserSchema } from '../../src/db/wire/user';

const ds = await createTestDataSource([UserSchema]);
const repo = ds.getRepository(UserSchema);
```

---

## Publishing & Bump Flow

Packages are published to npm automatically when a `v*` tag is pushed. The same pipeline opens bump PRs in every consumer repo.

### How to release

```bash
# 1. Bump the version in the package(s) that changed
#    Edit e.g. types/package.json: "version": "1.0.26"

# 2. Commit and tag
git add types/package.json
git commit -m "feat(types): add field.object helper"
git tag v1.0.26
git push origin main
git push origin v1.0.26
```

That's all. The rest is automated.

### What the pipeline does

```
push tag v1.0.26
    │
    ▼
[job: publish]
  Build all packages in workspace order
  For each package: publish to npm if version not already published
  (safe to re-tag — already-published versions are skipped)
    │
    ▼
[job: discover]
  Scan all dune-lab/* repos via GitHub API
  Read each repo's package.json
  Keep repos that have any @enxoval/* in dependencies or devDependencies
  Output: list of repo names (e.g. ["odyssey","imperium","atreides","persona","janus"])
    │
    ▼
[job: bump]  ← matrix: one job per repo, runs in parallel
  For each repo:
  ├── Checkout enxoval + service repo side-by-side
  ├── npm install @enxoval/types@1.0.26 ... (only packages already listed as deps)
  ├── git checkout -b chore/bump-enxoval-v1.0.26
  ├── git commit package.json package-lock.json
  └── gh pr create → "chore: bump @enxoval/* to v1.0.26"
```

### Result

Within minutes of the tag push, each service repo has a ready-to-merge PR:

| Repo | Branch |
|------|--------|
| dune-lab/odyssey | `chore/bump-enxoval-v1.0.26` |
| dune-lab/imperium | `chore/bump-enxoval-v1.0.26` |
| dune-lab/atreides | `chore/bump-enxoval-v1.0.26` |
| dune-lab/persona | `chore/bump-enxoval-v1.0.26` |
| dune-lab/janus | `chore/bump-enxoval-v1.0.26` |

### Key behaviors

- **Selective bump**: only packages already listed in the repo's `dependencies` or `devDependencies` are updated — a repo that doesn't use `@enxoval/messaging` won't have it added
- **lock file always updated**: `package-lock.json` is updated alongside `package.json` — `npm ci` in CI requires them in sync
- **Idempotent publish**: if a version was already published (e.g. from a previous run), the publish step skips it silently — no failure
- **Tag version ≠ package version**: the git tag label is used only for branch/PR naming; npm publish uses each `package.json`'s own `version` field
- **Requires `DUNE_LAB_TOKEN`**: a GitHub PAT with `repo` scope, stored as a secret in the enxoval repo, used to push branches and open PRs across the org

---

## Contract Validation

Each service exposes `wire/in` and `wire/out` schemas built with `createSchema`. After every build, `contracts.json` is generated automatically via the `postbuild` script and published to [dune-lab/contracts](https://github.com/dune-lab/contracts).

kanly reads this registry on every PR and validates that each service's `wire_in` fields are compatible with the partner's `wire_out`.
