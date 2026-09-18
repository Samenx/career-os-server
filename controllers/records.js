const pool = require("../db/database");
const { needsFollowUp, followUpSent } = require("../services/follow-up");
const { ownerCondition, requireCompany } = require("../services/ownership");
const definitions = {
  companies: {
    fields: [
      "name",
      "description",
      "category",
      "website",
      "linkedin_url",
      "directory_profile_url",
      "general_email",
      "careers_email",
      "phone",
      "location",
      "notes",
      "application_status",
      "application_date",
      "applied_through_linkedin",
      "response",
      "follow_up_sent",
      "follow_up_date",
    ],
    required: ["name"],
    updated: true,
  },
  contacts: {
    fields: [
      "company_id",
      "name",
      "job_title",
      "contact_type",
      "email",
      "phone",
      "linkedin_url",
      "notes",
    ],
    required: ["company_id", "name"],
  },
  applications: {
    fields: [
      "company_id",
      "position",
      "application_date",
      "application_method",
      "applied_through_linkedin",
      "status",
      "response",
      "notes",
      "follow_up_date",
    ],
    required: ["company_id"],
    updated: true,
  },
  follow_ups: {
    fields: [
      "company_id",
      "application_id",
      "contact_id",
      "follow_up_date",
      "status",
      "notes",
    ],
    required: ["company_id", "follow_up_date"],
  },
  company_notes: {
    fields: ["company_id", "note"],
    required: ["company_id", "note"],
    updated: true,
  },
};
function bad(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
const fieldDefaults = {
  companies: {
    application_status: "Not Applied",
    response: "No Response",
    follow_up_sent: false,
  },
  contacts: { contact_type: "Other" },
  applications: { status: "Applied", applied_through_linkedin: false },
  follow_ups: { status: "Pending" },
};
function validate(table, body, creating) {
  const def = definitions[table];
  for (const key of def.required)
    if (
      (creating || key in body) &&
      (body[key] == null || String(body[key]).trim() === "")
    )
      throw bad(`${key.replaceAll("_", " ")} is required.`);
  const data = {};
  for (const key of def.fields)
    if (key in body) {
      let value = typeof body[key] === "string" ? body[key].trim() : body[key];
      if (value === "" && !def.required.includes(key)) value = null;
      if (value == null && Object.hasOwn(fieldDefaults[table] || {}, key))
        value = fieldDefaults[table][key];
      if (
        key.endsWith("_id") &&
        value != null &&
        (!Number.isInteger(Number(value)) || Number(value) < 1)
      )
        throw bad("Please select a valid linked record.");
      if (
        key.endsWith("_date") &&
        value != null &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          Number.isNaN(Date.parse(value)) ||
          new Date(value).toISOString().slice(0, 10) !== value)
      )
        throw bad("Use a valid date in YYYY-MM-DD format.");
      if (
        ["website", "linkedin_url", "directory_profile_url"].includes(key) &&
        value != null
      ) {
        if (typeof value === "string" && !/^[a-z][a-z0-9+.-]*:/i.test(value))
          value = "https://" + value;
        try {
          const url = new URL(value);
          if (!url.hostname.includes(".") || /\s/.test(value)) throw Error();
          if (!["http:", "https:"].includes(url.protocol)) throw Error();
        } catch {
          throw bad("Links must be valid http:// or https:// URLs.");
        }
      }
      if (
        ["email", "general_email", "careers_email"].includes(key) &&
        value != null &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      )
        throw bad("Please enter a valid email address.");
      if (
        ["follow_up_sent", "applied_through_linkedin"].includes(key) &&
        typeof value !== "boolean"
      )
        throw bad(
          key === "follow_up_sent"
            ? "Follow up sent must be true or false."
            : "Applied through LinkedIn must be true or false.",
        );
      if (key === "response" && typeof value === "string") {
        const canonical = [
          "No Response",
          "Responded",
          "Interview",
          "Rejected",
          "Accepted",
        ].find((option) => option.toLowerCase() === value.toLowerCase());
        if (canonical) value = canonical;
      }
      data[key] = value;
    }
  if (!Object.keys(data).length) throw bad("No fields were provided.");
  return data;
}
async function save(table, body, id, db = pool, userId) {
  if (!userId) throw new Error("Record writes require an authenticated owner.");
  const data = validate(table, body, !id);
  if (id) {
    const found = await db.query(
      `SELECT id FROM ${table} t WHERE t.id=$1 AND ${ownerCondition(table, "t", "$2")}`,
      [id, userId],
    );
    if (!found.rowCount) {
      const error = new Error("Record not found.");
      error.status = 404;
      throw error;
    }
  }
  if (table !== "companies" && data.company_id)
    await requireCompany(data.company_id, userId, db);
  if (table === "companies" && !id) data.owner_id = userId;
  const keys = Object.keys(data),
    values = Object.values(data);
  const sql = id
    ? `UPDATE ${table} t SET ${keys.map((key, i) => `${key}=$${i + 1}`).join(",")}${definitions[table].updated ? ",updated_at=CURRENT_TIMESTAMP" : ""} WHERE t.id=$${values.length + 1} AND ${ownerCondition(table, "t", `$${values.length + 2}`)} RETURNING *`
    : `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")}) RETURNING *`;
  const result = await db.query(sql, id ? [...values, id, userId] : values);
  if (!result.rows.length) {
    const error = new Error("Record not found.");
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}
function controller(table) {
  return {
    list: async (req, res) => {
      const values = [],
        conditions = [];
      const where = (sql, value) => {
        values.push(value);
        conditions.push(sql.replace("?", `$${values.length}`));
      };
      where(
        table === "companies" ? "t.owner_id=?" : "c.owner_id=?",
        req.user.id,
      );
      if (req.params.companyId || req.query.company_id) {
        await requireCompany(
          req.params.companyId || req.query.company_id,
          req.user.id,
        );
        where("t.company_id=?", req.params.companyId || req.query.company_id);
      }
      if (req.query.search)
        where(
          table === "companies"
            ? "t.name ILIKE ?"
            : table === "contacts"
              ? "(t.name || ' ' || c.name) ILIKE ?"
              : "c.name ILIKE ?",
          `%${req.query.search}%`,
        );
      if (req.query.category && table === "companies")
        where("t.category=?", req.query.category);
      if (req.query.type && table === "contacts")
        where("t.contact_type=?", req.query.type);
      if (req.query.status) {
        if (table === "companies") {
          if (req.query.status === "Not Applied")
            conditions.push(
              "t.application_status='Not Applied' AND NOT EXISTS(SELECT 1 FROM applications a WHERE a.company_id=t.id)",
            );
          else if (req.query.status === "Applied")
            conditions.push(
              "(t.application_status<>'Not Applied' OR EXISTS(SELECT 1 FROM applications a WHERE a.company_id=t.id))",
            );
          else {
            values.push(req.query.status);
            conditions.push(
              `(t.application_status=$${values.length} OR EXISTS(SELECT 1 FROM applications a WHERE a.company_id=t.id AND a.status=$${values.length}))`,
            );
          }
        } else if (["applications", "follow_ups"].includes(table))
          where("t.status=?", req.query.status);
      }
      if (req.query.response && table === "companies") {
        const responded =
          "(lower(btrim(coalesce(t.response,''))) NOT IN ('','no response') OR EXISTS(SELECT 1 FROM applications a WHERE a.company_id=t.id AND lower(btrim(coalesce(a.response,''))) NOT IN ('','no response')))";
        conditions.push(
          req.query.response === "No Response" ? `NOT ${responded}` : responded,
        );
      }
      const join =
        table === "companies" ? "" : " JOIN companies c ON c.id=t.company_id";
      if (table === "companies" && req.query.follow_up === "needed")
        conditions.push(needsFollowUp("t"));
      if (table === "companies" && req.query.follow_up === "sent")
        conditions.push(followUpSent("t"));
      if (table === "companies" && req.query.follow_up === "not_needed")
        conditions.push(`NOT ${needsFollowUp("t")}`);
      let columns =
        table === "companies"
          ? `t.*, (SELECT count(*)::int FROM applications a WHERE a.company_id=t.id) AS application_count, (SELECT a.status FROM applications a WHERE a.company_id=t.id ORDER BY a.application_date DESC NULLS LAST,a.id DESC LIMIT 1) AS latest_status, (SELECT a.application_date FROM applications a WHERE a.company_id=t.id ORDER BY a.application_date DESC NULLS LAST,a.id DESC LIMIT 1) AS latest_application_date, coalesce((SELECT json_agg(ct) FROM contacts ct WHERE ct.company_id=t.id),'[]') AS contacts`
          : "t.*,c.name AS company_name";
      let extra = "";
      if (table === "companies") {
        columns += ", COALESCE(t.applied_through_linkedin, EXISTS(SELECT 1 FROM applications a WHERE a.company_id=t.id AND a.applied_through_linkedin)) AS applied_through_linkedin";
      }
      if (table === "follow_ups") {
        columns +=
          ",a.position AS application_position,ct.name AS contact_name";
        extra =
          " LEFT JOIN applications a ON a.id=t.application_id LEFT JOIN contacts ct ON ct.id=t.contact_id";
      }
      const direction = req.query.direction === "desc" ? "DESC" : "ASC";
      const order =
        table === "companies"
          ? req.query.sort === "application_date"
            ? `coalesce((SELECT max(a.application_date) FROM applications a WHERE a.company_id=t.id),t.application_date) ${direction} NULLS LAST,t.id DESC`
            : `lower(t.name) ${direction},t.id DESC`
          : table === "follow_ups"
            ? "t.follow_up_date ASC,t.id DESC"
            : "t.id DESC";
      const result = await pool.query(
        `SELECT ${columns} FROM ${table} t${join}${extra}${conditions.length ? " WHERE " + conditions.join(" AND ") : ""} ORDER BY ${order}`,
        values,
      );
      res.json(result.rows);
    },
    get: async (req, res) => {
      const columns = table === "companies"
        ? "t.*, COALESCE(t.applied_through_linkedin, EXISTS(SELECT 1 FROM applications a WHERE a.company_id=t.id AND a.applied_through_linkedin)) AS applied_through_linkedin"
        : "t.*";
      const { rows } = await pool.query(
        `SELECT ${columns} FROM ${table} t WHERE t.id=$1 AND ${ownerCondition(table, "t", "$2")}`,
        [req.params.id, req.user.id],
      );
      if (!rows.length)
        return res.status(404).json({ error: "Record not found." });
      res.json(rows[0]);
    },
    create: async (req, res) =>
      res.status(201).json(
        await save(
          table,
          {
            ...req.body,
            ...(req.params.companyId
              ? { company_id: req.params.companyId }
              : {}),
          },
          null,
          pool,
          req.user.id,
        ),
      ),
    update: async (req, res) =>
      res.json(await save(table, req.body, req.params.id, pool, req.user.id)),
    remove: async (req, res) => {
      const result = await pool.query(
        `DELETE FROM ${table} t WHERE t.id=$1 AND ${ownerCondition(table, "t", "$2")} RETURNING id`,
        [req.params.id, req.user.id],
      );
      if (!result.rowCount)
        return res.status(404).json({ error: "Record not found." });
      res.status(204).end();
    },
  };
}
module.exports = { controller, save, bad, validate };
