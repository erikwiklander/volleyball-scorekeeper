import { z } from 'zod';
import { deleteTeam, sportOf, type Snapshot, type Team } from '../domain';

const uuid = z.uuid();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const cloudTeamSchema = z.object({
  id: uuid,
  sport: z.enum(['volleyball', 'football']),
  name: z.string().min(1).max(100),
  shortName: z.string().max(20).optional(),
  primaryColor: color,
  secondaryColor: color.optional(),
  logo: z
    .string()
    .max(1_500_000)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
    .optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const cloudTeamRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().positive(),
    mutationId: uuid,
    deviceId: uuid,
    deleted: z.boolean(),
    updatedAt: z.number(),
    team: cloudTeamSchema.optional(),
  })
  .refine((record) => record.deleted === !record.team);
export type CloudTeamRecord = z.infer<typeof cloudTeamRecordSchema>;
export const cloudTeamsSchema = z
  .record(uuid, cloudTeamRecordSchema)
  .refine((records) =>
    Object.entries(records).every(
      ([id, record]) => !record.team || record.team.id === id,
    ),
  );
export interface TeamLink {
  id: string;
  ownerUid: string;
  remoteRevision: number;
}
export interface TeamQueueEntry {
  id: string;
  ownerUid: string;
  baseRevision: number;
  mutationId: string;
  team: Team | null;
}
export interface TeamSyncState {
  id: 'current';
  deviceId: string;
  ownerUid?: string;
  conflict?: string;
}
export function teamLibrary(data: Snapshot) {
  return data.teams.filter((team) => {
    const owner = data.teamLinks.find((link) => link.id === team.id)?.ownerUid;
    return !owner || owner === data.teamSync.ownerUid;
  });
}
export function normalizedTeam(team: Team) {
  return cloudTeamSchema.parse(
    JSON.parse(JSON.stringify({ ...team, sport: sportOf(team) })),
  );
}
function enqueue(data: Snapshot, teamId: string, ownerUid: string) {
  let link = data.teamLinks.find((entry) => entry.id === teamId);
  if (!link) {
    link = { id: teamId, ownerUid, remoteRevision: 0 };
    data.teamLinks.push(link);
  }
  data.teamQueue = data.teamQueue.filter((entry) => entry.id !== teamId);
  data.teamQueue.push({
    id: teamId,
    ownerUid,
    baseRevision: link.remoteRevision,
    mutationId: crypto.randomUUID(),
    team: data.teams.find((team) => team.id === teamId) ?? null,
  });
}
export function adoptLocalTeams(data: Snapshot, ownerUid: string) {
  data.teamSync.deviceId ||= crypto.randomUUID();
  if (data.teamSync.ownerUid !== ownerUid) delete data.teamSync.conflict;
  data.teamSync.ownerUid = ownerUid;
  for (const team of data.teams) {
    if (!data.teamLinks.some((link) => link.id === team.id))
      enqueue(data, team.id, ownerUid);
  }
}
// Called in the same local transaction as library edits and backup imports.
export function queueTeamChanges(before: Snapshot, after: Snapshot) {
  const ids = new Set([...before.teams, ...after.teams].map((team) => team.id));
  for (const id of ids) {
    const old = before.teams.find((team) => team.id === id);
    const current = after.teams.find((team) => team.id === id);
    if (JSON.stringify(old) === JSON.stringify(current)) continue;
    const owner =
      after.teamLinks.find((link) => link.id === id)?.ownerUid ??
      after.teamSync.ownerUid;
    if (!owner) continue;
    if (owner !== after.teamSync.ownerUid)
      throw new Error(
        'The team account changed. Reopen the team before editing it.',
      );
    after.teamSync.deviceId ||= crypto.randomUUID();
    enqueue(after, id, owner);
  }
}
export function applyCloudTeam(
  data: Snapshot,
  ownerUid: string,
  id: string,
  remote: CloudTeamRecord,
) {
  let link = data.teamLinks.find((entry) => entry.id === id);
  // Never replace another account's cached record, even if IDs collide.
  if (link && link.ownerUid !== ownerUid)
    throw new Error('A cloud team ID conflicts with another cached account.');
  if (link && remote.revision < link.remoteRevision) return;
  if (!link) {
    link = { id, ownerUid, remoteRevision: 0 };
    data.teamLinks.push(link);
  }
  const pending = data.teamQueue.find((entry) => entry.id === id);
  link.remoteRevision = remote.revision;
  if (pending) {
    if (
      pending.mutationId === remote.mutationId ||
      (!pending.team && remote.deleted)
    ) {
      data.teamQueue = data.teamQueue.filter((entry) => entry.id !== id);
    } else if (
      remote.deviceId === data.teamSync.deviceId ||
      pending.baseRevision === remote.revision ||
      !pending.team
    ) {
      // Acknowledging an older upload must preserve a newer local edit.
      // A deliberate deletion is rebased and retried against the current record.
      pending.baseRevision = remote.revision;
      return;
    } else if (pending.baseRevision < remote.revision) {
      const copy = {
        ...pending.team,
        id: crypto.randomUUID(),
        name: `${pending.team.name.slice(0, 86)} (saved copy)`,
      };
      data.teams.push(copy);
      data.teamQueue = data.teamQueue.filter((entry) => entry.id !== id);
      enqueue(data, copy.id, ownerUid);
      data.teamSync.conflict = `Another device changed or deleted ${pending.team.name}. Your unsynced edits were kept as ${copy.name}.`;
    } else return;
  }
  if (remote.deleted) {
    if (data.teams.some((team) => team.id === id)) deleteTeam(data, id);
  } else {
    // Optional fields removed remotely must not survive on this device.
    const index = data.teams.findIndex((team) => team.id === id);
    if (index >= 0) data.teams[index] = { ...remote.team! };
    else data.teams.push({ ...remote.team! });
  }
}
