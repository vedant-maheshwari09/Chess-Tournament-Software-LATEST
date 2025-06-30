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
      const tournamentData = insertTournamentSchema.parse(req.body);
      
      // Add the creator's user ID
      const tournamentWithCreator = {
        ...tournamentData,
        createdBy: user.id,
      };
      
      const newTournament = await storage.createTournament(tournamentWithCreator);
      res.status(201).json(newTournament);
    } catch (error) {
      console.error('Tournament creation error:', error);
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
          await storage.deletePairingsByRound(tournamentId, round);
          await storage.deleteMatchesByRound(tournamentId, round);
        }
      }
      
      // Generate Swiss pairings directly (excluding matches from the round being regenerated)
      const matchesForPairing = existingMatches.filter(m => m.round !== currentRound);
      const swissPairings = generateSwissPairings(players, matchesForPairing, currentRound);
      
      // Create both pairings and matches from the Swiss algorithm
      const savedPairings = [];
      const matches = [];
      
      for (const pairing of swissPairings) {
        if (pairing.isBye) {
          // Create pairing for bye
          const byePoints = pairing.byeType === 'half_point' ? 0.5 : 1.0;
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
          const swissPairings = generateSwissPairings(players, baseMatches, fromRound);
          
          let allNewPairings = [];
          let allNewMatches = [];
          
          // Save matches and pairings for the new round
          for (const pairing of swissPairings) {
            // Create match
            const match = await storage.createMatch({
              tournamentId,
              round: fromRound,
              board: pairing.board,
              whitePlayerId: pairing.whitePlayer.id,
              blackPlayerId: pairing.blackPlayer?.id || null,
              result: null,
              status: 'pending'
            });
            allNewMatches.push(match);

            // Create pairings for both players
            if (pairing.whitePlayer) {
              const whitePairing = await storage.createPairing({
                tournamentId,
                round: fromRound,
                playerId: pairing.whitePlayer.id,
                opponentId: pairing.blackPlayer?.id || null,
                color: 'white',
                points: pairing.isBye ? (pairing.byeType === 'full_point' ? 1 : 0.5) : 0,
                isBye: pairing.isBye,
                byeType: pairing.byeType || null,
              });
              allNewPairings.push(whitePairing);
            }

            if (pairing.blackPlayer) {
              const blackPairing = await storage.createPairing({
                tournamentId,
                round: fromRound,
                playerId: pairing.blackPlayer.id,
                opponentId: pairing.whitePlayer.id,
                color: 'black',
                points: 0,
                isBye: false,
                byeType: null,
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
        const swissPairings = generateSwissPairings(players, matchesForPairing, round);
        
        // Save matches and pairings for this round
        for (const pairing of swissPairings) {
          // Create match
          const match = await storage.createMatch({
            tournamentId,
            round,
            board: pairing.board,
            whitePlayerId: pairing.whitePlayer.id,
            blackPlayerId: pairing.blackPlayer?.id || null,
            result: null,
            status: 'pending'
          });
          allNewMatches.push(match);

          // Create pairings for both players
          if (pairing.whitePlayer) {
            const whitePairing = await storage.createPairing({
              tournamentId,
              round,
              playerId: pairing.whitePlayer.id,
              opponentId: pairing.blackPlayer?.id || null,
              color: 'white',
              points: pairing.isBye ? (pairing.byeType === 'full_point' ? 1 : 0.5) : 0,
              isBye: pairing.isBye,
              byeType: pairing.byeType || null,
            });
            allNewPairings.push(whitePairing);
          }

          if (pairing.blackPlayer) {
            const blackPairing = await storage.createPairing({
              tournamentId,
              round,
              playerId: pairing.blackPlayer.id,
              opponentId: pairing.whitePlayer.id,
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
  
  // Sort groups by score (highest first) and players within groups by rating (highest first)
  return Object.keys(groups)
    .sort((a, b) => parseFloat(b) - parseFloat(a))
    .map(score => groups[score].sort((a, b) => (b.player.rating || 0) - (a.player.rating || 0)));
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
  
  // Strong color preference (2+ game difference)
  if (p1Balance <= -2) return { whitePlayer: player1.player, blackPlayer: player2.player };
  if (p1Balance >= 2) return { whitePlayer: player2.player, blackPlayer: player1.player };
  if (p2Balance <= -2) return { whitePlayer: player2.player, blackPlayer: player1.player };
  if (p2Balance >= 2) return { whitePlayer: player1.player, blackPlayer: player2.player };

  // Moderate color preference (1 game difference)
  if (p1Balance === -1 && p2Balance >= 0) return { whitePlayer: player1.player, blackPlayer: player2.player };
  if (p1Balance === 1 && p2Balance <= 0) return { whitePlayer: player2.player, blackPlayer: player1.player };
  if (p2Balance === -1 && p1Balance >= 0) return { whitePlayer: player2.player, blackPlayer: player1.player };
  if (p2Balance === 1 && p1Balance <= 0) return { whitePlayer: player1.player, blackPlayer: player2.player };

  // No strong preference - higher rated player gets white
  if ((player1.player.rating || 0) > (player2.player.rating || 0)) {
    return { whitePlayer: player1.player, blackPlayer: player2.player };
  } else {
    return { whitePlayer: player2.player, blackPlayer: player1.player };
  }
}

function generateSwissPairings(players: any[], matches: any[], round: number) {
  // Server-side Swiss pairing implementation following USCF rules
  const pairings = [];
  
  if (round === 1) {
    // First round: sort by rating and pair upper half vs lower half
    const sortedPlayers = players.sort((a, b) => (b.rating || 0) - (a.rating || 0));
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
    const playerStats = calculatePlayerStats(players, matches);
    
    // Group by score (Rule #2: Equal scores)
    const scoreGroups = groupPlayersByScore(playerStats);
    const unpaired = [];
    let boardNumber = 1;
    
    // Process each score group from highest to lowest
    for (const scoreGroup of scoreGroups) {
      // Add any unpaired players from higher score groups
      const playersToProcess = [...unpaired, ...scoreGroup];
      unpaired.length = 0; // Clear unpaired array
      
      // Rule #3: Upper-half vs lower-half within score group
      const pairedInGroup = pairUpperVsLowerHalf(playersToProcess, matches, round);
      
      // Add successful pairings
      for (const [player1, player2] of pairedInGroup.paired) {
        const colors = determineSwissColors(player1, player2);
        
        pairings.push({
          whitePlayerId: colors.whitePlayer.id,
          blackPlayerId: colors.blackPlayer.id,
          board: boardNumber++,
          isBye: false,
        });
      }
      
      // Carry over unpaired players to next score group
      unpaired.push(...pairedInGroup.unpaired);
    }
    
    // Handle final unpaired players (cross-score-group pairing if needed)
    while (unpaired.length > 1) {
      const player1 = unpaired.shift()!;
      const player2 = unpaired.shift()!;
      
      const colors = determineSwissColors(player1, player2);
      
      pairings.push({
        whitePlayerId: colors.whitePlayer.id,
        blackPlayerId: colors.blackPlayer.id,
        board: boardNumber++,
        isBye: false,
      });
    }
    
    // Handle any remaining player with half-point bye (lowest rated gets bye)
    if (unpaired.length === 1) {
      pairings.push({
        whitePlayerId: unpaired[0].player.id,
        blackPlayerId: null,
        board: 0,
        isBye: true,
        byeType: 'half_point', // Half-point bye for odd number
      });
    }
  }
  
  // Sort pairings by board order - highest point totals on top boards
  return sortPairingsByPointTotal(pairings, players, matches);
}

function sortPairingsByPointTotal(pairings: any[], players: any[], matches: any[]): any[] {
  // Create a map for quick player stats lookup
  const playerStats = calculatePlayerStats(players, matches);
  const statsMap = new Map();
  playerStats.forEach((stat: any) => {
    statsMap.set(stat.player.id, {
      points: stat.points,
      rating: stat.player.rating || 0,
      tiebreak: stat.points * 1000 + (stat.player.rating || 0) // Points weighted heavily + rating
    });
  });

  // Sort pairings by HIGHEST individual player tiebreak (USCF Board 1 rule)
  // Board 1 gets the player with highest tiebreak paired with appropriate opponent
  const sortedPairings = pairings.filter(p => !p.isBye).sort((a, b) => {
    const aWhiteStats = statsMap.get(a.whitePlayerId);
    const aBlackStats = statsMap.get(a.blackPlayerId);
    const bWhiteStats = statsMap.get(b.whitePlayerId);
    const bBlackStats = statsMap.get(b.blackPlayerId);

    if (!aWhiteStats || !aBlackStats || !bWhiteStats || !bBlackStats) return 0;

    // Get the HIGHEST tiebreak player on each board (this determines board order)
    const aHighestTiebreak = Math.max(aWhiteStats.tiebreak, aBlackStats.tiebreak);
    const bHighestTiebreak = Math.max(bWhiteStats.tiebreak, bBlackStats.tiebreak);

    // Board with highest individual tiebreak goes first (Board 1)
    return bHighestTiebreak - aHighestTiebreak;
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
