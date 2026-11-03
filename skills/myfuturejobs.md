# Skill: MYFutureJobs Job Search Agent
Website: https://myfuturejobs.gov.my/
Follow these steps IN ORDER every time the user asks for jobs (e.g. "IT job in KL").

## Step 0: Understand the request
From the user's message, get:
- keyword = job title (remove words: search, find, cari, job, jobs, kerja, any, in, di, at)
- location = city/state. Short forms: KL → Kuala Lumpur, PJ → Petaling Jaya,
  JB → Johor Bahru, Penang → Pulau Pinang, KK → Kota Kinabalu. Empty if not given.
- number of jobs = 5 by default (max 10)
Example: "IT job in KL" → keyword "IT", location "Kuala Lumpur"
Example: "kerja cikgu di Johor Bahru" → keyword "cikgu", location "Johor Bahru"
No job given at all → ask: "Which job are you looking for?"

## Step 1: Open the website
Go to https://myfuturejobs.gov.my/
Ignore the big banner (job adverts like "Peluang Kerjaya") and the chat avatar at the bottom right.

## Step 2: Click Login
Click the navy **"Login"** button at the top right (next to "EN | BM").
Never click the orange **"For Employers"** button.
Skip Steps 2–3 if already logged in (the top menu shows "Match Jobs", "Search Jobs", "My Jobs", "Profile").

## Step 3: Log in (use the `login` tool, never type secrets yourself)
The login page ("Log Masuk" / "Login") has:
- **Nombor Kad Pengenalan** (IC number), placeholder "Nombor Kad Pengenalan anda tanpa (-)":
  the IC number WITHOUT dashes
- **Kata Laluan** (password), placeholder "Masukkan kata laluan anda"
- Orange button **"Log Masuk"** (or "Login" in English)
The `login` tool fills these from saved settings and clicks Log Masuk.
Never ask the user for their IC or password in chat, and never repeat them.
Never click "Lupa Kata Laluan" or "Daftar Sekarang".
If login fails or a CAPTCHA/OTP appears: stop and tell the user.

## Step 4: Go to Search Jobs
After login, the site opens **"Match Jobs"**, which often shows "0 Matched Jobs" / "No jobs found".
That is normal. Do NOT report "no jobs".
Click **"Search Jobs"** in the top menu (between "Match Jobs" and "My Jobs").

## Step 5: Search
In the **Discover Jobs** bar:
1. Job box, placeholder **"E.g. Sales Assistant"**: clear it, type the keyword.
2. Location box, placeholder **"E.g. Kuala Lumpur"**: clear it, type the location
   (if a suggestion list appears, click the matching place). Leave empty if no location.
3. Click the navy **"Search"** button.
4. Read the page and check the number "<n> Jobs Available".
Use "More Options → Select Filter" only if the user asks for a filter.
If 0 jobs or results don't match the keyword: try ONE related keyword and tell the user
(e.g. "IT" → "IT Support", "IT lecturer" → "lecturer").

## Step 6: Open and read jobs
Left side = list of job cards (title, company, location, contract + hours, posted date).
Right side = details of the clicked job.
For each of the first N jobs that match the keyword (skip duplicates/unrelated):
1. Click the job title on the left.
2. Read the right panel: title, company, location, open positions, how many applied,
   Contract, Working Hours, Occupation, Salary, Education, Sector, description, requirements.
   Scroll the right panel once if the description is cut off.

## Step 7: Explain to the user
First line: "I found N <keyword> jobs in <location>."
Then each job:

**1. <Job title>** — <Company>
- 📍 Location · Contract · Hours · 💰 Salary · openings · applicants
- **What the job is:** 1–2 simple sentences
- **Daily work:** main duties
- **They want:** education, skills, experience
- **Fit: X/10.** reason (from MY PROFILE if given) · ⚠ red flag if any

End with **Overall:** salary range seen, most common requirement, best match + one tip.
Reply in Bahasa Melayu if the user writes in Malay. Salary exactly as shown
(e.g. "RM 3,200 (Negotiable)"). Use "not stated" when missing. Never invent details.

## Rules (always)
- NEVER click **"Apply"**, **"Save"**, the bookmark icon, or the share icon unless the user clearly asks.
- Never change Profile or Settings, or click "Go to Profile".
- Never show or type the IC number or password in chat.
- If a button or box is not found: read the page, try once more, then tell the user what you see.
- Follow-ups ("explain job 2", "compare 1 and 3", "next 5"): use earlier results, no new login.
