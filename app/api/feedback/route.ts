import * as ace from "@/lib/ace";
import { recordFeedback } from "@/lib/agent";
import { memoryEnabled } from "@/lib/memory";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { memoryId, job, liked } = (await req.json().catch(() => ({}))) as {
    memoryId?: string;
    job?: string;
    liked?: boolean;
  };
  if (!job) return Response.json({ ok: false });
  const title = String(job).slice(0, 300);

  // Shared playbook learns from every 👍/👎, even without a personal Letta memory
  const [learned] = await Promise.all([
    ace.learnFromFeedback(title, Boolean(liked)).catch(() => [] as string[]),
    memoryEnabled && memoryId ? recordFeedback(memoryId, title, Boolean(liked)) : Promise.resolve(),
  ]);
  return Response.json({ ok: true, learned });
}
