import { redirect } from 'next/navigation';
import { signIn } from '@/lib/auth';
import { AuthError } from 'next-auth';
import { db } from '@/lib/db';
import { users } from '@/db/schema/index';

interface Params { next?: string; err?: string; enrolled?: string }

async function loginAction(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').toLowerCase().trim();
  const password = String(formData.get('password') ?? '');
  const totp = String(formData.get('totp') ?? '');
  const next = String(formData.get('next') ?? '/');

  try {
    await signIn('credentials', {
      email, password, totp,
      redirectTo: next,
    });
  } catch (err) {
    if (err instanceof AuthError) redirect(`/login?err=1&next=${encodeURIComponent(next)}`);
    throw err;
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;

  // If no users are set up yet, redirect to setup.
  const enrolledCount = await db.select({ pw: users.passwordHash }).from(users);
  if (!enrolledCount.some((u) => Boolean(u.pw))) redirect('/setup');

  return (
    <main className="mx-auto max-w-md p-10">
      <h1 className="h1">Sign in</h1>
      {sp.enrolled && (
        <p className="mt-3 rounded-md border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">
          2FA enrolled. Sign in with your password and a 6-digit code.
        </p>
      )}
      {sp.err && (
        <p className="mt-3 rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">
          Sign-in failed. Check your email, password, and 2FA code.
        </p>
      )}

      <form action={loginAction} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={sp.next ?? '/'} />
        <div>
          <label className="label">Email</label>
          <input className="input mt-1" name="email" type="email" required autoFocus />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input mt-1" name="password" type="password" required />
        </div>
        <div>
          <label className="label">2FA code (6 digits)</label>
          <input className="input mt-1 font-mono tracking-widest" name="totp"
                 inputMode="numeric" pattern="\d{6}" maxLength={6} />
        </div>
        <button className="btn btn-primary w-full" type="submit">Sign in</button>
      </form>
    </main>
  );
}
