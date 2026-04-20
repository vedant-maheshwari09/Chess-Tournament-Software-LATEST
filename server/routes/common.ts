import { normalizePlayerName } from './util';
import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from '../storage';
import { setupVite, serveStatic, log } from '../vite';
import { z } from "zod";
import Stripe from "stripe";
import {
  insertTournamentSchema,
  insertPlayerSchema,
  insertMatchSchema,
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  forgotUsernameSchema,
  resetPasswordSchema,
  changePasswordSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  type Player,
  type Pairing,
  type Match,
  type PlayerRegistration,
} from "@shared/schema";
import {
  hashPassword,
  verifyPassword,
  createSession,
  requireAuth,
  requireRole,
  requireTournamentAccess,
  generateSessionToken
} from '../auth';
import { sendEmailVerificationCode, sendPasswordResetCode } from '../emailVerification';
import { generateRoundRobinSchedule, validateRoundRobinSchedule } from '../round-robin';
import { notificationService } from '../notifications';
import { searchUSCF, searchFide, type LocalRatingResult, type LocalSearchParams } from '../lib/localRatings';
import {
  initializeChessResultsSchedulers,
  syncChessResults,
  testChessResultsConnection,
  updateChessResultsScheduler,
} from '../services/chessResults';
import {
  parseTournamentConfig,
  serializeTournamentConfig,
  type PaymentSettings,
  type EntryFeeRule,
  type AccountPaymentSettings,
} from "@shared/tournament-config";
import { generateFideTrf16Report } from '../lib/fideTrf';
import { lookupFideProfiles, searchFideDirectory } from '../lib/fideDirectory';
import { getPointsForResult } from "@shared/match-results";

export type RatingSource = "uscf" | "fide";


export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
export const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY ?? "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

export const PAYMENT_STATUSES = ["unpaid", "processing", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface RatingLookupResult {
  source: RatingSource;
  id: string;
  name: string;
  rating?: string;
  ratingDisplay?: string;
  location?: string;
  extra?: string;
  extraRatings?: Array<{
    type: "quick" | "blitz" | "rapid";
    label: string;
    value?: string;
    display?: string;
  }>;
  metadata?: Record<string, string | undefined>;
  sex?: string;
  birthYear?: string;
}


export async function lookupUSCF(params: LocalSearchParams, limit = 30): Promise<RatingLookupResult[]> {
  const results = await searchUSCF(params, limit);
  return results.map((entry) => mapLocalResult("uscf", entry));
}

export async function lookupFide(params: LocalSearchParams, limit = 30): Promise<RatingLookupResult[]> {
  const results = await searchFide(params, limit);
  return results.map((entry) => mapLocalResult("fide", entry));
}

export function mapLocalResult(source: RatingSource, entry: LocalRatingResult): RatingLookupResult {
  const extraRatings: RatingLookupResult["extraRatings"] = [];
  if (entry.quickRating) {
    extraRatings.push({
      type: "quick",
      label: "Quick",
      value: entry.quickRating.value,
      display: entry.quickRating.raw ?? entry.quickRating.value,
    });
  }
  if (entry.rapidRating) {
    extraRatings.push({
      type: "rapid",
      label: "Rapid",
      value: entry.rapidRating.value,
      display: entry.rapidRating.raw ?? entry.rapidRating.value,
    });
  }
  if (entry.blitzRating) {
    extraRatings.push({
      type: "blitz",
      label: "Blitz",
      value: entry.blitzRating.value,
      display: entry.blitzRating.raw ?? entry.blitzRating.value,
    });
  }

  const location = entry.location ?? entry.federation ?? undefined;
  const extra = source === "fide" ? entry.title ?? undefined : undefined;
  const metadata: Record<string, string | undefined> = { ...entry.metadata };
  if (source === "fide" && entry.birthYear) {
    metadata.birthYear = entry.birthYear;
  }
  if (source === "uscf" && entry.location) {
    metadata.state = entry.location;
  }

  const cleanedMetadata = Object.values(metadata).some((value) => value)
    ? metadata
    : undefined;

  return {
    source,
    id: entry.id,
    name: entry.name,
    rating: entry.rating?.value,
    ratingDisplay: entry.rating?.raw ?? entry.rating?.value,
    location,
    extra,
    extraRatings: extraRatings.length > 0 ? extraRatings : undefined,
    metadata: cleanedMetadata,
    sex: entry.sex,
    birthYear: entry.birthYear,
  };
}

export function extractQueryParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeSearchParams(params: LocalSearchParams): LocalSearchParams {
  const normalized: LocalSearchParams = {};
  if (params.term) normalized.term = params.term;
  if (params.lastName) normalized.lastName = params.lastName;
  if (params.firstName) normalized.firstName = params.firstName;
  if (params.id) normalized.id = params.id;
  return normalized;
}

export function parseLimitParam(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function getGeminiConfig() {
  return {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-pro",
  } as const;
}

export function normalizeCurrency(input: unknown, fallback: string): string {
  if (typeof input !== "string" || input.trim().length < 3) return fallback;
  return input.trim().toUpperCase();
}

export function computePaymentTotals(
  entryFee: EntryFeeRule | null,
  contribution: number,
  paymentConfig: PaymentSettings,
) {
  const currency = normalizeCurrency(entryFee?.currency, paymentConfig.defaultCurrency ?? "USD");
  const baseAmount = (entryFee?.amount ?? 0) + contribution;
  const percent = Number(paymentConfig.processingFeePercent ?? 0);
  const feeAmount = percent > 0 ? Number((baseAmount * (percent / 100)).toFixed(2)) : 0;
  const total = Number((baseAmount + feeAmount).toFixed(2));
  return {
    subtotal: Number(baseAmount.toFixed(2)),
    feeAmount,
    total,
    currency,
  };
}

export const paymentProviderEnum = z.enum(["stripe", "paypal"]);
export const paymentScopeEnum = z.enum(["tournament", "account"]);
export const offlineMethodEnum = z.enum(["cash", "check", "venmo", "zelle", "paypal", "other"]);

export const updateTournamentPaymentsSchema = z.object({
  provider: paymentProviderEnum,
  defaultCurrency: z.string().trim().length(3).optional(),
  onlineEnabled: z.boolean().optional(),
  requirePaymentOnRegistration: z.boolean().optional(),
  allowProcessingContribution: z.boolean().optional(),
  processingFeePercent: z
    .number({ invalid_type_error: "processingFeePercent must be a number" })
    .min(0)
    .max(100)
    .nullable()
    .optional(),
  stripeAccountId: z.string().trim().optional(),
  stripePublishableKey: z.string().trim().optional(),
  payoutStatementDescriptor: z.string().trim().optional(),
  paypalMerchantId: z.string().trim().optional(),
  paypalClientId: z.string().trim().optional(),
  paypalEmail: z.string().trim().email().optional(),
  connectionScope: paymentScopeEnum.optional(),
  acceptedOfflineMethods: z.array(offlineMethodEnum).optional(),
  offlineInstructions: z.string().trim().optional(),
});

export const accountPaymentSettingsSchema = z.object({
  preferredProvider: paymentProviderEnum.nullable().optional(),
  stripeAccountId: z.string().trim().optional(),
  stripePublishableKey: z.string().trim().optional(),
  payoutStatementDescriptor: z.string().trim().optional(),
  paypalMerchantId: z.string().trim().optional(),
  paypalClientId: z.string().trim().optional(),
  paypalEmail: z.string().trim().email().optional(),
});

export function normalizeAccountPaymentSettings(raw: unknown): AccountPaymentSettings {
  const base: AccountPaymentSettings = {
    preferredProvider: null,
  };
  if (!raw || typeof raw !== "object") {
    return base;
  }
  const parsed = accountPaymentSettingsSchema.partial().safeParse(raw);
  if (!parsed.success) {
    return base;
  }
  const data = parsed.data;
  const result: AccountPaymentSettings = {
    preferredProvider: data.preferredProvider ?? null,
  };
  if (data.stripeAccountId) result.stripeAccountId = data.stripeAccountId.trim();
  if (data.stripePublishableKey) result.stripePublishableKey = data.stripePublishableKey.trim();
  if (data.payoutStatementDescriptor) result.payoutStatementDescriptor = data.payoutStatementDescriptor.trim();
  if (data.paypalMerchantId) result.paypalMerchantId = data.paypalMerchantId.trim();
  if (data.paypalClientId) result.paypalClientId = data.paypalClientId.trim();
  if (data.paypalEmail) result.paypalEmail = data.paypalEmail.trim();
  if (typeof (raw as any)?.updatedAt === "string" && (raw as any).updatedAt.trim()) {
    result.updatedAt = (raw as any).updatedAt.trim();
  }
  return result;
}

export const geminiDraftSchema = z.object({
  config: z
    .object({
      basic: z
        .object({
          name: z.string().optional(),
          city: z.string().optional(),
          description: z.string().optional(),
          startDate: z.string().nullable().optional(),
          endDate: z.string().nullable().optional(),
          federation: z.string().optional(),
        })
        .partial()
        .optional(),
      details: z
        .object({
          rounds: z.number().optional(),
          timeControl: z.string().optional(),
          tiebreakSystem: z.string().optional(),
          pairingSystem: z.string().optional(),
          ratingType: z.string().optional(),
        })
        .partial()
        .optional(),
      schedule: z
        .array(
          z
            .object({
              label: z.string().optional(),
              date: z.string().nullable().optional(),
              time: z.string().nullable().optional(),
            })
            .passthrough(),
        )
        .optional(),
      contacts: z
        .array(
          z
            .object({
              name: z.string().optional(),
              role: z.string().optional(),
              phone: z.string().optional(),
              email: z.string().optional(),
            })
            .passthrough(),
        )
        .optional(),
    })
    .passthrough(),
});

export function formatCurrencyAmount(amount: unknown, currency: unknown): string {
  const numeric = typeof amount === "number" ? amount : Number(amount);
  const code = typeof currency === "string" && currency.trim().length === 3 ? currency.trim().toUpperCase() : "USD";
  if (!Number.isFinite(numeric)) {
    return typeof amount === "string" && amount ? amount : code;
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch (error) {
    return `${code} ${numeric.toFixed(2)}`;
  }
}

export function describeRatingWindow(min: unknown, max: unknown): string {
  const low = Number(min);
  const high = Number(max);
  const hasLow = Number.isFinite(low);
  const hasHigh = Number.isFinite(high);
  if (hasLow && hasHigh) return `Rating ${low}-${high}`;
  if (hasLow) return `Rating ${low}+`;
  if (hasHigh) return `Rating ≤${high}`;
  return "All ratings";
}

export const updateNotificationPreferencesSchema = z.object({
  phoneNumber: z.string().trim().nullable().optional(),
  carrier: z.string().trim().nullable().optional(),
  notifyEmail: z.boolean().optional(),
  notifySms: z.boolean().optional(),
  notifyPairings: z.boolean().optional(),
  notifyRegistration: z.boolean().optional(),
  notifyTournamentStatus: z.boolean().optional(),
});

export const tournamentNotificationSchema = z.object({
  subject: z.string().min(1),
  message: z.string().min(1),
  sendEmail: z.boolean().optional(),
  sendSms: z.boolean().optional(),
});

export const createPaymentIntentSchema = z.object({
  entryFeeId: z.string().trim().optional(),
  contribution: z.coerce.number().min(0).max(500).default(0),
  currency: z.string().trim().optional(),
  receiptEmail: z.string().trim().email().optional(),
  playerName: z.string().trim().optional(),
  items: z.array(z.object({
    entryFeeId: z.string().trim().optional(),
    contribution: z.coerce.number().min(0).max(500).default(0),
    playerName: z.string().trim().optional(),
  })).optional(),
});

export const playerRegistrationSchema = z.object({
  playerName: z.string().min(1, "Player name is required").transform(normalizePlayerName),
  uscfRating: z.coerce.number().optional().nullable(),
  fideRating: z.coerce.number().optional().nullable(),
  ratingProvider: z.string().trim().optional().nullable(),
  uscfId: z.string().trim().optional().nullable(),
  fideId: z.string().trim().optional().nullable(),
  phoneNumber: z.string().trim().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address1: z.string().trim().optional().nullable(),
  address2: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  postalCode: z.string().trim().optional().nullable(),
  country: z.string().trim().optional().nullable(),
  pairingNotifications: z.string().trim().optional().nullable(),
  newsletter: z.boolean().optional().default(false),
  sectionChoice: z.string().trim().optional().nullable(),
  entryFeeId: z.string().trim().optional().nullable(),
  processingContribution: z.coerce.number().optional().default(0),
  byePreference: z.string().trim().optional().nullable(),
  byeRounds: z.array(z.string()).optional().default([]),
  arrivalTime: z.string().trim().optional().nullable(),
  notes: z.string().trim().optional().nullable(),
  currency: z.string().optional().default("USD"),
  amountDue: z.coerce.number().optional().default(0),
  amountPaid: z.coerce.number().optional().default(0),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional().default("unpaid"),
  paymentIntentId: z.string().trim().optional().nullable(),
  paymentMethod: z.string().trim().optional().nullable(),
  paymentReceiptUrl: z.string().url().optional().nullable(),
  paymentNotes: z.string().trim().optional().nullable(),
});

export async function generatePairings(tournament: any, players: any[], matches: any[], existingPairings: any[], round: number, boardNumbers?: number[]) {
  const pairings = [];

  if (tournament.format === 'swiss') {
    // Use proper Swiss pairing algorithm
    const swissPairings = await generateSwissPairings(tournament, players, matches, round, existingPairings, boardNumbers);

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
export function groupPlayersByScore(playerStats: any[], tournament: any): any[][] {
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
      const tournamentConfig = parseTournamentConfig(tournament);
      const isFide = tournamentConfig.details.primaryRatingSystem === 'fide';
      const ratingA = (isFide ? (a.player.fideRating ?? a.player.rating) : (a.player.uscfRating ?? a.player.rating)) || 0;
      const ratingB = (isFide ? (b.player.fideRating ?? b.player.rating) : (b.player.uscfRating ?? b.player.rating)) || 0;
      const ratingDiff = ratingB - ratingA;
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

export function pairUpperVsLowerHalf(scoreGroup: any[], matches: any[], round: number, tournament: any): { paired: any[][], unpaired: any[] } {
  const paired: any[][] = [];
  const unpaired: any[] = [];

  if (scoreGroup.length < 2) {
    return { paired, unpaired: [...scoreGroup] };
  }

  // Sort by rating (highest first for proper upper/lower half)
  const tournamentConfig = parseTournamentConfig(tournament);
  const isFide = tournamentConfig.details.primaryRatingSystem === 'fide';
  const sortedGroup = [...scoreGroup].sort((a, b) => {
    const ratingA = (isFide ? (a.player.fideRating ?? a.player.rating) : (a.player.uscfRating ?? a.player.rating)) || 0;
    const ratingB = (isFide ? (b.player.fideRating ?? b.player.rating) : (b.player.uscfRating ?? b.player.rating)) || 0;
    return ratingB - ratingA;
  });
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



export function determineSwissColors(player1: any, player2: any, tournament: any): { whitePlayer: any, blackPlayer: any } {
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
    const tournamentConfig = parseTournamentConfig(tournament);
    const isFide = tournamentConfig.details.primaryRatingSystem === 'fide';
    const p1Rating = (isFide ? (p1Stats.player?.fideRating ?? p1Stats.player?.rating) : (p1Stats.player?.uscfRating ?? p1Stats.player?.rating)) || 0;
    const p2Rating = (isFide ? (p2Stats.player?.fideRating ?? p2Stats.player?.rating) : (p2Stats.player?.uscfRating ?? p2Stats.player?.rating)) || 0;

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

export async function generateSwissPairings(tournament: any, players: any[], matches: any[], round: number, existingPairings: any[] = [], boardNumbers?: number[]) {
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
    const tournamentConfig = parseTournamentConfig(tournament);
    const isFide = tournamentConfig.details.primaryRatingSystem === 'fide';
    const sortedPlayers = [...activePlayers].sort((a, b) => {
      const ratingA = (isFide ? (a.fideRating ?? a.rating) : (a.uscfRating ?? a.rating)) || 0;
      const ratingB = (isFide ? (b.fideRating ?? b.rating) : (b.uscfRating ?? b.rating)) || 0;
      return ratingB - ratingA;
    });
    const isOdd = sortedPlayers.length % 2 === 1;
    const numPairs = Math.floor(sortedPlayers.length / 2);
    const resolvedBoardNumbers = boardNumbers ?? generateBoardNumberSequence(tournament.boardNumberingSettings, numPairs + (isOdd ? 1 : 0));

    const upperHalf = sortedPlayers.slice(0, numPairs);
    const lowerHalf = sortedPlayers.slice(numPairs, isOdd ? -1 : sortedPlayers.length);

    const firstBoardWhiteIsUpper = Math.random() < 0.5;

    for (let i = 0; i < upperHalf.length && i < lowerHalf.length; i++) {
      const upperPlayer = upperHalf[i];
      const lowerPlayer = lowerHalf[i];
      const upperPlayerIsWhite = i === 0 ? firstBoardWhiteIsUpper : (i % 2 === 0) === firstBoardWhiteIsUpper;

      pairings.push({
        whitePlayerId: upperPlayerIsWhite ? upperPlayer.id : lowerPlayer.id,
        blackPlayerId: upperPlayerIsWhite ? lowerPlayer.id : upperPlayer.id,
        board: resolvedBoardNumbers[i],
        isBye: false,
      });
    }

    if (isOdd) {
      const byePlayer = sortedPlayers[sortedPlayers.length - 1]; // Lowest-rated player paired with "See T.D."
      console.log(`Round 1 - Odd number of players, pairing with "See T.D.": ${byePlayer.firstName} (rating ${byePlayer.rating})`);
      pairings.push({
        whitePlayerId: byePlayer.id,
        blackPlayerId: null,
        board: resolvedBoardNumbers[numPairs],
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
          points += getPointsForResult(match.result, "white");
        } else if (match.blackPlayerId === player.id) {
          blackGames++;
          points += getPointsForResult(match.result, "black");
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
    const tournamentConfig = parseTournamentConfig(tournament);
    const isFide = tournamentConfig.details.primaryRatingSystem === 'fide';
    const sortedPlayers = [...playerStatsWithColors].sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const ratingA = (isFide ? (a.player.fideRating ?? a.player.rating) : (a.player.uscfRating ?? a.player.rating)) || 0;
      const ratingB = (isFide ? (b.player.fideRating ?? b.player.rating) : (b.player.uscfRating ?? b.player.rating)) || 0;
      return ratingB - ratingA;
    });

    console.log('Current standings:');
    sortedPlayers.forEach((p, i) => {
      console.log(`${i + 1}. ${p.player.firstName} ${p.player.lastName}: ${p.points} points`);
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
        const p1Rating = (isFide ? (p1.player.fideRating ?? p1.player.rating) : (p1.player.uscfRating ?? p1.player.rating)) || 0;
        const p2Rating = (isFide ? (p2.player.fideRating ?? p2.player.rating) : (p2.player.uscfRating ?? p2.player.rating)) || 0;
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
      const resolvedBoardNumbers = boardNumbers ?? generateBoardNumberSequence(tournament.boardNumberingSettings, round3Pairings.length);

      for (let i = 0; i < round3Pairings.length; i++) {
        const pairing = round3Pairings[i];
        const colors = assignColors(pairing.p1, pairing.p2);
        pairings.push({
          whitePlayerId: colors.whitePlayer.id,
          blackPlayerId: colors.blackPlayer.id,
          board: resolvedBoardNumbers[i],
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
      const resolvedBoardNumbers = boardNumbers ?? generateBoardNumberSequence(tournament.boardNumberingSettings, tempPairings.length + (seeTableDirectorPlayer ? 1 : 0));
      for (let i = 0; i < tempPairings.length; i++) {
        const pairing = tempPairings[i];
        const colors = assignColors(pairing.p1, pairing.p2);
        pairings.push({
          whitePlayerId: colors.whitePlayer.id,
          blackPlayerId: colors.blackPlayer.id,
          board: resolvedBoardNumbers[i],
          isBye: false,
        });
      }

      // Add "See T.D." pairing for the odd player
      if (seeTableDirectorPlayer) {
        pairings.push({
          whitePlayerId: seeTableDirectorPlayer.player.id,
          blackPlayerId: null,
          board: resolvedBoardNumbers[tempPairings.length],
          isBye: false, // Not a bye - it's a pairing with "See T.D."
          opponentName: "See T.D.",
        });
      }
    }
  }

  return pairings;
}

// ============== BOARD NUMBERING ==============

export type BoardNumberingSettings = {
  start?: number;
  increment?: number;
  gaps?: { afterBoard: number; skip: number }[];
  customSequence?: number[];
};

export function generateBoardNumberSequence(
  settings: BoardNumberingSettings | null | undefined,
  count: number,
): number[] {
  if (!settings) {
    // Default: 1, 2, 3, ...
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  if (settings.customSequence && settings.customSequence.length > 0) {
    return settings.customSequence.slice(0, count);
  }

  const sequence: number[] = [];
  let currentBoard = settings.start ?? 1;
  const increment = settings.increment ?? 1;
  const gaps = settings.gaps ? [...settings.gaps].sort((a, b) => a.afterBoard - b.afterBoard) : [];

  while (sequence.length < count) {
    sequence.push(currentBoard);

    // Apply gap if needed
    const applicableGap = gaps.find((g) => g.afterBoard === currentBoard);
    if (applicableGap) {
      currentBoard += applicableGap.skip;
    }

    // Increment for the next board
    currentBoard += increment;
  }

  return sequence;
}

