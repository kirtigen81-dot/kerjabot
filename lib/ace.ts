/**
 * ACE – Agentic Context Engineering: KerjaBot improves itself without retraining by keeping a
 * shared PLAYBOOK of small lessons ("bullets") with helpful/harmful counters.
 *
 *   Generator = the normal agent run (lib/agent.ts), sees the most relevant bullets via prepare()
 *   Reflector = reflect(): an LLM reviews the run, tags bullets, extracts 0-3 new lessons
 *   Curator   = curate():  an LLM turns lessons into small ADD / UPDATE / REMOVE deltas
 *   Merge     = merge():   plain code applies counters + deltas and cleans up
 *
 * The LLM never rewrites the whole playbook (that causes "context collapse"), only small deltas.
 * The playbook is SHARED by all users, so it must never contain personal data (see sanitize()).
 * Every failure here is caught and logged – ACE must never break a chat.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deepseek } from "./deepseek";
import * as memory from "./memory";

// ---------- types ----------

export const SECTIONS = ["search_strategies", "site_navigation", "job_matching", "explanation_style", "mistakes_to_avoid"] as const;
export type Section = (typeof SECTIONS)[number];

export type Bullet = {
  id: string; // e.g. "sea-00012"
  section: Section;
  content: string;
  helpful: number;
  harmful: number;
  uses: number;
  createdAt: string;
  updatedAt: string;
};
export type Playbook = { version: number; nextId: number; bullets: Bullet[] };

/** outcome = short summary; includes "N jobs" or "FAILED: reason" */
export type TrajectoryStep = { tool: string; args: Record<string, unknown>; outcome: string };
export type Trajectory = { userMessage: string; answer: string; steps: TrajectoryStep[]; shownBulletIds: string[]; signals: string[] };

export type Delta = { type: "ADD"; section: Section; content: string } | { type: "UPDATE"; id: string; content: string } | { type: "REMOVE"; id: string };

export type Reflection = {
  diagnosis: string;
  bullet_tags: { id: string; tag: "helpful" | "harmful" | "neutral" }[];
  lessons: { section: Section; content: string }[];
};

// ---------- config ----------

const ENABLED = (process.env.ACE_ENABLED ?? "true").toLowerCase() !== "false";
const MODEL = process.env.ACE_MODEL || process.env.DEEPSEEK_MODEL || "deepseek-flash";
const MAX_BULLETS = Number(process.env.ACE_MAX_BULLETS) || 80;
const BULLETS_IN_PROMPT = Number(process.env.ACE_BULLETS_IN_PROMPT) || 15;
const SIMILAR = 0.75; // token-Jaccard threshold for "same lesson"
const MAX_CONTENT = 240;

const emptyPlaybook = (): Playbook => ({ version: 0, nextId: 1, bullets: [] });

// ---------- storage: Upstash Redis -> Letta global block -> local file (dev) -> memory ----------

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_KEY = "kerjabot:ace:playbook";
const FILE = path.join(process.cwd(), ".data", "ace-playbook.json");
const LETTA_BLOCK = "playbook";

type Store = { name: string; load: () => Promise<Playbook | null>; save: (pb: Playbook) => Promise<void> };

const stores: Store[] = [];
if (REDIS_URL && REDIS_TOKEN) {
  stores.push({
    name: "upstash",
    async load() {
      const res = await fetch(`${REDIS_URL}/get/${encodeURIComponent(REDIS_KEY)}`, {
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`GET ${res.status}`);
      const { result } = (await res.json()) as { result: string | null };
      return result ? (JSON.parse(result) as Playbook) : null;
    },
    async save(pb) {
      const res = await fetch(`${REDIS_URL}/set/${encodeURIComponent(REDIS_KEY)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
        body: JSON.stringify(pb),
      });
      if (!res.ok) throw new Error(`SET ${res.status}`);
    },
  });
}
if (memory.memoryEnabled && process.env.LETTA_GLOBAL_AGENT_ID) {
  stores.push({
    name: "letta",
    async load() {
      const raw = await memory.getGlobalBlock(LETTA_BLOCK);
      return raw ? (JSON.parse(raw) as Playbook) : null;
    },
    async save(pb) {
      if (!(await memory.setGlobalBlock(LETTA_BLOCK, JSON.stringify(pb)))) throw new Error("block write failed");
    },
  });
}
if (!process.env.VERCEL) {
  stores.push({
    name: "file",
    async load() {
      try {
        return JSON.parse(await readFile(FILE, "utf8")) as Playbook;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async save(pb) {
      await mkdir(path.dirname(FILE), { recursive: true });
      await writeFile(FILE, JSON.stringify(pb, null, 2), "utf8");
    },
  });
}
let inMemory: Playbook | null = null; // last resort, and a cache when every store fails

export async function loadPlaybook(): Promise<Playbook> {
  for (const s of stores) {
    try {
      const pb = await s.load();
      return normalise(pb ?? inMemory ?? emptyPlaybook());
    } catch (err) {
      console.warn(`[ace] load from ${s.name} failed:`, (err as Error).message);
    }
  }
  return normalise(inMemory ?? emptyPlaybook());
}

export async function savePlaybook(pb: Playbook): Promise<void> {
  inMemory = pb;
  for (const s of stores) {
    try {
      await s.save(pb);
      return;
    } catch (err) {
      console.warn(`[ace] save to ${s.name} failed:`, (err as Error).message);
    }
  }
  if (stores.length) console.warn("[ace] playbook kept in memory only");
}

/** Repairs anything malformed read from storage. */
function normalise(pb: Playbook): Playbook {
  const bullets = (Array.isArray(pb.bullets) ? pb.bullets : []).filter(
    (b) => b && typeof b.id === "string" && typeof b.content === "string" && SECTIONS.includes(b.section),
  );
  const maxId = Math.max(0, ...bullets.map((b) => Number(b.id.split("-")[1]) || 0));
  return { version: Number(pb.version) || 0, nextId: Math.max(Number(pb.nextId) || 1, maxId + 1), bullets };
}

// ---------- text helpers ----------

const STOP = new Set(
  "the a an and or of to in for on at is are be with from by it this that these those as was were job jobs kerja cari di dan yang untuk saya nak ke dalam ada atau dengan".split(" "),
);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !STOP.has(t)),
  );
}

export function similarity(a: string, b: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const t of A) if (B.has(t)) both++;
  return both / (A.size + B.size - both);
}

const BLOCKED = [
  /\b\d{6}-?\d{2}-?\d{4}\b/, // Malaysian IC
  /[\w.+-]+@[\w-]+\.[\w.]+/, // email
  /(\+?6?0)[\s-]?1\d[\s-]?\d{3,4}[\s-]?\d{4}\b/, // MY mobile number
  /(\+?6?0)[\s-]?[3-9][\s-]?\d{3,4}[\s-]?\d{4}\b/, // MY landline
  /password|kata\s*laluan/i,
  /auto[\s-]?apply/i,
  /ignore\s+(all\s+)?previous/i,
  /system\s+prompt/i,
];

/** Clean a lesson for the shared playbook, or null if it must not be stored. */
export function sanitize(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const clean = text.replace(/\s+/g, " ").trim().slice(0, MAX_CONTENT).trim();
  if (clean.length < 8) return null;
  if (BLOCKED.some((re) => re.test(clean))) return null;
  return clean;
}

const net = (b: Bullet) => b.helpful - b.harmful;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// ---------- generator side ----------

/** Picks the most relevant bullets for this query and formats them for the system prompt. */
export async function prepare(query: string): Promise<{ playbook: Playbook; shown: Bullet[]; promptText: string }> {
  if (!ENABLED) return { playbook: emptyPlaybook(), shown: [], promptText: "" };
  const playbook = await loadPlaybook();
  const q = tokens(query);
  const scored = playbook.bullets
    .map((b) => {
      let overlap = 0;
      for (const t of tokens(b.content)) if (q.has(t)) overlap++;
      const bonus = b.section === "mistakes_to_avoid" || b.section === "site_navigation" ? 1 : 0;
      return { b, score: overlap * 2 + clamp(net(b), -3, 5) + bonus };
    })
    .filter((x) => x.score > -2)
    .sort((x, y) => y.score - x.score)
    .slice(0, BULLETS_IN_PROMPT);
  const shown = scored.map((x) => x.b);

  const promptText = SECTIONS.map((section) => {
    const items = shown.filter((b) => b.section === section);
    if (!items.length) return "";
    return `${section}:\n${items.map((b) => `[${b.id}] helpful=${b.helpful} harmful=${b.harmful} :: ${b.content}`).join("\n")}`;
  })
    .filter(Boolean)
    .join("\n\n");
  return { playbook, shown, promptText };
}

/** Execution feedback from the run itself – no labels needed. */
export function detectSignals(userMessage: string, steps: TrajectoryStep[], previousAnswer = ""): string[] {
  const signals: string[] = [];
  const seen = new Set<string>();
  for (const s of steps) {
    const key = `${s.tool}|${JSON.stringify(s.args)}`;
    if (seen.has(key)) signals.push(`Repeated the same search (wasted time): ${s.tool} ${JSON.stringify(s.args)}`);
    seen.add(key);
    if (/FAILED|error|timeout|timed out/i.test(s.outcome)) signals.push(`${s.tool} failed: ${s.outcome.slice(0, 160)}`);
    const n = s.outcome.match(/([\d,]+) jobs/i)?.[1];
    if (n !== undefined) {
      const count = Number(n.replace(/,/g, ""));
      signals.push(count === 0 ? `search ${JSON.stringify(s.args)} returned NO jobs` : `search ${JSON.stringify(s.args)} returned ${count} jobs`);
    }
  }
  if (previousAnswer && /\b(bukan|salah|tak sesuai|tidak sesuai|not what|wrong)\b/i.test(userMessage)) {
    signals.push("User said previous answer was not what they wanted");
  }
  return signals;
}

// ---------- reflector ----------

async function json<T>(prompt: string, temperature: number): Promise<T> {
  const res = await deepseek().chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature,
    max_tokens: 1500,
  });
  return JSON.parse(res.choices[0].message.content || "{}") as T;
}

const isSection = (s: unknown): s is Section => SECTIONS.includes(s as Section);

export async function reflect(trajectory: Trajectory, shownBullets: Bullet[]): Promise<Reflection> {
  const prompt = `You are the REFLECTOR of KerjaBot, an AI agent that searches MYFutureJobs (Malaysia's job portal)
with browser tools. Review one run and improve the shared playbook of lessons.

USER MESSAGE: ${trajectory.userMessage.slice(0, 600)}
TOOL CALLS:
${trajectory.steps.map((s, i) => `${i + 1}. ${s.tool}(${JSON.stringify(s.args)}) -> ${s.outcome}`).join("\n") || "(none)"}
SIGNALS (execution feedback):
${trajectory.signals.map((s) => `- ${s}`).join("\n") || "(none)"}
FINAL ANSWER (truncated): ${trajectory.answer.slice(0, 1200)}

PLAYBOOK BULLETS SHOWN TO THE AGENT:
${shownBullets.map((b) => `[${b.id}] (${b.section}) ${b.content}`).join("\n") || "(none)"}

Return JSON:
{"diagnosis": "1-2 sentences: what went well or wrong and why",
 "bullet_tags": [{"id": "<shown bullet id>", "tag": "helpful"|"harmful"|"neutral"}],
 "lessons": [{"section": one of ${SECTIONS.map((s) => `"${s}"`).join(", ")}, "content": "one sentence"}]}

Rules:
- Tag only bullets listed above; "helpful" if it clearly helped this run, "harmful" if following it hurt.
- 0-3 lessons. Each must be concrete and reusable for OTHER users, e.g.
  "For accounting jobs in Johor Bahru, also search 'Akaun'." or "If a search returns 0 jobs, retry once with the Malay job title."
- No personal data (names, IC, phone, email, the user's own background).
- Do not repeat an existing bullet – tag it helpful instead.
- Never suggest applying for jobs, bypassing login or revealing credentials.
- If nothing new was learned, return "lessons": [].`;

  const out = await json<Partial<Reflection>>(prompt, 0.2);
  const shownIds = new Set(shownBullets.map((b) => b.id));
  return {
    diagnosis: typeof out.diagnosis === "string" ? out.diagnosis.slice(0, 300) : "",
    bullet_tags: (out.bullet_tags ?? []).filter((t) => shownIds.has(t?.id) && ["helpful", "harmful", "neutral"].includes(t?.tag)),
    lessons: (out.lessons ?? [])
      .filter((l) => isSection(l?.section) && typeof l?.content === "string")
      .slice(0, 3),
  };
}

// ---------- curator ----------

export async function curate(playbook: Playbook, reflection: Reflection): Promise<Delta[]> {
  if (!reflection.lessons.length) return [];
  const fallback = (): Delta[] => reflection.lessons.map((l) => ({ type: "ADD", section: l.section, content: l.content }));

  const blocks = reflection.lessons.map((l, i) => {
    const near = playbook.bullets
      .map((b) => ({ b, s: similarity(l.content, b.content) }))
      .sort((x, y) => y.s - x.s)
      .slice(0, 5)
      .filter((x) => x.s > 0);
    return `LESSON ${i + 1} (${l.section}): ${l.content}
  most similar existing bullets:
${near.map((x) => `  [${x.b.id}] (${x.b.section}, helpful=${x.b.helpful} harmful=${x.b.harmful}) ${x.b.content}`).join("\n") || "  (none)"}`;
  });

  const prompt = `You are the CURATOR of KerjaBot's shared playbook. Turn new lessons into small edit operations.
Never rewrite the playbook; only output deltas.

${blocks.join("\n\n")}

Return JSON: {"operations": [
  {"type": "ADD", "section": "<section>", "content": "<one sentence>"} |
  {"type": "UPDATE", "id": "<existing id>", "content": "<improved one sentence>"} |
  {"type": "REMOVE", "id": "<existing id that the lesson proves wrong>"} ]}
Rules: max 5 operations. Prefer UPDATE of a similar bullet over a near-duplicate ADD.
One sentence per bullet, at most 220 characters, no personal data. Sections: ${SECTIONS.join(", ")}.
If a lesson adds nothing, skip it.`;

  try {
    const out = await json<{ operations?: Partial<Delta & { section: string; content: string; id: string }>[] }>(prompt, 0);
    const ids = new Set(playbook.bullets.map((b) => b.id));
    const ops: Delta[] = [];
    for (const o of out.operations ?? []) {
      if (o.type === "ADD" && isSection(o.section) && typeof o.content === "string") ops.push({ type: "ADD", section: o.section, content: o.content });
      else if (o.type === "UPDATE" && typeof o.id === "string" && ids.has(o.id) && typeof o.content === "string") ops.push({ type: "UPDATE", id: o.id, content: o.content });
      else if (o.type === "REMOVE" && typeof o.id === "string" && ids.has(o.id)) ops.push({ type: "REMOVE", id: o.id });
    }
    return ops.slice(0, 5);
  } catch (err) {
    console.warn("[ace] curator failed, adding lessons as-is:", (err as Error).message);
    return fallback();
  }
}

// ---------- merge (deterministic, no LLM) ----------

export function merge(playbook: Playbook, reflection: Reflection, deltas: Delta[]): string[] {
  const notes: string[] = [];
  const now = new Date().toISOString();
  const byId = () => new Map(playbook.bullets.map((b) => [b.id, b]));

  // 1. counters from the reflector's tags
  const map = byId();
  for (const t of reflection.bullet_tags) {
    const b = map.get(t.id);
    if (!b || t.tag === "neutral") continue;
    if (t.tag === "helpful") b.helpful++;
    else b.harmful++;
    b.updatedAt = now;
  }

  // 2. deltas
  for (const d of deltas) {
    if (d.type === "ADD") {
      const content = sanitize(d.content);
      if (!content) continue;
      const twin = playbook.bullets.find((b) => similarity(b.content, content) >= SIMILAR);
      if (twin) {
        twin.helpful++;
        twin.updatedAt = now;
        continue;
      }
      const id = `${d.section.slice(0, 3)}-${String(playbook.nextId++).padStart(5, "0")}`;
      playbook.bullets.push({ id, section: d.section, content, helpful: 1, harmful: 0, uses: 0, createdAt: now, updatedAt: now });
      notes.push(`Learned: ${content}`);
    } else if (d.type === "UPDATE") {
      const b = byId().get(d.id);
      const content = sanitize(d.content);
      if (!b || !content || content === b.content) continue;
      b.content = content;
      b.updatedAt = now;
      notes.push(`Refined: ${content}`);
    } else {
      const before = playbook.bullets.length;
      playbook.bullets = playbook.bullets.filter((b) => b.id !== d.id);
      if (playbook.bullets.length < before) notes.push(`Forgot a lesson that did not work (${d.id})`);
    }
  }

  // 3. de-duplicate within each section: counters go to the older bullet
  const oldestFirst = [...playbook.bullets].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const kept: Bullet[] = [];
  for (const b of oldestFirst) {
    const older = kept.find((k) => k.section === b.section && similarity(k.content, b.content) >= SIMILAR);
    if (older) {
      older.helpful += b.helpful;
      older.harmful += b.harmful;
      older.uses += b.uses;
      older.updatedAt = now;
    } else kept.push(b);
  }

  // 4. prune bullets that keep hurting, 5. cap the size (lowest net score, oldest first)
  let bullets = kept.filter((b) => b.harmful < b.helpful + 3);
  if (bullets.length > MAX_BULLETS) {
    const drop = new Set(
      [...bullets]
        .sort((a, b) => net(a) - net(b) || a.createdAt.localeCompare(b.createdAt))
        .slice(0, bullets.length - MAX_BULLETS)
        .map((b) => b.id),
    );
    bullets = bullets.filter((b) => !drop.has(b.id));
  }
  playbook.bullets = bullets;
  playbook.version++;
  return notes;
}

// ---------- entry points ----------

export async function learnFromRun(trajectory: Trajectory): Promise<string[]> {
  if (!ENABLED) return [];
  try {
    const playbook = await loadPlaybook(); // fresh copy: other runs may have changed it
    const byId = new Map(playbook.bullets.map((b) => [b.id, b]));
    const shown = trajectory.shownBulletIds.map((id) => byId.get(id)).filter((b): b is Bullet => Boolean(b));
    for (const b of shown) b.uses++;

    const reflection = await reflect(trajectory, shown);
    const deltas = await curate(playbook, reflection);
    const notes = merge(playbook, reflection, deltas);
    await savePlaybook(playbook);
    console.log(`[ace] v${playbook.version} bullets=${playbook.bullets.length} deltas=${deltas.length} :: ${reflection.diagnosis}`);
    return notes;
  } catch (err) {
    console.warn("[ace] learnFromRun failed:", (err as Error).message);
    return [];
  }
}

export async function learnFromFeedback(jobTitle: string, liked: boolean): Promise<string[]> {
  const title = sanitize(jobTitle) ?? "a recommended job";
  return learnFromRun({
    userMessage: `(feedback) The user rated a recommended job: ${title}`,
    answer: "",
    steps: [],
    shownBulletIds: [],
    signals: [`User ${liked ? "LIKED" : "DISLIKED"} the recommended job "${title}"`],
  });
}
