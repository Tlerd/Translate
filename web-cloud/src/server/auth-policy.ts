import type { Session } from 'next-auth';

export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

function normalizeEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const email = value.trim().toLowerCase();
  const at = email.indexOf('@');
  return at > 0 && at === email.lastIndexOf('@') && at < email.length - 1 ? email : undefined;
}

function listEnv(name: string): string[] {
  return (process.env[name] ?? '').split(/[\s,;]+/).map(item => item.trim().toLowerCase()).filter(Boolean);
}

/** The administrator: always allowed, sees usage of every account and keeps the pre-multi-user local data. */
export function ownerEmail(): string | undefined { return normalizeEmail(process.env.OWNER_EMAIL); }
export function allowedEmails(): string[] { return listEnv('ALLOWED_EMAILS').map(normalizeEmail).filter((e): e is string => Boolean(e)); }
/** Exact domains (no subdomains); a leading "@" is accepted. */
export function allowedDomains(): string[] { return listEnv('ALLOWED_DOMAINS').map(domain => domain.replace(/^@/, '')).filter(Boolean); }

/** True when at least one sign-in rule exists, so access can be decided. */
export function accessConfigured(): boolean {
  return Boolean(ownerEmail() || allowedEmails().length || allowedDomains().length);
}

/** Returns the normalized email when it may use the app, otherwise undefined. */
export function allowedAccount(value: unknown): string | undefined {
  const email = normalizeEmail(value);
  if (!email) return undefined;
  if (email === ownerEmail() || allowedEmails().includes(email)) return email;
  return allowedDomains().includes(email.slice(email.indexOf('@') + 1)) ? email : undefined;
}
export function isOwnerAccount(email: string | null | undefined): boolean {
  const owner = ownerEmail();
  return Boolean(owner && email === owner);
}
export function sessionAccount(session: Session | null): string | undefined {
  return allowedAccount(session?.user?.email);
}
export function localAuthBypass(): boolean {
  return process.env.NODE_ENV !== 'production' && !process.env.AUTH_SECRET?.trim() && !accessConfigured();
}
export function secureAuthCookies(url?: string, headers?: Headers): boolean {
  const configured = process.env.AUTH_URL || process.env.NEXTAUTH_URL;
  if (configured) return new URL(configured).protocol === 'https:';
  const forwarded = headers?.get('x-forwarded-proto')?.split(',')[0].trim();
  if (forwarded === 'https' || forwarded === 'http') return forwarded === 'https';
  return url ? new URL(url).protocol === 'https:' : process.env.NODE_ENV === 'production';
}
