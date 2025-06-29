import { 
  tournaments, 
  players, 
  matches, 
  pairings,
  type Tournament, 
  type InsertTournament,
  type Player,
  type InsertPlayer,
  type Match,
  type InsertMatch,
  type Pairing,
  type InsertPairing
} from "@shared/schema";

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
}

export class MemStorage implements IStorage {
  private tournaments: Map<number, Tournament> = new Map();
  private players: Map<number, Player> = new Map();
  private matches: Map<number, Match> = new Map();
  private pairings: Map<number, Pairing> = new Map();
  private currentTournamentId = 1;
  private currentPlayerId = 1;
  private currentMatchId = 1;
  private currentPairingId = 1;

  // Tournament methods
  async createTournament(tournament: InsertTournament): Promise<Tournament> {
    const id = this.currentTournamentId++;
    const newTournament: Tournament = { 
      ...tournament, 
      id,
      status: tournament.status || 'draft',
      currentRound: tournament.currentRound || 0,
      isDoubleRoundRobin: tournament.isDoubleRoundRobin || false,
      useQuickSetup: tournament.useQuickSetup || false,
      rounds: tournament.rounds || null,
      timeControl: tournament.timeControl || null,
      playerCount: tournament.playerCount || null,
    };
    this.tournaments.set(id, newTournament);
    return newTournament;
  }

  async getTournament(id: number): Promise<Tournament | undefined> {
    return this.tournaments.get(id);
  }

  async getAllTournaments(): Promise<Tournament[]> {
    return Array.from(this.tournaments.values());
  }

  async updateTournament(id: number, tournament: Partial<Tournament>): Promise<Tournament | undefined> {
    const existing = this.tournaments.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...tournament };
    this.tournaments.set(id, updated);
    return updated;
  }

  async deleteTournament(id: number): Promise<boolean> {
    return this.tournaments.delete(id);
  }

  // Player methods
  async createPlayer(player: InsertPlayer): Promise<Player> {
    const id = this.currentPlayerId++;
    const playersInTournament = Array.from(this.players.values())
      .filter(p => p.tournamentId === player.tournamentId);
    const seed = playersInTournament.length + 1;
    
    const newPlayer: Player = { 
      ...player, 
      id, 
      seed,
      rating: player.rating || 1000,
      federation: player.federation || 'USCF',
    };
    this.players.set(id, newPlayer);
    return newPlayer;
  }

  async getPlayer(id: number): Promise<Player | undefined> {
    return this.players.get(id);
  }

  async getPlayersByTournament(tournamentId: number): Promise<Player[]> {
    return Array.from(this.players.values())
      .filter(player => player.tournamentId === tournamentId)
      .sort((a, b) => (a.seed || 0) - (b.seed || 0));
  }

  async updatePlayer(id: number, player: Partial<Player>): Promise<Player | undefined> {
    const existing = this.players.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...player };
    this.players.set(id, updated);
    return updated;
  }

  async deletePlayer(id: number): Promise<boolean> {
    return this.players.delete(id);
  }

  // Match methods
  async createMatch(match: InsertMatch): Promise<Match> {
    const id = this.currentMatchId++;
    const newMatch: Match = { 
      ...match, 
      id,
      status: match.status || 'pending',
      result: match.result || null,
      board: match.board || null,
      whitePlayerId: match.whitePlayerId || null,
      blackPlayerId: match.blackPlayerId || null,
    };
    this.matches.set(id, newMatch);
    return newMatch;
  }

  async getMatch(id: number): Promise<Match | undefined> {
    return this.matches.get(id);
  }

  async getMatchesByTournament(tournamentId: number): Promise<Match[]> {
    return Array.from(this.matches.values())
      .filter(match => match.tournamentId === tournamentId);
  }

  async getMatchesByRound(tournamentId: number, round: number): Promise<Match[]> {
    return Array.from(this.matches.values())
      .filter(match => match.tournamentId === tournamentId && match.round === round)
      .sort((a, b) => (a.board || 0) - (b.board || 0));
  }

  async updateMatch(id: number, match: Partial<Match>): Promise<Match | undefined> {
    const existing = this.matches.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...match };
    this.matches.set(id, updated);
    return updated;
  }

  // Pairing methods
  async createPairing(pairing: InsertPairing): Promise<Pairing> {
    const id = this.currentPairingId++;
    const newPairing: Pairing = { 
      ...pairing, 
      id,
      color: pairing.color || null,
      points: pairing.points || 0,
      opponentId: pairing.opponentId || null,
      isBye: pairing.isBye || false,
    };
    this.pairings.set(id, newPairing);
    return newPairing;
  }

  async getPairingsByTournament(tournamentId: number): Promise<Pairing[]> {
    return Array.from(this.pairings.values())
      .filter(pairing => pairing.tournamentId === tournamentId);
  }

  async getPairingsByRound(tournamentId: number, round: number): Promise<Pairing[]> {
    return Array.from(this.pairings.values())
      .filter(pairing => pairing.tournamentId === tournamentId && pairing.round === round);
  }

  async updatePairing(id: number, pairing: Partial<Pairing>): Promise<Pairing | undefined> {
    const existing = this.pairings.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...pairing };
    this.pairings.set(id, updated);
    return updated;
  }
}

export const storage = new MemStorage();
