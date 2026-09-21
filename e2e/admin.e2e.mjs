import path from "node:path";
import { ADMIN_URL, HERE, api, launch, loginApi, reporter, seed, shot, sleep, waitFor } from "./lib.mjs";

/**
 * The admin panel in a real browser: sign in, the forced first-login password change, upload a beat list, verify a beat, and
 * see deliveries assigned (or sent to Assignment Exceptions) with the reasons.
 */
export async function adminE2E() {
  const { users, officeId } = seed();
  const r = reporter("ADMIN PANEL");
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
  page.on("dialog", (d) => d.accept());

  const text = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const click = (label, root = "body") =>
    page.evaluate(
      (label, root) => {
        const el = [...document.querySelector(root).querySelectorAll("button, a")].find((x) => x.innerText.trim() === label && !x.disabled);
        if (!el) return false;
        el.click();
        return true;
      },
      label,
      root
    );
  const signIn = async (email, password) => {
    await page.goto(`${ADMIN_URL}/login`, { waitUntil: "networkidle2" });
    await page.type("#email", email);
    await page.type("#password", password);
    await page.click("button[type=submit]");
  };

  try {
    // ── 1. sign in with a wrong password, then the temporary one ─────────────────────────────────────────────
    await signIn(users.admin.email, "not-the-right-password");
    const rejected = await waitFor(page, () => /Invalid email or password/.test(document.body.innerText), null, 8000);
    r.check("a wrong password is refused with a clear message", rejected, await text());

    await page.evaluate(() => (document.querySelector("#password").value = ""));
    await page.click("#password", { clickCount: 3 });
    await page.type("#password", users.admin.password);
    await page.click("button[type=submit]");

    // ── 2. the forced password change ────────────────────────────────────────────────────────────────────────
    const blocked = await waitFor(page, () => !!document.querySelector('[data-testid="change-password"]'), null, 10000);
    r.check("a temporary password shows the change-password screen instead of the panel", blocked, await text());
    r.check("...and nothing of the panel is behind it", !/Total Deliveries|Operations Map|Deliveries/.test(await text()), await text());
    await shot(page, "admin-change-password");

    await page.type("#current-password", users.admin.password);
    await page.type("#new-password", "short");
    await page.type("#new-password-again", "short");
    await click("Save new password");
    const weak = await waitFor(page, () => /at least 10/.test(document.body.innerText), null, 8000);
    r.check("a weak new password is refused with the server's reason", weak, await text());

    for (const id of ["#new-password", "#new-password-again"]) {
      await page.click(id, { clickCount: 3 });
      await page.type(id, users.admin.newPassword);
    }
    await click("Save new password");
    const inside = await waitFor(page, () => /Total Deliveries/.test(document.body.innerText), null, 15000);
    r.check("a good new password opens the panel (the dashboard)", inside, await text());
    const tokenAfter = await page.evaluate(() => localStorage.getItem("accessToken"));
    r.check("the session works with the new tokens", (await api("GET", "/auth/me", tokenAfter)).data?.mustChangePassword === false);

    // ── 3. upload the beat list (structured: several rows per beat) ──────────────────────────────────────────
    await page.goto(`${ADMIN_URL}/map`, { waitUntil: "networkidle2" });
    await waitFor(page, () => [...document.querySelectorAll("button")].some((b) => b.innerText.trim() === "Upload Beat List"), null, 15000);
    // The map page loads its beats and tiles first; on a slow machine the button may not react to the first click, so retry.
    let opened = false;
    for (let attempt = 0; attempt < 6 && !opened; attempt++) {
      await click("Upload Beat List");
      opened = !!(await waitFor(page, () => !!document.querySelector('[data-testid="beat-file-input"]'), null, 6000));
    }
    if (!opened) throw new Error(`the Upload Beat List wizard did not open. Page text: ${(await text()).slice(0, 400)}`);
    await (await page.$('[data-testid="beat-file-input"]')).uploadFile(path.join(HERE, "fixtures", "beat-list.csv"));
    await waitFor(page, () => !!document.querySelector('[data-testid="file-name"]'), null, 15000);
    r.check("the uploaded file's name and row count are shown", /beat-list\.csv/.test(await text()) && /6 rows found/.test(await text()), await text());
    await click("Continue");
    const checks = await waitFor(page, () => document.querySelector('[data-testid="validation-checks"]')?.innerText ?? null, null, 10000);
    r.check("validation counts the beats and locality records, and reports the repeated row", /4 new beats/.test(checks ?? "") && /5 locality records/.test(checks ?? "") && /1 row repeats a locality/.test(checks ?? ""), checks);
    await shot(page, "admin-beat-validation");
    await click("Continue");
    const review = await waitFor(page, () => document.querySelector('[data-testid="review-table"]')?.innerText ?? null, null, 8000);
    r.check("the review lists every row: the beat, its locality and main area", /FARID NAGAR/.test(review ?? "") && /AFJAL CHAWL/.test(review ?? "") && /VILLAGE ROAD/.test(review ?? ""), review);
    r.check("the repeated row is listed as skipped, with its reason - not dropped", /Skipped/.test(review ?? "") && /Repeats row 6/.test(review ?? ""), review);
    await click("Continue");
    await waitFor(page, () => !!document.querySelector('[data-testid="import-count"]'), null, 8000);
    await click("Import Beats");
    const done = await waitFor(page, () => document.querySelector('[data-testid="import-done"]')?.innerText ?? null, null, 30000);
    r.check("the import finishes and says how many beats were imported", /4 beats imported/.test(done ?? ""), done ?? (await text()));
    await shot(page, "admin-beat-imported");
    await click("View on Map");

    const adminToken = (await loginApi(users.admin.email, users.admin.newPassword)).accessToken;
    const beats = (await api("GET", "/beats", adminToken)).data ?? [];
    const byNo = Object.fromEntries(beats.map((b) => [b.beatNumber, b]));
    r.check("PostgreSQL now has beats 2, 5, 20, 21", ["2", "5", "20", "21"].every((n) => byNo[n]), Object.keys(byNo));
    r.check("beats 20 and 21 have a territory awaiting verification; 2 and 5 have none", byNo["20"]?.verificationStatus === "PENDING_VERIFICATION" && byNo["21"]?.verificationStatus === "PENDING_VERIFICATION" && !byNo["2"]?.hasTerritory, JSON.stringify(beats.map((b) => [b.beatNumber, b.verificationStatus])));

    // ── 4. verify a beat on the map screen ───────────────────────────────────────────────────────────────────
    await page.goto(`${ADMIN_URL}/map`, { waitUntil: "networkidle2" });
    await waitFor(page, () => !!document.querySelector('input[aria-label="Search beats"]'), null, 15000);
    await page.type('input[aria-label="Search beats"]', "20");
    const option = await waitFor(page, () => [...document.querySelectorAll('[role="option"]')].length > 0, null, 8000);
    r.check("searching for a beat number lists the beat", option, await text());
    await page.evaluate(() => document.querySelector('[role="option"]').click());
    const panel = await waitFor(page, () => document.querySelector('[data-testid="beat-details"]')?.innerText ?? null, null, 8000);
    r.check("the beat's panel shows it needs verification, with the indicator words", /Needs verification/.test(panel ?? ""), panel);
    await click("Verify Beat", '[data-testid="beat-details"]');
    await waitFor(page, () => document.body.innerText.includes("Verify beat"), null, 8000);
    await shot(page, "admin-verify-dialog");
    const verified = await page.evaluate(() => {
      const dialog = [...document.querySelectorAll("button")].filter((b) => b.innerText.trim() === "Verify Beat");
      const inModal = dialog[dialog.length - 1];
      if (!inModal) return false;
      inModal.click();
      return true;
    });
    r.check("the Verify dialog can be confirmed", verified);
    await sleep(2500);
    const after = ((await api("GET", "/beats", adminToken)).data ?? []).find((b) => b.beatNumber === "20");
    r.check("beat 20 is VERIFIED in PostgreSQL, with who verified it", after?.verificationStatus === "VERIFIED" && !!after.verifiedByName, JSON.stringify(after && [after.verificationStatus, after.verifiedByName]));
    r.check("...and the panel now says Verified", /✓ Verified/.test(await text()), await text());
    await shot(page, "admin-beat-verified");

    // ── 5. deliveries: assigned by the beat list, or sent to Assignment Exceptions with a suggestion ─────────
    await api("POST", `/beats/${byNo["20"].id}/assign-postman`, adminToken, { postmanId: seed().postmanId });
    const make = (body) => api("POST", "/deliveries", adminToken, { city: "Mumbai", state: "Maharashtra", pincode: "400078", parcelCount: 1, ...body });
    const assigned = await make({ trackingId: "E2E-A1", recipientName: "Asha Nair", phone: "9820011111", addressLine1: "21 Farid Nagar, Bhandup West, Mumbai", area: "Farid Nagar" });
    r.check("an address in the beat list is assigned to that beat's postman (no geocoding needed)", assigned.status === 201 && assigned.data.assignedPostman?.name === "E2E Postman" && assigned.data.beat?.beatNumber === "20", JSON.stringify(assigned.data).slice(0, 200));
    const ambiguous = await make({ trackingId: "E2E-A2", recipientName: "Bharat Rao", phone: "9820022222", addressLine1: "9 Village Road, Bhandup West, Mumbai", area: "Village Road" });
    const unknown = await make({ trackingId: "E2E-A3", recipientName: "Chitra Iyer", phone: "9820033333", addressLine1: "4 Some Other Lane, Mumbai" });
    r.check("an address shared by two beats is NOT assigned", ambiguous.status === 201 && !ambiguous.data.assignedPostman, JSON.stringify(ambiguous.data).slice(0, 200));
    r.check("an address nowhere in the beat list is NOT assigned", unknown.status === 201 && !unknown.data.assignedPostman);

    await page.goto(`${ADMIN_URL}/deliveries/${assigned.data.id ?? assigned.data.deliveryId}`, { waitUntil: "networkidle2" });
    const detail = await waitFor(page, () => document.querySelector('[data-testid="assignment-evidence"]')?.innerText ?? null, null, 10000);
    r.check("the delivery page keeps the explanation: how it was assigned, the confidence and the evidence", /Assigned by: name/i.test(detail ?? "") && /% confidence/.test(detail ?? "") && /FARID NAGAR/.test(detail ?? ""), detail);

    await page.goto(`${ADMIN_URL}/exceptions`, { waitUntil: "networkidle2" });
    await waitFor(page, () => /Bharat Rao/.test(document.body.innerText), null, 10000);
    const exceptions = await text();
    r.check("Assignment Exceptions lists the ambiguous delivery with its suggested beat, confidence and reason", /Bharat Rao/.test(exceptions) && /B\d+ — Village Road/.test(exceptions) && /\d+% —/.test(exceptions) && /more than one beat/.test(exceptions), exceptions);
    r.check("...and the unknown address with 'Location quality: No location found'", /Chitra Iyer/.test(exceptions) && /No location found/.test(exceptions), exceptions);
    r.check("...with Assign / Choose Beat / Ignore", ["Assign", "Choose Beat", "Ignore"].every((l) => exceptions.includes(l)), exceptions);
    await shot(page, "admin-exceptions");

    // Choose Beat for the ambiguous delivery
    const clicked = await page.evaluate(() => {
      const row = [...document.querySelectorAll("tr")].find((tr) => tr.innerText.includes("Bharat Rao"));
      const button = row && [...row.querySelectorAll("button")].find((b) => b.innerText.trim() === "Choose Beat");
      if (!button) return false;
      button.click();
      return true;
    });
    r.check("Choose Beat opens for that delivery", clicked);
    await waitFor(page, () => !!document.querySelector("select"), null, 8000);
    const selects = await page.$$("select");
    await selects[selects.length - 1].select(byNo["5"].id); // a real select event, so the form sees the change
    await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.innerText.trim() === "Assign").pop()?.click());
    await sleep(2500);
    const resolved = await api("GET", `/deliveries/${ambiguous.data.id ?? ambiguous.data.deliveryId}`, adminToken);
    const ex = resolved.data?.exceptions ?? [];
    r.check(
      "choosing a beat assigns the delivery as a MANUAL decision and closes the 'ambiguous' exception",
      resolved.data?.beat?.beatNumber === "5" && resolved.data?.assignmentMethod === "MANUAL" && ex.find((e) => e.reason === "AMBIGUOUS_MATCH")?.resolvedAt,
      JSON.stringify([resolved.data?.beat?.beatNumber, resolved.data?.assignmentMethod, ex.map((e) => `${e.reason}:${!!e.resolvedAt}`)])
    );
    r.check("...and, because beat 5 has no postman, says so with an open 'no postman' exception instead of pretending it is done", ex.some((e) => e.reason === "NO_POSTMAN_ASSIGNED" && !e.resolvedAt) && !resolved.data?.assignedPostman, JSON.stringify(ex.map((e) => `${e.reason}:${!!e.resolvedAt}`)));

    r.check("no script error was thrown in the admin panel", pageErrors.length === 0, pageErrors.join(" | "));
    void officeId;
  } catch (err) {
    r.check("the admin scenario ran to the end", false, err?.stack ?? err);
    await shot(page, "admin-failure");
  } finally {
    await browser.close();
  }
  return r.results;
}
