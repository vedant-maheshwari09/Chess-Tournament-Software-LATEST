import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Medal, Award, Crown } from "lucide-react";
import type { Player, Match, Tournament } from "@shared/schema";

interface RoundRobinCrosstableProps {
  tournamentId: number;
}

interface PlayerStanding {
  player: Player;
  points: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  results: { [opponentId: number]: string }; // opponent ID -> result (1, 0.5, 0, or empty)
}

export default function RoundRobinCrosstable({ tournamentId }: RoundRobinCrosstableProps) {
  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: players, isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const { data: matches, isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });

  if (tournamentLoading || playersLoading || matchesLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Round Robin Crosstable</CardTitle>
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

  if (!players || players.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Round Robin Crosstable</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-500 text-center py-8">No players registered yet</p>
        </CardContent>
      </Card>
    );
  }

  // Calculate standings and head-to-head results
  const standings: PlayerStanding[] = players.map(player => {
    const playerMatches = matches?.filter(m => 
      m.whitePlayerId === player.id || m.blackPlayerId === player.id
    ) || [];

    let points = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    const results: { [opponentId: number]: string } = {};

    playerMatches.forEach(match => {
      if (match.result && match.result !== 'Pending') {
        const isWhite = match.whitePlayerId === player.id;
        const opponentId = isWhite ? match.blackPlayerId! : match.whitePlayerId!;
        
        if (match.result === '1-0') {
          if (isWhite) {
            points += 1;
            wins++;
            results[opponentId] = '1';
          } else {
            losses++;
            results[opponentId] = '0';
          }
        } else if (match.result === '0-1') {
          if (isWhite) {
            losses++;
            results[opponentId] = '0';
          } else {
            points += 1;
            wins++;
            results[opponentId] = '1';
          }
        } else if (match.result === '1/2-1/2') {
          points += 0.5;
          draws++;
          results[opponentId] = '½';
        }
      }
    });

    return {
      player,
      points,
      gamesPlayed: wins + draws + losses,
      wins,
      draws,
      losses,
      results
    };
  });

  // Sort by points (descending), then by rating (descending) as tiebreaker
  const sortedStandings = standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    return (b.player.rating || 0) - (a.player.rating || 0);
  });

  const getRankIcon = (position: number) => {
    switch (position) {
      case 1:
        return <Trophy className="h-5 w-5 text-yellow-500" />;
      case 2:
        return <Medal className="h-5 w-5 text-gray-400" />;
      case 3:
        return <Award className="h-5 w-5 text-amber-600" />;
      default:
        return <span className="w-5 text-center font-medium text-gray-600">{position}</span>;
    }
  };

  const getCellContent = (playerStanding: PlayerStanding, opponentIndex: number) => {
    const opponent = sortedStandings[opponentIndex];
    
    // Same player - show crown (king) symbol
    if (playerStanding.player.id === opponent.player.id) {
      return <Crown className="h-4 w-4 text-amber-500" />;
    }

    const result = playerStanding.results[opponent.player.id];
    if (!result) {
      return <span className="text-gray-400">-</span>;
    }

    // Style based on result
    const getResultStyle = (result: string) => {
      switch (result) {
        case '1':
          return 'bg-green-100 text-green-800 font-semibold';
        case '0':
          return 'bg-red-100 text-red-800 font-semibold';
        case '½':
          return 'bg-yellow-100 text-yellow-800 font-semibold';
        default:
          return 'text-gray-500';
      }
    };

    return (
      <span className={`px-1 py-0.5 rounded text-sm ${getResultStyle(result)}`}>
        {result}
      </span>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          Round Robin Crosstable
        </CardTitle>
        <p className="text-sm text-gray-600">
          Head-to-head results matrix • 1 = Win, ½ = Draw, 0 = Loss
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border border-gray-300 p-2 bg-gray-50 text-left min-w-[40px]">#</th>
                <th className="border border-gray-300 p-2 bg-gray-50 text-left min-w-[200px]">Player</th>
                <th className="border border-gray-300 p-2 bg-gray-50 text-center min-w-[80px]">Rating</th>
                {sortedStandings.map((_, index) => (
                  <th key={index} className="border border-gray-300 p-2 bg-gray-50 text-center min-w-[40px]">
                    {index + 1}
                  </th>
                ))}
                <th className="border border-gray-300 p-2 bg-gray-50 text-center min-w-[80px]">Points</th>
              </tr>
            </thead>
            <tbody>
              {sortedStandings.map((standing, index) => (
                <tr key={standing.player.id} className={index < 3 ? 'bg-blue-50' : ''}>
                  <td className="border border-gray-300 p-2 text-center">
                    <div className="flex items-center justify-center">
                      {getRankIcon(index + 1)}
                    </div>
                  </td>
                  <td className="border border-gray-300 p-2">
                    <div className="flex items-center gap-2">
                      <div>
                        <div className="font-medium text-gray-900">
                          {standing.player.firstName} {standing.player.lastName}
                        </div>
                        {standing.player.federation && (
                          <Badge variant="outline" className="text-xs">
                            {standing.player.federation}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="border border-gray-300 p-2 text-center font-mono">
                    {standing.player.rating || 'Unrated'}
                  </td>
                  {sortedStandings.map((_, opponentIndex) => (
                    <td key={opponentIndex} className="border border-gray-300 p-2 text-center">
                      {getCellContent(standing, opponentIndex)}
                    </td>
                  ))}
                  <td className="border border-gray-300 p-2 text-center">
                    <div className="font-bold text-lg">
                      {standing.points}
                    </div>
                    <div className="text-xs text-gray-500">
                      {standing.gamesPlayed} games
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend */}
        <div className="mt-4 flex items-center gap-6 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-amber-500" />
            <span>Own position</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-green-100 text-green-800 px-1 py-0.5 rounded font-semibold">1</span>
            <span>Win</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-yellow-100 text-yellow-800 px-1 py-0.5 rounded font-semibold">½</span>
            <span>Draw</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-red-100 text-red-800 px-1 py-0.5 rounded font-semibold">0</span>
            <span>Loss</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}