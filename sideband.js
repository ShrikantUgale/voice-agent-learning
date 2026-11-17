import WebSocket from "ws";
import { agents, START_AGENT, sessionConfigFor } from "./agents.js";
import { runTool } from "./tool.js";

export function openSideband(callId, userId) {
  let currentAgent = START_AGENT;

  const ws = new WebSocket(
    `wss://api.openai.com/v1/realtime?call_id=${callId}`,
    {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    },
  );
  const send = (obj) => ws.send(JSON.stringify(obj));

  // Handed to tools so a handoff tool can switch the agent
  const ctx = {
    userId,
    switchAgent(name) {
      console.log(`🔀 handoff: ${currentAgent} -> ${name}`);
      currentAgent = name;
      send({ type: "session.update", session: sessionConfigFor(name) });
    },
  };

  ws.on("open", () => console.log("[sideband] connected to", callId));

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

          // Only allow tools that belong to the current agent
          const allowed = agents[currentAgent].tools.includes(call.name);
          const output = allowed
            ? await runTool(call.name, args, ctx)
            : { error: `Tool not available: ${call.name}` };

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
