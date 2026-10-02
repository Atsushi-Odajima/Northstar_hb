import type { Db } from "./db/connection";

export interface AuthContext {
  userId: string;
  workspaceId: string;
  via: "session" | "token";
  scopes: string[]; // "read" | "write"
}

export type Env = { Variables: { auth: AuthContext; db: Db; sessionToken?: string } };
