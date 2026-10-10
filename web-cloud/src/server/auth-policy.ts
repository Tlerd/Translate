import type { Session } from 'next-auth';

export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
export function ownerEmail(): string | undefined { return process.env.OWNER_EMAIL?.trim().toLowerCase() || undefined; }
export function ownerSession(session: Session | null): boolean {
  const owner = ownerEmail();
  return Boolean(owner && session?.user?.email?.trim().toLowerCase() === owner);
}
export function localAuthBypass(): boolean {
  return process.env.NODE_ENV !== 'production' && !process.env.AUTH_SECRET?.trim() && !ownerEmail();
}
export function secureAuthCookies(url?: string, headers?: Headers): boolean {
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (configured) return new URL(configured).protocol === 'https:';
  const forwarded = headers?.get('x-forwarded-proto')?.split(',')[0].trim();
  if (forwarded === 'https' || forwarded === 'http') return forwarded === 'https';
  return url ? new URL(url).protocol === 'https:' : process.env.NODE_ENV === 'production';
}
