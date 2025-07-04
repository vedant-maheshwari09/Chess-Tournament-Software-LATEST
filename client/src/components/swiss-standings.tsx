import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Player, Match, Tournament } from "@shared/schema";

interface SwissStandingsProps {
  tournamentId: number;
}

interface PlayerRoundResult {
  opponent: Player | null;
  opponentPosition: number;
  result: 'W' | 'L' | 'D' | 'bye' | 'withdrawn' | 'forfeit-win' | 'forfeit-loss' | 'unplayed';
  color: 'white' | 'black' | null;
  points: number;
}

interface SwissPlayerStanding {
  player: Player;
  position: number;
  totalPoints: number;
  roundResults: PlayerRoundResult[];
  isWithdrawn: boolean;
}

export default function SwissStandings({ tournamentId }: SwissStandingsProps) {
  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: players, isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const { data: matches, isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });

  const { data: pairings, isLoading: pairingsLoading } = useQuery({
    queryKey: [`/api/tournaments/${tournamentId}/pairings`],
  });

  if (tournamentLoading || playersLoading || matchesLoading || pairingsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Swiss Tournament Standings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded-lg"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!tournament || !players || !matches || !pairings) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Swiss Tournament Standings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-500">No tournament data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const calculateSwissStandings = (): SwissPlayerStanding[] => {
    // Calculate current round from existing matches
    const currentRound = matches.length > 0 ? Math.max(...matches.map(m => m.round)) : 0;
    // Use the actual highest round number instead of planned rounds to show extended tournaments
    const totalRounds = Math.max(currentRound, tournament.rounds || 5);

    // First pass: Calculate basic points and rankings
    const basicStandings = players.map(player => {
      const playerMatches = matches.filter(
        match => match.whitePlayerId === player.id || match.blackPlayerId === player.id
      );

      // Get bye pairings for this player
      const playerByes = Array.isArray(pairings) ? pairings.filter((pairing: any) => 
        pairing.playerId === player.id && 
        pairing.isBye && 
        pairing.points !== null &&
        pairing.round <= currentRound
      ) : [];

      let totalPoints = 0;

      // Add points from matches
      playerMatches.forEach(match => {
        if (!match.result) return;
        const isWhite = match.whitePlayerId === player.id;
        
        if (match.result === '1-0') {
          totalPoints += isWhite ? 1 : 0;
        } else if (match.result === '0-1') {
          totalPoints += isWhite ? 0 : 1;
        } else if (match.result === '1/2-1/2') {
          totalPoints += 0.5;
        } else if (match.result === '1F-0F') {
          totalPoints += isWhite ? 1 : 0;
        } else if (match.result === '0F-1F') {
          totalPoints += isWhite ? 0 : 1;
        }
      });

      // Add points from byes
      playerByes.forEach((bye: any) => {
        const byePoints = bye.points === 1 ? 0.5 : bye.points === 2 ? 1 : 0;
        totalPoints += byePoints;
      });

      return {
        player,
        totalPoints,
        isWithdrawn: false // Simplified for now
      };
    });

    // Sort by points (descending), then by rating (descending) to determine positions
    basicStandings.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      return (b.player.rating || 0) - (a.player.rating || 0);
    });

    // Assign positions
    const standingsWithPositions = basicStandings.map((standing, index) => ({
      ...standing,
      position: index + 1
    }));

    // Second pass: Calculate detailed round results
    const detailedStandings: SwissPlayerStanding[] = standingsWithPositions.map(standing => {
      const roundResults: PlayerRoundResult[] = [];
      
      for (let round = 1; round <= totalRounds; round++) {
        if (round > currentRound) {
          // Future rounds - show empty
          roundResults.push({
            opponent: null,
            opponentPosition: 0,
            result: 'withdrawn',
            color: null,
            points: 0
          });
          continue;
        }

        // Check for bye first
        const byeThisRound = Array.isArray(pairings) ? pairings.find((pairing: any) => 
          pairing.playerId === standing.player.id && 
          pairing.isBye && 
          pairing.round === round
        ) : null;

        if (byeThisRound) {
          const byePoints = byeThisRound.points === 1 ? 0.5 : byeThisRound.points === 2 ? 1 : 0;
          roundResults.push({
            opponent: null,
            opponentPosition: 0,
            result: 'bye',
            color: null,
            points: byePoints
          });
          continue;
        }

        // Check for withdrawal - simplified without withdrawnRound field
        if (standing.isWithdrawn) {
          roundResults.push({
            opponent: null,
            opponentPosition: 0,
            result: 'withdrawn',
            color: null,
            points: 0
          });
          continue;
        }

        // Find match for this round
        const matchThisRound = matches.find(match => 
          match.round === round && 
          (match.whitePlayerId === standing.player.id || match.blackPlayerId === standing.player.id)
        );

        // Check if player has any pairing (match or bye) for this round
        const pairingThisRound = Array.isArray(pairings) ? pairings.find((pairing: any) => 
          pairing.playerId === standing.player.id && 
          pairing.round === round
        ) : null;

        if (!matchThisRound && !pairingThisRound) {
          // No match or pairing found - player joined late (unplayed round)
          // Calculate points the player had at the beginning of this round
          const pointsBeforeRound = roundResults.reduce((sum, result) => sum + result.points, 0);
          
          roundResults.push({
            opponent: null,
            opponentPosition: 0,
            result: 'unplayed',
            color: null,
            points: pointsBeforeRound // Store the points they had at this round
          });
          continue;
        }

        if (!matchThisRound) {
          // No match found but has pairing - might be withdrawn or other issue
          roundResults.push({
            opponent: null,
            opponentPosition: 0,
            result: 'withdrawn',
            color: null,
            points: 0
          });
          continue;
        }

        const isWhite = matchThisRound.whitePlayerId === standing.player.id;
        const opponentId = isWhite ? matchThisRound.blackPlayerId : matchThisRound.whitePlayerId;
        const opponent = players.find(p => p.id === opponentId) || null;
        const opponentStanding = standingsWithPositions.find(s => s.player.id === opponentId);
        const opponentPosition = opponentStanding?.position || 0;

        let result: PlayerRoundResult['result'] = 'withdrawn';
        let points = 0;

        if (matchThisRound.result) {
          if (matchThisRound.result === '1-0') {
            result = isWhite ? 'W' : 'L';
            points = isWhite ? 1 : 0;
          } else if (matchThisRound.result === '0-1') {
            result = isWhite ? 'L' : 'W';
            points = isWhite ? 0 : 1;
          } else if (matchThisRound.result === '1/2-1/2') {
            result = 'D';
            points = 0.5;
          } else if (matchThisRound.result === '1F-0F') {
            result = isWhite ? 'forfeit-win' : 'forfeit-loss';
            points = isWhite ? 1 : 0;
          } else if (matchThisRound.result === '0F-1F') {
            result = isWhite ? 'forfeit-loss' : 'forfeit-win';
            points = isWhite ? 0 : 1;
          } else if (matchThisRound.result === '1-bye') {
            result = 'bye';
            points = 1; // 1-point bye
          }
        }

        roundResults.push({
          opponent,
          opponentPosition,
          result,
          color: isWhite ? 'white' : 'black',
          points
        });
      }

      return {
        player: standing.player,
        position: standing.position,
        totalPoints: standing.totalPoints,
        roundResults,
        isWithdrawn: standing.isWithdrawn
      };
    });

    return detailedStandings;
  };

  const standings = calculateSwissStandings();
  const currentRound = matches.length > 0 ? Math.max(...matches.map(m => m.round)) : 0;
  const totalRounds = Math.max(currentRound, tournament.rounds || 5);

  const formatRoundResult = (result: PlayerRoundResult, round: number): string => {
    if (result.result === 'bye') {
      return 'bye';
    }
    
    if (result.result === 'unplayed') {
      return `U${result.points}`;
    }
    
    if (result.result === 'withdrawn') {
      return round <= currentRound ? '---' : '';
    }

    if (!result.opponent) {
      return '---';
    }

    const colorPrefix = result.color === 'white' ? 'W' : 'B';
    const opponentPos = result.opponentPosition;

    if (result.result === 'forfeit-win') {
      return `X${opponentPos}`;
    }
    
    if (result.result === 'forfeit-loss') {
      return `F${opponentPos}`;
    }

    return `${colorPrefix}${result.result === 'W' ? '' : result.result === 'L' ? '' : result.result === 'D' ? '' : ''}${opponentPos}`;
  };

  const formatRoundResultDisplay = (result: PlayerRoundResult): string => {
    if (result.result === 'bye') {
      return 'bye';
    }
    
    if (result.result === 'unplayed') {
      return `U${result.points}`;
    }
    
    if (result.result === 'withdrawn') {
      return '---';
    }

    if (!result.opponent) {
      return '---';
    }

    const colorPrefix = result.color === 'white' ? 'W' : 'B';
    
    // Show "TD" instead of position number if opponent is the houseplayer
    const opponentDisplayText = result.opponent?.isActiveTd ? 'TD' : result.opponentPosition;

    if (result.result === 'forfeit-win') {
      return `X${opponentDisplayText}`;
    }
    
    if (result.result === 'forfeit-loss') {
      return `F${opponentDisplayText}`;
    }

    return `${colorPrefix}${result.result}${opponentDisplayText}`;
  };

  const formatPoints = (standing: SwissPlayerStanding): string => {
    if (standing.isWithdrawn) {
      return `U${standing.totalPoints}`;
    }
    return standing.totalPoints.toString();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Swiss Tournament Standings</CardTitle>
        <p className="text-sm text-gray-600 mt-1">
          Detailed round-by-round results and current rankings
        </p>
      </CardHeader>
      <CardContent>
        {standings.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No standings available yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    #
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name/Rating/ID
                  </th>
                  {Array.from({ length: totalRounds }, (_, i) => (
                    <th key={i} className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Rd {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {standings.map((standing) => (
                  <tr key={standing.player.id} className="hover:bg-gray-50">
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {standing.position}
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {standing.player.firstName} {standing.player.lastName}
                        {standing.player.isActiveTd && (
                          <span className="text-xs text-gray-500 font-normal"> (substitute player)</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {standing.player.rating} {standing.player.federation}
                      </div>
                    </td>
                    {standing.roundResults.map((result, roundIndex) => {
                      // Calculate cumulative points up to this round
                      const cumulativePoints = standing.roundResults
                        .slice(0, roundIndex + 1)
                        .reduce((sum, r) => sum + r.points, 0);
                      
                      return (
                        <td key={roundIndex} className="px-2 py-3 whitespace-nowrap text-center">
                          <div className="text-xs text-gray-900">
                            {formatRoundResultDisplay(result)}
                          </div>
                          <div className="text-xs font-medium text-gray-700">
                            {roundIndex < currentRound ? cumulativePoints : ''}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}