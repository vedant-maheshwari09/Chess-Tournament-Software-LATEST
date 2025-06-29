import { 
  tournaments, 
  players, 
  matches, 
  pairings,
  byeRequests,
  type Tournament, 
  type InsertTournament,
  type Player,
  type InsertPlayer,
  type Match,
  type InsertMatch,
  type Pairing,
  type InsertPairing,
  type ByeRequest,
  type InsertByeRequest
} from "@shared/schema";
import { db } from "./db";
import { eq, and } from "drizzle-orm";

export interface IStorage {
  // Tournament methods
  createTournament(tournament: InsertTournament): Promise<Tournament>;
  getTournament(id: number): Promise<Tournament | undefined>;
  getAllTournaments(): Promise<Tournament[]>;
  updateTournament(id: number, tournament: Partial<Tournament>): Promise<Tournament | undefined>;
  deleteTournament(id: number): Promise<boolean>;

  // Player methods
  createPlayer(player: InsertPlayer): Promise<Player>;
  getPlayer(id: number): Promise<Player | undefined>;
  getPlayersByTournament(tournamentId: number): Promise<Player[]>;
  updatePlayer(id: number, player: Partial<Player>): Promise<Player | undefined>;
  deletePlayer(id: number): Promise<boolean>;

  // Match methods
  createMatch(match: InsertMatch): Promise<Match>;
  getMatch(id: number): Promise<Match | undefined>;
  getMatchesByTournament(tournamentId: number): Promise<Match[]>;
  getMatchesByRound(tournamentId: number, round: number): Promise<Match[]>;
  updateMatch(id: number, match: Partial<Match>): Promise<Match | undefined>;

  // Pairing methods
  createPairing(pairing: InsertPairing): Promise<Pairing>;
  getPairingsByTournament(tournamentId: number): Promise<Pairing[]>;
  getPairingsByRound(tournamentId: number, round: number): Promise<Pairing[]>;
  updatePairing(id: number, pairing: Partial<Pairing>): Promise<Pairing | undefined>;

  // Bye request methods
  createByeRequest(byeRequest: InsertByeRequest): Promise<ByeRequest>;
  getByeRequestsByTournament(tournamentId: number): Promise<ByeRequest[]>;
  getByeRequestsByRound(tournamentId: number, round: number): Promise<ByeRequest[]>;
  updateByeRequest(id: number, byeRequest: Partial<ByeRequest>): Promise<ByeRequest | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Tournament methods
  async createTournament(tournament: InsertTournament): Promise<Tournament> {
    const [result] = await db
      .insert(tournaments)
      .values({
        ...tournament,
        status: tournament.status || 'draft',
        currentRound: tournament.currentRound || 0,
      })
      .returning();
    return result;
  }

  async getTournament(id: number): Promise<Tournament | undefined> {
    const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, id));
    return tournament || undefined;
  }

  async getAllTournaments(): Promise<Tournament[]> {
    return await db.select().from(tournaments);
  }

  async updateTournament(id: number, tournament: Partial<Tournament>): Promise<Tournament | undefined> {
    const [updated] = await db
      .update(tournaments)
      .set(tournament)
      .where(eq(tournaments.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteTournament(id: number): Promise<boolean> {
    const result = await db.delete(tournaments).where(eq(tournaments.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Player methods
  async createPlayer(player: InsertPlayer): Promise<Player> {
    const [result] = await db
      .insert(players)
      .values({
        ...player,
        rating: player.rating || 1000,
        federation: player.federation || 'USCF',
      })
      .returning();
    return result;
  }

  async getPlayer(id: number): Promise<Player | undefined> {
    const [player] = await db.select().from(players).where(eq(players.id, id));
    return player || undefined;
  }

  async getPlayersByTournament(tournamentId: number): Promise<Player[]> {
    return await db.select().from(players).where(eq(players.tournamentId, tournamentId));
  }

  async updatePlayer(id: number, player: Partial<Player>): Promise<Player | undefined> {
    const [updated] = await db
      .update(players)
      .set(player)
      .where(eq(players.id, id))
      .returning();
    return updated || undefined;
  }

  async deletePlayer(id: number): Promise<boolean> {
    const result = await db.delete(players).where(eq(players.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Match methods
  async createMatch(match: InsertMatch): Promise<Match> {
    const [result] = await db
      .insert(matches)
      .values({
        ...match,
        status: match.status || 'pending',
        result: match.result || null,
        board: match.board || null,
        whitePlayerId: match.whitePlayerId || null,
        blackPlayerId: match.blackPlayerId || null,
      })
      .returning();
    return result;
  }

  async getMatch(id: number): Promise<Match | undefined> {
    const [match] = await db.select().from(matches).where(eq(matches.id, id));
    return match || undefined;
  }

  async getMatchesByTournament(tournamentId: number): Promise<Match[]> {
    return await db.select().from(matches).where(eq(matches.tournamentId, tournamentId));
  }

  async getMatchesByRound(tournamentId: number, round: number): Promise<Match[]> {
    return await db.select()
      .from(matches)
      .where(and(eq(matches.tournamentId, tournamentId), eq(matches.round, round)));
  }

  async updateMatch(id: number, match: Partial<Match>): Promise<Match | undefined> {
    const [updated] = await db
      .update(matches)
      .set(match)
      .where(eq(matches.id, id))
      .returning();
    return updated || undefined;
  }

  // Pairing methods
  async createPairing(pairing: InsertPairing): Promise<Pairing> {
    const [result] = await db
      .insert(pairings)
      .values({
        ...pairing,
        color: pairing.color || null,
        points: pairing.points || 0,
        opponentId: pairing.opponentId || null,
        isBye: pairing.isBye || false,
      })
      .returning();
    return result;
  }

  async getPairingsByTournament(tournamentId: number): Promise<Pairing[]> {
    return await db.select().from(pairings).where(eq(pairings.tournamentId, tournamentId));
  }

  async getPairingsByRound(tournamentId: number, round: number): Promise<Pairing[]> {
    return await db.select()
      .from(pairings)
      .where(and(eq(pairings.tournamentId, tournamentId), eq(pairings.round, round)));
  }

  async updatePairing(id: number, pairing: Partial<Pairing>): Promise<Pairing | undefined> {
    const [updated] = await db
      .update(pairings)
      .set(pairing)
      .where(eq(pairings.id, id))
      .returning();
    return updated || undefined;
  }

  // Bye request methods
  async createByeRequest(byeRequest: InsertByeRequest): Promise<ByeRequest> {
    const [createdByeRequest] = await db
      .insert(byeRequests)
      .values(byeRequest)
      .returning();
    return createdByeRequest;
  }

  async getByeRequestsByTournament(tournamentId: number): Promise<ByeRequest[]> {
    return await db
      .select()
      .from(byeRequests)
      .where(eq(byeRequests.tournamentId, tournamentId));
  }

  async getByeRequestsByRound(tournamentId: number, round: number): Promise<ByeRequest[]> {
    return await db
      .select()
      .from(byeRequests)
      .where(
        and(
          eq(byeRequests.tournamentId, tournamentId),
          eq(byeRequests.round, round)
        )
      );
  }

  async updateByeRequest(id: number, byeRequest: Partial<ByeRequest>): Promise<ByeRequest | undefined> {
    const [updatedByeRequest] = await db
      .update(byeRequests)
      .set(byeRequest)
      .where(eq(byeRequests.id, id))
      .returning();
    return updatedByeRequest || undefined;
  }
}

export const storage = new DatabaseStorage();