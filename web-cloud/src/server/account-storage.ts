import 'server-only';
import { createHash } from 'node:crypto';
import { isOwnerAccount } from '@/server/auth-policy';

/**
 * Browser database namespace for an account. The owner keeps the original
 * database so data recorded before multi-user support stays visible; other
 * accounts get an opaque per-email namespace (the email itself is not exposed).
 */
export function localDataNamespace(account: string | null | undefined): string | null {
  if (!account || isOwnerAccount(account)) return null;
  return createHash('sha256').update(account).digest('hex').slice(0, 24);
}
