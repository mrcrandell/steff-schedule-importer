# STEFF Schedule Importer

Nuxt app for uploading a work schedule image or PDF, extracting STEFF's shifts with Gemini, normalizing the shift times, and syncing the result to Google Calendar.

## What the app does

1. Upload a schedule image or PDF from the browser.
2. Send the file to `/api/parse-schedule`.
3. Use Gemini to extract STEFF-only shifts.
4. Normalize the shifts in `server/utils/normalizeShifts.ts`.
5. Send the normalized shifts to `/api/sync-calendar`.
6. Insert each shift as a Google Calendar event.

## Prerequisites

- Node.js 18 or newer
- pnpm 9 or newer
- A Gemini API key
- A Google Cloud project with the Google Calendar API enabled
- A Google OAuth 2.0 Web application client

## Install and run locally

1. Install dependencies:

```bash
pnpm install
```

2. Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
```

3. Start the Nuxt dev server:

```bash
pnpm dev
```

4. Open the app at `http://localhost:3000`.

## Required credentials

The server reads these values from `runtimeConfig` in [nuxt.config.ts](./nuxt.config.ts):

- `GEMINI_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

### 1. Gemini API key

This is required for `/api/parse-schedule`.

How to get it:

1. Go to Google AI Studio: [https://aistudio.google.com/](https://aistudio.google.com/)
2. Sign in with your Google account.
3. Create or open a project.
4. Generate an API key.
5. Copy the key into `GEMINI_API_KEY` in your `.env` file.

### 2. Google OAuth client ID and secret

These are required for `/api/sync-calendar`.

How to get them:

1. Go to Google Cloud Console: [https://console.cloud.google.com/](https://console.cloud.google.com/)
2. Create a project or select an existing one.
3. Open `APIs & Services`.
4. Enable the `Google Calendar API` for that project.
5. Open `OAuth consent screen` and configure the app.
6. Add your Google account as a test user if the app is in testing mode.
7. Open `Credentials`.
8. Create `OAuth client ID` credentials.
9. Choose `Web application`.
10. Add an authorized redirect URI that matches `GOOGLE_REDIRECT_URI`.
11. Copy the client ID and client secret into your `.env` file.

Example local redirect URI:

```text
http://localhost:3000/auth/callback
```

## Important current limitation

The sync endpoint is ready to accept a Google OAuth access token, but the browser app does not yet implement the OAuth login and callback flow.

That means:

- Schedule parsing works once `GEMINI_API_KEY` is set.
- Calendar syncing will not work from the current UI until a client-side Google OAuth flow is added.
- If you click `Sync to Google Calendar` right now, the UI will report that Google OAuth is not yet configured.

In code:

- [server/api/parse-schedule.post.ts](./server/api/parse-schedule.post.ts) uses `GEMINI_API_KEY`.
- [server/api/sync-calendar.post.ts](./server/api/sync-calendar.post.ts) expects a client-supplied Google access token and uses the configured OAuth client credentials.
- [pages/index.vue](./pages/index.vue) currently contains a placeholder note where the OAuth flow should be implemented.

## Verifying local setup

After `pnpm dev` starts:

1. Open the app in the browser.
2. Upload a schedule image or PDF.
3. Click `Parse Schedule`.
4. Confirm that parsed shifts for STEFF appear in the table.

If parsing fails, check that:

- `GEMINI_API_KEY` is set correctly.
- The uploaded file is an image or PDF.
- The dev server was restarted after editing `.env`.

If syncing fails, check that:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` are set.
- The redirect URI exactly matches the value configured in Google Cloud.
- The app still needs a browser-side OAuth implementation to obtain `accessToken` before calling `/api/sync-calendar`.

## Useful scripts

```bash
pnpm dev
pnpm build
pnpm preview
pnpm typecheck
```
