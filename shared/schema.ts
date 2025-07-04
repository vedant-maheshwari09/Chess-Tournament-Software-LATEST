import { pgTable, text, serial, integer, boolean, timestamp, varchar, numeric, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User management tables
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  role: text("role").notNull().default('player'), // 'player', 'tournament_director'  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const passwordResets = pgTable("password_resets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const tournaments = pgTable("tournaments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  format: text("format").notNull(), // 'swiss', 'roundrobin', 'knockout'
  status: text("status").notNull().default('draft'), // 'draft', 'active', 'completed'
  rounds: integer("rounds"), // for swiss
  timeControl: text("time_control"),
  currentRound: integer("current_round").default(0),
  isDoubleRoundRobin: boolean("is_double_round_robin").default(false),
  playerCount: integer("player_count"), // for quick setup mode
  useQuickSetup: boolean("use_quick_setup").default(false),
  tiebreakOrder: text("tiebreak_order").default("rating"), // "rating" or "uscf" (Modified Median, Solkoff, Cumulative)
  location: text("location"), // Tournament venue/location
  directorPhone: text("director_phone"), // Tournament director phone number
  directorEmail: text("director_email"), // Tournament director email
  roundTimings: jsonb("round_timings"), // Array of {round: number, date: string, time: string}
  createdBy: integer("created_by").notNull(), // User ID of tournament director
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  rating: integer("rating").default(1000),
  federation: text("federation").default('USCF'),
  seed: integer("seed"),
  halfPointByesUsed: integer("half_point_byes_used").default(0),
  fullPointByesReceived: integer("full_point_byes_received").default(0),
  forfeitWinsReceived: integer("forfeit_wins_received").default(0),
  isActiveTd: boolean("is_active_td").default(false), // Only one player per tournament can be active TD
});

export const matches = pgTable("matches", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  round: integer("round").notNull(),
  board: integer("board"),
  whitePlayerId: integer("white_player_id"),
  blackPlayerId: integer("black_player_id"),
  result: text("result"), // '1-0', '0-1', '1/2-1/2', null for pending
  status: text("status").notNull().default('pending'), // 'pending', 'in_progress', 'completed'
});

export const pairings = pgTable("pairings", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  round: integer("round").notNull(),
  playerId: integer("player_id").notNull(),
  opponentId: integer("opponent_id"),
  color: text("color"), // 'white', 'black'
  points: integer("points").default(0),
  isBye: boolean("is_bye").default(false),
  byeType: text("bye_type"), // 'half_point', 'full_point', null
  isRequested: boolean("is_requested").default(false), // true for player-requested byes, false for automatic
});

export const byeRequests = pgTable("bye_requests", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  playerId: integer("player_id").notNull(),
  round: integer("round").notNull(),
  byeType: text("bye_type").notNull(), // 'half_point', 'full_point'
  status: text("status").notNull().default('requested'), // 'requested', 'approved', 'cancelled'
  requestedAt: timestamp("requested_at").defaultNow(),
});

export const tournamentHistory = pgTable("tournament_history", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  action: text("action").notNull(), // 'result_change', 'pairing_regeneration', 'player_added', 'player_removed', 'round_generated'
  description: text("description").notNull(),
  changedBy: integer("changed_by").notNull(), // User ID who made the change
  previousState: text("previous_state"), // JSON snapshot of relevant data before change
  newState: text("new_state"), // JSON snapshot of relevant data after change
  round: integer("round"), // Which round was affected (if applicable)
  matchId: integer("match_id"), // Which match was affected (if applicable)
  playerId: integer("player_id"), // Which player was affected (if applicable)
  canRevert: boolean("can_revert").default(true), // Whether this change can be undone
  createdAt: timestamp("created_at").defaultNow(),
});

// User schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const loginSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6),
});

export const registerSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(['player', 'tournament_director']),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const forgotUsernameSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(6),
});

export const insertTournamentSchema = createInsertSchema(tournaments).omit({
  id: true,
  createdBy: true, // This will be set on the backend
  createdAt: true,
  updatedAt: true,
});

export const insertPlayerSchema = createInsertSchema(players).omit({
  id: true,
  seed: true,
});

export const insertMatchSchema = createInsertSchema(matches).omit({
  id: true,
});

export const insertPairingSchema = createInsertSchema(pairings).omit({
  id: true,
});

export const insertByeRequestSchema = createInsertSchema(byeRequests).omit({
  id: true,
  requestedAt: true,
});

export const insertTournamentHistorySchema = createInsertSchema(tournamentHistory).omit({
  id: true,
  createdAt: true,
});

// User types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type LoginData = z.infer<typeof loginSchema>;
export type RegisterData = z.infer<typeof registerSchema>;
export type ForgotPasswordData = z.infer<typeof forgotPasswordSchema>;
export type ForgotUsernameData = z.infer<typeof forgotUsernameSchema>;
export type ResetPasswordData = z.infer<typeof resetPasswordSchema>;
export type Session = typeof sessions.$inferSelect;
export type PasswordReset = typeof passwordResets.$inferSelect;

// Tournament types
export type Tournament = typeof tournaments.$inferSelect;
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Match = typeof matches.$inferSelect;
export type InsertMatch = z.infer<typeof insertMatchSchema>;
export type Pairing = typeof pairings.$inferSelect;
export type InsertPairing = z.infer<typeof insertPairingSchema>;
export type ByeRequest = typeof byeRequests.$inferSelect;
export type InsertByeRequest = z.infer<typeof insertByeRequestSchema>;
export type TournamentHistory = typeof tournamentHistory.$inferSelect;
export type InsertTournamentHistory = z.infer<typeof insertTournamentHistorySchema>;
