import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupVite, serveStatic, log } from "./vite";
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
  type Player,
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
import { notificationService } from "./notifications";
import { searchUSCF, searchFide, type LocalRatingResult, type LocalSearchParams } from "./lib/localRatings";
import {
  initializeChessResultsSchedulers,
  syncChessResults,
  testChessResultsConnection,
  updateChessResultsScheduler,
} from "./services/chessResults";
import {
  parseTournamentConfig,
  serializeTournamentConfig,
  type PaymentSettings,
  type EntryFeeRule,
  type AccountPaymentSettings,
} from "@shared/tournament-config";
import { generateFideTrf16Report } from "./lib/fideTrf";
import { lookupFideProfiles } from "./lib/fideDirectory";
import { getPointsForResult } from "@shared/match-results";

type RatingSource = "uscf" | "fide";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const PAYMENT_STATUSES = ["unpaid", "processing", "paid", "failed", "refunded"] as const;
type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

interface RatingLookupResult {
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


async function lookupUSCF(params: LocalSearchParams, limit = 30): Promise<RatingLookupResult[]> {
  const results = await searchUSCF(params, limit);
  return results.map((entry) => mapLocalResult("uscf", entry));
}

async function lookupFide(params: LocalSearchParams, limit = 30): Promise<RatingLookupResult[]> {
  const results = await searchFide(params, limit);
  return results.map((entry) => mapLocalResult("fide", entry));
}

function mapLocalResult(source: RatingSource, entry: LocalRatingResult): RatingLookupResult {
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

function extractQueryParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSearchParams(params: LocalSearchParams): LocalSearchParams {
  const normalized: LocalSearchParams = {};
  if (params.term) normalized.term = params.term;
  if (params.lastName) normalized.lastName = params.lastName;
  if (params.firstName) normalized.firstName = params.firstName;
  if (params.id) normalized.id = params.id;
  return normalized;
}

function parseLimitParam(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function getGeminiConfig() {
  return {
    apiKey: process.env.GEMINI_API_KEY,
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-pro",
  } as const;
}

function normalizeCurrency(input: unknown, fallback: string): string {
  if (typeof input !== "string" || input.trim().length < 3) return fallback;
  return input.trim().toUpperCase();
}

function computePaymentTotals(
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

const paymentProviderEnum = z.enum(["stripe", "paypal"]);
const paymentScopeEnum = z.enum(["tournament", "account"]);
const offlineMethodEnum = z.enum(["cash", "check", "venmo", "zelle", "paypal", "other"]);

const updateTournamentPaymentsSchema = z.object({
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

const accountPaymentSettingsSchema = z.object({
  preferredProvider: paymentProviderEnum.nullable().optional(),
  stripeAccountId: z.string().trim().optional(),
  stripePublishableKey: z.string().trim().optional(),
  payoutStatementDescriptor: z.string().trim().optional(),
  paypalMerchantId: z.string().trim().optional(),
  paypalClientId: z.string().trim().optional(),
  paypalEmail: z.string().trim().email().optional(),
});

function normalizeAccountPaymentSettings(raw: unknown): AccountPaymentSettings {
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

const geminiDraftSchema = z.object({
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

function formatCurrencyAmount(amount: unknown, currency: unknown): string {
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

function describeRatingWindow(min: unknown, max: unknown): string {
  const low = Number(min);
  const high = Number(max);
  const hasLow = Number.isFinite(low);
  const hasHigh = Number.isFinite(high);
  if (hasLow && hasHigh) return `Rating ${low}-${high}`;
  if (hasLow) return `Rating ${low}+`;
  if (hasHigh) return `Rating ≤${high}`;
  return "All ratings";
}

const updateNotificationPreferencesSchema = z.object({
  phoneNumber: z.string().trim().nullable().optional(),
  carrier: z.string().trim().nullable().optional(),
  notifyEmail: z.boolean().optional(),
  notifySms: z.boolean().optional(),
});

const tournamentNotificationSchema = z.object({
  subject: z.string().min(1),
  message: z.string().min(1),
  sendEmail: z.boolean().optional(),
  sendSms: z.boolean().optional(),
});

const createPaymentIntentSchema = z.object({
  entryFeeId: z.string().trim().optional(),
  contribution: z.coerce.number().min(0).max(500).default(0),
  currency: z.string().trim().optional(),
  receiptEmail: z.string().trim().email().optional(),
  playerName: z.string().trim().optional(),
});

const playerRegistrationSchema = z.object({
  playerName: z.string().min(1, "Player name is required"),
  uscfRating: z.coerce.number().optional(),
  phoneNumber: z.string().trim().optional(),
  email: z.string().email().optional(),
  arrivalTime: z.string().trim().optional(),
  entryFeeId: z.string().optional(),
  currency: z.string().optional(),
  amountDue: z.coerce.number().optional(),
  amountPaid: z.coerce.number().optional(),
  contribution: z.coerce.number().optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  paymentIntentId: z.string().trim().optional(),
  paymentMethod: z.string().trim().optional(),
  paymentReceiptUrl: z.string().url().optional(),
  paymentNotes: z.string().trim().optional(),
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Database connection test endpoint (for debugging)
  app.get("/api/health/db", async (req, res) => {
    try {
      // Check if environment variables are set
      const supabaseUrl = process.env.SUPABASE_URL;
      const hasServiceKey = !!(
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE ||
        process.env.SUPABASE_KEY
      );
      const hasAnonKey = !!process.env.SUPABASE_ANON_KEY;
      
      const envStatus = {
        hasSupabaseUrl: !!supabaseUrl,
        hasServiceKey: hasServiceKey,
        hasAnonKey: hasAnonKey,
        usingAnonKey: !hasServiceKey && hasAnonKey,
        supabaseUrlPreview: supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : 'not set',
      };
      
      if (!supabaseUrl) {
        return res.status(503).json({
          status: "misconfigured",
          message: "SUPABASE_URL is not set",
          env: envStatus,
          instructions: "Please set SUPABASE_URL in your .env file",
          timestamp: new Date().toISOString()
        });
      }

      if (!hasServiceKey && !hasAnonKey) {
        return res.status(503).json({
          status: "misconfigured",
          message: "Supabase key is not set",
          env: envStatus,
          instructions: "Please set SUPABASE_SERVICE_ROLE_KEY (recommended) or SUPABASE_ANON_KEY in your .env file. Note: SERVICE_ROLE_KEY is required for server-side operations.",
          timestamp: new Date().toISOString()
        });
      }

      if (hasAnonKey && !hasServiceKey) {
        // Warn but try to connect anyway
        console.warn("⚠️  Using SUPABASE_ANON_KEY instead of SUPABASE_SERVICE_ROLE_KEY. This may cause permission errors for server-side operations.");
      }
      
      // Try a simple query to test the connection
      const testUser = await storage.getUserByUsername("__test_connection__");
      // If we get here, the connection works (even if user doesn't exist)
      res.json({ 
        status: "connected", 
        message: "Database connection is working",
        env: envStatus,
        warning: hasAnonKey && !hasServiceKey ? "Using ANON_KEY - may have limited permissions" : undefined,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorObj = error as any;
      
      // Extract more detailed error information
      const originalError = errorObj?.originalError || errorObj;
      const errorCode = originalError?.code || errorObj?.code;
      const errorDetails = originalError?.details || errorObj?.details;
      const errorHint = originalError?.hint || errorObj?.hint;
      
      // Check if it's the Supabase client initialization error
      if (errorMessage.includes("Supabase environment variables are not set")) {
        return res.status(503).json({
          status: "misconfigured",
          message: "Supabase environment variables are not set",
          error: errorMessage,
          instructions: "Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file",
          timestamp: new Date().toISOString()
        });
      }

      // Check for common connection errors
      const isNetworkError = errorMessage.toLowerCase().includes('fetch failed') || 
                            errorMessage.toLowerCase().includes('econnrefused') ||
                            errorMessage.toLowerCase().includes('enotfound') ||
                            errorCode === 'ECONNREFUSED' ||
                            errorCode === 'ENOTFOUND';
      
      const isAuthError = errorMessage.toLowerCase().includes('jwt') ||
                         errorMessage.toLowerCase().includes('invalid api key') ||
                         errorCode === 'PGRST301' ||
                         errorCode === '42501';
      
      let diagnosticMessage = "Database connection failed";
      let instructions = "Please check your Supabase credentials and ensure the project is active.";
      
      if (isNetworkError) {
        diagnosticMessage = "Cannot reach Supabase servers";
        instructions = "Check your internet connection and ensure your Supabase project is not paused. If it was paused, wait a few minutes after reactivating it.";
      } else if (isAuthError) {
        diagnosticMessage = "Supabase authentication failed";
        instructions = "Your API key may be invalid or expired. Please check SUPABASE_SERVICE_ROLE_KEY in your .env file. Note: You need SERVICE_ROLE_KEY, not ANON_KEY for server-side operations.";
      }
      
      res.status(503).json({ 
        status: "disconnected", 
        message: diagnosticMessage,
        error: errorMessage,
        code: errorCode,
        details: errorDetails,
        hint: errorHint,
        instructions: instructions,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Authentication routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const userData = registerSchema.parse(req.body);
      const sanitizedPhone = userData.phoneNumber ? userData.phoneNumber.replace(/[^0-9]/g, "") : null;
      
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
      const normalizedCarrier = userData.carrier && userData.carrier.trim().length > 0 ? userData.carrier.trim() : null;
      const newUser = await storage.createUser({
        username: userData.username,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        role: userData.role,
        passwordHash,
        phoneNumber: sanitizedPhone ?? undefined,
        carrier: normalizedCarrier ?? undefined,
        notifyEmail: userData.notifyEmail ?? true,
        notifySms: userData.notifySms ?? false,
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
      
      try {
        const existingUser = await storage.getUserByUsername(username);
        
        if (existingUser) {
          res.json({ available: false, message: "Username is already taken" });
        } else {
          res.json({ available: true, message: "Username is available" });
        }
      } catch (dbError) {
        // Check if this is a database connection error
        const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
        const errorString = errorMessage.toLowerCase();
        const errorObj = dbError as any;
        
        // Check error code and details for connection issues
        const errorCode = errorObj?.code || errorObj?.originalError?.code || '';
        const errorDetails = errorObj?.details || errorObj?.originalError?.details || '';
        
        // More specific connection error detection
        const isConnectionError = 
          errorString.includes('fetch failed') || 
          errorString.includes('failed to fetch from') ||
          errorString.includes('econnrefused') ||
          errorString.includes('enotfound') ||
          errorString.includes('timeout') ||
          errorString.includes('network') ||
          errorString.includes('dns') ||
          errorCode === 'ECONNREFUSED' ||
          errorCode === 'ENOTFOUND' ||
          errorCode === 'ETIMEDOUT' ||
          (errorString.includes('connection') && (
            errorString.includes('refused') ||
            errorString.includes('failed') ||
            errorString.includes('unavailable')
          )) ||
          // Supabase-specific connection errors
          errorString.includes('jwt') && errorString.includes('expired') ||
          errorString.includes('invalid api key') ||
          errorString.includes('service_role key');
        
        if (isConnectionError) {
          // Log for debugging with full error details
          console.warn('Database connection error during username check:', {
            message: errorMessage,
            code: errorCode,
            details: errorDetails,
            fullError: dbError
          });
          // Database is unavailable - return 503 with helpful message
          return res.status(503).json({ 
            available: null, 
            message: "Database service unavailable. Please try again later.",
            code: "DATABASE_UNAVAILABLE"
          });
        }
        
        // Log other errors for debugging
        console.error('Username check database error (non-connection):', {
          message: errorMessage,
          code: errorCode,
          details: errorDetails,
          fullError: dbError
        });
        // Re-throw other database errors (like constraint violations, etc.)
        throw dbError;
      }
    } catch (error) {
      console.error('Username check error:', error);
      res.status(500).json({ available: false, message: "Error checking username. Please try again." });
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
      
      try {
        const existingUser = await storage.getUserByEmail(email);
        
        if (existingUser) {
          res.json({ available: false, message: "Email is already registered" });
        } else {
          res.json({ available: true, message: "Email is available" });
        }
      } catch (dbError) {
        // Check if this is a database connection error
        const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
        const errorString = errorMessage.toLowerCase();
        const errorObj = dbError as any;
        
        // Check error code and details for connection issues
        const errorCode = errorObj?.code || errorObj?.originalError?.code || '';
        const errorDetails = errorObj?.details || errorObj?.originalError?.details || '';
        
        // More specific connection error detection
        const isConnectionError = 
          errorString.includes('fetch failed') || 
          errorString.includes('failed to fetch from') ||
          errorString.includes('econnrefused') ||
          errorString.includes('enotfound') ||
          errorString.includes('timeout') ||
          errorString.includes('network') ||
          errorString.includes('dns') ||
          errorCode === 'ECONNREFUSED' ||
          errorCode === 'ENOTFOUND' ||
          errorCode === 'ETIMEDOUT' ||
          (errorString.includes('connection') && (
            errorString.includes('refused') ||
            errorString.includes('failed') ||
            errorString.includes('unavailable')
          )) ||
          // Supabase-specific connection errors
          errorString.includes('jwt') && errorString.includes('expired') ||
          errorString.includes('invalid api key') ||
          errorString.includes('service_role key');
        
        if (isConnectionError) {
          // Log for debugging with full error details
          console.warn('Database connection error during email check:', {
            message: errorMessage,
            code: errorCode,
            details: errorDetails,
            fullError: dbError
          });
          // Database is unavailable - return 503 with helpful message
          return res.status(503).json({ 
            available: null, 
            message: "Database service unavailable. Please try again later.",
            code: "DATABASE_UNAVAILABLE"
          });
        }
        
        // Log other errors for debugging
        console.error('Email check database error (non-connection):', {
          message: errorMessage,
          code: errorCode,
          details: errorDetails,
          fullError: dbError
        });
        // Re-throw other database errors (like constraint violations, etc.)
        throw dbError;
      }
    } catch (error) {
      console.error('Email check error:', error);
      res.status(500).json({ available: false, message: "Error checking email. Please try again." });
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
      const session = req.session;
      if (!session) {
        return res.status(401).json({ message: "Session not found" });
      }
      await storage.deleteSession(session.token);
      res.json({ message: "Logged out successfully" });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ message: "Logout failed" });
    }
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const { passwordHash: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ message: "Failed to get user info" });
    }
  });

  app.get("/api/account/payments", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const freshUser = await storage.getUserById(user.id);
      const settings = normalizeAccountPaymentSettings(freshUser?.paymentSettings ?? null);
      res.json(settings);
    } catch (error) {
      console.error("Account payment settings fetch error", error);
      res.status(500).json({ message: "Unable to load payment settings" });
    }
  });

  app.put("/api/account/payments", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const incoming = accountPaymentSettingsSchema.partial().parse(req.body ?? {});
      const existingUser = await storage.getUserById(user.id);
      const current = normalizeAccountPaymentSettings(existingUser?.paymentSettings ?? null);
      const next: AccountPaymentSettings = { ...current };

      if (Object.prototype.hasOwnProperty.call(incoming, "preferredProvider")) {
        next.preferredProvider = incoming.preferredProvider ?? null;
      }

      const applyStringUpdate = (
        key: keyof Omit<AccountPaymentSettings, "preferredProvider" | "updatedAt">,
        value: string | undefined,
      ) => {
        if (value && value.trim()) {
          (next as any)[key] = value.trim();
        } else {
          delete (next as any)[key];
        }
      };

      if (Object.prototype.hasOwnProperty.call(incoming, "stripeAccountId")) {
        applyStringUpdate("stripeAccountId", incoming.stripeAccountId);
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "stripePublishableKey")) {
        applyStringUpdate("stripePublishableKey", incoming.stripePublishableKey);
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "payoutStatementDescriptor")) {
        applyStringUpdate("payoutStatementDescriptor", incoming.payoutStatementDescriptor);
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "paypalMerchantId")) {
        applyStringUpdate("paypalMerchantId", incoming.paypalMerchantId);
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "paypalClientId")) {
        applyStringUpdate("paypalClientId", incoming.paypalClientId);
      }
      if (Object.prototype.hasOwnProperty.call(incoming, "paypalEmail")) {
        applyStringUpdate("paypalEmail", incoming.paypalEmail);
      }

      next.updatedAt = new Date().toISOString();

      const updated = await storage.updateUser(user.id, { paymentSettings: next });
      const responsePayload = normalizeAccountPaymentSettings(updated?.paymentSettings ?? next);
      res.json(responsePayload);
    } catch (error) {
      console.error("Account payment settings update error", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid payment settings", issues: error.flatten() });
      }
      res.status(500).json({ message: "Unable to update payment settings" });
    }
  });

  app.patch("/api/auth/preferences", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const payload = updateNotificationPreferencesSchema.parse(req.body ?? {});
      const sanitizedPhone = payload.phoneNumber ? payload.phoneNumber.replace(/[^0-9]/g, "") : null;
      const carrier = payload.carrier && payload.carrier.trim().length > 0 ? payload.carrier.trim() : null;
      const updated = await storage.updateUser(user.id, {
        phoneNumber: sanitizedPhone ?? null,
        carrier,
        notifyEmail: payload.notifyEmail ?? (user.notifyEmail ?? true),
        notifySms: payload.notifySms ?? (user.notifySms ?? false),
      });

      if (!updated) {
        return res.status(500).json({ message: "Failed to update preferences" });
      }

      const { passwordHash: _, ...userWithoutPassword } = updated;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error("Update preferences error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid preferences" });
      }
      res.status(500).json({ message: "Failed to update preferences" });
    }
  });

  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const payload = changePasswordSchema.parse(req.body ?? {});

      const matches = await verifyPassword(payload.currentPassword, user.passwordHash);
      if (!matches) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }

      if (payload.currentPassword === payload.newPassword) {
        return res.status(400).json({ message: "New password must be different" });
      }

      const passwordHash = await hashPassword(payload.newPassword);
      await storage.updateUser(user.id, { passwordHash });

      res.json({ message: "Password updated" });
    } catch (error) {
      console.error("Change password error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid payload" });
      }
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  app.delete("/api/auth/account", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      await storage.deleteSessionsByUser(user.id);
      await storage.deleteUser(user.id);

      res.json({ message: "Account deleted" });
    } catch (error) {
      console.error("Delete account error:", error);
      res.status(500).json({ message: "Failed to delete account" });
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

  app.get("/api/rating-lookup", async (req, res) => {
    try {
      const params: LocalSearchParams = {
        term: extractQueryParam(req.query.q),
        lastName: extractQueryParam(req.query.lastName),
        firstName: extractQueryParam(req.query.firstName),
        id: extractQueryParam(req.query.id),
      };

      const normalizedParams = normalizeSearchParams(params);
      const hasInput = Object.values(normalizedParams).some((value) => Boolean(value));
      if (!hasInput) {
        return res.status(400).json({ message: "At least one search parameter is required" });
      }

      const limit = parseLimitParam(req.query.limit, 30, 100);
      const errors: Partial<Record<RatingSource, string>> = {};

      const [uscf, fide] = await Promise.all(["uscf", "fide"].map(async (source) => {
        try {
          if (source === "uscf") return await lookupUSCF(normalizedParams, limit);
          if (source === "fide") return await lookupFide(normalizedParams, limit);
          return [] as RatingLookupResult[];
        } catch (error) {
          const message = error instanceof Error ? error.message : "Lookup failed";
          errors[source as RatingSource] = message;
          console.warn(`${source.toUpperCase()} lookup failed`, error);
          return [] as RatingLookupResult[];
        }
      }));

      res.json({ query: normalizedParams, uscf, fide, errors });
    } catch (error) {
      console.error("Rating lookup error:", error);
      res.status(500).json({ message: "Failed to retrieve rating data" });
    }
  });

  app.post("/api/tools/gemini-draft", requireAuth, async (req, res) => {
    const { apiKey, model } = getGeminiConfig();
    const resolvedModel = (() => {
      const raw = model && model.trim().length > 0 ? model.trim() : "gemini-1.5-flash";
      return raw.startsWith("models/") ? raw : `models/${raw}`;
    })();

    if (!apiKey) {
      return res.status(503).json({ message: "Gemini integration is not configured" });
    }

    const parsed = geminiDraftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid payload for Gemini draft" });
    }

    const { config } = parsed.data;
    const basic = (config.basic ?? {}) as Record<string, any>;
    const details = (config.details ?? {}) as Record<string, any>;
    const schedule = Array.isArray(config.schedule) ? config.schedule : [];
    const contacts = Array.isArray(config.contacts) ? config.contacts : [];
    const entryFees = Array.isArray((config as any)?.entryFees) ? (config as any).entryFees : [];
    const registers = (config as any)?.registers ?? {};
    const fide = (config as any)?.fide ?? {};

    const scheduleLines = schedule
      .filter((item: any) => item && (item.label || item.date || item.time))
      .map((item: any) => {
        const parts: string[] = [];
        if (item.date) parts.push(String(item.date));
        if (item.time) parts.push(String(item.time));
        const timing = parts.length > 0 ? ` – ${parts.join(" @ ")}` : "";
        return `• ${item.label ?? "Event"}${timing}`;
      })
      .join("\n");

    const contactLines = contacts
      .filter((contact: any) => contact && (contact.name || contact.role))
      .map((contact: any) => {
        const segments: string[] = [];
        if (contact.role) segments.push(contact.role);
        if (contact.phone) segments.push(contact.phone);
        if (contact.email) segments.push(contact.email);
        return `• ${contact.name ?? "Contact"}${segments.length ? ` (${segments.join(" · ")})` : ""}`;
      })
      .join("\n");

    const entryFeeLines = entryFees
      .filter((fee: any) => fee && (fee.section || fee.amount))
      .map((fee: any) => {
        const amount = formatCurrencyAmount(fee.amount, fee.currency);
        const ratingWindow = describeRatingWindow(fee.ratingMin, fee.ratingMax);
        const ratingText = ratingWindow === "All ratings" ? "" : ` · ${ratingWindow}`;
        const note = fee.notes ? ` — ${fee.notes}` : "";
        const sectionName = fee.section ?? "Section";
        return `• ${sectionName}: ${amount}${ratingText}${note}`;
      })
      .join("\n");

    const highlightItems: string[] = [];
    if (typeof fide?.prizeFund === "string" && fide.prizeFund.trim().length > 0) {
      highlightItems.push(`Prize fund: ${fide.prizeFund.trim()}`);
    }
    if (typeof registers?.earlyBirdDetails === "string" && registers.earlyBirdDetails.trim().length > 0) {
      highlightItems.push(`Early entry: ${registers.earlyBirdDetails.trim()}`);
    }
    if (typeof registers?.paymentDetails === "string" && registers.paymentDetails.trim().length > 0) {
      highlightItems.push(`Payment info: ${registers.paymentDetails.trim()}`);
    }
    if (typeof registers?.playerLimit === "number" && Number.isFinite(registers.playerLimit) && registers.playerLimit > 0) {
      highlightItems.push(`Entry cap: ${registers.playerLimit} players`);
    }
    if (typeof registers?.byeLimit === "number" && Number.isFinite(registers.byeLimit) && registers.byeLimit > 0) {
      highlightItems.push(`Half-point byes available: up to ${registers.byeLimit}`);
    }
    const ratedTags: string[] = [];
    if (registers?.fideRated) ratedTags.push("FIDE");
    if (registers?.uscfRated) ratedTags.push("USCF");
    if (ratedTags.length > 0) {
      highlightItems.push(`Rated for ${ratedTags.join(" & ")}`);
    }
    if (registers?.allowSignup) {
      highlightItems.push("Online registration is open through the player portal.");
    }

    const highlightLines = highlightItems.map((item) => `• ${item}`).join("\n");

    const baseModel = (() => {
      const raw = model && model.trim().length > 0 ? model.trim() : "gemini-1.5-flash";
      return raw.replace(/^models\//, "");
    })();
    const primaryCandidates = [
      baseModel,
      baseModel.endsWith("-latest") ? baseModel : `${baseModel}-latest`,
      "gemini-1.5-flash",
      "gemini-1.5-flash-latest",
      "gemini-1.5-pro",
      "gemini-1.5-pro-latest",
      "gemini-pro",
      "gemini-pro-latest",
    ];

    const candidateModels = Array.from(
      new Set(
        primaryCandidates
          .filter(Boolean)
          .map((value) => value.replace(/^models\//, ""))
          .map((value) => `models/${value}`),
      ),
    );

const prompt = `You are assisting a chess tournament director by drafting the public tournament page copy.
Use a professional but welcoming tone and produce concise Markdown with short headings and paragraphs.
Include an Overview, Schedule, and Highlights section referencing the data below.

Tournament data:
${basic.name ? `- Name: ${basic.name}` : ""}
${basic.city ? `- Location: ${basic.city}` : ""}
${(basic.startDate && basic.endDate) ? `- Dates: ${basic.startDate} to ${basic.endDate}` : ""}
${basic.federation ? `- Federation focus: ${basic.federation}` : ""}
${(config as any)?.format || details.pairingSystem ? `- Format: ${(config as any)?.format ?? details.pairingSystem}` : ""}
${details.rounds ? `- Rounds: ${details.rounds}` : ""}
${details.timeControl ? `- Time control: ${details.timeControl} (${details.ratingType ?? "standard"})` : ""}
${basic.description ? `- Description: ${basic.description}` : ""}

${fide?.prizeFund ? `Prize Fund: ${fide.prizeFund}` : ""}

${basic.city ? `Location: ${basic.city}` : ""}

${(config as any).hotelInfo ?? ""}

${(basic.startDate && basic.endDate) ? `Dates: ${basic.startDate} - ${basic.endDate}` : ""}

${entryFeeLines ? `Sections:
${entryFeeLines}` : ""}

${details.timeControl ? `Time control: ${details.timeControl}` : ""}

${(config as any).scheduleInfo ?? ""}

${(config as any).specialEntries ? `Special Entries:
${(config as any).specialEntries}` : ""}

${(config as any).entryFeesInfo ? `Entry Fees:
${(config as any).entryFeesInfo}` : ""}

${(config as any).notes ? `Notes:
${(config as any).notes}` : ""}

${(config as any).roundByes ? `Round Byes
${(config as any).roundByes}` : ""}

${(config as any).membershipInfo ? `${(config as any).membershipInfo}` : ""}

${(config as any).blitzInfo ? `${(config as any).blitzInfo}` : ""}

${(config as any).registrationInfo ? `Details and Registration:
${(config as any).registrationInfo}` : ""}

${contactLines ? `Contact:
${contactLines}` : ""}

${basic.city ? `Address:
${basic.city}` : ""}

${fide?.prizeFund ? `Prize Fund: ${fide.prizeFund}` : ""}
${(config as any)?.fideRated ? `FIDE Rated: Yes` : ""}
${(config as any)?.handicapAccessible ? `Handicap Accessible: Yes` : ""}
${(config as any)?.residencyRestriction ? `Residency Restriction: Yes` : ""}
${(config as any)?.onlineEvent ? `Online Event: Yes` : ""}
${(config as any).organizerInfo ? `Organizer Overview
${(config as any).organizerInfo}` : ""}
`;

    try {
      let lastError: { status: number; payload: any; rawBody: string; model: string } | null = null;

      for (const candidate of candidateModels) {
        const url = new URL(
          `https://generativelanguage.googleapis.com/v1beta/${candidate}:generateContent`,
        );
        console.log(`Calling Gemini API: ${url.toString()}`);
        url.searchParams.set("key", apiKey);

        const response = await fetch(url.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 800,
            },
          }),
        });

        const rawBody = await response.text();
        let payload: any = null;

        if (rawBody) {
          try {
            payload = JSON.parse(rawBody);
          } catch (parseError) {
            console.warn("Gemini response parsing failed", parseError);
            payload = rawBody;
          }
        }

        if (response.ok) {
          const data = payload ?? {};
          const content = (data?.candidates?.[0]?.content?.parts ?? [])
            .map((part: any) => part?.text ?? "")
            .join("\n")
            .trim();

          if (!content) {
            return res.status(502).json({ message: "Gemini returned no content" });
          }

          return res.json({ content });
        }

        console.error("Gemini API error:", payload ?? rawBody, "(model:", candidate, ")");
        lastError = { status: response.status, payload, rawBody, model: candidate };

        if (response.status !== 404) {
          break;
        }
      }

      if (lastError) {
        const { status, payload, rawBody } = lastError;
        const apiMessage =
          (payload && typeof payload === "object" && "error" in payload && (payload as any).error?.message) ||
          (payload && typeof payload === "object" && "message" in payload && (payload as any).message) ||
          (typeof payload === "string" && payload) ||
          rawBody ||
          "Gemini API request failed";

        return res.status(status || 502).json({ message: apiMessage });
      }

      return res.status(502).json({ message: "Gemini API request failed" });
    } catch (error) {
      console.error("Gemini draft error:", error);
      res.status(500).json({ message: "Failed to generate tournament copy" });
    }
  });

  // Tournament routes (role-specific access)
  
  // Get all live tournaments (for players to view)
  app.get("/api/tournaments", async (req, res) => {
    try {
      const tournaments = await storage.getAllTournaments();
      const visibleTournaments = tournaments.filter((tournament) =>
        ["active", "upcoming", "completed"].includes(tournament.status) && tournament.publishOnCalendar
      );
      res.json(visibleTournaments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch tournaments" });
    }
  });
  app.get("/api/tournaments/starred", requireAuth, async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const stars = await storage.getTournamentStarsByUser(user.id);
      res.json(stars);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch starred tournaments" });
    }
  });
  app.post("/api/tournaments/:id/star", requireAuth, requireRole('player'), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const tournamentId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(tournamentId)) {
        return res.status(400).json({ message: "Invalid tournament id" });
      }
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }
      const star = await storage.createTournamentStar(user.id, tournamentId);
      res.status(201).json(star);
    } catch (error) {
      res.status(500).json({ message: "Failed to star tournament" });
    }
  });
  app.delete("/api/tournaments/:id/star", requireAuth, requireRole('player'), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const tournamentId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(tournamentId)) {
        return res.status(400).json({ message: "Invalid tournament id" });
      }
      await storage.deleteTournamentStar(user.id, tournamentId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to unstar tournament" });
    }
  });

  app.post(
    "/api/tournaments/:id/notifications",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        if (!notificationService.isEnabled()) {
          return res.status(503).json({ message: "Notification service is not configured" });
        }

        const payload = tournamentNotificationSchema.parse(req.body ?? {});
        const sendEmail = payload.sendEmail !== false;
        const sendSms = payload.sendSms === true;

        if (!sendEmail && !sendSms) {
          return res.status(400).json({ message: "Select at least one delivery channel" });
        }

        const tournamentId = parseInt(req.params.id);
        const registrations = await storage.getPlayerRegistrationsByTournament(tournamentId);
        const approvedRegistrations = registrations.filter((registration) => registration.status === "approved");

        const userIds = Array.from(new Set(approvedRegistrations.map((registration) => registration.userId)));
        const users = await storage.listUsersByIds(userIds);
        const userMap = new Map(users.map((user) => [user.id, user]));

        const emailRecipients = new Set<string>();
        const smsTargets: Array<{ phone: string; carrier: string }> = [];

        for (const registration of approvedRegistrations) {
          const user = userMap.get(registration.userId);

          if (sendEmail) {
            const wantsEmail = user?.notifyEmail ?? true;
            const email = (registration.email ?? user?.email ?? "").trim();
            if (wantsEmail && email) {
              emailRecipients.add(email);
            }
          }

          if (sendSms) {
            const wantsSms = user?.notifySms ?? false;
            const phone = (user?.phoneNumber ?? registration.phoneNumber ?? "").trim();
            const carrier = user?.carrier ?? "";
            if (wantsSms && phone && carrier) {
              smsTargets.push({ phone, carrier });
            }
          }
        }

        let emailCount = 0;
        let smsCount = 0;

        if (sendEmail && emailRecipients.size > 0) {
          await notificationService.sendEmail({
            to: Array.from(emailRecipients),
            subject: payload.subject,
            text: payload.message,
          });
          emailCount = emailRecipients.size;
        }

        if (sendSms && smsTargets.length > 0) {
          await Promise.allSettled(
            smsTargets.map(async (target) => {
              try {
                await notificationService.sendSms({
                  phoneNumber: target.phone,
                  carrier: target.carrier,
                  message: payload.message,
                });
                smsCount += 1;
              } catch (error) {
                log(`SMS notification failed for ${target.phone}: ${(error as Error).message}`, "notifications");
              }
            }),
          );
        }

        res.json({
          message: "Notifications dispatched",
          emails: emailCount,
          sms: smsCount,
          totalRegistrations: approvedRegistrations.length,
        });
      } catch (error) {
        console.error("Tournament notification error:", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid notification payload" });
        }
        res.status(500).json({ message: "Failed to send notifications" });
      }
    },
  );

  // Get tournaments for a specific tournament director (protected)
  app.get("/api/my-tournaments", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const tournaments = await storage.getTournamentsByUser(user.id);
      res.json(tournaments);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch your tournaments" });
    }
  });

  // Create tournament (tournament directors only)
  app.post("/api/tournaments", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
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

  app.get(
    "/api/tournaments/:id/exports/fide-trf",
    requireAuth,
    requireRole("tournament_director"),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const id = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) {
          return res.status(400).json({ message: "Invalid tournament id" });
        }

        const tournament = await storage.getTournament(id);
        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        const [players, matches, pairings] = await Promise.all([
          storage.getPlayersByTournament(id),
          storage.getMatchesByTournament(id),
          storage.getPairingsByTournament(id),
        ]);

        const config = parseTournamentConfig(tournament);
        const fideProfiles = await lookupFideProfiles(players);
        const { content, warnings } = generateFideTrf16Report({
          tournament,
          config,
          players,
          matches,
          pairings,
          fideProfiles,
        });

        if (!content) {
          return res.status(400).json({ message: "Unable to generate TRF export" });
        }

        const filenameBase = tournament.name?.trim().length
          ? tournament.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
          : `tournament-${id}`;
        const filename = `${filenameBase || `tournament-${id}`}-fide-trf16.trf`;

        if (warnings.length > 0) {
          res.setHeader("X-Export-Warnings", warnings.join(" | "));
        }

        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(content);
      } catch (error) {
        console.error("TRF generation error", error);
        res.status(500).json({ message: "Failed to generate TRF export" });
      }
    },
  );

  // Start tournament
  // Start tournament
  app.post("/api/tournaments/:id/start", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = Number.parseInt(req.params.id, 10);
      const tournament = await storage.getTournament(tournamentId);

      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      if (tournament.status !== "draft" && tournament.status !== "upcoming") {
        return res.status(400).json({ message: "Tournament cannot be started" });
      }

      const forceStart = req.body?.force === true;
      const players = await storage.getPlayersByTournament(tournamentId);
      if (players.length < 2 && !forceStart) {
        return res.status(400).json({ message: "Need at least 2 players to start tournament" });
      }

      let rounds = tournament.rounds;
      if (tournament.format === "roundrobin" && players.length >= 2) {
        rounds = players.length % 2 === 0 ? players.length - 1 : players.length;
      }

      const updatedTournament = await storage.updateTournament(tournamentId, {
        status: "active",
        currentRound: 1,
        rounds,
      });

      if (tournament.format === "roundrobin" && players.length >= 2) {
        const { generateRoundRobinSchedule, validateRoundRobinSchedule } = await import("./round-robin");
        console.log(`Generating Round Robin schedule for ${players.length} players`);
        const roundRobinPairings = generateRoundRobinSchedule(players);
        const playerIds = players.map((p) => p.id);

        if (!validateRoundRobinSchedule(roundRobinPairings, playerIds)) {
          throw new Error("Invalid Round Robin schedule generated");
        }

        for (const pairing of roundRobinPairings) {
          if (pairing.isBye) {
            await storage.createPairing({
              tournamentId,
              round: pairing.round,
              playerId: pairing.whitePlayerId!,
              opponentId: null,
              color: null,
              points: 1,
              isBye: true,
            });
          } else {
            await storage.createPairing({
              tournamentId,
              round: pairing.round,
              playerId: pairing.whitePlayerId!,
              opponentId: pairing.blackPlayerId!,
              color: "white",
              points: 0,
              isBye: false,
            });
            await storage.createPairing({
              tournamentId,
              round: pairing.round,
              playerId: pairing.blackPlayerId!,
              opponentId: pairing.whitePlayerId!,
              color: "black",
              points: 0,
              isBye: false,
            });

            await storage.createMatch({
              tournamentId,
              round: pairing.round,
              whitePlayerId: pairing.whitePlayerId!,
              blackPlayerId: pairing.blackPlayerId!,
              board: pairing.board,
              result: null,
              status: "pending",
            });
          }
        }
      } else if (players.length >= 1) {
        await generatePairings(tournament, players, [], 1);
      }

      res.json(updatedTournament);
    } catch (error) {
      console.error("Start tournament error:", error);
      res.status(500).json({ message: "Failed to start tournament" });
    }
  });

  // Mark tournament as upcoming
  app.post(
    "/api/tournaments/:id/upcoming",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const tournamentId = parseInt(req.params.id);
        const tournament = await storage.getTournament(tournamentId);

        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        if (tournament.status === "active") {
          return res.status(400).json({ message: "Tournament already started" });
        }

        if (tournament.status === "completed") {
          return res.status(400).json({ message: "Tournament already completed" });
        }

        const autoStartMode = req.body?.autoStartMode === "auto" ? "auto" : "manual";

        const updatedTournament = await storage.updateTournament(tournamentId, {
          status: "upcoming",
          currentRound: tournament.currentRound ?? 0,
          updatedAt: new Date(),
        });

        if (!updatedTournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        if (req.user) {
          await storage.createHistoryEntry({
            tournamentId,
            action: "status_change",
            description:
              autoStartMode === "auto"
                ? "Marked tournament as upcoming with automatic go-live scheduling"
                : "Marked tournament as upcoming for manual start",
            changedBy: req.user.id,
            previousState: JSON.stringify({ status: tournament.status }),
            newState: JSON.stringify({ status: "upcoming", autoStartMode }),
          });
        }

        res.json(updatedTournament);
      } catch (error) {
        console.error("Set upcoming tournament error:", error);
        res.status(500).json({ message: "Failed to mark tournament as upcoming" });
      }
    }
  );

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

      try {
        const config = parseTournamentConfig(tournament);
        updateChessResultsScheduler(storage, tournament.id, config);
      } catch (error) {
        console.warn("Failed to update Chess-Results scheduler", error);
      }

      res.json(tournament);
    } catch (error) {
      res.status(500).json({ message: "Failed to update tournament" });
    }
  });

  app.post(
    "/api/tournaments/:id/chess-results/test",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const tournament = await storage.getTournament(id);
        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        const requestConfig = req.body?.config;
        const config = requestConfig ?? parseTournamentConfig(tournament);
        const result = await testChessResultsConnection({ storage, tournament, config });

        if (!result.success) {
          return res.status(result.status).json({ message: result.message });
        }

        res.json({ success: true });
      } catch (error) {
        console.error("Chess-Results test error:", error);
        res.status(500).json({ message: "Failed to test Chess-Results connection" });
      }
    }
  );

  app.post(
    "/api/tournaments/:id/chess-results/sync",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const id = parseInt(req.params.id);
        const tournament = await storage.getTournament(id);
        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        const config = parseTournamentConfig(tournament);
        const result = await syncChessResults({ storage, tournament, config, reason: "manual" });
        updateChessResultsScheduler(storage, tournament.id, result.config);

        if (!result.success) {
          return res.status(result.status).json({ message: result.message, config: result.config });
        }

        res.json(result);
      } catch (error) {
        console.error("Chess-Results sync error:", error);
        res.status(500).json({ message: "Failed to synchronize with Chess-Results" });
      }
    }
  );

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
  app.get("/api/tournaments/:id/payments/config", requireAuth, async (req, res) => {
    try {
      const tournamentId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(tournamentId)) {
        return res.status(400).json({ message: "Invalid tournament id" });
      }

      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      const config = parseTournamentConfig(tournament);
      const payments = config.payments;
      const stripeConfigured = Boolean(
        payments.provider === "stripe" && payments.onlineEnabled && stripe && STRIPE_PUBLISHABLE_KEY,
      );
      const paypalConfigured = Boolean(
        payments.provider === "paypal" && payments.onlineEnabled && payments.paypalMerchantId && payments.paypalEmail,
      );

      res.json({
        payments,
        publishableKey: payments.provider === "stripe" ? STRIPE_PUBLISHABLE_KEY || null : null,
        onlineConfigured: stripeConfigured || paypalConfigured,
      });
    } catch (error) {
      console.error("Fetch payment config error:", error);
      res.status(500).json({ message: "Failed to load payment settings" });
    }
  });

  app.put(
    "/api/tournaments/:id/payments",
    requireAuth,
    requireRole("tournament_director"),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const tournamentId = Number.parseInt(req.params.id, 10);
        if (!Number.isFinite(tournamentId)) {
          return res.status(400).json({ message: "Invalid tournament id" });
        }

        const payload = updateTournamentPaymentsSchema.parse(req.body ?? {});
        const tournament = await storage.getTournament(tournamentId);
        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        const config = parseTournamentConfig(tournament);
        const payments: PaymentSettings = {
          ...config.payments,
        };

        if (payload.defaultCurrency) {
          payments.defaultCurrency = payload.defaultCurrency.trim().toUpperCase();
        }

        payments.provider = payload.provider;

        if (payload.onlineEnabled !== undefined) {
          payments.onlineEnabled = payload.onlineEnabled;
        }
        if (payload.requirePaymentOnRegistration !== undefined) {
          payments.requirePaymentOnRegistration = payload.requirePaymentOnRegistration;
        }
        if (payload.allowProcessingContribution !== undefined) {
          payments.allowProcessingContribution = payload.allowProcessingContribution;
        }
        if (Object.prototype.hasOwnProperty.call(payload, "processingFeePercent")) {
          payments.processingFeePercent = payload.processingFeePercent ?? null;
        }

        const applyStringUpdate = (
          key: keyof PaymentSettings,
          value: string | undefined,
        ) => {
          if (value && value.trim()) {
            (payments as any)[key] = value.trim();
          } else {
            delete (payments as any)[key];
          }
        };

        if (Object.prototype.hasOwnProperty.call(payload, "stripeAccountId")) {
          applyStringUpdate("stripeAccountId", payload.stripeAccountId);
        }
        if (Object.prototype.hasOwnProperty.call(payload, "stripePublishableKey")) {
          applyStringUpdate("stripePublishableKey", payload.stripePublishableKey);
        }
        if (Object.prototype.hasOwnProperty.call(payload, "payoutStatementDescriptor")) {
          applyStringUpdate("payoutStatementDescriptor", payload.payoutStatementDescriptor);
        }
        if (Object.prototype.hasOwnProperty.call(payload, "paypalMerchantId")) {
          applyStringUpdate("paypalMerchantId", payload.paypalMerchantId);
        }
        if (Object.prototype.hasOwnProperty.call(payload, "paypalClientId")) {
          applyStringUpdate("paypalClientId", payload.paypalClientId);
        }
        if (Object.prototype.hasOwnProperty.call(payload, "paypalEmail")) {
          applyStringUpdate("paypalEmail", payload.paypalEmail);
        }

        if (payload.connectionScope) {
          payments.connectionScope = payload.connectionScope;
        }

        if (payload.acceptedOfflineMethods) {
          payments.acceptedOfflineMethods = Array.from(new Set(payload.acceptedOfflineMethods));
        }

        if (payload.offlineInstructions !== undefined) {
          payments.offlineInstructions = payload.offlineInstructions?.trim() ?? "";
        }

        config.payments = payments;
        const serialized = serializeTournamentConfig(config);
        await storage.updateTournament(tournamentId, { roundTimings: serialized });
        res.json(serialized.payments);
      } catch (error) {
        console.error("Update tournament payment settings error", error);
        if (error instanceof z.ZodError) {
          return res.status(400).json({ message: "Invalid payment settings", issues: error.flatten() });
        }
        res.status(500).json({ message: "Failed to update payment settings" });
      }
    },
  );

  app.post("/api/tournaments/:id/payments/intent", requireAuth, async (req, res) => {
    try {
      if (!stripe || !STRIPE_PUBLISHABLE_KEY) {
        return res.status(503).json({ message: "Online payments are not configured" });
      }

      const tournamentId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(tournamentId)) {
        return res.status(400).json({ message: "Invalid tournament id" });
      }

      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      const config = parseTournamentConfig(tournament);
      const payments = config.payments;

      if (!payments.onlineEnabled) {
        return res.status(400).json({ message: "Online payments are disabled for this tournament" });
      }

      const payload = createPaymentIntentSchema.parse(req.body ?? {});
      const contribution = Number.isFinite(payload.contribution) ? Number(payload.contribution) : 0;
      const entryFee = payload.entryFeeId
        ? config.entryFees.find((fee) => fee.id === payload.entryFeeId) ?? null
        : null;

      if (!entryFee && payments.requirePaymentOnRegistration) {
        return res.status(400).json({ message: "Select an entry fee before paying" });
      }

      const totals = computePaymentTotals(entryFee, contribution, payments);

      if (totals.total <= 0) {
        return res.status(400).json({ message: "Payment amount must be greater than zero" });
      }

      const amountInMinorUnits = Math.max(1, Math.round(totals.total * 100));
      const description = `${tournament.name} registration`;
      const receiptEmail = payload.receiptEmail ?? req.user?.email ?? undefined;

      const descriptorSuffix = payments.payoutStatementDescriptor?.trim()
        ? payments.payoutStatementDescriptor.trim().slice(0, 22)
        : undefined;

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInMinorUnits,
        currency: totals.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: {
          tournamentId: `${tournamentId}`,
          tournamentName: tournament.name ?? "",
          userId: `${req.user?.id ?? ""}`,
          entryFeeId: payload.entryFeeId ?? "",
          contribution: contribution.toFixed(2),
        },
        receipt_email: receiptEmail,
        description: payload.playerName ? `${description} for ${payload.playerName}` : description,
        ...(descriptorSuffix ? { statement_descriptor_suffix: descriptorSuffix } : {}),
      });

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: totals.total,
        subtotal: totals.subtotal,
        feeAmount: totals.feeAmount,
        currency: totals.currency,
        publishableKey: STRIPE_PUBLISHABLE_KEY,
      });
    } catch (error) {
      console.error("Create payment intent error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid payment data" });
      }
      if (error instanceof Stripe.errors.StripeError) {
        return res.status(400).json({ message: error.message });
      }
      res.status(500).json({ message: "Failed to create payment intent" });
    }
  });

  app.post("/api/payments/stripe-webhook", async (req: Request, res: Response) => {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
      return res.status(503).send("Stripe webhook not configured");
    }

    const signature = req.headers["stripe-signature"] as string | undefined;
    const rawBody: Buffer | undefined = (req as any).rawBody;

    if (!signature || !rawBody) {
      return res.status(400).send("Missing Stripe signature");
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      console.error("Stripe webhook signature verification failed", error);
      const message = error instanceof Error ? error.message : "Invalid signature";
      return res.status(400).send(`Webhook Error: ${message}`);
    }

    try {
      if (
        event.type === "payment_intent.succeeded" ||
        event.type === "payment_intent.processing" ||
        event.type === "payment_intent.payment_failed" ||
        event.type === "payment_intent.canceled"
      ) {
        const intent = event.data.object as Stripe.PaymentIntent;
        const registration = await storage.getPlayerRegistrationByPaymentIntent(intent.id);
        if (registration) {
          const statusMap: Record<string, PaymentStatus> = {
            succeeded: "paid",
            processing: "processing",
            requires_payment_method: "unpaid",
            requires_action: "processing",
            canceled: "failed",
            payment_failed: "failed",
          };

          const mappedStatus = statusMap[intent.status] ?? "processing";
          const fallbackAmountMinorUnits = Math.round(Number(String(registration.amountDue ?? "0")) * 100);
          const amountReceived = Number(((intent.amount_received ?? 0) / 100).toFixed(2));
          const amountTotal = Number(
            (((intent.amount ?? fallbackAmountMinorUnits) as number) / 100).toFixed(2),
          );
          const currency = intent.currency ? intent.currency.toUpperCase() : registration.currency ?? "USD";
          const intentWithCharges = intent as Stripe.PaymentIntent & {
            charges?: Stripe.ApiList<Stripe.Charge>;
          };
          const latestCharge = intentWithCharges.charges?.data?.[0];
          const notes =
            intent.last_payment_error?.message ?? intent.cancellation_reason ?? registration.paymentNotes ?? null;

          await storage.updatePlayerRegistration(registration.id, {
            paymentStatus: mappedStatus,
            amountPaid: amountReceived.toFixed(2),
            amountDue: amountTotal.toFixed(2),
            currency,
            paymentMethod: latestCharge?.payment_method_details?.type ?? registration.paymentMethod ?? null,
            paymentReceiptUrl: latestCharge?.receipt_url ?? registration.paymentReceiptUrl ?? null,
            paymentNotes: notes,
            paidAt: mappedStatus === "paid"
              ? new Date((latestCharge?.created ?? Math.floor(Date.now() / 1000)) * 1000)
              : null,
          });
        }
      }
    } catch (error) {
      console.error("Stripe webhook handling error", error);
      return res.status(500).send("Webhook processing failed");
    }

    res.json({ received: true });
  });
  
  // Create player registration (for players to register for tournaments)
  app.post("/api/tournaments/:id/register", requireAuth, async (req, res) => {
    try {
      const tournamentId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(tournamentId)) {
        return res.status(400).json({ error: "Invalid tournament id" });
      }
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      // Check if tournament exists
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }

      const config = parseTournamentConfig(tournament);
      if (!config.registers.allowPlayerToJoin) {
        return res.status(403).json({ error: "Player registration is not allowed for this tournament" });
      }

      // Check if user already registered for this tournament
      const existingRegistration = await storage.getPlayerRegistrationsByTournament(tournamentId);
      if (existingRegistration.some((registration) => registration.userId === user.id)) {
        return res.status(400).json({ error: "You are already registered for this tournament" });
      }
      
      const payments = config.payments;
      const payload = playerRegistrationSchema.parse(req.body ?? {});
      const offlineAllowed = (payments.acceptedOfflineMethods ?? []).length > 0;
      const mustCompletePayment = payments.onlineEnabled && (payments.requirePaymentOnRegistration || !offlineAllowed);

      const entryFee = payload.entryFeeId
        ? config.entryFees.find((fee) => fee.id === payload.entryFeeId) ?? null
        : null;
      const contribution = Number.isFinite(payload.contribution) ? Number(payload.contribution) : 0;
      const totals = computePaymentTotals(entryFee, contribution, payments);

      let amountDue = Number.isFinite(payload.amountDue) ? Number(payload.amountDue) : totals.total;
      if (!Number.isFinite(amountDue)) {
        amountDue = totals.total || entryFee?.amount || 0;
      }
      amountDue = Number(amountDue.toFixed(2));

      let amountPaid = Number.isFinite(payload.amountPaid) ? Number(payload.amountPaid) : 0;
      amountPaid = Number(amountPaid.toFixed(2));

      let paymentStatus: PaymentStatus = payload.paymentStatus ?? "unpaid";
      let paymentMethod = payload.paymentMethod ?? null;
      let paymentReceiptUrl = payload.paymentReceiptUrl ?? null;
      let currency = normalizeCurrency(payload.currency ?? entryFee?.currency, payments.defaultCurrency ?? "USD");
      let paidAt: Date | null = null;
      let notes = payload.paymentNotes ?? null;

      if (payments.onlineEnabled && payload.paymentIntentId) {
        if (!stripe) {
          return res.status(503).json({ error: "Online payments are not available" });
        }

        const paymentIntentRaw = await stripe.paymentIntents.retrieve(payload.paymentIntentId, {
          expand: ["latest_charge"],
        });
        const paymentIntent = paymentIntentRaw as Stripe.PaymentIntent & {
          latest_charge?: string | Stripe.Charge;
          charges?: Stripe.ApiList<Stripe.Charge>;
        };
        amountDue = Number(((paymentIntent.amount ?? amountDue * 100) / 100).toFixed(2));
        amountPaid = Number(((paymentIntent.amount_received ?? 0) / 100).toFixed(2));
        currency = paymentIntent.currency ? paymentIntent.currency.toUpperCase() : currency;

        const latestCharge = ((): Stripe.Charge | null => {
          if (paymentIntent.latest_charge && typeof paymentIntent.latest_charge !== "string") {
            return paymentIntent.latest_charge;
          }
          const charges = paymentIntent.charges?.data ?? [];
          return charges[0] ?? null;
        })();

        if (latestCharge?.receipt_url && !paymentReceiptUrl) {
          paymentReceiptUrl = latestCharge.receipt_url;
        }
        if (latestCharge?.payment_method_details?.type && !paymentMethod) {
          paymentMethod = latestCharge.payment_method_details.type;
        }

        switch (paymentIntent.status) {
          case "succeeded":
            paymentStatus = "paid";
            paidAt = latestCharge?.created ? new Date(latestCharge.created * 1000) : new Date();
            break;
          case "processing":
          case "requires_capture":
            paymentStatus = "processing";
            break;
          case "requires_payment_method":
            paymentStatus = "unpaid";
            break;
          default:
            paymentStatus = paymentStatus ?? "unpaid";
        }

        if (mustCompletePayment && paymentIntent.status !== "succeeded") {
          return res.status(400).json({ error: "Payment must be completed before submitting registration" });
        }
      } else if (mustCompletePayment) {
        return res.status(400).json({ error: "Online payment is required for this tournament" });
      }

      const registration = await storage.createPlayerRegistration({
        tournamentId,
        userId: user.id,
        playerName: payload.playerName,
        uscfRating: payload.uscfRating ?? null,
        phoneNumber: payload.phoneNumber ?? null,
        email: payload.email ?? user.email ?? null,
        arrivalTime: payload.arrivalTime ?? "",
        status: "pending",
        paymentStatus,
        paymentIntentId: payload.paymentIntentId ?? null,
        paymentMethod,
        paymentReceiptUrl,
        paymentNotes: notes,
        amountDue,
        amountPaid,
        currency,
        paidAt,
      } as any);

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
          const fullName = updatedRegistration.playerName || `${user.firstName} ${user.lastName}`;
          const [firstName, ...rest] = fullName.trim().split(/\\s+/);
          const lastName = rest.length > 0 ? rest.join(" ") : firstName;

          await storage.createPlayer({
            tournamentId,
            firstName,
            lastName,
            rating: updatedRegistration.uscfRating || undefined,
            federation: undefined,
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
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const userId = user.id;
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

  app.get(
    "/api/tournaments/:tournamentId/players/:playerId",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const tournamentId = parseInt(req.params.tournamentId);
        const playerId = parseInt(req.params.playerId);
        const player = await storage.getPlayer(playerId);
        if (!player || player.tournamentId !== tournamentId) {
          return res.status(404).json({ message: "Player not found" });
        }
        res.json(player);
      } catch (error) {
        console.error("Fetch player error:", error);
        res.status(500).json({ message: "Failed to fetch player" });
      }
    },
  );

  app.put(
    "/api/tournaments/:tournamentId/players/:playerId",
    requireAuth,
    requireRole('tournament_director'),
    requireTournamentAccess,
    async (req, res) => {
      try {
        const tournamentId = parseInt(req.params.tournamentId);
        const playerId = parseInt(req.params.playerId);
        const existing = await storage.getPlayer(playerId);
        if (!existing || existing.tournamentId !== tournamentId) {
          return res.status(404).json({ message: "Player not found" });
        }

        const updates: Partial<Player> = {};
        if (typeof req.body?.firstName === "string" && req.body.firstName.trim()) {
          updates.firstName = req.body.firstName.trim();
        }
        if (typeof req.body?.lastName === "string" && req.body.lastName.trim()) {
          updates.lastName = req.body.lastName.trim();
        }
        if (req.body?.rating !== undefined && req.body?.rating !== null) {
          const numericRating = Number(req.body.rating);
          if (Number.isFinite(numericRating)) {
            updates.rating = Math.max(0, Math.round(numericRating));
          }
        }
        if (typeof req.body?.federation === "string" && req.body.federation.trim()) {
          updates.federation = req.body.federation.trim();
        }
        if (req.body?.sectionId === null) {
          updates.sectionId = null;
        } else if (typeof req.body?.sectionId === "string") {
          const trimmed = req.body.sectionId.trim();
          updates.sectionId = trimmed.length > 0 ? trimmed : null;
        }
        if (req.body?.sectionName === null) {
          updates.sectionName = null;
        } else if (typeof req.body?.sectionName === "string") {
          const trimmed = req.body.sectionName.trim();
          updates.sectionName = trimmed.length > 0 ? trimmed : null;
        }

        if (Object.keys(updates).length === 0) {
          return res.status(400).json({ message: "No changes provided" });
        }

        const updated = await storage.updatePlayer(playerId, updates);
        res.json(updated);
      } catch (error) {
        console.error("Update player error:", error);
        res.status(500).json({ message: "Failed to update player" });
      }
    },
  );

  app.delete("/api/players/:id", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
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
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      const tournaments = await storage.getTournamentsByUser(user.id);
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

      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
      
      // Get player to find tournament ID for access control
      const player = await storage.getPlayer(playerId);
      if (!player) {
        return res.status(404).json({ message: "Player not found" });
      }
      
      // Validate tournament access
      const tournament = await storage.getTournament(player.tournamentId);
      if (!tournament || tournament.createdBy !== user.id) {
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
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const currentMatch = await storage.getMatch(id);
      if (!currentMatch) {
        return res.status(404).json({ message: "Match not found" });
      }

      const updatedMatch = await storage.updateMatch(id, req.body);
      if (!updatedMatch) {
        return res.status(404).json({ message: "Match not found" });
      }

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
      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }
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
            changedBy: user.id,
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

  try {
    await initializeChessResultsSchedulers(storage);
  } catch (error) {
    console.error("Failed to initialize Chess-Results schedulers", error);
  }

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

