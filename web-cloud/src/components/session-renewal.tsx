'use client';

import { SessionProvider, useSession } from 'next-auth/react';
import type { Session } from 'next-auth';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

function RefreshSessionRoutes() {
  const { data } = useSession();
  const router = useRouter();
  const previous = useRef(data?.expires);
  useEffect(() => {
    if (data?.expires && previous.current && previous.current !== data.expires) router.refresh();
    previous.current = data?.expires;
  }, [data?.expires, router]);
  return null;
}
export function SessionRenewal({ session, children }: { session: Session | null; children: React.ReactNode }) {
  // /api/auth/session renews the JWT and sends Set-Cookie. RSC auth() cannot
  // write that cookie. Renew on focus and every five minutes while online.
  return <SessionProvider session={session} refetchInterval={300} refetchOnWindowFocus refetchWhenOffline={false}>
    <RefreshSessionRoutes />{children}
  </SessionProvider>;
}
