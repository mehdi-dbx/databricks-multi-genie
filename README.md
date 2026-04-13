# Teva Genie Supervisor

A single-entry-point AI agent that discovers every Genie Space across all Teva Databricks workspaces and routes user questions to the right one — transparently, without the user needing to know which workspace or dataset to query.

---

## The Core Idea

Teva's data lives across multiple Databricks workspaces, each containing multiple Genie Spaces tied to specific datasets. Instead of asking users to navigate those spaces manually, this project exposes **one endpoint** that acts as a supervisor agent:

```
User question
      │
      ▼
┌─────────────────────────────────┐
│     Teva Genie Supervisor       │  ← single entry point
│  (LangGraph tool-calling agent) │
└────────────┬────────────────────┘
             │  discovers & routes to
    ┌────────┴────────┐
    ▼                 ▼
Workspace A       Workspace B       ...
  Genie Space 1   Genie Space 3
  Genie Space 2   Genie Space 4
```

The agent auto-discovers all Genie Spaces at startup via the Databricks REST API, wraps each one as an MCP tool, and lets the LLM decide which space (or combination of spaces) to query for any given question.

---

## How It Works

### 1. Discovery

On startup, `agent/agent.py` iterates over all configured workspaces (`DATABRICKS_WORKSPACE_URLS`) and calls `/api/2.0/genie/spaces` on each to enumerate available Genie Spaces.

### 2. Tool wrapping

Each Genie Space exposes a Managed MCP server at `/api/2.0/mcp/genie/<space_id>`. The agent wraps every tool from every MCP server into a `MCPTool` (a LangChain `BaseTool` backed by `DatabricksMCPClient`).

### 3. Routing

A LangGraph tool-calling graph connects the LLM to all discovered tools. The LLM (configurable via `AGENT_MODEL_ENDPOINT`) reads the tool names and descriptions to decide which Genie Space(s) to invoke for the user's question. Multi-space queries are composed automatically.

### 4. Serving

The agent is deployed as a **Databricks App** (`app.yaml` / `databricks.yml`). It exposes:
- `/invocations` — batch inference (MLflow `ResponsesAgent`)
- `/invocations/stream` — streaming responses

A Next.js chat frontend (`e2e-chatbot-app-next/`) connects to this endpoint and provides the end-user interface.

---

## Project Structure

```
agent/
  agent.py          # supervisor agent — discovery, MCP tool wrapping, LangGraph
  genie_capture.py  # utilities for Genie Space interaction
  start_server.py   # MLflow AgentServer startup
  utils.py

prompt/
  main.prompt       # system prompt — routing instructions and response style

e2e-chatbot-app-next/
  client/           # React + Vercel AI SDK chat UI
  server/           # Express proxy to agent serving endpoint

scripts/
  start_local.sh    # start agent + frontend locally
  quickstart.py     # guided setup

deploy/
  deploy.sh         # Databricks bundle deploy helper

databricks.yml      # Databricks Asset Bundle definition
app.yaml            # Databricks App runtime config
.env.example        # all required environment variables
```

---

## Configuration

Copy `.env.example` to `.env.local` and fill in:

| Variable | Description |
|---|---|
| `DATABRICKS_WORKSPACE_URLS` | Comma-separated list of workspace base URLs to scan for Genie Spaces |
| `DATABRICKS_WORKSPACE_TOKENS` | Matching PAT tokens (one per workspace; last token is reused if fewer than URLs) |
| `AGENT_MODEL_ENDPOINT` | LLM serving endpoint name or full invocations URL |
| `AGENT_MODEL_TOKEN` | Token for cross-workspace LLM endpoint (if different workspace) |
| `MLFLOW_EXPERIMENT_ID` | MLflow experiment for logging |

---

## Running Locally

```bash
cp .env.example .env.local
# fill in .env.local

bash scripts/start_local.sh
```

This starts the Python agent server on port 8000 and the chat frontend on port 3000.

---

## Deployment

Deploy to Databricks Apps via the Asset Bundle:

```bash
# sync workspace credentials from .env.local into databricks.yml
python deploy/sync_databricks_yml_from_env.py

# deploy
databricks bundle deploy
databricks bundle run agent_app
```

The deployed app name is `teva-genie-supervisor` (production) or `dev-teva-genie-supervisor` (development).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Agent framework | LangGraph (tool-calling graph) |
| LLM | Databricks Model Serving (Claude Sonnet via `ChatDatabricks`) |
| Genie integration | Databricks MCP (`DatabricksMCPClient`) |
| Serving | MLflow `ResponsesAgent` + Databricks Apps |
| Frontend | Next.js, React, Vercel AI SDK |
| Deployment | Databricks Asset Bundle |
