import { loadPlaybook } from "@/lib/ace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin view of the shared ACE playbook. Requires header x-admin-token = ADMIN_TOKEN. */
function authorised(req: Request) {
  const token = process.env.ADMIN_TOKEN;
  return Boolean(token) && req.headers.get("x-admin-token") === token;
}

export async function GET(req: Request) {
  if (!authorised(req)) return new Response("Unauthorized", { status: 401 });
  return Response.json(await loadPlaybook(), { headers: { "Cache-Control": "no-store" } });
}
