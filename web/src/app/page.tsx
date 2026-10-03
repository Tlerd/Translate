import Link from 'next/link';
import { AudioLines, ArrowUpRight, Languages, NotebookPen, Sparkles } from 'lucide-react';
import styles from './welcome.module.css';

export default function LandingPage() {
  const cloudEnabled = Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
  const storageNote = cloudEnabled && process.env.BLOB_READ_WRITE_TOKEN
    ? 'Chữ và audio đồng bộ theo tài khoản · Giữ bản gốc trên thiết bị.'
    : cloudEnabled ? 'Chữ đồng bộ theo tài khoản · Audio lưu trên thiết bị.' : 'Bản ghi lưu trên trình duyệt bạn sử dụng.';
  return <main className={styles.page}>
    <nav className={styles.nav} aria-label="Điều hướng chính">
      <Link className={styles.brand} href="/"><AudioLines size={24} /> Máy Dịch</Link>
      <Link className={styles.navLink} href="/login">Đăng nhập <ArrowUpRight size={16} /></Link>
    </nav>
    <section className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>CHO BUỔI HỌC VÀ NHỮNG CUỘC TRÒ CHUYỆN</span>
        <h1>Nghe trọn câu.<br /><span>Hiểu rõ ý.</span></h1>
        <p className={styles.lead}>Ghi lại lời nói, theo dõi bản dịch và biến nội dung buổi học thành ghi chú dễ đọc — trong một không gian.</p>
        <Link className={styles.primary} href="/login">Đăng nhập để bắt đầu <ArrowUpRight size={18} /></Link>
        <p className={styles.hint}>Đăng nhập bằng Google. Hiện dành cho tài khoản được cấp quyền.</p>
      </div>
      <div className={styles.preview} aria-label="Ví dụ minh họa bản dịch và ghi chú">
        <div className={styles.previewTop}><span className={styles.dot} /> Một buổi học, nhiều điều để nhớ <span>VÍ DỤ</span></div>
        <div className={styles.transcript}><span>01 · LỜI NÓI</span><p>私の趣味は音楽です。</p><strong>Sở thích của tôi là âm nhạc.</strong></div>
        <div className={styles.transcript}><span>02 · LỜI NÓI</span><p>クラシック音楽が好きです。</p><strong>Tôi thích nhạc cổ điển.</strong></div>
        <div className={styles.note}><Sparkles size={18} /><div><strong>Ghi chú sau buổi học</strong><p>Sở thích âm nhạc: yêu thích âm nhạc, đặc biệt là nhạc cổ điển.</p></div></div>
      </div>
    </section>
    <section className={styles.features} aria-label="Các chức năng chính">
      <article><Languages /><h2>Theo dõi bản dịch</h2><p>Hiển thị bản dịch từng phần khi AI trả kết quả. Chọn model và mức suy luận phù hợp.</p></article>
      <article><AudioLines /><h2>Giữ mạch lời nói</h2><p>Ghi âm, chốt câu theo khoảng nghỉ và xem lại lời nói cùng bản dịch.</p></article>
      <article><NotebookPen /><h2>Biến lời nói thành ghi chú</h2><p>Sửa transcript trong cửa sổ riêng, tạo tóm tắt có dẫn nguồn và ảnh minh họa.</p></article>
    </section>
    <footer className={styles.footer}><span>Máy Dịch · Lớp học & luyện đọc</span><span>{storageNote}</span></footer>
  </main>;
}
