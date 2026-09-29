import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID || 'mock_client_id',
      clientSecret: process.env.AUTH_GOOGLE_SECRET || 'mock_client_secret',
    }),
  ],
  secret: process.env.AUTH_SECRET || 'dev_secret_key_at_least_32_characters_long_123456789',
  callbacks: {
    signIn({ user }) {
      const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
      if (!ownerEmail) return true; // if no owner email configured, allow sign-in
      return user.email?.toLowerCase() === ownerEmail;
    },
  },
});
