import { signOut } from '@/auth';
export function SignOutButton() {
  return <form action={async () => { 'use server'; await signOut({ redirectTo: '/' }); }}>
    <button type="submit" style={{ color: 'var(--text-secondary)', fontSize: 12, padding: 8 }}>Đăng xuất</button>
  </form>;
}
