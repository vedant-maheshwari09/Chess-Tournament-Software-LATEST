import type { Player, Match } from "@shared/schema";

export interface PairingResult {
  whitePlayerId: number;
  blackPlayerId: number | null;
  board: number;
  isBye: boolean;
}

export class SwissPairingEngine {
  private players: Player[];
  private matches: Match[];

  constructor(players: Player[], matches: Match[]) {
    this.players = players;
    this.matches = matches;
  }

  generatePairings(round: number): PairingResult[] {
    const pairings: PairingResult[] = [];
    const playerStats = this.calculatePlayerStats();
    
    // Sort players by points (descending), then by rating (descending)
    const sortedPlayers = playerStats.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return (b.player.rating || 0) - (a.player.rating || 0);
    });

    const unpaired = [...sortedPlayers];
    let boardNumber = 1;

    while (unpaired.length > 1) {
      const player1 = unpaired.shift()!;
      
      // Find best opponent for player1
      let opponentIndex = this.findBestOpponent(player1, unpaired);
      
      if (opponentIndex === -1) {
        // No valid opponent found, pair with next available
        opponentIndex = 0;
      }

      const player2 = unpaired.splice(opponentIndex, 1)[0];
      
      // Determine colors based on color balance
      const shouldPlayer1BeWhite = this.shouldPlayerBeWhite(player1.player, round);
      
      pairings.push({
        whitePlayerId: shouldPlayer1BeWhite ? player1.player.id : player2.player.id,
        blackPlayerId: shouldPlayer1BeWhite ? player2.player.id : player1.player.id,
        board: boardNumber++,
        isBye: false,
      });
    }

    // Handle bye if odd number of players
    if (unpaired.length === 1) {
      pairings.push({
        whitePlayerId: unpaired[0].player.id,
        blackPlayerId: null,
        board: boardNumber,
        isBye: true,
      });
    }

    return pairings;
  }

  private calculatePlayerStats() {
    return this.players.map(player => {
      const playerMatches = this.matches.filter(
        match => match.whitePlayerId === player.id || match.blackPlayerId === player.id
      );

      let points = 0;
      let whiteGames = 0;
      let blackGames = 0;

      playerMatches.forEach(match => {
        if (!match.result) return;

        const isWhite = match.whitePlayerId === player.id;
        
        if (isWhite) whiteGames++;
        else blackGames++;

        if (match.result === '1-0') {
          points += isWhite ? 1 : 0;
        } else if (match.result === '0-1') {
          points += isWhite ? 0 : 1;
        } else if (match.result === '1/2-1/2') {
          points += 0.5;
        }
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

  private findBestOpponent(player: any, candidates: any[]): number {
    // Find opponent that hasn't played against this player yet
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      if (!this.havePlayed(player.player.id, candidate.player.id)) {
        return i;
      }
    }
    return -1; // No valid opponent found
  }

  private havePlayed(playerId1: number, playerId2: number): boolean {
    return this.matches.some(match => 
      (match.whitePlayerId === playerId1 && match.blackPlayerId === playerId2) ||
      (match.whitePlayerId === playerId2 && match.blackPlayerId === playerId1)
    );
  }

  private shouldPlayerBeWhite(player: Player, round: number): boolean {
    const playerMatches = this.matches.filter(
      match => match.whitePlayerId === player.id || match.blackPlayerId === player.id
    );

    const whiteGames = playerMatches.filter(match => match.whitePlayerId === player.id).length;
    const blackGames = playerMatches.filter(match => match.blackPlayerId === player.id).length;

    // Prefer color that balances the player's games
    if (whiteGames > blackGames) return false;
    if (blackGames > whiteGames) return true;
    
    // If equal, alternate based on round
    return round % 2 === 1;
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
