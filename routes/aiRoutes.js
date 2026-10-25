import express from "express";
import { chat, summarize, smartLeave } from "../controllers/aiController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { aiRateLimit } from "../middleware/aiRateLimit.js";

const router = express.Router();

router.use(requireAuth);
router.use(aiRateLimit);

router.post("/chat", chat); // all roles — scope enforced per-tool inside aiTools.js
router.post("/summarize", requireRole("admin", "hr"), summarize);
router.post("/smart-leave", requireRole("employee"), smartLeave);

export default router;