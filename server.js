import "dotenv/config";
import express from "express";
import { qdrant, embed, COLLECTION } from "./rag/rag.js";

const app = express();

// Serves everything in /public (our index.html)
app.use(express.static("public"));

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

  app.get("/search", async (req, res) => {
    const q = String(req.query.q || "");
    const [vector] = await embed(q);

    const result = await qdrant.query(COLLECTION, {
      query: vector,
      limit: 1,
      with_payload: true,
    });

    res.json({ results: result.points.map((p) => p.payload.text) });
  });

  const data = await response.json();
  if (!response.ok) return res.status(response.status).json(data);

  console.log("Token response:", data.value);

  res.json({ key: data.value });
});

app.listen(3000, () => console.log("http://localhost:3000"));
