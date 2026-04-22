import { insertMatchSchema } from '@shared/schema';
import type { Express } from "express";
import { z } from "zod";
import Stripe from "stripe";
import {
  lookupUSCF, lookupFide, mapLocalResult, extractQueryParam, normalizeSearchParams, parseLimitParam, getGeminiConfig, normalizeCurrency, computePaymentTotals, normalizeAccountPaymentSettings, formatCurrencyAmount, describeRatingWindow, generatePairings, groupPlayersByScore, pairUpperVsLowerHalf, determineSwissColors, generateSwissPairings, generateBoardNumberSequence, RatingSource, STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET, stripe, PAYMENT_STATUSES, PaymentStatus, RatingLookupResult, paymentProviderEnum, paymentScopeEnum, offlineMethodEnum, updateTournamentPaymentsSchema, accountPaymentSettingsSchema, geminiDraftSchema, updateNotificationPreferencesSchema, tournamentNotificationSchema, createPaymentIntentSchema, playerRegistrationSchema, BoardNumberingSettings,
  advanceKnockoutWinner
} from "./common";

import { storage } from '../storage';
import { requireAuth, requireRole, requireTournamentAccess } from '../auth';
import { notificationService } from '../notifications';
import { parseTournamentConfig } from "@shared/tournament-config";
import { generateFideTrf16Report } from '../lib/fideTrf';
import { lookupFideProfiles, searchFideDirectory } from '../lib/fideDirectory';
import { Player, Pairing, Match, PlayerRegistration } from "@shared/schema";


export function applyPairingsRoutes(app: Express) {
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

      // Notify players
      try {
        const whitePlayer = await storage.getPlayer(newMatch.whitePlayerId!);
        const blackPlayer = newMatch.blackPlayerId ? await storage.getPlayer(newMatch.blackPlayerId) : null;
        
        if (whitePlayer?.userId) {
          await storage.createNotification({
            userId: whitePlayer.userId,
            title: "New Match Created",
            message: `Round ${newMatch.round}: A match has been manually created for you on Board ${newMatch.board}.`,
            type: "pairing",
            meta: { matchId: newMatch.id, tournamentId }
          });
        }
        if (blackPlayer?.userId) {
          await storage.createNotification({
            userId: blackPlayer.userId,
            title: "New Match Created",
            message: `Round ${newMatch.round}: A match has been manually created for you on Board ${newMatch.board}.`,
            type: "pairing",
            meta: { matchId: newMatch.id, tournamentId }
          });
        }
      } catch (notifErr) {
        console.error("Error creating manual match notification:", notifErr);
      }

      res.status(201).json(newMatch);
    } catch (error) {
      res.status(400).json({ message: "Invalid match data" });
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

  // Knockout specific match routes
  app.post("/api/tournaments/:tournamentId/matches/:matchId/confirm-winner", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const matchId = parseInt(req.params.matchId);
      const { winnerId } = req.body;

      const match = await storage.getMatch(matchId);
      if (!match) return res.status(404).json({ message: "Match not found" });

      const tournament = await storage.getTournament(tournamentId);
      if (!tournament) return res.status(404).json({ message: "Tournament not found" });

      // Determine winner and loser
      const winnerIdNum = typeof winnerId === 'string' ? parseInt(winnerId) : winnerId;
      const loserId = winnerIdNum === match.whitePlayerId ? match.blackPlayerId : match.whitePlayerId;

      // Mark this match as completed and store winner
      const resultStr = (winnerIdNum === match.whitePlayerId) ? '1-0' : (winnerIdNum === match.blackPlayerId ? '0-1' : null);
      await storage.updateMatch(matchId, { 
        status: 'completed',
        winnerId: winnerIdNum,
        result: resultStr
      });

      console.log(`[KnockoutAdvancement] Match ${match.id} (R${match.round} B${match.board}) winner: ${winnerIdNum}, loser: ${loserId}`);

      // ADVANCE WINNER
      if (tournament.format === 'knockout') {
        await advanceKnockoutWinner(tournamentId, match, winnerIdNum);
      }

      res.json({ message: "Winner confirmed and advanced" });
    } catch (error) {
      console.error("Error confirming winner:", error);
      res.status(500).json({ message: "Failed to confirm winner" });
    }
  });

  app.post("/api/tournaments/:tournamentId/matches/:matchId/games", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const matchId = parseInt(req.params.matchId);
      const { whitePlayerId, blackPlayerId } = req.body;

      const baseMatch = await storage.getMatch(matchId);
      if (!baseMatch) return res.status(404).json({ message: "Match not found" });

      // Find the highest game number for this matchup
      const allMatches = await storage.getMatchesByTournament(tournamentId);
      const matchupGames = allMatches.filter(m => 
        m.round === baseMatch.round && 
        m.board === baseMatch.board &&
        m.bracketType === baseMatch.bracketType &&
        m.sectionId === baseMatch.sectionId
      );
      const maxGameNum = Math.max(...matchupGames.map(m => m.gameNumber || 1));

      // Determine colors: alternate by default if not provided
      let finalWhiteId = whitePlayerId;
      let finalBlackId = blackPlayerId;

      if (!finalWhiteId || !finalBlackId) {
        const lastGame = matchupGames.find(m => m.gameNumber === maxGameNum) || baseMatch;
        finalWhiteId = lastGame.blackPlayerId;
        finalBlackId = lastGame.whitePlayerId;
      }

      const newGame = await storage.createMatch({
        tournamentId,
        round: baseMatch.round,
        board: baseMatch.board,
        whitePlayerId: finalWhiteId,
        blackPlayerId: finalBlackId,
        status: 'pending',
        gameNumber: maxGameNum + 1,
        bracketType: baseMatch.bracketType,
        sectionId: baseMatch.sectionId
      });

      res.status(201).json(newGame);
    } catch (error) {
      console.error("Error adding game:", error);
      res.status(500).json({ message: "Failed to add game" });
    }
  });

  app.post("/api/tournaments/:tournamentId/matches/:matchId/reset", requireAuth, requireRole('tournament_director'), requireTournamentAccess, async (req, res) => {
    try {
      const tournamentId = parseInt(req.params.tournamentId);
      const matchId = parseInt(req.params.matchId);

      const match = await storage.getMatch(matchId);
      if (!match) return res.status(404).json({ message: "Match not found" });

      const tournament = await storage.getTournament(tournamentId);

      // Reset this match
      await storage.updateMatch(matchId, { status: 'pending', result: null });

      // Remove winner from the next round
      const currentBracket = match.bracketType || 'winners';
      const nextRound = match.round + 1;
      const nextBoard = Math.ceil((match.board || 1) / 2);
      const isWhite = (match.board || 1) % 2 === 1;

      const allMatches = await storage.getMatchesByTournament(tournamentId);
      const nextMatch = allMatches.find(m => 
        m.round === nextRound && 
        m.board === nextBoard && 
        m.bracketType === currentBracket &&
        m.sectionId === match.sectionId
      );

      if (nextMatch) {
        if (isWhite) {
          await storage.updateMatch(nextMatch.id, { whitePlayerId: null });
        } else {
          await storage.updateMatch(nextMatch.id, { blackPlayerId: null });
        }
      }

      // Remove loser from LB if double elimination
      if (tournament?.isDoubleElimination && currentBracket === 'winners') {
        const lbMatch = allMatches.find(m => 
          m.round === match.round && 
          m.board === match.board && 
          m.bracketType === 'losers' &&
          m.sectionId === match.sectionId
        );
        if (lbMatch) {
          // We don't know who the loser was definitively without history, 
          // but we can clear slots that match the possible losers
          if (lbMatch.whitePlayerId === match.whitePlayerId || lbMatch.whitePlayerId === match.blackPlayerId) {
            await storage.updateMatch(lbMatch.id, { whitePlayerId: null });
          } else if (lbMatch.blackPlayerId === match.whitePlayerId || lbMatch.blackPlayerId === match.blackPlayerId) {
            await storage.updateMatch(lbMatch.id, { blackPlayerId: null });
          }
        }
      }

      res.json({ message: "Match reset and advancement cleared" });
    } catch (error) {
      console.error("Error resetting match:", error);
      res.status(500).json({ message: "Failed to reset match" });
    }
  });
}
