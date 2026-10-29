// Emails a task's details through Microsoft 365 (Graph API sendMail), from the mailbox in MS_SENDER.
// Secrets (Supabase > Edge Functions > Secrets): MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_SENDER.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const APP_URL = 'https://shulim1571.github.io/task-manager/';
const HOURLY_LIMIT = 20;             // emails per user per hour
const MAX_ATTACHMENT = 3 * 1024 * 1024; // Graph's limit for attachments sent inline with sendMail
const STATUS_LABELS: Record<string, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
const PRIORITY_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const isEmail = (s: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s) && s.length <= 254;

function toBase64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function graphToken() {
  const res = await fetch(`https://login.microsoftonline.com/${Deno.env.get('MS_TENANT_ID')}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: Deno.env.get('MS_CLIENT_ID')!,
      client_secret: Deno.env.get('MS_CLIENT_SECRET')!,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Microsoft sign-in failed: ${data.error_description?.split('\r\n')[0] || data.error || res.status}`);
  return data.access_token as string;
}

// Explains a Graph 403 using the permissions in the app's token.
function accessDeniedHelp(token: string, sender: string) {
  let roles: string[] = [];
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    roles = JSON.parse(atob(part + '='.repeat((4 - part.length % 4) % 4))).roles ?? [];
  } catch { /* fall through with no roles */ }
  if (!roles.includes('Mail.Send')) {
    return 'Outlook refused the email: the app registration does not have the Mail.Send application permission with admin consent' +
      (roles.length ? ` (it has: ${roles.join(', ')}).` : ' (it has no application permissions).');
  }
  return `Outlook refused the email: the app may send mail, but not as ${sender}. ` +
    'Check that this mailbox exists and has an Exchange licence, and that it is included in any Application Access Policy (policy changes can take up to an hour).';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  // Act as the caller, so row-level security decides which tasks they may email.
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return reply(401, { error: 'Sign in first.' });

  let body: { task_id?: string; to?: string; message?: string };
  try { body = await req.json(); } catch { return reply(400, { error: 'Invalid request.' }); }
  const to = (body.to || '').trim();
  const message = (body.message || '').trim().slice(0, 2000);
  if (!isEmail(to)) return reply(400, { error: 'Enter one valid email address.' });

  const { data: task } = await asUser.from('tasks').select('*').eq('id', body.task_id ?? '').maybeSingle();
  if (!task) return reply(404, { error: 'Task not found.' });

  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await admin.from('task_history').select('id', { count: 'exact', head: true })
    .eq('changed_by', user.id).eq('action', 'emailed').gte('changed_at', since);
  if ((count ?? 0) >= HOURLY_LIMIT) return reply(429, { error: `You can send up to ${HOURLY_LIMIT} task emails an hour. Try again later.` });

  const sender = Deno.env.get('MS_SENDER');
  if (!sender || !Deno.env.get('MS_TENANT_ID') || !Deno.env.get('MS_CLIENT_ID') || !Deno.env.get('MS_CLIENT_SECRET')) {
    return reply(503, { error: 'Email is not set up yet. An admin needs to connect the Outlook account in Supabase.' });
  }

  const { data: owner } = await admin.auth.admin.getUserById(task.user_id);
  const due = task.due_date
    ? new Date(task.due_date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : 'None';
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;vertical-align:top">${label}</td><td style="padding:6px 0">${value}</td></tr>`;

  // Attach the task image when it fits.
  const attachments = [];
  let imageNote = '';
  if (task.image_path) {
    const { data: file } = await admin.storage.from('task-images').download(task.image_path);
    if (file && file.size <= MAX_ATTACHMENT) {
      attachments.push({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: 'task-image.' + task.image_path.split('.').pop(),
        contentType: file.type || 'application/octet-stream',
        contentBytes: toBase64(new Uint8Array(await file.arrayBuffer())),
      });
      imageNote = 'Attached';
    } else {
      imageNote = 'Too large to attach. Open the task in the app to see it.';
    }
  }

  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1b1f24">
${message ? `<p style="white-space:pre-wrap">${escape(message)}</p>` : ''}
<p>${escape(user.email ?? 'Someone')} shared this task with you:</p>
<table style="border-collapse:collapse;font-size:14px">
${row('Task', `<strong>${escape(task.title)}</strong>`)}
${row('Status', STATUS_LABELS[task.status] ?? task.status)}
${row('Priority', PRIORITY_LABELS[task.priority] ?? task.priority)}
${row('Due', due)}
${row('Assigned to', escape(owner?.user?.email ?? 'Unknown'))}
${task.notes ? row('Notes', `<span style="white-space:pre-wrap">${escape(task.notes)}</span>`) : ''}
${imageNote ? row('Image', imageNote) : ''}
</table>
<p style="color:#6b7280;font-size:12px;margin-top:20px">Sent from <a href="${APP_URL}">Task Manager</a>.</p>
</div>`;

  try {
    const token = await graphToken();
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: `Task: ${task.title}`,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: to } }],
          replyTo: user.email ? [{ emailAddress: { address: user.email } }] : [],
          attachments,
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 403) throw new Error(accessDeniedHelp(token, sender));
      throw new Error(`Outlook refused the email: ${err.error?.message || res.status}`);
    }
  } catch (e) {
    return reply(502, { error: (e as Error).message });
  }

  await admin.from('task_history').insert({
    task_id: task.id, task_owner: task.user_id, task_title: task.title, action: 'emailed',
    changes: { to, ...(message ? { message } : {}) }, changed_by: user.id, changed_by_email: user.email,
  });
  return reply(200, { sent: true });
});
