import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { WorkspaceProvider } from '@/components/workspace-provider';
import { SignOutButton } from '@/components/sign-out-button';
import { SessionRenewal } from '@/components/session-renewal';
import { localAuthBypass, ownerSession } from '@/server/auth-policy';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const localDevelopment = localAuthBypass();
  if (!localDevelopment && !ownerSession(session)) redirect('/login');
  const workspace = <WorkspaceProvider accountControls={<SignOutButton />}>{children}</WorkspaceProvider>;
  return localDevelopment ? workspace : <SessionRenewal session={session}>{workspace}</SessionRenewal>;
}
