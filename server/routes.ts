import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertTournamentSchema, 
  insertPlayerSchema, 
  insertMatchSchema 
} from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Tournament routes
  app.get("/api/tournaments", async (req, res) => {
    try {
      const tournaments = await storage.getAllTournaments();
      res.json(tournaments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tournaments" });
    }
  });

  app.post("/api/tournaments", async (req, res) => {
    try {
      const tournament = insertTournamentSchema.parse(req.body);
      const newTournament = await storage.createTournament(tournament);
      res.status(201).json(newTournament);
    } catch (error) {
      res.status(400).json({ message: "Invalid tournament data" });
    }
  });

  app.get("/api/tournaments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const tournament = await storage.getTournament(id);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      res.json(tournament);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tournament" });
    }
  });

  app.put("/api/tournaments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const tournament = await storage.updateTournament(id, req.body);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      res.json(tournament);
    } catch (error) {
      res.status(500).json({ message: "Failed to update tournament" });
    }
  });

  // Player routes
  app.get("/api/tournaments/:tournamentId/players", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const players = await storage.getPlayersByTournament(tournamentId);
      res.json(players);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch players" });
    }
  });

  app.post("/api/tournaments/:tournamentId/players", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const playerData = { ...req.body, tournamentId };
      const player = insertPlayerSchema.parse(playerData);
      const newPlayer = await storage.createPlayer(player);
      res.status(201).json(newPlayer);
    } catch (error) {
      res.status(400).json({ message: "Invalid player data" });
    }
  });

  app.delete("/api/players/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deletePlayer(id);
      if (!deleted) {
        return res.status(404).json({ message: "Player not found" });
      }
      res.status(200).json({ message: "Player deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete player" });
    }
  });

  // Match routes
  app.get("/api/tournaments/:tournamentId/matches", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const round = req.query.round ? parseInt(req.query.round as string) : undefined;
      
      const matches = round 
        ? await storage.getMatchesByRound(tournamentId, round)
        : await storage.getMatchesByTournament(tournamentId);
      
      res.json(matches);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch matches" });
    }
  });

  app.post("/api/tournaments/:tournamentId/matches", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const matchData = { ...req.body, tournamentId };
      const match = insertMatchSchema.parse(matchData);
      const newMatch = await storage.createMatch(match);
      res.status(201).json(newMatch);
    } catch (error) {
      res.status(400).json({ message: "Invalid match data" });
    }
  });

  app.put("/api/matches/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const match = await storage.updateMatch(id, req.body);
      if (!match) {
        return res.status(404).json({ message: "Match not found" });
      }
      res.json(match);
    } catch (error) {
      res.status(500).json({ message: "Failed to update match" });
    }
  });

  // Pairing routes
  app.get("/api/tournaments/:tournamentId/pairings", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const round = req.query.round ? parseInt(req.query.round as string) : undefined;
      
      const pairings = round 
        ? await storage.getPairingsByRound(tournamentId, round)
        : await storage.getPairingsByTournament(tournamentId);
      
      res.json(pairings);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch pairings" });
    }
  });

  app.post("/api/tournaments/:tournamentId/generate-pairings", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      const players = await storage.getPlayersByTournament(tournamentId);
      if (players.length < 2) {
        return res.status(400).json({ message: "At least 2 players required to generate pairings" });
      }

      // Determine the next round number
      const existingMatches = await storage.getMatchesByTournament(tournamentId);
      const currentRound = existingMatches.length > 0 ? 
        Math.max(...existingMatches.map(match => match.round)) + 1 : 1;
      
      // Generate pairings based on tournament format
      const pairings = await generatePairings(tournament, players, existingMatches, currentRound);
      
      // Save pairings to storage and create matches
      const savedPairings = await Promise.all(
        pairings.map(pairing => storage.createPairing(pairing))
      );

      // Create matches from Swiss pairings (not from the generic pairings)
      const swissPairings = generateSwissPairings(players, existingMatches, currentRound);
      const matches = await Promise.all(
        swissPairings.filter(p => !p.isBye).map(pairing => storage.createMatch({
          tournamentId: tournament.id,
          round: currentRound,
          board: pairing.board,
          whitePlayerId: pairing.whitePlayerId,
          blackPlayerId: pairing.blackPlayerId,
          result: null,
          status: 'pending'
        }))
      );
      
      res.json({ pairings: savedPairings, matches, round: currentRound });
    } catch (error) {
      console.error('Pairing generation error:', error);
      res.status(500).json({ message: "Failed to generate pairings", error: error.message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

async function generatePairings(tournament: any, players: any[], matches: any[], round: number) {
  const pairings = [];
  
  if (tournament.format === 'swiss') {
    // Use proper Swiss pairing algorithm
    const swissPairings = generateSwissPairings(players, matches, round);
    
    // Convert to our pairing format
    for (const pairing of swissPairings) {
      if (pairing.isBye) {
        // Handle bye
        pairings.push({
          tournamentId: tournament.id,
          round,
          playerId: pairing.whitePlayerId,
          opponentId: null,
          color: null,
          points: 1, // Full point for bye
          isBye: true,
        });
      } else {
        // Create pairing entries for both players
        pairings.push({
          tournamentId: tournament.id,
          round,
          playerId: pairing.whitePlayerId,
          opponentId: pairing.blackPlayerId,
          color: 'white',
          points: 0,
          isBye: false,
        });
        pairings.push({
          tournamentId: tournament.id,
          round,
          playerId: pairing.blackPlayerId,
          opponentId: pairing.whitePlayerId,
          color: 'black',
          points: 0,
          isBye: false,
        });
      }
    }
  } else if (tournament.format === 'round_robin') {
    // Round robin pairing - implement later
    // For now, use simple pairing
    for (let i = 0; i < players.length; i += 2) {
      if (i + 1 < players.length) {
        pairings.push({
          tournamentId: tournament.id,
          round,
          playerId: players[i].id,
          opponentId: players[i + 1].id,
          color: 'white',
          points: 0,
          isBye: false,
        });
        pairings.push({
          tournamentId: tournament.id,
          round,
          playerId: players[i + 1].id,
          opponentId: players[i].id,
          color: 'black',
          points: 0,
          isBye: false,
        });
      }
    }
  }
  
  return pairings;
}

function generateSwissPairings(players: any[], matches: any[], round: number) {
  // Server-side Swiss pairing implementation
  const pairings = [];
  
  if (round === 1) {
    // First round: sort by rating and pair upper half vs lower half
    const sortedPlayers = players.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    const n = sortedPlayers.length;
    const isOdd = n % 2 === 1;
    
    const mid = Math.ceil(n / 2);
    const upperHalf = sortedPlayers.slice(0, mid);
    const lowerHalf = sortedPlayers.slice(mid);
    
    const firstBoardWhiteIsUpper = Math.random() < 0.5;
    let boardNumber = 1;
    
    const pairsCount = Math.min(upperHalf.length, lowerHalf.length);
    
    for (let i = 0; i < pairsCount; i++) {
      const upperPlayer = upperHalf[i];
      const lowerPlayer = lowerHalf[i];
      
      const upperPlayerIsWhite = i === 0 ? firstBoardWhiteIsUpper : (i % 2 === 0) === firstBoardWhiteIsUpper;
      
      pairings.push({
        whitePlayerId: upperPlayerIsWhite ? upperPlayer.id : lowerPlayer.id,
        blackPlayerId: upperPlayerIsWhite ? lowerPlayer.id : upperPlayer.id,
        board: boardNumber++,
        isBye: false,
      });
    }
    
    if (isOdd) {
      const byePlayer = sortedPlayers[sortedPlayers.length - 1];
      const actualByePlayer = (byePlayer.rating === null || byePlayer.rating === undefined) && 
                             sortedPlayers.length > 1 ? 
                             sortedPlayers[sortedPlayers.length - 2] : byePlayer;
      
      pairings.push({
        whitePlayerId: actualByePlayer.id,
        blackPlayerId: null,
        board: boardNumber,
        isBye: true,
      });
    }
  } else {
    // Subsequent rounds: group by score and pair within groups
    const playerStats = calculatePlayerStats(players, matches);
    const sortedPlayers = playerStats.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return (b.player.rating || 0) - (a.player.rating || 0);
    });
    
    const unpaired = [...sortedPlayers];
    let boardNumber = 1;
    
    while (unpaired.length > 1) {
      const player1 = unpaired.shift()!;
      
      // Find best opponent (avoid repeat pairings)
      let opponentIndex = -1;
      for (let i = 0; i < unpaired.length; i++) {
        const candidate = unpaired[i];
        if (!havePlayed(player1.player.id, candidate.player.id, matches)) {
          opponentIndex = i;
          break;
        }
      }
      
      if (opponentIndex === -1 && unpaired.length > 0) {
        opponentIndex = 0; // No choice but to repeat
      }
      
      if (opponentIndex >= 0) {
        const player2 = unpaired.splice(opponentIndex, 1)[0];
        
        // Determine colors based on balance
        const p1Balance = player1.colorBalance;
        const p2Balance = player2.colorBalance;
        
        let player1IsWhite = true;
        if (p1Balance < p2Balance) {
          player1IsWhite = true; // Player 1 needs white more
        } else if (p2Balance < p1Balance) {
          player1IsWhite = false; // Player 2 needs white more
        } else {
          // Equal balance, use rating
          player1IsWhite = (player1.player.rating || 0) >= (player2.player.rating || 0);
        }
        
        pairings.push({
          whitePlayerId: player1IsWhite ? player1.player.id : player2.player.id,
          blackPlayerId: player1IsWhite ? player2.player.id : player1.player.id,
          board: boardNumber++,
          isBye: false,
        });
      }
    }
    
    if (unpaired.length === 1) {
      pairings.push({
        whitePlayerId: unpaired[0].player.id,
        blackPlayerId: null,
        board: boardNumber,
        isBye: true,
      });
    }
  }
  
  return pairings;
}

function calculatePlayerStats(players: any[], matches: any[]) {
  return players.map(player => {
    const playerMatches = matches.filter(
      match => match.whitePlayerId === player.id || match.blackPlayerId === player.id
    );

    let points = 0;
    let whiteGames = 0;
    let blackGames = 0;

    playerMatches.forEach(match => {
      if (!match.result) return;

      const isWhite = match.whitePlayerId === player.id;
      
      if (isWhite) whiteGames++;
      else blackGames++;

      if (match.result === '1-0') {
        points += isWhite ? 1 : 0;
      } else if (match.result === '0-1') {
        points += isWhite ? 0 : 1;
      } else if (match.result === '1/2-1/2') {
        points += 0.5;
      }
    });

    return {
      player,
      points,
      whiteGames,
      blackGames,
      colorBalance: whiteGames - blackGames,
    };
  });
}

function havePlayed(playerId1: number, playerId2: number, matches: any[]): boolean {
  return matches.some(match => 
    (match.whitePlayerId === playerId1 && match.blackPlayerId === playerId2) ||
    (match.whitePlayerId === playerId2 && match.blackPlayerId === playerId1)
  );
}
