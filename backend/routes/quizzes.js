const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
    listActiveQuizzes,
    listTeacherQuizzes,
    getActiveQuiz,
    createQuiz,
    addQuestion
} = require("../controllers/quizController");

const router = express.Router();

router.get("/manage", requireAuth, requireRole("teacher"), listTeacherQuizzes);
router.get("/", requireAuth, requireRole("student"), listActiveQuizzes);
router.get("/:id", requireAuth, requireRole("student"), getActiveQuiz);
router.post("/", requireAuth, requireRole("teacher"), createQuiz);
router.post("/:id/questions", requireAuth, requireRole("teacher"), addQuestion);

module.exports = router;
