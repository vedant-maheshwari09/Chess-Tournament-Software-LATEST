import type { Tournament } from "@shared/schema";
import {
  type TournamentConfig,
  parseTournamentConfig,
  serializeTournamentConfig,
} from "@shared/tournament-config";
import type { IStorage } from "../storage";

interface SyncContext {
  storage: IStorage;
  tournament: Tournament;
  config: TournamentConfig;
  reason?: "manual" | "auto";
}

interface SyncOutcome {
  success: boolean;
  status: number;
  message?: string;
  config: TournamentConfig;
}

const schedulerHandles = new Map<number, NodeJS.Timeout>();

function ensureIntervalMinutes(value?: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value <= 0) return undefined;
  return Math.max(5, Math.round(value));
}

function buildAuthHeader(personalNumber: string, password: string): string {
  const encoded = Buffer.from(`${personalNumber}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

async function fetchTournamentPayload(storage: IStorage, tournamentId: number) {
  const [players, matches, pairings] = await Promise.all([
    storage.getPlayersByTournament(tournamentId),
    storage.getMatchesByTournament(tournamentId),
    storage.getPairingsByTournament(tournamentId),
  ]);

  return {
    players,
    matches,
    pairings,
  };
}

async function postToChessResults(endpoint: string, authHeader: string, payload: unknown) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body: text,
  };
}

function applySyncResult(config: TournamentConfig, outcome: { success: boolean; message?: string }): TournamentConfig {
  const next = { ...config, chessResults: { ...config.chessResults } };
  next.chessResults.lastSyncAt = new Date().toISOString();
  next.chessResults.lastSyncStatus = outcome.success ? "success" : "error";
  next.chessResults.lastSyncMessage = outcome.message ?? null;
  return next;
}

export async function syncChessResults({ storage, tournament, config, reason = "manual" }: SyncContext): Promise<SyncOutcome> {
  const credentials = config.chessResults;

  if (credentials.syncMode === "disabled") {
    return {
      success: false,
      status: 400,
      message: "Chess-Results sync is disabled.",
      config,
    };
  }

  if (!credentials.endpoint || !credentials.personalNumber || !credentials.password || !credentials.tournamentId) {
    return {
      success: false,
      status: 400,
      message: "Endpoint, personal number, password, and tournament number are required.",
      config,
    };
  }

  const payload = await fetchTournamentPayload(storage, tournament.id);

  const requestBody = {
    tournamentId: credentials.tournamentId,
    exportMode: credentials.exportMode,
    reason,
    organizer: {
      name: credentials.organizerName,
      email: credentials.organizerEmail,
      eventCode: credentials.eventCode,
    },
    metadata: {
      app: "ChessTournamentManager",
      timestamp: new Date().toISOString(),
    },
    data: payload,
  };

  try {
    const response = await postToChessResults(credentials.endpoint, buildAuthHeader(credentials.personalNumber, credentials.password), requestBody);

    const success = response.ok;
    const nextConfig = applySyncResult(config, {
      success,
      message: success ? "Sync completed successfully." : response.body || "Remote endpoint rejected the payload.",
    });

    await storage.updateTournament(tournament.id, {
      roundTimings: serializeTournamentConfig(nextConfig),
    });

    return {
      success,
      status: response.status,
      message: success ? undefined : response.body,
      config: nextConfig,
    };
  } catch (error: any) {
    const message = error?.message ?? "Unexpected error while contacting Chess-Results.";
    const nextConfig = applySyncResult(config, { success: false, message });
    await storage.updateTournament(tournament.id, {
      roundTimings: serializeTournamentConfig(nextConfig),
    });
    return {
      success: false,
      status: 500,
      message,
      config: nextConfig,
    };
  }
}

export async function testChessResultsConnection({ storage, tournament, config }: SyncContext): Promise<{ success: boolean; status: number; message?: string }> {
  const credentials = config.chessResults;

  if (!credentials.endpoint || !credentials.personalNumber || !credentials.password) {
    return {
      success: false,
      status: 400,
      message: "Endpoint, personal number, and password are required.",
    };
  }

  const body = {
    action: "ping",
    tournamentId: credentials.tournamentId ?? null,
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await postToChessResults(credentials.endpoint, buildAuthHeader(credentials.personalNumber, credentials.password), body);
    if (!response.ok) {
      return {
        success: false,
        status: response.status,
        message: response.body || "Chess-Results returned an error.",
      };
    }
    return { success: true, status: response.status };
  } catch (error: any) {
    return {
      success: false,
      status: 500,
      message: error?.message ?? "Unable to reach Chess-Results endpoint.",
    };
  }
}

export function stopChessResultsScheduler(tournamentId: number) {
  const handle = schedulerHandles.get(tournamentId);
  if (handle) {
    clearInterval(handle);
    schedulerHandles.delete(tournamentId);
  }
}

export function updateChessResultsScheduler(storage: IStorage, tournamentId: number, config: TournamentConfig) {
  stopChessResultsScheduler(tournamentId);

  if (config.chessResults.syncMode !== "automatic") {
    return;
  }

  const interval = ensureIntervalMinutes(config.chessResults.autoSyncIntervalMinutes);
  if (!interval) {
    return;
  }

  const intervalMs = interval * 60 * 1000;

  const handle = setInterval(async () => {
    try {
      const current = await storage.getTournament(tournamentId);
      if (!current) {
        stopChessResultsScheduler(tournamentId);
        return;
      }
      const parsed = parseTournamentConfig(current);
      if (parsed.chessResults.syncMode !== "automatic") {
        stopChessResultsScheduler(tournamentId);
        return;
      }
      await syncChessResults({ storage, tournament: current, config: parsed, reason: "auto" });
    } catch (error) {
      console.error("Automatic Chess-Results sync failed", error);
    }
  }, intervalMs);

  schedulerHandles.set(tournamentId, handle);
}

export async function initializeChessResultsSchedulers(storage: IStorage) {
  try {
    const tournaments = await storage.getAllTournaments();
    for (const tournament of tournaments) {
      if (!tournament.roundTimings) continue;
      try {
        const parsed = parseTournamentConfig(tournament);
        updateChessResultsScheduler(storage, tournament.id, parsed);
      } catch (error) {
        console.error(`Failed to initialize Chess-Results schedule for tournament ${tournament.id}`, error);
      }
    }
  } catch (error) {
    // Database might not be available or configured yet - this is non-fatal
    // The schedulers will be initialized when tournaments are accessed
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('fetch failed') || 
        errorMessage.includes('Failed to list from') ||
        errorMessage.includes('connection') ||
        errorMessage.includes('ECONNREFUSED')) {
      console.warn('Database connection not available - Chess-Results schedulers will initialize when database is ready');
    } else {
      // Re-throw unexpected errors
      throw error;
    }
  }
}
