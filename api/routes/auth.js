const express = require("express");
const {
  authenticateTenant,
} = require("../middleware/auth");

const router = express.Router();

router.get("/me", authenticateTenant, (req, res) => {
  res.status(200).json({
    authenticated: true,
    tenant: req.tenant,
  });
});

module.exports = router;
