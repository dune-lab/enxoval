import { AsyncLocalStorage } from 'node:async_hooks';

export type AuthUser = { userId: string; role: string; token: string };

export const store = new AsyncLocalStorage<AuthUser | null>();

export function getCurrentUser(): AuthUser | null {
  return store.getStore() ?? null;
}
