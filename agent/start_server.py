from dotenv import load_dotenv
from mlflow.genai.agent_server import AgentServer, setup_mlflow_git_based_version_tracking

# Load env vars from .env then .env.local before importing the agent
load_dotenv(dotenv_path=".env", override=False)
load_dotenv(dotenv_path=".env.local", override=True)

import agent.agent  # noqa: E402  — registers @invoke/@stream with the server
from agent.agent import _get_workspaces, get_spaces  # noqa: E402

server = AgentServer("ResponsesAgent", enable_chat_proxy=True)
app = server.app  # noqa: F841  — module-level for multi-worker support

setup_mlflow_git_based_version_tracking()


@app.get("/workspaces")
def get_workspaces():
    """Return all workspaces and their Genie Spaces."""
    result = []
    for ws in _get_workspaces():
        spaces = get_spaces(ws["url"], ws["token"])
        result.append({
            "url": ws["url"],
            "spaces": [{"space_id": s.get("space_id"), "title": s.get("title", s.get("name", ""))} for s in spaces],
        })
    return result


def main():
    server.run(app_import_string="agent.start_server:app")
