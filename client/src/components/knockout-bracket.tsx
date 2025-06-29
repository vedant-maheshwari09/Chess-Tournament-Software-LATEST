import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, ArrowRight } from "lucide-react";
import type { Player, Match } from "@shared/schema";

interface KnockoutBracketProps {
  tournamentId: number;
}

export default function KnockoutBracket({ tournamentId }: KnockoutBracketProps) {
  const { data: players, isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: ["/api/tournaments", tournamentId, "players"],
  });

  const { data: matches, isLoading: matchesLoading } = useQuery<Match[]>({
    queryKey: ["/api/tournaments", tournamentId, "matches"],
  });

  if (playersLoading || matchesLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Knockout Bracket</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">
            <div className="h-64 bg-gray-200 rounded-lg"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getPlayerName = (playerId: number | null) => {
    if (!playerId || !players) return "TBD";
    const player = players.find(p => p.id === playerId);
    return player ? `${player.firstName} ${player.lastName}` : "Unknown";
  };

  // Calculate bracket structure based on number of players
  const playerCount = players?.length || 0;
  const bracketRounds = Math.ceil(Math.log2(playerCount));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Knockout Bracket</CardTitle>
        <p className="text-sm text-gray-600 mt-1">
          {playerCount} players - {bracketRounds > 0 ? `Round of ${Math.pow(2, bracketRounds)}` : "No players"}
        </p>
      </CardHeader>
      <CardContent>
        {!players || players.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No players registered yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-max">
              <div className="flex justify-center space-x-8 mb-12">
                {/* Round of 8 */}
                <div className="space-y-4">
                  <h4 className="text-center text-sm font-medium text-gray-700 mb-4">Round of 8</h4>
                  {Array.from({ length: Math.min(4, Math.ceil(playerCount / 2)) }).map((_, index) => (
                    <div key={index} className="bg-gray-50 rounded-lg p-4 w-64">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">
                          {getPlayerName(players[index * 2]?.id)}
                        </span>
                        <span className="text-sm bg-green-100 text-green-800 px-2 py-1 rounded">1</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm">
                          {getPlayerName(players[index * 2 + 1]?.id)}
                        </span>
                        <span className="text-sm bg-red-100 text-red-800 px-2 py-1 rounded">0</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Connecting Lines */}
                <div className="flex items-center">
                  <div className="text-gray-300">
                    <ArrowRight className="h-6 w-6" />
                  </div>
                </div>

                {/* Semifinals */}
                <div className="space-y-4">
                  <h4 className="text-center text-sm font-medium text-gray-700 mb-4">Semifinals</h4>
                  <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 w-64">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">Winner 1</span>
                      <span className="text-sm bg-gray-100 text-gray-600 px-2 py-1 rounded">-</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm">Winner 2</span>
                      <span className="text-sm bg-gray-100 text-gray-600 px-2 py-1 rounded">-</span>
                    </div>
                    <div className="mt-2 text-center">
                      <span className="text-xs text-blue-600 font-medium">Upcoming</span>
                    </div>
                  </div>
                </div>

                {/* Connecting Lines */}
                <div className="flex items-center">
                  <div className="text-gray-300">
                    <ArrowRight className="h-6 w-6" />
                  </div>
                </div>

                {/* Finals */}
                <div className="space-y-4">
                  <h4 className="text-center text-sm font-medium text-gray-700 mb-4">Final</h4>
                  <div className="bg-yellow-50 border-2 border-yellow-200 rounded-lg p-4 w-64">
                    <div className="flex items-center justify-center mb-4">
                      <Trophy className="h-6 w-6 text-yellow-600" />
                    </div>
                    <div className="text-center text-sm text-gray-600">
                      Winner of Semifinal
                    </div>
                    <div className="mt-2 text-center">
                      <span className="text-xs text-yellow-600 font-medium">TBD</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
