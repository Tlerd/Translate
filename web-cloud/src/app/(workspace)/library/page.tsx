import { Suspense } from 'react';
import { LibraryView } from '@/features/library/library-view';

export const metadata = {
  title: 'Thư viện · Máy Dịch',
};

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryView />
    </Suspense>
  );
}
