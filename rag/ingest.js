import "dotenv/config";
import fs from "fs";
import pdf from "pdf-parse/lib/pdf-parse.js";
import { qdrant, embed, COLLECTION } from "./rag.js";

// 1. Extract text from the PDF
const { text } = await pdf(fs.readFileSync("rag/my-data.pdf"));

// 2. Chunk: fixed size with overlap so sentences aren't cut off from context
function chunkText(text, size = 800, overlap = 50) {
  const clean = text.replace(/\s+/g, " ").trim();
  const chunks = [];
  for (let i = 0; i < clean.length; i += size - overlap) {
    chunks.push(clean.slice(i, i + size));
  }
  return chunks;
}
const chunks = chunkText(text);
console.log(`Created ${chunks.length} chunks`);

// 3. Embed all chunks (fine for small PDFs; batch it for big ones)
const vectors = await embed(chunks);

// 4. Recreate the collection and store the vectors
const existing = await qdrant.getCollections();
if (existing.collections.some((c) => c.name === COLLECTION)) {
  await qdrant.deleteCollection(COLLECTION);
}
await qdrant.createCollection(COLLECTION, {
  vectors: { size: vectors[0].length, distance: "Cosine" },
});

await qdrant.upsert(COLLECTION, {
  points: chunks.map((text, i) => ({
    id: i,
    vector: vectors[i],
    payload: { text }, // the original text travels with the vector
  })),
});

console.log("Done. Stored in Qdrant.");
