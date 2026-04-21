import { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireRole, requireTournamentAccess } from "../auth";
import { z } from "zod";
import { pairPool, startAutoPairingLoop, stopAutoPairingLoop } from "../lib/arenaPairing";

export function applyArenaRoutes(app: Router) {
  // DEBUG: Force-run pairing pool and return trace (no auth for testing)
  app.post("/api/tournaments/:id/arena/debug-pair", async (req, res) => {
    const tournamentId = parseInt(req.params.id);
    const trace: string[] = [];
    try {
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) return res.json({ error: "Tournament not found" });
      
      trace.push(`status: ${tournament.status}`);
      trace.push(`format: ${tournament.format}`);
      trace.push(`arenaPairingMode: ${tournament.arenaPairingMode}`);
      trace.push(`arenaStartTime raw: ${tournament.arenaStartTime}`);
      trace.push(`arenaDuration: ${tournament.arenaDuration}`);
      trace.push(`arenaCutoffMinutes: ${tournament.arenaCutoffMinutes}`);

      if (tournament.arenaStartTime && tournament.arenaDuration) {
        const rawStart = String(tournament.arenaStartTime);
        const isoStart = rawStart.endsWith('Z') ? rawStart : `${rawStart}Z`;
        const startTs = new Date(isoStart);
        const endTime = new Date(startTs.getTime() + tournament.arenaDuration * 60000);
        const cutoffTime = new Date(endTime.getTime() - (tournament.arenaCutoffMinutes || 2) * 60000);
        const now = new Date();
        trace.push(`parsedStart (UTC): ${startTs.toISOString()}`);
        trace.push(`endTime: ${endTime.toISOString()}`);
        trace.push(`cutoffTime: ${cutoffTime.toISOString()}`);
        trace.push(`now: ${now.toISOString()}`);
        trace.push(`inCutoff: ${now > cutoffTime}`);
        trace.push(`expired: ${now > endTime}`);
        trace.push(`started: ${now > startTs}`);
        if (now > cutoffTime) {
          return res.json({ trace, blocked: "CUTOFF_WINDOW_ACTIVE" });
        }
      }

      const allPlayers = await storage.getPlayersByTournament(tournamentId);
      const lobbyPlayers = allPlayers.filter((p: any) => p.arenaStatus === 'lobby');
      trace.push(`totalPlayers: ${allPlayers.length}`);
      trace.push(`lobbyPlayers: ${lobbyPlayers.length}`);
      trace.push(`playerArenaStatuses: ${JSON.stringify(allPlayers.map((p: any) => ({ id: p.id, arenaStatus: p.arenaStatus })))}`);

      if (lobbyPlayers.length < 2) {
        return res.json({ trace, blocked: "NOT_ENOUGH_LOBBY_PLAYERS" });
      }

      // Force a pair directly
      const p1 = lobbyPlayers[0] as any;
      const p2 = lobbyPlayers[1] as any;
      trace.push(`Attempting to pair ${p1.firstName}(${p1.id}) vs ${p2.firstName}(${p2.id})`);
      
      const match = await storage.createMatch({
        tournamentId,
        round: 1,
        whitePlayerId: p1.id,
        blackPlayerId: p2.id,
        status: 'playing',
      });
      trace.push(`Match created: ID ${match.id}`);

      await storage.updatePlayer(p1.id, { arenaStatus: 'playing' });
      await storage.updatePlayer(p2.id, { arenaStatus: 'playing' });
      trace.push(`Players set to playing`);

      return res.json({ trace, success: true, match });
    } catch (err: any) {
      trace.push(`ERROR: ${err.message}`);
      trace.push(`STACK: ${err.stack}`);
      return res.json({ trace, error: err.message });
    }
  });

  // Get arena lobby players
  app.get("/api/tournaments/:id/arena/lobby", requireAuth, requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const tournament = await storage.getTournament(tournamentId);

      // Self-healing: Ensure auto-pairing loop is running if tournament is active and automatic
      if (tournament?.status === 'active' && tournament.arenaPairingMode === 'automatic') {
        startAutoPairingLoop(tournamentId);
      }

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
      
      // If resuming to lobby, trigger auto-pairing
      if (status === 'lobby' && tournament) {
        pairPool(tournamentId, tournament);
      }

      res.json(updatedPlayer);
    } catch (error) {
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  // Start Arena
  app.post("/api/tournaments/:id/arena/start", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      
      const countdown = tournament.arenaCountdownSeconds || 10;
      // Strip 'Z' to prevent PostgREST from applying the Postgres server's timezone offset
      // This ensures the literal UTC time is stored directly into the TIMESTAMP WITHOUT TIME ZONE column
      const startTimeISO = new Date(Date.now() + countdown * 1000).toISOString();
      const startTimeStr = startTimeISO.replace('Z', '');
      
      // Cleanup any active matches from a previous run
      const existingMatches = await storage.getMatchesByTournament(tournamentId);
      for (const m of existingMatches) {
        if (m.status === 'playing' || m.status === 'pending' || m.status === 'in_progress') {
          await storage.updateMatch(m.id, { status: 'completed', result: '*' });
        }
      }

      // Initialize player arena states
      await storage.initializeArenaPlayers(tournamentId);

      // Strip 'Z' to match the TIMESTAMP WITHOUT TIME ZONE column — same fix applied to startTimeStr above
      const arenaStartTimeStr = new Date().toISOString().replace('Z', '');
      const updated = await storage.updateTournament(tournamentId, { 
        status: 'active', 
        arenaPairingMode: 'automatic',
        arenaStartTime: arenaStartTimeStr
      });

      console.log(`[ArenaRoute] Tournament ${tournamentId} activated. Triggering first pairing pass...`);

      try {
        // Use the updated object directly to avoid any stale data fetch
        if (updated && updated.arenaPairingMode === 'automatic') {
          await pairPool(tournamentId, updated);
          startAutoPairingLoop(tournamentId);
        }
      } catch (pairErr) {
        console.error(`[ArenaRoute] Error during initial pairing for T${tournamentId}:`, pairErr);
      }

      res.json({ arenaStartTime: startTimeStr });
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

  // Toggle Pairing Mode
  app.patch("/api/tournaments/:id/arena/pairing-mode", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const { mode } = req.body;
      
      const updatedTournament = await storage.updateTournament(tournamentId, {
        arenaPairingMode: mode
      });
      
      if (mode === 'automatic' && updatedTournament) {
        pairPool(tournamentId, updatedTournament);
      }
      
      res.json({ arenaPairingMode: mode });
    } catch (error) {
      res.status(500).json({ message: "Failed to update pairing mode" });
    }
  });

  // Update Cutoff Window
  app.patch("/api/tournaments/:id/arena/cutoff", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const { minutes } = req.body;
      
      await storage.updateTournament(tournamentId, {
        arenaCutoffMinutes: minutes
      });
      
      res.json({ arenaCutoffMinutes: minutes });
    } catch (error) {
      res.status(500).json({ message: "Failed to update cutoff window" });
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

      // Trigger auto-pairing for the pool
      if (tournament) {
        pairPool(tournamentId, tournament);
      }

      // Check if tournament should conclude
      if (tournament?.status === 'active' && tournament.arenaStartTime && tournament.arenaDuration) {
        const endTime = new Date(new Date(tournament.arenaStartTime).getTime() + tournament.arenaDuration * 60000);
        if (new Date() > endTime) {
          const strategy = tournament.arenaEndStrategy || "wait_for_ongoing";
          
          if (strategy === 'force_end') {
            stopAutoPairingLoop(tournamentId);
            await storage.updateTournament(tournamentId, { status: 'completed' });
          } else {
            // wait_for_ongoing: check if this was the last match
            const matches = await storage.getMatchesByTournament(tournamentId);
            const activeMatches = matches.filter(m => (m.status === 'playing' || m.status === 'in_progress') && m.id !== matchId);
            if (activeMatches.length === 0) {
              stopAutoPairingLoop(tournamentId);
              await storage.updateTournament(tournamentId, { status: 'completed' });
            }
          }
        }
      }

      res.json({ message: "Result updated" });
    } catch (error) {
      res.status(500).json({ message: "Failed to update match result" });
    }
  });

  // Explicitly conclude Arena
  app.post("/api/tournaments/:id/arena/conclude", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      stopAutoPairingLoop(tournamentId);
      await storage.updateTournament(tournamentId, { status: 'completed' });
      res.json({ status: 'completed' });
    } catch (error) {
      res.status(500).json({ message: "Failed to conclude tournament" });
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
