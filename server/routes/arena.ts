import { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, requireTournamentAccess } from "../auth";
import { z } from "zod";

export function applyArenaRoutes(app: Router) {
  // Get arena lobby players
  app.get("/api/tournaments/:id/arena/lobby", requireAuth, requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const players = await storage.getArenaLobbyPlayers(tournamentId);
      res.json(players);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch lobby players" });
    }
  });

  // Update player arena status (pause/resume)
  app.post("/api/tournaments/:id/arena/status", requireAuth, async (req, res) => {
    try {
      const { playerId, status } = req.body; // status: 'lobby' or 'paused'
      
      // If tournament is over, don't allow resuming
      const tournamentId = parseInt(req.params.id);
      const tournament = await storage.getTournament(tournamentId);
      if (status === 'lobby' && tournament?.arenaStartTime && tournament.arenaDuration) {
        const endTime = new Date(new Date(tournament.arenaStartTime).getTime() + tournament.arenaDuration * 60000);
        if (new Date() > endTime) {
          return res.status(403).json({ message: "Arena has ended" });
        }
      }

      const updatedPlayer = await storage.setPlayerArenaStatus(playerId, status);
      res.json(updatedPlayer);
    } catch (error) {
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  // Start Arena
  app.post("/api/tournaments/:id/arena/start", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const startTime = new Date();
      
      // Initialize player arena states
      await storage.initializeArenaPlayers(tournamentId);

      await storage.updateTournament(tournamentId, {
        arenaStartTime: startTime,
        arenaStatus: 'active',
        status: 'active'
      });
      
      res.json({ arenaStartTime: startTime });
    } catch (error) {
      res.status(500).json({ message: "Failed to start arena" });
    }
  });

  // Update Arena Settings
  app.post("/api/tournaments/:id/arena/settings", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const { duration, scoringConfig } = req.body;
      
      await storage.updateTournament(tournamentId, {
        arenaDuration: duration,
        arenaScoringConfig: scoringConfig
      });
      
      res.json({ message: "Settings updated" });
    } catch (error) {
      res.status(500).json({ message: "Failed to update settings" });
    }
  });

  // Manual pairing
  app.post("/api/tournaments/:id/arena/pair", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const { whitePlayerId, blackPlayerId } = req.body;

      // 0. Check if tournament is active and not expired
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament || tournament.status !== 'active' || !tournament.arenaStartTime) {
        return res.status(400).json({ message: "Tournament is not active" });
      }

      if (tournament.arenaDuration) {
        const endTime = new Date(new Date(tournament.arenaStartTime).getTime() + tournament.arenaDuration * 60000);
        if (new Date() > endTime) {
          return res.status(403).json({ message: "Arena has ended. No new pairings allowed." });
        }
      }

      // 1. Create the match
      const match = await storage.createMatch({
        tournamentId,
        round: 1, 
        whitePlayerId,
        blackPlayerId,
        status: 'playing',
      });

      // 2. Set players status to 'playing'
      await storage.setPlayerArenaStatus(whitePlayerId, 'playing');
      await storage.setPlayerArenaStatus(blackPlayerId, 'playing');

      // 3. Notify players
      const whitePlayer = await storage.getPlayer(whitePlayerId);
      const blackPlayer = await storage.getPlayer(blackPlayerId);

      if (whitePlayer?.userId) {
        await storage.createNotification({
          userId: whitePlayer.userId,
          title: "Match Started!",
          message: `You have been paired against ${blackPlayer?.firstName} ${blackPlayer?.lastName}. You are White.`,
          type: "pairing",
          meta: { matchId: match.id, tournamentId }
        });
      }

      if (blackPlayer?.userId) {
        await storage.createNotification({
          userId: blackPlayer.userId,
          title: "Match Started!",
          message: `You have been paired against ${whitePlayer?.firstName} ${whitePlayer?.lastName}. You are Black.`,
          type: "pairing",
          meta: { matchId: match.id, tournamentId }
        });
      }

      res.status(201).json(match);
    } catch (error) {
      res.status(500).json({ message: "Failed to pair players" });
    }
  });

  // Submit Arena Match Result
  app.post("/api/tournaments/:id/arena/results", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const { matchId, result } = req.body; // result: '1-0', '0-1', '1/2-1/2'
      
      const match = await storage.getMatch(matchId);
      if (!match) return res.status(404).json({ message: "Match not found" });

      // Update match status
      await storage.updateMatch(matchId, { result, status: 'completed' });

      const whiteId = match.whitePlayerId!;
      const blackId = match.blackPlayerId!;

      const white = await storage.getPlayer(whiteId);
      const black = await storage.getPlayer(blackId);

      if (!white || !black) return res.status(404).json({ message: "Players not found" });

      // Scoring Logic
      const tournamentId = parseInt(req.params.id);
      const tournament = await storage.getTournament(tournamentId);
      const scoring = (tournament?.arenaScoringConfig as any) || {
        winPoints: 2,
        drawPoints: 1,
        lossPoints: 0,
        streakThreshold: 2,
        onFireWinPoints: 4,
        onFireDrawPoints: 2
      };

      const processPlayerResult = (player: any, score: number) => {
        let points = parseFloat(player.arenaPoints || "0");
        let streak = player.arenaStreak || 0;
        let onFire = player.onFire || false;

        const threshold = scoring.streakThreshold || 2;

        if (score === 1) { // Win
          const winPoints = onFire ? (scoring.onFireWinPoints || 4) : (scoring.winPoints || 2);
          points += winPoints;
          streak += 1;
          if (streak >= threshold) onFire = true;
        } else if (score === 0.5) { // Draw
          const drawPoints = onFire ? (scoring.onFireDrawPoints || 2) : (scoring.drawPoints || 1);
          points += drawPoints;
          streak = 0;
          onFire = false;
        } else { // Loss
          points += (scoring.lossPoints || 0);
          streak = 0;
          onFire = false;
        }

        return { points: points.toFixed(1), streak, onFire };
      };

      let whiteScore = 0, blackScore = 0;
      if (result === '1-0') whiteScore = 1;
      else if (result === '0-1') blackScore = 1;
      else { whiteScore = 0.5; blackScore = 0.5; }

      const whiteUpdate = processPlayerResult(white, whiteScore);
      const blackUpdate = processPlayerResult(black, blackScore);

      await storage.updateArenaPoints(whiteId, whiteUpdate.points, whiteUpdate.streak, whiteUpdate.onFire);
      await storage.updateArenaPoints(blackId, blackUpdate.points, blackUpdate.streak, blackUpdate.onFire);

      // Return players to lobby
      await storage.setPlayerArenaStatus(whiteId, 'lobby');
      await storage.setPlayerArenaStatus(blackId, 'lobby');

      res.json({ message: "Result updated" });
    } catch (error) {
      res.status(500).json({ message: "Failed to update match result" });
    }
  });

  // Get Standings
  app.get("/api/tournaments/:id/arena/standings", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const players = await storage.getPlayersByTournament(tournamentId);
      const standings = players.sort((a, b) => parseFloat(b.arenaPoints || "0") - parseFloat(a.arenaPoints || "0"));
      res.json(standings);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch standings" });
    }
  });
}
