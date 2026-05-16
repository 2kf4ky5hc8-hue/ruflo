// Edge-safe Auth.js config — no Node built-ins, no DB.
// This is what middleware imports. The full handler (auth.ts) extends this
// with the Credentials provider that uses bcrypt + crypto + DB.

import type { NextAuthConfig } from 'next-auth';
import { env } from './env';

export const authConfig: NextAuthConfig = {
  secret: env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 60 * 60 * 8 },
  pages: { signIn: '/login' },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) (session.user as { id: string }).id = token.uid as string;
      return session;
    },
  },
};
