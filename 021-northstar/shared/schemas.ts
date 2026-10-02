// zod schemas for API payloads (validated server-side; reused by the web client for forms).
import { z } from "zod";
import {
  GOAL_LEVELS, GOAL_STATUSES, PROGRESS_MODES, OUTCOME_STATUSES, PROJECT_STATUSES, ACTION_KINDS, ACTION_STATUSES,
  CAPTURE_TYPES, DECISION_OUTCOMES, REVIEW_KINDS, RELATIONSHIP_TYPES, CONTACT_TYPES, KNOWLEDGE_SOURCE_TYPES,
  KNOWLEDGE_STATUSES, ENTITY_TYPES, AI_SENSITIVE_CATEGORIES, AI_FEATURES,
} from "./types";

export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で入力してください");
export const dateOrNull = dateStr.nullable();
export const timeStr = z.string().regex(/^\d{2}:\d{2}$/);
export const id = z.string().min(1).max(64);
export const idOrNull = id.nullable();
const text = (max: number) => z.string().max(max);
const title = z.string().trim().min(1, "タイトルは必須です").max(300);

type StripDefault<T> = T extends z.ZodDefault<infer I> ? I : T;
type PatchShape<T extends z.ZodRawShape> = { [K in keyof T]: z.ZodOptional<StripDefault<T[K]>> };
/**
 * PATCH schema derived from a create schema: strips `.default()` wrappers and makes every field optional.
 * (zod v4 `.partial()` would otherwise inject defaults for omitted keys and silently overwrite stored values.)
 */
export function patchOf<T extends z.ZodRawShape, E extends z.ZodRawShape = {}>(schema: z.ZodObject<T>, extra?: E): z.ZodObject<PatchShape<T> & E & { version: z.ZodOptional<z.ZodNumber> }> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [k, v] of Object.entries(schema.shape)) {
    const inner = v instanceof z.ZodDefault ? (v.def.innerType as z.ZodTypeAny) : (v as z.ZodTypeAny);
    shape[k] = inner.optional();
  }
  return z.object({ ...shape, ...(extra ?? {}), version: z.number().int().optional() }) as unknown as z.ZodObject<PatchShape<T> & E & { version: z.ZodOptional<z.ZodNumber> }>;
}

export const SignupSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(10, "パスワードは10文字以上").max(200),
  displayName: text(100).optional().default(""),
});
export const LoginSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(200) });

export const GoalCreateSchema = z.object({
  title,
  description: text(5000).default(""),
  level: z.enum(GOAL_LEVELS),
  parentId: idOrNull.default(null),
  startDate: dateOrNull.default(null),
  endDate: dateOrNull.default(null),
  status: z.enum(GOAL_STATUSES).default("draft"),
  priority: z.number().int().min(1).max(5).default(3),
  successDefinition: text(2000).default(""),
  why: text(2000).default(""),
  progressMode: z.enum(PROGRESS_MODES).default("manual"),
  progressManual: z.number().int().min(0).max(100).default(0),
  isNorthStar: z.boolean().default(false),
});
export const GoalUpdateSchema = patchOf(GoalCreateSchema);

export const GoalProgressLogSchema = z.object({ progress: z.number().int().min(0).max(100), note: text(1000).default(""), date: dateStr.optional() });

export const OutcomeCreateSchema = z.object({
  goalId: id,
  title,
  description: text(2000).default(""),
  status: z.enum(OUTCOME_STATUSES).default("open"),
  dueDate: dateOrNull.default(null),
});
export const OutcomeUpdateSchema = patchOf(OutcomeCreateSchema.omit({ goalId: true }));

export const ProjectCreateSchema = z.object({
  title,
  outcome: text(2000).default(""),
  description: text(5000).default(""),
  status: z.enum(PROJECT_STATUSES).default("idea"),
  nextAction: text(500).default(""),
  deadline: dateOrNull.default(null),
  goalIds: z.array(id).max(20).default([]),
});
export const ProjectUpdateSchema = patchOf(ProjectCreateSchema);

export const ActionCreateSchema = z.object({
  title,
  notes: text(5000).default(""),
  kind: z.enum(ACTION_KINDS).default("task"),
  status: z.enum(ACTION_STATUSES).default("open"),
  dueDate: dateOrNull.default(null),
  scheduledDate: dateOrNull.default(null),
  goalId: idOrNull.default(null),
  outcomeId: idOrNull.default(null),
  projectId: idOrNull.default(null),
  personId: idOrNull.default(null),
  decisionId: idOrNull.default(null),
  knowledgeId: idOrNull.default(null),
  waitingOn: text(300).default(""),
});
export const ActionUpdateSchema = patchOf(ActionCreateSchema);

export const Big3CreateSchema = z.object({
  weekStart: dateStr,
  title,
  goalId: idOrNull.default(null),
  projectId: idOrNull.default(null),
  actionId: idOrNull.default(null),
  rank: z.number().int().min(1).max(3).optional(),
});
export const Big3UpdateSchema = z.object({
  title: title.optional(),
  goalId: idOrNull.optional(),
  projectId: idOrNull.optional(),
  actionId: idOrNull.optional(),
  rank: z.number().int().min(1).max(3).optional(),
  status: z.enum(["open", "done", "dropped"]).optional(),
});

export const DailyFocusSchema = z.object({
  date: dateStr,
  oneThingTitle: text(300),
  actionId: idOrNull.default(null),
  goalId: idOrNull.default(null),
  why: text(1000).default(""),
  notes: text(5000).default(""),
});

export const CaptureCreateSchema = z.object({
  rawText: z.string().trim().min(1).max(10000),
  type: z.enum(CAPTURE_TYPES).nullable().default(null),
  source: z.enum(["web", "pwa", "mcp", "import"]).default("web"),
  clientId: z.string().max(64).nullable().default(null),
  createdAt: z.string().max(40).optional(), // offline drafts keep their original time
});
export const CaptureProcessSchema = z.object({
  type: z.enum(CAPTURE_TYPES),
  /** Target payload depends on type; server validates per type. */
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const DecisionCreateSchema = z.object({
  title,
  decidedAt: dateStr,
  context: text(5000).default(""),
  options: z.array(text(500)).max(20).default([]),
  decision: text(2000).default(""),
  reason: text(5000).default(""),
  assumptions: z.array(text(500)).max(20).default([]),
  expectedOutcome: text(2000).default(""),
  risks: text(2000).default(""),
  confidence: z.number().int().min(0).max(100).default(50),
  reviewDate: dateOrNull.default(null),
  goalIds: z.array(id).max(20).default([]),
  personIds: z.array(id).max(20).default([]),
});
export const DecisionUpdateSchema = patchOf(DecisionCreateSchema);
export const DecisionReviewSchema = z.object({
  outcome: z.enum(DECISION_OUTCOMES),
  result: text(5000).default(""),
  lessons: text(5000).default(""),
  reviewedAt: dateStr.optional(),
});

export const ReviewUpsertSchema = z.object({
  kind: z.enum(REVIEW_KINDS),
  date: dateStr, // any date inside the period
  templateId: z.string().max(40).optional(),
  answers: z.record(z.string(), z.string().max(10000)).default({}),
  complete: z.boolean().default(false),
});

export const PersonCreateSchema = z.object({
  name: title,
  organization: text(200).default(""),
  role: text(200).default(""),
  relationshipType: z.enum(RELATIONSHIP_TYPES).default("other"),
  importance: z.number().int().min(1).max(5).default(3),
  tags: z.array(z.string().max(50)).max(30).default([]),
  howMet: text(1000).default(""),
  notes: text(10000).default(""),
  nextFollowUpAt: dateOrNull.default(null),
});
export const PersonUpdateSchema = patchOf(PersonCreateSchema);

export const ContactCreateSchema = z.object({
  personId: id,
  date: dateStr,
  type: z.enum(CONTACT_TYPES).default("meeting"),
  summary: text(10000).default(""),
  nextStep: text(1000).default(""),
  promises: z.array(z.object({ direction: z.enum(["mine", "theirs"]), text: text(500), dueDate: dateOrNull.default(null) })).max(20).default([]),
  followUp: z.object({ dueDate: dateStr, reason: text(500).default("") }).nullable().default(null),
});

export const PromiseCreateSchema = z.object({
  personId: id,
  contactId: idOrNull.default(null),
  direction: z.enum(["mine", "theirs"]),
  text: text(500).min(1),
  dueDate: dateOrNull.default(null),
});
export const PromiseUpdateSchema = z.object({ text: text(500).optional(), dueDate: dateOrNull.optional(), status: z.enum(["open", "done", "dropped"]).optional() });

export const FollowUpCreateSchema = z.object({
  personId: id,
  contactId: idOrNull.default(null),
  dueDate: dateStr,
  reason: text(500).default(""),
});
export const FollowUpUpdateSchema = z.object({ dueDate: dateStr.optional(), reason: text(500).optional(), status: z.enum(["open", "done", "dropped"]).optional() });

export const KnowledgeCreateSchema = z.object({
  title,
  sourceType: z.enum(KNOWLEDGE_SOURCE_TYPES).default("article"),
  sourceUrl: text(2000).default(""),
  sourceTitle: text(300).default(""),
  capturedAt: dateStr.optional(),
  summary: text(10000).default(""),
  keyIdeas: z.array(text(1000)).max(30).default([]),
  personalMeaning: text(5000).default(""),
  nextAction: text(500).default(""),
  status: z.enum(KNOWLEDGE_STATUSES).default("captured"),
  rawContent: text(200000).default(""),
  goalIds: z.array(id).max(20).default([]),
  projectIds: z.array(id).max(20).default([]),
  personIds: z.array(id).max(20).default([]),
});
export const KnowledgeUpdateSchema = patchOf(KnowledgeCreateSchema, { appliedNote: text(2000).optional() });

export const RelationCreateSchema = z.object({
  fromType: z.enum(ENTITY_TYPES),
  fromId: id,
  toType: z.enum(ENTITY_TYPES),
  toId: id,
  kind: z.string().max(40).default("linked"),
});

export const PrincipleCreateSchema = z.object({
  kind: z.enum(["principle", "anti_goal"]),
  text: text(500).min(1),
  active: z.boolean().default(true),
  periodStart: dateOrNull.default(null),
  periodEnd: dateOrNull.default(null),
});
export const PrincipleUpdateSchema = patchOf(PrincipleCreateSchema);

export const ExperimentCreateSchema = z.object({
  title,
  hypothesis: text(2000).default(""),
  action: text(2000).default(""),
  periodStart: dateOrNull.default(null),
  periodEnd: dateOrNull.default(null),
  successSignal: text(1000).default(""),
  status: z.enum(["planned", "running", "completed", "abandoned"]).default("planned"),
  result: text(5000).default(""),
  lesson: text(5000).default(""),
});
export const ExperimentUpdateSchema = patchOf(ExperimentCreateSchema);

export const MetricCreateSchema = z.object({ name: title, unit: text(30).default(""), source: z.string().max(40).default("manual") });
export const MetricEntrySchema = z.object({ date: dateStr, value: z.number(), note: text(500).default("") });

export const CalendarEventCreateSchema = z.object({
  title,
  startAt: z.string().max(40),
  endAt: z.string().max(40),
  allDay: z.boolean().default(false),
  category: z.enum(["goal", "meeting", "focus", "unclassified"]).default("unclassified"),
  goalId: idOrNull.default(null),
  projectId: idOrNull.default(null),
});
export const CalendarEventUpdateSchema = patchOf(CalendarEventCreateSchema);

export const AiSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["anthropic", "openai", "mock", "none"]),
  model: z.string().max(100),
  embeddingModel: z.string().max(100),
  monthlyCapUsd: z.number().min(0).max(10000),
  features: z.record(z.enum(AI_FEATURES), z.boolean()),
  excludedCategories: z.array(z.enum(AI_SENSITIVE_CATEGORIES)),
});
export const NotificationSettingsSchema = z.object({
  morningBrief: z.boolean(), morningBriefTime: timeStr,
  eveningReflection: z.boolean(), eveningReflectionTime: timeStr,
  weeklyReview: z.boolean(), weeklyReviewDay: z.number().int().min(0).max(6), weeklyReviewTime: timeStr,
  decisionReviews: z.boolean(), followUps: z.boolean(), promises: z.boolean(),
  quietHoursStart: timeStr, quietHoursEnd: timeStr, webPush: z.boolean(),
});
export const SettingsUpdateSchema = z.object({
  name: text(100).optional(),
  timezone: z.string().max(60).optional(),
  reviewTemplate: z.enum(["founder", "freelancer", "creator", "manager", "investor", "general"]).optional(),
  ai: AiSettingsSchema.partial().optional(),
  notifications: NotificationSettingsSchema.partial().optional(),
  selectedMetricIds: z.array(id).optional(),
  onboardingDone: z.boolean().optional(),
});

export const ApiTokenCreateSchema = z.object({ name: title, scopes: z.array(z.enum(["read", "write"])).default(["read"]) });

export const AiAskSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  scope: z.object({
    types: z.array(z.enum(ENTITY_TYPES)).optional(),
    from: dateStr.optional(),
    to: dateStr.optional(),
    goalId: id.optional(),
    personId: id.optional(),
  }).default({}),
});

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  types: z.array(z.enum(ENTITY_TYPES)).optional(),
  limit: z.number().int().min(1).max(100).default(30),
  semantic: z.boolean().default(false),
});

export const ImportPreviewSchema = z.object({
  kind: z.enum(["people_csv", "goals_csv", "knowledge_csv", "decisions_csv", "json_backup", "markdown", "chat_export"]),
  content: z.string().max(20_000_000),
  fileName: z.string().max(200).default(""),
});
export const ImportConfirmSchema = z.object({
  importId: id,
  mapping: z.record(z.string(), z.string()).default({}),
  selectedRows: z.array(z.number().int()).optional(),
  duplicateAction: z.enum(["skip", "import_as_new"]).default("skip"),
});

export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }),
});

export type GoalCreate = z.infer<typeof GoalCreateSchema>;
export type ActionCreate = z.infer<typeof ActionCreateSchema>;
export type DecisionCreate = z.infer<typeof DecisionCreateSchema>;
export type PersonCreate = z.infer<typeof PersonCreateSchema>;
export type KnowledgeCreate = z.infer<typeof KnowledgeCreateSchema>;
