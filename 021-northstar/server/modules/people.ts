import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../context";
import type { Db } from "../db/connection";
import type { Person, Contact, Promise_, FollowUp, RelationshipType, ContactType } from "@shared/types";
import { PersonCreateSchema, PersonUpdateSchema, ContactCreateSchema, PromiseCreateSchema, PromiseUpdateSchema, FollowUpCreateSchema, FollowUpUpdateSchema } from "@shared/schemas";
import { todayIn } from "@shared/period";
import { parseBody, parseQuery, ws } from "../lib/http";
import { conflict, notFound } from "../lib/errors";
import { newId, nowIso, parseJson } from "../lib/util";
import { indexEntity, cleanupEntity } from "./search/indexer";
import { logActivity } from "./activity";
import { relationsOf } from "./relations";
import { getWorkspace } from "./workspace";
import { stripUndefined } from "./goals";
import { mapDecision } from "./decisions";

interface PersonRow { id: string; workspace_id: string; name: string; organization: string; role: string; relationship_type: RelationshipType; importance: number; tags_json: string; how_met: string; notes: string; last_contact_at: string | null; next_follow_up_at: string | null; created_at: string; updated_at: string; version: number }
export function mapPerson(r: PersonRow): Person {
  return { id: r.id, workspaceId: r.workspace_id, name: r.name, organization: r.organization, role: r.role, relationshipType: r.relationship_type, importance: r.importance, tags: parseJson<string[]>(r.tags_json, []), howMet: r.how_met, notes: r.notes, lastContactAt: r.last_contact_at, nextFollowUpAt: r.next_follow_up_at, createdAt: r.created_at, updatedAt: r.updated_at, version: r.version };
}
interface ContactRow { id: string; workspace_id: string; person_id: string; date: string; type: ContactType; summary: string; next_step: string; created_at: string; updated_at: string }
export const mapContact = (r: ContactRow): Contact => ({ id: r.id, workspaceId: r.workspace_id, personId: r.person_id, date: r.date, type: r.type, summary: r.summary, nextStep: r.next_step, createdAt: r.created_at, updatedAt: r.updated_at });
interface PromiseRow { id: string; workspace_id: string; person_id: string; contact_id: string | null; direction: "mine" | "theirs"; text: string; due_date: string | null; status: Promise_["status"]; created_at: string; updated_at: string }
export const mapPromise = (r: PromiseRow): Promise_ => ({ id: r.id, workspaceId: r.workspace_id, personId: r.person_id, contactId: r.contact_id, direction: r.direction, text: r.text, dueDate: r.due_date, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at });
interface FollowUpRow { id: string; workspace_id: string; person_id: string; contact_id: string | null; due_date: string; reason: string; status: FollowUp["status"]; done_at: string | null; created_at: string; updated_at: string }
export const mapFollowUp = (r: FollowUpRow): FollowUp => ({ id: r.id, workspaceId: r.workspace_id, personId: r.person_id, contactId: r.contact_id, dueDate: r.due_date, reason: r.reason, status: r.status, doneAt: r.done_at, createdAt: r.created_at, updatedAt: r.updated_at });

export function getPerson(db: Db, wsId: string, id: string): Person {
  const r = db.get<PersonRow>("SELECT * FROM people WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Person");
  return mapPerson(r);
}
function reindexPerson(db: Db, p: Person) {
  indexEntity(db, p.workspaceId, "person", p.id, p.name, [p.organization, p.role, p.howMet, p.notes, p.tags.join(" ")].filter(Boolean).join("\n"), p.lastContactAt ?? p.createdAt.slice(0, 10));
}
export function findDuplicates(db: Db, wsId: string, name: string, excludeId?: string): Person[] {
  const norm = name.trim().toLowerCase().replace(/\s+/g, "");
  return db.all<PersonRow>("SELECT * FROM people WHERE workspace_id = ?", wsId).map(mapPerson)
    .filter((p) => p.id !== excludeId && p.name.trim().toLowerCase().replace(/\s+/g, "") === norm);
}
export function listPeople(db: Db, wsId: string, f: { q?: string; importance?: number; tag?: string; limit?: number } = {}): Person[] {
  const where = ["workspace_id = ?"]; const params: (string | number)[] = [wsId];
  if (f.q) { where.push("(name LIKE ? OR organization LIKE ? OR role LIKE ?)"); const like = `%${f.q}%`; params.push(like, like, like); }
  if (f.importance) { where.push("importance <= ?"); params.push(f.importance); }
  let rows = db.all<PersonRow>(`SELECT * FROM people WHERE ${where.join(" AND ")} ORDER BY importance ASC, last_contact_at DESC NULLS LAST, name ASC LIMIT ${Math.min(f.limit ?? 500, 5000)}`, ...params).map(mapPerson);
  if (f.tag) rows = rows.filter((p) => p.tags.includes(f.tag!));
  return rows;
}
export function createPerson(db: Db, wsId: string, input: z.infer<typeof PersonCreateSchema>): Person {
  const id = newId(); const now = nowIso();
  db.transaction(() => {
    db.run("INSERT INTO people(id, workspace_id, name, organization, role, relationship_type, importance, tags_json, how_met, notes, last_contact_at, next_follow_up_at, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 1)",
      id, wsId, input.name, input.organization, input.role, input.relationshipType, input.importance, JSON.stringify(input.tags), input.howMet, input.notes, input.nextFollowUpAt, now, now);
    reindexPerson(db, getPerson(db, wsId, id));
  });
  return getPerson(db, wsId, id);
}
export function updatePerson(db: Db, wsId: string, id: string, patch: z.infer<typeof PersonUpdateSchema>): Person {
  const cur = getPerson(db, wsId, id);
  if (patch.version !== undefined && patch.version !== cur.version) throw conflict("他の端末で更新されています", { current: cur });
  const { version: _v, ...rest } = patch;
  const next: Person = { ...cur, ...stripUndefined(rest), version: cur.version + 1, updatedAt: nowIso() } as Person;
  db.transaction(() => {
    db.run("UPDATE people SET name=?, organization=?, role=?, relationship_type=?, importance=?, tags_json=?, how_met=?, notes=?, next_follow_up_at=?, updated_at=?, version=? WHERE id=? AND workspace_id=?",
      next.name, next.organization, next.role, next.relationshipType, next.importance, JSON.stringify(next.tags), next.howMet, next.notes, next.nextFollowUpAt, next.updatedAt, next.version, id, wsId);
    reindexPerson(db, next);
  });
  return getPerson(db, wsId, id);
}
export function deletePerson(db: Db, wsId: string, id: string): void {
  getPerson(db, wsId, id);
  db.transaction(() => {
    for (const c of db.all<{ id: string }>("SELECT id FROM contacts WHERE person_id = ?", id)) cleanupEntity(db, wsId, "contact", c.id);
    for (const p of db.all<{ id: string }>("SELECT id FROM promises WHERE person_id = ?", id)) cleanupEntity(db, wsId, "promise", p.id);
    for (const f of db.all<{ id: string }>("SELECT id FROM follow_ups WHERE person_id = ?", id)) cleanupEntity(db, wsId, "follow_up", f.id);
    cleanupEntity(db, wsId, "person", id);
    db.run("DELETE FROM people WHERE id = ? AND workspace_id = ?", id, wsId);
  });
}

export function contactsOf(db: Db, wsId: string, personId: string, limit = 100): Contact[] {
  return db.all<ContactRow>("SELECT * FROM contacts WHERE person_id = ? AND workspace_id = ? ORDER BY date DESC, created_at DESC LIMIT ?", personId, wsId, limit).map(mapContact);
}
export function getContact(db: Db, wsId: string, id: string): Contact {
  const r = db.get<ContactRow>("SELECT * FROM contacts WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Contact");
  return mapContact(r);
}
/** Logs a contact, updates lastContact, creates promises / follow-up in one transaction. */
export function logContact(db: Db, wsId: string, input: z.infer<typeof ContactCreateSchema>): Contact {
  const person = getPerson(db, wsId, input.personId);
  const id = newId(); const now = nowIso();
  db.transaction(() => {
    db.run("INSERT INTO contacts(id, workspace_id, person_id, date, type, summary, next_step, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, wsId, input.personId, input.date, input.type, input.summary, input.nextStep, now, now);
    const last = person.lastContactAt && person.lastContactAt > input.date ? person.lastContactAt : input.date;
    db.run("UPDATE people SET last_contact_at = ?, updated_at = ? WHERE id = ?", last, now, input.personId);
    indexEntity(db, wsId, "contact", id, `${person.name} ${input.date}`, [input.summary, input.nextStep].filter(Boolean).join("\n"), input.date);
    for (const pr of input.promises) createPromise(db, wsId, { personId: input.personId, contactId: id, direction: pr.direction, text: pr.text, dueDate: pr.dueDate });
    if (input.followUp) createFollowUp(db, wsId, { personId: input.personId, contactId: id, dueDate: input.followUp.dueDate, reason: input.followUp.reason });
    logActivity(db, wsId, "contact", id, "contact.logged", person.name, now);
    reindexPerson(db, getPerson(db, wsId, input.personId));
  });
  return getContact(db, wsId, id);
}
export function deleteContact(db: Db, wsId: string, id: string): void {
  const c = getContact(db, wsId, id);
  db.transaction(() => {
    cleanupEntity(db, wsId, "contact", id);
    db.run("DELETE FROM contacts WHERE id = ?", id);
    const latest = db.get<{ date: string }>("SELECT date FROM contacts WHERE person_id = ? ORDER BY date DESC LIMIT 1", c.personId)?.date ?? null;
    db.run("UPDATE people SET last_contact_at = ?, updated_at = ? WHERE id = ?", latest, nowIso(), c.personId);
  });
}

export function createPromise(db: Db, wsId: string, input: z.infer<typeof PromiseCreateSchema>): Promise_ {
  getPerson(db, wsId, input.personId);
  const id = newId(); const now = nowIso();
  db.run("INSERT INTO promises(id, workspace_id, person_id, contact_id, direction, text, due_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)", id, wsId, input.personId, input.contactId, input.direction, input.text, input.dueDate, now, now);
  indexEntity(db, wsId, "promise", id, input.text, input.direction === "mine" ? "自分の約束" : "相手からの返事待ち", input.dueDate ?? now.slice(0, 10));
  return mapPromise(db.get<PromiseRow>("SELECT * FROM promises WHERE id = ?", id)!);
}
export function updatePromise(db: Db, wsId: string, id: string, patch: z.infer<typeof PromiseUpdateSchema>): Promise_ {
  const r = db.get<PromiseRow>("SELECT * FROM promises WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Promise");
  const cur = mapPromise(r);
  const next = { ...cur, ...stripUndefined(patch) };
  db.transaction(() => {
    db.run("UPDATE promises SET text=?, due_date=?, status=?, updated_at=? WHERE id=?", next.text, next.dueDate, next.status, nowIso(), id);
    indexEntity(db, wsId, "promise", id, next.text, next.direction === "mine" ? "自分の約束" : "相手からの返事待ち", next.dueDate ?? cur.createdAt.slice(0, 10));
    if (next.status === "done" && cur.status !== "done") logActivity(db, wsId, "promise", id, "promise.done", next.text);
  });
  return mapPromise(db.get<PromiseRow>("SELECT * FROM promises WHERE id = ?", id)!);
}
export function listPromises(db: Db, wsId: string, f: { status?: Promise_["status"]; direction?: "mine" | "theirs"; personId?: string } = {}): (Promise_ & { personName: string })[] {
  const where = ["pr.workspace_id = ?"]; const params: string[] = [wsId];
  if (f.status) { where.push("pr.status = ?"); params.push(f.status); }
  if (f.direction) { where.push("pr.direction = ?"); params.push(f.direction); }
  if (f.personId) { where.push("pr.person_id = ?"); params.push(f.personId); }
  return db.all<PromiseRow & { person_name: string }>(`SELECT pr.*, p.name AS person_name FROM promises pr JOIN people p ON p.id = pr.person_id WHERE ${where.join(" AND ")} ORDER BY pr.status, pr.due_date IS NULL, pr.due_date, pr.created_at DESC LIMIT 1000`, ...params)
    .map((r) => ({ ...mapPromise(r), personName: r.person_name }));
}

export function createFollowUp(db: Db, wsId: string, input: z.infer<typeof FollowUpCreateSchema>): FollowUp {
  const person = getPerson(db, wsId, input.personId);
  const id = newId(); const now = nowIso();
  db.transaction(() => {
    db.run("INSERT INTO follow_ups(id, workspace_id, person_id, contact_id, due_date, reason, status, done_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?)", id, wsId, input.personId, input.contactId, input.dueDate, input.reason, now, now);
    const next = person.nextFollowUpAt && person.nextFollowUpAt < input.dueDate ? person.nextFollowUpAt : input.dueDate;
    db.run("UPDATE people SET next_follow_up_at = ?, updated_at = ? WHERE id = ?", next, now, input.personId);
    indexEntity(db, wsId, "follow_up", id, `${person.name} follow-up`, input.reason, input.dueDate);
  });
  return mapFollowUp(db.get<FollowUpRow>("SELECT * FROM follow_ups WHERE id = ?", id)!);
}
export function updateFollowUp(db: Db, wsId: string, id: string, patch: z.infer<typeof FollowUpUpdateSchema>): FollowUp {
  const r = db.get<FollowUpRow>("SELECT * FROM follow_ups WHERE id = ? AND workspace_id = ?", id, wsId);
  if (!r) throw notFound("Follow-up");
  const cur = mapFollowUp(r);
  const next = { ...cur, ...stripUndefined(patch) };
  const now = nowIso();
  db.transaction(() => {
    db.run("UPDATE follow_ups SET due_date=?, reason=?, status=?, done_at=?, updated_at=? WHERE id=?", next.dueDate, next.reason, next.status, next.status === "done" ? (cur.doneAt ?? now) : null, now, id);
    const nextDue = db.get<{ d: string | null }>("SELECT MIN(due_date) d FROM follow_ups WHERE person_id = ? AND status = 'open'", cur.personId)?.d ?? null;
    db.run("UPDATE people SET next_follow_up_at = ?, updated_at = ? WHERE id = ?", nextDue, now, cur.personId);
    if (next.status === "done" && cur.status !== "done") logActivity(db, wsId, "follow_up", id, "follow_up.done", next.reason, now);
  });
  return mapFollowUp(db.get<FollowUpRow>("SELECT * FROM follow_ups WHERE id = ?", id)!);
}
export function listFollowUps(db: Db, wsId: string, f: { status?: FollowUp["status"]; dueBy?: string; personId?: string } = {}): (FollowUp & { personName: string })[] {
  const where = ["f.workspace_id = ?"]; const params: string[] = [wsId];
  if (f.status) { where.push("f.status = ?"); params.push(f.status); }
  if (f.dueBy) { where.push("f.due_date <= ?"); params.push(f.dueBy); }
  if (f.personId) { where.push("f.person_id = ?"); params.push(f.personId); }
  return db.all<FollowUpRow & { person_name: string }>(`SELECT f.*, p.name AS person_name FROM follow_ups f JOIN people p ON p.id = f.person_id WHERE ${where.join(" AND ")} ORDER BY f.status, f.due_date LIMIT 1000`, ...params)
    .map((r) => ({ ...mapFollowUp(r), personName: r.person_name }));
}

/** Pre-meeting brief — facts only (what happened, what I promised, what's open). No personality or intent inference. */
export function personBrief(db: Db, wsId: string, personId: string, today: string) {
  const person = getPerson(db, wsId, personId);
  const contacts = contactsOf(db, wsId, personId, 5);
  const promises = listPromises(db, wsId, { personId, status: "open" });
  const followUps = listFollowUps(db, wsId, { personId, status: "open" });
  const relations = relationsOf(db, wsId, "person", personId);
  const decisions = db.all("SELECT d.* FROM decisions d JOIN relations r ON r.from_type = 'decision' AND r.from_id = d.id AND r.to_type = 'person' AND r.to_id = ? WHERE d.workspace_id = ? ORDER BY d.decided_at DESC LIMIT 5", personId, wsId).map((r) => mapDecision(r as never));
  const actions = db.all<{ id: string; title: string; due_date: string | null; status: string }>("SELECT id, title, due_date, status FROM actions WHERE person_id = ? AND status = 'open' ORDER BY due_date", personId);
  const daysSince = person.lastContactAt ? Math.round((Date.parse(today) - Date.parse(person.lastContactAt)) / 86_400_000) : null;
  return {
    person,
    daysSinceLastContact: daysSince,
    lastContacts: contacts,
    topics: contacts.map((c) => c.summary).filter(Boolean).slice(0, 5),
    myOpenPromises: promises.filter((p) => p.direction === "mine"),
    waitingFromThem: promises.filter((p) => p.direction === "theirs"),
    openFollowUps: followUps,
    openActions: actions.map((a) => ({ id: a.id, title: a.title, dueDate: a.due_date })),
    relatedGoals: relations.filter((r) => r.type === "goal"),
    relatedProjects: relations.filter((r) => r.type === "project"),
    relatedKnowledge: relations.filter((r) => r.type === "knowledge"),
    relatedDecisions: decisions,
    note: "この Brief は記録された事実のみを並べています。相手の性格や意図は推定していません。",
  };
}

export const peopleRoutes = new Hono<Env>();
peopleRoutes.get("/people", (c) => {
  const q = parseQuery(c, z.object({ q: z.string().optional(), importance: z.coerce.number().int().optional(), tag: z.string().optional(), limit: z.coerce.number().int().optional() }));
  return c.json({ people: listPeople(c.get("db"), ws(c), q) });
});
peopleRoutes.post("/people", async (c) => {
  const body = await parseBody(c, PersonCreateSchema);
  const db = c.get("db"); const wsId = ws(c);
  const possibleDuplicates = findDuplicates(db, wsId, body.name);
  const person = createPerson(db, wsId, body);
  return c.json({ person, possibleDuplicates }, 201);
});
peopleRoutes.get("/people/:id", (c) => {
  const db = c.get("db"); const wsId = ws(c);
  const person = getPerson(db, wsId, c.req.param("id"));
  return c.json({ person, contacts: contactsOf(db, wsId, person.id), promises: listPromises(db, wsId, { personId: person.id }), followUps: listFollowUps(db, wsId, { personId: person.id }), relations: relationsOf(db, wsId, "person", person.id) });
});
peopleRoutes.get("/people/:id/brief", (c) => {
  const db = c.get("db"); const wsId = ws(c);
  return c.json(personBrief(db, wsId, c.req.param("id"), todayIn(getWorkspace(db, wsId).settings.timezone)));
});
peopleRoutes.patch("/people/:id", async (c) => c.json({ person: updatePerson(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, PersonUpdateSchema)) }));
peopleRoutes.delete("/people/:id", (c) => { deletePerson(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });
peopleRoutes.post("/contacts", async (c) => c.json({ contact: logContact(c.get("db"), ws(c), await parseBody(c, ContactCreateSchema)) }, 201));
peopleRoutes.delete("/contacts/:id", (c) => { deleteContact(c.get("db"), ws(c), c.req.param("id")); return c.json({ ok: true }); });
peopleRoutes.get("/promises", (c) => {
  const q = parseQuery(c, z.object({ status: z.enum(["open", "done", "dropped"]).optional(), direction: z.enum(["mine", "theirs"]).optional() }));
  return c.json({ promises: listPromises(c.get("db"), ws(c), q) });
});
peopleRoutes.post("/promises", async (c) => c.json({ promise: createPromise(c.get("db"), ws(c), await parseBody(c, PromiseCreateSchema)) }, 201));
peopleRoutes.patch("/promises/:id", async (c) => c.json({ promise: updatePromise(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, PromiseUpdateSchema)) }));
peopleRoutes.get("/follow-ups", (c) => {
  const q = parseQuery(c, z.object({ status: z.enum(["open", "done", "dropped"]).optional(), due: z.string().optional() }));
  const db = c.get("db"); const wsId = ws(c);
  const today = todayIn(getWorkspace(db, wsId).settings.timezone);
  return c.json({ followUps: listFollowUps(db, wsId, { status: q.status, dueBy: q.due === "now" ? today : q.due }) });
});
peopleRoutes.post("/follow-ups", async (c) => c.json({ followUp: createFollowUp(c.get("db"), ws(c), await parseBody(c, FollowUpCreateSchema)) }, 201));
peopleRoutes.patch("/follow-ups/:id", async (c) => c.json({ followUp: updateFollowUp(c.get("db"), ws(c), c.req.param("id"), await parseBody(c, FollowUpUpdateSchema)) }));
