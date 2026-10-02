import type { Hono } from "hono";
import type { Env } from "../context";
import { actionRoutes } from "./actions";
import { projectRoutes } from "./projects";
import { captureRoutes } from "./captures";
import { decisionRoutes } from "./decisions";
import { peopleRoutes } from "./people";
import { knowledgeRoutes } from "./knowledge";
import { reviewRoutes } from "./reviews";
import { focusRoutes } from "./focus";
import { miscRoutes } from "./misc";
import { searchRoutes } from "./search/routes";
import { aiRoutes } from "../ai/routes";
import { transferRoutes } from "./transfer";
import { notificationRoutes } from "./notifications";
import { calendarRoutes } from "./calendar";
import { connectorRoutes } from "../connectors/routes";
import { accountRoutes } from "./account";

/** Module routers mounted under /api (all require authentication). */
export function registerModuleRoutes(api: Hono<Env>): void {
  api.route("/", actionRoutes);
  api.route("/", projectRoutes);
  api.route("/", captureRoutes);
  api.route("/", decisionRoutes);
  api.route("/", peopleRoutes);
  api.route("/", knowledgeRoutes);
  api.route("/", reviewRoutes);
  api.route("/", focusRoutes);
  api.route("/", miscRoutes);
  api.route("/", searchRoutes);
  api.route("/", aiRoutes);
  api.route("/", transferRoutes);
  api.route("/", notificationRoutes);
  api.route("/", calendarRoutes);
  api.route("/", connectorRoutes);
  api.route("/", accountRoutes);
}
