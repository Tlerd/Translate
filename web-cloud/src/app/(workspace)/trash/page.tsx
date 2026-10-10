import { redirect } from 'next/navigation';

export default function TrashPage() {
  redirect('/library?view=trash');
}
