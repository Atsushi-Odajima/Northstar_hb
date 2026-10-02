// Northstar — shared domain types (used by server, web and MCP).
// The DB (SQLite) is the source of truth; these mirror its rows in camelCase.

export const GOAL_LEVELS = ["vision", "year", "quarter", "month", "week"] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];

export const GOAL_STATUSES = ["draft", "active", "paused", "achieved", "dropped", "archived"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const PROGRESS_MODES = ["manual", "milestone", "binary", "linked_outcomes"] as const;
export type ProgressMode = (typeof PROGRESS_MODES)[number];

export interface Goal {
  id: string;
  workspaceId: string;
  title: string;
  description: string;
  level: GoalLevel;
  parentId: string | null;
  startDate: string | null; // YYYY-MM-DD
  endDate: string | null;
  status: GoalStatus;
  priority: number; // 1 (highest) .. 5
  successDefinition: string;
  why: string;
  progressMode: ProgressMode;
  progressManual: number; // 0..100, only meaningful for manual mode
  isNorthStar: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const OUTCOME_STATUSES = ["open", "achieved", "dropped"] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

export interface Outcome {
  id: string;
  workspaceId: string;
  goalId: string;
  title: string;
  description: string;
  status: OutcomeStatus;
  dueDate: string | null;
  achievedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PROJECT_STATUSES = ["idea", "active", "waiting", "completed", "paused", "dropped"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface Project {
  id: string;
  workspaceId: string;
  title: string;
  outcome: string;
  description: string;
  status: ProjectStatus;
  nextAction: string;
  deadline: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const ACTION_KINDS = ["task", "open_loop", "waiting", "follow_up"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];
export const ACTION_STATUSES = ["open", "done", "dropped"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export interface Action {
  id: string;
  workspaceId: string;
  title: string;
  notes: string;
  kind: ActionKind;
  status: ActionStatus;
  dueDate: string | null;
  scheduledDate: string | null;
  doneAt: string | null;
  goalId: string | null;
  outcomeId: string | null;
  projectId: string | null;
  personId: string | null;
  decisionId: string | null;
  knowledgeId: string | null;
  waitingOn: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const BIG3_MAX = 3;
export const NORTH_STAR_MAX = 3;

export interface Big3Item {
  id: string;
  workspaceId: string;
  weekStart: string; // Monday YYYY-MM-DD
  rank: 1 | 2 | 3;
  title: string;
  goalId: string | null;
  projectId: string | null;
  actionId: string | null;
  status: "open" | "done" | "dropped";
  createdAt: string;
  updatedAt: string;
}

export interface DailyFocus {
  id: string;
  workspaceId: string;
  date: string;
  oneThingTitle: string;
  actionId: string | null;
  goalId: string | null;
  why: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export const CAPTURE_TYPES = ["idea", "task", "decision", "person_note", "knowledge", "question", "journal"] as const;
export type CaptureType = (typeof CAPTURE_TYPES)[number];
export const CAPTURE_STATUSES = ["inbox", "processed", "dismissed"] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export interface Capture {
  id: string;
  workspaceId: string;
  rawText: string;
  type: CaptureType | null; // user-confirmed type
  suggestedType: CaptureType | null; // heuristic/AI suggestion, never authoritative
  status: CaptureStatus;
  processedIntoType: string | null;
  processedIntoId: string | null;
  source: "web" | "pwa" | "mcp" | "import";
  clientId: string | null; // offline draft id for idempotent sync
  createdAt: string;
  updatedAt: string;
}

export const DECISION_OUTCOMES = ["better", "as_expected", "worse", "too_early", "abandoned"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export interface Decision {
  id: string;
  workspaceId: string;
  title: string;
  decidedAt: string; // YYYY-MM-DD
  context: string;
  options: string[];
  decision: string;
  reason: string;
  assumptions: string[];
  expectedOutcome: string;
  risks: string;
  confidence: number; // 0..100
  reviewDate: string | null;
  status: "open" | "reviewed" | "abandoned";
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface DecisionReview {
  id: string;
  workspaceId: string;
  decisionId: string;
  reviewedAt: string;
  outcome: DecisionOutcome;
  result: string;
  lessons: string;
  /** Immutable copy of the decision as it was when the review was written. */
  snapshot: Pick<Decision, "title" | "decidedAt" | "context" | "options" | "decision" | "reason" | "assumptions" | "expectedOutcome" | "risks" | "confidence">;
  source: "web" | "mcp";
  createdAt: string;
}

export const REVIEW_KINDS = ["daily", "weekly", "monthly", "quarterly", "yearly"] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export interface Review {
  id: string;
  workspaceId: string;
  kind: ReviewKind;
  periodStart: string;
  periodEnd: string; // inclusive
  templateId: string;
  answers: Record<string, string>;
  /** Data snapshot computed at completion time (period-scoped). */
  summary: Record<string, unknown> | null;
  status: "draft" | "completed";
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const RELATIONSHIP_TYPES = ["client", "partner", "mentor", "peer", "friend", "investor", "vendor", "team", "community", "other"] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export interface Person {
  id: string;
  workspaceId: string;
  name: string;
  organization: string;
  role: string;
  relationshipType: RelationshipType;
  importance: number; // 1..5
  tags: string[];
  howMet: string;
  notes: string;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const CONTACT_TYPES = ["meeting", "call", "message", "email", "event", "other"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export interface Contact {
  id: string;
  workspaceId: string;
  personId: string;
  date: string;
  type: ContactType;
  summary: string;
  nextStep: string;
  createdAt: string;
  updatedAt: string;
}

export interface Promise_ {
  id: string;
  workspaceId: string;
  personId: string;
  contactId: string | null;
  direction: "mine" | "theirs"; // mine = I promised; theirs = waiting for their reply
  text: string;
  dueDate: string | null;
  status: "open" | "done" | "dropped";
  createdAt: string;
  updatedAt: string;
}

export interface FollowUp {
  id: string;
  workspaceId: string;
  personId: string;
  contactId: string | null;
  dueDate: string;
  reason: string;
  status: "open" | "done" | "dropped";
  doneAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const KNOWLEDGE_SOURCE_TYPES = ["article", "book", "video", "podcast", "pdf", "chat", "course", "idea", "other"] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];
export const KNOWLEDGE_STATUSES = ["captured", "processed", "applied", "archived"] as const;
export type KnowledgeStatus = (typeof KNOWLEDGE_STATUSES)[number];

export interface KnowledgeItem {
  id: string;
  workspaceId: string;
  title: string;
  sourceType: KnowledgeSourceType;
  sourceUrl: string;
  sourceTitle: string;
  capturedAt: string;
  summary: string;
  keyIdeas: string[];
  personalMeaning: string;
  nextAction: string;
  status: KnowledgeStatus;
  appliedAt: string | null;
  appliedNote: string;
  rawContent: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const ENTITY_TYPES = [
  "goal", "outcome", "project", "action", "decision", "review", "person", "contact", "knowledge", "capture",
  "principle", "experiment", "calendar_event", "promise", "follow_up",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface Relation {
  id: string;
  workspaceId: string;
  fromType: EntityType;
  fromId: string;
  toType: EntityType;
  toId: string;
  kind: string; // e.g. "supports", "informs", "involves", "linked"
  createdAt: string;
}

export interface Principle {
  id: string;
  workspaceId: string;
  kind: "principle" | "anti_goal";
  text: string;
  active: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Experiment {
  id: string;
  workspaceId: string;
  title: string;
  hypothesis: string;
  action: string;
  periodStart: string | null;
  periodEnd: string | null;
  successSignal: string;
  status: "planned" | "running" | "completed" | "abandoned";
  result: string;
  lesson: string;
  createdAt: string;
  updatedAt: string;
}

export interface Metric {
  id: string;
  workspaceId: string;
  name: string;
  unit: string;
  /** "manual" or an auto source key such as "knowledge_applied", "decision_reviews", "important_followups", "actions_done" */
  source: string;
  createdAt: string;
}

export interface MetricEntry {
  id: string;
  metricId: string;
  date: string;
  value: number;
  note: string;
}

export interface CalendarEvent {
  id: string;
  workspaceId: string;
  source: "ics" | "manual";
  uid: string | null;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  category: "goal" | "meeting" | "focus" | "unclassified";
  goalId: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  workspaceId: string;
  kind: string;
  dedupeKey: string;
  title: string;
  body: string;
  link: string;
  scheduledFor: string;
  deliveredAt: string | null;
  readAt: string | null;
  createdAt: string;
}

// ---- Settings (stored as JSON on the workspace) ----
export const AI_SENSITIVE_CATEGORIES = ["journal", "people", "decisions", "reviews", "knowledge", "goals"] as const;
export type AiCategory = (typeof AI_SENSITIVE_CATEGORIES)[number];

export const AI_FEATURES = ["chief_of_staff", "knowledge_draft", "capture_classify", "semantic_search", "decision_patterns", "chat_import_extract"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export interface AiSettings {
  enabled: boolean;
  provider: "anthropic" | "openai" | "mock" | "none";
  model: string;
  embeddingModel: string;
  monthlyCapUsd: number;
  features: Record<AiFeature, boolean>;
  excludedCategories: AiCategory[];
}

export interface NotificationSettings {
  morningBrief: boolean;
  morningBriefTime: string; // HH:MM
  eveningReflection: boolean;
  eveningReflectionTime: string;
  weeklyReview: boolean;
  weeklyReviewDay: number; // 0 = Sunday .. 6
  weeklyReviewTime: string;
  decisionReviews: boolean;
  followUps: boolean;
  promises: boolean;
  quietHoursStart: string; // HH:MM
  quietHoursEnd: string;
  webPush: boolean;
}

export interface WorkspaceSettings {
  timezone: string;
  weekStartsOn: 1; // Monday (fixed in v1)
  reviewTemplate: "founder" | "freelancer" | "creator" | "manager" | "investor" | "general";
  ai: AiSettings;
  notifications: NotificationSettings;
  selectedMetricIds: string[];
  onboardingDone: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: "none",
  model: "",
  embeddingModel: "",
  monthlyCapUsd: 10,
  features: {
    chief_of_staff: true,
    knowledge_draft: true,
    capture_classify: true,
    semantic_search: false,
    decision_patterns: false,
    chat_import_extract: true,
  },
  excludedCategories: ["journal"],
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  morningBrief: true,
  morningBriefTime: "07:30",
  eveningReflection: false,
  eveningReflectionTime: "21:00",
  weeklyReview: true,
  weeklyReviewDay: 5,
  weeklyReviewTime: "16:00",
  decisionReviews: true,
  followUps: true,
  promises: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  webPush: false,
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  timezone: "Asia/Tokyo",
  weekStartsOn: 1,
  reviewTemplate: "general",
  ai: DEFAULT_AI_SETTINGS,
  notifications: DEFAULT_NOTIFICATION_SETTINGS,
  selectedMetricIds: [],
  onboardingDone: false,
};

export interface Workspace {
  id: string;
  ownerUserId: string;
  name: string;
  settings: WorkspaceSettings;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

/** A citation to a real record, returned by AI / semantic search. */
export interface Citation {
  type: EntityType;
  id: string;
  title: string;
  snippet: string;
  link: string;
}
