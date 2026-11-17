import express from "express";
import { START_AGENT, sessionConfigFor } from "./agents.js";
import { listPending, decide } from "./approvals.js";
import { openSideband, markReady } from "./sideband.js";

const MODEL = "gpt-realtime-2.1-mini";

const app = express();
app.use(express.static("public"));

app.get("/approvals", (req, res) => res.json(listPending()));

app.post("/session/:callId/ready", (req, res) => {
  res.json({ ok: markReady(req.params.callId) });
});

app.post("/approvals/:id", express.json(), (req, res) => {
  const { decision } = req.body;
  if (!["approved", "rejected"].includes(decision)) {
    return res
      .status(400)
      .json({ error: "decision must be approved or rejected" });
  }
  res.json({ ok: decide(req.params.id, decision) });
});

app.post(
  "/session",
  express.text({ type: "application/sdp" }),
  async (req, res) => {
    const userId = req.get("x-user-id");
    if (!userId) return res.status(400).send("Missing x-user-id");

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

    res.set("x-call-id", callId);
    res.type("application/sdp").send(answer);
    openSideband(callId, userId);
  },
);

app.listen(3000, () => console.log("http://localhost:3000"));
