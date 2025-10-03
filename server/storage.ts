import {
  type Tournament,
  type InsertTournament,
  type Player,
  type InsertPlayer,
  type Match,
  type InsertMatch,
  type Pairing,
  type InsertPairing,
  type ByeRequest,
  type InsertByeRequest,
  type TournamentHistory,
  type InsertTournamentHistory,
  type PlayerRegistration,
  type InsertPlayerRegistration,
  type User,
  type InsertUser,
  type Session,
  type PasswordReset,
} from "@shared/schema";
import { getSupabaseClient } from "../supabaseClient";

type AnyRecord = Record<string, unknown>;

function toSnakeCaseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function toCamelCaseKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function toSnakeCase<T>(input: T): any {
  if (input instanceof Date) {
    return input.toISOString();
  }

  if (Array.isArray(input)) {
    return input.map((item) => toSnakeCase(item));
  }

  if (input === null || typeof input !== "object") {
    return input;
  }

  const result: AnyRecord = {};

  for (const [key, value] of Object.entries(input as AnyRecord)) {
    if (value === undefined) {
      continue;
    }

    result[toSnakeCaseKey(key)] = toSnakeCase(value);
  }

  return result;
}

function toCamelCase<T>(input: any): T {
  if (Array.isArray(input)) {
    return input.map((item) => toCamelCase(item)) as T;
  }

  if (input === null || typeof input !== "object") {
    return input as T;
  }

  const result: AnyRecord = {};

  for (const [key, value] of Object.entries(input as AnyRecord)) {
    result[toCamelCaseKey(key)] = toCamelCase(value);
  }

  return result as T;
}

function client() {
  return getSupabaseClient();
}

async function insertOne<T>(table: string, values: AnyRecord): Promise<T> {
  const { data, error } = await client()
    .from(table)
    .insert(toSnakeCase(values))
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to insert into ${table}: ${error.message}`);
  }

  return toCamelCase<T>(data);
}

async function updateOne<T>(
  table: string,
  filters: Record<string, unknown>,
  values: AnyRecord,
): Promise<T | undefined> {
  let builder: any = client().from(table).update(toSnakeCase(values));

  for (const [key, value] of Object.entries(filters)) {
    builder = builder.eq(toSnakeCaseKey(key), value as any);
  }

  const { data, error } = await builder.select().maybeSingle();

  if (error) {
    throw new Error(`Failed to update ${table}: ${error.message}`);
  }

  return data ? toCamelCase<T>(data) : undefined;
}

async function fetchOne<T>(table: string, filters: Record<string, unknown>): Promise<T | undefined> {
  let builder: any = client().from(table).select();

  for (const [key, value] of Object.entries(filters)) {
    builder = builder.eq(toSnakeCaseKey(key), value as any);
  }

  const { data, error } = await builder.maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch from ${table}: ${error.message}`);
  }

  return data ? toCamelCase<T>(data) : undefined;
}

async function fetchMany<T>(
  table: string,
  filters: Record<string, unknown> = {},
  options?: { order?: { column: string; ascending?: boolean } },
): Promise<T[]> {
  let builder: any = client().from(table).select();

  for (const [key, value] of Object.entries(filters)) {
    builder = builder.eq(toSnakeCaseKey(key), value as any);
  }

  if (options?.order) {
    builder = builder.order(toSnakeCaseKey(options.order.column), {
      ascending: options.order.ascending ?? true,
    });
  }

  const { data, error } = await builder;

  if (error) {
    throw new Error(`Failed to list from ${table}: ${error.message}`);
  }

  return toCamelCase<T[]>(data ?? []);
}

async function deleteMany(table: string, filters: Record<string, unknown>): Promise<number> {
  let builder: any = client().from(table).delete().select("id");

  for (const [key, value] of Object.entries(filters)) {
    builder = builder.eq(toSnakeCaseKey(key), value as any);
  }

  const { data, error } = await builder;

  if (error) {
    throw new Error(`Failed to delete from ${table}: ${error.message}`);
  }

  return data?.length ?? 0;
}

export interface IStorage {
  createUser(user: InsertUser): Promise<User>;
  getUserById(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  updateUser(id: number, user: Partial<User>): Promise<User | undefined>;

  createSession(userId: number, token: string, expiresAt: Date): Promise<Session>;
  getSessionByToken(token: string): Promise<Session | undefined>;
  deleteSession(token: string): Promise<boolean>;

  createPasswordReset(userId: number, token: string, expiresAt: Date): Promise<PasswordReset>;
  getPasswordResetByToken(token: string): Promise<PasswordReset | undefined>;
  usePasswordReset(token: string): Promise<boolean>;

  createTournament(tournament: InsertTournament & { createdBy: number }): Promise<Tournament>;
  getTournament(id: number): Promise<Tournament | undefined>;
  getAllTournaments(): Promise<Tournament[]>;
  getTournamentsByUser(userId: number): Promise<Tournament[]>;
  updateTournament(id: number, tournament: Partial<Tournament>): Promise<Tournament | undefined>;
  deleteTournament(id: number): Promise<boolean>;

  createPlayer(player: InsertPlayer): Promise<Player>;
  getPlayer(id: number): Promise<Player | undefined>;
  getPlayersByTournament(tournamentId: number): Promise<Player[]>;
  updatePlayer(id: number, player: Partial<Player>): Promise<Player | undefined>;
  deletePlayer(id: number): Promise<boolean>;

  createMatch(match: InsertMatch): Promise<Match>;
  getMatch(id: number): Promise<Match | undefined>;
  getMatchesByTournament(tournamentId: number): Promise<Match[]>;
  getMatchesByRound(tournamentId: number, round: number): Promise<Match[]>;
  updateMatch(id: number, match: Partial<Match>): Promise<Match | undefined>;
  deleteMatch(id: number): Promise<boolean>;
  deleteMatchesByRound(tournamentId: number, round: number): Promise<boolean>;

  createPairing(pairing: InsertPairing): Promise<Pairing>;
  getPairingsByTournament(tournamentId: number): Promise<Pairing[]>;
  getPairingsByRound(tournamentId: number, round: number): Promise<Pairing[]>;
  updatePairing(id: number, pairing: Partial<Pairing>): Promise<Pairing | undefined>;
  deletePairing(id: number): Promise<boolean>;
  deletePairingsByRound(tournamentId: number, round: number): Promise<boolean>;

  createByeRequest(byeRequest: InsertByeRequest): Promise<ByeRequest>;
  getByeRequestsByTournament(tournamentId: number): Promise<ByeRequest[]>;
  getByeRequestsByRound(tournamentId: number, round: number): Promise<ByeRequest[]>;
  updateByeRequest(id: number, byeRequest: Partial<ByeRequest>): Promise<ByeRequest | undefined>;

  createHistoryEntry(entry: InsertTournamentHistory): Promise<TournamentHistory>;
  getTournamentHistory(tournamentId: number): Promise<TournamentHistory[]>;
  getHistoryEntry(id: number): Promise<TournamentHistory | undefined>;

  createPlayerRegistration(registration: InsertPlayerRegistration): Promise<PlayerRegistration>;
  getPlayerRegistration(id: number): Promise<PlayerRegistration | undefined>;
  getPlayerRegistrationsByTournament(tournamentId: number): Promise<PlayerRegistration[]>;
  getPlayerRegistrationsByUser(userId: number): Promise<PlayerRegistration[]>;
  updatePlayerRegistration(id: number, registration: Partial<PlayerRegistration>): Promise<PlayerRegistration | undefined>;
  deletePlayerRegistration(id: number): Promise<boolean>;
}

class SupabaseStorage implements IStorage {
  async createUser(user: InsertUser): Promise<User> {
    const payload: AnyRecord = { ...(user as AnyRecord) };
    delete payload.password;
    return insertOne<User>("users", payload);
  }

  async getUserById(id: number): Promise<User | undefined> {
    return fetchOne<User>("users", { id });
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return fetchOne<User>("users", { username });
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return fetchOne<User>("users", { email });
  }

  async updateUser(id: number, user: Partial<User>): Promise<User | undefined> {
    return updateOne<User>("users", { id }, { ...user, updatedAt: new Date() });
  }

  async createSession(userId: number, token: string, expiresAt: Date): Promise<Session> {
    return insertOne<Session>("sessions", { userId, token, expiresAt } as AnyRecord);
  }

  async getSessionByToken(token: string): Promise<Session | undefined> {
    return fetchOne<Session>("sessions", { token });
  }

  async deleteSession(token: string): Promise<boolean> {
    return (await deleteMany("sessions", { token })) > 0;
  }

  async createPasswordReset(userId: number, token: string, expiresAt: Date): Promise<PasswordReset> {
    return insertOne<PasswordReset>("password_resets", { userId, token, expiresAt, used: false } as AnyRecord);
  }

  async getPasswordResetByToken(token: string): Promise<PasswordReset | undefined> {
    return fetchOne<PasswordReset>("password_resets", { token });
  }

  async usePasswordReset(token: string): Promise<boolean> {
    const updated = await updateOne<PasswordReset>("password_resets", { token }, { used: true });
    return Boolean(updated);
  }

  async createTournament(tournament: InsertTournament & { createdBy: number }): Promise<Tournament> {
    return insertOne<Tournament>("tournaments", tournament as AnyRecord);
  }

  async getTournament(id: number): Promise<Tournament | undefined> {
    return fetchOne<Tournament>("tournaments", { id });
  }

  async getAllTournaments(): Promise<Tournament[]> {
    return fetchMany<Tournament>("tournaments");
  }

  async getTournamentsByUser(userId: number): Promise<Tournament[]> {
    return fetchMany<Tournament>("tournaments", { createdBy: userId });
  }

  async updateTournament(id: number, tournament: Partial<Tournament>): Promise<Tournament | undefined> {
    return updateOne<Tournament>("tournaments", { id }, tournament as AnyRecord);
  }

  async deleteTournament(id: number): Promise<boolean> {
    return (await deleteMany("tournaments", { id })) > 0;
  }

  async createPlayer(player: InsertPlayer): Promise<Player> {
    const payload: InsertPlayer = {
      ...player,
      rating: player.rating ?? 1000,
      federation: player.federation ?? "USCF",
    };
    return insertOne<Player>("players", payload as AnyRecord);
  }

  async getPlayer(id: number): Promise<Player | undefined> {
    return fetchOne<Player>("players", { id });
  }

  async getPlayersByTournament(tournamentId: number): Promise<Player[]> {
    return fetchMany<Player>("players", { tournamentId });
  }

  async updatePlayer(id: number, player: Partial<Player>): Promise<Player | undefined> {
    return updateOne<Player>("players", { id }, player as AnyRecord);
  }

  async deletePlayer(id: number): Promise<boolean> {
    return (await deleteMany("players", { id })) > 0;
  }

  async createMatch(match: InsertMatch): Promise<Match> {
    const payload: InsertMatch = {
      ...match,
      status: match.status ?? "pending",
      result: match.result ?? null,
      board: match.board ?? null,
      whitePlayerId: match.whitePlayerId ?? null,
      blackPlayerId: match.blackPlayerId ?? null,
    };
    return insertOne<Match>("matches", payload as AnyRecord);
  }

  async getMatch(id: number): Promise<Match | undefined> {
    return fetchOne<Match>("matches", { id });
  }

  async getMatchesByTournament(tournamentId: number): Promise<Match[]> {
    return fetchMany<Match>("matches", { tournamentId });
  }

  async getMatchesByRound(tournamentId: number, round: number): Promise<Match[]> {
    return fetchMany<Match>("matches", { tournamentId, round });
  }

  async updateMatch(id: number, match: Partial<Match>): Promise<Match | undefined> {
    return updateOne<Match>("matches", { id }, match as AnyRecord);
  }

  async deleteMatch(id: number): Promise<boolean> {
    return (await deleteMany("matches", { id })) > 0;
  }

  async deleteMatchesByRound(tournamentId: number, round: number): Promise<boolean> {
    await deleteMany("matches", { tournamentId, round });
    return true;
  }

  async createPairing(pairing: InsertPairing): Promise<Pairing> {
    const payload: InsertPairing = {
      ...pairing,
      color: pairing.color ?? null,
      points: pairing.points ?? 0,
      opponentId: pairing.opponentId ?? null,
      isBye: pairing.isBye ?? false,
    };
    return insertOne<Pairing>("pairings", payload as AnyRecord);
  }

  async getPairingsByTournament(tournamentId: number): Promise<Pairing[]> {
    return fetchMany<Pairing>("pairings", { tournamentId });
  }

  async getPairingsByRound(tournamentId: number, round: number): Promise<Pairing[]> {
    return fetchMany<Pairing>("pairings", { tournamentId, round });
  }

  async updatePairing(id: number, pairing: Partial<Pairing>): Promise<Pairing | undefined> {
    return updateOne<Pairing>("pairings", { id }, pairing as AnyRecord);
  }

  async deletePairing(id: number): Promise<boolean> {
    return (await deleteMany("pairings", { id })) > 0;
  }

  async deletePairingsByRound(tournamentId: number, round: number): Promise<boolean> {
    await deleteMany("pairings", { tournamentId, round });
    return true;
  }

  async createByeRequest(byeRequest: InsertByeRequest): Promise<ByeRequest> {
    return insertOne<ByeRequest>("bye_requests", byeRequest as AnyRecord);
  }

  async getByeRequestsByTournament(tournamentId: number): Promise<ByeRequest[]> {
    return fetchMany<ByeRequest>("bye_requests", { tournamentId });
  }

  async getByeRequestsByRound(tournamentId: number, round: number): Promise<ByeRequest[]> {
    return fetchMany<ByeRequest>("bye_requests", { tournamentId, round });
  }

  async updateByeRequest(id: number, byeRequest: Partial<ByeRequest>): Promise<ByeRequest | undefined> {
    return updateOne<ByeRequest>("bye_requests", { id }, byeRequest as AnyRecord);
  }

  async createHistoryEntry(entry: InsertTournamentHistory): Promise<TournamentHistory> {
    return insertOne<TournamentHistory>("tournament_history", entry as AnyRecord);
  }

  async getTournamentHistory(tournamentId: number): Promise<TournamentHistory[]> {
    return fetchMany<TournamentHistory>(
      "tournament_history",
      { tournamentId },
      { order: { column: "createdAt", ascending: false } },
    );
  }

  async getHistoryEntry(id: number): Promise<TournamentHistory | undefined> {
    return fetchOne<TournamentHistory>("tournament_history", { id });
  }

  async createPlayerRegistration(registration: InsertPlayerRegistration): Promise<PlayerRegistration> {
    return insertOne<PlayerRegistration>("player_registrations", registration as AnyRecord);
  }

  async getPlayerRegistration(id: number): Promise<PlayerRegistration | undefined> {
    return fetchOne<PlayerRegistration>("player_registrations", { id });
  }

  async getPlayerRegistrationsByTournament(tournamentId: number): Promise<PlayerRegistration[]> {
    return fetchMany<PlayerRegistration>("player_registrations", { tournamentId });
  }

  async getPlayerRegistrationsByUser(userId: number): Promise<PlayerRegistration[]> {
    return fetchMany<PlayerRegistration>("player_registrations", { userId });
  }

  async updatePlayerRegistration(id: number, registration: Partial<PlayerRegistration>): Promise<PlayerRegistration | undefined> {
    return updateOne<PlayerRegistration>(
      "player_registrations",
      { id },
      { ...registration, updatedAt: new Date() } as AnyRecord,
    );
  }

  async deletePlayerRegistration(id: number): Promise<boolean> {
    return (await deleteMany("player_registrations", { id })) > 0;
  }
}

export const storage: IStorage = new SupabaseStorage();