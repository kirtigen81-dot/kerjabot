/**
 * Letta long-term memory, called over Letta's REST API with plain fetch
 * (the Letta SDK packages change often; the REST paths are stable).
 *
 * Two kinds of memory:
 *   1. USER memory   – one Letta agent per job seeker.
 *        core block "human"       : profile (education, skills, interests, location, salary)
 *        core block "preferences" : liked / disliked jobs, companies, deal-breakers
 *        archival passages        : history of searches and feedback
 *   2. GLOBAL memory – one shared Letta agent (LETTA_GLOBAL_AGENT_ID). Its core block "playbook"
 *        can store the ACE playbook (lib/ace.ts) when Upstash Redis is not configured.
 *
 * Shared self-learning lives in lib/ace.ts; Letta keeps PERSONAL memory only.
 *
 * If LETTA_API_KEY is not set, every function quietly does nothing.
 */

const BASE = (process.env.LETTA_BASE_URL || "https://api.letta.com").replace(/\/$/, "");
const KEY = process.env.LETTA_API_KEY;
export const memoryEnabled = Boolean(KEY);

async function letta<T = unknown>(path: string, init: RequestInit = {}): Promise<T | null> {
  if (!KEY) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[letta] ${init.method || "GET"} ${path} -> ${res.status} ${await res.text()}`);
      return null;
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  } catch (err) {
    console.warn("[letta] request failed", err);
    return null;
  }
}

const EMPTY_PROFILE = "Education: ?\nField of study: ?\nSkills: ?\nExperience: ?\nInterests: ?\nPreferred location: ?\nExpected salary: ?\nLanguage: ?";

async function createAgent(kind: "user" | "global"): Promise<string | null> {
  const body: Record<string, unknown> = {
    name: kind === "global" ? "kerjabot-global-brain" : `kerjabot-user-${Date.now()}`,
    memory_blocks:
      kind === "global"
        ? [{ label: "persona", value: "Shared memory of KerjaBot: lessons about searching MYFutureJobs effectively.", limit: 2000 }]
        : [
            { label: "human", value: EMPTY_PROFILE, limit: 3000 },
            { label: "preferences", value: "Liked: -\nDisliked: -\nDeal-breakers: -", limit: 3000 },
          ],
  };
  if (process.env.LETTA_AGENT_MODEL) body.model = process.env.LETTA_AGENT_MODEL;
  if (process.env.LETTA_EMBEDDING) body.embedding = process.env.LETTA_EMBEDDING;
  const agent = await letta<{ id: string }>("/v1/agents/", { method: "POST", body: JSON.stringify(body) });
  return agent?.id ?? null;
}

/** Returns an existing user memory id, or creates a new one. */
export async function ensureUserMemory(memoryId?: string | null): Promise<string | null> {
  if (!memoryEnabled) return null;
  if (memoryId && /^agent-[\w-]+$/.test(memoryId)) {
    const ok = await letta(`/v1/agents/${memoryId}/core-memory/blocks/human`);
    if (ok) return memoryId;
  }
  return createAgent("user");
}

let globalIdCache: string | null = process.env.LETTA_GLOBAL_AGENT_ID || null;
async function globalId(): Promise<string | null> {
  if (!memoryEnabled) return null;
  if (!globalIdCache) {
    globalIdCache = await createAgent("global");
    if (globalIdCache) {
      console.log(`[letta] Created global memory. Set LETTA_GLOBAL_AGENT_ID=${globalIdCache} in your env vars.`);
    }
  }
  return globalIdCache;
}

/** Reads a core block of the global agent ("" if missing). */
export async function getGlobalBlock(label: string): Promise<string> {
  const gid = await globalId();
  return gid ? getBlock(gid, label) : "";
}

/** Writes a core block of the global agent, creating and attaching it the first time. */
export async function setGlobalBlock(label: string, value: string): Promise<boolean> {
  const gid = await globalId();
  if (!gid) return false;
  const existing = await letta(`/v1/agents/${gid}/core-memory/blocks/${label}`);
  if (existing) {
    return Boolean(await letta(`/v1/agents/${gid}/core-memory/blocks/${label}`, { method: "PATCH", body: JSON.stringify({ value, limit: 60_000 }) }));
  }
  const block = await letta<{ id: string }>("/v1/blocks/", { method: "POST", body: JSON.stringify({ label, value, limit: 60_000 }) });
  if (!block?.id) return false;
  return Boolean(await letta(`/v1/agents/${gid}/core-memory/blocks/attach/${block.id}`, { method: "PATCH" }));
}

export async function getBlock(agentId: string, label: string): Promise<string> {
  const b = await letta<{ value: string }>(`/v1/agents/${agentId}/core-memory/blocks/${label}`);
  return b?.value ?? "";
}

export async function setBlock(agentId: string, label: string, value: string) {
  await letta(`/v1/agents/${agentId}/core-memory/blocks/${label}`, {
    method: "PATCH",
    body: JSON.stringify({ value }),
  });
}

export async function addPassage(agentId: string, text: string, tags: string[] = []) {
  await letta(`/v1/agents/${agentId}/archival-memory`, {
    method: "POST",
    body: JSON.stringify({ text, tags }),
  });
}

export async function searchPassages(agentId: string, query: string, topK = 5): Promise<string[]> {
  const q = new URLSearchParams({ query, top_k: String(topK) });
  const r = await letta<{ results: { content: string }[] }>(`/v1/agents/${agentId}/archival-memory/search?${q}`);
  return r?.results?.map((p) => p.content) ?? [];
}

/** Everything the agent should "remember" about this user before answering. */
export async function loadContext(userMemoryId: string | null, query: string) {
  if (!memoryEnabled || !userMemoryId) return { profile: "", preferences: "", history: [] as string[] };
  const [profile, preferences, history] = await Promise.all([
    getBlock(userMemoryId, "human"),
    getBlock(userMemoryId, "preferences"),
    searchPassages(userMemoryId, query, 5),
  ]);
  return { profile, preferences, history };
}
