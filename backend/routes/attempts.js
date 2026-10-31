const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
    startAttempt,
    listMyAttempts,
    listTeacherMonitoring,
    getTeacherAttemptDetail,
    getMyAttempt,
    saveAnswer,
    submitAttempt
} = require("../controllers/attemptController");

const { listViolations, createViolation } = require("../controllers/violationController");

const router = express.Router();
router.use(requireAuth);
router.get("/monitoring", requireRole("teacher"), listTeacherMonitoring);
router.get("/monitoring/:id", requireRole("teacher"), getTeacherAttemptDetail);
router.get("/:id/violations", listViolations);
router.post("/:id/violations", requireRole("student"), createViolation);
router.use(requireRole("student"));
router.get("/", listMyAttempts);
router.post("/", startAttempt);
router.get("/:id", getMyAttempt);
router.put("/:id/answers/:questionId", saveAnswer);
router.post("/:id/submit", submitAttempt);
module.exports = router;
