import { signOut } from '@/auth';
import { LogOut } from 'lucide-react';
import styles from './sign-out-button.module.css';

export function SignOutButton() {
  return (
    <form
      className={styles.signOutForm}
      action={async () => {
        'use server';
        await signOut({ redirectTo: '/' });
      }}
    >
      <button
        type="submit"
        className={styles.signOutButton}
        title="Đăng xuất"
        aria-label="Đăng xuất"
      >
        <LogOut size={16} />
        <span className={styles.signOutText}>Đăng xuất</span>
      </button>
    </form>
  );
}
