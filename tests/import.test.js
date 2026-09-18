const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readCsv, csvDate, yes } = require("../services/csv");
const { validate } = require("../controllers/records");
test("spreadsheet imports accept header aliases, delimiters, missing optional values and date orders", () => {
  const rows = readCsv(
    Buffer.from(
      "\uFEFFCompany Name;Directory Profile;Public Email;Date Applied\r\nExample;example.com;N/A;31/12/2026\r\n",
    ),
  );
  assert.equal(rows[0].row.Company, "Example");
  assert.equal(rows[0].row["Public email"], "");
  assert.equal(rows[0].line, 2);
  assert.equal(
    readCsv(Buffer.from("Company\tWebsite\nExample\texample.com"))[0].row
      .Website,
    "example.com",
  );
  assert.equal(
    readCsv(Buffer.from("sep=;\nCompany;Website\nExample;example.com"))[0].row
      .Company,
    "Example",
  );
  assert.equal(csvDate("31/12/2026"), "2026-12-31");
  assert.equal(csvDate("12/31/2026", "MDY"), "2026-12-31");
  assert.equal(csvDate("2026-09-18"), "2026-09-18");
  assert.equal(csvDate(""), null);
  assert.ok(yes("TRUE"));
  assert.throws(() => readCsv(Buffer.from("Company\n")), /no company rows/);
  assert.throws(
    () => readCsv(Buffer.from("Company,Company Name\nA,B")),
    /Two columns/,
  );
  assert.throws(
    () => readCsv(Buffer.from("PK\u0003\u0004data")),
    /Excel workbook/,
  );
});
test("company forms accept name only, blank statuses, and websites without protocol", () => {
  assert.deepEqual(validate("companies", { name: "Example" }, true), {
    name: "Example",
  });
  const data = validate(
    "companies",
    {
      name: "Example",
      application_status: "",
      response: "",
      follow_up_sent: null,
      website: "www.example.com",
      general_email: "",
    },
    true,
  );
  assert.equal(data.application_status, "Not Applied");
  assert.equal(data.response, "No Response");
  assert.equal(data.follow_up_sent, false);
  assert.equal(data.website, "https://www.example.com");
  assert.equal(data.general_email, null);
  assert.throws(
    () => validate("companies", { website: "javascript:alert(1)" }, false),
    /Links/,
  );
  assert.throws(
    () => validate("companies", { website: "not a link" }, false),
    /Links/,
  );
});
