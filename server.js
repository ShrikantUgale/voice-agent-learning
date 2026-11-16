import express from "express";
import { START_AGENT, sessionConfigFor } from "./agents.js";
import { openSideband } from "./sideband.js";

const MODEL = "gpt-realtime-2.1-mini";

const app = express();
app.use(express.static("public"));

app.post(
  "/session",
  express.text({ type: "application/sdp" }),
  async (req, res) => {
    const form = new FormData();
    form.append("sdp", req.body);
    form.append(
      "session",
      JSON.stringify({ ...sessionConfigFor(START_AGENT), model: MODEL }),
    );

    const r = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    const answer = await r.text();
    if (!r.ok) return res.status(r.status).send(answer);

    const callId = r.headers.get("location")?.split("/").pop();
    console.log("call_id:", callId);

    res.type("application/sdp").send(answer);
    openSideband(callId);
  },
);

app.listen(3000, () => console.log("http://localhost:3000"));
