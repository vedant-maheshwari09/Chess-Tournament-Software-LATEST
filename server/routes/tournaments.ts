import { insertTournamentSchema, insertPlayerSchema } from '@shared/schema';
import { updateChessResultsScheduler, testChessResultsConnection, syncChessResults } from '../services/chessResults';
import type { Express } from "express";
import { z } from "zod";
import { normalizePlayerName } from "./util";
import Stripe from "stripe";
import {
  lookupUSCF, lookupFide, mapLocalResult, extractQueryParam, normalizeSearchParams, parseLimitParam, getGeminiConfig, normalizeCurrency, computePaymentTotals, normalizeAccountPaymentSettings, formatCurrencyAmount, describeRatingWindow, generatePairings, groupPlayersByScore, pairUpperVsLowerHalf, determineSwissColors, generateSwissPairings, generateBoardNumberSequence, RatingSource, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, stripe, PAYMENT_STATUSES, PaymentStatus, RatingLookupResult, paymentProviderEnum, paymentScopeEnum, offlineMethodEnum, updateTournamentPaymentsSchema, accountPaymentSettingsSchema, geminiDraftSchema, updateNotificationPreferencesSchema, tournamentNotificationSchema, createPaymentIntentSchema, playerRegistrationSchema, BoardNumberingSettings
} from "./common";

import { storage } from '../storage';
import { requireAuth, requireRole, requireTournamentAccess } from '../auth';
import { notificationService } from '../notifications';
import { parseTournamentConfig } from "@shared/tournament-config";
import { generateFideTrf16Report } from '../lib/fideTrf';
import { lookupFideProfiles, searchFideDirectory } from '../lib/fideDirectory';
import { Player, Pairing, Match, PlayerRegistration } from "@shared/schema";


export function applyTournamentsRoutes(app: Express) {
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


app.get("/api/rating-lookup", async (req, res) => {
    try {
      const params: any = {
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


app.get("/api/officials/search", async (req, res) => {
    try {
      const nameQuery = extractQueryParam(req.query.q);
      if (!nameQuery) {
        return res.status(400).json({ message: "Search query 'q' is required" });
      }
      const limit = parseLimitParam(req.query.limit, 10, 50);
      const results = await searchFideDirectory(nameQuery, limit);
      res.json(results);
    } catch (error) {
      console.error("Official search error:", error);
      res.status(500).json({ message: "Failed to search for officials" });
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
      const visibleTournaments = tournaments.filter((tournament) => {
        if (!["active", "upcoming", "completed"].includes(tournament.status)) {
          return false;
        }
        try {
          const config = parseTournamentConfig(tournament);
          return config.registers.showOnCalendar;
        } catch (error) {
          console.error(`Failed to parse config for tournament ${tournament.id}`, error);
          return false;
        }
      });
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

        res.json({
          message: "Notifications dispatched",
          emails: emailCount,
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

      // Clear existing matches and pairings for this tournament to ensure a clean start
      console.log(`[StartTournament] Clearing existing data for tournament ${tournamentId}`);
      try {
        const existingMatches = await storage.getMatchesByTournament(tournamentId);
        for (const m of existingMatches) {
          await storage.deleteMatch(m.id);
        }
        const existingPairings = await storage.getPairingsByTournament(tournamentId);
        for (const p of existingPairings) {
          await storage.deletePairing(p.id);
        }
      } catch (err) {
        console.error(`[StartTournament] Error during cleanup:`, err);
      }

      const updateData: any = {
        status: "active",
        rounds,
        currentRound: 1,
      };

      if (tournament.format === 'arena') {
        updateData.arenaStartTime = new Date();
        // Ensure duration and scoring config are present
        if (!tournament.arenaDuration) {
          updateData.arenaDuration = 90;
        }
        if (!tournament.arenaScoringConfig) {
          updateData.arenaScoringConfig = {
            streakThreshold: 2,
            winBonus: 2,
            drawBonus: 1,
            lossBonus: 0
          };
        }
        // Initialize player statuses for arena
        try {
          await storage.initializeArenaPlayers(tournamentId);
        } catch (err) {
          console.error(`[StartTournament] Error initializing arena players:`, err);
        }
      }

      const updatedTournament = await storage.updateTournament(tournamentId, updateData);

      // Group players by section
      const playersBySection = players.reduce((acc: any, player: any) => {
        const sectionKey = player.sectionId || 'default';
        if (!acc[sectionKey]) {
          acc[sectionKey] = [];
        }
        acc[sectionKey].push(player);
        return acc;
      }, {} as Record<string, Player[]>);

      // Pre-calculate total matches for board numbering
      let totalMatches = 0;
      for (const sectionKey in playersBySection) {
        const sectionPlayers = playersBySection[sectionKey];
        if (sectionPlayers.length < 1) continue;
        if (tournament.format === 'swiss') {
          totalMatches += Math.floor(sectionPlayers.length / 2);
          if (sectionPlayers.length % 2 === 1) {
            totalMatches++;
          }
        }
      }

      const allBoardNumbers = generateBoardNumberSequence(tournament.boardNumberingSettings as BoardNumberingSettings, totalMatches);
      let boardNumberOffset = 0;

      // Generate pairings for each section
      for (const sectionKey in playersBySection) {
        const sectionPlayers = playersBySection[sectionKey];
        if (sectionPlayers.length < 1) continue;

        if (tournament.format === "roundrobin" && sectionPlayers.length >= 2) {
          const { generateRoundRobinSchedule, validateRoundRobinSchedule } = await import('../round-robin');
          console.log(`Generating Round Robin schedule for ${sectionPlayers.length} players in section ${sectionKey}`);
          const roundRobinPairings = generateRoundRobinSchedule(sectionPlayers);
          const playerIds = sectionPlayers.map((p: any) => p.id);

          if (!validateRoundRobinSchedule(roundRobinPairings, playerIds)) {
            throw new Error(`Invalid Round Robin schedule generated for section ${sectionKey}`);
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
        } else if (tournament.format === "knockout" && sectionPlayers.length >= 2) {
          console.log(`Generating Knockout bracket for ${sectionPlayers.length} players in section ${sectionKey}`);
          
          let sortedPlayers;
          const config = parseTournamentConfig(tournament);
          const seedingMethod = config.seedingMethod || 'standard';
          const seedingSource = config.seedingSource || 'rating';

          if (seedingMethod === 'random') {
            sortedPlayers = [...sectionPlayers].sort(() => Math.random() - 0.5);
          } else if (seedingMethod === 'manual') {
            // Sort by manual seed (lowest number first, e.g. 1 is top seed)
            // Players without a seed go to the bottom
            sortedPlayers = [...sectionPlayers].sort((a, b) => {
              const seedA = a.seed ?? 999999;
              const seedB = b.seed ?? 999999;
              if (seedA !== seedB) return seedA - seedB;
              // Secondary sort by rating if seeds are same
              return (b.rating || 0) - (a.rating || 0);
            });
          } else {
            // Standard or Slaughter seeding based on chosen source
            sortedPlayers = [...sectionPlayers].sort((a, b) => {
              let ratingA = 0;
              let ratingB = 0;
              
              switch (seedingSource) {
                case 'uscf':
                  ratingA = a.uscfRating || a.rating || 0;
                  ratingB = b.uscfRating || b.rating || 0;
                  break;
                case 'fide':
                  ratingA = a.fideRating || a.rating || 0;
                  ratingB = b.fideRating || b.rating || 0;
                  break;
                default:
                  ratingA = a.rating || 0;
                  ratingB = b.rating || 0;
              }
              
              return ratingB - ratingA;
            });
          }

          const { 
            generateKnockoutPairings: genKnockout,
            generateDoubleEliminationPairings: genDoubleElim 
          } = await import('../knockout');
          
          const isDoubleElim = tournament.isDoubleElimination;
          const knockoutPairings = isDoubleElim 
            ? genDoubleElim(sortedPlayers, seedingMethod as any)
            : genKnockout(sortedPlayers, seedingMethod as any);

          for (const pairing of knockoutPairings) {
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

              // Create completed match for the bye to show in bracket
              await storage.createMatch({
                tournamentId,
                round: pairing.round,
                whitePlayerId: pairing.whitePlayerId!,
                blackPlayerId: null,
                board: pairing.board,
                result: "1-0",
                status: "completed",
                bracketType: pairing.bracketType,
                sectionId: sectionKey === 'default' ? null : sectionKey,
              });
            } else {
              if (pairing.whitePlayerId && pairing.blackPlayerId) {
                await storage.createPairing({
                  tournamentId,
                  round: pairing.round,
                  playerId: pairing.whitePlayerId,
                  opponentId: pairing.blackPlayerId,
                  color: "white",
                  points: 0,
                  isBye: false,
                });
                await storage.createPairing({
                  tournamentId,
                  round: pairing.round,
                  playerId: pairing.blackPlayerId,
                  opponentId: pairing.whitePlayerId,
                  color: "black",
                  points: 0,
                  isBye: false,
                });
              }

              await storage.createMatch({
                tournamentId,
                round: pairing.round,
                whitePlayerId: pairing.whitePlayerId,
                blackPlayerId: pairing.blackPlayerId,
                board: pairing.board,
                result: null,
                status: "pending",
                bracketType: pairing.bracketType,
                sectionId: sectionKey === 'default' ? null : sectionKey,
              });
            }
          }
        } else if (sectionPlayers.length >= 1) {
          const numSectionMatches = Math.floor(sectionPlayers.length / 2) + (sectionPlayers.length % 2);
          const boardNumbersForSection = allBoardNumbers.slice(boardNumberOffset, boardNumberOffset + numSectionMatches);
          boardNumberOffset += numSectionMatches;
          await generatePairings(tournament, sectionPlayers, [], [], 1, boardNumbersForSection);
        }
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
      const currentRoundMatches = matches.filter((m: any) => m.round === tournament.currentRound);
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
      if (tournament.format === 'roundrobin' || tournament.format === 'knockout') {
        console.log(`${tournament.format} tournament - advanced to round ${nextRound}. Pairings already exist.`);
      } else {
        const pairings = await storage.getPairingsByTournament(tournament.id);
        const playerMap = new Map(players.map((p: any) => [p.id, p]));
        const playersBySection = players.reduce((acc: any, player: any) => {
          const sectionKey = player.sectionId || 'default';
          if (!acc[sectionKey]) {
            acc[sectionKey] = [];
          }
          acc[sectionKey].push(player);
          return acc;
        }, {} as Record<string, Player[]>);

        const matchesBySection = matches.reduce((acc: any, match: any) => {
          const player = playerMap.get(match.whitePlayerId!) ?? playerMap.get(match.blackPlayerId!);
          if (player) {
            const sectionKey = player.sectionId || 'default';
            if (!acc[sectionKey]) {
              acc[sectionKey] = [];
            }
            acc[sectionKey].push(match);
          }
          return acc;
        }, {} as Record<string, any[]>);

        const pairingsBySection = pairings.reduce((acc, pairing: any) => {
          const player = playerMap.get(pairing.playerId);
          if (player) {
            const sectionKey = player.sectionId || 'default';
            if (!acc[sectionKey]) {
              acc[sectionKey] = [];
            }
            acc[sectionKey].push(pairing);
          }
          return acc;
        }, {} as Record<string, any[]>);

        // Pre-calculate total matches for board numbering
        let totalMatches = 0;
        for (const sectionKey in playersBySection) {
          const sectionPlayers = playersBySection[sectionKey];
          const sectionPairings = pairingsBySection[sectionKey] || [];
          const isWithdrawn = (playerId: number) => sectionPairings.some((p: any) => p.playerId === playerId && p.isBye && p.byeType === 'zero_point' && p.round < nextRound);
          const activePlayers = sectionPlayers.filter((p: any) => !isWithdrawn(p.id));
          if (activePlayers.length < 1) continue;

          totalMatches += Math.floor(activePlayers.length / 2);
          if (activePlayers.length % 2 === 1) {
            totalMatches++;
          }
        }

        const allBoardNumbers = generateBoardNumberSequence(tournament.boardNumberingSettings as BoardNumberingSettings, totalMatches);
        let boardNumberOffset = 0;

        for (const sectionKey in playersBySection) {
          const sectionPlayers = playersBySection[sectionKey];
          const sectionMatches = matchesBySection[sectionKey] || [];
          const sectionPairings = pairingsBySection[sectionKey] || [];
          const isWithdrawn = (playerId: number) => sectionPairings.some((p: any) => p.playerId === playerId && p.isBye && p.byeType === 'zero_point' && p.round < nextRound);
          const activePlayers = sectionPlayers.filter((p: any) => !isWithdrawn(p.id));
          if (activePlayers.length < 1) continue;

          const numSectionMatches = Math.floor(activePlayers.length / 2) + (activePlayers.length % 2);
          const boardNumbersForSection = allBoardNumbers.slice(boardNumberOffset, boardNumberOffset + numSectionMatches);
          boardNumberOffset += numSectionMatches;

          await generatePairings(tournament, activePlayers, sectionMatches, sectionPairings, nextRound, boardNumbersForSection);
        }
      }

      res.json(updatedTournament);
    } catch (error) {
      console.error('Next round error:', error);
      res.status(500).json({ message: "Failed to generate next round" });
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
        await updateChessResultsScheduler(storage, tournament.id, result.config);

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

  // Update tournament (tournament directors only)
  app.put("/api/tournaments/:id", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.id);
      const tournament = await storage.getTournament(tournamentId);

      if (!tournament) {
        return res.status(404).json({ message: "Tournament not found" });
      }

      // Authorization check: Only the creator can update
      if (tournament.createdBy !== req.user!.id && req.user!.role !== 'admin') {
        return res.status(403).json({ message: "Unauthorized to update this tournament" });
      }

      const tournamentData = insertTournamentSchema.partial().parse(req.body);
      const updatedTournament = await storage.updateTournament(tournamentId, tournamentData);

      res.json(updatedTournament);
    } catch (error) {
      console.error('Tournament update error:', error);
      res.status(400).json({
        message: "Failed to update tournament",
        error: error instanceof Error ? error.message : 'Unknown error'
      });
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

// Create player registration batch (for multi-player cart checkout)
app.post("/api/tournaments/:id/register-batch", requireAuth, async (req, res) => {
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

      const multiPlayerAllowed = Boolean(config.registers.allowMultiPlayerSignup);
      if (!multiPlayerAllowed) {
        return res.status(400).json({ error: "Multi-player registration is not allowed" });
      }

      const payments = config.payments;
      const offlineAllowed = (payments.acceptedOfflineMethods ?? []).length > 0;
      const mustCompletePayment = payments.onlineEnabled && (payments.requirePaymentOnRegistration || !offlineAllowed);

      // Parse payload as array
      if (!Array.isArray(req.body) || req.body.length === 0) {
        return res.status(400).json({ error: "Empty registration payload" });
      }
      const payloadArray = z.array(playerRegistrationSchema).parse(req.body);

      // Check payment intent for the whole batch based on the first item since the cart shares it
      const sampleItem = payloadArray[0];
      const results: any[] = [];
      let amountDue = Number.isFinite(sampleItem.amountDue) ? Number(sampleItem.amountDue) : 0;
      let amountPaid = Number.isFinite(sampleItem.amountPaid) ? Number(sampleItem.amountPaid) : 0;
      let currency = normalizeCurrency(sampleItem.currency, payments.defaultCurrency ?? "USD");
      let paymentStatus: PaymentStatus = sampleItem.paymentStatus ?? "unpaid";
      let paymentMethod = sampleItem.paymentMethod ?? null;
      let paymentReceiptUrl = sampleItem.paymentReceiptUrl ?? null;
      let paidAt: Date | null = null;
      let notes = sampleItem.paymentNotes ?? null;

      if (payments.onlineEnabled && sampleItem.paymentIntentId) {
        if (!stripe) {
          return res.status(503).json({ error: "Online payments are not available" });
        }

        const paymentIntentRaw = await stripe.paymentIntents.retrieve(sampleItem.paymentIntentId, {
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
          console.warn(`[BATCH_REG] Payment verification failed: Required but status is ${paymentIntent.status}`);
          return res.status(400).json({ error: "Payment must be completed before submitting registration" });
        }
        console.log(`[BATCH_REG] Payment intent ${sampleItem.paymentIntentId} verified: ${paymentIntent.status}`);
      }

      // Process insertions and logging sequentially
      console.log(`[BATCH_REG] Processing batch registration for tournament ${tournamentId} by user ${user.id}`);
      console.log(`[BATCH_REG] Payload count: ${payloadArray.length}`);
      console.log(`[BATCH_REG] Full Payload Input:`, JSON.stringify(payloadArray, null, 2));

      // Before inserting new batch, remove all prior registrations for this user in this tournament
      // and if they were approved, remove their associated active players.
      console.log(`[BATCH_REG] Deleting prior registrations for user ${user.id} in tournament ${tournamentId}`);
      const userRegistrationsBatch = await storage.getPlayerRegistrationsByTournament(tournamentId);
      const existingForUserBatch = userRegistrationsBatch.filter((r: any) => r.userId === user.id);
      
      for (const reg of existingForUserBatch) {
        if (reg.status === "approved" && reg.playerName) {
          const nameParts = reg.playerName.trim().split(/\s+/);
          const firstName = nameParts[0] || "";
          const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
          const players = await storage.getPlayersByTournament(tournamentId);
          const playerToRemove = players.find((p: any) => p.firstName === firstName && p.lastName === lastName);
          if (playerToRemove) {
            console.log(`[BATCH_REG] Removing associated player record: ${firstName} ${lastName} (ID: ${playerToRemove.id})`);
            await storage.deletePlayer(playerToRemove.id);
          }
        }
        await storage.deletePlayerRegistration(reg.id);
      }

      for (const payload of payloadArray) {
        console.log(`[BATCH_REG] Processing player entry: ${payload.playerName}`);
        let localNotes = payload.paymentNotes ?? null;
        if (notes && !localNotes) {
          localNotes = notes;
        }

        const newRegistration = await storage.createPlayerRegistration({
          tournamentId,
          userId: user.id,
          playerName: payload.playerName,
          uscfRating: payload.uscfRating,
          fideRating: payload.fideRating,
          ratingProvider: payload.ratingProvider,
          uscfId: payload.uscfId,
          fideId: payload.fideId,
          phoneNumber: payload.phoneNumber,
          email: payload.email,
          address1: payload.address1,
          address2: payload.address2,
          city: payload.city,
          state: payload.state,
          postalCode: payload.postalCode,
          country: payload.country,
          pairingNotifications: payload.pairingNotifications,
          newsletter: payload.newsletter,
          sectionChoice: payload.sectionChoice,
          entryFeeId: payload.entryFeeId,
          processingContribution: payload.processingContribution?.toString() || "0",
          byePreference: payload.byePreference,
          byeRounds: payload.byeRounds,
          arrivalTime: payload.arrivalTime,
          notes: payload.notes,
          paymentIntentId: sampleItem.paymentIntentId ?? null,
          paymentStatus: paymentStatus,
          paymentMethod: paymentMethod,
          paymentReceiptUrl: paymentReceiptUrl,
          paymentNotes: localNotes,
          amountDue: amountDue.toFixed(2),
          amountPaid: amountPaid.toFixed(2),
          currency: currency,
          paidAt: paidAt,
          status: "pending",
        });

        results.push(newRegistration);
      }
      
      // Send Registration Received notification to the user
      try {
        const relatedTournament = await storage.getTournament(tournamentId);
        if (user && relatedTournament && (user.notifyRegistration ?? true)) {
          const subject = `Registration Confirmation: ${relatedTournament.name}`;
          const message = `Thank you for registering for ${relatedTournament.name}. We have received your ${results.length > 1 ? 'batch registration for ' + results.length + ' players' : 'registration'}. Your entry is currently pending review.`;
          
          await storage.createNotification({
            userId: user.id,
            title: subject,
            message,
            type: 'registration_status',
            read: false,
            meta: { tournamentId },
          });

          if ((user.notifyEmail ?? true) && user.email) {
            await notificationService.sendEmail({ to: user.email, subject, text: message });
          }
          if ((user as any).fcmToken) {
            await notificationService.sendPushNotification((user as any).fcmToken, subject, message);
          }
        }
      } catch (confirmErr) {
        console.error("Error sending registration confirmation:", confirmErr);
      }

      res.status(201).json(results);
    } catch (error) {
      console.error("Player batch registration error:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid registration data", issues: error.flatten() });
      }
      res.status(500).json({ error: "Failed to submit batch registration" });
    }
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
      console.log(`[REG_FLOW] Processing single registration for tournament ${tournamentId} (User: ${user.id})`);

      if (!config.registers.allowPlayerToJoin) {
        console.warn(`[REG_FLOW] Registration blocked: Joined disabled in config for tournament ${tournamentId}`);
        return res.status(403).json({ error: "Player registration is not allowed for this tournament" });
      }

      // Check if user already registered for this tournament
      const registrations = await storage.getPlayerRegistrationsByTournament(tournamentId);
      const userRegistrations = registrations.filter((r) => r.userId === user.id);
      const multiPlayerAllowed = Boolean(config.registers.allowMultiPlayerSignup);
      const allowEdit = Boolean(config.registers.allowEditRegistration);

      let existingToUpdate: PlayerRegistration | undefined;

      if (userRegistrations.length > 0 && !multiPlayerAllowed) {
        if (!allowEdit) {
          return res.status(400).json({ error: "You are already registered for this tournament" });
        }
        // In single-player mode, we update the existing one
        existingToUpdate = userRegistrations[0];
      }

      const payments = config.payments;
      const payload = playerRegistrationSchema.parse(req.body ?? {});
      const offlineAllowed = (payments.acceptedOfflineMethods ?? []).length > 0;
      const mustCompletePayment = payments.onlineEnabled && (payments.requirePaymentOnRegistration || !offlineAllowed);

      const entryFee = payload.entryFeeId
        ? config.entryFees.find((fee) => fee.id === payload.entryFeeId) ?? null
        : null;
      const contribution = Number.isFinite(payload.processingContribution) ? Number(payload.processingContribution) : 0;
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

      const registrationData = {
        tournamentId,
        userId: user.id,
        playerName: payload.playerName,
        uscfRating: payload.uscfRating ?? null,
        fideRating: payload.fideRating ?? null,
        ratingProvider: payload.ratingProvider ?? null,
        uscfId: payload.uscfId ?? null,
        fideId: payload.fideId ?? null,
        phoneNumber: payload.phoneNumber ?? null,
        email: payload.email ?? user.email ?? null,
        address1: payload.address1 ?? null,
        address2: payload.address2 ?? null,
        city: payload.city ?? null,
        state: payload.state ?? null,
        postalCode: payload.postalCode ?? null,
        country: payload.country ?? null,
        pairingNotifications: payload.pairingNotifications ?? null,
        newsletter: payload.newsletter ?? false,
        sectionChoice: payload.sectionChoice ?? null,
        entryFeeId: payload.entryFeeId ?? null,
        processingContribution: payload.processingContribution?.toString() || "0",
        byePreference: payload.byePreference ?? null,
        byeRounds: payload.byeRounds ?? [],
        arrivalTime: payload.arrivalTime ?? "",
        notes: payload.notes ?? null,
        paymentStatus,
        paymentIntentId: payload.paymentIntentId ?? null,
        paymentMethod,
        paymentReceiptUrl,
        paymentNotes: notes,
        amountDue,
        amountPaid,
        currency,
        paidAt,
      };

      console.log(`[REG_SERVER] Final registration data for user ${user.id}:`, JSON.stringify(registrationData, null, 2));

      let result: any = null;
      if (existingToUpdate) {
        if (existingToUpdate.status === "approved" && existingToUpdate.playerName) {
          const nameParts = existingToUpdate.playerName.trim().split(/\s+/);
          const firstName = nameParts[0] || "";
          const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
          const players = await storage.getPlayersByTournament(tournamentId);
          const playerToRemove = players.find((p: any) => p.firstName === firstName && p.lastName === lastName);
          if (playerToRemove) {
            await storage.deletePlayer(playerToRemove.id);
          }
        }
        
        result = await storage.updatePlayerRegistration(existingToUpdate.id, {
          ...registrationData,
          status: "pending",
        } as any);
      } else {
        result = await storage.createPlayerRegistration({
          ...registrationData,
          status: "pending",
        } as any);
      }

      // Send Registration Received notification
      try {
        const user = req.user!;
        const tournament = await storage.getTournament(tournamentId);
        if (user && tournament && (user.notifyRegistration ?? true)) {
          const subject = `Registration Received: ${tournament.name}`;
          const message = `Thank you for registering for ${tournament.name}. Your registration is currently pending review by the tournament director.`;
          
          await storage.createNotification({
            userId: user.id,
            title: subject,
            message,
            type: 'registration_status',
            read: false,
            meta: { tournamentId, registrationId: result.id },
          });

          if ((user.notifyEmail ?? true) && user.email) {
            await notificationService.sendEmail({ to: user.email, subject, text: message });
          }
          if ((user as any).fcmToken) {
            await notificationService.sendPushNotification((user as any).fcmToken, subject, message);
          }
        }
      } catch (notifErr) {
        console.error("Error sending registration confirmation:", notifErr);
      }

      if (result) {
        res.json(result);
      } else {
        res.status(500).json({ error: "Failed to create registration result" });
      }
    } catch (error) {
      console.error("Error creating player registration:", error);
      res.status(500).json({ error: "Failed to register for tournament" });
    }
  });

// Player editing their own registration
app.patch("/api/tournaments/:id/registrations/my", requireAuth, async (req, res) => {
    try {
      const tournamentId = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(tournamentId)) {
        return res.status(400).json({ error: "Invalid tournament id" });
      }
      const user = req.user!;

      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) {
        return res.status(404).json({ error: "Tournament not found" });
      }

      const config = parseTournamentConfig(tournament);
      if (!config.registers.allowEditRegistration) {
        return res.status(403).json({ error: "Registration editing is not allowed for this tournament" });
      }

      const registrations = await storage.getPlayerRegistrationsByTournament(tournamentId);
      const registration = registrations.find((r: any) => r.userId === user.id);
      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }

      // Validate updates
      const payload = playerRegistrationSchema.partial().parse(req.body ?? {});

      // Update only specific fields for player-initiated edit
      const updateData: any = {
        status: "pending",
        updatedAt: new Date()
      };
      const editableFields = [
        'playerName', 'uscfRating', 'fideRating', 'uscfId', 'fideId', 
        'phoneNumber', 'email', 'address1', 'address2', 'city', 'state', 
        'postalCode', 'country', 'pairingNotifications', 'newsletter',
        'sectionChoice', 'entryFeeId', 'processingContribution',
        'byePreference', 'byeRounds', 'arrivalTime', 'notes', 'paymentNotes'
      ];

      for (const field of editableFields) {
        if ((payload as any)[field] !== undefined) {
          updateData[field] = (payload as any)[field];
        }
      }

      const updated = await storage.updatePlayerRegistration(registration.id, updateData);
      if (!updated) {
        return res.status(500).json({ error: "Failed to update registration" });
      }

      // Notify Director
      try {
        const director = await storage.getUserById(tournament.createdBy);
        if (director && director.email && notificationService.isEnabled()) {
          await notificationService.sendEmail({
            to: director.email,
            subject: `Registration Updated: ${tournament.name}`,
            text: `Player ${updated.playerName || user.username} has updated their registration for ${tournament.name}.\n\nView details in your dashboard.`
          });
        }
      } catch (notifyError) {
        console.error("Failed to notify director about registration update:", notifyError);
      }

      res.json(updated);
    } catch (error) {
      console.error("Error updating registration:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid registration data", issues: error.flatten() });
      }
      res.status(500).json({ error: "Failed to update registration" });
    }
  });

// Delete individual registration (for players to cancel entries in a group)
app.delete("/api/registrations/:id", requireAuth, async (req, res) => {
    try {
      const registrationId = parseInt(req.params.id);
      const user = req.user!;
 
      const registration = await storage.getPlayerRegistration(registrationId);
      if (!registration) {
        return res.status(404).json({ error: "Registration not found" });
      }
 
      // Security: Only the owner or a TD with access to the tournament can delete
      const tournament = await storage.getTournament(registration.tournamentId);
      const isOwner = registration.userId === user.id;
      const isTD = user.role === 'tournament_director' && tournament?.createdBy === user.id;
 
      if (!isOwner && !isTD) {
        return res.status(403).json({ error: "You don't have permission to remove this registration" });
      }
 
      // If the registration was already approved, clean up the player record too
      if (registration.status === 'approved' && registration.playerName) {
        const nameParts = registration.playerName.trim().split(/\s+/);
        const firstName = nameParts[0] || "";
        const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
        
        const players = await storage.getPlayersByTournament(registration.tournamentId);
        const playerToRemove = players.find((p: any) => p.firstName === firstName && p.lastName === lastName);
        
        if (playerToRemove) {
          console.log(`[REG_DEL] Removing associated player record for approved registration: ${playerToRemove.id}`);
          await storage.deletePlayer(playerToRemove.id);
        }
      }
 
      const deleted = await storage.deletePlayerRegistration(registrationId);
      if (!deleted) {
        return res.status(500).json({ error: "Failed to delete registration" });
      }
 
      res.status(200).json({ message: "Registration removed successfully" });
    } catch (error) {
      console.error("Error deleting registration:", error);
      res.status(500).json({ error: "Failed to remove registration" });
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
          const fullName = normalizePlayerName(updatedRegistration.playerName || `${user.firstName} ${user.lastName}`);
          const nameParts = fullName.split(/\s+/);
          const firstName = nameParts[0] || "";
          const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

          const tournament = await storage.getTournament(tournamentId);
          if (!tournament) {
            return res.status(404).json({ error: "Tournament not found" });
          }
          const regConfig = parseTournamentConfig(tournament);
          const primarySystem = regConfig.details.primaryRatingSystem || 'uscf';
          
          // Determine which rating to use. 
          // 1. If the registration has a specific provider, use it.
          // 2. Fall back to tournament default config.
          let rating: number | null = null;
          const provider = (updatedRegistration as any).ratingProvider;
          
          console.log(`[APPROVAL_LOG] Processing approval for ${updatedRegistration.playerName}`);
          console.log(`[APPROVAL_LOG] User selected provider: ${provider}, Primary System: ${primarySystem}`);
          console.log(`[APPROVAL_LOG] USCF Rating in registration: ${updatedRegistration.uscfRating}`);
          console.log(`[APPROVAL_LOG] FIDE Rating in registration: ${updatedRegistration.fideRating}`);

          if (provider === "fide") {
            rating = updatedRegistration.fideRating ?? updatedRegistration.uscfRating ?? null;
          } else if (provider === "uscf") {
            rating = updatedRegistration.uscfRating ?? updatedRegistration.fideRating ?? null;
          } else if (provider === "manual") {
            rating = updatedRegistration.uscfRating ?? updatedRegistration.fideRating ?? null;
          } else {
            // Standard fallback logic using Primary System
            rating = primarySystem === 'fide' 
              ? (updatedRegistration.fideRating ?? updatedRegistration.uscfRating ?? null)
              : (updatedRegistration.uscfRating ?? updatedRegistration.fideRating ?? null);
            console.log(`[APPROVAL_LOG] Falling back to Primary System (${primarySystem}), Selected rating: ${rating}`);
          }

          const federation = provider === 'fide' ? 'FIDE' : (provider === 'uscf' ? 'USCF' : (primarySystem === 'fide' ? 'FIDE' : 'USCF'));
          console.log(`[APPROVAL_LOG] Creating/Updating player with rating: ${rating}, federation: ${federation}`);

          const players = await storage.getPlayersByTournament(tournamentId);
          const existingPlayer = players.find((p: any) => 
            p.firstName.trim().toLowerCase() === firstName.toLowerCase() && 
            p.lastName.trim().toLowerCase() === lastName.toLowerCase()
          );

          const playerUpdatePayload = {
            rating: rating,
            uscfRating: updatedRegistration.uscfRating,
            fideRating: updatedRegistration.fideRating,
            federation: federation,
            userId: updatedRegistration.userId,
          };

          if (existingPlayer) {
            console.log(`[APPROVAL_LOG] Existing player found (ID: ${existingPlayer.id}), updating instead of creating duplicate.`);
            await storage.updatePlayer(existingPlayer.id, playerUpdatePayload);
          } else {
            await storage.createPlayer({
              ...playerUpdatePayload,
              tournamentId,
              firstName,
              lastName,
            });
          }
        }
      }
      // Send status update notification
      if (updatedRegistration) {
        try {
          const userForNotification = await storage.getUserById(updatedRegistration.userId);
          const relatedTournament = await storage.getTournament(tournamentId);
          if (userForNotification && relatedTournament) {
            const subject = `Tournament Registration ${status.charAt(0).toUpperCase() + status.slice(1)}`;
            let message = '';
            if (status === 'approved') {
              message = `Great news! Your registration for ${relatedTournament.name} has been approved.`;
            } else if (status === 'declined') {
              message = `Your registration for ${relatedTournament.name} has been declined. Please contact the organizer for details.`;
            }
            
            if (message) {
              // Persist in-app notification
              try {
                await storage.createNotification({
                  userId: updatedRegistration.userId,
                  title: subject,
                  message,
                  type: 'registration_status',
                  read: false,
                  meta: { tournamentId, registrationId, status },
                });
              } catch (dbNotifErr) {
                console.error("Error persisting in-app notification:", dbNotifErr);
              }

              if (userForNotification.notifyRegistration ?? true) {
                if (userForNotification.email && (userForNotification.notifyEmail ?? true)) {
                  await notificationService.sendEmail({ 
                    to: userForNotification.email, 
                    subject, 
                    text: message 
                  });
                }
                if ((userForNotification as any).fcmToken) {
                  await notificationService.sendPushNotification((userForNotification as any).fcmToken, subject, message);
                }
              }
            }
          }
        } catch (notifErr) {
          console.error("Error sending status notification:", notifErr);
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
        if (req.body?.uscfRating !== undefined && req.body?.uscfRating !== null) {
          const numeric = Number(req.body.uscfRating);
          if (Number.isFinite(numeric)) {
            updates.uscfRating = Math.max(0, Math.round(numeric));
          }
        }
        if (req.body?.fideRating !== undefined && req.body?.fideRating !== null) {
          const numeric = Number(req.body.fideRating);
          if (Number.isFinite(numeric)) {
            updates.fideRating = Math.max(0, Math.round(numeric));
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
        targetPairing = tournamentPairings.find((p: any) => p.id === pairingId);
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
      const currentRound = currentMatches.length > 0 ? Math.max(...currentMatches.map((m: any) => m.round)) : 0;

      // Get current player status from existing byes (only system-assigned withdrawal byes)
      const allPairings = await storage.getPairingsByTournament(player.tournamentId);
      const currentPlayerByes = allPairings.filter((p: any) => p.playerId === playerId && p.isBye);
      const currentWithdrawnByes = currentPlayerByes.filter((p: any) =>
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
              const existingBye = existingByes.find((p: any) => p.playerId === playerId && p.isBye);

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
          const futureWithdrawnByes = allPairings.filter((p: any) =>
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
          const existingBye = existingByes.find((p: any) => p.playerId === playerId && p.isBye);

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
      const finalPlayerByes = finalPairings.filter((p: any) => p.playerId === playerId && p.isBye);
      const finalWithdrawnByes = finalPlayerByes.filter((p: any) =>
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

// Update player seed manually
app.patch("/api/players/:id/seed", requireAuth, requireRole('tournament_director'), async (req, res) => {
    try {
      const playerId = parseInt(req.params.id);
      const { seed } = req.body;

      const user = req.user;
      if (!user) {
        return res.status(401).json({ message: "User not found" });
      }

      const player = await storage.getPlayer(playerId);
      if (!player) {
        return res.status(404).json({ message: "Player not found" });
      }

      const tournament = await storage.getTournament(player.tournamentId);
      if (!tournament || tournament.createdBy !== user.id) {
        return res.status(403).json({ message: "Access denied" });
      }

      const updated = await storage.updatePlayer(playerId, { seed: seed === null || seed === "" ? null : parseInt(seed) });
      res.json(updated);
    } catch (error) {
      console.error('Player seed update error:', error);
      res.status(500).json({ message: "Failed to update player seed" });
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

        // Handle Knockout Advancement
        const tournament = await storage.getTournament(currentMatch.tournamentId);
        if (tournament?.format === 'knockout' && (updatedMatch.result === '1-0' || updatedMatch.result === '0-1')) {
          const winnerId = updatedMatch.result === '1-0' ? updatedMatch.whitePlayerId : updatedMatch.blackPlayerId;
          if (winnerId) {
            const nextRound = currentMatch.round + 1;
            if (currentMatch.board !== null && currentMatch.board !== undefined) {
              const nextBoard = Math.ceil(currentMatch.board / 2);
              const isWhite = currentMatch.board % 2 !== 0;

              const matches = await storage.getMatchesByTournament(tournament.id);
              const nextMatch = matches.find(m => m.round === nextRound && m.board === nextBoard);

              if (nextMatch) {
                await storage.updateMatch(nextMatch.id, {
                  [isWhite ? 'whitePlayerId' : 'blackPlayerId']: winnerId
                });
                console.log(`Advancing player ${winnerId} to Round ${nextRound}, Board ${nextBoard} as ${isWhite ? 'White' : 'Black'}`);
              }
            }
          }
        }

        // Notify players about result change
        const resultText = updatedMatch.result === '1-0' ? 'White won' : updatedMatch.result === '0-1' ? 'Black won' : updatedMatch.result === '1/2-1/2' ? 'Draw' : updatedMatch.result;
        if (whitePlayerName?.userId) {
          await storage.createNotification({
            userId: whitePlayerName.userId,
            title: "Match Result Updated",
            message: `The result for your Round ${currentMatch.round} match has been recorded: ${resultText}.`,
            type: "result_update",
            meta: { matchId: currentMatch.id, tournamentId: currentMatch.tournamentId }
          });
        }
        if (blackPlayerName?.userId) {
          await storage.createNotification({
            userId: blackPlayerName.userId,
            title: "Match Result Updated",
            message: `The result for your Round ${currentMatch.round} match has been recorded: ${resultText}.`,
            type: "result_update",
            meta: { matchId: currentMatch.id, tournamentId: currentMatch.tournamentId }
          });
        }
      }

      res.json(updatedMatch);
    } catch (error) {
      console.error('Update match error:', error);
      res.status(500).json({ message: "Failed to update match" });
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
        const allPairings = await storage.getPairingsByTournament(tournamentId);
        const allMatches = await storage.getMatchesByTournament(tournamentId);

        // Group players by section
        const playersBySection = players.reduce((acc: any, player: any) => {
          const sectionKey = player.sectionId || 'default';
          if (!acc[sectionKey]) {
            acc[sectionKey] = [];
          }
          acc[sectionKey].push(player);
          return acc;
        }, {} as Record<string, Player[]>);

        const combinedResults = {
          pairings: [] as Pairing[],
          matches: [] as Match[],
          message: "",
        };

        for (const sectionKey in playersBySection) {
          const sectionPlayers = playersBySection[sectionKey];
          if (sectionPlayers.length < 2) continue;

          console.log(`Processing Round Robin for section ${sectionKey} with ${sectionPlayers.length} players`);

          // This logic assumes we regenerate the whole tournament or nothing.
          // For per-section regeneration, a more granular approach would be needed.
          if (regenerate) {
            // For simplicity, we assume a full tournament regeneration.
            // A production system might need to clear only section-specific data.
          }

          // Generate all Round Robin pairings for the section
          const { generateRoundRobinSchedule, validateRoundRobinSchedule } = await import('../round-robin');
          const roundRobinPairings = generateRoundRobinSchedule(sectionPlayers);
          const numRounds = sectionPlayers.length % 2 === 0 ? sectionPlayers.length - 1 : sectionPlayers.length;

          console.log(`Generating schedule for section ${sectionKey}: ${sectionPlayers.length} players, ${numRounds} rounds, ${roundRobinPairings.length} total pairings`);

          const playerIds = sectionPlayers.map((p: any) => p.id);
          if (!validateRoundRobinSchedule(roundRobinPairings, playerIds)) {
            throw new Error(`Invalid Round Robin schedule generated for section ${sectionKey}`);
          }

          // Fetch users to check preferences
          const userIds = Array.from(new Set(sectionPlayers.map((p: any) => p.userId).filter(Boolean))) as number[];
          const users = await storage.listUsersByIds(userIds);
          const userMap = new Map(users.map((u: any) => [u.id, u]));

          const sendRealNotification = async (userId: number, title: string, message: string, preferenceKey: 'notifyPairings' | 'notifyTournamentStatus') => {
            const user = userMap.get(userId) as any;
            if (!user || !(user[preferenceKey] ?? true)) return;

            // Email
            if ((user.notifyEmail ?? true) && user.email) {
              await notificationService.sendEmail({ to: user.email, subject: title, text: message }).catch((err: any) => console.error(`Failed to send email to ${user.email}:`, err));
            }
            // Push
            if ((user as any).fcmToken) {
              await notificationService.sendPushNotification((user as any).fcmToken, title, message).catch((err: any) => console.error(`Failed to send push to ${user.username}:`, err));
            }
          };

          // Notify tournament start for RR if it's the first execution
          for (const player of sectionPlayers) {
            if (player.userId) {
              const title = "Tournament Started";
              const message = `The tournament "${tournament.name}" has officially started! Round Robin pairings are now available.`;
              await storage.createNotification({
                userId: player.userId,
                title,
                message,
                type: "tournament_status",
                meta: { tournamentId }
              });
              await sendRealNotification(player.userId, title, message, 'notifyTournamentStatus');
            }
          }

          for (const pairing of roundRobinPairings) {
            if (pairing.isBye) {
              const savedPairing = await storage.createPairing({
                tournamentId, round: pairing.round, playerId: pairing.whitePlayerId!,
                opponentId: null, color: null, points: 2, isBye: true
              });
              combinedResults.pairings.push(savedPairing);

              const player = sectionPlayers.find((p: any) => p.id === pairing.whitePlayerId);
              if (player?.userId) {
                const title = "Round Bye";
                const message = `Round ${pairing.round}: You have a bye for this round.`;
                await storage.createNotification({
                  userId: player.userId,
                  title,
                  message,
                  type: "pairing",
                   meta: { tournamentId }
                });
                await sendRealNotification(player.userId, title, message, 'notifyPairings');
              }
            } else {
              const whitePairing = await storage.createPairing({
                tournamentId, round: pairing.round, playerId: pairing.whitePlayerId!,
                opponentId: pairing.blackPlayerId!, color: 'white', points: 0, isBye: false
              });
              const blackPairing = await storage.createPairing({
                tournamentId, round: pairing.round, playerId: pairing.blackPlayerId!,
                opponentId: pairing.whitePlayerId!, color: 'black', points: 0, isBye: false
              });
              combinedResults.pairings.push(whitePairing, blackPairing);

              const match = await storage.createMatch({
                tournamentId, round: pairing.round, whitePlayerId: pairing.whitePlayerId!,
                blackPlayerId: pairing.blackPlayerId!, board: pairing.board, result: null, status: 'pending'
              });
              combinedResults.matches.push(match);

              // Notify players for Round Robin pairing
              const whitePlayer = sectionPlayers.find((p: any) => p.id === pairing.whitePlayerId);
              const blackPlayer = sectionPlayers.find((p: any) => p.id === pairing.blackPlayerId);
              const title = "New Pairing Assigned";

              if (whitePlayer?.userId) {
                const message = `Round ${pairing.round}: You are playing White against ${blackPlayer?.firstName || 'Unknown'} on Board ${pairing.board}.`;
                await storage.createNotification({
                  userId: whitePlayer.userId,
                  title,
                  message,
                  type: "pairing",
                  meta: { matchId: match.id, tournamentId }
                });
                await sendRealNotification(whitePlayer.userId, title, message, 'notifyPairings');
              }
              if (blackPlayer?.userId) {
                const message = `Round ${pairing.round}: You are playing Black against ${whitePlayer?.firstName || 'Unknown'} on Board ${pairing.board}.`;
                await storage.createNotification({
                  userId: blackPlayer.userId,
                  title,
                  message,
                  type: "pairing",
                  meta: { matchId: match.id, tournamentId }
                });
                await sendRealNotification(blackPlayer.userId, title, message, 'notifyPairings');
              }
            }
          }
        }

        if (regenerate) {
          // If regenerating, clear existing data first
          console.log('Regenerating Round Robin tournament - clearing existing data');
          for (const pairing of allPairings) {
            await storage.deletePairing(pairing.id);
          }
          for (const match of allMatches) {
            await storage.deleteMatch(match.id);
          }
          await storage.createHistoryEntry({
            tournamentId, action: 'regenerate_all_rounds', description: `Round Robin tournament regenerated`,
            changedBy: user.id, previousState: JSON.stringify({ pairingsCount: allPairings.length, matchesCount: allMatches.length }),
            newState: JSON.stringify({ regenerated: true }), round: null, canRevert: false
          });
        }

        await storage.updateTournament(tournamentId, { currentRound: 1 });

        combinedResults.message = `Round Robin tournament started/regenerated! Generated pairings for ${Object.keys(playersBySection).length} sections.`;
        return res.json(combinedResults);
      }

      // --- SWISS PAIRING LOGIC ---

      const allPlayers = await storage.getPlayersByTournament(tournamentId);
      const allMatches = await storage.getMatchesByTournament(tournamentId);
      const allPairings = await storage.getPairingsByTournament(tournamentId);

      const playerMap = new Map(allPlayers.map((p: any) => [p.id, p]));

      const playersBySection = allPlayers.reduce((acc: any, player: any) => {
        const sectionKey = player.sectionId || 'default';
        if (!acc[sectionKey]) acc[sectionKey] = [];
        acc[sectionKey].push(player);
        return acc;
      }, {} as Record<string, any[]>);

      const matchesBySection = allMatches.reduce((acc: any, match: any) => {
        const player = playerMap.get(match.whitePlayerId!) ?? playerMap.get(match.blackPlayerId!);
        if (player) {
          const sectionKey = player.sectionId || 'default';
          if (!acc[sectionKey]) acc[sectionKey] = [];
          acc[sectionKey].push(match);
        }
        return acc;
      }, {} as Record<string, any[]>);

      const pairingsBySection = allPairings.reduce((acc: any, pairing: any) => {
        const player: any = playerMap.get(pairing.playerId);
        if (player) {
          const sectionKey = player.sectionId || 'default';
          if (!acc[sectionKey]) acc[sectionKey] = [];
          acc[sectionKey].push(pairing);
        }
        return acc;
      }, {} as Record<string, any[]>);

      const finalResults = {
        pairings: [] as any[],
        matches: [] as any[],
        message: "Pairings generated successfully for all sections.",
      };

      let currentRound: number;
      if (regenerate && targetRound) {
        currentRound = targetRound;
      } else {
        currentRound = (tournament.currentRound || 0) + 1;
      }

      // Pre-calculate total matches for board numbering
      let totalMatches = 0;
      for (const sectionKey in playersBySection) {
        const sectionPlayers = playersBySection[sectionKey];
        const sectionPairings = pairingsBySection[sectionKey] || [];
        const isWithdrawn = (playerId: number) => sectionPairings.some((p: any) => p.playerId === playerId && p.isBye && p.byeType === 'zero_point' && p.round < currentRound);
        const activePlayers = sectionPlayers.filter((p: any) => !isWithdrawn(p.id));
        if (activePlayers.length < 2) continue;
        totalMatches += Math.floor(activePlayers.length / 2);
        if (activePlayers.length % 2 === 1) {
          totalMatches++;
        }
      }

      const allBoardNumbers = generateBoardNumberSequence(tournament.boardNumberingSettings as BoardNumberingSettings, totalMatches);
      let boardNumberOffset = 0;

      // Generate pairings for each section
      for (const sectionKey in playersBySection) {
        const sectionPlayers = playersBySection[sectionKey];
        if (sectionPlayers.length < 1) continue;

        if (tournament.format === "roundrobin" && sectionPlayers.length >= 2) {
          const { generateRoundRobinSchedule, validateRoundRobinSchedule } = await import('../round-robin');
          console.log(`Generating Round Robin schedule for ${sectionPlayers.length} players in section ${sectionKey}`);
          const roundRobinPairings = generateRoundRobinSchedule(sectionPlayers);
          const playerIds = sectionPlayers.map((p: any) => p.id);

          if (!validateRoundRobinSchedule(roundRobinPairings, playerIds)) {
            throw new Error(`Invalid Round Robin schedule generated for section ${sectionKey}`);
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

              // Create completed match for the bye to show in bracket
              await storage.createMatch({
                tournamentId,
                round: pairing.round,
                whitePlayerId: pairing.whitePlayerId!,
                blackPlayerId: null,
                board: pairing.board,
                result: "1-0",
                status: "completed",
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
        } else if (tournament.format === "knockout" && sectionPlayers.length >= 2) {
          const { generateKnockoutPairings } = await import('../knockout');
          console.log(`Generating Knockout bracket for ${sectionPlayers.length} players in section ${sectionKey}`);
          
          let sortedPlayers;
          if (tournament.seedingMethod === 'random') {
            // Shuffle players for random seeding
            sortedPlayers = [...sectionPlayers].sort(() => Math.random() - 0.5);
          } else {
            // Default to rating-based seeding
            sortedPlayers = [...sectionPlayers].sort((a, b) => {
              const getRating = (p: any) => tournament.tiebreakOrder === 'uscf' ? (p.uscfRating || p.rating) : p.rating;
              return getRating(b) - getRating(a);
            });
          }

          const knockoutPairings = generateKnockoutPairings(sortedPlayers);

          for (const pairing of knockoutPairings) {
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

              // Create completed match for the bye to show in bracket
              await storage.createMatch({
                tournamentId,
                round: pairing.round,
                whitePlayerId: pairing.whitePlayerId!,
                blackPlayerId: null,
                board: pairing.board,
                result: "1-0",
                status: "completed",
              });
            } else {
              if (pairing.whitePlayerId && pairing.blackPlayerId) {
                await storage.createPairing({
                  tournamentId,
                  round: pairing.round,
                  playerId: pairing.whitePlayerId,
                  opponentId: pairing.blackPlayerId,
                  color: "white",
                  points: 0,
                  isBye: false,
                });
                await storage.createPairing({
                  tournamentId,
                  round: pairing.round,
                  playerId: pairing.blackPlayerId,
                  opponentId: pairing.whitePlayerId,
                  color: "black",
                  points: 0,
                  isBye: false,
                });

                await storage.createMatch({
                  tournamentId,
                  round: pairing.round,
                  whitePlayerId: pairing.whitePlayerId,
                  blackPlayerId: pairing.blackPlayerId,
                  board: pairing.board,
                  result: null,
                  status: "pending",
                });
              }
            }
          }
        } else if (sectionPlayers.length >= 1) {
          const numSectionMatches = Math.floor(sectionPlayers.length / 2) + (sectionPlayers.length % 2);
          const boardNumbersForSection = allBoardNumbers.slice(boardNumberOffset, boardNumberOffset + numSectionMatches);
          boardNumberOffset += numSectionMatches;
          await generatePairings(tournament, sectionPlayers, [], [], 1, boardNumbersForSection);
        }
      }

      finalResults.message = `Pairings generated for round ${currentRound}.`;
      res.json(finalResults);

    } catch (error) {
      console.error('Pairing generation error:', error);
      res.status(500).json({ error: "Failed to generate pairings" });
    }
  });
}
