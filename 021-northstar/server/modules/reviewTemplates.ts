import type { ReviewKind } from "@shared/types";

export interface ReviewQuestion { id: string; text: string; section: string; hint?: string }
export type TemplateId = "general" | "founder" | "freelancer" | "creator" | "manager" | "investor";

const base: Record<ReviewKind, ReviewQuestion[]> = {
  daily: [
    { id: "progressed", section: "今日", text: "今日、重要なことで前に進んだのは？", hint: "North Star / Big 3 に関係することを1つで十分" },
    { id: "stuck", section: "今日", text: "止まったこと・詰まったことは？" },
    { id: "tomorrow_one_thing", section: "明日", text: "明日の最重要（One Thing）は？" },
    { id: "concerns", section: "明日", text: "気になっていること（Open Loop）は？" },
  ],
  weekly: [
    { id: "north_star_progress", section: "THIS WEEK", text: "重要なこと（North Star）は進んだ？根拠は？" },
    { id: "overspent", section: "THIS WEEK", text: "何に時間を使いすぎた？" },
    { id: "decisions_note", section: "THIS WEEK", text: "今週の判断で記録しておくべきものは？" },
    { id: "knowledge_applied", section: "THIS WEEK", text: "学びを行動に移せたものは？" },
    { id: "stop", section: "NEXT WEEK", text: "やめること（Stop）" },
    { id: "continue", section: "NEXT WEEK", text: "続けること（Continue）" },
    { id: "start", section: "NEXT WEEK", text: "始めること（Start）" },
    { id: "big3_plan", section: "NEXT WEEK", text: "来週の Big 3 候補" },
  ],
  monthly: [
    { id: "goals_review", section: "Goals", text: "今月の Goal / North Star はどこまで進んだ？" },
    { id: "decision_outcomes", section: "Decisions", text: "今月の判断の結果・学びは？" },
    { id: "people", section: "People", text: "人脈で動きがあったこと、放置していることは？" },
    { id: "learning", section: "Learning", text: "学びで行動につながったもの／保存して終わったものは？" },
    { id: "projects", section: "Projects", text: "Project の状況と優先順位の変更は？" },
    { id: "wins", section: "Wins / Misses", text: "うまくいったこと（Wins）" },
    { id: "misses", section: "Wins / Misses", text: "うまくいかなかったこと（Misses）" },
    { id: "time_allocation", section: "Time", text: "時間配分は Goal と合っていた？" },
    { id: "next_focus", section: "Next", text: "来月の North Star / 最重要 Focus は？" },
  ],
  quarterly: [
    { id: "quarter_goal_results", section: "Quarter Goals", text: "Quarter Goal の結果（達成／未達／途中）" },
    { id: "keep_stop_new", section: "Quarter Goals", text: "続ける Goal／やめる Goal／新しい Goal" },
    { id: "decision_lessons", section: "Decisions", text: "Quarter の判断から得た教訓" },
    { id: "network", section: "People", text: "人脈：深めるべき関係、手放す関係" },
    { id: "knowledge", section: "Knowledge", text: "学び：次 Quarter に活かすもの" },
    { id: "next_north_star", section: "Next Quarter", text: "次 Quarter の North Star（1〜3件）" },
  ],
  yearly: [
    { id: "year_in_review", section: "Year", text: "今年、本当に前に進んだことは？" },
    { id: "themes", section: "Year", text: "繰り返し現れたテーマ・パターンは？" },
    { id: "next_year_vision", section: "Next Year", text: "来年の Vision / Year Goal" },
  ],
};

const extras: Record<TemplateId, Partial<Record<ReviewKind, ReviewQuestion[]>>> = {
  general: {},
  founder: {
    weekly: [{ id: "customer_signal", section: "THIS WEEK", text: "顧客・市場からのシグナルで重要なものは？" }],
    monthly: [{ id: "product_metrics", section: "Goals", text: "製品・売上の重要指標は Goal に対してどうだった？（事実のみ）" }],
    quarterly: [{ id: "bets", section: "Quarter Goals", text: "次 Quarter に賭けるもの／賭けないものは？" }],
  },
  freelancer: {
    weekly: [{ id: "pipeline", section: "THIS WEEK", text: "案件パイプライン・返事待ちの状況は？" }],
    monthly: [{ id: "clients", section: "People", text: "クライアント関係で手を打つべきことは？" }],
    quarterly: [{ id: "positioning", section: "Quarter Goals", text: "専門性・単価・ポジショニングの方向性は？" }],
  },
  creator: {
    weekly: [{ id: "published", section: "THIS WEEK", text: "今週公開・発信できたものは？" }],
    monthly: [{ id: "audience", section: "Goals", text: "読者・視聴者との関係で変化は？" }],
    quarterly: [{ id: "body_of_work", section: "Quarter Goals", text: "作品群として何が積み上がった？" }],
  },
  manager: {
    weekly: [{ id: "team", section: "THIS WEEK", text: "チーム・1on1 で拾ったこと、委任できたことは？" }],
    monthly: [{ id: "delegation", section: "Projects", text: "自分がやらなくてよい仕事を手放せた？" }],
    quarterly: [{ id: "org", section: "Quarter Goals", text: "チームの次 Quarter の焦点は？" }],
  },
  investor: {
    weekly: [{ id: "thesis_check", section: "THIS WEEK", text: "自分の投資判断プロセスで守れたこと・崩れたことは？（※ 金融助言ではありません。自己の判断記録のみ）" }],
    monthly: [{ id: "decision_quality", section: "Decisions", text: "結果ではなく判断プロセスの質はどうだった？" }],
    quarterly: [{ id: "principles_update", section: "Decisions", text: "更新すべき Operating Principles は？" }],
  },
};

export const TEMPLATE_IDS: TemplateId[] = ["general", "founder", "freelancer", "creator", "manager", "investor"];
export const TEMPLATE_LABELS: Record<TemplateId, string> = { general: "一般", founder: "Founder", freelancer: "Freelancer", creator: "Creator", manager: "Manager", investor: "Investor（金融助言なし）" };

export function questionsFor(templateId: string, kind: ReviewKind): ReviewQuestion[] {
  const t = (TEMPLATE_IDS as string[]).includes(templateId) ? (templateId as TemplateId) : "general";
  return [...base[kind], ...(extras[t][kind] ?? [])];
}
