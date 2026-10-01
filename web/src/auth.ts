import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID || '',
      clientSecret: process.env.AUTH_GOOGLE_SECRET || '',
      authorization: { params: { prompt: 'select_account' } },
    }),
  ],
  secret: process.env.AUTH_SECRET,
  pages: { signIn: '/login', error: '/login' },
  callbacks: {
    signIn({ user, profile }) {
      // Google must assert that the account controls its email address.
      if (profile?.email_verified !== true) return false;

      const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
      if (!ownerEmail) return process.env.NODE_ENV !== 'production';
      return user.email?.trim().toLowerCase() === ownerEmail;
    },
  },
});
