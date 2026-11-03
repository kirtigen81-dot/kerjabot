/**
 * Browser automation for MYFutureJobs, streamed live to the UI.
 *
 * The user's IC number and password are only used here, on the server, for the
 * length of one request. They are never logged, never stored, never put in any
 * event and never shown to the AI model. The IC input is masked with CSS before
 * typing so it cannot appear in the live screencast either.
 *
 * Runs in three modes:
 *   - BROWSER_WS_ENDPOINT set -> connect to a hosted Chrome (Browserless etc.)
 *   - on Vercel               -> @sparticuz/chromium (serverless Chromium)
 *   - local dev               -> your installed Google Chrome (window visible if BROWSER_HEADFUL=true)
 */
import { chromium, type Browser, type CDPSession, type Locator, type Page } from "playwright-core";
import { VIEWPORT, type Emit } from "./events";

const HOME_URL = "https://myfuturejobs.gov.my/";
const SEARCH_URL = "https://myfuturejobs.gov.my/search-jobs";
const FRAME_INTERVAL_MS = 250; // max 4 fps to the client
const POINT_PAUSE_MS = 350; // lets the UI cursor glide before the click happens

/** Edit these if the site layout changes. Each is a comma-separated list of fallbacks. */
export const SELECTORS = {
  // Navy "Login" at the top right – never the orange "For Employers"
  homeLogin: "a:has-text('Login'):not(:has-text('Employer')), button:has-text('Login'):not(:has-text('Employer')), a:has-text('Log Masuk')",
  icInput: "#username, input[placeholder*='Kad Pengenalan'], input[placeholder*='IC Number']",
  passwordInput: "#password, input[placeholder*='kata laluan' i], input[type='password']",
  loginButton: "#kc-login, input[type='submit'][name='login'], button:has-text('Log Masuk'), button:has-text('Login')",
  captcha: "iframe[src*='captcha'], [class*='captcha' i], input[placeholder*='OTP' i]",
  searchNav: "a:has-text('Search Jobs'), a:has-text('Cari Kerja')",
  keywordInput: "input[placeholder*='Sales Assistant'], input[placeholder*='Pembantu Jualan']",
  locationInput: "input[placeholder*='Kuala Lumpur']",
  searchButton: "button:has-text('Search'), button:has-text('Cari')",
  autocompleteOption: "[role='option']",
  jobCardTitle: ".vacancy-summary-02__position-title",
  detailsPanel: ".vacancy-details-container",
};

/** "152 Lecturer Jobs Available in Kuala Lumpur" -> "152" */
export const JOBS_AVAILABLE = /([\d,]+)\s+(?:[^\n]{0,60}?\s)?Jobs Available/i;

/** Masks the IC number in the live stream (password inputs are already masked). */
const MASK_CSS =
  "#username,input[placeholder*='Kad Pengenalan'],input[placeholder*='IC Number']{-webkit-text-security:disc!important}";

export type Credentials = { icNumber: string; password: string };
export type PageSnapshot = { text: string; screenshot: string; url: string };
type Result = PageSnapshot & { ok: boolean; message?: string };

export class AbortedError extends Error {
  constructor() {
    super("Stopped by user");
    this.name = "AbortedError";
  }
}

export class JobSiteSession {
  private browser?: Browser;
  private page?: Page;
  private cdp?: CDPSession;
  private frameTimer?: ReturnType<typeof setTimeout>;
  private loggedIn = false;
  private stepSeq = 0;
  private sent = { screenshots: 0, frames: 0 };
  /** The search currently shown on the page, so job_details can reuse it instead of searching again. */
  private current: { key: string; result: Result } | null = null;

  constructor(
    private creds: Credentials,
    private emit: Emit = () => {},
    private signal?: AbortSignal,
  ) {
    // Closing the browser makes any pending Playwright call reject at once, so Stop is fast.
    signal?.addEventListener("abort", () => void this.close(), { once: true });
  }

  // ---------- step / overlay helpers ----------

  private checkAborted() {
    if (this.signal?.aborted) throw new AbortedError();
  }

  /** Runs one visible step: emits running, then done (with doneTitle) or error. */
  private async step<T>(title: string, fn: () => Promise<T>, doneTitle?: (r: T) => string): Promise<T> {
    this.checkAborted();
    const id = `b${++this.stepSeq}`;
    this.emit({ type: "step", id, status: "running", title });
    try {
      const r = await fn();
      const done = doneTitle?.(r) ?? title;
      this.emit({ type: "step", id, status: "done", title: done });
      await this.shot(done);
      return r;
    } catch (err) {
      const aborted = this.signal?.aborted;
      this.emit({ type: "step", id, status: "error", title, detail: aborted ? "Stopped" : shortError(err) });
      throw aborted ? new AbortedError() : err;
    }
  }

  /** Moves the UI cursor to the element and outlines it before acting on it. */
  private async point(loc: Locator, action: "click" | "type", label: string) {
    await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    const box = await loc.boundingBox().catch(() => null);
    if (!box) return;
    this.emit({ type: "cursor", x: box.x + box.width / 2, y: box.y + box.height / 2, action, label });
    this.emit({ type: "highlight", box, label });
    await this.page?.waitForTimeout(POINT_PAUSE_MS);
  }

  private async click(loc: Locator, label: string, timeout?: number) {
    await loc.waitFor({ timeout });
    await this.point(loc, "click", label);
    await loc.click({ timeout });
    this.emit({ type: "highlight", box: null });
  }

  /** `label` is what the UI shows – never pass a secret value in it. */
  private async type(loc: Locator, value: string, label: string, opts: { visible?: boolean } = {}) {
    await loc.waitFor();
    await this.point(loc, "type", label);
    if (opts.visible) {
      await loc.fill("");
      await loc.pressSequentially(value, { delay: 45 });
    } else {
      await loc.fill(value);
    }
    this.emit({ type: "highlight", box: null });
  }

  /** Screenshot after each action. The IC input is CSS-masked before typing, so it never shows. */
  private async shot(caption: string) {
    const page = this.page;
    if (!page || this.signal?.aborted || page.url() === "about:blank") return;
    const buf = await page.screenshot({ type: "jpeg", quality: 60 }).catch(() => null);
    if (!buf) return;
    this.sent.screenshots++;
    this.emit({ type: "screenshot", data: buf.toString("base64"), caption, url: page.url() });
  }

  // ---------- browser lifecycle ----------

  private async launch(): Promise<Browser> {
    const ws = process.env.BROWSER_WS_ENDPOINT;
    if (ws) return chromium.connectOverCDP(ws);

    if (process.env.VERCEL) {
      const sparticuz = (await import("@sparticuz/chromium")).default;
      return chromium.launch({
        args: sparticuz.args,
        executablePath: await sparticuz.executablePath(),
        headless: true,
      });
    }

    const headful = process.env.BROWSER_HEADFUL === "true";
    const executablePath = process.env.CHROME_PATH || undefined;
    return chromium.launch({
      channel: executablePath ? undefined : "chrome",
      executablePath,
      headless: !headful,
      slowMo: headful ? 250 : 0,
    });
  }

  private async getPage(): Promise<Page> {
    if (this.page) return this.page;
    return this.step("Opening browser", async () => {
      this.browser = await this.launch();
      const ctx = await this.browser.newContext({
        viewport: VIEWPORT,
        locale: "en-MY",
        timezoneId: "Asia/Kuala_Lumpur",
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(20_000);
      // Skip fonts and media to save time and memory on serverless
      await page.route("**/*", (route) => {
        const t = route.request().resourceType();
        return t === "font" || t === "media" ? route.abort() : route.continue();
      });
      page.on("framenavigated", (f) => {
        if (f === page.mainFrame()) this.emit({ type: "url", url: f.url() });
      });
      this.page = page;
      await this.startScreencast(page);
      return page;
    });
  }

  /** Streams the page via CDP, throttled to ~5 fps; the newest frame always gets through. */
  private async startScreencast(page: Page) {
    try {
      const cdp = await page.context().newCDPSession(page);
      this.cdp = cdp;
      let last = 0;
      let pending: string | null = null;
      const flush = () => {
        this.frameTimer = undefined;
        if (!pending) return;
        this.emit({ type: "frame", data: pending });
        this.sent.frames++;
        pending = null;
        last = Date.now();
      };
      cdp.on("Page.screencastFrame", (f) => {
        pending = f.data;
        cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
        const wait = FRAME_INTERVAL_MS - (Date.now() - last);
        if (wait <= 0) flush();
        else this.frameTimer ??= setTimeout(flush, wait);
      });
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 50, maxWidth: 1280, maxHeight: 800, everyNthFrame: 2 });
    } catch (err) {
      console.warn("[browser] screencast unavailable:", shortError(err));
    }
  }

  async close() {
    if (this.browser) console.log(`[browser] sent ${this.sent.screenshots} screenshot events, ${this.sent.frames} frames`);
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = undefined;
    await this.cdp?.send("Page.stopScreencast").catch(() => {});
    await this.cdp?.detach().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.cdp = undefined;
    this.browser = undefined;
    this.page = undefined;
    this.loggedIn = false;
    this.current = null;
  }

  async snapshot(maxChars = 9000): Promise<PageSnapshot> {
    const page = await this.getPage();
    const raw = await page.innerText("body").catch(() => "");
    const text = raw.replace(/\n{2,}/g, "\n").slice(0, maxChars);
    const buf = await page.screenshot({ type: "jpeg", quality: 55 });
    return { text, screenshot: buf.toString("base64"), url: page.url() };
  }

  // ---------- site flows ----------

  async login(): Promise<{ ok: boolean; message: string }> {
    if (this.loggedIn) return { ok: true, message: "Already logged in." };
    const page = await this.getPage();

    await this.step("Going to myfuturejobs.gov.my", async () => {
      await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
    });

    const ic = page.locator(SELECTORS.icInput).first();
    try {
      await this.step("Opening login page", async () => {
        // "Login" has target=_blank (opens the candidates SSO in a new tab), so open its URL in this tab
        const link = page.locator(SELECTORS.homeLogin).first();
        await link.waitFor();
        await this.point(link, "click", "Clicking Login");
        const href = await link.getAttribute("href");
        if (href) await page.goto(new URL(href, page.url()).toString(), { waitUntil: "domcontentloaded" });
        else await link.click();
        this.emit({ type: "highlight", box: null });
        await ic.waitFor();
      });
    } catch (err) {
      if (err instanceof AbortedError) throw err;
      return { ok: false, message: "Could not open the login page (Login button or IC field not found)." };
    }

    await page.addStyleTag({ content: MASK_CSS });

    await this.step("Typing IC number", () => this.type(ic, this.creds.icNumber.replace(/-/g, ""), "Typing IC number"));
    await this.step("Typing password", () =>
      this.type(page.locator(SELECTORS.passwordInput).first(), this.creds.password, "Typing password"),
    );

    const result = await this.step(
      "Logging in",
      async () => {
        await this.click(page.locator(SELECTORS.loginButton).first(), "Clicking Log Masuk");
        try {
          await page.locator(SELECTORS.searchNav).first().waitFor({ timeout: 25_000 });
          this.loggedIn = true;
          return { ok: true, message: "Login successful." };
        } catch {
          this.checkAborted();
          if (await page.locator(SELECTORS.captcha).count().catch(() => 0)) {
            return { ok: false, message: "The site is asking for a CAPTCHA or OTP. Stop and tell the user." };
          }
          const text = (await page.innerText("body").catch(() => "")).replace(/\n{2,}/g, "\n").slice(0, 800);
          return { ok: false, message: `Login failed or timed out. Page says: ${text}` };
        }
      },
      (r) => (r.ok ? "Logged in ✓" : "Login failed"),
    );
    return result;
  }

  async searchJobs(keyword: string, location = ""): Promise<Result> {
    const login = await this.login();
    if (!login.ok) return { ok: false, message: login.message, ...(await this.snapshot(1500)) };

    const page = await this.getPage();
    await this.step("Opening Search Jobs", async () => {
      try {
        await this.click(page.locator(SELECTORS.searchNav).first(), "Clicking Search Jobs", 8000);
      } catch {
        this.checkAborted();
        await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded" });
      }
    });

    await this.step(`Typing "${keyword}"`, () =>
      this.type(page.locator(SELECTORS.keywordInput).first(), keyword, `Typing: ${keyword}`, { visible: true }),
    );

    if (location) {
      await this.step(`Typing location "${location}"`, async () => {
        await this.type(page.locator(SELECTORS.locationInput).first(), location, `Typing: ${location}`, { visible: true });
        try {
          const opt = page.locator(SELECTORS.autocompleteOption).first();
          await opt.waitFor({ timeout: 3000 });
          await this.click(opt, `Choosing ${location}`, 3000);
        } catch {
          this.checkAborted(); // no autocomplete – fine
        }
      });
    }

    await this.step("Clicking Search", async () => {
      await this.click(page.locator(SELECTORS.searchButton).first(), "Clicking Search");
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1200);
    });

    const snap = await this.step(
      "Reading results",
      () => this.snapshot(),
      (s) => {
        const n = s.text.match(JOBS_AVAILABLE)?.[1];
        return n ? `Found ${n} jobs` : "Results read";
      },
    );
    const result = { ok: true, ...snap };
    this.current = { key: searchKey(keyword, location), result };
    return result;
  }

  /** The results page for this search: reuses the one already open, otherwise searches. */
  private async results(keyword: string, location: string): Promise<Result> {
    const cur = this.current;
    if (cur && cur.key === searchKey(keyword, location)) return cur.result;
    return this.searchJobs(keyword, location);
  }

  /** Text of the right-hand details panel (falls back to the whole page). */
  private async detailsText(page: Page) {
    const panel = page.locator(SELECTORS.detailsPanel).first();
    const raw = (await panel.count()) ? await panel.innerText().catch(() => "") : "";
    return (raw || (await page.innerText("body").catch(() => ""))).replace(/\n{2,}/g, "\n");
  }

  /** Indexes of headings that are job card titles (skips "Discover Jobs", "More Options", ...). */
  private async jobCards(page: Page) {
    const titles = page.locator(SELECTORS.jobCardTitle);
    const count = await titles.count();
    const candidates: { i: number; title: string }[] = [];
    for (let i = 0; i < count; i++) {
      const t = (await titles.nth(i).innerText().catch(() => "")).trim();
      if (t && !/discover jobs|more options|jobs available|cari kerja/i.test(t)) candidates.push({ i, title: t });
    }
    return { titles, candidates };
  }

  /** Skill step 6: search once, click each of the first `count` job cards and read the right panel. */
  async readJobs(keyword: string, location: string, count: number): Promise<Result> {
    const res = await this.results(keyword, location);
    if (!res.ok) return res;
    const header = res.text.split("\n").find((l) => JOBS_AVAILABLE.test(l)) ?? "";
    const page = await this.getPage();
    const { titles, candidates } = await this.jobCards(page);
    const jobs: string[] = [];
    const seen = new Set<string>();
    for (const c of candidates) {
      if (jobs.length >= count) break;
      if (seen.has(c.title)) continue;
      seen.add(c.title);
      const n = jobs.length + 1;
      const text = await this.step(`Opening job ${n}: ${c.title.slice(0, 60)}`, async () => {
        await this.click(titles.nth(c.i), `Opening: ${c.title.slice(0, 40)}`).catch(() => {});
        await page.waitForTimeout(1200);
        return this.detailsText(page);
      });
      // Fallback (no panel found): the body repeats the title in the details pane, so read from its last occurrence
      const at = Math.max(0, text.lastIndexOf(c.title));
      jobs.push(`### JOB ${n}\n${text.slice(at, at + 2600)}`);
    }
    if (!jobs.length) return { ok: true, message: "No job cards found.", ...(await this.snapshot()) };
    const shot = await page.screenshot({ type: "jpeg", quality: 55 });
    return { ok: true, text: `${header}\n\n${jobs.join("\n\n")}`.slice(0, 13_000), screenshot: shot.toString("base64"), url: page.url() };
  }

  /**
   * Opens card N. Reuses the results already open in this session; a new request
   * (serverless = no state between requests) searches once first.
   */
  async jobDetails(keyword: string, location: string, index: number): Promise<Result> {
    const res = await this.results(keyword, location);
    if (!res.ok) return res;
    const page = await this.getPage();
    const { titles, candidates } = await this.jobCards(page);
    const target = candidates[index - 1];
    if (target === undefined) {
      return { ok: false, message: `Only ${candidates.length} job cards found.`, ...(await this.snapshot(2000)) };
    }
    return this.step(`Opening job ${index}: ${target.title.slice(0, 60)}`, async () => {
      await this.click(titles.nth(target.i), `Opening: ${target.title.slice(0, 40)}`);
      await page.waitForTimeout(1500);
      const text = await this.detailsText(page);
      return { ok: true, text: `### JOB ${index}\n${text.slice(0, 6000)}`, screenshot: "", url: page.url() };
    });
  }

  async scrollResults(keyword: string, location: string): Promise<Result> {
    const res = await this.results(keyword, location);
    if (!res.ok) return res;
    const page = await this.getPage();
    return this.step("Scrolling for more jobs", async () => {
      this.emit({ type: "cursor", x: 300, y: 600, action: "click", label: "Scrolling" });
      await page.mouse.move(300, 600);
      await page.mouse.wheel(0, 2500);
      await page.waitForTimeout(1200);
      return { ok: true, ...(await this.snapshot(12_000)) };
    });
  }
}

/** First line of an error, without Playwright's call log (which can echo selectors). */
function shortError(err: unknown): string {
  return String((err as Error)?.message ?? err).split("\n")[0].slice(0, 200);
}

/** Same search = same keyword + location, ignoring case and spacing. */
export const searchKey = (keyword: string, location: string) =>
  `${keyword.trim().toLowerCase().replace(/\s+/g, " ")}|${location.trim().toLowerCase().replace(/\s+/g, " ")}`;
