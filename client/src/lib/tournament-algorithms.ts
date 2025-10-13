import type { Player, Match } from "@shared/schema";
import { getPointsForResult, normalizeMatchResult } from "@shared/match-results";

export interface PairingResult {
  whitePlayerId: number;
  blackPlayerId: number | null;
  board: number;
  isBye: boolean;
  byeType?: 'half_point' | 'full_point';
}

export interface ByeEligibility {
  playerId: number;
  canReceiveFullPointBye: boolean;
  canReceiveHalfPointBye: boolean;
  halfPointByesUsed: number;
  fullPointByesReceived: number;
  hasForfeitWin: boolean;
  reason?: string;
}

export class SwissPairingEngine {
  private players: Player[];
  private matches: Match[];
  private maxRounds: number;

  constructor(players: Player[], matches: Match[], maxRounds?: number) {
    this.players = players;
    this.matches = matches;
    this.maxRounds = maxRounds || Math.ceil(Math.log2(players.length)) + 2;
  }

  // USCF Bye Rules Implementation
  private checkByeEligibility(playerId: number, round: number): ByeEligibility {
    const player = this.players.find(p => p.id === playerId)!;
    const playerMatches = this.matches.filter(m => 
      m.whitePlayerId === playerId || m.blackPlayerId === playerId
    );

    const halfPointByesUsed = player.halfPointByesUsed || 0;
    const fullPointByesReceived = player.fullPointByesReceived || 0;
    const forfeitWinsReceived = player.forfeitWinsReceived || 0;

    // Rule: No player gets bye more than once (full-point)
    const canReceiveFullPointBye = fullPointByesReceived === 0 && forfeitWinsReceived === 0;

    // Rule: Half-point bye limits (1 for events up to 5 rounds, 2 for longer)
    const maxHalfPointByes = this.maxRounds <= 5 ? 1 : 2;
    const canReceiveHalfPointBye = halfPointByesUsed < maxHalfPointByes;

    return {
      playerId,
      canReceiveFullPointBye,
      canReceiveHalfPointBye,
      halfPointByesUsed,
      fullPointByesReceived,
      hasForfeitWin: forfeitWinsReceived > 0,
      reason: !canReceiveFullPointBye ? 
        (fullPointByesReceived > 0 ? 'Already received full-point bye' : 'Has forfeit win') :
        undefined
    };
  }

  private assignFullPointBye(unpaired: any[], round: number): PairingResult | null {
    // Rule: Only ONE full-point bye per section per round
    // Rule: Give to rated player, never unrated
    // Rule: Prefer player who hasn't had bye before
    
    const eligiblePlayers = unpaired.filter(player => {
      const eligibility = this.checkByeEligibility(player.id, round);
      return eligibility.canReceiveFullPointBye && player.rating > 0; // Rated players only
    });

    if (eligiblePlayers.length === 0) return null;

    // Choose the lowest-rated eligible player (traditional USCF practice)
    const selectedPlayer = eligiblePlayers.reduce((lowest, current) => 
      current.rating < lowest.rating ? current : lowest
    );

    // Remove from unpaired
    const index = unpaired.findIndex(p => p.id === selectedPlayer.id);
    if (index >= 0) unpaired.splice(index, 1);

    return {
      whitePlayerId: selectedPlayer.id,
      blackPlayerId: null,
      board: 0, // Bye doesn't get a board
      isBye: true,
      byeType: 'full_point'
    };
  }

  generatePairings(round: number): PairingResult[] {
    const pairings: PairingResult[] = [];
    const playerStats = this.calculatePlayerStats();
    
    if (round === 1) {
      return this.generateFirstRoundPairings(playerStats);
    }

    // Group players by score
    const scoreGroups = this.groupPlayersByScore(playerStats);
    const unpaired: any[] = [];
    let boardNumber = 1;

    // Process each score group from highest to lowest
    for (const scoreGroup of scoreGroups) {
      // Add any unpaired players from higher score groups
      const playersToProcess = [...unpaired, ...scoreGroup];
      unpaired.length = 0; // Clear unpaired array

      // Try to pair within score group first
      while (playersToProcess.length > 1) {
        const player1 = playersToProcess.shift()!;
        
        // Find best opponent following Swiss rules precedence
        const opponentIndex = this.findBestSwissOpponent(player1, playersToProcess, round);
        
        if (opponentIndex >= 0) {
          const player2 = playersToProcess.splice(opponentIndex, 1)[0];
          
          // Determine colors following Swiss color rules
          const colors = this.determineSwissColors(player1, player2, round);
          
          pairings.push({
            whitePlayerId: colors.whitePlayer.id,
            blackPlayerId: colors.blackPlayer.id,
            board: boardNumber++,
            isBye: false,
          });
        } else {
          // Can't pair in this score group, move to unpaired for next group
          unpaired.push(player1);
        }
      }

      // Add remaining player to unpaired if any
      if (playersToProcess.length === 1) {
        unpaired.push(playersToProcess[0]);
      }
    }

    // Handle final unpaired players and byes
    while (unpaired.length > 1) {
      const player1 = unpaired.shift()!;
      const player2 = unpaired.shift()!;
      
      const colors = this.determineSwissColors(player1, player2, round);
      
      pairings.push({
        whitePlayerId: colors.whitePlayer.id,
        blackPlayerId: colors.blackPlayer.id,
        board: boardNumber++,
        isBye: false,
      });
    }

    // Handle remaining unpaired players with proper USCF bye rules
    if (unpaired.length > 0) {
      // Try to assign full-point bye according to USCF rules
      const byePairing = this.assignFullPointBye(unpaired, round);
      if (byePairing) {
        pairings.push(byePairing);
      }

      // If there are still unpaired players, this indicates a pairing problem
      if (unpaired.length > 0) {
        console.warn(`Round ${round}: ${unpaired.length} players could not be paired properly. Consider cross-section pairing or house players.`);
        
        // As fallback, give remaining players full-point byes (non-USCF compliant)
        unpaired.forEach(player => {
          pairings.push({
            whitePlayerId: player.player ? player.player.id : player.id,
            blackPlayerId: null,
            board: 0,
            isBye: true,
            byeType: 'full_point'
          });
        });
      }
    }

    // Sort pairings by board order - highest point totals on top boards
    return this.sortPairingsByPointTotal(pairings, playerStats);
  }

  private sortPairingsByPointTotal(pairings: PairingResult[], playerStats: any[]): PairingResult[] {
    // Create a map for quick player stats lookup
    const statsMap = new Map();
    playerStats.forEach(stat => {
      statsMap.set(stat.player.id, stat.points);
    });

    // Sort pairings by total points of both players (highest first)
    const sortedPairings = pairings.filter(p => !p.isBye).sort((a, b) => {
      const aTotal = (statsMap.get(a.whitePlayerId) || 0) + (statsMap.get(a.blackPlayerId) || 0);
      const bTotal = (statsMap.get(b.whitePlayerId) || 0) + (statsMap.get(b.blackPlayerId) || 0);
      return bTotal - aTotal; // Descending order
    });

    // Add bye pairings at the end
    const byePairings = pairings.filter(p => p.isBye);

    // Reassign board numbers
    const result = [...sortedPairings, ...byePairings];
    result.forEach((pairing, index) => {
      pairing.board = pairing.isBye ? 0 : index + 1;
    });

    return result;
  }

  private generateFirstRoundPairings(playerStats: any[]): PairingResult[] {
    // Sort by rating for first round (highest to lowest)
    const sortedPlayers = playerStats.sort((a, b) => 
      (b.player.rating || 0) - (a.player.rating || 0)
    );

    const pairings: PairingResult[] = [];
    const n = sortedPlayers.length;
    const isOdd = n % 2 === 1;
    
    // Split into upper and lower halves
    const mid = Math.ceil(n / 2);
    const upperHalf = sortedPlayers.slice(0, mid);
    const lowerHalf = sortedPlayers.slice(mid);

    // USCF Rule: High-rated players should alternate colors in early rounds
    // Random color assignment for first board (coin flip)
    const firstBoardWhiteIsUpper = Math.random() < 0.5;
    let boardNumber = 1;

    // Pair corresponding players from upper and lower halves
    const pairsCount = Math.min(upperHalf.length, lowerHalf.length);
    
    for (let i = 0; i < pairsCount; i++) {
      const upperPlayer = upperHalf[i];
      const lowerPlayer = lowerHalf[i];
      
      // Strict color alternation for high-rated players
      // Board 1: Random (coin flip), then alternate strictly
      const upperPlayerIsWhite = i === 0 ? firstBoardWhiteIsUpper : (i % 2 === 0) === firstBoardWhiteIsUpper;
      
      pairings.push({
        whitePlayerId: upperPlayerIsWhite ? upperPlayer.player.id : lowerPlayer.player.id,
        blackPlayerId: upperPlayerIsWhite ? lowerPlayer.player.id : upperPlayer.player.id,
        board: boardNumber++,
        isBye: false,
      });
    }

    // Handle bye if odd number (lowest rated gets bye, unless unrated)
    if (isOdd) {
      const byePlayer = sortedPlayers[sortedPlayers.length - 1];
      // If lowest player is unrated, give bye to second lowest instead
      const actualByePlayer = (byePlayer.player.rating === null || byePlayer.player.rating === undefined) && 
                             sortedPlayers.length > 1 ? 
                             sortedPlayers[sortedPlayers.length - 2] : byePlayer;
      
      pairings.push({
        whitePlayerId: actualByePlayer.player.id,
        blackPlayerId: null,
        board: boardNumber,
        isBye: true,
        byeType: 'half_point' // USCF Rule: Odd player gets half-point bye
      });
    }

    return pairings;
  }

  private groupPlayersByScore(playerStats: any[]): any[][] {
    // Sort by score (descending), then by rating (descending) for ranking
    const sorted = playerStats.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return (b.player.rating || 0) - (a.player.rating || 0);
    });

    const groups: any[][] = [];
    let currentGroup: any[] = [];
    let lastScore = -1;

    for (const player of sorted) {
      if (player.points !== lastScore) {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
        }
        currentGroup = [player];
        lastScore = player.points;
      } else {
        currentGroup.push(player);
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  private calculatePlayerStats() {
    return this.players.map(player => {
      const playerMatches = this.matches.filter(
        match => match.whitePlayerId === player.id || match.blackPlayerId === player.id
      );

      let points = 0;
      let whiteGames = 0;
      let blackGames = 0;

      playerMatches.forEach((match) => {
        const normalized = normalizeMatchResult(match.result);
        if (!normalized) {
          return;
        }

        const isWhite = match.whitePlayerId === player.id;

        if (isWhite) whiteGames++;
        else blackGames++;

        points += getPointsForResult(match.result, isWhite ? "white" : "black");
      });

      return {
        player,
        points,
        whiteGames,
        blackGames,
        colorBalance: whiteGames - blackGames,
      };
    });
  }

  private findBestSwissOpponent(player: any, candidates: any[], round: number): number {
    // Swiss pairing rules in order of precedence:
    // 1) Avoid repeat pairings
    // 2) Equal scores (within score group)
    // 3) Upper-half vs lower-half
    // 4) Color equalization
    // 5) Color alternation

    // First pass: Look for opponents not played before
    const unplayedOpponents: { index: number; candidate: any }[] = [];
    
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (!this.havePlayed(player.player.id, candidate.player.id)) {
        unplayedOpponents.push({ index: i, candidate });
      }
    }

    if (unplayedOpponents.length === 0) {
      // Rule 1 violated - no unplayed opponents available
      // Return first available (will be handled as repeat pairing)
      return candidates.length > 0 ? 0 : -1;
    }

    if (unplayedOpponents.length === 1) {
      return unplayedOpponents[0].index;
    }

    // Multiple unplayed opponents - apply further criteria
    // Rule 4 & 5: Consider color needs
    const playerColorBalance = player.colorBalance;
    const playerNeedsWhite = playerColorBalance < 0; // More black games
    const playerNeedsBlack = playerColorBalance > 0; // More white games

    // Find opponents that would create good color pairing
    const goodColorPairings = unplayedOpponents.filter(({ candidate }) => {
      const candidateColorBalance = candidate.colorBalance;
      const candidateNeedsWhite = candidateColorBalance < 0;
      const candidateNeedsBlack = candidateColorBalance > 0;

      // Ideal: one needs white, other needs black
      return (playerNeedsWhite && candidateNeedsBlack) || 
             (playerNeedsBlack && candidateNeedsWhite);
    });

    if (goodColorPairings.length > 0) {
      // Return first opponent with good color match
      return goodColorPairings[0].index;
    }

    // If no perfect color match, return first unplayed opponent
    return unplayedOpponents[0].index;
  }

  private determineSwissColors(player1: any, player2: any, round: number): { whitePlayer: Player; blackPlayer: Player } {
    // Swiss color assignment rules:
    // 1) Color equalization (balance white/black games)
    // 2) Color alternation (avoid same color in consecutive rounds)
    // 3) Higher-ranked player gets color preference when tied

    const p1Balance = player1.colorBalance; // whiteGames - blackGames
    const p2Balance = player2.colorBalance;

    // Strong color preference (2+ game difference)
    if (p1Balance <= -2) return { whitePlayer: player1.player, blackPlayer: player2.player };
    if (p1Balance >= 2) return { whitePlayer: player2.player, blackPlayer: player1.player };
    if (p2Balance <= -2) return { whitePlayer: player2.player, blackPlayer: player1.player };
    if (p2Balance >= 2) return { whitePlayer: player1.player, blackPlayer: player2.player };

    // Moderate color preference (1 game difference)
    if (p1Balance === -1 && p2Balance >= 0) return { whitePlayer: player1.player, blackPlayer: player2.player };
    if (p1Balance === 1 && p2Balance <= 0) return { whitePlayer: player2.player, blackPlayer: player1.player };
    if (p2Balance === -1 && p1Balance >= 0) return { whitePlayer: player2.player, blackPlayer: player1.player };
    if (p2Balance === 1 && p1Balance <= 0) return { whitePlayer: player1.player, blackPlayer: player2.player };

    // Equal color balance - use rank (higher rated player gets preference)
    const p1Rating = player1.player.rating || 0;
    const p2Rating = player2.player.rating || 0;
    
    if (p1Rating > p2Rating) {
      // Player 1 is higher rated, gets color preference
      // Give them the color they need for alternation
      const p1LastColor = this.getLastColor(player1.player.id);
      if (p1LastColor === 'white') {
        return { whitePlayer: player2.player, blackPlayer: player1.player };
      } else {
        return { whitePlayer: player1.player, blackPlayer: player2.player };
      }
    } else {
      // Player 2 is higher rated or equal, gets color preference
      const p2LastColor = this.getLastColor(player2.player.id);
      if (p2LastColor === 'white') {
        return { whitePlayer: player1.player, blackPlayer: player2.player };
      } else {
        return { whitePlayer: player2.player, blackPlayer: player1.player };
      }
    }
  }

  private getLastColor(playerId: number): 'white' | 'black' | 'none' {
    // Find the most recent match for this player
    const playerMatches = this.matches
      .filter(match => match.whitePlayerId === playerId || match.blackPlayerId === playerId)
      .sort((a, b) => a.round - b.round);
    
    if (playerMatches.length === 0) return 'none';
    
    const lastMatch = playerMatches[playerMatches.length - 1];
    return lastMatch.whitePlayerId === playerId ? 'white' : 'black';
  }

  private havePlayed(playerId1: number, playerId2: number): boolean {
    return this.matches.some(match => 
      (match.whitePlayerId === playerId1 && match.blackPlayerId === playerId2) ||
      (match.whitePlayerId === playerId2 && match.blackPlayerId === playerId1)
    );
  }


}

export class RoundRobinEngine {
  static generateSchedule(players: Player[], isDouble: boolean = false): PairingResult[][] {
    const n = players.length;
    if (n < 2) return [];

    const rounds: PairingResult[][] = [];
    const isOdd = n % 2 === 1;
    const totalPlayers = isOdd ? n + 1 : n;
    const totalRounds = totalPlayers - 1;

    // Create player list with dummy player if odd number
    const playerList = [...players];
    if (isOdd) {
      playerList.push({ id: -1 } as Player); // Dummy player for bye
    }

    for (let round = 0; round < totalRounds; round++) {
      const pairings: PairingResult[] = [];
      let boardNumber = 1;

      for (let i = 0; i < totalPlayers / 2; i++) {
        const player1Index = i;
        const player2Index = totalPlayers - 1 - i;
        
        const player1 = playerList[player1Index];
        const player2 = playerList[player2Index];

        // Skip if either player is the dummy (bye)
        if (player1.id === -1 || player2.id === -1) continue;

        // Alternate colors
        const isPlayer1White = (round + i) % 2 === 0;
        
        pairings.push({
          whitePlayerId: isPlayer1White ? player1.id : player2.id,
          blackPlayerId: isPlayer1White ? player2.id : player1.id,
          board: boardNumber++,
          isBye: false,
        });
      }

      rounds.push(pairings);

      // Rotate players (except first player who stays fixed)
      if (totalPlayers > 2) {
        const temp = playerList[1];
        for (let i = 1; i < totalPlayers - 1; i++) {
          playerList[i] = playerList[i + 1];
        }
        playerList[totalPlayers - 1] = temp;
      }
    }

    // If double round robin, duplicate with colors swapped
    if (isDouble) {
      const secondHalf = rounds.map(round => 
        round.map(pairing => ({
          ...pairing,
          whitePlayerId: pairing.blackPlayerId!,
          blackPlayerId: pairing.whitePlayerId,
        }))
      );
      rounds.push(...secondHalf);
    }

    return rounds;
  }
}

export class KnockoutEngine {
  static generateBracket(players: Player[]): { rounds: PairingResult[][]; totalRounds: number } {
    const n = players.length;
    if (n === 0) return { rounds: [], totalRounds: 0 };

    // Calculate next power of 2
    const nextPowerOf2 = Math.pow(2, Math.ceil(Math.log2(n)));
    const totalRounds = Math.ceil(Math.log2(nextPowerOf2));
    
    // Sort players by rating (descending) for seeding
    const seededPlayers = [...players].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    const rounds: PairingResult[][] = [];

    // First round with byes
    const firstRound: PairingResult[] = [];
    let boardNumber = 1;

    for (let i = 0; i < nextPowerOf2 / 2; i++) {
      const player1 = seededPlayers[i];
      const player2 = seededPlayers[nextPowerOf2 - 1 - i];

      if (player1 && player2) {
        firstRound.push({
          whitePlayerId: player1.id,
          blackPlayerId: player2.id,
          board: boardNumber++,
          isBye: false,
        });
      } else if (player1) {
        // Bye for player1
        firstRound.push({
          whitePlayerId: player1.id,
          blackPlayerId: null,
          board: boardNumber++,
          isBye: true,
        });
      }
    }

    rounds.push(firstRound);

    return { rounds, totalRounds };
  }
}
