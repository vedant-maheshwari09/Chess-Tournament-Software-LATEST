import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { 
  insertTournamentSchema, 
  insertPlayerSchema, 
  insertMatchSchema,
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  forgotUsernameSchema,
  resetPasswordSchema
} from "@shared/schema";
import { 
  hashPassword, 
  verifyPassword, 
  createSession, 
  requireAuth, 
  requireRole, 
  requireTournamentAccess,
  generateSessionToken
} from "./auth";

export async function registerRoutes(app: Express): Promise<Server> {
  // Authentication routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const userData = registerSchema.parse(req.body);
      
      // Check if username already exists
      const existingUsername = await storage.getUserByUsername(userData.username);
      if (existingUsername) {
        return res.status(400).json({ 
          message: "This username is already taken. Please choose a different username." 
        });
      }
      
      // Check if email already exists
      const existingEmail = await storage.getUserByEmail(userData.email);
      if (existingEmail) {
        return res.status(400).json({ 
          message: "An account with this email already exists. Please use a different email or try logging in." 
        });
      }
      
      // Hash password and create user
      const passwordHash = await hashPassword(userData.password);
      const newUser = await storage.createUser({
        ...userData,
        passwordHash,
      });
      
      // Create session
      const session = await createSession(newUser.id);
      
      // Return user info and token (excluding password hash)
      const { passwordHash: _, ...userWithoutPassword } = newUser;
      res.status(201).json({ 
        user: userWithoutPassword, 
        token: session.token 
      });
    } catch (error) {
      console.error('Registration error:', error);
      
      // Handle database constraint violations
      if (error instanceof Error && error.message.includes('unique constraint')) {
        if (error.message.includes('username')) {
          return res.status(400).json({ 
            message: "This username is already taken. Please choose a different username." 
          });
        } else if (error.message.includes('email')) {
          return res.status(400).json({ 
            message: "An account with this email already exists. Please use a different email or try logging in." 
          });
        }
      }
      
      res.status(400).json({ message: "Invalid registration data" });
    }
  });

  // Check username availability
  app.get("/api/auth/check-username/:username", async (req, res) => {
    try {
      const { username } = req.params;
      
      if (!username || username.length < 3) {
        return res.json({ available: false, message: "Username must be at least 3 characters" });
      }
      
      const existingUser = await storage.getUserByUsername(username);
      
      if (existingUser) {
        res.json({ available: false, message: "Username is already taken" });
      } else {
        res.json({ available: true, message: "Username is available" });
      }
    } catch (error) {
      console.error('Username check error:', error);
      res.json({ available: false, message: "Error checking username" });
    }
  });

  // Check email availability  
  app.get("/api/auth/check-email/:email", async (req, res) => {
    try {
      const { email } = req.params;
      
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.json({ available: false, message: "Please enter a valid email address" });
      }
      
      const existingUser = await storage.getUserByEmail(email);
      
      if (existingUser) {
        res.json({ available: false, message: "Email is already registered" });
      } else {
        res.json({ available: true, message: "Email is available" });
      }
    } catch (error) {
      console.error('Email check error:', error);
      res.json({ available: false, message: "Error checking email" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = loginSchema.parse(req.body);
      
      // Find user by username
      const user = await storage.getUserByUsername(username);
      
      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }
      
      // Verify password
      const isValidPassword = await verifyPassword(password, user.passwordHash);
      
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid username or password" });
      }
      
      // Create session
      const session = await createSession(user.id);
      
      // Return user info and token (excluding password hash)
      const { passwordHash: _, ...userWithoutPassword } = user;
      res.json({ 
        user: userWithoutPassword, 
        token: session.token 
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(400).json({ message: "Invalid login data" });
    }
  });

  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    try {
      const session = (req as any).session;
      await storage.deleteSession(session.token);
      res.json({ message: "Logged out successfully" });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ message: "Logout failed" });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      const user = (req as any).user;
      const { passwordHash: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ message: "Failed to get user info" });
    }
  });

  // Forgot password routes
  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      
      // Find user by email
      const user = await storage.getUserByEmail(email);
      
      if (!user) {
        // Don't reveal if email exists for security
        return res.json({ message: "If the email exists, a reset link will be sent." });
      }
      
      // Generate reset token (expires in 1 hour)
      const resetToken = generateSessionToken();
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);
      
      await storage.createPasswordReset(user.id, resetToken, expiresAt);
      
      // In a real app, you'd send an email here
      // For now, we'll return the token (in production, never do this!)
      console.log(`Password reset token for ${email}: ${resetToken}`);
      
      res.json({ 
        message: "If the email exists, a reset link will be sent.",
        // Remove this in production - only for demo
        resetToken: resetToken
      });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(400).json({ message: "Invalid request" });
    }
  });

  app.post("/api/auth/forgot-username", async (req, res) => {
    try {
      const { email } = forgotUsernameSchema.parse(req.body);
      
      // Find user by email
      const user = await storage.getUserByEmail(email);
      
      if (!user) {
        // Don't reveal if email exists for security
        return res.json({ message: "If the email exists, the username will be sent." });
      }
      
      // In a real app, you'd send an email here
      // For now, we'll return the username (in production, never do this!)
      console.log(`Username for ${email}: ${user.username}`);
      
      res.json({ 
        message: "If the email exists, the username will be sent.",
        // Remove this in production - only for demo
        username: user.username
      });
    } catch (error) {
      console.error('Forgot username error:', error);
      res.status(400).json({ message: "Invalid request" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const { token, newPassword } = resetPasswordSchema.parse(req.body);
      
      // Find password reset record
      const passwordReset = await storage.getPasswordResetByToken(token);
      
      if (!passwordReset || passwordReset.used || new Date() > passwordReset.expiresAt) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }
      
      // Hash new password and update user
      const passwordHash = await hashPassword(newPassword);
      await storage.updateUser(passwordReset.userId, { passwordHash });
      
      // Mark reset token as used
      await storage.usePasswordReset(token);
      
      res.json({ message: "Password reset successfully" });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(400).json({ message: "Invalid request" });
    }
  });

  // Tournament routes (role-specific access)
  
  // Get all live tournaments (for players to view)
  app.get("/api/tournaments", async (req, res) => {
    try {
      const tournaments = await storage.getAllTournaments();
      // Filter to only show active tournaments for general viewing
      const liveTournaments = tournaments.filter(t => t.status === 'active');
      res.json(liveTournaments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tournaments" });
    }
  });

  // Get tournaments for a specific tournament director (protected)
  app.get("/api/my-tournaments", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const user = (req as any).user;
      const tournaments = await storage.getTournamentsByUser(user.id);
      res.json(tournaments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch your tournaments" });
    }
  });

  // Create tournament (tournament directors only)
  app.post("/api/tournaments", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const user = (req as any).user;
      console.log('Creating tournament - user:', user.id);
      console.log('Tournament data received:', req.body);
      
      const tournamentData = insertTournamentSchema.parse(req.body);
      console.log('Parsed tournament data:', tournamentData);
      
      // Add the creator's user ID
      const tournamentWithCreator = {
        ...tournamentData,
        createdBy: user.id,
      };
      console.log('Tournament with creator:', tournamentWithCreator);
      
      const newTournament = await storage.createTournament(tournamentWithCreator);
      console.log('Created tournament:', newTournament);
      res.status(201).json(newTournament);
    } catch (error) {
      console.error('Tournament creation error:', error);
      if (error instanceof Error) {
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
      }
      res.status(400).json({ 
        message: "Failed to create tournament. Please try again.",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
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

  // Start tournament
  app.post("/api/tournaments/:id/start", requireAuth, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const tournament = await storage.getTournament(tournamentId);
      
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      
      if (tournament.status !== 'draft') {
        return res.status(400).json({ message: "Tournament is already started" });
      }
      
      const players = await storage.getPlayersByTournament(tournamentId);
      if (players.length < 2) {
        return res.status(400).json({ message: "Need at least 2 players to start tournament" });
      }
      
      // Update tournament status and set current round to 1
      const updatedTournament = await storage.updateTournament(tournamentId, {
        status: 'active',
        currentRound: 1
      });
      
      // Generate first round pairings
      await generatePairings(tournament, players, [], 1);
      
      res.json(updatedTournament);
    } catch (error) {
      console.error('Start tournament error:', error);
      res.status(500).json({ message: "Failed to start tournament" });
    }
  });

  // Generate next round
  app.post("/api/tournaments/:id/next-round", requireAuth, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const tournament = await storage.getTournament(tournamentId);
      
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      
      if (tournament.status !== 'active') {
        return res.status(400).json({ message: "Tournament is not active" });
      }
      
      const nextRound = (tournament.currentRound || 0) + 1;
      
      if (tournament.rounds && nextRound > tournament.rounds) {
        return res.status(400).json({ message: "Tournament is complete" });
      }
      
      const players = await storage.getPlayersByTournament(tournamentId);
      const matches = await storage.getMatchesByTournament(tournamentId);
      
      // Check if current round is complete
      const currentRoundMatches = matches.filter(m => m.round === tournament.currentRound);
      const incompleteMatches = currentRoundMatches.filter(m => !m.result);
      
      if (incompleteMatches.length > 0) {
        return res.status(400).json({ 
          message: `Please complete all matches in round ${tournament.currentRound} before generating next round` 
        });
      }
      
      // Update tournament to next round
      const updatedTournament = await storage.updateTournament(tournamentId, {
        currentRound: nextRound
      });
      
      // Generate next round pairings
      await generatePairings(tournament, players, matches, nextRound);
      
      res.json(updatedTournament);
    } catch (error) {
      console.error('Next round error:', error);
      res.status(500).json({ message: "Failed to generate next round" });
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

  // Delete tournament
  app.delete("/api/tournaments/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteTournament(id);
      if (!deleted) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      res.status(200).json({ message: "Tournament deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete tournament" });
    }
  });

  // Finish tournament (tournament directors only)
  app.post("/api/tournaments/:id/finish", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      
      // Update tournament status to completed
      const completedTournament = await storage.updateTournament(id, { 
        status: 'completed',
        updatedAt: new Date()
      });
      
      if (!completedTournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      
      res.json({ 
        message: "Tournament finished successfully", 
        tournament: completedTournament 
      });
    } catch (error) {
      console.error('Finish tournament error:', error);
      res.status(500).json({ message: "Failed to finish tournament" });
    }
  });

  // Tournament history routes (tournament directors only)
  app.get("/api/tournaments/:id/history", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const history = await storage.getTournamentHistory(id);
      res.json(history);
    } catch (error) {
      console.error('Get tournament history error:', error);
      res.status(500).json({ message: "Failed to fetch tournament history" });
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
      const { byeConfiguration, ...playerFields } = req.body;
      const playerData = { ...playerFields, tournamentId };
      const player = insertPlayerSchema.parse(playerData);
      const newPlayer = await storage.createPlayer(player);
      
      // Create bye pairings if specified
      if (byeConfiguration && Array.isArray(byeConfiguration) && byeConfiguration.length > 0) {
        for (const byeEntry of byeConfiguration) {
          // Store points as integer: 0 = 0 points, 1 = 0.5 points, 2 = 1 point
          const pointsPerBye = byeEntry.type === "half_point" ? 1 : 0;
          
          await storage.createPairing({
            tournamentId,
            round: byeEntry.round,
            playerId: newPlayer.id,
            opponentId: null,
            color: null,
            points: pointsPerBye,
            isBye: true,
            byeType: byeEntry.type
          });
        }
      }
      
      res.status(201).json(newPlayer);
    } catch (error) {
      console.error('Player creation error:', error);
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

  // Delete individual pairing (for removing specific bye requests)
  app.delete("/api/pairings/:id", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const pairingId = parseInt(req.params.id);
      
      // Find the pairing across all user's tournaments to verify ownership
      const tournaments = await storage.getTournamentsByUser((req as any).user.id);
      let targetPairing = null;
      
      for (const tournament of tournaments) {
        const tournamentPairings = await storage.getPairingsByTournament(tournament.id);
        targetPairing = tournamentPairings.find(p => p.id === pairingId);
        if (targetPairing) break;
      }
      
      if (!targetPairing) {
        return res.status(404).json({ message: "Pairing not found or access denied" });
      }
      
      const deleted = await storage.deletePairing(pairingId);
      if (!deleted) {
        return res.status(404).json({ message: "Failed to delete pairing" });
      }
      
      res.json({ message: "Bye request removed successfully" });
    } catch (error) {
      console.error('Pairing deletion error:', error);
      res.status(500).json({ message: "Failed to remove bye request" });
    }
  });

  // Update player status (for mid-tournament withdrawals and bye requests)
  app.put("/api/players/:id/status", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const playerId = parseInt(req.params.id);
      const { status, byeRounds } = req.body;
      console.log(`Player ${playerId} status update request:`, { status, byeRounds });
      
      // Get player to find tournament ID for access control
      const player = await storage.getPlayer(playerId);
      if (!player) {
        return res.status(404).json({ message: "Player not found" });
      }
      
      // Validate tournament access
      const tournament = await storage.getTournament(player.tournamentId);
      if (!tournament || tournament.createdBy !== (req as any).user.id) {
        return res.status(403).json({ message: "Access denied" });
      }
      
      // Get current round to determine future rounds
      const currentMatches = await storage.getMatchesByTournament(player.tournamentId);
      const currentRound = currentMatches.length > 0 ? Math.max(...currentMatches.map(m => m.round)) : 0;
      
      // Get current player status from existing byes (only system-assigned withdrawal byes)
      const allPairings = await storage.getPairingsByTournament(player.tournamentId);
      const currentPlayerByes = allPairings.filter(p => p.playerId === playerId && p.isBye);
      const currentWithdrawnByes = currentPlayerByes.filter(p => 
        p.byeType === "zero_point" && !p.isRequested
      );
      const currentPlayerStatus = currentWithdrawnByes.length > 0 ? "withdrawn" : "active";
      
      // Handle status changes (withdrawal/reactivation)
      if (status !== currentPlayerStatus) {
        if (status === "withdrawn") {
          // Withdraw player - create zero-point byes for all future rounds
          const tournament = await storage.getTournament(player.tournamentId);
          if (tournament && tournament.rounds) {
            for (let round = currentRound + 1; round <= tournament.rounds; round++) {
              // Check if bye already exists for this round
              const existingByes = await storage.getPairingsByRound(player.tournamentId, round);
              const existingBye = existingByes.find(p => p.playerId === playerId && p.isBye);
              
              if (!existingBye) {
                await storage.createPairing({
                  tournamentId: player.tournamentId,
                  round: round,
                  playerId: playerId,
                  opponentId: null,
                  color: null,
                  points: 0,
                  isBye: true,
                  byeType: "zero_point",
                  isRequested: false // System-assigned withdrawal bye
                });
              }
            }
          }
        } else if (status === "active") {
          // Reactivate player - remove only system-assigned future zero-point byes
          const futureWithdrawnByes = allPairings.filter(p => 
            p.playerId === playerId && 
            p.isBye && 
            p.byeType === "zero_point" && 
            p.round > currentRound &&
            !p.isRequested // Only remove system-assigned withdrawal byes
          );
          
          for (const bye of futureWithdrawnByes) {
            await storage.deletePairing(bye.id);
          }
        }
      }
      
      // Handle individual bye requests (independent of status)
      if (byeRounds && Array.isArray(byeRounds) && byeRounds.length > 0) {
        for (const byeEntry of byeRounds) {
          // Store points as integer: 0 = 0 points, 1 = 0.5 points, 2 = 1 point
          const pointsPerBye = byeEntry.type === "half_point" ? 1 : 
                              byeEntry.type === "zero_point" ? 0 : 2;
          
          // Check if bye already exists for this round
          const existingByes = await storage.getPairingsByRound(player.tournamentId, byeEntry.round);
          const existingBye = existingByes.find(p => p.playerId === playerId && p.isBye);
          
          if (!existingBye) {
            await storage.createPairing({
              tournamentId: player.tournamentId,
              round: byeEntry.round,
              playerId: playerId,
              opponentId: null,
              color: null,
              points: pointsPerBye,
              isBye: true,
              byeType: byeEntry.type,
              isRequested: true // Mark as requested since it's explicitly added by TD
            });
          }
        }
      }
      
      // Return current status after operations (only based on system-assigned withdrawal byes)
      const finalPairings = await storage.getPairingsByTournament(player.tournamentId);
      const finalPlayerByes = finalPairings.filter(p => p.playerId === playerId && p.isBye);
      const finalWithdrawnByes = finalPlayerByes.filter(p => 
        p.byeType === "zero_point" && !p.isRequested
      );
      const finalStatus = finalWithdrawnByes.length > 0 ? "withdrawn" : "active";
      
      console.log(`Player ${playerId} final status calculation:`, {
        totalByes: finalPlayerByes.length,
        withdrawnByes: finalWithdrawnByes.length,
        finalStatus,
        byeDetails: finalPlayerByes.map(b => ({ round: b.round, type: b.byeType, requested: b.isRequested }))
      });
      
      res.json({ 
        message: `Player ${finalStatus === "withdrawn" ? "withdrawn" : "status updated"} successfully`,
        status: finalStatus,
        byeRounds,
        addedByes: byeRounds?.length || 0
      });
    } catch (error) {
      console.error('Player status update error:', error);
      res.status(500).json({ message: "Failed to update player status" });
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

  app.put("/api/matches/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const user = (req as any).user;
      
      // Get the current match state before updating
      const currentMatch = await storage.getMatch(id);
      if (!currentMatch) {
        return res.status(404).json({ message: "Match not found" });
      }
      
      // Update the match
      const updatedMatch = await storage.updateMatch(id, req.body);
      if (!updatedMatch) {
        return res.status(404).json({ message: "Match not found" });
      }
      
      // Log the change in tournament history
      if (currentMatch.result !== updatedMatch.result) {
        const whitePlayerName = currentMatch.whitePlayerId 
          ? await storage.getPlayer(currentMatch.whitePlayerId) 
          : null;
        const blackPlayerName = currentMatch.blackPlayerId 
          ? await storage.getPlayer(currentMatch.blackPlayerId) 
          : null;
        
        const description = blackPlayerName 
          ? `Result changed for Round ${currentMatch.round}, Board ${currentMatch.board}: ${whitePlayerName?.firstName} ${whitePlayerName?.lastName} vs ${blackPlayerName.firstName} ${blackPlayerName.lastName} from "${currentMatch.result || 'Pending'}" to "${updatedMatch.result}"`
          : `Bye result changed for Round ${currentMatch.round}: ${whitePlayerName?.firstName} ${whitePlayerName?.lastName} from "${currentMatch.result || 'Pending'}" to "${updatedMatch.result}"`;

        await storage.createHistoryEntry({
          tournamentId: currentMatch.tournamentId,
          action: 'result_change',
          description,
          changedBy: user.id,
          previousState: JSON.stringify(currentMatch),
          newState: JSON.stringify(updatedMatch),
          round: currentMatch.round,
          matchId: currentMatch.id,
          canRevert: true
        });
      }
      
      res.json(updatedMatch);
    } catch (error) {
      console.error('Update match error:', error);
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

  app.post("/api/tournaments/:tournamentId/generate-pairings", requireAuth, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const { regenerate = false, targetRound } = req.body;
      
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      const players = await storage.getPlayersByTournament(tournamentId);
      if (players.length < 2) {
        return res.status(400).json({ message: "At least 2 players required to generate pairings" });
      }

      console.log(`Pairing generation: regenerate=${regenerate}, targetRound=${targetRound}`);
      console.log(`Request body:`, JSON.stringify(req.body));

      const existingMatches = await storage.getMatchesByTournament(tournamentId);
      let currentRound: number;

      if (regenerate && targetRound) {
        // Regenerating existing round - clear this round and all future rounds
        currentRound = targetRound;
        console.log(`Regenerating round ${currentRound}`);
        
        // Clear this round and all future rounds to ensure clean state
        const futureRounds = existingMatches
          .map(m => m.round)
          .filter(round => round >= currentRound)
          .filter((round, index, arr) => arr.indexOf(round) === index); // unique rounds
        
        console.log(`Clearing current and future rounds for regeneration: ${futureRounds.join(', ')}`);
        
        for (const round of futureRounds) {
          const existingRoundMatches = await storage.getMatchesByRound(tournamentId, round);
          const existingRoundPairings = await storage.getPairingsByRound(tournamentId, round);
          
          console.log(`Clearing round ${round}: ${existingRoundMatches.length} matches, ${existingRoundPairings.length} pairings`);
          
          const pairingsDeleted = await storage.deletePairingsByRound(tournamentId, round);
          const matchesDeleted = await storage.deleteMatchesByRound(tournamentId, round);
          
          console.log(`Round ${round} deletion results: matches=${matchesDeleted}, pairings=${pairingsDeleted}`);
        }
      } else {
        // Generating next round - find the last completed round
        let lastCompletedRound = 0;
        
        if (existingMatches.length > 0) {
          // Group matches by round and check completion
          const roundGroups = existingMatches.reduce((acc, match) => {
            if (!acc[match.round]) acc[match.round] = [];
            acc[match.round].push(match);
            return acc;
          }, {} as Record<number, typeof existingMatches>);
          
          // Find the highest completed round
          for (const round of Object.keys(roundGroups).map(Number).sort((a, b) => a - b)) {
            const roundMatches = roundGroups[round];
            const incompleteMatches = roundMatches.filter(m => !m.result || m.result === 'Pending');
            
            if (incompleteMatches.length === 0) {
              lastCompletedRound = round;
            } else {
              // This round is incomplete, so we can't go further
              break;
            }
          }
        }
        
        currentRound = lastCompletedRound + 1;
        console.log(`Generating Round ${currentRound} (last completed: ${lastCompletedRound})`);
        
        // Validate that we can generate this round
        if (lastCompletedRound === 0 && existingMatches.length > 0) {
          // There are matches but none are completed
          const incompleteMatches = existingMatches.filter(m => !m.result || m.result === 'Pending');
          if (incompleteMatches.length > 0) {
            return res.status(400).json({ 
              error: `Cannot generate Round ${currentRound}. Complete all matches in Round ${Math.min(...existingMatches.map(m => m.round))} first.`
            });
          }
        }
        
        // Clear all future rounds (currentRound and higher) to ensure clean state
        const futureRounds = existingMatches
          .map(m => m.round)
          .filter(round => round >= currentRound)
          .filter((round, index, arr) => arr.indexOf(round) === index); // unique rounds
        
        console.log(`Clearing future rounds: ${futureRounds.join(', ')}`);
        
        for (const round of futureRounds) {
          console.log(`Clearing round ${round}...`);
          
          // Preserve explicit bye requests (manual bye requests should not be deleted)
          // Only delete automatic pairings and matches
          const roundPairings = await storage.getPairingsByRound(tournamentId, round);
          const explicitByes = roundPairings.filter(p => 
            p.isBye && 
            (p.byeType === 'half_point' || p.byeType === 'zero_point') &&
            // Exclude automatic byes that were system-generated (these will be regenerated)
            p.opponentId === null
          );
          
          // Delete all pairings except explicit bye requests
          for (const pairing of roundPairings) {
            const isExplicitBye = explicitByes.some(bye => bye.id === pairing.id);
            if (!isExplicitBye) {
              await storage.deletePairing(pairing.id);
            }
          }
          
          // Delete all matches (they will be regenerated)
          await storage.deleteMatchesByRound(tournamentId, round);
          
          console.log(`Preserved ${explicitByes.length} explicit bye requests for round ${round}`);
        }
      }
      
      // Filter out withdrawn players who have future zero-point byes
      const allPairings = await storage.getPairingsByTournament(tournamentId);
      const withdrawnPlayerIds = new Set();
      
      // Identify withdrawn players (those with zero-point byes for future rounds)
      for (const pairing of allPairings) {
        if (pairing.isBye && pairing.byeType === 'zero_point' && pairing.round >= currentRound) {
          withdrawnPlayerIds.add(pairing.playerId);
        }
      }
      
      // Filter out withdrawn players from active player list
      const activePlayers = players.filter(player => !withdrawnPlayerIds.has(player.id));
      console.log(`Active players for round ${currentRound}: ${activePlayers.length} (${withdrawnPlayerIds.size} withdrawn)`);

      // Generate Swiss pairings directly (excluding matches from the round being regenerated)
      const matchesForPairing = existingMatches.filter(m => m.round !== currentRound);
      const pairingsForStats = allPairings.filter(p => p.round < currentRound);
      const swissPairings = await generateSwissPairings(activePlayers, matchesForPairing, currentRound, pairingsForStats);
      
      // Create both pairings and matches from the Swiss algorithm
      const savedPairings = [];
      const matches = [];
      
      for (const pairing of swissPairings) {
        if (pairing.isBye) {
          // Create pairing for bye (use integer mapping: 0=0pts, 1=0.5pts, 2=1pt)
          const byePoints = pairing.byeType === 'half_point' ? 1 : 2;
          const savedPairing = await storage.createPairing({
            tournamentId: tournament.id,
            round: currentRound,
            playerId: pairing.whitePlayerId,
            opponentId: null,
            color: null,
            points: byePoints, // Half-point for odd number, full-point for other byes
            isBye: true,
            byeType: pairing.byeType || 'half_point',
          });
          savedPairings.push(savedPairing);
        } else {
          // Create match
          const match = await storage.createMatch({
            tournamentId: tournament.id,
            round: currentRound,
            board: pairing.board,
            whitePlayerId: pairing.whitePlayerId,
            blackPlayerId: pairing.blackPlayerId,
            result: null,
            status: 'pending'
          });
          matches.push(match);
          
          // Create pairings for both players
          const whitePairing = await storage.createPairing({
            tournamentId: tournament.id,
            round: currentRound,
            playerId: pairing.whitePlayerId,
            opponentId: pairing.blackPlayerId,
            color: 'white',
            points: 0,
            isBye: false,
          });
          
          const blackPairing = await storage.createPairing({
            tournamentId: tournament.id,
            round: currentRound,
            playerId: pairing.blackPlayerId,
            opponentId: pairing.whitePlayerId,
            color: 'black',
            points: 0,
            isBye: false,
          });
          
          savedPairings.push(whitePairing, blackPairing);
        }
      }
      
      // Log pairing generation in tournament history
      const user = (req as any).user;
      const action = regenerate ? 'pairing_regeneration' : 'pairing_generation';
      const description = regenerate 
        ? `Round ${currentRound} pairings regenerated (${savedPairings.length} pairings created)`
        : `Round ${currentRound} pairings generated (${savedPairings.length} pairings created)`;
      
      await storage.createHistoryEntry({
        tournamentId: tournament.id,
        action,
        description,
        changedBy: user.id,
        previousState: null,
        newState: JSON.stringify({ round: currentRound, pairingsCount: savedPairings.length }),
        round: currentRound,
        canRevert: false
      });
      
      res.json({ pairings: savedPairings, matches, round: currentRound });
    } catch (error) {
      console.error('Pairing generation error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message: "Failed to generate pairings", error: errorMessage });
    }
  });

  // Regenerate future rounds endpoint
  app.post("/api/tournaments/:tournamentId/regenerate-future-rounds", async (req, res) => {
    console.log(`=== ENDPOINT HIT: regenerate-future-rounds ===`);
    console.log(`Raw request body:`, req.body);
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const { fromRound } = req.body;
      
      if (!fromRound) {
        console.log(`=== ERROR: fromRound missing ===`);
        return res.status(400).json({ message: "fromRound parameter required" });
      }
      
      console.log(`=== REGENERATION START ===`);
      console.log(`Regenerating future rounds from Round ${fromRound} for tournament ${tournamentId}`);
      console.log(`Request body:`, JSON.stringify(req.body));
      
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      const players = await storage.getPlayersByTournament(tournamentId);
      if (players.length < 2) {
        return res.status(400).json({ message: "At least 2 players required" });
      }

      const existingMatches = await storage.getMatchesByTournament(tournamentId);
      console.log(`Found ${existingMatches.length} total matches in tournament:`, existingMatches.map(m => `Round ${m.round} Match ${m.id}`));
      
      // Find all rounds to be regenerated (fromRound and higher)
      const roundsToRegenerate = existingMatches
        .map(m => m.round)
        .filter(round => round >= fromRound)
        .filter((round, index, arr) => arr.indexOf(round) === index)
        .sort((a, b) => a - b);

      console.log(`Rounds to regenerate: ${roundsToRegenerate.join(', ')}`);
      console.log(`All existing rounds: ${existingMatches.map(m => m.round).filter((round, index, arr) => arr.indexOf(round) === index).sort((a, b) => a - b).join(', ')}`);
      
      if (roundsToRegenerate.length === 0) {
        // No existing future rounds - check if we should generate the next round
        const maxExistingRound = existingMatches.length > 0 ? 
          Math.max(...existingMatches.map(m => m.round)) : 0;
        
        console.log(`No rounds to regenerate. maxExistingRound: ${maxExistingRound}, fromRound: ${fromRound}`);
        
        if (fromRound <= maxExistingRound + 1) {
          // Generate the requested round (could be next round or replacing existing rounds)
          console.log(`Generating Round ${fromRound}. MaxExisting: ${maxExistingRound}, Requested: ${fromRound}`);
          
          const baseMatches = existingMatches; // Use all existing matches for pairing
          const swissPairings = await generateSwissPairings(players, baseMatches, fromRound);
          
          let allNewPairings = [];
          let allNewMatches = [];
          
          // Save matches and pairings for the new round
          for (const pairing of swissPairings) {
            // Create match
            const match = await storage.createMatch({
              tournamentId,
              round: fromRound,
              board: pairing.board,
              whitePlayerId: pairing.whitePlayerId,
              blackPlayerId: pairing.blackPlayerId || null,
              result: null,
              status: 'pending'
            });
            allNewMatches.push(match);

            // Create pairings for both players
            if (pairing.whitePlayerId) {
              const whitePairing = await storage.createPairing({
                tournamentId,
                round: fromRound,
                playerId: pairing.whitePlayerId,
                opponentId: pairing.blackPlayerId || null,
                color: 'white',
                points: pairing.isBye ? (pairing.byeType === 'full_point' ? 2 : 1) : 0,
                isBye: pairing.isBye || false,
                byeType: pairing.byeType || null,
                isRequested: pairing.isRequested || false,
              });
              allNewPairings.push(whitePairing);
            }

            if (pairing.blackPlayerId) {
              const blackPairing = await storage.createPairing({
                tournamentId,
                round: fromRound,
                playerId: pairing.blackPlayerId,
                opponentId: pairing.whitePlayerId,
                color: 'black',
                points: 0,
                isBye: false,
                byeType: null,
                isRequested: false,
              });
              allNewPairings.push(blackPairing);
            }
          }
          
          console.log(`Generated Round ${fromRound} with ${allNewMatches.length} matches and ${allNewPairings.length} pairings`);
          
          return res.json({ 
            message: `Generated Round ${fromRound} successfully`,
            roundsAffected: 1,
            roundsRegenerated: [fromRound],
            matchesCreated: allNewMatches.length,
            pairingsCreated: allNewPairings.length
          });
        }
        
        console.log(`=== REGENERATION FAILED - No rounds generated ===`);
        console.log(`MaxExisting: ${maxExistingRound}, FromRound: ${fromRound}, Condition: ${fromRound} <= ${maxExistingRound + 1} = ${fromRound <= maxExistingRound + 1}`);
        return res.status(200).json({ 
          message: "No future rounds found to regenerate",
          roundsAffected: 0,
          roundsRegenerated: [],
          matchesCreated: 0,
          pairingsCreated: 0
        });
      }

      // Clear all future rounds
      for (const round of roundsToRegenerate) {
        console.log(`Clearing round ${round}...`);
        await storage.deletePairingsByRound(tournamentId, round);
        await storage.deleteMatchesByRound(tournamentId, round);
      }

      // Get matches up to the last completed round (before fromRound)
      const baseMatches = existingMatches.filter(m => m.round < fromRound);
      
      // Regenerate each round sequentially
      let allNewPairings = [];
      let allNewMatches = [];
      
      for (const round of roundsToRegenerate) {
        console.log(`Regenerating round ${round}...`);
        
        // Use all previous matches (base + already regenerated) for pairing calculation
        const matchesForPairing = [...baseMatches, ...allNewMatches];
        const swissPairings = await generateSwissPairings(players, matchesForPairing, round);
        
        // Save matches and pairings for this round
        for (const pairing of swissPairings) {
          // Create match
          const match = await storage.createMatch({
            tournamentId,
            round,
            board: pairing.board,
            whitePlayerId: pairing.whitePlayerId,
            blackPlayerId: pairing.blackPlayerId || null,
            result: null,
            status: 'pending'
          });
          allNewMatches.push(match);

          // Create pairings for both players
          if (pairing.whitePlayerId) {
            const whitePairing = await storage.createPairing({
              tournamentId,
              round,
              playerId: pairing.whitePlayerId,
              opponentId: pairing.blackPlayerId || null,
              color: 'white',
              points: pairing.isBye ? (pairing.byeType === 'full_point' ? 2 : 1) : 0,
              isBye: pairing.isBye || false,
              byeType: pairing.byeType || null,
              isRequested: pairing.isRequested || false,
            });
            allNewPairings.push(whitePairing);
          }

          if (pairing.blackPlayerId) {
            const blackPairing = await storage.createPairing({
              tournamentId,
              round,
              playerId: pairing.blackPlayerId,
              opponentId: pairing.whitePlayerId,
              color: 'black',
              points: 0,
              isBye: false,
              byeType: null,
            });
            allNewPairings.push(blackPairing);
          }
        }
      }
      
      console.log(`Regenerated ${roundsToRegenerate.length} rounds with ${allNewMatches.length} matches and ${allNewPairings.length} pairings`);
      
      res.json({ 
        message: "Future rounds regenerated successfully",
        roundsAffected: roundsToRegenerate.length,
        roundsRegenerated: roundsToRegenerate,
        matchesCreated: allNewMatches.length,
        pairingsCreated: allNewPairings.length
      });
    } catch (error) {
      console.error('Future rounds regeneration error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ message: "Failed to regenerate future rounds", error: errorMessage });
    }
  });

  // Bye request routes
  app.post("/api/tournaments/:tournamentId/bye-requests", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const byeRequestData = {
        ...req.body,
        tournamentId,
      };
      
      const byeRequest = await storage.createByeRequest(byeRequestData);
      res.status(201).json(byeRequest);
    } catch (error) {
      res.status(500).json({ message: "Failed to create bye request" });
    }
  });

  app.get("/api/tournaments/:tournamentId/bye-requests", async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const { round } = req.query;
      
      let byeRequests;
      if (round) {
        byeRequests = await storage.getByeRequestsByRound(tournamentId, parseInt(round as string));
      } else {
        byeRequests = await storage.getByeRequestsByTournament(tournamentId);
      }
      
      res.json(byeRequests);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bye requests" });
    }
  });

  app.put("/api/bye-requests/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const updateData = req.body;
      
      const updatedByeRequest = await storage.updateByeRequest(id, updateData);
      if (!updatedByeRequest) {
        return res.status(404).json({ message: "Bye request not found" });
      }
      
      res.json(updatedByeRequest);
    } catch (error) {
      res.status(500).json({ message: "Failed to update bye request" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

async function generatePairings(tournament: any, players: any[], matches: any[], round: number) {
  const pairings = [];
  
  if (tournament.format === 'swiss') {
    // Use proper Swiss pairing algorithm
    const swissPairings = await generateSwissPairings(players, matches, round);
    
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

// Helper functions for proper Swiss pairing
function groupPlayersByScore(playerStats: any[]): any[][] {
  const groups: { [score: string]: any[] } = {};
  
  for (const player of playerStats) {
    const score = player.points.toString();
    if (!groups[score]) {
      groups[score] = [];
    }
    groups[score].push(player);
  }
  
  // Sort groups by score (highest first) and players within groups by seeding order
  return Object.keys(groups)
    .sort((a, b) => parseFloat(b) - parseFloat(a))
    .map(score => groups[score].sort((a, b) => {
      // Sort by rating first, then alphabetically for consistent seeding
      const ratingDiff = (b.player.rating || 0) - (a.player.rating || 0);
      if (ratingDiff !== 0) return ratingDiff;
      
      // If ratings are equal, sort alphabetically by first name, then last name
      const firstNameCmp = (a.player.firstName || '').localeCompare(b.player.firstName || '');
      if (firstNameCmp !== 0) return firstNameCmp;
      
      const lastNameCmp = (a.player.lastName || '').localeCompare(b.player.lastName || '');
      if (lastNameCmp !== 0) return lastNameCmp;
      
      // If names are also equal, sort by ID for consistent ordering
      return a.player.id - b.player.id;
    }));
}

function pairUpperVsLowerHalf(scoreGroup: any[], matches: any[], round: number): { paired: any[][], unpaired: any[] } {
  const paired: any[][] = [];
  const unpaired: any[] = [];
  
  if (scoreGroup.length < 2) {
    return { paired, unpaired: [...scoreGroup] };
  }

  // Sort by rating (highest first for proper upper/lower half)
  const sortedGroup = [...scoreGroup].sort((a, b) => (b.player.rating || 0) - (a.player.rating || 0));
  const midPoint = Math.floor(sortedGroup.length / 2);
  
  const upperHalf = sortedGroup.slice(0, midPoint);
  const lowerHalf = sortedGroup.slice(midPoint);
  
  // Pair upper half with lower half
  const maxPairs = Math.min(upperHalf.length, lowerHalf.length);
  
  for (let i = 0; i < maxPairs; i++) {
    const upperPlayer = upperHalf[i];
    let pairedLowerPlayer = null;
    let pairedIndex = -1;
    
    // Rule #1: Find a lower half player they haven't played before
    for (let j = i; j < lowerHalf.length; j++) {
      const lowerPlayer = lowerHalf[j];
      if (!havePlayed(upperPlayer.player.id, lowerPlayer.player.id, matches)) {
        pairedLowerPlayer = lowerPlayer;
        pairedIndex = j;
        break;
      }
    }
    
    if (pairedLowerPlayer) {
      paired.push([upperPlayer, pairedLowerPlayer]);
      // Remove the paired lower player
      lowerHalf.splice(pairedIndex, 1);
    } else {
      // No unplayed opponent available, add to unpaired
      unpaired.push(upperPlayer);
    }
  }
  
  // Add any remaining unpaired players
  unpaired.push(...upperHalf.slice(maxPairs), ...lowerHalf);
  
  return { paired, unpaired };
}

function determineSwissColors(player1: any, player2: any): { whitePlayer: any, blackPlayer: any } {
  // Rules 4 & 5: Color equalization and alternation
  const p1Balance = player1.colorBalance || 0; // whiteGames - blackGames
  const p2Balance = player2.colorBalance || 0;
  
  // Debug logging for color assignment
  console.log(`Color assignment debug:
    Player 1: ${player1.player.firstName} ${player1.player.lastName} (${player1.player.rating}) - Balance: ${p1Balance}, Last Color: ${player1.lastColor}
    Player 2: ${player2.player.firstName} ${player2.player.lastName} (${player2.player.rating}) - Balance: ${p2Balance}, Last Color: ${player2.lastColor}`);
  
  // Strong color preference (2+ game difference) - Rule #4 priority
  if (p1Balance <= -2) return { whitePlayer: player1.player, blackPlayer: player2.player };
  if (p1Balance >= 2) return { whitePlayer: player2.player, blackPlayer: player1.player };
  if (p2Balance <= -2) return { whitePlayer: player2.player, blackPlayer: player1.player };
  if (p2Balance >= 2) return { whitePlayer: player1.player, blackPlayer: player2.player };

  // Moderate color preference (1 game difference) - Rule #4 priority
  if (p1Balance === -1 && p2Balance >= 0) return { whitePlayer: player1.player, blackPlayer: player2.player };
  if (p1Balance === 1 && p2Balance <= 0) return { whitePlayer: player2.player, blackPlayer: player1.player };
  if (p2Balance === -1 && p1Balance >= 0) return { whitePlayer: player2.player, blackPlayer: player1.player };
  if (p2Balance === 1 && p1Balance <= 0) return { whitePlayer: player1.player, blackPlayer: player2.player };

  // Equal color balance - apply Rule #5 (alternation) with rating tiebreaker
  const p1Rating = player1.player.rating || 0;
  const p2Rating = player2.player.rating || 0;
  
  // Get last colors for alternation
  const p1LastColor = player1.lastColor; // should be 'white', 'black', or null
  const p2LastColor = player2.lastColor;
  
  // If one player needs alternation more than the other
  if (p1LastColor === 'white' && p2LastColor !== 'white') {
    return { whitePlayer: player2.player, blackPlayer: player1.player };
  }
  if (p1LastColor === 'black' && p2LastColor !== 'black') {
    return { whitePlayer: player1.player, blackPlayer: player2.player };
  }
  if (p2LastColor === 'white' && p1LastColor !== 'white') {
    return { whitePlayer: player1.player, blackPlayer: player2.player };
  }
  if (p2LastColor === 'black' && p1LastColor !== 'black') {
    return { whitePlayer: player2.player, blackPlayer: player1.player };
  }
  
  // Special case: Both players had the same color in previous round
  // USCF Rule: Lower-rated player gets same color again, higher-rated alternates
  if (p1LastColor === p2LastColor && p1LastColor !== null) {
    const higherRated = p1Rating >= p2Rating ? player1 : player2;
    const lowerRated = p1Rating >= p2Rating ? player2 : player1;
    
    console.log(`USCF Same Color Rule Applied:
      Higher-rated: ${higherRated.player.firstName} ${higherRated.player.lastName} (${higherRated.player.rating})
      Lower-rated: ${lowerRated.player.firstName} ${lowerRated.player.lastName} (${lowerRated.player.rating})
      Both had: ${p1LastColor} in previous round`);
    
    if (p1LastColor === 'white') {
      // Both had white last round: lower-rated gets white again, higher-rated gets black
      if (lowerRated === player1) {
        console.log(`Result: ${player1.player.firstName} (lower) gets white, ${player2.player.firstName} (higher) gets black`);
        return { whitePlayer: player1.player, blackPlayer: player2.player };
      } else {
        console.log(`Result: ${player2.player.firstName} (lower) gets white, ${player1.player.firstName} (higher) gets black`);
        return { whitePlayer: player2.player, blackPlayer: player1.player };
      }
    } else {
      // Both had black last round: lower-rated gets black again, higher-rated gets white
      if (lowerRated === player1) {
        console.log(`Result: ${player2.player.firstName} (higher) gets white, ${player1.player.firstName} (lower) gets black`);
        return { whitePlayer: player2.player, blackPlayer: player1.player };
      } else {
        console.log(`Result: ${player1.player.firstName} (higher) gets white, ${player2.player.firstName} (lower) gets black`);
        return { whitePlayer: player1.player, blackPlayer: player2.player };
      }
    }
  }
  
  // Both players have same alternation needs - higher rated player gets white
  if (p1Rating > p2Rating) {
    return { whitePlayer: player1.player, blackPlayer: player2.player };
  } else {
    return { whitePlayer: player2.player, blackPlayer: player1.player };
  }
}

async function generateSwissPairings(players: any[], matches: any[], round: number, existingPairings: any[] = []) {
  // Server-side Swiss pairing implementation following USCF rules
  const pairings = [];
  
  // Filter out withdrawn players and players with existing byes for this round
  const tournamentId = players[0]?.tournamentId;
  if (tournamentId) {
    const allPairings = await storage.getPairingsByTournament(tournamentId);
    
    // Get withdrawn players (those with zero-point byes)
    const withdrawnPlayerIds = new Set(
      allPairings
        .filter(p => p.isBye && p.byeType === 'zero_point')
        .map(p => p.playerId)
    );
    
    // Get players with specific bye requests for this round
    const roundByePlayerIds = new Set(
      allPairings
        .filter(p => p.round === round && p.isBye)
        .map(p => p.playerId)
    );
    
    // Filter to active players only (not withdrawn and no existing bye for this round)
    const withdrawnIds = Array.from(withdrawnPlayerIds);
    const roundByeIds = Array.from(roundByePlayerIds);
    const excludedIds = [...withdrawnIds, ...roundByeIds];
    players = players.filter(p => !excludedIds.includes(p.id));
    
    console.log(`Active players for round ${round}: ${players.length} (${withdrawnPlayerIds.size} withdrawn, ${roundByePlayerIds.size} with round byes)`);
  }
  
  if (round === 1) {
    // First round: sort by rating, then alphabetical, then by ID for consistent seeding
    const sortedPlayers = players.sort((a, b) => {
      const ratingDiff = (b.rating || 0) - (a.rating || 0);
      if (ratingDiff !== 0) return ratingDiff;
      
      // If ratings are equal, sort alphabetically by first name, then last name
      const firstNameCmp = (a.firstName || '').localeCompare(b.firstName || '');
      if (firstNameCmp !== 0) return firstNameCmp;
      
      const lastNameCmp = (a.lastName || '').localeCompare(b.lastName || '');
      if (lastNameCmp !== 0) return lastNameCmp;
      
      // If names are also equal, sort by ID for consistent ordering
      return a.id - b.id;
    });
    const n = sortedPlayers.length;
    const isOdd = n % 2 === 1;
    
    const mid = Math.floor(n / 2);
    const upperHalf = sortedPlayers.slice(0, mid);
    const lowerHalf = sortedPlayers.slice(mid);
    
    const firstBoardWhiteIsUpper = Math.random() < 0.5;
    let boardNumber = 1;
    
    // Pair upper half vs lower half
    for (let i = 0; i < upperHalf.length && i < lowerHalf.length; i++) {
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
    
    // Handle odd player (half-point bye to lowest rated player)
    if (isOdd) {
      const byePlayer = sortedPlayers[sortedPlayers.length - 1]; // Lowest rated player
      pairings.push({
        whitePlayerId: byePlayer.id,
        blackPlayerId: null,
        board: 0, // Bye doesn't get a board
        isBye: true,
        byeType: 'half_point', // Half-point bye for odd number
      });
    }
  } else {
    // Subsequent rounds: Swiss pairing with proper precedence rules
    const playerStats = calculatePlayerStats(players, matches, existingPairings);
    
    // Group by score (Rule #2: Equal scores)
    const scoreGroups = groupPlayersByScore(playerStats);
    const unpaired = [];
    let boardNumber = 1;
    
    // Process each score group from highest to lowest
    for (let groupIndex = 0; groupIndex < scoreGroups.length; groupIndex++) {
      const scoreGroup = scoreGroups[groupIndex];
      
      // Add any unpaired players from higher score groups
      const playersToProcess = [...unpaired, ...scoreGroup];
      unpaired.length = 0; // Clear unpaired array
      
      // Special case: If we have exactly one player from higher group and current group has players
      // Pair the higher-scored player with highest-rated player from current group
      if (playersToProcess.length > scoreGroup.length && 
          playersToProcess.length - scoreGroup.length === 1 && 
          scoreGroup.length > 0) {
        
        const higherScoredPlayer = playersToProcess[0]; // First player is from higher group
        const currentGroupSorted = scoreGroup.sort((a, b) => (b.player.rating || 0) - (a.player.rating || 0));
        const highestRatedInGroup = currentGroupSorted[0];
        
        // Pair them together
        const colors = determineSwissColors(higherScoredPlayer, highestRatedInGroup);
        pairings.push({
          whitePlayerId: colors.whitePlayer.id,
          blackPlayerId: colors.blackPlayer.id,
          board: boardNumber++,
          isBye: false,
        });
        
        // Remove the paired players and continue with remaining players
        const remainingPlayers = currentGroupSorted.slice(1);
        const pairedInGroup = pairUpperVsLowerHalf(remainingPlayers, matches, round);
        
        // Add remaining successful pairings
        for (const [player1, player2] of pairedInGroup.paired) {
          const colors = determineSwissColors(player1, player2);
          
          pairings.push({
            whitePlayerId: colors.whitePlayer.id,
            blackPlayerId: colors.blackPlayer.id,
            board: boardNumber++,
            isBye: false,
          });
        }
        
        // Carry over any remaining unpaired players
        unpaired.push(...pairedInGroup.unpaired);
        
      } else {
        // Normal within-group pairing
        // Swiss rule: If odd number in score group, lowest-seeded player drops to next group
        if (playersToProcess.length % 2 === 1) {
          const lowestSeeded = playersToProcess.pop(); // Remove lowest-seeded player
          unpaired.push(lowestSeeded!); // Push to next score group
          
          console.log(`Odd group: Pushing lowest-seeded player ${lowestSeeded!.player.firstName} ${lowestSeeded!.player.lastName} to next score group`);
        }
        
        // For the remaining even number of players, pair them within the score group
        // Priority: Avoid repeat pairings (USCF Rule #1 is highest priority)
        const remainingPlayers = [...playersToProcess];
        
        while (remainingPlayers.length >= 2) {
          const player1 = remainingPlayers.shift()!;
          let bestOpponent = null;
          let bestIndex = -1;
          
          // Find the best opponent that they haven't played before
          for (let i = 0; i < remainingPlayers.length; i++) {
            const potentialOpponent = remainingPlayers[i];
            
            // Never pair a player against themselves
            if (player1.player.id === potentialOpponent.player.id) {
              console.log(`Skipping self-pairing: ${player1.player.firstName} (${player1.player.id}) cannot play themselves`);
              continue;
            }
            
            const hasPlayedBefore = havePlayed(player1.player.id, potentialOpponent.player.id, matches);
            console.log(`Within-group check: ${player1.player.firstName} (${player1.player.id}) vs ${potentialOpponent.player.firstName} (${potentialOpponent.player.id}): hasPlayed=${hasPlayedBefore}`);
            
            if (!hasPlayedBefore) {
              bestOpponent = potentialOpponent;
              bestIndex = i;
              console.log(`Found valid within-group opponent: ${player1.player.firstName} vs ${potentialOpponent.player.firstName}`);
              break; // Take first available opponent (maintains rating order)
            }
          }
          
          if (bestOpponent) {
            // Found a valid opponent within the score group
            remainingPlayers.splice(bestIndex, 1);
            
            const colors = determineSwissColors(player1, bestOpponent);
            
            pairings.push({
              whitePlayerId: colors.whitePlayer.id,
              blackPlayerId: colors.blackPlayer.id,
              board: boardNumber++,
              isBye: false,
            });
          } else {
            // No valid opponent in this score group - push to unpaired for cross-score-group pairing
            console.log(`No valid within-group opponent for ${player1.player.firstName} - pushing to cross-score-group pairing`);
            unpaired.push(player1);
            
            // Also push all remaining players to unpaired (they need cross-score-group pairing too)
            for (const remainingPlayer of remainingPlayers) {
              // Check for duplicates before adding
              const isDuplicate = unpaired.some(existing => existing.player.id === remainingPlayer.player.id);
              if (!isDuplicate) {
                unpaired.push(remainingPlayer);
              }
            }
            break; // Exit the loop since we're moving to cross-score-group pairing
          }
        }
        
        // Any remaining single player goes to unpaired
        if (remainingPlayers.length === 1) {
          unpaired.push(remainingPlayers[0]);
        }
      }
    }
    
    // Debug: Show all unpaired players before cross-score-group pairing
    console.log(`Cross-score-group pairing: ${unpaired.length} unpaired players:`, 
      unpaired.map(p => `${p.player.firstName} ${p.player.lastName} (${p.points}pts, ID:${p.player.id})`));
    
    // Handle final unpaired players (cross-score-group pairing if needed)
    while (unpaired.length > 1) {
      const player1 = unpaired.shift()!;
      let pairedPlayer = null;
      let pairedIndex = -1;
      
      // First try to find a player they haven't played before (USCF Rule #1: avoid repeat pairings when possible)
      console.log(`Looking for opponent for ${player1.player.firstName} ${player1.player.lastName} (ID: ${player1.player.id})`);
      for (let i = 0; i < unpaired.length; i++) {
        const potentialOpponent = unpaired[i];
        
        // Never pair a player against themselves
        if (player1.player.id === potentialOpponent.player.id) {
          console.log(`  Skipping self-pairing: ${player1.player.firstName} (${player1.player.id}) cannot play themselves`);
          continue;
        }
        
        const hasPlayedBefore = havePlayed(player1.player.id, potentialOpponent.player.id, matches);
        console.log(`  Checking vs ${potentialOpponent.player.firstName} ${potentialOpponent.player.lastName} (ID: ${potentialOpponent.player.id}): hasPlayed=${hasPlayedBefore}`);
        
        if (!hasPlayedBefore) {
          pairedPlayer = potentialOpponent;
          pairedIndex = i;
          console.log(`  ✓ Found valid opponent: ${player1.player.firstName} vs ${potentialOpponent.player.firstName}`);
          break;
        }
      }
      
      // If no new opponent found, allow repeat pairing (USCF allows this when necessary)
      if (!pairedPlayer && unpaired.length > 0) {
        pairedPlayer = unpaired[0];
        pairedIndex = 0;
        console.log(`  No new opponent available: allowing repeat pairing ${player1.player.firstName} vs ${pairedPlayer.player.firstName}`);
      }
      
      if (pairedPlayer) {
        // Remove the paired player from unpaired list
        unpaired.splice(pairedIndex, 1);
        
        const colors = determineSwissColors(player1, pairedPlayer);
        
        pairings.push({
          whitePlayerId: colors.whitePlayer.id,
          blackPlayerId: colors.blackPlayer.id,
          board: boardNumber++,
          isBye: false,
        });
      }
    }
    
    // Handle any remaining player with automatic bye
    if (unpaired.length === 1) {
      const byePlayer = unpaired[0];
      
      // Check if this player already has a full-point bye (USCF rule: max one full-point bye per player)
      const allPairings = await storage.getPairingsByTournament(tournamentId);
      const playerFullPointByes = allPairings.filter((p: any) => 
        p.playerId === byePlayer.player.id && 
        p.isBye && 
        p.byeType === 'full_point'
      ).length;
      
      const byeType = playerFullPointByes > 0 ? 'half_point' : 'full_point';
      const byeDescription = byeType === 'full_point' ? '1-point' : '½-point';
      
      console.log(`Automatic ${byeDescription} bye assigned to: ${byePlayer.player.firstName} ${byePlayer.player.lastName} (${byePlayer.player.rating}) - Full byes: ${playerFullPointByes}`);
      
      pairings.push({
        whitePlayerId: byePlayer.player.id,
        blackPlayerId: null,
        board: 0,
        isBye: true,
        byeType: byeType,
        isRequested: false, // Automatic bye assignment
      });
    }
  }
  
  // Sort pairings by board order - highest point totals on top boards
  return sortPairingsByPointTotal(pairings, players, matches, existingPairings);
}

function sortPairingsByPointTotal(pairings: any[], players: any[], matches: any[], existingPairings: any[] = []): any[] {
  // Create a map for quick player stats lookup
  const playerStats = calculatePlayerStats(players, matches, existingPairings);
  const statsMap = new Map();
  playerStats.forEach((stat: any) => {
    statsMap.set(stat.player.id, {
      points: stat.points,
      rating: stat.player.rating || 0
    });
  });

  // Sort pairings by HIGHEST individual player points first, then rating (USCF Board 1 rule)
  const sortedPairings = pairings.filter(p => !p.isBye).sort((a, b) => {
    const aWhiteStats = statsMap.get(a.whitePlayerId);
    const aBlackStats = statsMap.get(a.blackPlayerId);
    const bWhiteStats = statsMap.get(b.whitePlayerId);
    const bBlackStats = statsMap.get(b.blackPlayerId);

    if (!aWhiteStats || !aBlackStats || !bWhiteStats || !bBlackStats) return 0;

    // Get the HIGHEST points player on each board (this determines board order)
    const aHighestPoints = Math.max(aWhiteStats.points, aBlackStats.points);
    const bHighestPoints = Math.max(bWhiteStats.points, bBlackStats.points);

    // First priority: Board with highest individual points goes first
    if (aHighestPoints !== bHighestPoints) {
      return bHighestPoints - aHighestPoints;
    }

    // Tiebreaker: If highest points are equal, use highest rating among the highest-point players
    let aHighestRating = 0;
    let bHighestRating = 0;
    
    // Get rating of the highest-point player(s) on each board
    if (aWhiteStats.points === aHighestPoints) {
      aHighestRating = Math.max(aHighestRating, aWhiteStats.rating);
    }
    if (aBlackStats.points === aHighestPoints) {
      aHighestRating = Math.max(aHighestRating, aBlackStats.rating);
    }
    if (bWhiteStats.points === bHighestPoints) {
      bHighestRating = Math.max(bHighestRating, bWhiteStats.rating);
    }
    if (bBlackStats.points === bHighestPoints) {
      bHighestRating = Math.max(bHighestRating, bBlackStats.rating);
    }

    return bHighestRating - aHighestRating;
  });

  // Add bye pairings at the end
  const byePairings = pairings.filter(p => p.isBye);

  // Reassign board numbers
  const result = [...sortedPairings, ...byePairings];
  result.forEach((pairing, index) => {
    pairing.board = pairing.isBye ? 0 : index + 1;
  });

  return result;
}

function calculatePlayerStats(players: any[], matches: any[], pairings: any[] = []) {
  return players.map(player => {
    const playerMatches = matches.filter(
      match => match.whitePlayerId === player.id || match.blackPlayerId === player.id
    ).sort((a, b) => a.round - b.round); // Sort by round to get last color correctly

    let points = 0;
    let whiteGames = 0;
    let blackGames = 0;
    let lastColor = null;

    playerMatches.forEach(match => {
      const isWhite = match.whitePlayerId === player.id;
      
      // Track color history
      if (isWhite) {
        whiteGames++;
        lastColor = 'white';
      } else {
        blackGames++;
        lastColor = 'black';
      }

      // Only count points for completed games
      if (!match.result) return;

      if (match.result === '1-0') {
        points += isWhite ? 1 : 0;
      } else if (match.result === '0-1') {
        points += isWhite ? 0 : 1;
      } else if (match.result === '1/2-1/2') {
        points += 0.5;
      }
    });

    // Add points from bye pairings (convert from integer mapping: 0=0pts, 1=0.5pts, 2=1pt)
    if (pairings && Array.isArray(pairings)) {
      const playerByes = pairings.filter(pairing => 
        pairing.playerId === player.id && pairing.isBye && pairing.points !== null
      );
      
      playerByes.forEach(bye => {
        const byePoints = bye.points === 1 ? 0.5 : bye.points === 2 ? 1 : 0;
        points += byePoints;
      });
    }

    return {
      player,
      points,
      whiteGames,
      blackGames,
      colorBalance: whiteGames - blackGames,
      lastColor, // Track last color for alternation rule
    };
  });
}

function havePlayed(playerId1: number, playerId2: number, matches: any[]): boolean {
  return matches.some(match => 
    (match.whitePlayerId === playerId1 && match.blackPlayerId === playerId2) ||
    (match.whitePlayerId === playerId2 && match.blackPlayerId === playerId1)
  );
}
