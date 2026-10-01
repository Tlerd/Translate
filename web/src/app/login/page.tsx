import Link from 'next/link';
import { auth, signIn } from '@/auth';
import { redirect } from 'next/navigation';
import { AudioLines, ArrowRight } from 'lucide-react';
import styles from '../welcome.module.css';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await auth();
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (owner && session?.user?.email?.trim().toLowerCase() === owner) redirect('/app');
  const { error } = await searchParams;
  const configured = Boolean(process.env.AUTH_SECRET && process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET && owner);
  const message = error === 'AccessDenied'
    ? 'Tài khoản này chưa được cấp quyền sử dụng. Hãy chọn tài khoản Google được cho phép.'
    : error ? 'Chưa thể đăng nhập. Hãy thử lại; nếu lỗi tiếp diễn, cần kiểm tra cấu hình đăng nhập trên server.' : undefined;
  return <main className={`${styles.page} ${styles.loginPage}`}>
    <Link className={styles.brand} href="/"><AudioLines size={24} /> Máy Dịch</Link>
    <section className={styles.loginCard}>
      <span className={styles.eyebrow}>KHÔNG GIAN CỦA BẠN</span>
      <h1>Chào mừng trở lại.</h1>
      <p>Đăng nhập để ghi âm, dịch và tạo ghi chú cho buổi học.</p>
      {message && <p role="alert" className={styles.error}>{message}</p>}
      {!configured && <p role="alert" className={styles.error}>Đăng nhập chưa được cấu hình đầy đủ. Vui lòng thử lại sau.</p>}
      <form action={async () => { 'use server'; await signIn('google', { redirectTo: '/app' }); }}>
        <button className={styles.primary} type="submit" disabled={!configured}><span className={styles.google}>G</span> Tiếp tục với Google <ArrowRight size={18} /></button>
      </form>
      <p className={styles.hint}>Chỉ tài khoản được cấp quyền mới có thể vào ứng dụng. Bạn không cần dán API key trên web.</p>
      <Link className={styles.back} href="/">← Về trang giới thiệu</Link>
    </section>
  </main>;
}
