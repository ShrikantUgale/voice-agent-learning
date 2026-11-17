import WebSocket from "ws";
import { agents, START_AGENT, sessionConfigFor } from "./agents.js";
import { tools, runTool } from "./tool.js";
import { requestApproval } from "./approvals.js";

export function openSideband(callId, userId) {
  let currentAgent = START_AGENT;

  const ws = new WebSocket(
    `wss://api.openai.com/v1/realtime?call_id=${callId}`,
    {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    },
  );
  const send = (obj) => ws.send(JSON.stringify(obj));

  const ctx = {
    userId, // tools read the user from here, never from the model's arguments
    switchAgent(name) {
      console.log(`🔀 handoff: ${currentAgent} -> ${name}`);
      currentAgent = name;
      send({ type: "session.update", session: sessionConfigFor(name) });
    },
  };

  // Decides how one tool call is executed
  async function execute(call, args) {
    if (!agents[currentAgent].tools.includes(call.name)) {
      return { error: `Tool not available: ${call.name}` };
    }

    if (tools[call.name]?.needsApproval) {
      const decision = await requestApproval({ userId, tool: call.name, args });
      if (decision === "rejected") {
        return {
          error:
            "A human reviewer rejected this request. Tell the user politely.",
        };
      }
      if (decision === "timed_out") {
        return {
          error:
            "No reviewer responded in time. Tell the user to try again later.",
        };
      }
    }

    return runTool(call.name, args, ctx);
  }

  ws.on("open", () =>
    console.log(`[sideband] connected to ${callId} (user ${userId})`),
  );

  ws.on("message", async (raw) => {
    const event = JSON.parse(raw.toString());

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        console.log("🎤 user speaking...");
        break;

      case "response.output_audio_transcript.done":
        console.log(`🤖 [${currentAgent}] said:`, event.transcript);
        break;

      case "response.done": {
        const calls = event.response.output.filter(
          (i) => i.type === "function_call",
        );

        for (const call of calls) {
          const args = JSON.parse(call.arguments || "{}");
          console.log(`🔧 [${currentAgent}] tool call:`, call.name, args);

          const output = await execute(call, args);

          send({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: call.call_id,
              output: JSON.stringify(output),
            },
          });
        }

        if (calls.length > 0) send({ type: "response.create" });
        break;
      }

      case "error":
        console.log("❌ error:", event.error?.message);
        break;
    }
  });

  ws.on("error", (err) => console.log("[sideband] error:", err.message));
  ws.on("close", () => console.log("[sideband] closed"));
}
