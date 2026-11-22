// Local integration test. Run with node tests/discovery-browser.cjs after installing
// web dependencies, Playwright and Chromium. PLAYWRIGHT_MODULE may point to an
// existing installation. Set BROWSER_CHANNEL=chrome to use installed Chrome.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const web = path.resolve(__dirname, "../web");
const radar = "I never want to miss Spider-Man cast appearances or startup networking events involving AI founders.";
const radarTopics = ["Spider-Man cast appearances", "startup networking events involving AI founders"];
const name = "Local fixture jazz";
const listing = {
  id: "fixture-jazz", title: "Local fixture jazz night", starts_at: "2030-04-01T18:00:00Z",
  source: "venue", first_seen_at: new Date().toISOString(), source_published_at: "2026-10-01T11:00:00Z",
  verification_status: "verified", last_verified_at: "2026-11-01T12:00:00Z",
  official_url: "https://venue.example/events/jazz", url: "https://legacy.example/",
  city: "London", categories: ["music"], image_url: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
};
const accounts = new Map();
const errors = [];
let origin;

function signup(email) {
  assert.match(email, /^(desktop|mobile)@fixture\.invalid$/);
  const id = randomUUID();
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id, email, aud: "authenticated", role: "authenticated",
    user_metadata: { full_name: "Local fixture", qwendo_admin: true }, app_metadata: { qwendo_admin: email.startsWith("desktop") } };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = [encode({ alg: "HS256", typ: "JWT" }), encode({ sub: id, exp }), "Zml4dHVyZQ"].join(".");
  accounts.set(token, { user, draft: null, profile: null, steps: [], saves: 0 });
  return { user, access_token: token, refresh_token: randomUUID(), expires_in: 3600, expires_at: exp, token_type: "bearer" };
}

const fixture = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  function send(code, data) {
    res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization,apikey,x-client-info,x-supabase-api-version,content-type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PUT", "Cache-Control": "no-store" });
    res.end(JSON.stringify(data));
  }
  try {
    if (req.headers.origin && req.headers.origin !== origin) return send(403, {});
    if (req.method === "OPTIONS") return send(204);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    const route = req.method + " " + pathname;
    if (route === "GET /v1/interests") return send(200, []);
    if (route === "GET /v1/stats") return send(200, { events: 0, sources: 0, cities: 0, interests: 0 });
    if (["GET /v1/events/hero", "GET /v1/events/trending"].includes(route)) return send(200, { items: [] });
    if (route === "POST /auth/v1/signup") return send(200, signup(body.email));
    if (route === "GET /v1/events/swiss-fixture") return send(200, { ...listing, id: "swiss-fixture", source: "Swiss Data Events",
      starts_at: "2030-04-01T00:15:00+02:00", timezone: "UTC+02:00", official_url: null, url: "https://syndicator.example/event" });
    if (route === "GET /v1/events/fixture-jazz") return send(200, listing);
    if (route === "GET /v1/events") return send(200, { items: [] });
    const account = accounts.get(req.headers.authorization?.replace(/^Bearer /, ""));
    if (!account) return send(401, { error: "Local fixture token required" });
    switch (route) {
      case "GET /v1/me/relevance/swiss-fixture":
      case "GET /v1/me/relevance/fixture-jazz": return send(200, null);
      case "POST /v1/discovery/submissions":
        assert.deepEqual(body, { url: listing.official_url, title: "Fixture" });
        account.submitted = true;
        return send(202, { id: "fixture" });
      case "PUT /v1/admin/discovery/sources/fixture":
        assert.deepEqual(body, { kind: "rss", enabled: false, permission: "Fixture terms", url: listing.official_url,
          allowed_hosts: ["venue.example"], config: {}, interval_minutes: 90 });
        account.source = { slug: "fixture", ...body };
        return send(200, account.source);
      case "PUT /v1/admin/discovery/keywords/jazz":
        account.keyword = { slug: "jazz", ...body };
        return send(200, account.keyword);
      case "GET /v1/admin/discovery":
        assert.equal(account.user.app_metadata.qwendo_admin, true);
        return send(200, { sources: account.source ? [account.source] : [], jobs: [], metrics: {}, coverage: [], reviews: [], keywords: account.keyword ? [account.keyword] : [],
          submissions: [{ id: "fixture", url: listing.official_url, status: account.reviewed ? "rejected" : "pending_review" }] });
      case "POST /v1/admin/discovery/submissions/fixture/review":
        assert.equal(account.user.app_metadata.qwendo_admin, true);
        assert.deepEqual(body, { decision: "reject", source_slug: null });
        account.reviewed = true;
        return send(200, {});
      case "GET /auth/v1/user": return send(200, account.user);
      case "GET /v1/me/discovery": return send(200, { draft: account.draft, profile: account.profile });
      case "PUT /v1/me/discovery/draft":
        account.steps.push(body.step);
        account.draft = body;
        return send(200, {});
      case "POST /v1/me/discovery/extract": {
        assert.ok([name, radar].includes(body.text));
        assert.deepEqual(body.categories, ["tech"]);
        const topics = body.text === radar ? radarTopics : [name];
        return send(200, { mode: "fallback", interests: topics.map(topic => ({
          name: topic, source_text: topic, type: "topic", source: "explicit",
          confirmed: false, confidence: 1, related: [], priority: body.text === radar ? "must" : "curious",
        })) });
      }
      case "PUT /v1/me/discovery":
        account.profile = body;
        account.draft = null;
        account.saves++;
        return send(200, {});
      case "GET /v1/me/picks":
        return send(200, { profile: account.profile, radar: [{
          event_id: "fixture-jazz", kind: "great_match", title: "Radar match for jazz lovers",
        }], items: [{
          ...listing, matched_interest: name, exploratory: false,
        }] });
      case "GET /v1/me/saved": return send(200, { items: [] });
      default: throw Error("Unhandled local fixture route " + route);
    }
  } catch (error) {
    errors.push(error.message);
    send(500, { error: error.message });
  }
});

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function exercise(browser, device, api) {
  const context = await browser.newContext(device === "mobile" ? devices["Pixel 7"] :
    { viewport: { width: 1440, height: 960 } });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if ([origin, api].includes(url.origin)) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(origin);
    await page.getByRole("heading", { name: /Never miss the event/ }).waitFor();
    await page.getByRole("link", { name: "Get started", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Local fixture");
    await page.getByLabel("Email", { exact: true }).fill(device + "@fixture.invalid");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL("**/onboarding");
    await wizard(page, device);
    assert.deepEqual(errors, []);
  } catch (error) {
    console.error(device, page.url(), (await page.locator("main").innerText({ timeout: 2000 }).catch(() => "")).slice(-2400), errors);
    throw error;
  } finally {
    await context.close();
  }
}

async function wizard(page, device) {
  const button = label => page.getByRole("button", { name: label, exact: true });
  const click = label => button(label).click();
  const label = text => page.locator("main").getByLabel(new RegExp("^" + text));
  const next = () => click("Continue");
  await click("Technology & AI");
  await next();
  await label("In your own words").fill(name);
  await click("Suggest interests from my text");
  await label("Priority").selectOption("very");
  await next();
  await click("Learn new things");
  await click("Networking and meetups");
  await next();
  assert.equal(await button("Continue").isDisabled(), true);
  await label("City").fill("London");
  await label("Travel radius").selectOption("50");
  await next();
  await page.getByText("Draft saved", { exact: true }).waitFor();
  await page.reload();
  await label("Ticket budget").selectOption("20");
  await page.getByRole("checkbox", { name: "Only show events within my budget" }).check();
  await label("Availability").selectOption("Weekends");
  await next();
  await label("My radar").fill(radar);
  await click("Suggest radar interests");
  await page.getByRole("button", { name: "Remove " + radarTopics[1] }).waitFor();
  assert.equal(await label("Priority").nth(1).inputValue(), "very");
  await label("Priority").nth(1).selectOption("must");
  await label("Priority").nth(2).selectOption("must");
  await page.getByRole("checkbox", { name: "Send me a weekly digest" }).check();
  assert.equal(await label("Delivery frequency").inputValue(), "immediate");
  await label("Delivery frequency").selectOption("daily");
  await label("Delivery time zone").selectOption("Europe/Zurich");
  await page.getByRole("checkbox", { name: "Use quiet hours" }).check();
  await label("Quiet hours start").fill("23:30");
  await label("Quiet hours end").fill("06:15");
  await page.getByText("Draft saved", { exact: true }).waitFor();
  await page.reload();
  assert.equal(await label("Quiet hours start").inputValue(), "23:30");
  await click("Review profile");
  await page.getByRole("heading", { name: "Review your discovery profile" }).waitFor();
  assert.ok((await page.locator("main").innerText()).includes(radar));
  await click("Edit Location");
  await label("City").fill("Bristol");
  await click("Return to review");
  await click("Save and see my picks");
  await page.waitForURL("**/picks");
  await page.getByRole("heading", { name: "Your picks", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Local fixture jazz night" }).first().waitFor();
  await page.goto(origin);
  await page.waitForURL("**/picks");
  const card = page.locator("article").first();
  await card.getByText("Music", { exact: true }).waitFor();
  await card.getByRole("button", { name: "Not for me" }).waitFor();
  assert.ok(await card.locator("img").last().evaluate(image => image.complete && image.naturalWidth > 0));
  await page.getByRole("heading", { name: "Your Qwendo Radar" }).waitFor();
  await page.getByRole("link", { name: "Radar match for jazz lovers" }).waitFor();
  const account = [...accounts.values()].find(a => a.user.email === device + "@fixture.invalid");
  assert.deepEqual(account.profile.categories, ["tech"]);
  assert.deepEqual(account.profile.motivations, ["Learn new things"]);
  assert.deepEqual(account.profile.formats, ["Networking and meetups"]);
  assert.equal(account.profile.interests[0].priority, "very");
  assert.equal(account.profile.city, "Bristol");
  assert.equal(account.profile.radius, 50);
  assert.equal(account.profile.budget, 20);
  assert.equal(account.profile.budget_strict, true);
  assert.equal(account.profile.availability, "Weekends");
  assert.equal(account.profile.radar, radar);
  assert.deepEqual(account.profile.interests.map(item => item.name), [name, ...radarTopics]);
  assert.deepEqual(account.profile.interests.slice(1).map(item => item.priority), ["must", "must"]);
  assert.equal(account.profile.notifications.digest, true);
  assert.deepEqual(account.profile.radar_preferences, { frequency: "daily", timezone: "Europe/Zurich",
    quiet_start: "23:30", quiet_end: "06:15" });
  assert.equal(account.saves, 1);
  await page.getByRole("link", { name: "Edit preferences" }).click();
  await page.waitForURL("**/onboarding");
  assert.equal(await button("Technology & AI").getAttribute("aria-pressed"), "true");
  await next();
  assert.equal(await label("Interest name").first().inputValue(), name);
  await label("Priority").first().selectOption("must");
  await next();
  await next();
  assert.equal(await label("City").inputValue(), "Bristol");
  await next();
  await next();
  assert.equal(await label("Delivery time zone").inputValue(), "Europe/Zurich");
  await page.getByRole("checkbox", { name: "Use quiet hours" }).uncheck();
  await label("Delivery frequency").selectOption("weekly");
  await click("Review profile");
  await click("Save and see my picks");
  await page.waitForURL("**/picks");
  await page.getByText(name + " · Must not miss · Added by you", { exact: true }).waitFor();
  assert.equal(account.saves, 2);
  assert.deepEqual(account.profile.radar_preferences, { frequency: "weekly", timezone: "Europe/Zurich" });
  await page.getByRole("link", { name: "View Details" }).first().click();
  await page.waitForURL("**/events/fixture-jazz");
  assert.equal(await page.getByRole("link", { name: "View Official Event" }).getAttribute("href"), listing.official_url);
  await page.getByText("Price unlisted").waitFor();
  for (const marker of ["Discovered", "Announced", "Last verified"]) await page.getByText(new RegExp("^" + marker + " ·")).waitFor();
  assert.equal(await page.getByRole("link", { name: "Source listing" }).getAttribute("href"), listing.url);
  await page.goto(origin + "/events/swiss-fixture");
  assert.equal(await page.getByRole("link", { name: "Source listing" }).getAttribute("href"), "https://syndicator.example/event");
  assert.equal(await page.getByRole("link", { name: "View Official Event" }).count(), 0);
  await page.getByText(/1 Apr.*00:15/).waitFor();
  await page.getByRole("link", { name: "Submit an event" }).click();
  await page.getByLabel("Official event URL").fill(listing.official_url);
  await page.getByLabel("Event title").fill("Fixture");
  await click("Submit for review");
  await page.getByText("Submitted for review.").waitFor();
  assert.ok(account.submitted);
  await page.goto(origin + "/admin/discovery");
  if (device === "desktop") {
    await page.getByRole("heading", { name: "Discovery administration" }).waitFor();
    await page.getByText("Add source", { exact: true }).click();
    const source = page.locator("details").filter({ has: page.getByText("Add source", { exact: true }) });
    await source.getByLabel("Source identifier").fill("fixture");
    await source.getByLabel("Kind").selectOption("rss");
    await source.getByLabel("Source URL").fill(listing.official_url);
    await source.getByLabel("Allowed hosts").fill("venue.example");
    await source.getByLabel("Permission").fill("Fixture terms");
    await source.getByLabel("Check interval").fill("90");
    await source.getByRole("button", { name: "Save source" }).click();
    await page.getByText(/fixture · Disabled · Every 90 min/).waitFor();
    await page.getByText("Add keyword", { exact: true }).click();
    const keyword = page.locator("details").filter({ has: page.getByText("Add keyword", { exact: true }) });
    await keyword.getByLabel("Keyword identifier").fill("jazz");
    await keyword.getByLabel("Dictionary entry").fill(JSON.stringify({ label: "Jazz", category: "music", keywords: ["bebop"] }));
    await keyword.getByRole("button", { name: "Save keyword" }).click();
    await page.locator("summary").filter({ hasText: /^jazz$/ }).waitFor();
    await page.getByLabel("Decision").selectOption("reject");
    await click("Apply review");
    await page.getByText(/venue.example.*rejected/).waitFor();
    assert.ok(account.reviewed);
  } else assert.equal(await page.getByRole("heading", { name: "Discovery administration" }).count(), 0);
  console.log(device + " PASS: onboarding, picks, detail provenance, organiser submission, admin access and controls");
}

async function run() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "qwendo-local-browser-fixture-"));
  let next, browser;
  try {
    const api = "http://127.0.0.1:" + await listen(fixture);
    const probe = http.createServer();
    const port = await listen(probe);
    await new Promise(resolve => probe.close(resolve));
    origin = "http://127.0.0.1:" + port;
    // Copy only source and build inputs. No .env, deployment config or cached bundles.
    for (const file of ["src", "package.json", "next.config.ts", "tsconfig.json", "postcss.config.mjs"]) {
      await fs.cp(path.join(web, file), path.join(temp, file), { recursive: true });
    }
    await fs.symlink(path.join(web, "node_modules"), path.join(temp, "node_modules"), "dir");
    const fonts = path.join(temp, "offline-fonts.cjs");
    await fs.writeFile(fonts, 'module.exports = new Proxy({}, {get: () => "@font-face {font-family: Fixture;src: local(Arial);}"})');
    console.log("Qwendo LOCAL FIXTURE ONLY", origin, api);
    next = spawn(process.execPath, [path.join(web, "node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: temp, detached: true, stdio: ["ignore", "inherit", "inherit"],
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_API_URL: api, NEXT_PUBLIC_SUPABASE_URL: api,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "local-fixture-anon-key", NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fonts },
    });
    const deadline = Date.now() + 90000;
    while (true) {
      if (next.exitCode !== null || Date.now() > deadline) throw Error("Fixture Next startup failed");
      if ((await fetch(origin + "/login").catch(() => null))?.ok) break;
      await delay(250);
    }
    browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL });
    const failures = [];
    for (const device of ["desktop", "mobile"]) {
      try { await exercise(browser, device, api); }
      catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Browser integration failed");
  } finally {
    await browser?.close();
    if (next?.pid && next.exitCode === null) {
      const closed = once(next, "close");
      process.kill(-next.pid, "SIGTERM");
      await closed;
    }
    fixture.closeAllConnections();
    await new Promise(resolve => fixture.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
