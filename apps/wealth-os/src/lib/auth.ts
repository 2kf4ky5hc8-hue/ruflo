// Full Auth.js handler — Node runtime only. Used by server actions, API
// route, and server components. Middleware imports auth.config instead.

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './db';
import { users, auditEvents } from '../db/schema/index';
import { decryptSecret } from './crypto';
import { verifyTotp } from './totp';
import { authConfig } from './auth.config';

const credSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  totp: z.string().regex(/^\d{6}$/).optional(),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp:     { label: '6-digit TOTP code', type: 'text' },
      },
      async authorize(raw) {
        const parsed = credSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password, totp } = parsed.data;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase()))
          .limit(1);
        if (!user || !user.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        if (user.totpSecretEncrypted) {
          if (!totp) return null;
          const secret = decryptSecret(user.totpSecretEncrypted);
          if (!verifyTotp(secret, totp)) return null;
        }

        await db.insert(auditEvents).values({
          userId: user.id,
          actor: 'auth',
          action: 'sign_in',
          entityType: 'user',
          entityId: user.id,
          after: { method: 'credentials', totp: Boolean(user.totpSecretEncrypted) },
        });

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
});
