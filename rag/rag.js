import OpenAI from "openai";
import { QdrantClient } from "@qdrant/js-client-rest";

export const openai = new OpenAI(); // reads OPENAI_API_KEY
export const qdrant = new QdrantClient({ url: "http://localhost:6333" });

export const COLLECTION = "docs";
export const EMBEDDING_MODEL = "text-embedding-3-small"; // 1536 dimensions

// Turn text into vectors (accepts one string or an array)
export async function embed(input) {
  const res = await openai.embeddings.create({ model: EMBEDDING_MODEL, input });
  return res.data.map((d) => d.embedding);
}
