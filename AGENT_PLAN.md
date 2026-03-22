# Bidwright Agentic AI System — Implementation Plan

## Status: IN PROGRESS

## Context

Building the agentic AI foundation for Bidwright. The quoting UI is at feature parity with the Laravel admin app. Now building: autonomous AI agent with hundreds of tools, multi-provider LLM support, pgvector RAG, document vision, and dynamic tool creation.

---

## Package Structure

```
packages/
  agent/src/                    # Core agent runtime
    types.ts                    # ToolDefinition, ToolResult, ToolExecutionContext
    registry.ts                 # ToolRegistry
    executor.ts                 # Tool execution with validation, logging, retries
    loop.ts                     # Provider-agnostic agent loop
    context.ts                  # Context manager (system prompt, RAG, history)
    planner.ts                  # Multi-step plan decomposition
    streaming.ts                # SSE streaming adapter
    dynamic-loader.ts           # Dynamic tool configs
    llm/
      types.ts                  # LLMAdapter interface, ChatRequest/Response
      config.ts                 # ProviderConfig
      adapters/
        anthropic.ts            # Claude adapter
        openai.ts               # OpenAI + Codex adapter
        openrouter.ts           # OpenRouter adapter
        gemini.ts               # Google Gemini adapter
        lmstudio.ts             # Local LMStudio adapter
    tools/
      quote.ts                  # ~30 quote tools
      knowledge.ts              # ~15 RAG tools
      vision.ts                 # ~10 vision tools
      analysis.ts               # ~10 analysis tools
      dynamic.ts                # ~5 dynamic tool management
      system.ts                 # Meta-tools

  vector/src/                   # Vector storage + embedding
    types.ts                    # VectorRecord, VectorHit, SearchOptions
    embedder.ts                 # OpenAI embeddings with batching
    store.ts                    # VectorStore interface
    pg-vector-store.ts          # pgvector implementation
    hybrid-search.ts            # Vector + keyword fusion

  vision/src/                   # Document vision pipeline
    types.ts                    # DrawingAnalysis, TableData
    renderer.ts                 # PDF → PNG
    analyzer.ts                 # LLM Vision for drawings
    table-extractor.ts          # Table detection
    ocr.ts                      # OCR adapter

apps/api/src/routes/
  agent-routes.ts               # Agent chat/session endpoints
  knowledge-routes.ts           # Knowledge management
  tool-routes.ts                # Dynamic tool CRUD

apps/web/components/workspace/
  agent-chat.tsx                # Chat panel
  knowledge-browser.tsx         # Document/chunk viewer
  tool-browser.tsx              # Tool management UI
```

---

## Implementation Phases

### Phase 1: Foundation ✅ IN PROGRESS
- [x] packages/agent types + registry + executor
- [ ] packages/vector types + embedder + store
- [ ] packages/vision types + renderer + analyzer

### Phase 2: LLM Adapters
- [ ] LLMAdapter interface
- [ ] Anthropic adapter
- [ ] OpenAI adapter
- [ ] OpenRouter adapter (OpenAI-compatible)
- [ ] Gemini adapter
- [ ] LMStudio adapter (OpenAI-compatible, localhost)

### Phase 3: Tools
- [ ] 30 quote tools (wrapping persistent-store)
- [ ] 6 system tools
- [ ] 15 knowledge tools
- [ ] 10 vision tools
- [ ] 10 analysis tools
- [ ] 5 dynamic tool management tools

### Phase 4: Agent Runtime
- [ ] Agent loop (provider-agnostic ReAct)
- [ ] Context manager
- [ ] Planner
- [ ] SSE streaming
- [ ] Human-in-the-loop confirmation

### Phase 5: API Routes
- [ ] Agent session endpoints
- [ ] Knowledge endpoints
- [ ] Dynamic tool endpoints

### Phase 6: Frontend
- [ ] Chat panel
- [ ] Knowledge browser
- [ ] Tool browser

---

## Key Design Decisions

1. **Multi-provider LLM**: Anthropic, OpenAI, OpenRouter, Gemini, LMStudio via adapter pattern
2. **pgvector** for vector storage (Postgres)
3. **OpenAI text-embedding-3-large** for embeddings
4. **Hybrid search**: vector similarity + keyword scoring
5. **Tool-per-operation** (not generic CRUD) for better LLM descriptions
6. **Category-based tool injection** to manage token budget with 70+ tools
7. **Human-in-the-loop** for destructive operations via requiresConfirmation flag
