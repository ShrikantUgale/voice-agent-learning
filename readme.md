# Voice Agent (learning project)

A voice agent for a fictional store, **ShopEasy**. You talk to it in the browser, and it answers help-centre questions from a PDF, looks up orders, and creates support tickets after a human approves.

Built to learn how agentic backends work: tools, RAG, handoffs, human-in-the-loop, and server-side control of a realtime session.

## Architecture

```
Browser ──── WebRTC audio ────────────────────────► OpenAI Realtime
   │                                                    ▲
   │ POST /session (SDP offer + x-user-id)              │ WebSocket "sideband"
   ▼                                                    │ (events + tool calls)
Express server ─────────────────────────────────────────┘
   │  creates the call with the real API key
   │  runs tools, handoffs, approvals
   └─► Qdrant (vector search over the help-centre PDF)
```

- **Audio** goes browser ⇄ OpenAI directly. It never passes through our server.
- **Control** goes server ⇄ OpenAI over the sideband WebSocket. The server sees every event, runs the tools, and swaps agents.
- The **real API key** and all tool code stay on the server. The browser holds no key.

## How a call works

1. Browser creates a WebRTC offer and POSTs it to `/session`.
2. Server forwards it to OpenAI (with the real key and the starting agent's config), gets back the SDP answer and the `call_id`, and returns the answer to the browser.
3. Server opens the sideband WebSocket using the `call_id`.
4. When the browser reports it is connected (`/session/:callId/ready`) and the sideband is open, the server sends `response.create` so the agent greets first.
5. When the model wants a tool, the `response.done` event contains a `function_call`. The server runs it and sends back `function_call_output`, then `response.create` to continue.

## Project structure

```
server.js            Express routes: /session, /session/:callId/ready, /approvals
sideband.js          WebSocket event loop: greeting, tool execution, handoffs, approvals
tool.js              Tool registry: definition (what the AI sees) + run (what executes)
agents/agents.js     Agents = instructions + allowed tool names. Builds session config
approvals.js         Human-in-the-loop: pending approvals as Promises with a timeout
rag.js               OpenAI embeddings + Qdrant client helpers
ingest.js            One-off script: PDF -> chunks -> embeddings -> Qdrant
docs/help-centre.pdf The knowledge base
public/sideband.html The voice client (plain WebRTC, hardcoded user id "u1")
public/admin.html    Approval page for support staff
```

## Features

- **RAG:** `search_docs` finds relevant chunks by meaning (embeddings + Qdrant).
- **Tool registry:** one entry per tool, with its schema and code together.
- **Two agents with handoff:** `faq` (search_docs) and `orders` (lookup_order, create_support_ticket). Handoff is a tool that triggers `session.update` with the other agent's instructions and tools.
- **Permission check:** the server rejects any tool call not in the current agent's list.
- **Order ownership:** `lookup_order` only returns orders belonging to the caller. The user id comes from server-side `ctx`, never from the model's arguments.
- **Human in the loop:** `create_support_ticket` has `needsApproval: true`. It waits for approve/reject on `/admin.html` (60 s timeout).
- **Agent speaks first:** greeting is triggered by the server once both sides are ready.

## Setup and run

Requirements: Node 20+, Docker, an OpenAI API key.

```bash
npm install

# Qdrant (keep the image version close to the npm client version)
docker run -p 6333:6333 -v $(pwd)/qdrant_storage:/qdrant/storage qdrant/qdrant

# .env
OPENAI_API_KEY=sk-...

# Load the PDF into Qdrant (re-run after changing the PDF; it recreates the collection)
node ingest.js

# Start the server
node server.js
```

- Voice client: http://localhost:3000/sideband.html
- Approvals: http://localhost:3000/admin.html (keep it open in a second tab)

Use headphones, or the agent hears itself. Always click **Stop**: an open session keeps costing credits.

## Things to try

- "How long does delivery take?" (RAG)
- "Where is order 1001?" (handoff to orders, ownership check passes)
- "Where is order 1003?" (belongs to u2, so not found)
- "My item is damaged, please raise a ticket." (approval flow)
- "Do you ship to the US?" and "Who is your CEO?" (should say it doesn't know)

## Lessons learned

- The browser WebRTC offer goes through our server so we get the `call_id` needed for the sideband.
- Qdrant client and server versions must be close (minor version difference of at most 1).
- Registry entries look like `{ definition, run }`. A tool's name is at `tools.x.definition.name`, not `tools.x.name`.
- Realtime models don't speak until asked. Greeting and continuing after a tool result both need `response.create`.
- Prompts are requests, code is enforcement. Permissions and approvals live in code.

## Known limitations

- User id is a hardcoded header with no real authentication.
- Orders, tickets, and pending approvals are in memory, so a restart loses them.
- `admin.html` has no login.
- If the caller hangs up during an approval, it stays pending until the timeout.
- No retry or reconnect if the sideband WebSocket drops.
- Tool arguments are not validated beyond `JSON.parse`.
- No call time limit, so calls can run (and cost) indefinitely.
- Single server instance only. See "Scaling notes".

## Improvement ideas (suggested order)

1. **Memory:** save a short summary per user at call end, load it into the next call's greeting and instructions.
2. **Guardrails:** check transcripts and tool results; consider prompt injection through document content.
3. **Retrieval quality:** similarity score threshold, citing the source section, better chunking.
4. **Validate tool arguments** (for example with zod) before running a tool.
5. **Logging and evals:** save transcripts and tool calls, replay test questions to measure behavior.
6. **Tests** for the deterministic parts (registry, agent config, `runTool`, event handling) with Vitest. Extract the event logic from `openSideband` into a `handleEvent` function first.
7. **Cancel pending approvals** when the sideband closes; persist approvals.
8. **Auto-hangup and cost controls:** max call duration, idle timeout.
9. **Live transcript** in the page (via the data channel or a server stream).
10. **Text agents with the Agents SDK** to learn the same concepts without voice cost.

## Scaling notes

- Audio is not our problem: it never touches our server. We hold one small outbound WebSocket per active call.
- With multiple instances, move per-call state to Redis: the `sessions` map, pending approvals, `currentAgent`, and user context. Give each call one owner worker (a lease with a TTL).
- Autoscale on active call count, drain gracefully on deploys, and watch outbound port limits behind a NAT.
- At very large scale, OpenAI rate limits and the voice model bill become constraints before the server does.
