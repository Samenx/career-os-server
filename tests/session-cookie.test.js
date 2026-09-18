const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const request = require("supertest");
const {
  newSession,
  cookieName,
  cookieOptions,
} = require("../services/auth");

test("session cookies support deployed cross-site requests and local HTTP", async () => {
  const original = process.env.NODE_ENV;
  const app = express();
  const db = { query: async () => ({ rows: [] }) };
  app.post("/session", async (req, res) => {
    const setCookie = await newSession(req, res, 1, db);
    setCookie();
    res.sendStatus(204);
  });
  app.delete("/session", (req, res) => {
    res.clearCookie(cookieName, cookieOptions());
    res.sendStatus(204);
  });
  try {
    for (const environment of ["production", "development"]) {
      process.env.NODE_ENV = environment;
      const login = await request(app).post("/session").expect(204);
      const cookie = login.headers["set-cookie"][0];
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /Path=\/api/);
      assert.match(cookie, /Max-Age=7776000/);
      const logout = await request(app).delete("/session").expect(204);
      for (const value of [cookie, logout.headers["set-cookie"][0]]) {
        if (environment === "production") {
          assert.match(value, /SameSite=None/);
          assert.match(value, /; Secure/);
        } else {
          assert.match(value, /SameSite=Lax/);
          assert.doesNotMatch(value, /; Secure/);
        }
      }
      assert.match(logout.headers["set-cookie"][0], /Expires=Thu, 01 Jan 1970/);
    }
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
