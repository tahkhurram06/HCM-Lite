// One-time dev helper: wipes Users and Settings so you can re-run
// POST /api/auth/setup cleanly. Delete this file once you're done testing.
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "./config/db.js";
import User from "./models/User.js";
import Settings from "./models/Settings.js";
import LeaveType from "./models/LeaveType.js";

async function reset() {
  await connectDB();
  const u = await User.deleteMany({});
  const s = await Settings.deleteMany({});
  const l = await LeaveType.deleteMany({});
  console.log(`Deleted ${u.deletedCount} users, ${s.deletedCount} settings, ${l.deletedCount} leave types`);
  await mongoose.disconnect();
  process.exit(0);
}

reset();