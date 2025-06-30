import { pgTable, text, serial, integer, boolean, timestamp, varchar } from "drizzle-orm/pg-core";
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
