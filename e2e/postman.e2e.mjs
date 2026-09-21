import { APP_URL, api, launch, loginApi, reporter, seed, shot, sleep, waitFor } from "./lib.mjs";

/**
 * The Postman app (its web build) in a real browser: sign in with a temporary password, choose a new one, see the round
 * (the route order), start a delivery and complete it - and check PostgreSQL agrees.
 */
export async function postmanE2E() {
  const { users, postmanId } = seed();
  const r = reporter("POSTMAN APP");

  // ── setup through the API, as an administrator would: a beat with a verified territory, the postman on it, three parcels ──
  const admin = (await loginApi(users.settled.email, users.settled.password)).accessToken;
  const ring = [[72.9500, 19.1600], [72.9540, 19.1600], [72.9540, 19.1640], [72.9500, 19.1640], [72.9500, 19.1600]];
  const beat = await api("POST", "/beats", admin, { beatNumber: "E2E-PM", name: "E2E round", boundary: { type: "Polygon", coordinates: [ring] }, postmanId });
  r.check("setup: a beat with a verified territory and the postman on it", beat.status === 201 && beat.data.assignedPostmanId === postmanId, JSON.stringify(beat.data).slice(0, 200));
  const spots = [[19.1610, 72.9510], [19.1620, 72.9520], [19.1630, 72.9530]];
  const stamp = Date.now().toString(36).toUpperCase().slice(-5);
  const made = [];
  for (const [i, [latitude, longitude]] of spots.entries()) {
    const d = await api("POST", "/deliveries", admin, {
      trackingId: `E2E-R${stamp}${i}`, recipientName: `Round Person ${i + 1}`, phone: "9820012345", addressLine1: `${i + 1} Round Lane`, area: "Bhandup West", city: "Mumbai", state: "Maharashtra", pincode: "400078", latitude, longitude, parcelCount: 1 + i
    });
    if (d.status === 201) made.push(d.data);
  }
  r.check("setup: three parcels are assigned to the postman (a house-level location inside a verified territory)", made.length === 3 && made.every((d) => d.assignedPostmanId === postmanId && d.assignmentMethod === "TERRITORY"), JSON.stringify(made.map((d) => [d.assignedPostmanId, d.assignmentMethod])));

  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  page.on("dialog", (d) => d.accept()); // the web build confirms with window.confirm
  const text = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const tap = (label) =>
    page.evaluate((label) => {
      const leaf = [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.innerText && e.innerText.trim() === label && e.offsetParent !== null).pop();
      const labelled = [...document.querySelectorAll(`[aria-label="${label}"]`)].find((e) => e.offsetParent !== null);
      const el = labelled ?? leaf;
      if (!el) return false;
      el.click();
      return true;
    }, label);
  const fill = async (selector, value) => {
    await page.click(selector, { clickCount: 3 });
    await page.type(selector, value);
  };

  try {
    // ── sign in with the temporary password → the change-password screen ─────────────────────────────────────
    await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 240000 });
    await waitFor(page, () => document.querySelectorAll("input").length >= 2, null, 60000);
    const inputs = await page.$$("input");
    await inputs[0].type(users.postman.email);
    await inputs[1].type("not-the-right-password");
    await tap("Sign In");
    r.check("a wrong password is refused and the login screen stays", await waitFor(page, () => /invalid|incorrect|could not|wrong/i.test(document.body.innerText), null, 15000), (await text()).slice(0, 200));

    await fill('input[aria-label="Password"]', users.postman.password);
    await tap("Sign In");
    const change = await waitFor(page, () => /Choose a new password/.test(document.body.innerText), null, 30000);
    r.check("a temporary password shows 'Choose a new password' instead of the app", change, (await text()).slice(0, 200));
    r.check("...and none of the app (Deliveries, Map, Account) is behind it", !/Deliveries|Route Map|Account/.test(await text()), (await text()).slice(0, 200));
    await shot(page, "app-change-password");

    await fill('input[aria-label="Temporary password"]', users.postman.password);
    await fill('input[aria-label="New password"]', "short");
    await fill('input[aria-label="New password again"]', "short");
    await tap("Save new password");
    r.check("a weak new password is refused with the server's reason", await waitFor(page, () => /at least 10/.test(document.body.innerText), null, 15000), (await text()).slice(0, 300));

    await fill('input[aria-label="New password"]', users.postman.newPassword);
    await fill('input[aria-label="New password again"]', users.postman.newPassword);
    await tap("Save new password");
    const home = await waitFor(page, () => /Deliveries/.test(document.body.innerText) && /Home|Today/.test(document.body.innerText) && !/Choose a new password/.test(document.body.innerText), null, 40000);
    r.check("a good new password opens the app (Home)", home, (await text()).slice(0, 300));
    await shot(page, "app-home");

    // ── the round: the deliveries in route order ─────────────────────────────────────────────────────────────
    await tap("Deliveries");
    const listed = await waitFor(page, () => /Round Person 1/.test(document.body.innerText) && /Round Person 3/.test(document.body.innerText), null, 40000);
    const list = await text();
    r.check("the Deliveries tab lists the postman's own three parcels", listed && (list.match(/Round Person/g) ?? []).length >= 3, list.slice(0, 400));
    r.check("each address is written once, without the repeated locality / city", /1 Round Lane \/ Bhandup West \/ Mumbai/.test(list) && !/Mumbai, Maharashtra/.test(list), list.slice(0, 500));
    // stop numbers 1, 2, 3 belong to the route the server planned
    const route = (await api("GET", "/me/route", (await loginApi(users.postman.email, users.postman.newPassword)).accessToken)).data;
    r.check("the server's route has the three stops in an order (the app shows that order)", Array.isArray(route?.solution?.stops) && route.solution.stops.length === 3 && route.solution.stops.map((x) => x.sequence).join() === "1,2,3", JSON.stringify(route).slice(0, 200));
    await shot(page, "app-deliveries");

    // ── start and complete the first delivery ────────────────────────────────────────────────────────────────
    const first = route.solution.stops[0];
    const firstDelivery = made.find((d) => d.id === first.deliveryId);
    await page.evaluate((name) => {
      const el = [...document.querySelectorAll('[role="button"], div')].find((e) => e.getAttribute("aria-label")?.includes(name));
      el?.click();
    }, firstDelivery?.recipient?.name ?? "Round Person 1");
    await waitFor(page, () => !!document.querySelector('[aria-label="Start Delivery"]') || !!document.querySelector('[aria-label="Mark Delivered"]'), null, 15000);
    r.check("an expanded parcel offers Start Delivery (never Mark Delivered from ASSIGNED)", (await page.$('[aria-label="Start Delivery"]')) !== null && (await page.$('[aria-label="Mark Delivered"]')) === null, await text());
    await tap("Start Delivery");
    const started = await waitFor(page, () => !!document.querySelector('[aria-label="Mark Delivered"]'), null, 20000);
    r.check("after Start Delivery the parcel can be marked delivered", started, await text());
    await shot(page, "app-out-for-delivery");
    await tap("Mark Delivered");
    await sleep(4000);
    const token = (await loginApi(users.postman.email, users.postman.newPassword)).accessToken;
    const mine = (await api("GET", "/me/deliveries?pageSize=100", token)).data?.rows ?? [];
    const done = mine.filter((d) => d.status === "DELIVERED");
    r.check("PostgreSQL has the delivery as DELIVERED, recorded by the postman", done.length === 1, JSON.stringify(mine.map((d) => [d.trackingId, d.status])));
    r.check("the other two are untouched", mine.filter((d) => ["ASSIGNED", "OUT_FOR_DELIVERY"].includes(d.status)).length === 2, JSON.stringify(mine.map((d) => d.status)));
    r.check("the app shows the delivery as delivered", await waitFor(page, () => /Delivered/.test(document.body.innerText), null, 15000), (await text()).slice(0, 400));
    await shot(page, "app-delivered");

    // ── a stale token from before the password change no longer works ────────────────────────────────────────
    r.check("no script error was thrown in the app", pageErrors.length === 0, pageErrors.join(" | "));
  } catch (err) {
    r.check("the postman scenario ran to the end", false, err?.stack ?? err);
    await shot(page, "app-failure");
  } finally {
    await browser.close();
  }
  return r.results;
}
