import "dotenv/config";
import express from "express";
import WebSocket from "ws";
import { qdrant, embed, COLLECTION } from "./rag/rag.js";

const app = express();

// Serves everything in /public (our index.html)
app.use(express.static("public"));

const orders = {
  1001: { status: "Shipped", eta: "2 days", item: "Running shoes" },
  1002: { status: "Processing", eta: "5 days", item: "Backpack" },
  1003: { status: "Delivered", eta: "-", item: "Water bottle" },
};
const tickets = [];

app.get("/search", async (req, res) => {
  res.json({ results: await searchDocs(String(req.query.q || "")) });
});

async function searchDocs(query) {
  const [vector] = await embed(query);
  const result = await qdrant.query(COLLECTION, {
    query: vector,
    limit: 3,
    with_payload: true,
  });
  return result.points.map((p) => p.payload.text);
}

const tools = {
  search_docs: {
    // What the AI sees
    definition: {
      type: "function",
      name: "search_docs",
      description:
        "Search the document for information to answer the user's question.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
    // What actually runs on your server
    run: async (args) => ({ results: await searchDocs(args.query) }),
  },

  lookup_order: {
    definition: {
      type: "function",
      name: "lookup_order",
      description: "Look up the status of an order by its order number.",
      parameters: {
        type: "object",
        properties: {
          order_id: {
            type: "string",
            description: "The order number, digits only",
          },
        },
        required: ["order_id"],
      },
    },
    run: async ({ order_id }) =>
      orders[order_id] ?? { error: "No order found with that number" },
  },

  create_support_ticket: {
    definition: {
      type: "function",
      name: "create_support_ticket",
      description:
        "Create a support ticket for a problem the help centre cannot solve. Only call after the user confirms.",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "One sentence describing the problem",
          },
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
};

async function runTool(name, args) {
  const tool = tools[name];
  if (!tool) return { error: `Unknown tool: ${name}` };

  try {
    return await tool.run(args);
  } catch (err) {
    return { error: err.message };
  }
}

app.post(
  "/session",
  express.text({ type: "application/sdp" }),
  async (req, res) => {
    const form = new FormData();
    form.append("sdp", req.body); // the browser's offer
    form.append(
      "session",
      JSON.stringify({
        type: "realtime",
        model: "gpt-realtime-2.1-mini",
        instructions: `You are a voice assistant for ShopEasy. Keep replies very short.
- For questions about policies (shipping, refunds, payments, account, support hours), call search_docs and answer ONLY from the results.
- If the user gives an order number, call lookup_order.
- If you cannot solve the problem, offer to create a support ticket, and call create_support_ticket only after the user says yes.
- If you don't know, say so.`,
        tools: Object.values(tools).map((t) => t.definition),
        tool_choice: "auto",
      }),
    );

    const r = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    const answer = await r.text();
    if (!r.ok) return res.status(r.status).send(answer);

    // The Location header looks like /v1/realtime/calls/rtc_abc123
    const callId = r.headers.get("location")?.split("/").pop();
    console.log("call_id:", callId);

    res.type("application/sdp").send(answer); // hand OpenAI's answer back to the browser
    openSideband(callId); // then join the call
  },
);

function openSideband(callId) {
  const ws = new WebSocket(
    `wss://api.openai.com/v1/realtime?call_id=${callId}`,
    {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    },
  );

  ws.on("open", () => console.log("[sideband] connected to", callId));

  ws.on("message", async (raw) => {
    const event = JSON.parse(raw.toString());

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        console.log("🎤 user speaking...");
        break;
      case "response.output_audio_transcript.done":
        console.log("🤖 AI said:", event.transcript);
        break;
      case "response.done": {
        // A finished response may contain tool calls
        const calls = event.response.output.filter(
          (item) => item.type === "function_call",
        );

        for (const call of calls) {
          const args = JSON.parse(call.arguments);
          console.log("🔧 tool call:", call.name, args);

          let output;
          try {
            if (call.name === "search_docs") {
              output = await runTool(call.name, args);
            } else if (call.name === "lookup_order") {
              output = await runTool(call.name, args);
            } else if (call.name === "create_support_ticket") {
              output = await runTool(call.name, args);
            } else {
              output = { error: "Unknown tool" };
            }
          } catch (err) {
            output = { error: err.message };
          }

          // Give the result back to the AI
          ws.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: call.call_id,
                output: JSON.stringify(output),
              },
            }),
          );
        }

        // If we answered any tool calls, tell the AI to continue speaking
        if (calls.length > 0) {
          ws.send(JSON.stringify({ type: "response.create" }));
        }
        break;
      }
      case "error":
        console.log("❌ error:", event.error?.message);
        break;
      // everything else is ignored for now
    }
  });

  ws.on("error", (err) => console.log("[sideband] error:", err.message));
  ws.on("close", () => console.log("[sideband] closed"));
}

// Browser calls this to get a short-lived key
app.get("/token", async (req, res) => {
  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-realtime-2.1-mini",
        },
      }),
    },
  );
  const body = await response.json();

  if (!response.ok) {
    return res.status(response.status).json(body);
  }

  res.set("Cache-Control", "no-store").json({ key: body.value });
});

app.listen(3000, () => console.log("http://localhost:3000"));
