# KerjaBot – AI Job Agent for MYFutureJobs

Next.js app (VS Code → Vercel). **DeepSeek** is the brain, **Letta** is the long-term
memory that learns, and **Playwright** drives a real browser on myfuturejobs.gov.my.

```
Browser UI (app/page.tsx)
   │  chat + IC/password (kept in the tab only)
   ▼
/api/chat  (app/api/chat/route.ts, streams progress)
   │
   ├─ lib/memory.ts  ── Letta ── load profile, preferences, past searches, global lessons
   │
   ├─ lib/agent.ts   ── DeepSeek tool loop
   │        tools: search_jobs · job_details · more_results · recall_memory
   │                  │
   │                  ▼
   │        lib/browser.ts ── Playwright: login → Search Jobs → type → click Search → read page
   │
   └─ reflection step ── DeepSeek decides what to remember → writes to Letta
            • user profile & preferences (per user)
            • history notes (per user)
            • general search lessons (shared by ALL users = self-learning)
```

## 1. Run it in VS Code

```bash
npm install
cp .env.example .env.local        # Windows: copy .env.example .env.local
```
Fill in `.env.local`:
- `DEEPSEEK_API_KEY` – from platform.deepseek.com
- `LETTA_API_KEY` – from app.letta.com (leave empty to run without memory)
- `BROWSER_HEADFUL=true` – watch the agent in a real Chrome window (needs Google Chrome installed)

**Step A – test the browser alone first** (no AI cost):
```bash
# Mac/Linux
MFJ_IC=900101145678 MFJ_PW=yourpassword npm run test:browser -- "IT Lecturer" "Kuala Lumpur"
# Windows PowerShell
$env:MFJ_IC="900101145678"; $env:MFJ_PW="yourpassword"; npm run test:browser -- "IT Lecturer" "Kuala Lumpur"
```
If a step stalls, right-click the element on the site → Inspect, and fix that entry in
`SELECTORS` at the top of `lib/browser.ts`. Repeat until `test-result.jpg` shows the results.

**Step B – run the full app:** `npm run dev` → http://localhost:3000
(or press F5 → "Next.js: debug full stack" to use breakpoints).

## 2. Deploy to Vercel

```bash
npm i -g vercel
vercel            # first time: link the project
vercel --prod
```
Then in Vercel → Project → Settings → Environment Variables, add the same variables as
`.env.local` (but **not** `BROWSER_HEADFUL`). Region is set to Singapore (`sin1`) in `vercel.json`,
closest to Malaysia.

After the first chat, check the Vercel logs for
`Set LETTA_GLOBAL_AGENT_ID=agent-…` and add that variable, so all users share one learning brain.

### Browser on Vercel – two options
| Option | Setup | Notes |
|---|---|---|
| **@sparticuz/chromium** (default) | nothing | Free. Cold start +5–10 s. Hobby plan limit is 60 s per request, so login + search must finish within that. |
| **Hosted Chrome** (recommended) | set `BROWSER_WS_ENDPOINT` (e.g. Browserless, Browserbase) | Faster, more reliable, survives anti-bot checks better. Small monthly cost. |

If searches time out on Hobby, use a hosted Chrome or upgrade to Pro and raise `maxDuration`
in `app/api/chat/route.ts` and `vercel.json`.

## 3. How the self-learning works

| Memory | Where | Example |
|---|---|---|
| Profile | Letta core block `human` (per user) | `Education: Degree, Computer Science` |
| Preferences | Letta core block `preferences` | `Liked: Lecturer – UNITAR` |
| History | Letta archival memory (per user) | `[2026-11-02] Searched IT Lecturer KL, 14 jobs` |
| Lessons | Letta archival memory (global agent) | `'IT Lecturer' gave 0 in KL; 'Pensyarah' gave 14` |

- Before every reply, relevant memories are searched and put into DeepSeek's system prompt.
- After every reply, a reflection call updates the profile and stores new lessons.
- 👍 / 👎 buttons under each job list write directly to the user's preferences.
- The user's memory id is saved in their browser (`localStorage`), so they're recognised next visit.
  "Start fresh on this device" forgets it.

## 4. Files

| File | What it does |
|---|---|
| `app/page.tsx`, `app/globals.css` | Chat UI, login panel, live "Agent view" screenshots, Memory tab |
| `app/api/chat/route.ts` | Streams agent progress as NDJSON |
| `app/api/feedback/route.ts` | Stores 👍/👎 |
| `lib/agent.ts` | System prompt, tools, DeepSeek loop, reflection |
| `lib/browser.ts` | Playwright automation + `SELECTORS` |
| `lib/memory.ts` | Letta REST calls (blocks, archival memory, global lessons) |
| `scripts/test-browser.ts` | Test login + search without AI |

## 5. Security & rules – read before going public

- The IC number and password are sent to your server over HTTPS for one request, used by the
  browser, and dropped. They are never logged, stored in Letta, or sent to DeepSeek.
  Still, a public app that collects other people's government-portal passwords is a big
  responsibility under **PDPA 2010**: add HTTPS-only, a privacy notice, consent, and rate limiting.
- DeepSeek models receive page text from the site (job listings), so job data leaves Malaysia
  to DeepSeek's servers. Mention this in your privacy notice.
- **myfuturejobs.gov.my's robots.txt disallows automated access.** Personal, low-volume use of your
  own account is one thing; a public service that logs in for many users is another. Contact
  PERKESO / MYFutureJobs about an official API or partnership before launching publicly.
- The agent never clicks **Apply** – the user always applies themselves.
