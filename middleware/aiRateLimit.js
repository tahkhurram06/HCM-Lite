// In-memory per-user hourly limiter — brief: "about 20 requests per user per
// hour". Hackathon-scale only: a single Node process. For a multi-instance
// deployment this would need a shared store (Redis) instead of a local Map.
const WINDOW_MS = 60 * 60 * 1000;
const LIMIT = 20;
const hits = new Map(); // userId -> timestamps[]

export function aiRateLimit(req, res, next) {
  const userId = String(req.user._id);
  const now = Date.now();
  const timestamps = (hits.get(userId) || []).filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= LIMIT) {
    return res.status(429).json({
      message: "AI request limit reached (20/hour) — please try again later.",
      aiGenerated: true,
    });
  }

  timestamps.push(now);
  hits.set(userId, timestamps);
  next();
}