import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { WorkspaceProvider } from '@/components/workspace-provider';
import { SignOutButton } from '@/components/sign-out-button';
import { SessionRenewal } from '@/components/session-renewal';
import { localAuthBypass, sessionAccount } from '@/server/auth-policy';
import { localDataNamespace } from '@/server/account-storage';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const localDevelopment = localAuthBypass();
  const account = sessionAccount(session);
  if (!localDevelopment && !account) redirect('/login');
  const workspace = (
    <WorkspaceProvider
      accountControls={localDevelopment ? undefined : <SignOutButton />}
      accountEmail={localDevelopment ? null : account}
      dataNamespace={localDevelopment ? null : localDataNamespace(account)}
    >
      {children}
    </WorkspaceProvider>
  );
  return localDevelopment ? workspace : <SessionRenewal session={session}>{workspace}</SessionRenewal>;
}
