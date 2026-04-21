import { pgTable, text, serial, integer, boolean, timestamp, varchar, numeric, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
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
  phoneNumber: varchar("phone_number", { length: 20 }),
  carrier: varchar("carrier", { length: 60 }),
  notifyEmail: boolean("notify_email").default(true),
  notifySms: boolean("notify_sms").default(false),
  emailVerified: boolean("email_verified").default(false).notNull(),
  paymentSettings: jsonb("payment_settings"),
  fcmToken: text("fcm_token"),
  notifyPairings: boolean("notify_pairings").default(true),
  notifyRegistration: boolean("notify_registration").default(true),
  notifyTournamentStatus: boolean("notify_tournament_status").default(true),
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
  code: varchar("code", { length: 6 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const verificationCodes = pgTable("verification_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  code: varchar("code", { length: 6 }).notNull(),
  type: varchar("type", { length: 20 }).notNull().default('email_verification'), // 'email_verification'
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const tournaments = pgTable("tournaments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  format: text("format").notNull(), // 'swiss', 'roundrobin', 'knockout', 'arena'
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
  publishOnCalendar: boolean("publish_on_calendar").default(false),
  allowOnlineRegistration: boolean("allow_online_registration").default(false),
  enablePairingPredictor: boolean("enable_pairing_predictor").default(false),
  chessResultsUrl: text("chess_results_url"),
  boardNumberingSettings: jsonb("board_numbering_settings"),
  seedingMethod: text("seeding_method").default("rating"), // "rating", "random", "slaughter", "manual"
  seedingSource: text("seeding_source").default("rating"), // "rating", "uscf", "fide"
  matchWinConditions: jsonb("match_win_conditions"), // for knockout matchups
  primaryRatingSystem: text("primary_rating_system").default("uscf"),
  isDoubleElimination: boolean("is_double_elimination").default(false),
  createdBy: integer("created_by").notNull(), // User ID of tournament director
  arenaDuration: integer("arena_duration"), // in minutes
  arenaStartTime: timestamp("arena_start_time"),
  arenaScoringConfig: jsonb("arena_scoring_config"), // e.g. { streakThreshold: 2, winBonus: 2, ... }
  arenaEndStrategy: text("arena_end_strategy").default("wait_for_ongoing").notNull(), // 'force_end', 'wait_for_ongoing'
  arenaPairingMode: text("arena_pairing_mode").default("manual").notNull(), // 'manual', 'automatic'
  arenaCutoffMinutes: integer("arena_cutoff_minutes").default(2).notNull(),
  arenaCountdownSeconds: integer("arena_countdown_seconds").default(10).notNull(),
  arenaPrePairBeforeStart: boolean("arena_pre_pair_before_start").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const tournamentStars = pgTable(
  "tournament_stars",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    tournamentId: integer("tournament_id")
      .references(() => tournaments.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    userTournamentUnique: uniqueIndex("tournament_stars_user_tournament_idx").on(
      table.userId,
      table.tournamentId,
    ),
  }),
);

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  rating: integer("rating").default(1000),
  uscfRating: integer("uscf_rating"),
  fideRating: integer("fide_rating"),
  federation: text("federation").default('USCF'),
  seed: integer("seed"),
  halfPointByesUsed: integer("half_point_byes_used").default(0),
  fullPointByesReceived: integer("full_point_byes_received").default(0),
  forfeitWinsReceived: integer("forfeit_wins_received").default(0),
  isActiveTd: boolean("is_active_td").default(false), // Only one player per tournament can be active TD
  sectionId: text("section_id"),
  sectionName: text("section_name"),
  arenaStatus: text("arena_status").default('lobby').notNull(), // 'lobby', 'playing', 'paused'
  arenaPoints: numeric("arena_points", { precision: 10, scale: 2 }).default("0").notNull(),
  arenaStreak: integer("arena_streak").default(0).notNull(),
  onFire: boolean("on_fire").default(false).notNull(),
  lastOpponentId: integer("last_opponent_id"),
  colorDelta: integer("color_delta").default(0).notNull(),
  consecutiveColor: text("consecutive_color"), // e.g. 'WW', 'BB'
  status: text("status").default('active').notNull(), // 'active', 'withdrawn', 'placeholder'
  email: text("email"),
  phone: text("phone"),
  club: text("club"),
  title: text("title"),
  birthdate: text("birthdate"),
  sex: text("sex"),
  localId: text("local_id"),
  ratingLocal: integer("rating_local"),
  ratingRapid: integer("rating_rapid"),
  ratingBlitz: integer("rating_blitz"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
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
  isBye: boolean("is_bye").default(false),
  whitePoints: numeric("white_points", { precision: 5, scale: 2 }),
  blackPoints: numeric("black_points", { precision: 5, scale: 2 }),
  gameNumber: integer("game_number").default(1),
  bracketType: text("bracket_type").default("winners"), // 'winners', 'losers', 'grand_final'
  sectionId: text("section_id"), // for multi-section knockout support
  winnerId: integer("winner_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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

export const playerRegistrations = pgTable("player_registrations", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").references(() => tournaments.id, { onDelete: "cascade" }).notNull(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  playerName: varchar("player_name", { length: 100 }),
  uscfRating: integer("uscf_rating"),
  fideRating: integer("fide_rating"),
  ratingProvider: varchar("rating_provider", { length: 20 }),
  uscfId: varchar("uscf_id", { length: 20 }),
  fideId: varchar("fide_id", { length: 20 }),
  phoneNumber: varchar("phone_number", { length: 20 }),
  email: varchar("email", { length: 255 }),
  address1: varchar("address1", { length: 255 }),
  address2: varchar("address2", { length: 255 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 100 }),
  postalCode: varchar("postal_code", { length: 20 }),
  country: varchar("country", { length: 100 }),
  pairingNotifications: varchar("pairing_notifications", { length: 20 }),
  newsletter: boolean("newsletter").default(false),
  sectionChoice: varchar("section_choice", { length: 100 }),
  entryFeeId: varchar("entry_fee_id", { length: 50 }),
  processingContribution: numeric("processing_contribution", { precision: 10, scale: 2 }).default("0"),
  byePreference: varchar("bye_preference", { length: 10 }),
  byeRounds: jsonb("bye_rounds").default([]),
  arrivalTime: varchar("arrival_time", { length: 50 }),
  notes: text("notes"),
  paymentStatus: varchar("payment_status", { length: 30 }).notNull().default("unpaid"),
  paymentIntentId: varchar("payment_intent_id", { length: 128 }),
  paymentMethod: varchar("payment_method", { length: 30 }),
  paymentReceiptUrl: text("payment_receipt_url"),
  paymentNotes: text("payment_notes"),
  amountDue: numeric("amount_due", { precision: 10, scale: 2 }).default("0"),
  amountPaid: numeric("amount_paid", { precision: 10, scale: 2 }).default("0"),
  currency: varchar("currency", { length: 10 }).default("USD"),
  paidAt: timestamp("paid_at"),
  status: varchar("status", { length: 20 }).default("pending").notNull(), // pending, approved, declined
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("info"), // 'registration_status', 'pairing', 'payment', 'info'
  read: boolean("read").default(false).notNull(),
  meta: jsonb("meta"), // For storing links or related IDs like tournamentId
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  paymentSettings: true,
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
  phoneNumber: z.string().trim().optional(),
  notifyEmail: z.boolean().optional(),
  notifyPairings: z.boolean().optional(),
  notifyRegistration: z.boolean().optional(),
  notifyTournamentStatus: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const forgotUsernameSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6).regex(/^\d+$/),
  newPassword: z.string().min(6),
});

export const verifyEmailSchema = z.object({
  code: z.string().length(6).regex(/^\d+$/),
  email: z.string().email().optional(), // Optional: for verification without auth token
});

export const resendVerificationSchema = z.object({
  email: z.string().email().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
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

export const insertPlayerRegistrationSchema = createInsertSchema(playerRegistrations).omit({
  id: true,
  updatedAt: true,
});

export const insertTournamentStarSchema = createInsertSchema(tournamentStars).omit({
  id: true,
  createdAt: true,
});

export const insertNotificationSchema = createInsertSchema(notifications).omit({
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
export type VerifyEmailData = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationData = z.infer<typeof resendVerificationSchema>;
export type ChangePasswordData = z.infer<typeof changePasswordSchema>;
export type Session = typeof sessions.$inferSelect;
export type PasswordReset = typeof passwordResets.$inferSelect;
export type VerificationCode = typeof verificationCodes.$inferSelect;
export type InsertVerificationCode = typeof verificationCodes.$inferInsert;

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
export type PlayerRegistration = typeof playerRegistrations.$inferSelect;
export type InsertPlayerRegistration = z.infer<typeof insertPlayerRegistrationSchema>;
export type TournamentStar = typeof tournamentStars.$inferSelect;
export type InsertTournamentStar = z.infer<typeof insertTournamentStarSchema>;

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

