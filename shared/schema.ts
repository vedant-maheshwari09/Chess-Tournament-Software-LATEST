import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

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
});

export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  tournamentId: integer("tournament_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  rating: integer("rating").default(1000),
  federation: text("federation").default('USCF'),
  seed: integer("seed"),
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
});

export const insertTournamentSchema = createInsertSchema(tournaments).omit({
  id: true,
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

export type Tournament = typeof tournaments.$inferSelect;
export type InsertTournament = z.infer<typeof insertTournamentSchema>;
export type Player = typeof players.$inferSelect;
export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type Match = typeof matches.$inferSelect;
export type InsertMatch = z.infer<typeof insertMatchSchema>;
export type Pairing = typeof pairings.$inferSelect;
export type InsertPairing = z.infer<typeof insertPairingSchema>;
