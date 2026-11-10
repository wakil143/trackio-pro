# Trackio PRO — Cloudflare 15-minute reminder trigger

This Worker triggers the existing GitHub Actions reminder workflow every 15 minutes.
The existing GitHub workflow continues to use the existing `FIREBASE_SERVICE_ACCOUNT_JSON`
GitHub secret and Firebase Admin SDK. No Firebase data, rules, FCM tokens, or app UI are changed.

## Why this relay design

The current reminder sender uses `firebase-admin` in GitHub Actions. This Worker only
starts that existing workflow through GitHub's workflow-dispatch API; it does not copy
Firebase credentials into Cloudflare.

## Deploy

1. Create a Cloudflare Workers account and open **Workers & Pages**.
2. Create a Worker named `trackio-pro-reminder-cron`.
3. Deploy the contents of this folder using Wrangler, or connect the repository and set
   this folder as the Worker root directory.
4. In the Worker's **Settings → Variables and Secrets**, add a secret named
   `GITHUB_TOKEN`. Never put the token in source code or commit it to GitHub.
5. Use a GitHub fine-grained personal access token restricted to this repository, with
   **Actions: Read and write** permission. Do not share the token with anyone.
6. Confirm the Worker has the Cron Trigger `*/15 * * * *` under **Settings → Triggers**.
7. Run one manual test from Cloudflare's Cron Trigger test interface and verify that a
   new run appears under GitHub Actions → Trackio PRO Revision Reminders.

## Important cutover step

The existing GitHub Actions schedule is intentionally left enabled during setup.
After the Cloudflare trigger has successfully dispatched and completed a test run,
remove the `schedule:` trigger from `.github/workflows/revision-reminders.yml`
(or ask for the cutover) so the old GitHub timer and Cloudflare timer do not send
duplicate workflow runs. Keep `workflow_dispatch` enabled.

## Timing and reliability

The Worker requests a workflow dispatch every 15 minutes. GitHub may queue or delay
the workflow, and Android/FCM delivery can also be delayed. This is not an exact-time
delivery guarantee. The existing Firestore delivery-id check remains the duplicate
protection for reminder events.
