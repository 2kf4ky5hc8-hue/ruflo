import { redirect } from 'next/navigation';
import { desc, eq, and } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { db } from '@/lib/db';
import { reports } from '@/db/schema/index';
import { generatePlaybook } from '@/services/playbook';

async function regenerate() {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  await generatePlaybook(userId);
  redirect('/playbook');
}

// Minimal markdown → HTML for the headings/lists/tables we emit. No third-party renderer.
function renderMarkdown(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split('\n');
  const out: string[] = [];
  let inTable = false;
  let inList = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const line = raw;

    if (line.startsWith('# ')) { if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h1 class="text-2xl font-semibold tracking-tight mt-6">${escape(line.slice(2))}</h1>`); continue; }
    if (line.startsWith('## ')) { if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h2 class="text-lg font-semibold mt-6">${escape(line.slice(3))}</h2>`); continue; }
    if (line.startsWith('### ')) { if (inList) { out.push('</ul>'); inList = false; }
      out.push(`<h3 class="text-sm uppercase tracking-wide text-muted mt-5">${escape(line.slice(4))}</h3>`); continue; }
    if (line.startsWith('- ')) {
      if (!inList) { out.push('<ul class="list-disc pl-5 space-y-1 my-2">'); inList = true; }
      out.push(`<li>${escape(line.slice(2)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</li>`);
      continue;
    }
    if (line.startsWith('|')) {
      if (!inTable) { out.push('<table class="my-3 text-sm border-collapse"><tbody>'); inTable = true; }
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c))) continue;
      out.push(
        `<tr>${cells.map((c) => `<td class="border border-line px-2 py-1">${escape(c).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</td>`).join('')}</tr>`,
      );
      continue;
    }
    if (inTable) { out.push('</tbody></table>'); inTable = false; }
    if (inList) { out.push('</ul>'); inList = false; }
    if (line.trim() === '') { out.push(''); continue; }
    out.push(`<p class="my-2">${escape(line).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')}</p>`);
  }
  if (inList) out.push('</ul>');
  if (inTable) out.push('</tbody></table>');
  return out.join('\n');
}

export default async function PlaybookPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  const [latest] = await db.select().from(reports)
    .where(and(eq(reports.userId, userId), eq(reports.kind, 'playbook')))
    .orderBy(desc(reports.generatedAt))
    .limit(1);

  return (
    <AppShell current="/playbook">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="h1">Playbook</h1>
          <p className="subtle mt-1">
            Generated from your onboarding answers. Regenerate after your numbers change.
          </p>
        </div>
        <form action={regenerate}>
          <button className="btn btn-ghost" type="submit">Regenerate</button>
        </form>
      </div>

      <article className="card mt-6 prose-sm max-w-3xl">
        {latest
          ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown((latest.content as { markdown: string }).markdown ?? '') }} />
          : <p className="subtle">No playbook yet. Finish onboarding first.</p>}
      </article>
    </AppShell>
  );
}
