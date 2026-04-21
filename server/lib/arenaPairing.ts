import { storage } from '../storage';
import { Match, Player, Tournament } from '@shared/schema';

// --- Configuration Constants ---
const PAIRING_LOOP_INTERVAL = 3000; // Batch tick every 3 seconds

// Smoothed Cost Matrix 
const SCORE_GAP_COST = 2000;
const RATING_GAP_COST = 1;

// History Penalties (Soft Constraints)
const HISTORY_2_GAMES_COST = 15000;
const HISTORY_3_GAMES_COST = 5000;

// Wait Time Expansion 
const BASE_TOLERANCE = 5000;
const TOLERANCE_PER_SEC = 200;
const MAX_TOLERANCE = 30000;

// Global singleton to track active loops and pairing state
declare global {
  var arenaRunningLoops: Set<number>;
  var arenaEntryTimes: Map<number, Map<number, number>>;
}

if (!global.arenaRunningLoops) {
  global.arenaRunningLoops = new Set<number>();
}
if (!global.arenaEntryTimes) {
  global.arenaEntryTimes = new Map<number, Map<number, number>>();
}

const log = (msg: string) => {
  // Always log for debugging so you can see the locks working
  console.log(`[ArenaPairing] ${msg}`);
};

export async function bootstrapArenaPairing() {
  log("Bootstrapping active arena loops...");
  try {
    const tournaments = await storage.getAllTournaments();
    const activeArenas = tournaments.filter(t =>
      t.format === 'arena' &&
      t.status === 'active' &&
      t.arenaPairingMode === 'automatic'
    );

    for (const t of activeArenas) {
      if (!global.arenaRunningLoops.has(t.id)) {
        startAutoPairingLoop(t.id);
      }
    }
  } catch (err) {
    console.error("[ArenaPairing] Bootstrap error:", err);
  }
}

export function startAutoPairingLoop(tournamentId: number) {
  if (global.arenaRunningLoops.has(tournamentId)) return;

  global.arenaRunningLoops.add(tournamentId);
  if (!global.arenaEntryTimes.has(tournamentId)) {
    global.arenaEntryTimes.set(tournamentId, new Map<number, number>());
  }

  const tick = async () => {
    if (!global.arenaRunningLoops.has(tournamentId)) return;

    try {
      const tournament = await storage.getTournament(tournamentId);
      if (!tournament || tournament.status !== 'active') {
        global.arenaRunningLoops.delete(tournamentId);
        return;
      }
      await pairPool(tournamentId, tournament);
    } catch (err) {
      console.error(`[ArenaPairing] T${tournamentId} Loop Error:`, err);
    }

    if (global.arenaRunningLoops.has(tournamentId)) {
      setTimeout(tick, PAIRING_LOOP_INTERVAL);
    }
  };

  tick();
}

export function stopAutoPairingLoop(tournamentId: number) {
  global.arenaRunningLoops.delete(tournamentId);
}

const pairingInProgress = new Set<number>();

export async function pairPool(tournamentId: number, tournamentOverride?: Tournament) {
  if (pairingInProgress.has(tournamentId)) return;
  pairingInProgress.add(tournamentId);

  try {
    const tournament = tournamentOverride || await storage.getTournament(tournamentId);
    if (!tournament || tournament.status !== 'active' || tournament.arenaPairingMode !== 'automatic') {
      return;
    }

    if (!global.arenaEntryTimes.has(tournamentId)) {
      global.arenaEntryTimes.set(tournamentId, new Map<number, number>());
    }
    const entryTimeMap = global.arenaEntryTimes.get(tournamentId)!;

    if (tournament.arenaStartTime && tournament.arenaDuration) {
      const startStr = String(tournament.arenaStartTime);
      const isoStart = startStr.endsWith('Z') ? startStr : `${startStr}Z`;
      const start = new Date(isoStart);
      const end = new Date(start.getTime() + tournament.arenaDuration * 60000);
      const cutoffTime = new Date(end.getTime() - (tournament.arenaCutoffMinutes || 2) * 60000);
      if (Date.now() > cutoffTime.getTime()) return;
    }

    const allMatches = await storage.getMatchesByTournament(tournamentId);
    const allPlayers = await storage.getPlayersByTournament(tournamentId);

    const alreadyPlaying = new Set<number>();
    let maxBoard = 0;

    for (const m of allMatches) {
      if (m.status === 'playing' || m.status === 'pending') {
        if (m.whitePlayerId) alreadyPlaying.add(m.whitePlayerId);
        if (m.blackPlayerId) alreadyPlaying.add(m.blackPlayerId);
      }
      if (m.board && m.board > maxBoard) maxBoard = m.board;
    }

    const lobbyPlayers = allPlayers.filter(p =>
      p.arenaStatus === 'lobby' && !alreadyPlaying.has(p.id) && p.status === 'active'
    );

    if (lobbyPlayers.length > 0 || alreadyPlaying.size > 0) {
      log(`T${tournamentId} Tick: lobby=${lobbyPlayers.length}, playing=${alreadyPlaying.size}, total=${allPlayers.length}`);
    }

    const now = Date.now();
    for (const p of lobbyPlayers) {
      if (!entryTimeMap.has(p.id)) {
        entryTimeMap.set(p.id, now);
      }
    }
    for (const pid of Array.from(entryTimeMap.keys())) {
      if (!lobbyPlayers.find(p => p.id === pid)) {
        entryTimeMap.delete(pid);
      }
    }

    if (lobbyPlayers.length < 2) {
      if (lobbyPlayers.length === 1) {
        log(`T${tournamentId}: Only 1 player in lobby (${lobbyPlayers[0].firstName}). Waiting for more...`);
      }
      return;
    }

    const playersWithWait = lobbyPlayers.map(p => ({
      ...p,
      waitTimeSec: Math.floor((now - (entryTimeMap.get(p.id) || now)) / 1000),
      pointsNum: parseFloat(p.arenaPoints || "0")
    })).sort((a, b) => b.waitTimeSec - a.waitTimeSec);

    const sortedMatches = [...allMatches].sort((a, b) => b.id - a.id);
    const matchHistory = new Map<number, number[]>();

    for (const p of lobbyPlayers) {
      const hist: number[] = [];
      for (const m of sortedMatches) {
        if (m.whitePlayerId === p.id && m.blackPlayerId !== null) hist.push(m.blackPlayerId);
        else if (m.blackPlayerId === p.id && m.whitePlayerId !== null) hist.push(m.whitePlayerId);
        if (hist.length >= 4) break;
      }
      matchHistory.set(p.id, hist);
    }

    const pairedThisTick = new Set<number>();

    for (let i = 0; i < playersWithWait.length; i++) {
      const playerA = playersWithWait[i];
      if (pairedThisTick.has(playerA.id)) continue;

      let bestOpponent: any = null;
      let bestCost = Infinity;

      const maxAcceptableCost = Math.min(
        MAX_TOLERANCE,
        BASE_TOLERANCE + (playerA.waitTimeSec * TOLERANCE_PER_SEC)
      );

      for (let j = 0; j < playersWithWait.length; j++) {
        if (i === j) continue;
        const playerB = playersWithWait[j];
        if (pairedThisTick.has(playerB.id)) continue;

        // --- BULLETPROOF IMMEDIATE REMATCH LOCK ---
        // Checks BOTH the database explicit lastOpponentId AND the array history
        const isImmediateRematch =
          (playerA.lastOpponentId === playerB.id) ||
          (playerB.lastOpponentId === playerA.id) ||
          ((matchHistory.get(playerA.id) || [])[0] === playerB.id);

        if (isImmediateRematch) {
          if (allPlayers.length > 2) {
            // STRICT RULE: If there are >2 players in the tournament, NEVER pair them back to back.
            log(`T${tournamentId}: BLOCKED ${playerA.firstName} vs ${playerB.firstName} (Back-to-back forbidden)`);
            continue;
          } else {
            // Only 2 players exist in the entire tournament.
            if (playerA.waitTimeSec < 30) {
              log(`T${tournamentId}: COOLDOWN ${playerA.firstName} vs ${playerB.firstName} (${playerA.waitTimeSec}/30s)`);
              continue;
            }
          }
        }

        // --- FIDE COLOR LOCK ---
        const aNeedsWhite = playerA.consecutiveColor === 'BB';
        const aNeedsBlack = playerA.consecutiveColor === 'WW';
        const bNeedsWhite = playerB.consecutiveColor === 'BB';
        const bNeedsBlack = playerB.consecutiveColor === 'WW';

        if ((aNeedsWhite && bNeedsWhite) || (aNeedsBlack && bNeedsBlack)) {
          if (allPlayers.length > 2) {
            continue;
          }
        }

        // --- SOFT COST CALCULATION ---
        let cost = 0;

        const scoreDiff = Math.abs(playerA.pointsNum - playerB.pointsNum);
        const ratingDiff = Math.abs((playerA.rating || 1200) - (playerB.rating || 1200));
        cost += (scoreDiff * SCORE_GAP_COST) + (ratingDiff * RATING_GAP_COST);

        let historyPenalty = 0;
        const aHist = matchHistory.get(playerA.id) || [];
        if (aHist[1] === playerB.id) historyPenalty += HISTORY_2_GAMES_COST;
        else if (aHist[2] === playerB.id) historyPenalty += HISTORY_3_GAMES_COST;

        if (allPlayers.length <= 4) {
          historyPenalty /= 10;
        }
        cost += historyPenalty;
        cost += calculateColorCost(playerA, playerB);

        if (cost < bestCost) {
          bestCost = cost;
          bestOpponent = playerB;
        }
      }

      if (bestOpponent && bestCost <= maxAcceptableCost) {
        const colors = determineColors(playerA, bestOpponent);
        if (!colors) continue;

        const [whiteId, blackId] = colors;
        maxBoard++;

        await storage.createMatch({
          tournamentId,
          round: 1,
          board: maxBoard,
          whitePlayerId: whiteId,
          blackPlayerId: blackId,
          status: 'playing',
        });

        for (const p of [playerA, bestOpponent]) {
          const isWhite = (p.id === whiteId);
          const char = isWhite ? 'W' : 'B';
          const newDelta = p.colorDelta + (isWhite ? 1 : -1);
          const currentHistory = p.consecutiveColor || "";
          const newConsecutive = (currentHistory.endsWith(char) ? currentHistory + char : char).slice(-2);

          await storage.updatePlayer(p.id, {
            arenaStatus: 'playing',
            // This is the absolute truth tracker that drives the lock above
            lastOpponentId: p.id === playerA.id ? bestOpponent.id : playerA.id,
            colorDelta: newDelta,
            consecutiveColor: newConsecutive
          });
        }

        pairedThisTick.add(playerA.id);
        pairedThisTick.add(bestOpponent.id);

        log(`T${tournamentId}: PAIRED -> ${playerA.firstName} vs ${bestOpponent.firstName} | Cost: ${Math.round(bestCost)}`);
      }
    }
  } catch (error) {
    console.error(`[ArenaPairing] Error in T${tournamentId}:`, error);
  } finally {
    pairingInProgress.delete(tournamentId);
  }
}

function calculateColorCost(a: any, b: any): number {
  if (Math.sign(a.colorDelta) === Math.sign(b.colorDelta) && a.colorDelta !== 0) {
    return 1000;
  }
  if (Math.sign(a.colorDelta) !== 0 && Math.sign(a.colorDelta) !== Math.sign(b.colorDelta)) {
    return -500;
  }
  return 0;
}

function determineColors(a: any, b: any): [number, number] | null {
  if (a.consecutiveColor === 'BB' || b.consecutiveColor === 'WW') return [a.id, b.id];
  if (a.consecutiveColor === 'WW' || b.consecutiveColor === 'BB') return [b.id, a.id];
  if (a.colorDelta < b.colorDelta) return [a.id, b.id];
  if (b.colorDelta < a.colorDelta) return [b.id, a.id];
  return Math.random() > 0.5 ? [a.id, b.id] : [b.id, a.id];
}