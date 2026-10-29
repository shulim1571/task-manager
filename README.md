# Task Manager

A simple per-user task manager backed by Supabase (auth + Postgres with row-level security).

Live: https://shulim1571.github.io/task-manager/

- `index.html` — the whole app (vanilla JS + supabase-js from CDN)
- `admin.html` — dashboard for managers and super admins (adapts to the signed-in level)

## Levels

| Level | Can do |
|---|---|
| User | Their own tasks (`index.html`) |
| Manager | Their own tasks, plus full control of their team's tasks. Can add users who have no manager to their team, and remove their own team members. |
| Super admin | Full control of every task. Sets anyone's level (except their own) and moves users between managers. There is always at least one super admin. |

Levels live in `public.user_roles` (no row = user) and teams in `public.team_members` (one manager per user). Neither table is readable or writable from the API; changes go through `set_user_role()` and `set_team()`, which check the caller's level. Task access is enforced by RLS via `can_manage_user()`.

## Task images

Each task can have one image (PNG, JPEG, GIF or WebP, up to 5 MB): the **Image** column on the dashboard, and **+ Image** on each task in the main list. Files go in the private `task-images` storage bucket under `<task id>/`, and `tasks.image_path` points to the current one. Storage policies let anyone who can see the task view, upload or remove its image; pages show images through signed URLs that expire after an hour. Replacing, removing or deleting a task also deletes the old file.

## Emailing a task

Each task has an **Email** button (dashboard and main list). It calls the `send-task-email` Edge Function (`supabase/functions/send-task-email/index.ts`), which checks that the caller can see the task, then sends its details (title, status, priority, due date, assignee, notes, plus the image as an attachment when it is 3 MB or less) through Microsoft 365 from one business mailbox. Replies go to the person who sent it. Each user can send up to 20 task emails an hour, and every email is logged in task history as "Emailed".

Setup, once:

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), go to **App registrations > New registration**. Name it "Task Manager email", single tenant, no redirect URI.
2. In the app, go to **API permissions > Add a permission > Microsoft Graph > Application permissions**, add **Mail.Send**, then **Grant admin consent**.
3. Go to **Certificates & secrets > New client secret** and copy the secret's **Value**.
4. Recommended: limit the app to the sender mailbox, because Mail.Send otherwise allows sending as any mailbox in the organization. In Exchange Online PowerShell:
   `New-ApplicationAccessPolicy -AppId <client id> -PolicyScopeGroupId <sender address> -AccessRight RestrictAccess -Description "Task Manager email"`
5. In Supabase, go to **Edge Functions > Secrets** and add:
   - `MS_TENANT_ID`: the app's Directory (tenant) ID
   - `MS_CLIENT_ID`: the app's Application (client) ID
   - `MS_CLIENT_SECRET`: the secret value from step 3
   - `MS_SENDER`: the mailbox to send from, e.g. tasks@yourcompany.org

To redeploy the function after editing it: `supabase functions deploy send-task-email`.

## Task history

Every task insert, update and delete is logged to `public.task_history` by the `tasks_log_change` trigger: who made the change, when, and the old/new value of each changed field (title, notes, status, priority, due date, image, assignee). The log is append-only from the API (read-only, no insert/update/delete), and visible to the same people who can see the task. The dashboard's **Activity** section shows it; each task's **History** button shows that task alone. Entries with no user ("System") come from changes made outside the app, e.g. in the SQL editor.

To make someone a super admin from the Supabase SQL editor (e.g. if you get locked out):

```sql
insert into public.user_roles (user_id, role)
select id, 'super_admin' from auth.users where email = 'someone@example.org'
on conflict (user_id) do update set role = 'super_admin';
```
- `serve.ps1` — optional local server: `powershell -File serve.ps1`, then open http://localhost:5173
