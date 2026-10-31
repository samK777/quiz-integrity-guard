const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const {
    createBatchInvite,
    revokeBatchInvite,
    requestBatchJoin,
    listMyBatchJoinRequests,
    listBatchJoinRequests,
    resolveBatchJoinRequest
} = require("../controllers/batchInviteController");
const {
    createBatch,
    listBatches,
    getBatchStudents,
    addStudentToBatch,
    removeStudentFromBatch
} = require("../controllers/batchController");

const router = express.Router();
router.use(requireAuth);
router.post("/join-requests", requireRole("student"), requestBatchJoin);
router.get("/my-join-requests", requireRole("student"), listMyBatchJoinRequests);

router.use(requireRole("teacher"));
router.post("/", createBatch);
router.get("/", listBatches);
router.get("/:id/students", getBatchStudents);
router.post("/:id/students", addStudentToBatch);
router.delete("/:id/students/:studentId", removeStudentFromBatch);
router.post("/:id/invite", createBatchInvite);
router.delete("/:id/invite", revokeBatchInvite);
router.get("/:id/join-requests", listBatchJoinRequests);
router.post("/:id/join-requests/:requestId/decision", resolveBatchJoinRequest);

module.exports = router;
