const express = require("express");
const multer = require("multer");
const { controller } = require("../controllers/records");
const router = express.Router();
router.post(
  "/companies/import",
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
  }).single("file"),
  require("../controllers/import"),
);
router.get("/dashboard", require("../controllers/dashboard"));
for (const [path, table] of Object.entries({
  companies: "companies",
  contacts: "contacts",
  applications: "applications",
  "follow-ups": "follow_ups",
})) {
  const c = controller(table);
  router.get("/" + path, c.list);
  router.get("/" + path + "/:id", c.get);
  router.post("/" + path, c.create);
  router.put("/" + path + "/:id", c.update);
  router.delete("/" + path + "/:id", c.remove);
}
for (const [path, table] of Object.entries({
  contacts: "contacts",
  applications: "applications",
  notes: "company_notes",
}))
  router.get("/companies/:companyId/" + path, controller(table).list);
router.post("/companies/:companyId/notes", controller("company_notes").create);
router.put("/notes/:id", controller("company_notes").update);
router.delete("/notes/:id", controller("company_notes").remove);
router.patch("/follow-ups/:id/complete", (req, res, next) => {
  req.body = { status: "Completed" };
  return controller("follow_ups").update(req, res, next);
});
module.exports = router;
