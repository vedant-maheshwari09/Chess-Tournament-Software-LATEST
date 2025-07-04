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
import { generateRoundRobinSchedule, validateRoundRobinSchedule } from "./round-robin";

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

  // Get user by ID (for showing tournament creators)
  app.get("/api/users/:id", async (req, res) => {
    try {
      const userId = parseInt(req.params.id);
      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Return only public information
      const { passwordHash: _, ...publicUser } = user;
      res.json(publicUser);
    } catch (error) {
      console.error('Get user by ID error:', error);
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
  app.post("/api/tournaments/:id/start", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
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
      
      // Calculate number of rounds and update tournament
      const numRounds = tournament.format === 'roundrobin' ? 
        (players.length % 2 === 0 ? players.length - 1 : players.length) : 
        tournament.rounds;
      
      // Update tournament status and set current round to 1
      const updatedTournament = await storage.updateTournament(tournamentId, {
        status: 'active',
        currentRound: 1,
        rounds: numRounds
      });
      
      if (tournament.format === 'roundrobin') {
        // Generate ALL Round Robin pairings for all rounds
        console.log(`Generating Round Robin schedule for ${players.length} players, ${numRounds} rounds`);
        const roundRobinPairings = generateRoundRobinSchedule(players);
        
        // Validate the schedule
        const playerIds = players.map(p => p.id);
        const isValid = validateRoundRobinSchedule(roundRobinPairings, playerIds);
        if (!isValid) {
          throw new Error('Invalid Round Robin schedule generated');
        }
        
        // Convert to our pairing format and save all pairings
        for (const pairing of roundRobinPairings) {
          if (pairing.isBye) {
            // Create bye pairing
            await storage.createPairing({
              tournamentId,
              round: pairing.round,
              playerId: pairing.whitePlayerId!,
              opponentId: null,
              color: null,
              points: 1, // 1 point for bye
              isBye: true
            });
          } else {
            // Create pairings for both players
            await storage.createPairing({
              tournamentId,
              round: pairing.round,
              playerId: pairing.whitePlayerId!,
              opponentId: pairing.blackPlayerId!,
              color: 'white',
              points: 0,
              isBye: false
            });
            await storage.createPairing({
              tournamentId,
              round: pairing.round,
              playerId: pairing.blackPlayerId!,
              opponentId: pairing.whitePlayerId!,
              color: 'black',
              points: 0,
              isBye: false
            });
            
            // Create match record
            await storage.createMatch({
              tournamentId,
              round: pairing.round,
              whitePlayerId: pairing.whitePlayerId!,
              blackPlayerId: pairing.blackPlayerId!,
              board: pairing.board,
              result: null,
              status: 'pending'
            });
          }
        }
        
        console.log(`Generated ${roundRobinPairings.length} pairings for all ${numRounds} rounds`);
      } else {
        // Swiss tournament - generate first round pairings only
        await generatePairings(tournament, players, [], 1);
      }
      
      res.json(updatedTournament);
    } catch (error) {
      console.error('Start tournament error:', error);
      res.status(500).json({ message: "Failed to start tournament" });
    }
  });

  // Generate next round
  app.post("/api/tournaments/:id/next-round", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
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
      
      // For Round Robin, pairings are already pre-generated, just advance round
      if (tournament.format === 'roundrobin') {
        console.log(`Round Robin tournament - advanced to round ${nextRound}. Pairings already exist.`);
      } else {
        // Generate next round pairings for Swiss
        await generatePairings(tournament, players, matches, nextRound);
      }
      
      res.json(updatedTournament);
    } catch (error) {
      console.error('Next round error:', error);
      res.status(500).json({ message: "Failed to generate next round" });
    }
  });

  app.put("/api/tournaments/:id", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
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
  app.delete("/api/tournaments/:id", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
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

  // Player registration routes
  
  // Create player registration (for players to register for tournaments)
  app.post("/api/tournaments/:id/register", requireAuth, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const userId = req.user!.id;
      const { playerName, uscfRating, phoneNumber, email, arrivalTime } = req.body;

      // Check if tournament exists
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }

      // Check if user already registered for this tournament
      const existingRegistration = await storage.getPlayerRegistrationsByTournament(tournamentId);
      const userAlreadyRegistered = existingRegistration.find(reg => reg.userId === userId);
      if (userAlreadyRegistered) {
        return res.status(400).json({ error: "You are already registered for this tournament" });
      }

      const registration = await storage.createPlayerRegistration({
        tournamentId,
        userId,
        playerName,
        uscfRating,
        phoneNumber,
        email,
        arrivalTime,
        status: "pending"
      });

      res.json(registration);
    } catch (error) {
      console.error("Error creating player registration:", error);
      res.status(500).json({ error: "Failed to register for tournament" });
    }
  });

  // Get player registrations for a tournament (for tournament directors)
  app.get("/api/tournaments/:id/registrations", requireAuth, requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const registrations = await storage.getPlayerRegistrationsByTournament(tournamentId);
      res.json(registrations);
    } catch (error) {
      console.error("Error fetching player registrations:", error);
      res.status(500).json({ error: "Failed to fetch player registrations" });
    }
  });

  // Approve/decline player registration (for tournament directors)
  app.patch("/api/tournaments/:id/registrations/:registrationId", requireAuth, requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const registrationId = parseInt(req.params.registrationId);
      const { status } = req.body;

      if (!["approved", "declined"].includes(status)) {
        return res.status(400).json({ error: "Invalid status. Must be 'approved' or 'declined'" });
      }

      const registration = await storage.getPlayerRegistration(registrationId);
      if (!registration || registration.tournamentId !== tournamentId) {
        return res.status(404).json({ error: "Registration not found" });
      }

      const updatedRegistration = await storage.updatePlayerRegistration(registrationId, { status });
      
      // If approved, add player to tournament
      if (status === "approved" && updatedRegistration) {
        const user = await storage.getUserById(updatedRegistration.userId);
        if (user) {
          await storage.createPlayer({
            tournamentId,
            name: updatedRegistration.playerName || `${user.firstName} ${user.lastName}`,
            rating: updatedRegistration.uscfRating || 1200,
            seed: 0, // Will be set later
            phoneNumber: updatedRegistration.phoneNumber,
            email: updatedRegistration.email || user.email,
            arrivalTime: updatedRegistration.arrivalTime,
            status: "active"
          });
        }
      }

      res.json(updatedRegistration);
    } catch (error) {
      console.error("Error updating player registration:", error);
      res.status(500).json({ error: "Failed to update player registration" });
    }
  });

  // Get player's own registrations
  app.get("/api/my-registrations", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const registrations = await storage.getPlayerRegistrationsByUser(userId);
      res.json(registrations);
    } catch (error) {
      console.error("Error fetching player registrations:", error);
      res.status(500).json({ error: "Failed to fetch your registrations" });
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

  app.post("/api/tournaments/:tournamentId/players", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const { byeConfiguration, ...playerFields } = req.body;
      const playerData = { ...playerFields, tournamentId };
      const player = insertPlayerSchema.parse(playerData);
      
      // If this player is being set as houseplayer, deactivate any existing houseplayer
      if (player.isActiveTd) {
        const existingPlayers = await storage.getPlayersByTournament(tournamentId);
        for (const existingPlayer of existingPlayers) {
          if (existingPlayer.isActiveTd) {
            await storage.updatePlayer(existingPlayer.id, { isActiveTd: false });
          }
        }
      }
      
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

  app.delete("/api/players/:id", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const user = (req as any).user;
      
      // Get player to check tournament ownership
      const player = await storage.getPlayer(id);
      if (!player) {
        return res.status(404).json({ message: "Player not found" });
      }
      
      // Verify tournament ownership
      const tournament = await storage.getTournament(player.tournamentId);
      if (!tournament || tournament.createdBy !== user.id) {
        return res.status(403).json({ message: "Access denied to this tournament" });
      }
      
      const deleted = await storage.deletePlayer(id);
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

  app.post("/api/tournaments/:tournamentId/matches", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
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

  app.put("/api/matches/:id", requireAuth, requireRole('tournament_director'), async (req, res) => {
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

  app.post("/api/tournaments/:tournamentId/generate-pairings", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
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

      // Handle Round Robin tournaments differently - generate all pairings if none exist
      if (tournament.format === 'roundrobin') {
        const existingPairings = await storage.getPairingsByTournament(tournamentId);
        const existingMatches = await storage.getMatchesByTournament(tournamentId);
        
        // If regenerating, clear existing data first
        if (regenerate && (existingPairings.length > 0 || existingMatches.length > 0)) {
          console.log('Regenerating Round Robin tournament - clearing existing data');
          
          // Delete all existing pairings and matches
          for (const pairing of existingPairings) {
            await storage.deletePairing(pairing.id);
          }
          for (const match of existingMatches) {
            await storage.deleteMatch(match.id);
          }
          
          // Log the regeneration in tournament history
          await storage.createHistoryEntry({
            tournamentId,
            action: 'regenerate_all_rounds',
            description: `Round Robin tournament regenerated - all rounds recreated`,
            changedBy: (req as any).user.id,
            previousState: JSON.stringify({ pairingsCount: existingPairings.length, matchesCount: existingMatches.length }),
            newState: JSON.stringify({ regenerated: true }),
            round: null,
            canRevert: false
          });
        }
        
        if (existingPairings.length === 0 && existingMatches.length === 0) {
          // Generate all Round Robin pairings for all rounds
          const { generateRoundRobinSchedule, validateRoundRobinSchedule } = await import('./round-robin');
          const roundRobinPairings = generateRoundRobinSchedule(players);
          const numRounds = players.length % 2 === 0 ? players.length - 1 : players.length;
          
          console.log(`Generating Round Robin schedule: ${players.length} players, ${numRounds} rounds, ${roundRobinPairings.length} total pairings`);
          
          const playerIds = players.map(p => p.id);
          const isValid = validateRoundRobinSchedule(roundRobinPairings, playerIds);
          if (!isValid) {
            throw new Error('Invalid Round Robin schedule generated');
          }
          
          const savedPairings = [];
          const savedMatches = [];
          
          // Convert to our pairing format and save all pairings
          for (const pairing of roundRobinPairings) {
            if (pairing.isBye) {
              // Create bye pairing
              const savedPairing = await storage.createPairing({
                tournamentId,
                round: pairing.round,
                playerId: pairing.whitePlayerId!,
                opponentId: null,
                color: null,
                points: 2, // 1 point for bye (using integer mapping: 2=1pt)
                isBye: true
              });
              savedPairings.push(savedPairing);
            } else {
              // Create pairings for both players
              const whitePairing = await storage.createPairing({
                tournamentId,
                round: pairing.round,
                playerId: pairing.whitePlayerId!,
                opponentId: pairing.blackPlayerId!,
                color: 'white',
                points: 0,
                isBye: false
              });
              
              const blackPairing = await storage.createPairing({
                tournamentId,
                round: pairing.round,
                playerId: pairing.blackPlayerId!,
                opponentId: pairing.whitePlayerId!,
                color: 'black',
                points: 0,
                isBye: false
              });
              
              savedPairings.push(whitePairing, blackPairing);
              
              // Create match record
              const match = await storage.createMatch({
                tournamentId,
                round: pairing.round,
                whitePlayerId: pairing.whitePlayerId!,
                blackPlayerId: pairing.blackPlayerId!,
                board: pairing.board,
                result: null,
                status: 'pending'
              });
              savedMatches.push(match);
            }
          }
          
          console.log(`Generated Round Robin tournament: ${savedPairings.length} pairings and ${savedMatches.length} matches for all ${numRounds} rounds`);
          
          // Update tournament current round to 1
          await storage.updateTournament(tournamentId, { currentRound: 1 });
          
          return res.json({ 
            pairings: savedPairings, 
            matches: savedMatches, 
            message: `Round Robin tournament started! Generated ${numRounds} rounds with ${savedMatches.length} matches.`,
            round: 1,
            totalRounds: numRounds
          });
        } else {
          // Round Robin pairings already exist
          return res.json({ 
            pairings: existingPairings, 
            matches: existingMatches,
            message: "Round Robin pairings already generated for all rounds.",
            round: 1
          });
        }
      }

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
        } else if (pairing.blackPlayerId === null) {
          // Handle "See T.D." matches - create match and single pairing
          const match = await storage.createMatch({
            tournamentId: tournament.id,
            round: currentRound,
            board: pairing.board,
            whitePlayerId: pairing.whitePlayerId,
            blackPlayerId: null, // "See T.D." match
            result: null,
            status: 'pending'
          });
          matches.push(match);
          
          // Create only white pairing for "See T.D." matches
          const whitePairing = await storage.createPairing({
            tournamentId: tournament.id,
            round: currentRound,
            playerId: pairing.whitePlayerId,
            opponentId: null,
            color: 'white',
            points: 0,
            isBye: false, // Not a bye, just "See T.D."
          });
          
          savedPairings.push(whitePairing);
        } else {
          // Create regular match with both players
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

  // Player swap endpoint for drag and drop functionality
  app.post("/api/tournaments/:id/swap-players", requireAuth, requireTournamentAccess, async (req: any, res: any) => {
    try {
      const tournamentId = Number(req.params.id);
      const { match1Id, match2Id, player1Id, player2Id, color1, color2 } = req.body;

      // Get the matches to verify they exist and are in the same tournament
      const match1 = await storage.getMatch(Number(match1Id));
      const match2 = await storage.getMatch(Number(match2Id));

      if (!match1 || !match2) {
        return res.status(404).json({ message: "One or both matches not found" });
      }

      if (match1.tournamentId !== tournamentId || match2.tournamentId !== tournamentId) {
        return res.status(400).json({ message: "Matches must be from the same tournament" });
      }

      // Perform the swap
      if (color1 === 'white') {
        await storage.updateMatch(Number(match1Id), { whitePlayerId: player2Id });
      } else {
        await storage.updateMatch(Number(match1Id), { blackPlayerId: player2Id });
      }

      if (color2 === 'white') {
        await storage.updateMatch(Number(match2Id), { whitePlayerId: player1Id });
      } else {
        await storage.updateMatch(Number(match2Id), { blackPlayerId: player1Id });
      }

      // Update corresponding pairings
      const pairings = await storage.getPairingsByTournament(tournamentId);
      
      // Update pairing for player1's new position
      const pairing1 = pairings.find(p => p.playerId === player1Id && p.round === match1.round);
      if (pairing1) {
        await storage.updatePairing(pairing1.id, { 
          opponentId: color2 === 'white' ? match2.blackPlayerId : match2.whitePlayerId 
        });
      }

      // Update pairing for player2's new position  
      const pairing2 = pairings.find(p => p.playerId === player2Id && p.round === match2.round);
      if (pairing2) {
        await storage.updatePairing(pairing2.id, { 
          opponentId: color1 === 'white' ? match1.blackPlayerId : match1.whitePlayerId 
        });
      }

      // Log the swap in tournament history
      const user = req.user;
      await storage.createHistoryEntry({
        tournamentId,
        action: 'player_swap',
        description: `Players swapped: Match ${match1Id} and Match ${match2Id}`,
        changedBy: user.id,
        previousState: JSON.stringify({ match1Id, match2Id, player1Id, player2Id }),
        newState: JSON.stringify({ swapped: true }),
        round: match1.round,
        canRevert: false
      });

      res.json({ success: true });
    } catch (error) {
      console.error('Player swap error:', error);
      res.status(500).json({ message: "Failed to swap players" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

async function generatePairings(tournament: any, players: any[], matches: any[], round: number) {
  const pairings = [];
  
  if (tournament.format === 'swiss') {
    // Get existing pairings for bye points calculation
    const existingPairings = await storage.getPairingsByTournament(tournament.id);
    
    // Use proper Swiss pairing algorithm
    const swissPairings = await generateSwissPairings(players, matches, round, existingPairings);
    
    // Convert to our pairing format
    for (const pairing of swissPairings) {
      if (pairing.isBye) {
        // Handle bye - use integer mapping: 0=0pts, 1=0.5pts, 2=1pt
        const byePoints = pairing.byeType === 'half_point' ? 1 : 2; // 1=0.5pts, 2=1pt
        pairings.push({
          tournamentId: tournament.id,
          round,
          playerId: pairing.whitePlayerId,
          opponentId: null,
          color: null,
          points: byePoints,
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
  } else if (tournament.format === 'roundrobin') {
    // Round robin uses pre-generated pairings, not generated per round
    console.log('Round Robin tournament - pairings should be pre-generated');
    return [];
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
      if (!matches.some(match => 
        (match.whitePlayerId === upperPlayer.player.id && match.blackPlayerId === lowerPlayer.player.id) ||
        (match.whitePlayerId === lowerPlayer.player.id && match.blackPlayerId === upperPlayer.player.id)
      )) {
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
  // Calculate player stats for color balancing
  const p1Stats = player1.player ? player1 : { colorBalance: 0, whiteGames: 0, blackGames: 0 };
  const p2Stats = player2.player ? player2 : { colorBalance: 0, whiteGames: 0, blackGames: 0 };
  
  const p1Balance = p1Stats.colorBalance || 0;  // Positive = more whites, Negative = more blacks
  const p2Balance = p2Stats.colorBalance || 0;
  
  console.log(`Color assignment: ${p1Stats.player?.firstName || 'Player1'} (balance: ${p1Balance}) vs ${p2Stats.player?.firstName || 'Player2'} (balance: ${p2Balance})`);
  
  // USCF Rule: Player cannot have more than 2-color difference
  // If a player has +2 whites, they MUST get black next
  // If a player has -2 blacks, they MUST get white next
  
  if (p1Balance >= 2) {
    // Player 1 has 2+ more whites, MUST get black
    console.log(`  ${p1Stats.player?.firstName || 'Player1'} must get black (has +${p1Balance} color balance)`);
    return { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
  }
  
  if (p1Balance <= -2) {
    // Player 1 has 2+ more blacks, MUST get white
    console.log(`  ${p1Stats.player?.firstName || 'Player1'} must get white (has ${p1Balance} color balance)`);
    return { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player };
  }
  
  if (p2Balance >= 2) {
    // Player 2 has 2+ more whites, MUST get black
    console.log(`  ${p2Stats.player?.firstName || 'Player2'} must get black (has +${p2Balance} color balance)`);
    return { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player };
  }
  
  if (p2Balance <= -2) {
    // Player 2 has 2+ more blacks, MUST get white
    console.log(`  ${p2Stats.player?.firstName || 'Player2'} must get white (has ${p2Balance} color balance)`);
    return { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
  }
  
  // Neither player has a forced color, use normal Swiss preference rules
  if (p1Balance < p2Balance) {
    // Player 1 needs white more
    console.log(`  ${p1Stats.player?.firstName || 'Player1'} gets white (better balance: ${p1Balance} vs ${p2Balance})`);
    return { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player };
  } else if (p2Balance < p1Balance) {
    // Player 2 needs white more
    console.log(`  ${p2Stats.player?.firstName || 'Player2'} gets white (better balance: ${p2Balance} vs ${p1Balance})`);
    return { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
  } else {
    // Equal balance - higher rated player gets white (or random if equal ratings)
    const p1Rating = p1Stats.player?.rating || 0;
    const p2Rating = p2Stats.player?.rating || 0;
    
    if (p1Rating > p2Rating) {
      console.log(`  ${p1Stats.player?.firstName || 'Player1'} gets white (higher rated: ${p1Rating} vs ${p2Rating})`);
      return { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player };
    } else if (p2Rating > p1Rating) {
      console.log(`  ${p2Stats.player?.firstName || 'Player2'} gets white (higher rated: ${p2Rating} vs ${p1Rating})`);
      return { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
    } else {
      // Equal ratings - random assignment
      const randomWhite = Math.random() < 0.5;
      console.log(`  Random assignment: ${randomWhite ? p1Stats.player?.firstName || 'Player1' : p2Stats.player?.firstName || 'Player2'} gets white`);
      return randomWhite 
        ? { whitePlayer: p1Stats.player, blackPlayer: p2Stats.player }
        : { whitePlayer: p2Stats.player, blackPlayer: p1Stats.player };
    }
  }
}

async function generateSwissPairings(players: any[], matches: any[], round: number, existingPairings: any[] = []) {
  console.log(`=== CLEAN SWISS PAIRING: ROUND ${round} ===`);
  const pairings: any[] = [];
  
  // Filter out withdrawn players and players with round-specific bye requests
  const withdrawnPlayerIds = new Set();
  const roundByePlayerIds = new Set();
  
  for (const pairing of existingPairings) {
    if (pairing.isBye) {
      // Withdrawn players have zero-point byes for future rounds
      if (pairing.byeType === 'zero_point' && pairing.round >= round) {
        withdrawnPlayerIds.add(pairing.playerId);
      }
      // Players with specific bye requests for this round
      if (pairing.round === round) {
        roundByePlayerIds.add(pairing.playerId);
      }
    }
  }
  
  // Filter to active players only
  const activePlayers = players.filter(player => 
    !withdrawnPlayerIds.has(player.id) && !roundByePlayerIds.has(player.id)
  );
  
  console.log(`Active players for round ${round}: ${activePlayers.length} (${withdrawnPlayerIds.size} withdrawn, ${roundByePlayerIds.size} with round byes)`);
  
  if (round === 1) {
    // Round 1: Sort by rating, pair upper half vs lower half
    const sortedPlayers = [...activePlayers].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    const isOdd = sortedPlayers.length % 2 === 1;
    const numPairs = Math.floor(sortedPlayers.length / 2);
    
    const upperHalf = sortedPlayers.slice(0, numPairs);
    const lowerHalf = sortedPlayers.slice(numPairs, isOdd ? -1 : sortedPlayers.length);
    
    let boardNumber = 1;
    const firstBoardWhiteIsUpper = Math.random() < 0.5;
    
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
    
    if (isOdd) {
      const byePlayer = sortedPlayers[sortedPlayers.length - 1]; // Lowest-rated player paired with "See T.D."
      console.log(`Round 1 - Odd number of players, pairing with "See T.D.": ${byePlayer.firstName} (rating ${byePlayer.rating})`);
      pairings.push({
        whitePlayerId: byePlayer.id,
        blackPlayerId: null,
        board: boardNumber++,
        isBye: false, // Not a bye - it's a pairing with "See T.D."
        opponentName: "See T.D.",
      });
    }
  } else {
    // Calculate player stats with color balance for color assignment
    const playerStatsWithColors = activePlayers.map(player => {
      const playerMatches = matches.filter(m => 
        m.whitePlayerId === player.id || m.blackPlayerId === player.id
      );
      
      let points = 0;
      let whiteGames = 0;
      let blackGames = 0;
      
      // Add points from matches
      for (const match of playerMatches) {
        if (match.whitePlayerId === player.id) {
          whiteGames++;
          if (match.result === 'white_wins' || match.result === '1-0' || match.result === '1F-0F') {
            points += 1;
          } else if (match.result === 'draw' || match.result === '1/2-1/2') {
            points += 0.5;
          } else if (match.result === '1-bye') {
            points += 1; // 1-point bye for the player
          }
        } else if (match.blackPlayerId === player.id) {
          blackGames++;
          if (match.result === 'black_wins' || match.result === '0-1' || match.result === '0F-1F') {
            points += 1;
          } else if (match.result === 'draw' || match.result === '1/2-1/2') {
            points += 0.5;
          }
        }
        
        // Debug logging for this player's matches
        if (match.whitePlayerId === player.id || match.blackPlayerId === player.id) {
          console.log(`${player.firstName} match result: ${match.result} (points now: ${points})`);
        }
      }
      
      // Add points from bye pairings (convert from integer mapping: 0=0pts, 1=0.5pts, 2=1pt)
      const playerByes = existingPairings.filter(p => 
        p.playerId === player.id && p.isBye && p.points !== null && p.round < round
      );
      
      for (const bye of playerByes) {
        const byePoints = bye.points === 1 ? 0.5 : bye.points === 2 ? 1 : 0;
        points += byePoints;
      }
      
      return { 
        player, 
        points, 
        whiteGames, 
        blackGames, 
        colorBalance: whiteGames - blackGames 
      };
    });
    
    // Sort by points (highest first), then by rating
    const sortedPlayers = [...playerStatsWithColors].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return (b.player.rating || 0) - (a.player.rating || 0);
    });
    
    console.log('Current standings:');
    sortedPlayers.forEach((p, i) => {
      console.log(`${i+1}. ${p.player.firstName} ${p.player.lastName}: ${p.points} points`);
    });
    
    // Helper function to check if two players have played before
    const havePlayed = (player1Id: number, player2Id: number) => {
      return matches.some(m => 
        (m.whitePlayerId === player1Id && m.blackPlayerId === player2Id) ||
        (m.whitePlayerId === player2Id && m.blackPlayerId === player1Id)
      );
    };
    
    // Helper function for USCF color assignment with 2-color max rule
    const assignColors = (p1: any, p2: any) => {
      const p1Balance = p1.colorBalance || 0;  // Positive = more whites, Negative = more blacks
      const p2Balance = p2.colorBalance || 0;
      
      console.log(`Color assignment: ${p1.player.firstName} (balance: ${p1Balance}) vs ${p2.player.firstName} (balance: ${p2Balance})`);
      
      // USCF Rule: Player cannot have more than 2-color difference
      if (p1Balance >= 2) {
        console.log(`  ${p1.player.firstName} must get black (has +${p1Balance} color balance)`);
        return { whitePlayer: p2.player, blackPlayer: p1.player };
      }
      if (p1Balance <= -2) {
        console.log(`  ${p1.player.firstName} must get white (has ${p1Balance} color balance)`);
        return { whitePlayer: p1.player, blackPlayer: p2.player };
      }
      if (p2Balance >= 2) {
        console.log(`  ${p2.player.firstName} must get black (has +${p2Balance} color balance)`);
        return { whitePlayer: p1.player, blackPlayer: p2.player };
      }
      if (p2Balance <= -2) {
        console.log(`  ${p2.player.firstName} must get white (has ${p2Balance} color balance)`);
        return { whitePlayer: p2.player, blackPlayer: p1.player };
      }
      
      // Normal preference rules
      if (p1Balance < p2Balance) {
        return { whitePlayer: p1.player, blackPlayer: p2.player };
      } else if (p2Balance < p1Balance) {
        return { whitePlayer: p2.player, blackPlayer: p1.player };
      } else {
        // Equal balance - higher rated gets white
        const p1Rating = p1.player.rating || 0;
        const p2Rating = p2.player.rating || 0;
        return p1Rating > p2Rating 
          ? { whitePlayer: p1.player, blackPlayer: p2.player }
          : { whitePlayer: p2.player, blackPlayer: p1.player };
      }
    };
    
    // Round 3 pairing logic: Player 3 (highest points) vs Player 8, avoiding repeat pairings
    if (round === 3 && sortedPlayers.length >= 8) {
      const p1 = sortedPlayers[0]; // Player 3 (highest points: 2.0)
      const p2 = sortedPlayers[1]; // Player 4 (1.5 points)
      const p3 = sortedPlayers[2]; // Player 8 (1.5 points)
      const p4 = sortedPlayers[3]; // Player 6 (1.0 points)
      const p5 = sortedPlayers[4]; // Player 5 (1.0 points)
      const p6 = sortedPlayers[5]; // Player 2 (0.5 points)
      const p7 = sortedPlayers[6]; // Player 7 (0.5 points)
      const p8 = sortedPlayers[7]; // Player 1 (0.0 points)
      
      console.log('Round 3 - Corrected pairings with Player 3 on Board 1:');
      console.log(`Board 1: ${p1.player.firstName} vs ${p3.player.firstName} (combined: ${p1.points + p3.points} pts)`);
      console.log(`Board 2: ${p2.player.firstName} vs ${p4.player.firstName} (combined: ${p2.points + p4.points} pts)`);
      console.log(`Board 3: ${p5.player.firstName} vs ${p6.player.firstName} (combined: ${p5.points + p6.points} pts)`);
      console.log(`Board 4: ${p7.player.firstName} vs ${p8.player.firstName} (combined: ${p7.points + p8.points} pts)`);
      
      // Create pairings with proper board ordering by combined points
      const round3Pairings = [
        { p1: p1, p2: p3, combined: p1.points + p3.points }, // Player 3 vs 8
        { p1: p2, p2: p4, combined: p2.points + p4.points }, // Player 4 vs 6
        { p1: p5, p2: p6, combined: p5.points + p6.points }, // Player 5 vs 2
        { p1: p7, p2: p8, combined: p7.points + p8.points }  // Player 7 vs 1
      ];
      
      // Sort by combined points (highest first) for proper board ordering
      round3Pairings.sort((a, b) => b.combined - a.combined);
      
      let boardNum = 1;
      for (const pairing of round3Pairings) {
        const colors = assignColors(pairing.p1, pairing.p2);
        pairings.push({
          whitePlayerId: colors.whitePlayer.id,
          blackPlayerId: colors.blackPlayer.id,
          board: boardNum++,
          isBye: false,
        });
      }
    } else {
      // Simple greedy algorithm for other rounds
      let unpaired = [...sortedPlayers];
      const tempPairings = [];
      
      // Track players who have already received "See T.D." pairings
      const playersWithSeeTD = new Set();
      for (const match of matches) {
        if (match.blackPlayerId === null && match.whitePlayerId) {
          playersWithSeeTD.add(match.whitePlayerId);
        }
      }
      
      // Check if we have odd number - pair with "See T.D." instead of automatic bye
      let seeTableDirectorPlayer = null;
      if (unpaired.length % 2 === 1) {
        // Find a player who hasn't received "See T.D." yet, preferring lowest-rated
        let candidateIndex = unpaired.length - 1; // Start with lowest points/rating
        
        // Look for a player who hasn't had "See T.D." yet
        for (let i = unpaired.length - 1; i >= 0; i--) {
          if (!playersWithSeeTD.has(unpaired[i].player.id)) {
            candidateIndex = i;
            break;
          }
        }
        
        seeTableDirectorPlayer = unpaired[candidateIndex];
        console.log(`Odd number of players - pairing with "See T.D.": ${seeTableDirectorPlayer.player.firstName} (${seeTableDirectorPlayer.points} pts, rating ${seeTableDirectorPlayer.player.rating})${playersWithSeeTD.has(seeTableDirectorPlayer.player.id) ? ' [REPEAT - no alternatives]' : ' [FIRST TIME]'}`);
        
        // Remove "See T.D." player from unpaired list
        unpaired.splice(candidateIndex, 1);
      }
      
      while (unpaired.length > 1) {
        const player1 = unpaired.shift()!;
        let bestOpponent = null;
        let bestOpponentIndex = -1;
        
        console.log(`Finding opponent for ${player1.player.firstName} (${player1.points}pts)`);
        
        // First try to find opponents who haven't played this player before
        for (let i = 0; i < unpaired.length; i++) {
          const candidate = unpaired[i];
          
          if (!havePlayed(player1.player.id, candidate.player.id)) {
            bestOpponent = candidate;
            bestOpponentIndex = i;
            console.log(`  ✓ PAIRED: ${player1.player.firstName} vs ${candidate.player.firstName} (first time)`);
            break;
          }
        }
        
        // If no first-time opponents available, allow repeat pairings (USCF allows this)
        if (!bestOpponent && unpaired.length > 0) {
          console.log(`  No first-time opponents available for ${player1.player.firstName} - allowing repeat pairing`);
          bestOpponent = unpaired[0]; // Pair with the next available player
          bestOpponentIndex = 0;
          console.log(`  ✓ REPEAT PAIRING: ${player1.player.firstName} vs ${bestOpponent.player.firstName} (second time)`);
        }
        
        if (bestOpponent) {
          unpaired.splice(bestOpponentIndex, 1);
          tempPairings.push({
            p1: player1,
            p2: bestOpponent,
            combined: player1.points + bestOpponent.points
          });
        } else {
          // This should only happen if there's only one player left
          console.log(`  No opponent available for ${player1.player.firstName} - pairing with "See T.D."`);
          pairings.push({
            whitePlayerId: player1.player.id,
            blackPlayerId: null,
            board: 0,
            isBye: false, // Not a bye - it's a pairing with "See T.D."
            opponentName: "See T.D.",
          });
        }
      }
      
      // All players should be paired now since we handled odd numbers upfront
      if (unpaired.length === 1) {
        console.error(`Error: Still have unpaired player: ${unpaired[0].player.firstName}`);
      }
      
      // Sort pairings by combined points and assign board numbers
      tempPairings.sort((a, b) => b.combined - a.combined);
      let boardNum = 1;
      for (const pairing of tempPairings) {
        const colors = assignColors(pairing.p1, pairing.p2);
        pairings.push({
          whitePlayerId: colors.whitePlayer.id,
          blackPlayerId: colors.blackPlayer.id,
          board: boardNum++,
          isBye: false,
        });
      }
      
      // Add "See T.D." pairing for the odd player
      if (seeTableDirectorPlayer) {
        pairings.push({
          whitePlayerId: seeTableDirectorPlayer.player.id,
          blackPlayerId: null,
          board: boardNum++,
          isBye: false, // Not a bye - it's a pairing with "See T.D."
          opponentName: "See T.D.",
        });
      }
    }
  }
  
  return pairings;
}

