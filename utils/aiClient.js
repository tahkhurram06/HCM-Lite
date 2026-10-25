// Thin client for any OpenAI-compatible chat-completions API with tool
// calling (OpenAI, Groq, OpenRouter, etc. all speak this format — "any
// hosted LLM API with tool calling", per the brief). The key lives only in
// this backend env var; the browser never talks to the AI provider directly.
const AI_API_BASE = process.env.AI_API_BASE || "https://api.openai.com/v1";
const AI_API_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";
const TIMEOUT_MS = 15000; // brief: "15s timeout and a friendly fallback"

async function callChatAPI(messages, tools) {
  if (!AI_API_KEY) throw new Error("AI_API_KEY is not configured on the server");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${AI_API_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        ...(tools ? { tools, tool_choice: "auto" } : {}),
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AI API error ${res.status}: ${text.slice(0, 300)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Runs the tool-calling loop: ask the model, execute whichever tools it
// picks (scoped to `user`), feed results back, repeat until it answers in
// plain text or maxRounds is hit. This is the core of M8's "model picks a
// tool, the backend runs it with the user's scope, the model writes the
// answer" flow.
export async function runToolChat(messages, { tools, executors, user, maxRounds = 3 } = {}) {
  const conversation = [...messages];
  const toolCallLog = [];

  for (let round = 0; round < maxRounds; round++) {
    const data = await callChatAPI(conversation, tools);
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("AI API returned no message");

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { reply: message.content || "", toolCalls: toolCallLog };
    }

    conversation.push(message);

    for (const call of message.tool_calls) {
      const name = call.function?.name;
      const executor = executors?.[name];

      let args = {};
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        args = {};
      }

      // The model never queries the database directly — every tool call
      // routes through our own service functions with the caller's role.
      let resultPayload;
      if (!executor) {
        resultPayload = { error: `Unknown tool: ${name}` };
      } else {
        try {
          resultPayload = await executor(args, user);
        } catch (err) {
          resultPayload = { error: err.message || "Tool execution failed" };
        }
      }

      toolCallLog.push({ name, args, result: resultPayload });
      conversation.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(resultPayload) });
    }
  }

  return { reply: "I wasn't able to finish that — could you rephrase it?", toolCalls: toolCallLog };
}

// One-shot call with no tools — used for the dashboard summary and smart-leave
// JSON extraction, which don't need the tool loop.
export async function callPlain(messages) {
  const data = await callChatAPI(messages, undefined);
  return data.choices?.[0]?.message?.content || "";
}