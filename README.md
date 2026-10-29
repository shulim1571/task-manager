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

## Task history

Every task insert, update and delete is logged to `public.task_history` by the `tasks_log_change` trigger: who made the change, when, and the old/new value of each changed field (title, notes, status, priority, due date, assignee). The log is append-only from the API (read-only, no insert/update/delete), and visible to the same people who can see the task. The dashboard's **Activity** section shows it; each task's **History** button shows that task alone. Entries with no user ("System") come from changes made outside the app, e.g. in the SQL editor.

To make someone a super admin from the Supabase SQL editor (e.g. if you get locked out):

```sql
insert into public.user_roles (user_id, role)
select id, 'super_admin' from auth.users where email = 'someone@example.org'
on conflict (user_id) do update set role = 'super_admin';
```
- `serve.ps1` — optional local server: `powershell -File serve.ps1`, then open http://localhost:5173
