const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Pool } = require("pg");
const request = require("supertest");
// Use a dedicated database: this test recreates its public schema.
const enabled = process.env.RUN_DB_TESTS === "1";
let admin, pool, app, ownerCookie;
function signedIn() {
  return request
    .agent(app)
    .set("X-Requested-With", "InternshipTracker")
    .set("Cookie", ownerCookie);
}
before(async () => {
  if (!enabled) return;
  if (!process.env.DB_NAME?.endsWith("_test"))
    throw Error("DB_NAME must end with _test.");
  admin = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await admin.query(fs.readFileSync(__dirname + "/../db/database.sql", "utf8"));
  pool = require("../db/database");
  app = require("../app");
  // Existing installation: first signup keeps legacy company records.
  await pool.query("INSERT INTO companies(name) VALUES('Legacy company')");
  const registration = await request(app)
    .post("/api/auth/signup")
    .set("X-Requested-With", "InternshipTracker")
    .send({
      name: "Test owner",
      email: "owner@example.com",
      password: "Test password 2026!",
    });
  assert.equal(registration.status, 201);
  ownerCookie = registration.headers["set-cookie"][0].split(";")[0];
  assert.match(registration.headers["set-cookie"][0], /HttpOnly/);
  assert.equal(
    (await signedIn().get("/api/companies")).body[0].name,
    "Legacy company",
  );
  const legacy = await pool.query(
    "SELECT owner_id FROM companies WHERE name='Legacy company'",
  );
  assert.equal(legacy.rows[0].owner_id, registration.body.user.id);
  await pool.query("DELETE FROM companies WHERE name='Legacy company'");
  // Applying the migration repeatedly must preserve users and company data.
  await require("../db/migrate")();
});
after(async () => {
  await pool?.end();
  await admin?.end();
});
test(
  "CRUD, filters, relationships, dashboard, import idempotency and cascades",
  { skip: !enabled },
  async () => {
    const api = signedIn();
    let r = await api.post("/api/companies").send({ name: "" });
    assert.equal(r.status, 400);
    r = await api.post("/api/companies").send({
      name: "Alpha",
      category: "Software",
      website: "https://example.com",
    });
    assert.equal(r.status, 201);
    const company = r.body;
    r = await api.post("/api/companies").send({ name: " alpha " });
    assert.equal(r.status, 400);
    const second = (await api.post("/api/companies").send({ name: "Beta" }))
      .body;
    const contact = (
      await api.post("/api/contacts").send({
        company_id: company.id,
        name: "Recruiter",
        contact_type: "HR / Recruiter",
      })
    ).body;
    const application = (
      await api.post("/api/applications").send({
        company_id: company.id,
        position: "Developer intern",
        status: "Interview",
        application_date: "2026-09-01",
        response: "Interview",
      })
    ).body;
    assert.ok(application.id);
    r = await api.post("/api/follow-ups").send({
      company_id: second.id,
      application_id: application.id,
      follow_up_date: "2026-09-20",
    });
    assert.equal(r.status, 400);
    r = await api.post("/api/follow-ups").send({
      company_id: company.id,
      application_id: application.id,
      contact_id: contact.id,
      follow_up_date: "2026-09-20",
    });
    assert.equal(r.status, 201);
    const follow = r.body;
    for (const path of ["contacts", "applications", "follow-ups"]) {
      r = await api.get("/api/" + path);
      assert.equal(r.status, 200);
      assert.equal(r.body.length, 1);
      r = await api.get("/api/" + path + "/" + r.body[0].id);
      assert.equal(r.status, 200);
    }
    r = await api
      .put("/api/contacts/" + contact.id)
      .send({ company_id: second.id });
    assert.equal(r.status, 400);
    r = await api
      .put("/api/applications/" + application.id)
      .send({ company_id: second.id });
    assert.equal(r.status, 400);
    r = await api
      .put("/api/contacts/" + contact.id)
      .send({ job_title: "People Partner" });
    assert.equal(r.body.job_title, "People Partner");
    r = await api
      .put("/api/applications/" + application.id)
      .send({ position: "Backend Intern" });
    assert.equal(r.body.position, "Backend Intern");
    r = await api
      .put("/api/companies/" + company.id)
      .send({ description: "Builds tools" });
    assert.equal(r.body.description, "Builds tools");
    r = await api.get(
      "/api/companies?search=Alpha&category=Software&status=Interview&response=Responded",
    );
    assert.equal(r.body.length, 1);
    r = await api.get("/api/companies?status=Not%20Applied");
    assert.equal(r.body.length, 1);
    assert.equal(r.body[0].name, "Beta");
    r = await api.get("/api/contacts?search=Alpha&type=HR%20%2F%20Recruiter");
    assert.equal(r.body.length, 1);
    for (const endpoint of ["contacts", "applications"]) {
      r = await api.get(`/api/companies/${company.id}/${endpoint}`);
      assert.equal(r.body.length, 1);
    }
    r = await api
      .post(`/api/companies/${company.id}/notes`)
      .send({ note: "First conversation" });
    assert.equal(r.status, 201);
    const note = r.body;
    r = await api
      .put("/api/notes/" + note.id)
      .send({ note: "Second conversation" });
    assert.equal(r.body.note, "Second conversation");
    r = await api.get(`/api/companies/${company.id}/notes`);
    assert.equal(r.body.length, 1);
    r = await api.get("/api/dashboard");
    assert.equal(r.body.totalCompanies, 2);
    assert.equal(r.body.interviews, 1);
    assert.equal(r.body.applied, 1);
    assert.equal(r.body.responsesReceived, 1);
    assert.equal(r.body.pendingFollowUps, 1);
    r = await api.patch(`/api/follow-ups/${follow.id}/complete`);
    assert.equal(r.body.status, "Completed");
    r = await api
      .post("/api/applications")
      .send({ company_id: company.id, application_date: "2026-02-31" });
    assert.equal(r.status, 400);
    r = await api
      .post("/api/companies")
      .send({ name: "Unsafe", website: "javascript:alert(1)" });
    assert.equal(r.status, 400);
    const csv =
      "Company,Public email,Applied?,Application date,Follow-up sent?,CEO / Founder,Response\nGamma,hello@example.com,Yes,2026-09-01,Yes,Pat,Responded\nBad Date,,Yes,not-a-date,,,\n,,,,,,\n";
    r = await api
      .post("/api/companies/import")
      .attach("file", Buffer.from(csv), "companies.csv");
    assert.equal(r.status, 200);
    assert.deepEqual(
      [r.body.imported, r.body.updated, r.body.failed, r.body.skipped],
      [1, 0, 1, 1],
    );
    r = await api
      .post("/api/companies/import")
      .attach("file", Buffer.from(csv), "companies.csv");
    assert.deepEqual(
      [r.body.imported, r.body.updated, r.body.failed, r.body.skipped],
      [0, 1, 1, 1],
    );
    const imported = (await api.get("/api/companies?search=Gamma")).body[0];
    assert.equal(imported.follow_up_sent, true);
    assert.equal(imported.contacts.length, 1);
    r = await api.get(`/api/companies/${imported.id}/applications`);
    assert.equal(r.body.length, 1);
    assert.equal(r.body[0].application_date, "2026-09-01");
    r = await api.get("/api/companies?search=Bad%20Date");
    assert.equal(r.body.length, 0);
    r = await api.delete("/api/contacts/" + contact.id);
    assert.equal(r.status, 204);
    r = await api.get("/api/follow-ups/" + follow.id);
    assert.equal(r.body.contact_id, null);
    r = await api.delete("/api/notes/" + note.id);
    assert.equal(r.status, 204);
    r = await api.delete("/api/follow-ups/" + follow.id);
    assert.equal(r.status, 204);
    r = await api.delete("/api/applications/" + application.id);
    assert.equal(r.status, 204);
    await api
      .post("/api/contacts")
      .send({ company_id: company.id, name: "Cascade test" });
    r = await api.delete("/api/companies/" + company.id);
    assert.equal(r.status, 204);
    r = await api.get(`/api/companies/${company.id}/contacts`);
    assert.equal(r.status, 404);
    r = await api.get("/api/companies/" + company.id);
    assert.equal(r.status, 404);
    r = await api.get("/api/companies/not-an-id");
    assert.equal(r.status, 400);
    r = await api.get(
      "/api/companies?search=" +
        encodeURIComponent("'; DROP TABLE companies;--"),
    );
    assert.equal(r.status, 200);
    r = await api.get("/api/unknown");
    assert.equal(r.status, 404);
  },
);

test(
  "imports 216 companies with non-URL directory text without losing their source values",
  { skip: !enabled },
  async () => {
    const api = signedIn();
    const csv =
      "Company Name,Directory profile,Public email\n" +
      Array.from(
        { length: 216 },
        (_, i) => `Import regression ${i},View profile,N/A`,
      ).join("\n");
    let response = await api
      .post("/api/companies/import")
      .attach("file", Buffer.from(csv), "companies.csv");
    assert.equal(response.status, 200);
    assert.equal(response.body.imported, 216);
    assert.equal(response.body.failed, 0);
    assert.equal(response.body.warnings.length, 216);
    let company = (
      await api.get("/api/companies?search=Import%20regression%200")
    ).body[0];
    assert.equal(company.directory_profile_url, null);
    assert.match(company.notes, /Imported directory profile url: View profile/);
    response = await api
      .post("/api/companies/import")
      .attach("file", Buffer.from(csv), "companies.csv");
    assert.equal(response.body.updated, 216);
    assert.equal(response.body.failed, 0);
    company = (await api.get("/api/companies?search=Import%20regression%200"))
      .body[0];
    assert.equal(company.notes, "Imported directory profile url: View profile");
    const urls =
      "Company,Directory profile,Website,Application date,Applied?\nBare URL,www.example.com,example.com,31/12/2026,TRUE";
    response = await api
      .post("/api/companies/import")
      .attach("file", Buffer.from(urls), "companies.csv");
    assert.equal(response.body.imported, 1);
    assert.equal(response.body.failed, 0);
    company = (await api.get("/api/companies?search=Bare%20URL")).body[0];
    assert.equal(company.website, "https://example.com");
    assert.equal(company.application_date, "2026-12-31");
    const formula =
      'Company,Directory profile\nFormula,"=HYPERLINK(""https://example.com"",""Visit"")"';
    response = await api
      .post("/api/companies/import")
      .attach("file", Buffer.from(formula), "companies.csv");
    assert.equal(response.body.imported, 1);
    assert.equal(response.body.warnings.length, 0);
    company = (await api.get("/api/companies?search=Formula")).body[0];
    assert.equal(company.directory_profile_url, "https://example.com");
  },
);

test(
  "No response casing is not counted as a reply and reimport repairs existing applications",
  { skip: !enabled },
  async () => {
    const api = signedIn();
    const csv =
      "Company,Applied?,Response\nResponse case regression,Yes,No response";
    let result = await api
      .post("/api/companies/import")
      .attach("file", Buffer.from(csv), "case.csv");
    assert.equal(result.body.imported, 1);
    const company = (
      await api.get("/api/companies?search=Response%20case%20regression")
    ).body[0];
    let application = (
      await api.get(`/api/companies/${company.id}/applications`)
    ).body[0];
    assert.equal(company.response, "No Response");
    assert.equal(application.response, "No Response");
    await pool.query(
      "UPDATE applications SET response=' No response ' WHERE id=$1",
      [application.id],
    );
    const before = (await api.get("/api/dashboard")).body.responsesReceived;
    result = await api.get(
      "/api/companies?search=Response%20case%20regression&response=Responded",
    );
    assert.equal(result.body.length, 0);
    result = await api.get(
      "/api/companies?search=Response%20case%20regression&response=No%20Response",
    );
    assert.equal(result.body.length, 1);
    await api
      .post("/api/companies/import")
      .attach("file", Buffer.from(csv), "case.csv");
    const applications = (
      await api.get(`/api/companies/${company.id}/applications`)
    ).body;
    assert.equal(applications.length, 1);
    assert.equal(applications[0].response, "No Response");
    assert.equal(
      (await api.get("/api/dashboard")).body.responsesReceived,
      before,
    );
    await api
      .put("/api/applications/" + application.id)
      .send({ response: "Responded" });
    assert.equal(
      (await api.get("/api/dashboard")).body.responsesReceived,
      before + 1,
    );
  },
);

test(
  "accounts enforce login, isolated CRUD/import/dashboard, logout and session expiry",
  { skip: !enabled },
  async () => {
    const owner = signedIn();
    const anonymous = request(app);
    for (const path of [
      "/companies",
      "/applications",
      "/contacts",
      "/follow-ups",
      "/dashboard",
    ])
      assert.equal((await anonymous.get("/api" + path)).status, 401);
    let response = await anonymous.post("/api/auth/signup").send({
      name: "CSRF",
      email: "csrf@example.com",
      password: "Good password 2026",
    });
    assert.equal(response.status, 403);
    response = await anonymous
      .post("/api/auth/signup")
      .set("X-Requested-With", "InternshipTracker")
      .set("Origin", "https://untrusted.example")
      .send({
        name: "CSRF",
        email: "csrf@example.com",
        password: "Good password 2026",
      });
    assert.equal(response.status, 403);
    response = await anonymous
      .post("/api/auth/signup")
      .set("X-Requested-With", "InternshipTracker")
      .send({ name: "Weak", email: "weak@example.com", password: "short" });
    assert.equal(response.status, 400);
    const other = request
      .agent(app)
      .set("X-Requested-With", "InternshipTracker");
    response = await other.post("/api/auth/signup").send({
      name: "Second account",
      email: "Other@Example.com",
      password: "Other password 2026!",
    });
    assert.equal(response.status, 201);
    const otherId = response.body.user.id;
    assert.equal(response.body.user.email, "other@example.com");
    assert.equal(response.body.user.password_hash, undefined);
    const hash = (
      await pool.query("SELECT password_hash FROM users WHERE id=$1", [otherId])
    ).rows[0].password_hash;
    assert.notEqual(hash, "Other password 2026!");
    assert.match(hash, /^[a-f0-9]+:[a-f0-9]+$/);
    assert.equal((await other.get("/api/companies")).body.length, 0);
    assert.equal((await other.get("/api/dashboard")).body.totalCompanies, 0);
    response = await other.post("/api/auth/signup").send({
      name: "Duplicate",
      email: "OTHER@example.com",
      password: "Other password 2026!",
    });
    assert.equal(response.status, 409);
    const ownCompany = (
      await owner
        .post("/api/companies")
        .send({ name: "Shared name", description: "Private owner notes" })
    ).body;
    const otherCompany = (
      await other.post("/api/companies").send({ name: "Shared name" })
    ).body;
    assert.ok(otherCompany.id);
    assert.notEqual(otherCompany.id, ownCompany.id);
    for (const method of ["get", "put", "delete"]) {
      const call = other[method]("/api/companies/" + ownCompany.id);
      response = await (method === "put"
        ? call.send({ name: "Stolen" })
        : call);
      assert.equal(response.status, 404);
    }
    const contact = (
      await owner
        .post("/api/contacts")
        .send({ company_id: ownCompany.id, name: "Private contact" })
    ).body;
    const application = (
      await owner
        .post("/api/applications")
        .send({ company_id: ownCompany.id, position: "Private application" })
    ).body;
    const follow = (
      await owner.post("/api/follow-ups").send({
        company_id: ownCompany.id,
        application_id: application.id,
        contact_id: contact.id,
        follow_up_date: "2026-12-12",
      })
    ).body;
    const note = (
      await owner
        .post(`/api/companies/${ownCompany.id}/notes`)
        .send({ note: "Private note" })
    ).body;
    for (const [path, record] of [
      ["contacts", contact],
      ["applications", application],
      ["follow-ups", follow],
      ["notes", note],
    ]) {
      response = await other
        .put(`/api/${path}/${record.id}`)
        .send(path === "notes" ? { note: "Stolen" } : { notes: "Stolen" });
      assert.equal(response.status, 404);
      response = await other.delete(`/api/${path}/${record.id}`);
      assert.equal(response.status, 404);
      if (path !== "notes")
        assert.equal(
          (await other.get(`/api/${path}/${record.id}`)).status,
          404,
        );
    }
    for (const path of ["contacts", "applications", "notes"])
      assert.equal(
        (await other.get(`/api/companies/${ownCompany.id}/${path}`)).status,
        404,
      );
    response = await other
      .post("/api/contacts")
      .send({ company_id: ownCompany.id, name: "Injected contact" });
    assert.equal(response.status, 404);
    response = await other
      .post("/api/applications")
      .send({ company_id: ownCompany.id });
    assert.equal(response.status, 404);
    response = await other
      .post(`/api/companies/${ownCompany.id}/notes`)
      .send({ note: "Injected note" });
    assert.equal(response.status, 404);
    response = await other.post("/api/follow-ups").send({
      company_id: otherCompany.id,
      application_id: application.id,
      follow_up_date: "2026-12-12",
    });
    assert.equal(response.status, 400);
    assert.equal(
      (await other.patch(`/api/follow-ups/${follow.id}/complete`)).status,
      404,
    );
    const csv = "Company,Notes\nShared name,Second account notes";
    response = await other
      .post("/api/companies/import")
      .attach("file", Buffer.from(csv), "private.csv");
    assert.equal(response.body.updated, 1);
    assert.equal(
      (await owner.get("/api/companies/" + ownCompany.id)).body.notes,
      null,
    );
    assert.equal(
      (await other.get("/api/companies/" + otherCompany.id)).body.notes,
      "Second account notes",
    );
    assert.equal((await other.get("/api/dashboard")).body.totalCompanies, 1);
    for (const path of ["contacts", "applications", "follow-ups"])
      assert.equal((await other.get("/api/" + path)).body.length, 0);
    const oldCookie = other.jar
      .getCookies({ domain: "127.0.0.1", path: "/api", secure: false })
      .toValueString();
    assert.equal((await other.post("/api/auth/logout")).status, 204);
    assert.equal((await other.get("/api/auth/me")).status, 401);
    if (oldCookie)
      assert.equal(
        (await anonymous.get("/api/auth/me").set("Cookie", oldCookie)).status,
        401,
      );
    assert.equal(
      (
        await other
          .post("/api/auth/login")
          .send({ email: "other@example.com", password: "Wrong password" })
      ).status,
      401,
    );
    response = await other
      .post("/api/auth/login")
      .send({ email: "OTHER@example.com", password: "Other password 2026!" });
    assert.equal(response.status, 200);
    const cookie = response.headers["set-cookie"][0].split(";")[0];
    assert.equal((await other.get("/api/auth/me")).body.user.id, otherId);
    await pool.query(
      "UPDATE auth_sessions SET expires_at=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE user_id=$1",
      [otherId],
    );
    assert.equal(
      (await anonymous.get("/api/auth/me").set("Cookie", cookie)).status,
      401,
    );
    // Exhaust the IP throttle with invalid credentials. Avoid hashing for these invalid inputs.
    await pool.query("DELETE FROM auth_rate_limits");
    for (let i = 0; i < 30; i++)
      await anonymous
        .post("/api/auth/login")
        .set("X-Requested-With", "InternshipTracker")
        .send({ email: "bad", password: "short" });
    assert.equal(
      (
        await anonymous
          .post("/api/auth/login")
          .set("X-Requested-With", "InternshipTracker")
          .send({ email: "bad", password: "short" })
      ).status,
      429,
    );
    await pool.query("DELETE FROM auth_rate_limits");
  },
);

test(
  "remembered login survives a new browser session, renews active tokens, and stays revoked after logout",
  { skip: !enabled },
  async () => {
    const agent = request
      .agent(app)
      .set("X-Requested-With", "InternshipTracker");
    const registration = await agent
      .post("/api/auth/signup")
      .send({
        name: "Remember test",
        email: "remember@example.com",
        password: "Remember this browser 2026!",
      });
    assert.equal(registration.status, 201);
    assert.match(registration.headers["set-cookie"][0], /Max-Age=7776000/);
    const cookie = registration.headers["set-cookie"][0].split(";")[0];
    const userId = registration.body.user.id;
    // A fresh client sends the persisted cookie, as a reopened browser would.
    const restored = request
      .agent(app)
      .set("Cookie", cookie)
      .set("X-Requested-With", "InternshipTracker");
    assert.equal((await restored.get("/api/auth/me")).body.user.id, userId);
    await pool.query(
      "UPDATE auth_sessions SET expires_at=CURRENT_TIMESTAMP+INTERVAL '7 days' WHERE user_id=$1",
      [userId],
    );
    const refreshed = await restored.get("/api/auth/me");
    assert.equal(refreshed.status, 200);
    assert.ok(refreshed.headers["set-cookie"]);
    const expiry = (
      await pool.query(
        "SELECT expires_at FROM auth_sessions WHERE user_id=$1",
        [userId],
      )
    ).rows[0].expires_at;
    assert.ok(
      new Date(expiry).getTime() > Date.now() + 89 * 24 * 60 * 60 * 1000,
    );
    assert.equal(
      (await restored.get("/api/auth/me")).headers["set-cookie"],
      undefined,
    );
    await restored.post("/api/auth/logout");
    assert.equal(
      (await request(app).get("/api/auth/me").set("Cookie", cookie)).status,
      401,
    );
    const login = await agent
      .post("/api/auth/login")
      .send({
        email: "remember@example.com",
        password: "Remember this browser 2026!",
      });
    assert.equal(login.status, 200);
    assert.match(login.headers["set-cookie"][0], /Max-Age=7776000/);
  },
);

test("applied companies need a follow-up before one is scheduled, counted once", { skip: !enabled }, async () => {
  const api = signedIn();
  const baseline = (await api.get('/api/dashboard')).body.companiesNeedingFollowUp;
  const created = await api.post('/api/companies').send({ name: 'Follow-up email regression' });
  assert.equal(created.status, 201);
  const id = created.body.id;
  async function check(needed) {
    const dashboard = await api.get('/api/dashboard');
    assert.equal(dashboard.body.companiesNeedingFollowUp, baseline + Number(needed));
    const filtered = await api.get('/api/companies?follow_up=needed');
    assert.equal(filtered.body.some(company => company.id === id), needed);
  }
  try {
    await check(false);
    await api.put(`/api/companies/${id}`).send({ application_status: 'Applied' }).expect(200);
    await check(true);
    await api.put(`/api/companies/${id}`).send({ application_status: 'Not Applied' }).expect(200);
    for (let n = 0; n < 2; n++)
      await api.post('/api/applications').send({ company_id: id }).expect(201);
    await check(true);
    await api.put(`/api/companies/${id}`).send({ follow_up_sent: true }).expect(200);
    await check(false);
    const sent = await api.get('/api/companies?follow_up=sent');
    assert.ok(sent.body.some(company => company.id === id));
    await api.put(`/api/companies/${id}`).send({ follow_up_sent: false }).expect(200);
    await check(true);
    const scheduled = await api.post('/api/follow-ups').send({ company_id: id, follow_up_date: '2026-10-01' });
    assert.equal(scheduled.status, 201);
    await check(true);
    await api.patch(`/api/follow-ups/${scheduled.body.id}/complete`).expect(200);
    await check(false);
    await api.put(`/api/follow-ups/${scheduled.body.id}`).send({ status: 'Cancelled' }).expect(200);
    await check(true);
  } finally {
    await api.delete(`/api/companies/${id}`);
  }
});
