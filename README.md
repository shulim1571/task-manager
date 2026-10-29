# Task Manager

A simple per-user task manager backed by Supabase (auth + Postgres with row-level security).

Live: https://shulim1571.github.io/task-manager/

- `index.html` — the whole app (vanilla JS + supabase-js from CDN)
- `admin.html` — admin dashboard: every user's tasks, per-user counts, filters

## Admins

Admins are listed in the `public.admins` table, which has no API access. Manage them in the Supabase SQL editor:

```sql
-- add
insert into public.admins (user_id) select id from auth.users where email = 'someone@example.org';
-- remove
delete from public.admins where user_id = (select id from auth.users where email = 'someone@example.org');
```
- `serve.ps1` — optional local server: `powershell -File serve.ps1`, then open http://localhost:5173
