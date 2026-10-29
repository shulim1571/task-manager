# Task Manager

A simple per-user task manager backed by Supabase (auth + Postgres with row-level security).

Live: https://shulim1571.github.io/task-manager/

- `index.html` — the whole app (vanilla JS + supabase-js from CDN)
- `admin.html` — admin dashboard: every user's tasks, per-user counts, filters, and a "Make admin" button

## Admins

Admins are listed in the `public.admins` table, which has no direct API access. Any admin can make another user an admin from the dashboard (via the `admin_grant_admin` function). Removing an admin is done in the Supabase SQL editor:

```sql
delete from public.admins where user_id = (select id from auth.users where email = 'someone@example.org');
```
- `serve.ps1` — optional local server: `powershell -File serve.ps1`, then open http://localhost:5173
