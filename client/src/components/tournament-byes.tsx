import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users } from "lucide-react";
import type { Pairing, Player } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";

interface TournamentByesProps {
  tournamentId: number;
}

function formatByeType(byeType: string | null | undefined): string {
  switch (byeType) {
    case "half_point":
      return "½ point bye";
    case "zero_point":
      return "0 point bye";
    case "full_point":
      return "1 point bye";
    default:
      return "Bye";
  }
}

export default function TournamentByes({ tournamentId }: TournamentByesProps) {
  const { data: pairings, isLoading, isError } = useQuery<Pairing[]>({
    queryKey: ["/api/tournaments", tournamentId, "pairings"],
    queryFn: async () => {
      return (await apiRequest(`/api/tournaments/${tournamentId}/pairings`)) as Pairing[];
    },
  });

  const { data: players = [] } = useQuery<Player[]>({
    queryKey: ["/api/tournaments", tournamentId, "players"],
    queryFn: async () => {
      return (await apiRequest(`/api/tournaments/${tournamentId}/players`)) as Player[];
    },
  });

  const byesByRound = useMemo(() => {
    if (!pairings) return [] as Array<{ round: number; entries: Pairing[] }>;
    const grouped = new Map<number, Pairing[]>();
    for (const pairing of pairings) {
      if (!pairing.isBye) continue;
      const bucket = grouped.get(pairing.round) ?? [];
      bucket.push(pairing);
      grouped.set(pairing.round, bucket);
    }
    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([round, entries]) => ({ round, entries: entries.sort((a, b) => (a.playerId ?? 0) - (b.playerId ?? 0)) }));
  }, [pairings]);

  const playerLookup = useMemo(() => {
    const map = new Map<number, Player>();
    players.forEach((player) => {
      map.set(player.id, player);
    });
    return map;
  }, [players]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-3 py-12 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
          Loading byes…
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-red-600">
          Unable to load bye information right now. Please refresh and try again.
        </CardContent>
      </Card>
    );
  }

  if (!byesByRound.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-5 w-5 text-indigo-500" />
            Bye Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-sm text-slate-600">
          No byes have been recorded for this tournament yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-5 w-5 text-indigo-500" />
          Bye Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {byesByRound.map(({ round, entries }) => (
          <div key={round} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Round {round}</h3>
              <Badge variant="outline" className="border-indigo-200 text-xs text-indigo-700">
                {entries.length} bye{entries.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
              {entries.map((entry) => {
                const player = entry.playerId ? playerLookup.get(entry.playerId) : null;
                const playerName = player ? `${player.firstName} ${player.lastName}`.trim() : "Unassigned";
                const byeType = (entry as { byeType?: string | null }).byeType ?? null;
                return (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-3 py-2 text-sm shadow-sm"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-900">{playerName}</span>
                      {player?.rating ? (
                        <span className="text-xs text-slate-500">Rating {player.rating}</span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="bg-indigo-100 text-indigo-700">
                        {formatByeType(byeType)}
                      </Badge>
                      {entry.isRequested ? (
                        <Badge variant="outline" className="border-blue-200 text-blue-600">
                          Requested
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
