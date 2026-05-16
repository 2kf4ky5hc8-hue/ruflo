import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { toDataURL as qrToDataURL } from 'qrcode';
import { db } from '@/lib/db';
import { users, recoveryCodes } from '@/db/schema/index';
import { encryptSecret } from '@/lib/crypto';
import { newTotpForEmail, verifyTotp } from '@/lib/totp';
import { randomBytes, createHash } from 'node:crypto';

interface SearchParams { secret?: string; err?: string }

async function getOnlyUser() {
  const [u] = await db.select().from(users).limit(1);
  return u ?? null;
}

async function setPasswordAction(formData: FormData) {
  'use server';
  const user = await getOnlyUser();
  if (!user) throw new Error('Seed user missing.');
  if (user.passwordHash) return; // already set; ignore

  const email = String(formData.get('email') ?? '').toLowerCase().trim();
  const password = String(formData.get('password') ?? '');
  if (!email.includes('@')) redirect('/setup?err=email');
  if (password.length < 12) redirect('/setup?err=password');

  const hash = await bcrypt.hash(password, 12);
  await db.update(users).set({ email, passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, user.id));
  redirect('/setup');
}

async function enrolTotpAction(formData: FormData) {
  'use server';
  const user = await getOnlyUser();
  if (!user) throw new Error('Seed user missing.');

  const secret = String(formData.get('secret') ?? '');
  const code = String(formData.get('code') ?? '');
  if (!secret || !verifyTotp(secret, code)) {
    redirect(`/setup?secret=${encodeURIComponent(secret)}&err=totp`);
  }

  const enc = encryptSecret(secret);
  await db.update(users).set({ totpSecretEncrypted: enc, totpEnrolledAt: new Date() }).where(eq(users.id, user.id));

  // Issue 10 single-use recovery codes (hashed at rest).
  for (let i = 0; i < 10; i++) {
    const c = randomBytes(6).toString('hex');
    const h = createHash('sha256').update(c).digest('hex');
    await db.insert(recoveryCodes).values({ userId: user.id, codeHash: h });
  }

  redirect('/login?enrolled=1');
}

export default async function SetupPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const user = await getOnlyUser();

  if (!user) {
    return (
      <main className="mx-auto max-w-md p-10">
        <h1 className="h1">Setup blocked</h1>
        <p className="subtle mt-2">No seed user. Run <code>pnpm db:bootstrap</code> first.</p>
      </main>
    );
  }

  if (user.passwordHash && user.totpSecretEncrypted) redirect('/login');

  // Stage 1: password
  if (!user.passwordHash) {
    return (
      <main className="mx-auto max-w-md p-10">
        <h1 className="h1">First-run setup</h1>
        <p className="subtle mt-2">
          This instance is single-user. Set your password — keep it long, ideally
          generated and stored in a password manager.
        </p>
        {sp.err === 'email' && <p className="mt-3 text-sm text-bad">Enter a valid email.</p>}
        {sp.err === 'password' && <p className="mt-3 text-sm text-bad">Password must be 12+ characters.</p>}

        <form action={setPasswordAction} className="mt-6 space-y-4">
          <div>
            <label className="label">Email</label>
            <input className="input mt-1" name="email" type="email" defaultValue={user.email} required />
          </div>
          <div>
            <label className="label">Password (12+ chars)</label>
            <input className="input mt-1" name="password" type="password" minLength={12} required autoFocus />
          </div>
          <button className="btn btn-primary" type="submit">Set password</button>
        </form>
      </main>
    );
  }

  // Stage 2: TOTP. Persist the secret in the query so the user can retry without re-scanning.
  const secret = sp.secret ?? newTotpForEmail(user.email).secretBase32;
  const issuer = encodeURIComponent('Ruflo Wealth');
  const label = encodeURIComponent(user.email);
  const uri = `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  const qr = await qrToDataURL(uri, { margin: 1, width: 220 });

  return (
    <main className="mx-auto max-w-md p-10">
      <h1 className="h1">Enrol 2FA</h1>
      <p className="subtle mt-2">
        Scan with Google Authenticator, 1Password, Authy, or any TOTP app — then enter
        the 6-digit code to confirm. Recovery codes will be generated on success.
      </p>

      <div className="mt-6 flex justify-center">
        <img src={qr} alt="TOTP QR" className="rounded" />
      </div>
      <p className="mt-3 text-center font-mono text-xs text-muted break-all">{secret}</p>
      {sp.err === 'totp' && <p className="mt-3 text-sm text-bad">Code did not verify. Try again with a fresh code.</p>}

      <form action={enrolTotpAction} className="mt-6 space-y-4">
        <input type="hidden" name="secret" value={secret} />
        <div>
          <label className="label">6-digit code</label>
          <input className="input mt-1 font-mono tracking-widest" name="code"
                 inputMode="numeric" pattern="\d{6}" maxLength={6} required autoFocus />
        </div>
        <button className="btn btn-primary" type="submit">Confirm &amp; finish setup</button>
      </form>
    </main>
  );
}
