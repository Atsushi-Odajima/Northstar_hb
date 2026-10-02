// Local stdio MCP server (for Claude Desktop / Claude Code / Codex CLI). Usage:
//   NORTHSTAR_DB=./data/northstar.db NORTHSTAR_MCP_TOKEN=ns_xxx pnpm mcp
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { openDatabase } from "../db/connection";
import { config } from "../config";
import { sha256, parseJson } from "../lib/util";
import { buildMcpServer } from "./tools";

const token = process.env.NORTHSTAR_MCP_TOKEN ?? "";
if (!token) { console.error("NORTHSTAR_MCP_TOKEN が必要です（設定 → Plugin/MCP で発行）"); process.exit(1); }
const db = openDatabase(config.dbFile);
const row = db.get<{ id: string; workspace_id: string; scopes_json: string; revoked_at: string | null }>("SELECT id, workspace_id, scopes_json, revoked_at FROM api_tokens WHERE token_hash = ?", sha256(token));
if (!row || row.revoked_at) { console.error("API token が無効です"); process.exit(1); }
const server = buildMcpServer(db, { workspaceId: row.workspace_id, scopes: parseJson(row.scopes_json, ["read"]), tokenId: row.id });
await server.connect(new StdioServerTransport());
console.error("northstar MCP (stdio) ready");
