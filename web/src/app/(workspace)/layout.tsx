import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { WorkspaceProvider } from '@/components/workspace-provider';
import { SignOutButton } from '@/components/sign-out-button';

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const localDevelopment = process.env.NODE_ENV !== 'production' && !process.env.AUTH_SECRET && !owner;
  if (!localDevelopment && (!owner || session?.user?.email?.trim().toLowerCase() !== owner)) redirect('/login');
  return <WorkspaceProvider accountControls={<SignOutButton />}>{children}</WorkspaceProvider>;
}
