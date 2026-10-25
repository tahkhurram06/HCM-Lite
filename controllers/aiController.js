import Employee from "../models/Employee.js";
import AiLog from "../models/AiLog.js";
import { runToolChat, callPlain } from "../utils/aiClient.js";
import { TOOL_SCHEMAS, TOOL_EXECUTORS } from "../utils/aiTools.js";

// Business rules from brief Section 3, condensed for the system prompt —
// the model answers policy questions ONLY from this, or says it doesn't know.
const POLICY_RULES = `
- Auth: JWT login, bcrypt passwords. Every request is checked by role AND data scope.
- Attendance: one check-in/out per employee per day. Late after office start time + grace
  minutes. Half day if worked hours fall below the half-day threshold. Absent if no record
  and no approved leave on a working day.
- Leave: working days only (weekends/holidays excluded). Default quotas: annual 14, sick 8,
  casual 10, unpaid unlimited. Overlapping requests or exceeding the balance are rejected.
- Payroll: gross = 1.5x basic (40% HRA + 10% medical of basic). Deductions for absent days,
  unpaid leave days, and half days (at half weight). Joiners/leavers are prorated. Only
  Admin finalizes payroll; once finalized a run is locked and can't be edited.
`.trim();

function buildSystemPrompt(user) {
  return `
You are the HCM Lite AI assistant, helping a logged-in ${user.role} user.
Answer ONLY from tool results or the policy rules below — never invent numbers,
dates, or anyone's personal data.

Policy rules:
${POLICY_RULES}

Rules you must always follow:
- Only state facts a tool call actually returned. If you need data, call a tool.
- If asked about another employee's salary or any personal data you have no tool
  access to, politely decline — explain you can only see data you're authorized for.
- If a policy question isn't covered by the rules above, say you don't know.
- Keep answers short: the number or fact first, a one-line explanation if useful.
`.trim();
}

async function logAi(req, { endpoint, request, response, toolCalls, durationMs, error }) {
  try {
    await AiLog.create({
      user: req.user._id,
      role: req.user.role,
      endpoint,
      request,
      response,
      toolCalls,
      durationMs,
      error,
    });
  } catch (err) {
    console.error("AI log failed:", err.message);
  }
}

/* ---------------------------------- Chat ---------------------------------- */

// POST /api/ai/chat — All roles. Body: { message, history? }
// The model picks a tool, we run it scoped to req.user, the model writes the
// final answer. Matches brief Section 4's "Ask the assistant" flow.
export async function chat(req, res) {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ message: "message is required" });

  const started = Date.now();
  const messages = [{ role: "system", content: buildSystemPrompt(req.user) }, ...history, { role: "user", content: message }];

  try {
    const { reply, toolCalls } = await runToolChat(messages, { tools: TOOL_SCHEMAS, executors: TOOL_EXECUTORS, user: req.user });

    await logAi(req, { endpoint: "chat", request: message, response: reply, toolCalls, durationMs: Date.now() - started });
    res.json({ reply, aiGenerated: true, toolsUsed: toolCalls.map((t) => t.name) });
  } catch (err) {
    await logAi(req, { endpoint: "chat", request: message, durationMs: Date.now() - started, error: err.message });
    // Friendly fallback per the brief's AI guardrails — never a raw stack trace.
    res.status(503).json({ message: "The AI assistant is unavailable right now — please try again in a moment.", aiGenerated: true });
  }
}

/* ------------------------------- Dashboard summary ------------------------------- */

// POST /api/ai/summarize — Admin, HR only. Body: { kpis: <dashboard JSON the
// frontend already fetched for the current filters> }. Returns 3-5 insight
// bullets grounded ONLY in those numbers.
export async function summarize(req, res) {
  const { kpis } = req.body;
  if (!kpis) return res.status(400).json({ message: "kpis is required" });

  const started = Date.now();
  const messages = [
    {
      role: "system",
      content:
        "You summarize HR/company dashboard numbers into 3-5 short insight bullets. " +
        "Use ONLY the JSON numbers given to you — never invent, estimate, or assume " +
        "anything not present in the JSON. One short sentence per bullet, each starting with '-'.",
    },
    { role: "user", content: `Dashboard KPIs:\n${JSON.stringify(kpis)}` },
  ];

  try {
    const reply = await callPlain(messages);
    await logAi(req, { endpoint: "summarize", request: JSON.stringify(kpis), response: reply, durationMs: Date.now() - started });
    res.json({ summary: reply, aiGenerated: true });
  } catch (err) {
    await logAi(req, { endpoint: "summarize", request: JSON.stringify(kpis), durationMs: Date.now() - started, error: err.message });
    res.status(503).json({ message: "Couldn't generate a summary right now — please try again.", aiGenerated: true });
  }
}

/* --------------------------------- Smart leave --------------------------------- */

// POST /api/ai/smart-leave — Employee only. Body: { text }
// Parses free text into { type, startDate, endDate, reason } for the frontend
// to pre-fill the leave form. This NEVER creates the leave itself — the
// employee still reviews and submits via the normal POST /api/leave.
export async function smartLeave(req, res) {
  const { text } = req.body;
  if (!text) return res.status(400).json({ message: "text is required" });

  const employee = await Employee.findOne({ user: req.user._id });
  if (!employee) return res.status(404).json({ message: "Employee record not found" });

  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = `
Today's date is ${today}. Extract a leave request from the employee's message and
respond with ONLY a JSON object — no markdown fences, no other text:
{"type": "annual"|"sick"|"casual"|"unpaid", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "reason": "short reason"}
Pick the closest matching leave type (default to "casual" if unclear). Resolve relative
dates like "next Monday" against today's date. If you cannot confidently extract a leave
request, respond with {"error": "could not understand the request"} instead.
`.trim();

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: text },
  ];

  async function attemptParse() {
    const raw = await callPlain(messages);
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  }

  const started = Date.now();
  try {
    let parsed;
    try {
      parsed = await attemptParse();
    } catch {
      parsed = await attemptParse(); // one retry on malformed JSON, per the brief's AI guardrails
    }

    if (parsed.error || !parsed.type || !parsed.startDate || !parsed.endDate) {
      await logAi(req, { endpoint: "smart-leave", request: text, response: JSON.stringify(parsed), durationMs: Date.now() - started });
      return res.status(422).json({
        message: "Couldn't confidently parse that into a leave request — please use the regular form.",
        aiGenerated: true,
      });
    }

    await logAi(req, { endpoint: "smart-leave", request: text, response: JSON.stringify(parsed), durationMs: Date.now() - started });
    res.json({ leave: parsed, aiGenerated: true });
  } catch (err) {
    await logAi(req, { endpoint: "smart-leave", request: text, durationMs: Date.now() - started, error: err.message });
    res.status(503).json({ message: "The AI assistant is unavailable right now — please use the regular leave form.", aiGenerated: true });
  }
}