/**
 * Test the browser steps alone (no AI) – run this first in VS Code:
 *   MFJ_IC=900101145678 MFJ_PW=secret npm run test:browser -- "IT Lecturer" "Kuala Lumpur"
 * (Windows PowerShell:  $env:MFJ_IC="..."; $env:MFJ_PW="..."; npm run test:browser -- "IT Lecturer" "Kuala Lumpur")
 * Saves a screenshot to test-result.jpg and prints the first part of the page text.
 */
import { writeFileSync } from "node:fs";
import { JobSiteSession } from "../lib/browser";

async function main() {
  const [keyword = "IT Lecturer", location = "Kuala Lumpur"] = process.argv.slice(2);
  const icNumber = process.env.MFJ_IC;
  const password = process.env.MFJ_PW;
  if (!icNumber || !password) throw new Error("Set MFJ_IC and MFJ_PW environment variables first.");

  process.env.BROWSER_HEADFUL ??= "true";
  const s = new JobSiteSession({ icNumber, password });
  try {
    console.log(`Searching "${keyword}" in "${location}"…`);
    const r = await s.searchJobs(keyword, location);
    writeFileSync("test-result.jpg", Buffer.from(r.screenshot, "base64"));
    console.log(r.ok ? "✅ OK" : `❌ ${r.message}`);
    console.log(r.text.slice(0, 1500));
    console.log("\nScreenshot saved to test-result.jpg");
  } finally {
    await s.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
