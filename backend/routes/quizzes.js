const express = require("express");

const { requireAuth, requireRole } = require("../middleware/auth");

const {
    listActiveQuizzes,
    listTeacherQuizzes,
    getActiveQuiz,
    createQuiz,
    addQuestion
} = require("../controllers/quizController");

const {
    assignQuizBatches,
    refreshQuizInvitations,
    listQuizInvitations,
    revokeQuizInvitation
} = require("../controllers/quizInvitationController");

const router = express.Router();

// Teacher quiz management
router.get("/manage", requireAuth, requireRole("teacher"), listTeacherQuizzes);
router.post("/", requireAuth, requireRole("teacher"), createQuiz);

// Teacher batch assignment and invitation management
router.put("/:id/batches", requireAuth, requireRole("teacher"), assignQuizBatches);
router.post("/:id/invitations/refresh", requireAuth, requireRole("teacher"), refreshQuizInvitations);
router.get("/:id/invitations", requireAuth, requireRole("teacher"), listQuizInvitations);
router.delete("/:id/invitations/:invitationId", requireAuth, requireRole("teacher"), revokeQuizInvitation);

// Student quiz access
router.get("/", requireAuth, requireRole("student"), listActiveQuizzes);
router.get("/:id", requireAuth, requireRole("student"), getActiveQuiz);

// Teacher question management
router.post("/:id/questions", requireAuth, requireRole("teacher"), addQuestion);

module.exports = router;