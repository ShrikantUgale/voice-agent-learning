import { randomUUID } from "crypto";

const pending = new Map();

// Returns a Promise that resolves to "approved" | "rejected" | "timed_out"
export function requestApproval({ userId, tool, args }, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const id = randomUUID();

    const finish = (decision) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(decision);
    };
    const timer = setTimeout(() => finish("timed_out"), timeoutMs);

    pending.set(id, { id, userId, tool, args, createdAt: Date.now(), finish });
    console.log(`⏳ approval requested: ${tool} for ${userId}`, args);
  });
}

export function listPending() {
  return [...pending.values()].map(({ finish, ...info }) => info);
}

export function decide(id, decision) {
  const item = pending.get(id);
  if (!item) return false;
  item.finish(decision);
  return true;
}
