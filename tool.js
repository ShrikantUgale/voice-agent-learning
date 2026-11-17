import "dotenv/config";
import { qdrant, embed, COLLECTION } from "./rag/rag.js";

// ---- Helpers and fake data ----
async function searchDocs(query) {
  const [vector] = await embed(query);
  const result = await qdrant.query(COLLECTION, {
    query: vector,
    limit: 3,
    with_payload: true,
  });
  return result.points.map((p) => p.payload.text);
}

const orders = {
  1001: {
    userId: "u1",
    status: "Shipped",
    eta: "2 days",
    item: "Running shoes",
  },
  1002: { userId: "u1", status: "Processing", eta: "5 days", item: "Backpack" },
  1003: { userId: "u2", status: "Delivered", eta: "-", item: "Water bottle" },
};
const tickets = [];

// ---- The registry ----
// run(args, ctx): ctx gives a tool access to the session (used by handoffs)
export const tools = {
  search_docs: {
    definition: {
      type: "function",
      name: "search_docs",
      description:
        "Search the help centre document to answer policy questions.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    run: async ({ query }) => ({ results: await searchDocs(query) }),
  },

  lookup_order: {
    definition: {
      type: "function",
      name: "lookup_order",
      description: "Look up the status of an order by its order number.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string", description: "Digits only" },
        },
        required: ["order_id"],
      },
    },
    run: async ({ order_id }, ctx) => {
      const order = orders[order_id];
      // Same message whether the order doesn't exist or belongs to someone else,
      // so the answer doesn't reveal which order numbers exist
      if (!order || order.userId !== ctx.userId) {
        return { error: "No order found with that number" };
      }
      const { userId, ...safe } = order; // don't send internal fields to the model
      return safe;
    },
  },

  create_support_ticket: {
    definition: {
      type: "function",
      name: "create_support_ticket",
      description:
        "Create a support ticket for a problem that can't be solved here. Only call after the user confirms.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "One sentence" },
        },
        required: ["summary"],
      },
    },
    run: async ({ summary }) => {
      const ticket = { id: "T" + (tickets.length + 1), summary };
      tickets.push(ticket);
      console.log("🎫 ticket created:", ticket);
      return { ticket_id: ticket.id };
    },
  },

  // ---- Handoff tools: their job is to switch the agent ----
  transfer_to_orders: {
    definition: {
      type: "function",
      name: "transfer_to_orders",
      description:
        "Transfer to the Orders specialist when the user asks about a specific order or wants a support ticket.",
      parameters: { type: "object", properties: {} },
    },
    run: async (_args, ctx) => {
      ctx.switchAgent("orders");
      return { ok: true, note: "Transferred. Continue helping the user." };
    },
  },

  transfer_to_faq: {
    definition: {
      type: "function",
      name: "transfer_to_faq",
      description:
        "Transfer to the FAQ assistant when the user asks a general policy question (shipping, refunds, payments, account, coupons, support hours).",
      parameters: { type: "object", properties: {} },
    },
    run: async (_args, ctx) => {
      ctx.switchAgent("faq");
      return { ok: true, note: "Transferred. Continue helping the user." };
    },
  },
};

export async function runTool(name, args, ctx) {
  const tool = tools[name];
  if (!tool) return { error: `Unknown tool: ${name}` };
  try {
    return await tool.run(args, ctx);
  } catch (err) {
    return { error: err.message };
  }
}
