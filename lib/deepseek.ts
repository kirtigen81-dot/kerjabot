import OpenAI from "openai";

let client: OpenAI | null = null;

/**
 * DeepSeek client (OpenAI-compatible), created on first use – not at import time, so
 * `next build` works without DEEPSEEK_API_KEY (Vercel only provides it at runtime if unset for builds).
 */
export function deepseek(): OpenAI {
  if (client) return client;
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set. Add it to .env.local or your Vercel project's Environment Variables.");
  client = new OpenAI({ apiKey, baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com" });
  return client;
}
