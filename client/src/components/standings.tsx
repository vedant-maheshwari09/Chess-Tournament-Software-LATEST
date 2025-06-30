import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Medal, Award } from "lucide-react";
import type { Player, Match } from "@shared/schema";

interface StandingsProps {
  tournamentId: number;
}

interface PlayerStanding {
  player: Player;
  points: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  position: number;
}

export default function Standings({ tournamentId }: StandingsProps) {
  const { data: players, isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const { data: matches, isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: [`/api/tournaments/${tournamentId}/matches`],
  });

  const { data: pairings, isLoading: pairingsLoading } = useQuery({
    queryKey: [`/api/tournaments/${tournamentId}/pairings`],
  });

  if (playersLoading || matchesLoading || pairingsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tournament Standings</CardTitle>
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

  const calculateStandings = (): PlayerStanding[] => {
    if (!players || !matches || !pairings) return [];

    const standings: PlayerStanding[] = players.map(player => {
      const playerMatches = matches.filter(
        match => match.whitePlayerId === player.id || match.blackPlayerId === player.id
      );

      // Get bye pairings for this player
      const playerByes = Array.isArray(pairings) ? pairings.filter((pairing: any) => 
        pairing.playerId === player.id && pairing.isBye && pairing.points !== null
      ) : [];

      let points = 0;
      let wins = 0;
      let draws = 0;
      let losses = 0;

      // Add points from matches
      playerMatches.forEach(match => {
        if (!match.result) return;

        const isWhite = match.whitePlayerId === player.id;
        
        if (match.result === '1-0') {
          if (isWhite) {
            wins++;
            points += 1;
          } else {
            losses++;
          }
        } else if (match.result === '0-1') {
          if (isWhite) {
            losses++;
          } else {
            wins++;
            points += 1;
          }
        } else if (match.result === '1/2-1/2') {
          draws++;
          points += 0.5;
        }
      });

      // Add points from byes
      playerByes.forEach((bye: any) => {
        points += bye.points;
        if (bye.points === 1) {
          wins++; // Full point bye counts as win
        }
        // Half-point byes don't count as wins/draws/losses for record purposes
      });

      return {
        player,
        points,
        gamesPlayed: playerMatches.filter(m => m.result).length + playerByes.length,
        wins,
        draws,
        losses,
        position: 0, // Will be set after sorting
      };
    });

    // Sort by points (descending), then by rating (descending)
    standings.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return (b.player.rating || 0) - (a.player.rating || 0);
    });

    // Assign positions
    standings.forEach((standing, index) => {
      standing.position = index + 1;
    });

    return standings;
  };

  const standings = calculateStandings();

  const getPositionIcon = (position: number) => {
    switch (position) {
      case 1:
        return <Trophy className="h-5 w-5 text-yellow-500" />;
      case 2:
        return <Medal className="h-5 w-5 text-gray-400" />;
      case 3:
        return <Award className="h-5 w-5 text-amber-600" />;
      default:
        return <span className="text-gray-500 font-medium">{position}</span>;
    }
  };

  const getPositionBadge = (position: number) => {
    if (position <= 3) {
      return <Badge variant="default" className="bg-yellow-100 text-yellow-800">Top 3</Badge>;
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tournament Standings</CardTitle>
        <p className="text-sm text-gray-600 mt-1">Current rankings based on points and performance</p>
      </CardHeader>
      <CardContent>
        {standings.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No standings available yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Rank
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Player
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Points
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Games
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    W-D-L
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Rating
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {standings.map((standing) => (
                  <tr key={standing.player.id} className={standing.position <= 3 ? 'bg-yellow-50' : ''}>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        {getPositionIcon(standing.position)}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {standing.player.firstName} {standing.player.lastName}
                      </div>
                      <div className="text-xs text-gray-500">
                        Seed: {standing.player.seed}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="text-sm font-bold text-gray-900">{standing.points}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="text-sm text-gray-900">{standing.gamesPlayed}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="text-sm text-gray-900">
                        {standing.wins}-{standing.draws}-{standing.losses}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      <div className="text-sm text-gray-900">{standing.player.rating}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-center">
                      {getPositionBadge(standing.position)}
                    </td>
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
