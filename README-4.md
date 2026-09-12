# REX Academy — Setup Guide

## What you have

```
rex-academy/
├── index.html                        → your website (HTML + CSS)
├── script.js                         → website logic (Supabase calls)
└── supabase/
    ├── schema.sql                    → run once in Supabase SQL Editor
    └── notify-registration/
        └── index.ts                  → Supabase Edge Function (Resend email)
```

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → New Project.
2. Once it's created, open **SQL Editor** in the left sidebar.
3. Paste the entire contents of `supabase/schema.sql` and click **Run**.
   This creates:
   - the `students` table (locked down with Row Level Security)
   - a hard database trigger that blocks a would-be 11th student
   - `student_count_public`, a view that only exposes a row count (no names/codes) so the site can show "x/10 left" safely
   - `register_student(...)`, the function that atomically checks the cap, generates a unique code, and inserts the student

## 2. Get your Supabase keys

In your Supabase project: **Settings → API**.

- Copy **Project URL** → paste into `script.js` as `SUPABASE_URL`.
- Copy the **anon / public** key → paste into `script.js` as `SUPABASE_ANON_KEY`.

⚠️ **Never** use the `service_role` key in `script.js` or anywhere in the browser. The anon key is safe to expose — it has no direct table access; it can only call the restricted function and view you created in step 1.

## 3. Set up Resend

1. Create an account at [resend.com](https://resend.com).
2. Verify a sending domain (or use their test sender `onboarding@resend.dev` while testing).
3. Create an API key: **API Keys → Create API Key**.
4. Keep this key handy — it goes into Supabase as a *secret*, never into any frontend file.

## 4. Deploy the Edge Function

Install the Supabase CLI if you don't have it, then from the `rex-academy` folder:

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF

# Set the Resend key as a server-side secret (never exposed to the browser)
supabase secrets set RESEND_API_KEY=your_resend_api_key_here

# Deploy the function
supabase functions deploy notify-registration
```

If you used a custom verified domain in Resend, open `supabase/notify-registration/index.ts` and change:

```ts
const NOTIFY_FROM = "REX Academy <onboarding@resend.dev>";
```

to something like `"REX Academy <hello@yourdomain.com>"`.

## 5. Test locally

Because `index.html` calls Supabase over HTTPS, you need to serve it (not just double-click the file) so the browser allows the requests:

```bash
cd rex-academy
python3 -m http.server 8080
```

Open `http://localhost:8080`. Fill the form, submit, and confirm:
- the code appears on screen
- the seat counter drops
- an email arrives at `bigrexedits777@gmail.com`
- you're redirected to Telegram after 2 seconds

## 6. Go live

Upload `index.html` and `script.js` to any static host — Netlify, Vercel, GitHub Pages, or Cloudflare Pages all work as-is since there's no server-side rendering needed. The `supabase/` folder does **not** get uploaded to your static host — it only lives in your Supabase project (schema already run, function already deployed).

## How the security model works

| Concern | How it's handled |
|---|---|
| Only 10 students, ever | Enforced twice: inside `register_student()` using a transaction-scoped advisory lock (`pg_advisory_xact_lock`), and again by a database trigger on the table itself. Two people submitting at the exact same moment can't both become "student 10." |
| No secret keys in frontend | `script.js` only ever holds the public anon key. The Resend API key is stored as a Supabase secret and only read inside the Edge Function, server-side. |
| No PII leakage for the live counter | The frontend never queries the `students` table directly — RLS blocks that entirely. It queries `student_count_public`, a view that returns rows with no name, code, or software data. |
| Duplicate/malformed submissions | The SQL function validates name length and software value server-side, independent of the frontend's own validation. |

## Customizing

- **Colors / gradients**: edit the CSS custom properties at the top of `index.html` (`--electric`, `--violet`, etc.).
- **Seat cap**: change `TOTAL_SEATS` in `script.js` *and* the `>= 10` checks in `schema.sql` (both the trigger and the function) if you ever want a different number.
- **Telegram link**: update `TELEGRAM_URL` in `script.js` (already set to your invite).
