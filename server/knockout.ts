export interface KnockoutPairing {
  round: number;
  whitePlayerId: number | null;
  blackPlayerId: number | null;
  board: number;
  isBye: boolean;
  bracketType: 'winners' | 'losers' | 'grand_final';
}

// Generate the seeding arrays for a bracket of size N
// Standard (High-Low): 1 plays N, 2 plays N-1, but structured for proper bracket progression
export function getStandardBracketSeeds(size: number): number[] {
  if (size <= 1) return [1];
  if (size === 2) return [1, 2];

  const prev = getStandardBracketSeeds(size / 2);
  const result: number[] = [];
  
  for (const seed of prev) {
    result.push(seed);
    result.push(size + 1 - seed);
  }
  
  return result;
}

// FIDE World Cup seeding (2023 format):
// Seed 1 at the very top, Seed 2 at the very bottom.
// Seed 3 at top of lower half, Seed 4 at bottom of upper half.
// This ensures #1 and #2 are on opposite halves and can only meet in the final,
// while #3 and #4 are placed so they can only meet #1 or #2 in the semifinals.
export function getFideWorldCupSeeds(size: number): number[] {
  if (size <= 1) return [1];
  if (size === 2) return [1, 2];

  // We generate the sequence of "leading seeds" for the M = size/2 matches.
  // Standard FIDE/Symmetrical sequence for 8 matches: 1, 8, 5, 4, 3, 6, 7, 2
  // This ensures 1 is Top, 2 is Bottom, 3 is Top-of-2nd-half, 4 is Bottom-of-1st-half.
  let leadingSeeds = [1];
  let currentM = 1;
  
  while (currentM < size / 2) {
    const nextM = currentM * 2;
    const nextSeeds: number[] = [];
    for (let i = 0; i < leadingSeeds.length; i++) {
        const x = leadingSeeds[i];
        const mirror = nextM - x + 1;
        // Symmetrical expansion: 
        // 1 -> 1, 2
        // [1, 2] -> [1, 4, 3, 2]
        // [1, 4, 3, 2] -> [1, 8, 5, 4, 3, 6, 7, 2]
        if (i % 2 === 0) {
            nextSeeds.push(x);
            nextSeeds.push(mirror);
        } else {
            nextSeeds.push(mirror);
            nextSeeds.push(x);
        }
    }
    leadingSeeds = nextSeeds;
    currentM = nextM;
  }

  // Now transform leading seeds into pairs [L, size - L + 1]
  // This explicitly matches Seed 1 with Seed 16, Seed 2 with Seed 15, etc.
  const result: number[] = [];
  for (const L of leadingSeeds) {
    result.push(L);
    result.push(size - L + 1);
  }
  
  console.log(`[SEEDING-ENGINE] FIDE Sequence for ${size}: ${JSON.stringify(result)}`);
  return result;
}


// Slaughter (Top half vs Bottom half): 1 plays N/2+1, 2 plays N/2+2
export function getSlaughterBracketSeeds(size: number): number[] {
  if (size <= 1) return [1];
  if (size === 2) return [1, 2];

  const prev = getSlaughterBracketSeeds(size / 2);
  const result: number[] = [];
  const offset = size / 2;
  
  for (const seed of prev) {
    result.push(seed);
    result.push(seed + offset);
  }
  
  return result;
}

export async function generateKnockoutPairings(
  players: any[], 
  seedingMethod: "random" | "slaughter" | "manual" | "fide_world_cup" = "fide_world_cup"
): Promise<KnockoutPairing[]> {
  const pairings: KnockoutPairing[] = [];
  const numPlayers = players.length;
  
  if (numPlayers < 2) return pairings;

  const bracketSize = Math.pow(2, Math.ceil(Math.log2(numPlayers)));
  const totalRounds = Math.log2(bracketSize);
  
  console.log(`[ENGINE-V4] Generating bracket for ${numPlayers} players. Bracket size: ${bracketSize}, Total Rounds: ${totalRounds}`);
  
  let seeds: number[] = [];
  
  if (seedingMethod === "slaughter") {
    seeds = getSlaughterBracketSeeds(bracketSize);
  } else {
    // Both 'fide_world_cup', 'random', and 'manual' use the professional symmetry logic
    // For 'random' and 'manual', the players are already ordered/shuffled by the route
    console.log(`[ENGINE-V4] Using FIDE symmetrical logic for method: ${seedingMethod}`);
    seeds = getFideWorldCupSeeds(bracketSize);
  }
  console.log(`[ENGINE-V4] Final Seed Sequence: ${JSON.stringify(seeds)}`);

  // We assume players are passed in sorted by seed order (high-low rating).
  const seededPlayers = new Map<number, number>(); // seed -> playerId
  for (let i = 0; i < numPlayers; i++) {
    seededPlayers.set(i + 1, players[i].id);
    console.log(`  Seed ${i+1}: ${players[i].username} (${players[i].rating || 0}) ID: ${players[i].id}`);
  }

  // To track who advances directly to Round 2
  const advancingToRound2 = new Map<number, { white?: number, black?: number }>(); // R2 board -> details

  // Round 1
  const numMatchesR1 = bracketSize / 2;
  console.log(`[KnockoutGenerator] Processing Round 1: ${numMatchesR1} boards`);
  
  for (let i = 0; i < numMatchesR1; i++) {
    const seed1 = seeds[i * 2];
    const seed2 = seeds[i * 2 + 1];

    const player1Id = seededPlayers.get(seed1) || null;
    const player2Id = seededPlayers.get(seed2) || null;

    if (player1Id && player2Id) {
      console.log(`  Board ${i+1}: Match [Seed ${seed1} ID:${player1Id}] vs [Seed ${seed2} ID:${player2Id}]`);
      pairings.push({
        round: 1,
        board: i + 1,
        whitePlayerId: player1Id,
        blackPlayerId: player2Id,
        isBye: false,
        bracketType: 'winners'
      });
    } else if (player1Id || player2Id) {
      const advancingPlayerId = (player1Id || player2Id)!;
      console.log(`  Board ${i+1}: Bye for Seed ${player1Id ? seed1 : seed2} ID:${advancingPlayerId}`);
      pairings.push({
        round: 1,
        board: i + 1,
        whitePlayerId: advancingPlayerId,
        blackPlayerId: null,
        isBye: true,
        bracketType: 'winners'
      });

      // Still advance to Round 2 map so future rounds are populated
      const r2Board = Math.ceil((i + 1) / 2);
      const position = (i % 2 === 0) ? 'white' : 'black';
      console.log(`    Advancing player ID ${advancingPlayerId} to R2 Board ${r2Board} ${position}`);
      const existing = advancingToRound2.get(r2Board) || {};
      advancingToRound2.set(r2Board, { ...existing, [position]: advancingPlayerId });
    } else {
      console.log(`  Board ${i+1}: Empty`);
    }
  }

  // Generate future rounds
  for (let r = 2; r <= totalRounds; r++) {
    const numMatches = bracketSize / Math.pow(2, r);
    console.log(`[KnockoutGenerator] Processing Round ${r}: ${numMatches} boards`);
    for (let i = 0; i < numMatches; i++) {
      const board = i + 1;
      let whitePlayerId = null;
      let blackPlayerId = null;

      // Only in Round 2 might we already know advanced players via byes
      if (r === 2) {
        const advanced = advancingToRound2.get(board) as any;
        if (advanced) {
          whitePlayerId = advanced.white || null;
          blackPlayerId = advanced.black || null;
          console.log(`  Board ${board}: Pre-populated from byes: W:${whitePlayerId}, B:${blackPlayerId}`);
        }
      }

      pairings.push({
        round: r,
        board: board,
        whitePlayerId,
        blackPlayerId,
        isBye: false,
        bracketType: 'winners'
      });
    }
  }

  return pairings;
}

export async function generateDoubleEliminationPairings(
  players: any[], 
  seedingMethod: "random" | "slaughter" | "manual" | "fide_world_cup" = "fide_world_cup"
): Promise<KnockoutPairing[]> {
  const pairings: KnockoutPairing[] = [];
  const numPlayers = players.length;
  
  if (numPlayers < 2) return pairings;

  // Next power of 2
  const bracketSize = Math.pow(2, Math.ceil(Math.log2(numPlayers)));
  const totalWBRounds = Math.log2(bracketSize);
  
  // 1. Generate Winner's Bracket (WB)
  const wbPairings = await generateKnockoutPairings(players, seedingMethod);
  pairings.push(...wbPairings.map(p => ({ ...p, bracketType: 'winners' as const })));

  // 2. Generate Loser's Bracket (LB)
  // LB structure is dynamic based on bracket size.
  // WB R1 (S/2 matches) -> Losers go to LB R1
  // LB R1: Winners of (WB R1 Loser 1 vs WB R1 Loser 2) etc.
  
  // LB Round 1
  let matchesInRound = bracketSize / 4;
  for (let i = 0; i < matchesInRound; i++) {
    pairings.push({
      round: 1,
      board: i + 1,
      whitePlayerId: null,
      blackPlayerId: null,
      isBye: false,
      bracketType: 'losers'
    });
  }

  // Future LB Rounds
  // Pattern: For each subsequent WB round (from 2 up to WB Final)
  // We add TWO LB rounds.
  // One where LB winners face WB losers.
  // One where those LB winners face each other.
  for (let wbRound = 2; wbRound <= totalWBRounds; wbRound++) {
    const lbBaseRound = 2 * (wbRound - 1); // 2, 4, 6...
    
    // LB Phase A: Winners of previous LB round face Losers from WB round 'wbRound'
    const numMatchesPhaseA = bracketSize / Math.pow(2, wbRound);
    for (let i = 0; i < numMatchesPhaseA; i++) {
        pairings.push({
            round: lbBaseRound,
            board: i + 1,
            whitePlayerId: null,
            blackPlayerId: null,
            isBye: false,
            bracketType: 'losers'
        });
    }

    // LB Phase B: Winners of Phase A face each other
    // This phase only exists if we aren't at the very end of LB
    const numMatchesPhaseB = numMatchesPhaseA / 2;
    if (numMatchesPhaseB >= 1) {
        for (let i = 0; i < numMatchesPhaseB; i++) {
            pairings.push({
                round: lbBaseRound + 1,
                board: i + 1,
                whitePlayerId: null,
                blackPlayerId: null,
                isBye: false,
                bracketType: 'losers'
            });
        }
    }
  }

  // 3. Grand Final
  // Winners Bracket Winner vs Losers Bracket Final Winner
  pairings.push({
    round: 1,
    board: 1,
    whitePlayerId: null,
    blackPlayerId: null,
    isBye: false,
    bracketType: 'grand_final'
  });

  return pairings;
}
