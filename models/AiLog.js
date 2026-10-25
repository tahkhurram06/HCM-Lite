import mongoose from "mongoose";

// Every AI call is logged here — endpoint, what was asked, what came back,
// which tools ran, timing, and any error. Required by the brief's AI
// guardrails ("every call logged in ai_logs").
const aiLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, required: true },
    endpoint: { type: String, required: true }, // "chat" | "summarize" | "smart-leave"
    request: { type: String },
    response: { type: String },
    toolCalls: { type: mongoose.Schema.Types.Mixed }, // [{ name, args, result }]
    durationMs: { type: Number },
    error: { type: String },
  },
  { timestamps: true }
);

aiLogSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("AiLog", aiLogSchema);