import { tools } from "./tool.js";

// An agent = instructions + the names of the tools it is allowed to use
export const agents = {
  faq: {
    instructions: `You are the ShopEasy FAQ assistant. Keep replies very short and concise.
- For policy questions (shipping, refunds, payments, account, coupons, support hours), call search_docs and answer ONLY from the results.
- If the user asks about a specific order or wants a support ticket, call transfer_to_orders right away. Do not answer those yourself.
- If you don't know, say so.`,
    tools: [
      tools.search_docs.definition.name,
      tools.transfer_to_orders.definition.name,
    ],
  },

  orders: {
    instructions: `You are the ShopEasy Orders specialist. Keep replies very short.
- After a transfer, briefly say you're the orders specialist and can help.
- If the user gives an order number, call lookup_order.
- If you can't solve the problem, offer a support ticket, and call create_support_ticket only after the user says yes.
- For general policy questions, call transfer_to_faq.`,
    tools: [
      tools.lookup_order.definition.name,
      tools.create_support_ticket.definition.name,
      tools.transfer_to_faq.definition.name,
    ],
  },
};

export const START_AGENT = "faq";

// Builds the session settings for one agent
export function sessionConfigFor(agentName) {
  const agent = agents[agentName];
  return {
    type: "realtime",
    instructions: agent.instructions,
    tools: agent.tools.map((name) => {
      if (!tools[name]) {
        throw new Error(
          `Agent "${agentName}" lists tool "${name}", but tools.js only has: ${Object.keys(tools).join(", ")}`,
        );
      }
      return tools[name].definition;
    }),
    tool_choice: "auto",
  };
}
