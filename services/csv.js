const { parse } = require("csv-parse/sync");
const { bad } = require("../controllers/records");

const normalize = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const aliases = {
  Company: ["company", "company name", "name"],
  "Company Description / What They Do": [
    "description",
    "company description",
    "company description what they do",
    "what they do",
  ],
  "Directory profile": [
    "directory profile",
    "directory profile url",
    "directory url",
  ],
  "Public email": ["public email", "general email", "email"],
  "Careers email": ["careers email", "career email"],
  Website: ["website", "website url", "company website"],
  LinkedIn: ["linkedin", "linkedin url", "linkedin company url"],
  Category: ["category", "company category", "industry"],
  Location: ["location", "address"],
  Phone: ["phone", "phone number"],
  Notes: ["notes", "note"],
  "Applied?": ["applied", "application status", "status"],
  "Application date": ["application date", "date applied", "applied date"],
  "Follow-up sent?": ["follow up sent", "followup sent", "followed up"],
  "Follow-up date": ["follow up date", "followup date"],
  Response: ["response", "reply"],
  "CEO / Founder": ["ceo founder", "ceo", "founder"],
  "HR / Recruiter": ["hr recruiter", "hr", "recruiter"],
  "Technical / Team Lead": [
    "technical team lead",
    "technical lead",
    "team lead",
  ],
};
const headers = new Map(
  Object.entries(aliases).flatMap(([key, values]) =>
    values.map((value) => [normalize(value), key]),
  ),
);
const blank = (value) =>
  /^(?:n\/?a|none|null|unknown|not available|not found|-+|—)$/i.test(
    value.trim(),
  )
    ? ""
    : value.trim();
function readCsv(buffer) {
  if (buffer.subarray(0, 2).toString() === "PK")
    throw bad("This is an Excel workbook. Export it as CSV UTF-8 first.");
  let source = buffer.toString("utf8").replace(/^\uFEFF/, "");
  let delimiter;
  const separator = source.match(/^sep=([,;\t])\r?\n/i);
  if (separator) {
    delimiter = separator[1];
    source = source.slice(separator[0].length);
  }
  if (!source.trim())
    throw bad(
      "This file is empty. Add column headers and at least one company.",
    );
  if (!delimiter) {
    for (const candidate of [",", ";", "\t"]) {
      try {
        const [first] = parse(source, {
          delimiter: candidate,
          to: 1,
          skip_empty_lines: true,
          trim: true,
        });
        if (
          first?.some(
            (cell) => headers.get(normalize(cell.trim())) === "Company",
          )
        ) {
          delimiter = candidate;
          break;
        }
      } catch {
        /* Try the next spreadsheet separator. */
      }
    }
  }
  let rows;
  try {
    rows = parse(source, {
      delimiter: delimiter || ",",
      bom: true,
      skip_empty_lines: true,
      trim: true,
      info: true,
      columns: (values) => {
        const mapped = values.map(
          (value) => headers.get(normalize(value.trim())) || false,
        );
        if (!mapped.includes("Company"))
          throw bad("Add a Company or Company Name column to your CSV.");
        const used = mapped.filter(Boolean);
        if (new Set(used).size !== used.length)
          throw bad(
            "Two columns map to the same field. Keep only one column for each field.",
          );
        return mapped;
      },
    });
  } catch (error) {
    if (error.status === 400) throw error;
    throw bad(
      `Could not read the CSV${error.lines ? " near line " + error.lines : ""}. Check that every row has the same number of columns and quote text containing commas.`,
    );
  }
  if (!rows.length) throw bad("The CSV has headers but no company rows.");
  if (rows.length > 10000)
    throw bad("Please import at most 10,000 rows at a time.");
  return rows.map(({ record, info }) => ({
    row: Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key,
        key === "Company" ? value.trim() : blank(value),
      ]),
    ),
    line: info.lines,
  }));
}
function csvDate(value, order = "DMY") {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) {
    const [, a, b, year] = match;
    const [day, month] = order === "MDY" ? [b, a] : [a, b];
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  throw bad(
    `Unrecognized date "${value}". Use YYYY-MM-DD or the selected day/month order.`,
  );
}
const yes = (value) => /^(yes|y|true|1|applied|✓)$/i.test(value || "");
module.exports = { readCsv, csvDate, yes };
