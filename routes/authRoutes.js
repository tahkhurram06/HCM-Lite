import express from "express";
import {
  getSetupStatus,
  setupAdmin,
  login,
  getMe,
  changeOwnPassword,
  listUsers,
  createHrUser,
  deactivateUser,
  reactivateUser,
  resetUserPassword,
} from "../controllers/authController.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.get("/setup-status", getSetupStatus);
router.post("/setup", setupAdmin);
router.post("/login", login);
router.get("/me", requireAuth, getMe);
router.put("/change-password", requireAuth, changeOwnPassword);

// Admin: user management (brief M2 — "Create, deactivate and reset logins
// for HR and employees"). Employee accounts are also created via
// POST /api/employees (registerEmployee); these cover HR creation plus
// deactivate/reset for any non-admin login.
router.get("/users", requireAuth, requireRole("admin"), listUsers);
router.post("/hr", requireAuth, requireRole("admin"), createHrUser);
router.put("/users/:id/deactivate", requireAuth, requireRole("admin"), deactivateUser);
router.put("/users/:id/reactivate", requireAuth, requireRole("admin"), reactivateUser);
router.put("/users/:id/reset-password", requireAuth, requireRole("admin"), resetUserPassword);

export default router;