import type { Metadata } from 'next';
import { UsageDashboard } from '@/features/usage/usage-dashboard';

export const metadata: Metadata = {
  title: 'Chi phí & Token Dịch | Máy Dịch Lớp Học',
  description: 'Thống kê lượng token và chi phí dịch live ước tính theo thời gian thực.',
};

export default function UsagePage() {
  return <UsageDashboard />;
}
