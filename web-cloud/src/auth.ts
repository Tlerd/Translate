import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { ownerEmail, secureAuthCookies, SESSION_MAX_AGE } from '@/server/auth-policy';

export const { handlers, signIn, signOut, auth } = NextAuth(request => ({
  trustHost: true,
  useSecureCookies: request || process.env.AUTH_URL || process.env.NEXTAUTH_URL ? secureAuthCookies(request?.url, request?.headers) : undefined,
  session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID?.trim() || '',
      clientSecret: process.env.AUTH_GOOGLE_SECRET?.trim() || '',
      authorization: { params: { prompt: 'select_account' } },
    }),
  ],
  secret: process.env.AUTH_SECRET?.trim(),
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    signIn({ user, profile }) {
      // Google must assert that the account controls its email address.
      if (profile?.email_verified !== true) return false;

      const owner = ownerEmail();
      if (!owner) return process.env.NODE_ENV !== 'production';
      return user.email?.trim().toLowerCase() === owner;
    },
  },
}));
