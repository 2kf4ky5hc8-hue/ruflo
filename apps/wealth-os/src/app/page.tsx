import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { users } from '@/db/schema/index';
import { auth } from '@/lib/auth';

export default async function Root() {
  // Bootstrap: if nobody has a password yet, send them to /setup.
  const someUsers = await db.select({ pw: users.passwordHash }).from(users);
  const anyEnrolled = someUsers.some((u) => Boolean(u.pw));
  if (!anyEnrolled) redirect('/setup');

  const session = await auth();
  if (!session?.user) redirect('/login');

  // Onboarded users go to dashboard; new users get the onboarding wizard.
  const [me] = await db
    .select({ onboarded: users.onboardedAt })
    .from(users)
    .limit(1);
  if (!me?.onboarded) redirect('/onboarding');
  redirect('/dashboard');
}
