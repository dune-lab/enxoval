import { verify, sign, decode } from 'jsonwebtoken';
import { addPreHandler } from '@enxoval/http';
import { UnauthorizedError } from '@enxoval/types';
import { store } from './context';

export type { AuthUser } from './context';
export { getCurrentUser } from './context';

export function signToken(userId: string, role: string): string {
  return sign(
    { userId, role },
    process.env.JWT_SECRET!,
    { expiresIn: (process.env.JWT_EXPIRES_IN ?? '1h') as `${number}${'s' | 'm' | 'h' | 'd'}` },
  );
}

export function decodeToken(token: string): { userId: string; role: string } | null {
  try {
    const payload = decode(token) as { userId?: string; role?: string } | null;
    if (!payload?.userId || !payload?.role) return null;
    return { userId: payload.userId, role: payload.role };
  } catch {
    return null;
  }
}

export function setupAuth(options?: { exclude?: string[] }): void {
  const excluded = options?.exclude ?? [];

  addPreHandler((request, _reply, done) => {
    if (excluded.includes(request.url)) {
      store.enterWith(null);
      done();
      return;
    }

    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      done(new UnauthorizedError('Unauthorized'));
      return;
    }

    const token = authHeader.slice(7);
    try {
      const payload = verify(token, process.env.JWT_SECRET!) as { userId: string; role: string };
      store.enterWith({ userId: payload.userId, role: payload.role });
      done();
    } catch {
      done(new UnauthorizedError('Unauthorized'));
    }
  });
}
