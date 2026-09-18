const { readCsv, csvDate, yes } = require("../services/csv");
const pool = require("../db/database");
const { save, bad, validate } = require("./records");
module.exports = async (req, res) => {
  if (!req.file) throw bad("Choose a CSV file.");
  const rows = readCsv(req.file.buffer);
  const dateOrder = req.body.date_order === "MDY" ? "MDY" : "DMY";
  const result = {
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    warnings: [],
  };
  const db = await pool.connect();
  try {
    for (const { row, line } of rows) {
      if (!row.Company?.trim()) {
        result.skipped++;
        continue;
      }
      if (row.Response) {
        const canonical = [
          "No Response",
          "Responded",
          "Interview",
          "Rejected",
          "Accepted",
        ].find(
          (value) => value.toLowerCase() === row.Response.trim().toLowerCase(),
        );
        if (canonical) row.Response = canonical;
      }
      await db.query("BEGIN");
      try {
        // Serialize imports with the same normalized name to avoid duplicate races.
        await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          req.user.id + ":" + row.Company.trim().toLowerCase(),
        ]);
        const existing = (
          await db.query(
            "SELECT * FROM companies WHERE lower(btrim(name))=lower(btrim($1)) AND owner_id=$2",
            [row.Company, req.user.id],
          )
        ).rows[0];
        const company = { name: row.Company };
        for (const [header, field] of Object.entries({
          "Company Description / What They Do": "description",
          "Directory profile": "directory_profile_url",
          "Public email": "general_email",
          "Careers email": "careers_email",
          Website: "website",
          LinkedIn: "linkedin_url",
          Category: "category",
          Location: "location",
          Phone: "phone",
          Notes: "notes",
        }))
          if (row[header]) company[field] = row[header];
        const rowWarnings = [];
        const preserved = [];
        for (const field of [
          "website",
          "linkedin_url",
          "directory_profile_url",
          "general_email",
          "careers_email",
        ]) {
          if (!company[field]) continue;
          let value = company[field];
          // Recover actual URLs from common spreadsheet/Markdown hyperlink exports.
          const formula = value.match(/^=HYPERLINK\(\s*"([^"]+)"/i);
          const markdown = value.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/i);
          if (formula || markdown) value = (formula || markdown)[1];
          try {
            company[field] = validate("companies", { [field]: value }, false)[
              field
            ];
          } catch {
            preserved.push(
              `Imported ${field.replaceAll("_", " ")}: ${company[field]}`,
            );
            delete company[field];
            rowWarnings.push({
              row: line,
              message: `${field.replaceAll("_", " ")} was saved in notes because it is not a valid link or email.`,
            });
          }
        }
        if (preserved.length) {
          const note = company.notes || existing?.notes || "";
          company.notes = [
            note,
            ...preserved.filter((value) => !note.includes(value)),
          ]
            .filter(Boolean)
            .join("\n");
        }
        if (yes(row["Applied?"])) company.application_status = "Applied";
        if (row["Application date"])
          company.application_date = csvDate(
            row["Application date"],
            dateOrder,
          );
        if (row["Follow-up date"])
          company.follow_up_date = csvDate(row["Follow-up date"], dateOrder);
        if (yes(row["Follow-up sent?"])) company.follow_up_sent = true;
        if (
          [
            "No Response",
            "Responded",
            "Interview",
            "Rejected",
            "Accepted",
          ].includes(row.Response)
        )
          company.response = row.Response;
        const record = await save(
          "companies",
          company,
          existing?.id,
          db,
          req.user.id,
        );
        for (const [header, type] of Object.entries({
          "CEO / Founder": "CEO / Founder",
          "HR / Recruiter": "HR / Recruiter",
          "Technical / Team Lead": "Technical Lead",
        })) {
          if (row[header]) {
            const found = await db.query(
              "SELECT id FROM contacts WHERE company_id=$1 AND lower(name)=lower($2) AND contact_type=$3",
              [record.id, row[header], type],
            );
            if (!found.rowCount)
              await save(
                "contacts",
                {
                  company_id: record.id,
                  name: row[header],
                  contact_type: type,
                },
                null,
                db,
                req.user.id,
              );
          }
        }
        if (yes(row["Applied?"])) {
          const found = await db.query(
            "SELECT id FROM applications WHERE company_id=$1 AND position='Imported application' AND application_date IS NOT DISTINCT FROM $2::date",
            [record.id, csvDate(row["Application date"], dateOrder)],
          );
          if (found.rowCount && row.Response)
            await save(
              "applications",
              { response: row.Response },
              found.rows[0].id,
              db,
              req.user.id,
            );
          if (!found.rowCount)
            await save(
              "applications",
              {
                company_id: record.id,
                position: "Imported application",
                application_date: csvDate(row["Application date"], dateOrder),
                status: "Applied",
                response: row.Response || null,
                application_method: "Other",
              },
              null,
              db,
              req.user.id,
            );
        }
        await db.query("COMMIT");
        result.warnings.push(...rowWarnings);
        result[existing ? "updated" : "imported"]++;
      } catch (error) {
        await db.query("ROLLBACK");
        result.failed++;
        result.errors.push({
          row: line,
          message:
            error.status === 400
              ? error.message
              : "Invalid value or database constraint. Check this row.",
        });
      }
    }
  } finally {
    db.release();
  }
  res.json(result);
};
