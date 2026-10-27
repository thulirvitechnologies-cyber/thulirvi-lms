# Thulirvi Technologies LMS — full starter implementation

Mobile-first custom-coded LMS for Android-phone-based development. Includes student login, admin role, multiple courses, manual UPI payment claims, database-verified fee checks, admin approval, per-course enrollment, daily lesson unlocks, lesson completion, assignment submissions/reviews, quizzes, student list, progress dashboard, and password-reset flow.

## Included files
- `index.html` — portal layout
- `style.css` — responsive teal/white branding
- `config.js` — public Supabase URL/key placeholders and optional display config
- `app.js` — student and admin application logic
- `schema.sql` — database tables, RLS policies, and protected database functions

## Deploy from Android
1. Create a Supabase project at https://supabase.com.
2. Open SQL Editor, paste all of `schema.sql`, and run it on a new project. Fix any SQL errors before continuing.
3. In Supabase Authentication settings, configure your Site URL and Redirect URLs for the deployed site. Enable email confirmation if desired.
4. Sign up through the website after setting `config.js`.
5. In Authentication > Users, copy your account UUID. In SQL Editor run: `update public.profiles set role='admin' where id='YOUR_AUTH_USER_UUID';`
6. Put your Supabase Project URL and publishable/anon key into `config.js`. Never use the service_role key in frontend files.
7. Upload all five files to a static host such as Cloudflare Pages using your Android browser. Configure the correct output/root directory and publish.
8. Set the deployed URL in Supabase Auth URL configuration and test password reset.
9. Log in as admin and create courses, lessons, assignments, and quiz questions.
10. Test with a separate student account and a small test payment. Verify the transaction in your bank/UPI account before approving it.

## Payment safety
Students submit a course ID, amount, and UPI transaction reference through `submit_payment_claim`. The database checks the actual course fee and rejects reused transaction references. A claim remains pending until an admin checks the actual credit and approves it. Approval runs through `admin_review_payment`, which checks admin role and creates the enrollment. Do not treat screenshots as proof of settlement; check the bank/UPI transaction record.

## Lesson unlock
Day 1 is available immediately after enrollment approval. Day 2 opens after 24 hours, Day 3 after 48 hours, etc. This is elapsed-time unlocking. The database policy enforces the same restriction, not only the frontend.

## Security notes
- RLS is enabled on every app table.
- Role assignment is not accepted from user signup metadata.
- Payment status and enrollment cannot be directly changed by students.
- Quiz answer checking runs in a database function; correct answers are not selected by the browser query.
- Use only the public publishable/anon key in browser code; never publish service_role credentials.
- Public lesson URLs are shareable. For paid PDFs/videos, implement private storage and short-lived signed URLs before selling access.
- This starter is not a security audit. Test in a separate project before public launch.

## Current scope and honest limitations
- Assignment submissions accept text or a project URL; file upload is not implemented.
- Quiz is a basic multiple-choice question bank, with score feedback.
- Certificate PDF generation/email delivery is not implemented in this version.
- Admin user list shows profile UUIDs, not email addresses, because profile rows do not store email. Use Supabase Auth admin tools to manage email/identity.
- UPI ID is intentionally blank in `config.js`; add only the verified business payment details.
- Free-tier limits, provider terms, and availability can change. ₹0 is the target for initial setup, not a guarantee of unlimited service.
