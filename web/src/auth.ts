import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID || '',
      clientSecret: process.env.AUTH_GOOGLE_SECRET || '',
    }),
  ],
  secret: process.env.AUTH_SECRET,
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
