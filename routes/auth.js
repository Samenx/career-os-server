const router = require("express").Router();
const { requireAuth, limitAuth } = require("../middleware/auth");
const auth = require("../controllers/auth");
router.post("/signup", limitAuth, auth.signup);
router.post("/login", limitAuth, auth.login);
router.post("/logout", auth.logout);
router.get("/me", requireAuth, auth.me);
module.exports = router;
