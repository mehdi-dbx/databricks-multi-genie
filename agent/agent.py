"""
Teva Genie Supervisor Agent
---------------------------
Multi-workspace supervisor that discovers all Genie Spaces across configured
Databricks workspaces and routes user questions to the right one.

Implements the pattern from multi-genie-claude-supervisor_teva-Guy-customized.ipynb,
adapted for production deployment (env vars instead of dbutils.secrets, async-safe).
"""

import asyncio
import os
import re
from pathlib import Path
from typing import (
    Annotated,
    Any,
    AsyncGenerator,
    Generator,
    List,
    Optional,
    Sequence,
    TypedDict,
    Union,
)

import mlflow
import nest_asyncio
import requests
from databricks.sdk import WorkspaceClient
from databricks_langchain import ChatDatabricks
from databricks_mcp import DatabricksMCPClient
from langchain_core.language_models import LanguageModelLike
from langchain_core.messages import AIMessage, AIMessageChunk, AnyMessage
from langchain_core.runnables import RunnableConfig, RunnableLambda
from langchain_core.tools import BaseTool
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt.tool_node import ToolNode
from mlflow.genai.agent_server import invoke, stream
from mlflow.pyfunc import ResponsesAgent
from mlflow.types.responses import (
    ResponsesAgentRequest,
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
    create_text_delta,
    output_to_responses_items_stream,
    to_chat_completions_input,
)
from pydantic import create_model

# Allow nested event loops (needed in some deployment environments)
nest_asyncio.apply()
mlflow.langchain.autolog()


# ---------------------------------------------------------------------------
# Configuration — read from environment variables
# ---------------------------------------------------------------------------

def _get_workspaces() -> list[dict]:
    """
    Returns a list of dicts with 'url' and 'token' for each configured workspace.

    Environment variables:
      DATABRICKS_WORKSPACE_URLS   – comma-separated workspace base URLs
      DATABRICKS_WORKSPACE_TOKENS – comma-separated PAT tokens (same order)
                                    If fewer tokens than URLs, the last token is reused.
    """
    urls_str = os.environ.get("DATABRICKS_WORKSPACE_URLS", "").strip()
    tokens_str = os.environ.get("DATABRICKS_WORKSPACE_TOKENS", "").strip()

    if not urls_str:
        # Fallback: use the current workspace from SDK default auth
        try:
            wc = WorkspaceClient()
            host = wc.config.host or ""
            token = wc.config.token or ""
            return [{"url": host.rstrip("/"), "token": token}]
        except Exception:
            return []

    urls = [u.strip() for u in urls_str.split(",") if u.strip()]
    tokens = [t.strip() for t in tokens_str.split(",") if t.strip()] if tokens_str else []

    result = []
    for i, url in enumerate(urls):
        token = tokens[i] if i < len(tokens) else (tokens[-1] if tokens else "")
        result.append({"url": url.rstrip("/"), "token": token})
    return result


def _build_llm() -> ChatDatabricks:
    """Build the LLM client from AGENT_MODEL_ENDPOINT (name or full URL)."""
    endpoint = os.environ.get("AGENT_MODEL_ENDPOINT", "").strip()
    if not endpoint:
        raise ValueError("AGENT_MODEL_ENDPOINT must be set")

    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        m = re.search(r"/serving-endpoints/([^/]+)/invocations", endpoint)
        if not m:
            raise ValueError(f"Cannot parse endpoint name from URL: {endpoint}")
        name = m.group(1)
        host = endpoint[: m.start()]
        token = os.environ.get("AGENT_MODEL_TOKEN", "").strip()
        if not token:
            raise ValueError("AGENT_MODEL_TOKEN must be set for cross-workspace endpoint")
        remote_client = WorkspaceClient(host=host, token=token)
        return ChatDatabricks(endpoint=name, workspace_client=remote_client)

    return ChatDatabricks(endpoint=endpoint)


def _load_system_prompt() -> Optional[str]:
    base = Path(__file__).resolve().parents[1] / "prompt"
    main_path = base / "main.prompt"
    if main_path.exists():
        content = main_path.read_text(encoding="utf-8").strip()
        return content or None
    return None


# ---------------------------------------------------------------------------
# Genie Space discovery
# ---------------------------------------------------------------------------

def get_spaces(workspace_url: str, pat_token: str) -> list[dict]:
    """Fetch all Genie spaces from a workspace via REST API."""
    try:
        response = requests.get(
            f"{workspace_url}/api/2.0/genie/spaces",
            headers={"Authorization": f"Bearer {pat_token}"},
            timeout=30,
        )
        if response.status_code != 200:
            print(f"Failed to fetch Genie spaces for {workspace_url}: {response.status_code}")
            return []
        return response.json().get("spaces", [])
    except Exception as error:
        print(f"Exception in get_spaces for {workspace_url}: {error}")
        return []


# ---------------------------------------------------------------------------
# MCP tool helpers
# ---------------------------------------------------------------------------

def get_managed_mcp_tools(ws: WorkspaceClient, server_url: str) -> list:
    """Get tool definitions from a managed MCP server (Genie Space)."""
    mcp_client = DatabricksMCPClient(server_url=server_url, workspace_client=ws)
    return mcp_client.list_tools()


def create_langchain_tool_from_mcp(
    mcp_tool, server_url: str, ws: WorkspaceClient, is_custom: bool = False
) -> "MCPTool":
    """Convert an MCP tool definition into a LangChain-compatible MCPTool."""
    schema = mcp_tool.inputSchema.copy()
    properties = schema.get("properties", {})
    required = schema.get("required", [])

    TYPE_MAPPING = {"integer": int, "number": float, "boolean": bool}
    field_definitions = {}
    for field_name, field_info in properties.items():
        field_type = TYPE_MAPPING.get(field_info.get("type", "string"), str)
        if field_name in required:
            field_definitions[field_name] = (field_type, ...)
        else:
            field_definitions[field_name] = (field_type, None)

    args_schema = create_model(f"{mcp_tool.name}Args", **field_definitions)

    return MCPTool(
        name=mcp_tool.name,
        description=mcp_tool.description or f"Tool: {mcp_tool.name}",
        args_schema=args_schema,
        server_url=server_url,
        ws=ws,
        is_custom=is_custom,
    )


# ---------------------------------------------------------------------------
# MCPTool — LangChain wrapper around a Databricks MCP server tool
# ---------------------------------------------------------------------------

class MCPTool(BaseTool):
    """
    LangChain Tool wrapper for a Databricks MCP server (Genie Space).

    Why object.__setattr__: BaseTool is Pydantic-based and restricts attribute
    assignment to declared fields. Using object.__setattr__ bypasses this to
    store internal implementation details (server_url, workspace_client, etc.)
    without polluting the tool schema visible to the LLM.
    """

    def __init__(
        self,
        name: str,
        description: str,
        args_schema: type,
        server_url: str,
        ws: WorkspaceClient,
        is_custom: bool = False,
    ):
        super().__init__(name=name, description=description, args_schema=args_schema)
        object.__setattr__(self, "server_url", server_url)
        object.__setattr__(self, "workspace_client", ws)
        object.__setattr__(self, "is_custom", is_custom)

    def _run(self, **kwargs) -> str:
        """Synchronous execution. Calls the MCP tool via DatabricksMCPClient."""
        mcp_client = DatabricksMCPClient(
            server_url=self.server_url,
            workspace_client=self.workspace_client,
        )
        response = mcp_client.call_tool(self.name, kwargs)
        return "".join([content.text for content in response.content])

    async def _arun(self, **kwargs) -> str:
        """Async execution — delegates to sync _run (DatabricksMCPClient is sync)."""
        return self._run(**kwargs)


# ---------------------------------------------------------------------------
# Tool discovery — builds all MCPTools from configured workspaces
# ---------------------------------------------------------------------------

async def create_mcp_tools_genie() -> List[MCPTool]:
    """
    Discover all Genie Spaces across configured workspaces and return
    one MCPTool per tool exposed by each Genie Space MCP server.
    """
    tools: List[MCPTool] = []

    for ws_config in _get_workspaces():
        workspace_url = ws_config["url"]
        pat_token = ws_config["token"]

        if not pat_token:
            print(f"No token for {workspace_url}, skipping.")
            continue

        try:
            workspace_client = WorkspaceClient(host=workspace_url, token=pat_token)
            genie_mcp_urls = [
                f"{workspace_url}/api/2.0/mcp/genie/{space['space_id']}"
                for space in get_spaces(workspace_url, pat_token)
                if space.get("space_id")
            ]
            print(f"Workspace {workspace_url}: found {len(genie_mcp_urls)} Genie Space(s)")

            for server_url in genie_mcp_urls:
                try:
                    mcp_tools = get_managed_mcp_tools(workspace_client, server_url)
                    for mcp_tool in mcp_tools:
                        tools.append(
                            create_langchain_tool_from_mcp(
                                mcp_tool, server_url, workspace_client, is_custom=False
                            )
                        )
                except Exception as err:
                    print(f"Error loading tools from {server_url}: {err}")

        except Exception as error:
            print(f"Exception processing workspace {workspace_url}: {error}")

    return tools


# ---------------------------------------------------------------------------
# LangGraph agent — AgentState + tool-calling graph
# ---------------------------------------------------------------------------

class AgentState(TypedDict):
    messages: Annotated[Sequence[AnyMessage], add_messages]
    custom_inputs: Optional[dict[str, Any]]
    custom_outputs: Optional[dict[str, Any]]


def create_tool_calling_agent(
    model: LanguageModelLike,
    tools: Union[ToolNode, Sequence[BaseTool]],
    system_prompt: Optional[str] = None,
):
    """
    Build a tool-calling agent using LangGraph.

    Graph: agent → (tool_calls?) → tools → agent → ... → END
    """
    model = model.bind_tools(tools)

    def should_continue(state: AgentState):
        last = state["messages"][-1]
        if isinstance(last, AIMessage) and last.tool_calls:
            return "continue"
        return "end"

    preprocessor = (
        RunnableLambda(
            lambda state: [{"role": "system", "content": system_prompt}] + state["messages"]
        )
        if system_prompt
        else RunnableLambda(lambda state: state["messages"])
    )

    model_runnable = preprocessor | model

    def call_model(state: AgentState, config: RunnableConfig):
        response = model_runnable.invoke(state, config)
        return {"messages": [response]}

    workflow = StateGraph(AgentState)
    workflow.add_node("agent", RunnableLambda(call_model))
    workflow.add_node("tools", ToolNode(tools))
    workflow.set_entry_point("agent")
    workflow.add_conditional_edges("agent", should_continue, {"continue": "tools", "end": END})
    workflow.add_edge("tools", "agent")

    return workflow.compile()


# ---------------------------------------------------------------------------
# LangGraphResponsesAgent — MLflow ResponsesAgent wrapper
# ---------------------------------------------------------------------------

class LangGraphResponsesAgent(ResponsesAgent):
    """
    Wraps a compiled LangGraph app as an MLflow ResponsesAgent.
    Supports both batch (predict) and streaming (predict_stream) interfaces.
    """

    def __init__(self, agent):
        self.agent = agent

    def predict(self, request: ResponsesAgentRequest) -> ResponsesAgentResponse:
        """Drain the stream and return a complete response."""
        outputs = [
            event.item
            for event in self.predict_stream(request)
            if event.type in ("response.output_item.done", "error")
        ]
        return ResponsesAgentResponse(output=outputs, custom_outputs=request.custom_inputs)

    def predict_stream(
        self, request: ResponsesAgentRequest
    ) -> Generator[ResponsesAgentStreamEvent, None, None]:
        """Yield events incrementally as the agent processes the request."""
        cc_msgs = to_chat_completions_input([inp.model_dump() for inp in request.input])

        for event in self.agent.stream(
            {"messages": cc_msgs}, stream_mode=["updates", "messages"]
        ):
            if event[0] == "updates":
                for node_data in event[1].values():
                    if node_data.get("messages"):
                        yield from output_to_responses_items_stream(node_data["messages"])

            elif event[0] == "messages":
                try:
                    chunk = event[1][0]
                    if isinstance(chunk, AIMessageChunk) and (content := chunk.content):
                        yield ResponsesAgentStreamEvent(
                            **create_text_delta(delta=content, item_id=chunk.id)
                        )
                except Exception:
                    pass


# ---------------------------------------------------------------------------
# Agent initialization
# ---------------------------------------------------------------------------

def initialize_agent() -> LangGraphResponsesAgent:
    """Build tools, LLM, and LangGraph — returns a deployable ResponsesAgent."""
    mcp_tools = asyncio.run(create_mcp_tools_genie())
    llm = _build_llm()
    system_prompt = _load_system_prompt()
    agent = create_tool_calling_agent(llm, mcp_tools, system_prompt)
    return LangGraphResponsesAgent(agent)


# ---------------------------------------------------------------------------
# Module-level initialization + MLflow registration
# ---------------------------------------------------------------------------

AGENT = initialize_agent()
mlflow.models.set_model(AGENT)


# ---------------------------------------------------------------------------
# AgentServer bridge — @invoke/@stream for FastAPI / Databricks Apps serving
# ---------------------------------------------------------------------------

@invoke()
async def non_streaming(request: ResponsesAgentRequest) -> ResponsesAgentResponse:
    return AGENT.predict(request)


@stream()
async def streaming(
    request: ResponsesAgentRequest,
) -> AsyncGenerator[ResponsesAgentStreamEvent, None]:
    for event in AGENT.predict_stream(request):
        yield event
