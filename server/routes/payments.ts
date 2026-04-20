import { insertMatchSchema } from '@shared/schema';
import { serializeTournamentConfig, PaymentSettings } from '@shared/tournament-config';
import type { Express, Request, Response } from "express";
import { z } from "zod";
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


export function applyPaymentsRoutes(app: Express) {
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

      let baseAmount = 0;
      let targetCurrency = payments.defaultCurrency ?? "USD";
      let summaryNames: string[] = [];
      let entryFeeIds: string[] = [];

      if (payload.items && payload.items.length > 0) {
        for (const item of payload.items) {
          const entryFee = item.entryFeeId ? config.entryFees.find((fee) => fee.id === item.entryFeeId) ?? null : null;
          if (!entryFee && payments.requirePaymentOnRegistration) {
            return res.status(400).json({ message: "Select an entry fee before paying for all items" });
          }
          const itemContribution = Number.isFinite(item.contribution) ? Number(item.contribution) : 0;
          baseAmount += (entryFee?.amount ?? 0) + itemContribution;
          if (entryFee?.currency) targetCurrency = normalizeCurrency(entryFee.currency, targetCurrency);
          if (item.entryFeeId) entryFeeIds.push(item.entryFeeId);
          if (item.playerName) summaryNames.push(item.playerName);
        }
      } else {
        const contribution = Number.isFinite(payload.contribution) ? Number(payload.contribution) : 0;
        const entryFee = payload.entryFeeId
          ? config.entryFees.find((fee) => fee.id === payload.entryFeeId) ?? null
          : null;
        if (!entryFee && payments.requirePaymentOnRegistration) {
          return res.status(400).json({ message: "Select an entry fee before paying" });
        }
        baseAmount = (entryFee?.amount ?? 0) + contribution;
        if (entryFee?.currency) targetCurrency = normalizeCurrency(entryFee.currency, targetCurrency);
        if (payload.entryFeeId) entryFeeIds.push(payload.entryFeeId);
        if (payload.playerName) summaryNames.push(payload.playerName);
      }

      const percent = Number(payments.processingFeePercent ?? 0);
      const feeAmount = percent > 0 ? Number((baseAmount * (percent / 100)).toFixed(2)) : 0;
      const total = Number((baseAmount + feeAmount).toFixed(2));
      const subtotal = Number(baseAmount.toFixed(2));
      const currency = targetCurrency;

      const totals = { subtotal, feeAmount, total, currency };

      if (totals.total <= 0) {
        return res.status(400).json({ message: "Payment amount must be greater than zero" });
      }

      const amountInMinorUnits = Math.max(1, Math.round(totals.total * 100));
      const description = `${tournament.name} registration`;
      const receiptEmail = payload.receiptEmail ?? req.user?.email ?? undefined;

      const descriptorSuffix = payments.payoutStatementDescriptor?.trim()
        ? payments.payoutStatementDescriptor.trim().slice(0, 22)
        : undefined;

      let paymentDescription = description;
      if (summaryNames.length > 1) {
        paymentDescription = `${description} for ${summaryNames.length} players`;
      } else if (summaryNames.length === 1) {
        paymentDescription = `${description} for ${summaryNames[0]}`;
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInMinorUnits,
        currency: totals.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: {
          tournamentId: `${tournamentId}`,
          tournamentName: tournament.name ?? "",
          userId: `${req.user?.id ?? ""}`,
          entryFeeIds: entryFeeIds.join(","),
          isBatch: payload.items && payload.items.length > 0 ? "true" : "false",
        },
        receipt_email: receiptEmail,
        description: paymentDescription,
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
        const registrations = await storage.getPlayerRegistrationsByPaymentIntent(intent.id);
        if (registrations && registrations.length > 0) {
          const statusMap: Record<string, PaymentStatus> = {
            succeeded: "paid",
            processing: "processing",
            requires_payment_method: "unpaid",
            requires_action: "processing",
            canceled: "failed",
            payment_failed: "failed",
          };

          const mappedStatus = statusMap[intent.status] ?? "processing";
          const amountReceived = Number(((intent.amount_received ?? 0) / 100).toFixed(2));
          const currency = intent.currency ? intent.currency.toUpperCase() : registrations[0].currency ?? "USD";
          const intentWithCharges = intent as Stripe.PaymentIntent & {
            charges?: Stripe.ApiList<Stripe.Charge>;
          };
          const latestCharge = intentWithCharges.charges?.data?.[0];

          await Promise.all(registrations.map(async (registration) => {
            const fallbackAmountMinorUnits = Math.round(Number(String(registration.amountDue ?? "0")) * 100);
            const amountTotal = Number(
              (((intent.amount ?? fallbackAmountMinorUnits) as number) / 100).toFixed(2),
            );
            const notes =
              intent.last_payment_error?.message ?? intent.cancellation_reason ?? registration.paymentNotes ?? null;

            return storage.updatePlayerRegistration(registration.id, {
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
          }));
        }
      }
    } catch (error) {
      console.error("Stripe webhook handling error", error);
      return res.status(500).send("Webhook processing failed");
    }

    res.json({ received: true });
  });

}
