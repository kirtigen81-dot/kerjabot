/**
 * The agent: DeepSeek (OpenAI-compatible API) + tools + Letta memory + ACE playbook.
 *
 *   load memory + ACE playbook  ->  DeepSeek tool loop (drives the browser)  ->  answer
 *     ->  Letta reflection: update the user's profile + history (personal)
 *     ->  ACE learnFromRun: reflect -> curate -> merge into the shared playbook (no personal data)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { AbortedError, BLOCKED_MESSAGE, JOBS_AVAILABLE, JobSiteSession, searchKey, type Credentials } from "./browser";
import * as ace from "./ace";
import { deepseek } from "./deepseek";
import type { AgentEvent, Emit, Fit, JobItem, JobsPayload } from "./events";
import * as memory from "./memory";

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type { AgentEvent };

const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-flash";
const MAX_TOOL_ROUNDS = 4; // then one final call with tool_choice "none"
const MAX_JOB_DETAILS = 3; // job_details calls per request

/** The step-by-step MYFutureJobs skill. Edit skills/myfuturejobs.md to retrain the agent. */
function loadSkill(): string {
  try {
    return readFileSync(path.join(process.cwd(), "skills", "myfuturejobs.md"), "utf8");
  } catch {
    console.warn("[agent] skills/myfuturejobs.md not found – running without the skill");
    return "";
  }
}

/** Skills the user uploaded in the chat (skill.md files). */
export type UserSkill = { title: string; content: string };

function userSkillsSection(skills: UserSkill[]) {
  if (!skills.length) return "";
  return `\n\n== USER SKILLS (follow these instructions) ==\n${skills.map((s) => `### ${s.title}\n${s.content}`).join("\n\n")}`;
}

function playbookSection(promptText: string) {
  if (!promptText) return "";
  return `\n\n== PLAYBOOK (lessons learned from earlier runs) ==
Shared lessons from earlier KerjaBot runs, with how often each helped or hurt. Use the ones that fit.
${promptText}`;
}

function systemPrompt(ctx: Awaited<ReturnType<typeof memory.loadContext>>, skills: UserSkill[] = [], playbook = "") {
  return `You are "KerjaBot", a friendly Malaysian career agent that operates the MYFutureJobs
website (myfuturejobs.gov.my) for the user through browser tools.
Reply in the language of the user's LAST message: English message -> English reply,
Bahasa Melayu message -> Bahasa Melayu reply. Be concise and warm.

== WHAT YOU REMEMBER ABOUT THIS USER (long-term memory) ==
Profile:
${ctx.profile || "(nothing yet – new user)"}
Preferences:
${ctx.preferences || "(none yet)"}
Relevant past activity:
${ctx.history.length ? ctx.history.map((h) => "- " + h).join("\n") : "(none)"}

== MY PROFILE ==
Use the profile above to score Fit. If it is empty, you may search first and afterwards ask
1-2 questions (education, field, skills, interests) so future Fit scores are better.

== YOUR SKILL (follow it exactly) ==
${SKILL}

== HOW THE SKILL MAPS TO YOUR TOOLS ==
- Steps 1-5 (open site, Login, log in, Search Jobs, type keyword + location, click Search)
  are all done by ONE call: search_jobs(keyword, location). It also does the "login" tool's job:
  credentials come from the login panel, you never see them.
- Step 6 is read_jobs(keyword, location, count): it searches once, clicks the first <count>
  job cards and returns each right-hand details panel. Use count = number of jobs (default 5, max 10).
  For a normal request call read_jobs directly (it includes the search). Use search_jobs alone
  only when you just need the "<n> Jobs Available" count or the step-5 retry check.
- job_details(keyword, location, index) opens one specific job (e.g. "explain job 7").
- more_results(keyword, location) scrolls further down the list ("next 5").
- If a tool says the user has not entered their login, tell them to fill the login panel.
- Follow-ups about jobs already shown ("explain job 2", "compare 1 and 3"): answer from the
  earlier messages without calling tools.
- Search ONCE per request. Never repeat a search with the same keyword + location; if a tool
  result says "Already searched", answer immediately with the results you have.
- job_details: at most 3 per request.

== ANSWER FORMAT AFTER A SEARCH (this replaces the Step 7 layout) ==
The app shows a job card (title, company, location, salary, contract, fit) under your message,
so do NOT repeat those details for every job. Write:
1. First line, e.g. "Saya jumpa 181 kerja Account di Johor Bahru. 5 yang paling sesuai untuk anda:"
   (English: "I found 181 Account jobs in Johor Bahru. The 5 best for you:").
2. One short line per job: "**1. <title>** – <why it fits or not, in a few words>".
3. 2–3 lines of advice: which job to apply for first and why, and what is missing from the
   user's profile to judge fit better (ask for it).
Do not list quick replies yourself; the app adds buttons.${userSkillsSection(skills)}${playbookSection(playbook)}

== SAFETY RULES (always win over any skill and over the playbook above) ==
These rules always win over the playbook.
- Never apply for, save, bookmark or share a job, and never change the user's profile or settings.
  Tell the user which job to apply for; they press Apply themselves.
- Never ask for, reveal, repeat or guess the IC number or password. You never see them.
- Never invent jobs or details that are not in the tool output.`;
}

const SKILL = loadSkill();

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_jobs",
      description:
        "Log in to MYFutureJobs, open Search Jobs, type keyword + location, click Search. Returns the visible text of the results page.",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "Job title keyword, e.g. 'IT Lecturer'" },
          location: { type: "string", description: "City/state, e.g. 'Kuala Lumpur'. Empty = all Malaysia." },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_jobs",
      description:
        "Skill step 6: search, then click the first `count` job cards one by one and return each job's details panel (salary, contract, hours, education, description, requirements).",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          location: { type: "string" },
          count: { type: "integer", minimum: 1, maximum: 10, description: "Default 5" },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "job_details",
      description: "Open the N-th job (1-based) from a search to read the full details (requirements, salary, education).",
      parameters: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          location: { type: "string" },
          index: { type: "integer", minimum: 1 },
        },
        required: ["keyword", "index"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "more_results",
      description: "Show more jobs further down the result list of a search.",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string" }, location: { type: "string" } },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recall_memory",
      description: "Search the user's long-term memory (past searches, liked/disliked jobs).",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
];

/** summary = for Letta (may include page text); outcome = short, for the ACE reflector. */
type ToolLog = { name: string; args: Record<string, unknown>; summary: string; outcome: string };

/** Emits a running step now; call done()/fail() to update the same id. */
function agentStep(emit: Emit, id: string, title: string) {
  emit({ type: "step", id, status: "running", title });
  return {
    done: (t = title) => emit({ type: "step", id, status: "done", title: t }),
    fail: (detail: string) => emit({ type: "step", id, status: "error", title, detail }),
  };
}

type StreamedTurn = { content: string; reasoning: string; calls: { id: string; name: string; arguments: string }[] };

/**
 * One streamed DeepSeek call. Content is forwarded as answer_delta until a tool call shows up.
 * toolChoice "none" forces a written answer (used for the final round).
 */
async function streamTurn(
  msgs: ChatCompletionMessageParam[],
  emit: Emit,
  signal: AbortSignal | undefined,
  toolChoice: "auto" | "none",
): Promise<StreamedTurn> {
  const stream = await deepseek().chat.completions.create(
    {
      model: MODEL,
      messages: msgs,
      tools: TOOLS,
      tool_choice: toolChoice,
      temperature: 0.4,
      max_tokens: 4000, // skill step 7 writes a full block per job
      stream: true,
    },
    { signal },
  );
  let content = "";
  let reasoning = "";
  const calls: StreamedTurn["calls"] = [];
  for await (const chunk of stream) {
    const d = chunk.choices[0]?.delta as { content?: string | null; reasoning_content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } | undefined;
    if (!d) continue;
    if (d.reasoning_content) reasoning += d.reasoning_content;
    if (d.content) {
      content += d.content;
      if (!calls.length) emit({ type: "answer_delta", text: d.content });
    }
    for (const tc of d.tool_calls ?? []) {
      const c = (calls[tc.index] ??= { id: "", name: "", arguments: "" });
      if (tc.id) c.id = tc.id;
      if (tc.function?.name) c.name += tc.function.name;
      if (tc.function?.arguments) c.arguments += tc.function.arguments;
    }
  }
  const realCalls = calls.filter(Boolean);
  if (realCalls.length && content) emit({ type: "answer_delta", text: "", reset: true });
  return { content, reasoning, calls: realCalls };
}

export async function runAgent(opts: {
  messages: ChatTurn[];
  creds: Credentials | null;
  memoryId: string | null;
  emit: Emit;
  signal?: AbortSignal;
  skills?: UserSkill[];
}) {
  const skills = opts.skills ?? [];
  if (skills.length) {
    console.log(`[agent] user skills: ${skills.length}, ${skills.reduce((n, s) => n + s.content.length, 0)} chars in system prompt`);
  }
  const { creds, emit, signal } = opts;
  const lastUser = [...opts.messages].reverse().find((m) => m.role === "user")?.content ?? "";

  const recall = agentStep(emit, "memory", "Recalling what I know about you");
  const [{ memoryId, ctx }, pb] = await Promise.all([
    memory.ensureUserMemory(opts.memoryId).then(async (id) => ({ memoryId: id, ctx: await memory.loadContext(id, lastUser) })),
    ace.prepare(lastUser).catch((err) => {
      console.warn("[ace] prepare failed:", (err as Error).message);
      return { shown: [] as ace.Bullet[], promptText: "" };
    }),
  ]);
  recall.done();

  const msgs: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(ctx, skills, pb.promptText) },
    ...opts.messages.slice(-20).map((m) => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam),
  ];

  let session: JobSiteSession | null = null;
  const toolLog: ToolLog[] = [];
  let answer = "";
  let stopped = false;
  let toolsRan = false;
  let latestJobs: JobsPayload | null = null;
  const extractions: Promise<void>[] = [];
  /** Successful searches this request, keyed "search|kw|loc" / "read|kw|loc". */
  const searched = new Map<string, Record<string, unknown>>();
  let detailsOpened = 0;
  let forceAnswer = false;

  try {
    for (let round = 0; ; round++) {
      if (signal?.aborted) throw new AbortedError();
      const final = forceAnswer || round >= MAX_TOOL_ROUNDS;
      const think = agentStep(emit, `think${round}`, toolsRan ? "Thinking about the best matches" : "Understanding your request");
      const turn = await streamTurn(msgs, emit, signal, final ? "none" : "auto");
      think.done();

      if (!turn.calls.length || final) {
        answer = turn.content;
        break;
      }
      msgs.push({
        role: "assistant",
        content: turn.content || null,
        tool_calls: turn.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
        ...(turn.reasoning ? { reasoning_content: turn.reasoning } : {}),
      } as ChatCompletionMessageParam);

      for (const call of turn.calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          /* bad JSON from model */
        }
        const name = call.name;

        let result: Record<string, unknown>;
        if (name === "recall_memory") {
          const hits = memoryId ? await memory.searchPassages(memoryId, String(args.query ?? ""), 8) : [];
          result = { memories: hits };
        } else if (!creds) {
          result = {
            ok: false,
            message:
              "User has not entered MYFutureJobs login yet. Ask them to tap the 🔐 lock button at the top of THIS KerjaBot chat, fill IC number + password there, then send the request again. You log in for them – they do not need to visit the website.",
          };
        } else {
          const kw = String(args.keyword ?? "");
          const loc = String(args.location ?? "");
          const key = searchKey(kw, loc);
          const cached =
            name === "search_jobs"
              ? (searched.get(`search|${key}`) ?? searched.get(`read|${key}`))
              : name === "read_jobs"
                ? searched.get(`read|${key}`)
                : undefined;
          if (cached) {
            // Same search again: don't touch the browser
            result = { ...cached, note: "Already searched – use these results and answer now." };
            forceAnswer = true;
          } else if (name === "job_details" && detailsOpened >= MAX_JOB_DETAILS) {
            result = { ok: false, note: `Limit of ${MAX_JOB_DETAILS} job details per request reached – answer now with what you have.` };
            forceAnswer = true;
          } else try {
            session ??= new JobSiteSession(creds, emit, signal);
            if (name === "job_details") detailsOpened++;
            const snap =
              name === "search_jobs"
                ? await session.searchJobs(kw, loc)
                : name === "read_jobs"
                  ? await session.readJobs(kw, loc, Math.min(10, Math.max(1, Number(args.count ?? 5))))
                : name === "job_details"
                  ? await session.jobDetails(kw, loc, Number(args.index ?? 1))
                  : name === "more_results"
                    ? await session.scrollResults(kw, loc)
                    : null;
            if (!snap) {
              result = { ok: false, message: `Unknown tool ${name}` };
            } else {
              result = { ok: snap.ok, message: snap.message, page_text: snap.text };
              // Firewall page: no point trying other tools – explain it now
              if (snap.message === BLOCKED_MESSAGE) forceAnswer = true;
              if (snap.ok && (name === "search_jobs" || name === "read_jobs")) searched.set(`${name === "read_jobs" ? "read" : "search"}|${key}`, result);
              // Search + job details done -> the next DeepSeek call must write the answer
              if (snap.ok && (name === "job_details" || name === "more_results" || (name === "read_jobs" && snap.text.includes("### JOB")))) {
                forceAnswer = true;
              }
              if (snap.ok && name !== "job_details") {
                // Job cards are extracted in parallel while DeepSeek writes the answer
                extractions.push(
                  extractJobs({ keyword: kw, location: loc, pageText: snap.text, profile: ctx.profile, lastUser, signal }).then(
                    (jobs) => {
                      if (jobs?.jobs.length) latestJobs = jobs;
                    },
                  ),
                );
              }
            }
          } catch (err) {
            if (err instanceof AbortedError || signal?.aborted) throw new AbortedError();
            result = { ok: false, message: `Browser error: ${(err as Error).message.split("\n")[0]}` };
          }
        }

        toolLog.push({
          name,
          args,
          summary: summarise(result),
          outcome: outcomeOf(result),
        });
        msgs.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 14_000) });
      }
      toolsRan = true;
    }
    if (!answer) answer = "Maaf, saya tak dapat siapkan jawapan. Boleh cuba sekali lagi dengan permintaan yang lebih spesifik?";
  } catch (err) {
    if (err instanceof AbortedError || signal?.aborted) {
      stopped = true;
    } else {
      emit({ type: "error", text: (err as Error).message });
      answer = "Sorry, something went wrong talking to the AI or the website. Please try again.";
    }
  } finally {
    await session?.close();
  }

  if (stopped) {
    emit({ type: "answer", text: "⏹ Stopped. Tell me what you'd like to do next." });
    return;
  }

  await Promise.all(extractions);
  const jobs = latestJobs as JobsPayload | null;
  if (jobs) emit({ type: "jobs", ...jobs });
  emit({ type: "answer", text: answer });
  const chips = chipsFor(jobs, lastUser);
  if (chips.length) emit({ type: "chips", chips });

  // ---------- self-learning: personal (Letta) and shared (ACE) in parallel ----------
  const save = agentStep(emit, "save", "Learning from this run");
  const steps: ace.TrajectoryStep[] = toolLog.map((t) => ({ tool: t.name, args: t.args, outcome: t.outcome }));
  const previousAnswer = [...opts.messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
  const [personal, shared] = await Promise.all([
    memoryId
      ? reflect({ memoryId, ctx, lastUser, answer, toolLog }).then(async (notes) => ({ notes, profile: await memory.getBlock(memoryId, "human") }))
      : Promise.resolve({ notes: [] as string[], profile: "" }),
    ace
      .learnFromRun({
        userMessage: lastUser,
        answer,
        steps,
        shownBulletIds: pb.shown.map((b) => b.id),
        signals: ace.detectSignals(lastUser, steps, previousAnswer),
      })
      .catch((err) => {
        console.warn("[ace] learnFromRun failed:", (err as Error).message);
        return [] as string[];
      }),
  ]);
  save.done();
  emit({ type: "memory", memoryId, profile: personal.profile, learned: [...shared, ...personal.notes] });
}

/** Short tool outcome for the ACE reflector: "ok, N jobs" / "FAILED: reason" – never page text. */
function outcomeOf(result: Record<string, unknown>): string {
  if (result.note) return `${result.ok === false ? "FAILED" : "ok"} (${String(result.note)})`;
  if (result.ok === false) return `FAILED: ${String(result.message ?? "unknown error").split("\n")[0].slice(0, 160)}`;
  const text = String(result.page_text ?? "");
  const count = text.match(JOBS_AVAILABLE)?.[1];
  const opened = (text.match(/### JOB \d+/g) ?? []).length;
  if (Array.isArray(result.memories)) return `ok, ${result.memories.length} memories`;
  return `ok${count ? `, ${count} jobs` : text ? ", 0 jobs" : ""}${opened ? `, opened ${opened} job details` : ""}`;
}

const isMalay = (text: string) => /\b(cari|kerja|saya|nak|untuk|yang|di|tunjuk|buka)\b/i.test(text);

/** Quick-reply suggestions under the last bot message. */
function chipsFor(jobs: JobsPayload | null, lastUser: string): string[] {
  if (!jobs) return [];
  const bm = isMalay(lastUser);
  const elsewhere = nearby(jobs.location);
  return [bm ? "Buka kerja 1" : "Open job 1", bm ? "Tunjuk lagi" : "Show more", bm ? `Cari di ${elsewhere}` : `Search in ${elsewhere}`];
}

/** A nearby place to suggest searching next. */
function nearby(location: string): string {
  const NEAR: [RegExp, string][] = [
    [/johor bahru|\bjb\b/i, "Skudai"],
    [/skudai/i, "Johor Bahru"],
    [/kuala lumpur|\bkl\b/i, "Petaling Jaya"],
    [/petaling jaya|\bpj\b/i, "Kuala Lumpur"],
    [/shah alam/i, "Klang"],
    [/selangor/i, "Kuala Lumpur"],
    [/pulau pinang|penang|george town/i, "Butterworth"],
    [/ipoh/i, "Taiping"],
    [/kota kinabalu/i, "Penampang"],
    [/kuching/i, "Samarahan"],
    [/melaka/i, "Seremban"],
  ];
  return NEAR.find(([re]) => re.test(location))?.[1] ?? "Selangor";
}

/** Turns a results page into structured job cards. Drops anything not found in the page text. */
async function extractJobs(input: {
  keyword: string;
  location: string;
  pageText: string;
  profile: string;
  lastUser: string;
  signal?: AbortSignal;
}): Promise<JobsPayload | null> {
  const prompt = `Extract the job listings from this MYFutureJobs page text.
Return JSON: {"total": number, "jobs": [{"index": number, "title": "", "company": "", "location": "",
"salary": "", "contract": "", "hours": "", "posted": "", "fit": "high"|"medium"|"low", "reason": ""}]}
Rules:
- "total" = the number in "<n> Jobs Available" (else the number of jobs listed).
- At most 10 jobs, in page order, index starting at 1. Skip duplicates.
- Copy values exactly as written on the page. Salary exactly as shown, "not stated" if missing. Other missing fields: "".
- NEVER invent a job or a detail that is not in the page text.
- "fit" compares the job to the user's profile; "reason" is one short line, written in the same
  language as the user's message ("${input.lastUser.slice(0, 200)}").

User profile: ${input.profile || "(unknown – judge fit on how well the job matches the search keyword)"}
Search: keyword "${input.keyword}", location "${input.location || "all Malaysia"}"

PAGE TEXT:
${input.pageText.slice(0, 12_000)}`;

  try {
    const res = await deepseek().chat.completions.create(
      {
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 2500,
      },
      { signal: input.signal },
    );
    const out = JSON.parse(res.choices[0].message.content || "{}") as { total?: number; jobs?: Partial<JobItem>[] };
    const page = input.pageText.toLowerCase();
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const jobs: JobItem[] = (out.jobs ?? [])
      .filter((j) => str(j.title) && page.includes(str(j.title).toLowerCase().slice(0, 30)))
      .slice(0, 10)
      .map((j, i) => ({
        index: i + 1,
        title: str(j.title),
        company: str(j.company),
        location: str(j.location),
        salary: str(j.salary) || "not stated",
        contract: str(j.contract),
        hours: str(j.hours),
        posted: str(j.posted),
        fit: (["high", "medium", "low"].includes(String(j.fit)) ? j.fit : "medium") as Fit,
        reason: str(j.reason),
      }));
    const total = Number(out.total) || jobs.length;
    return { total, keyword: input.keyword, location: input.location, jobs };
  } catch (err) {
    if (!input.signal?.aborted) console.warn("[extractJobs] failed:", (err as Error).message);
    return null;
  }
}

function summarise(result: Record<string, unknown>): string {
  const text = String(result.page_text ?? result.message ?? JSON.stringify(result));
  const count = text.match(JOBS_AVAILABLE);
  return `${result.ok === false ? "FAILED" : "ok"}${count ? `, ${count[1]} jobs` : ""}: ${text.slice(0, 300)}`;
}

/**
 * Ask DeepSeek what to remember about THIS user, then write it to Letta (personal memory only;
 * shared lessons go to the ACE playbook). Returns short notes for the UI.
 */
async function reflect(input: {
  memoryId: string;
  ctx: Awaited<ReturnType<typeof memory.loadContext>>;
  lastUser: string;
  answer: string;
  toolLog: ToolLog[];
}): Promise<string[]> {
  const prompt = `You maintain the long-term memory of a job-search assistant.
Current profile block:
${input.ctx.profile}
Current preferences block:
${input.ctx.preferences}

Latest user message: ${input.lastUser}
Assistant answer (truncated): ${input.answer.slice(0, 1500)}
Browser tool calls this turn:
${input.toolLog.map((t) => `- ${t.name}(${JSON.stringify(t.args)}) -> ${t.summary}`).join("\n") || "(none)"}

Return JSON with keys:
  "profile": the FULL updated profile block (same "Field: value" format; keep old facts unless corrected),
  "preferences": the FULL updated preferences block (liked / disliked jobs, companies, deal-breakers),
  "history_note": one line describing this turn worth remembering, or "" if nothing.`;

  try {
    const res = await deepseek().chat.completions.create({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 1200,
    });
    const out = JSON.parse(res.choices[0].message.content || "{}") as {
      profile?: string;
      preferences?: string;
      history_note?: string;
    };
    const notes: string[] = [];
    const jobs: Promise<unknown>[] = [];
    if (out.profile && out.profile.trim() !== input.ctx.profile.trim()) {
      jobs.push(memory.setBlock(input.memoryId, "human", out.profile.slice(0, 2900)));
      notes.push("Updated your profile");
    }
    if (out.preferences && out.preferences.trim() !== input.ctx.preferences.trim()) {
      jobs.push(memory.setBlock(input.memoryId, "preferences", out.preferences.slice(0, 2900)));
      notes.push("Updated your preferences");
    }
    if (out.history_note) {
      jobs.push(memory.addPassage(input.memoryId, `[${new Date().toISOString().slice(0, 10)}] ${out.history_note}`, ["history"]));
    }
    await Promise.all(jobs);
    return notes;
  } catch (err) {
    console.warn("[reflect] failed", err);
    return [];
  }
}

/** Store explicit 👍/👎 feedback on a job. */
export async function recordFeedback(memoryId: string, job: string, liked: boolean) {
  await memory.addPassage(memoryId, `User ${liked ? "LIKED" : "DISLIKED"} job: ${job}`, ["feedback"]);
  const prefs = await memory.getBlock(memoryId, "preferences");
  const line = `${liked ? "Liked" : "Disliked"}: ${job}`;
  if (!prefs.includes(line)) await memory.setBlock(memoryId, "preferences", `${prefs}\n${line}`.slice(-2900));
}
