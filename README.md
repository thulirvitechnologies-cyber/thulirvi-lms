# Thulirvi Technologies LMS – Rebuilt Frontend

## Included
- Public Explore Courses catalogue removed. Course rows remain in Supabase and remain available in payment/admin selectors.
- Student dashboard continues to show only the signed-in student's enrollments.
- Lesson display supports explanation, examples and expected output sections.
- Admin lesson form now collects explanation, examples, expected output, resource URL and a required unique daily task. These are stored in the existing `lessons.content` and `lessons.task_instructions` columns; no schema migration is required for these fields.
- Fixed message helper to accept either an element ID or an element node.
- Existing auth, payment review, assignment, quiz and RLS/RPC flows retained.

## Deploy
1. Download and extract this ZIP.
2. Upload/replace `index.html`, `style.css`, `app.js`, `config.js` in the existing GitHub repository.
3. Commit changes and wait for GitHub Pages deployment.
4. Open the site in a private/incognito tab or hard refresh.

## Supabase safety
- `config.js` contains only the public publishable key. Never put a `service_role` key in browser files.
- Existing database and student/payment data are not changed by this frontend rebuild.
- **Do not rerun `schema.sql` on an existing project**; its policy creation statements may conflict with existing policies.
- The current schema does not include a certificate-issuance/verification table or project-completion review workflow. Those require a separate, additive SQL migration and server-side validation before certificates can be issued securely. No fake certificate QR or client-only certificate authority is included in this package.

## Daily lesson authoring format
In the admin panel, add one lesson per course/day. Write the topic explanation, worked examples, expected output, and a different practical task for each day. Use explicit headings in the saved lesson content automatically. Publish mini-project and major-project milestones as assignments and review submissions before marking them complete.
