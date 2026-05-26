/**
 * server/index.ts
 *
 * Fastify HTTP server wrapper for @enxoval/http.
 * Exposes helpers (get, post, put, patch, del, html, sseRoute, etc.) that
 * register routes on a shared Fastify instance and track them in
 * `registeredRoutes` for introspection via GET /routes.
 *
 * Each route helper accepts a mandatory `contract: ContractArg` parameter
 * that carries optional input/output schema metadata for tooling and documentation.
 *
 * Internal framework routes (/routes) are excluded from the registry and
 * silenced in request/response logs.
 * Note: /health must be registered by each consumer service individually.
 */
import Fastify, { type FastifyRequest, type FastifyReply, type HookHandlerDoneFunction, type LightMyRequestResponse } from 'fastify';
import cors from '@fastify/cors';
import { logger } from '@enxoval/observability';
import { AppError } from '@enxoval/types';
import type { FieldDescriptor } from '@enxoval/types';
import { newCid, nextCid } from '@enxoval/observability';
import { registeredTopics } from '@enxoval/messaging';

const app = Fastify({ logger: false });

app.register(cors, { origin: true });

app.decorateRequest('cid', '');
app.decorateRequest('startTime', 0);

/** Paths that are suppressed from request/response logs. */
const SILENT_PATHS = new Set(['/routes', '/topics']);

// ─── Contract types ───────────────────────────────────────────────────────────

/** A schema-like object that can describe its fields as FieldDescriptor records. */
export type SchemaLike = { describe?(): Record<string, FieldDescriptor> };

/** One side (input or output) of a route contract. Null means no schema defined. */
export type ContractSide = { schema: SchemaLike; name: string } | null;

/** The contract argument passed to every route helper. Carries in/out schema metadata. */
export type ContractArg = { in: ContractSide; out: ContractSide };

/** Internal stored representation of a contract side (schema resolved to plain fields). */
type ContractStored = { name: string; fields: Record<string, FieldDescriptor> } | null;

/**
 * Converts a ContractSide into a stored representation by calling describe() on the schema.
 * @param side - The contract side to store, or null
 * @returns A ContractStored with name and resolved fields, or null
 */
function storeContract(side: ContractSide): ContractStored {
  if (!side) return null;
  const fields = side.schema.describe?.() ?? {};
  return { name: side.name, fields };
}

// ─── Route registry ───────────────────────────────────────────────────────────

/**
 * Registry of all routes registered via the exported helpers.
 * Populated by get(), post(), etc. — never includes /routes.
 */
const registeredRoutes: { method: string; path: string; contract: { in: ContractStored; out: ContractStored } }[] = [];

// ─── Hooks ────────────────────────────────────────────────────────────────────

app.addHook('onRequest', (request, reply, done) => {
  const incoming = request.headers['x-cid'] as string | undefined;
  const cid = incoming ? nextCid(incoming) : newCid();
  request.cid = cid;
  request.startTime = Date.now();
  reply.header('x-cid', cid);
  if (!SILENT_PATHS.has(request.url) && request.method !== 'OPTIONS') {
    logger.info({ cid, method: request.method, url: request.url }, 'http-server: request received');
  }
  done();
});

app.addHook('onResponse', (request, reply, done) => {
  if (!SILENT_PATHS.has(request.url) && request.method !== 'OPTIONS') {
    const durationMs = Date.now() - request.startTime;
    logger.info({ cid: request.cid, method: request.method, url: request.url, status: reply.statusCode, durationMs }, 'http-server: response sent');
  }
  done();
});

const HTTP_STATUS: Record<string, number> = {
  NotFoundError: 404,
  ConflictError: 409,
  ValidationError: 400,
  UnprocessableError: 422,
  UnauthorizedError: 401,
};

app.setErrorHandler((error, request, reply) => {
  if (error instanceof AppError) {
    const statusCode = HTTP_STATUS[error.name] ?? 500;
    logger.warn({ cid: request.cid, method: request.method, url: request.url, statusCode, error: error.name, message: error.message }, 'http-server: request error');
    reply.status(statusCode).send({ error: error.name, message: error.message });
    return;
  }
  if (error instanceof TypeError) {
    logger.warn({ cid: request.cid, method: request.method, url: request.url, message: error.message }, 'http-server: validation error');
    reply.status(400).send({ error: 'ValidationError', message: error.message });
    return;
  }
  logger.error({ cid: request.cid, method: request.method, url: request.url, error: error instanceof Error ? error.message : String(error) }, 'http-server: unexpected error');
  reply.status(500).send({ error: 'InternalServerError', message: 'Internal server error' });
});

type Handler<TBody = unknown> = (body: TBody) => Promise<unknown>;

// ─── Route helpers ────────────────────────────────────────────────────────────

/**
 * Registers a GET route and tracks it in registeredRoutes.
 * @param path - The URL path (e.g. '/users')
 * @param handler - Async function returning the response body
 * @param contract - Input/output schema metadata for this route
 */
export function get(path: string, handler: () => Promise<unknown>, contract: ContractArg): void {
  registeredRoutes.push({ method: 'GET', path, contract: { in: storeContract(contract.in), out: storeContract(contract.out) } });
  app.get(path, async () => handler());
}

/**
 * Registers a GET route with typed URL params and tracks it in registeredRoutes.
 * @param path - The URL path with param placeholders (e.g. '/users/:id')
 * @param handler - Async function receiving typed params and returning the response body
 * @param contract - Input/output schema metadata for this route
 */
export function getWith<TParams>(path: string, handler: (params: TParams) => Promise<unknown>, contract: ContractArg): void {
  registeredRoutes.push({ method: 'GET', path, contract: { in: storeContract(contract.in), out: storeContract(contract.out) } });
  app.get<{ Params: TParams }>(path, async (request) => handler(request.params as TParams));
}

/**
 * Registers a GET route with typed query string params and tracks it in registeredRoutes.
 * @param path - The URL path (e.g. '/notifications')
 * @param handler - Async function receiving typed query params and returning the response body
 * @param contract - Input/output schema metadata for this route
 */
export function getWithQuery<TQuery>(path: string, handler: (query: TQuery) => Promise<unknown>, contract: ContractArg): void {
  registeredRoutes.push({ method: 'GET', path, contract: { in: storeContract(contract.in), out: storeContract(contract.out) } });
  app.get<{ Querystring: TQuery }>(path, async (request) => handler(request.query as TQuery));
}

/**
 * Registers a GET route that receives the Authorization header and tracks it in registeredRoutes.
 * @param path - The URL path
 * @param handler - Async function receiving the authorization string and returning the response body
 * @param contract - Input/output schema metadata for this route
 */
export function getWithAuth(path: string, handler: (authorization: string | undefined) => Promise<unknown>, contract: ContractArg): void {
  registeredRoutes.push({ method: 'GET', path, contract: { in: storeContract(contract.in), out: storeContract(contract.out) } });
  app.get(path, async (request) => handler(request.headers['authorization'] as string | undefined));
}

/**
 * Registers a GET route that returns an HTML response and tracks it in registeredRoutes.
 * @param path - The URL path
 * @param handler - Async function returning an HTML string
 * @param contract - Input/output schema metadata for this route
 */
export function html(path: string, handler: () => Promise<string>, contract: ContractArg): void {
  registeredRoutes.push({ method: 'GET', path, contract: { in: storeContract(contract.in), out: storeContract(contract.out) } });
  app.get(path, async (_request, reply) => {
    reply.type('text/html; charset=utf-8').send(await handler());
  });
}

/**
 * Registers a POST route returning 201 and tracks it in registeredRoutes.
 * @param path - The URL path
 * @param handler - Async function receiving the typed body and returning the response body
 * @param contract - Input/output schema metadata for this route
 */
export function post<TBody>(path: string, handler: Handler<TBody>, contract: ContractArg): void {
  registeredRoutes.push({ method: 'POST', path, contract: { in: storeContract(contract.in), out: storeContract(contract.out) } });
  app.post<{ Body: TBody }>(path, async (request, reply) => {
    reply.status(201).send(await handler(request.body as TBody));
  });
}

/**
 * Registers a POST route returning 200 and tracks it in registeredRoutes.
 * @param path - The URL path
 * @param handler - Async function receiving the typed body and returning the response body
 * @param contract - Input/output schema metadata for this route
 */
export function postOk<TBody>(path: string, handler: Handler<TBody>, contract: ContractArg): void {
  registeredRoutes.push({ method: 'POST', path, contract: { in: storeContract(contract.in), out: storeContract(contract.out) } });
  app.post<{ Body: TBody }>(path, async (request, reply) => {
    reply.status(200).send(await handler(request.body as TBody));
  });
}

/**
 * Registers a PUT route returning 200 and tracks it in registeredRoutes.
 * @param path - The URL path
 * @param handler - Async function receiving the typed body and returning the response body
 * @param contract - Input/output schema metadata for this route
 */
export function put<TBody>(path: string, handler: Handler<TBody>, contract: ContractArg): void {
  registeredRoutes.push({ method: 'PUT', path, contract: { in: storeContract(contract.in), out: storeContract(contract.out) } });
  app.put<{ Body: TBody }>(path, async (request, reply) => {
    reply.status(200).send(await handler(request.body as TBody));
  });
}

/**
 * Registers a PATCH route returning 200 and tracks it in registeredRoutes.
 * @param path - The URL path
 * @param handler - Async function receiving the typed body and returning the response body
 * @param contract - Input/output schema metadata for this route
 */
export function patch<TBody>(path: string, handler: Handler<TBody>, contract: ContractArg): void {
  registeredRoutes.push({ method: 'PATCH', path, contract: { in: storeContract(contract.in), out: storeContract(contract.out) } });
  app.patch<{ Body: TBody }>(path, async (request, reply) => {
    reply.status(200).send(await handler(request.body as TBody));
  });
}

/**
 * Registers a DELETE route returning 204 and tracks it in registeredRoutes.
 * @param path - The URL path
 * @param handler - Async function called on deletion
 * @param contract - Input/output schema metadata for this route
 */
export function del(path: string, handler: () => Promise<unknown>, contract: ContractArg): void {
  registeredRoutes.push({ method: 'DELETE', path, contract: { in: storeContract(contract.in), out: storeContract(contract.out) } });
  app.delete(path, async (_request, reply) => {
    reply.status(204).send(await handler());
  });
}

/**
 * Registers a Server-Sent Events (SSE) route and tracks it in registeredRoutes.
 * @param path - The URL path (may include params)
 * @param handler - Async function receiving params, query, a send helper, and an AbortSignal
 * @param contract - Input/output schema metadata for this route
 */
export function sseRoute<TParams, TQuery = Record<string, string>>(
  path: string,
  handler: (
    params: TParams,
    query: TQuery,
    send: (data: object) => void,
    signal: AbortSignal,
  ) => Promise<void>,
  contract: ContractArg,
): void {
  registeredRoutes.push({ method: 'SSE', path, contract: { in: storeContract(contract.in), out: storeContract(contract.out) } });
  app.get<{ Params: TParams; Querystring: TQuery }>(path, async (request, reply) => {
    reply.hijack();
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.flushHeaders();

    const controller = new AbortController();
    const onClose = () => controller.abort();
    request.raw.on('close', onClose);

    const send = (data: object) => {
      if (!reply.raw.destroyed) {
        reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    try {
      await handler(request.params as TParams, request.query as TQuery, send, controller.signal);
    } finally {
      request.raw.off('close', onClose);
      if (!reply.raw.destroyed) reply.raw.end();
    }
  });
}

// ─── Internal framework route ─────────────────────────────────────────────────

/** Returns all routes registered via the exported helpers. Internal routes are excluded. */
app.get('/routes', async () => registeredRoutes);

/** Returns all topics registered via consume() and registerProducer(). Internal route — excluded from registry. */
app.get('/topics', async () => registeredTopics);

// ─── Server lifecycle ─────────────────────────────────────────────────────────

/**
 * Starts the Fastify server on the given port and host.
 * @param port - Port number to listen on
 * @param host - Host address to bind to
 * @param setup - Optional async setup function called before listening (skipped in CI)
 */
export async function listen(port: number, host: string, setup?: () => Promise<void>): Promise<void> {
  if (!process.env.CI && setup) await setup();
  await app.listen({ port, host });
}

/** Gracefully closes the Fastify server. */
export async function close(): Promise<void> {
  await app.close();
}

/**
 * Adds a preHandler hook to the Fastify instance (e.g. for auth middleware).
 * @param fn - Hook handler function
 */
export function addPreHandler(fn: (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void): void {
  app.addHook('preHandler', fn);
}

/**
 * Injects a request directly into the Fastify instance (useful for testing).
 * @param options - Method, URL, optional body and headers
 * @returns The LightMyRequest response
 */
export async function inject(options: {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<LightMyRequestResponse> {
  return app.inject({
    method: options.method as 'POST' | 'GET' | 'PUT' | 'PATCH' | 'DELETE',
    url: options.url,
    payload: options.body as string | object | undefined,
    headers: options.headers,
  }) as Promise<LightMyRequestResponse>;
}

export { tokenStorage, defineHttpAliases } from '../client/index';
