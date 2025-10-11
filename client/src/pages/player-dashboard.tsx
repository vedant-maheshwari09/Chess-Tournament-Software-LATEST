import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Trophy, Users, Eye, ArrowLeft, Medal, Info, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SettingsMenu from "@/components/settings-menu";
import { useAuth } from "@/hooks/useAuth";
import type { Tournament, Player, PlayerRegistration as PlayerRegistrationType } from "@shared/schema";
import Standings from "@/components/standings";
import SwissStandings from "@/components/swiss-standings";
import SwissPairings from "@/components/swiss-pairings";
import RoundRobinCrosstable from "@/components/round-robin-crosstable";
import KnockoutBracket from "@/components/knockout-bracket";
import PairingPredictor from "@/components/pairing-predictor";
import PlayerRegistration from "@/components/player-registration";
import { parseTournamentConfig } from "@/lib/tournament-config";
import { apiRequest } from "@/lib/queryClient";

type SortKey = "players" | "date" | "state";

interface TournamentRow {
  tournament: Tournament;
  playersCount: number;
  sectionsCount: number | null;
  startDate: Date | null;
  endDate: Date | null;
  state: string;
}

interface SectionData {
  key: string;
  label: string;
  description: string;
  items: TournamentRow[];
  empty: string;
}

export default function PlayerDashboard() {
  const { user } = useAuth();
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [activeTab, setActiveTab] = useState<string>("ongoing");
  const [, setLocation] = useLocation();

  const { data: tournaments = [], isLoading } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  const { data: myRegistrations = [] } = useQuery<PlayerRegistrationType[]>({
    queryKey: ["/api/my-registrations"],
  });

  const registrationMap = useMemo(() => {
    const map = new Map<number, PlayerRegistrationType>();
    myRegistrations.forEach((registration) => {
      map.set(registration.tournamentId, registration);
    });
    return map;
  }, [myRegistrations]);

  const [sortKey, setSortKey] = useState<SortKey>("date");

  const { data: statsData = [], isLoading: statsLoading } = useQuery<TournamentRow[]>({
    queryKey: ["tournament-stats", tournaments.map((tournament) => tournament.id)],
    enabled: tournaments.length > 0,
    queryFn: async () => {
      return Promise.all(
        tournaments.map(async (tournament) => {
          let players: Player[] = [];
          try {
            players = (await apiRequest(`/api/tournaments/${tournament.id}/players`)) as Player[];
          } catch (error) {
            console.error("Failed to fetch players for tournament", tournament.id, error);
          }

          const config = parseTournamentConfig(tournament);
          const sectionsCandidate = (config as any)?.sections ?? (config as any)?.sectionDefinitions;
          const sectionsCount = Array.isArray(sectionsCandidate) ? sectionsCandidate.length : null;
          const state =
            (config.uscf?.state?.trim() || tournament.location?.split(",").pop()?.trim() || "") || "N/A";

          return {
            tournament,
            playersCount: players.length,
            sectionsCount,
            startDate: config.basic.startDate ? new Date(config.basic.startDate) : null,
            endDate: config.basic.endDate ? new Date(config.basic.endDate) : null,
            state,
          } as TournamentRow;
        })
      );
    },
  });

  const statsRows = useMemo<TournamentRow[]>(() => {
    if (statsData.length === tournaments.length && statsData.length > 0) {
      return statsData;
    }

    return tournaments.map((tournament) => {
      const config = parseTournamentConfig(tournament);
      const state =
        (config.uscf?.state?.trim() || tournament.location?.split(",").pop()?.trim() || "") || "N/A";

      return {
        tournament,
        playersCount: typeof (tournament as any).playerCount === "number" ? (tournament as any).playerCount : 0,
        sectionsCount: null,
        startDate: config.basic.startDate ? new Date(config.basic.startDate) : null,
        endDate: config.basic.endDate ? new Date(config.basic.endDate) : null,
        state,
      } as TournamentRow;
    });
  }, [statsData, tournaments]);

  const sectionsRaw = useMemo(() => ({
    past: statsRows.filter((entry) => entry.tournament.status === "completed"),
    upcoming: statsRows.filter((entry) => entry.tournament.status === "upcoming"),
    ongoing: statsRows.filter((entry) => entry.tournament.status === "active"),
  }), [statsRows]);

  const comparator = useMemo(() => {
    return (a: TournamentRow, b: TournamentRow) => {
      switch (sortKey) {
        case "players":
          return b.playersCount - a.playersCount;
        case "state":
          return (a.state || "").localeCompare(b.state || "");
        case "date":
        default: {
          const aTime = a.startDate ? a.startDate.getTime() : Number.POSITIVE_INFINITY;
          const bTime = b.startDate ? b.startDate.getTime() : Number.POSITIVE_INFINITY;
          return aTime - bTime;
        }
      }
    };
  }, [sortKey]);

  const sectionsData = useMemo<SectionData[]>(
    () => [
      {
        key: "past",
        label: "Past Tournaments",
        description: "Completed events you can revisit.",
        items: [...sectionsRaw.past].sort(comparator),
        empty: "You haven't viewed any completed tournaments yet.",
      },
      {
        key: "upcoming",
        label: "Upcoming Tournaments",
        description: "Events that are scheduled to start soon.",
        items: [...sectionsRaw.upcoming].sort(comparator),
        empty: "No upcoming tournaments are available right now.",
      },
      {
        key: "ongoing",
        label: "Ongoing Tournaments",
        description: "Live events happening right now.",
        items: [...sectionsRaw.ongoing].sort(comparator),
        empty: "No tournaments are currently live.",
      },
    ],
    [sectionsRaw, comparator]
  );

  const getFormatIcon = (format: string) => {
    switch (format) {
      case 'swiss': return '🏆';
      case 'roundrobin': return '🔄';
      case 'knockout': return '⚔️';
      default: return '🎯';
    }
  };

  const getFormatName = (format: string) => {
    switch (format) {
      case 'swiss': return 'Swiss System';
      case 'roundrobin': return 'Round Robin';
      case 'knockout': return 'Knockout';
      default: return format;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'upcoming': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
      case 'completed': return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  const formatDateRange = (start: Date | null, end: Date | null) => {
    const format = (date: Date | null) =>
      date ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date) : "TBD";

    if (!start && !end) return "TBD";
    if (!start) return `TBD - ${format(end)}`;
    if (!end) return `${format(start)} - TBD`;
    return `${format(start)} - ${format(end)}`;
  };

  const renderTournamentRow = (entry: TournamentRow) => {
    const { tournament, playersCount, sectionsCount, startDate, endDate, state } = entry;
    const registration = registrationMap.get(tournament.id);

    let registerLabel = "Register Now";
    let registerDisabled = tournament.status !== "upcoming";

    if (registration) {
      if (registration.status === "approved") {
        registerLabel = "Registered";
        registerDisabled = true;
      } else if (registration.status === "pending") {
        registerLabel = "Pending Approval";
        registerDisabled = true;
      } else if (registration.status === "declined") {
        registerLabel = "Registration Declined";
        registerDisabled = true;
      }
    } else if (tournament.status !== "upcoming") {
      registerLabel = "Registration Closed";
    }

    return (
      <tr key={tournament.id} className="border-b border-slate-200 bg-white transition hover:bg-slate-50 last:border-b-0">
        <td className="px-4 py-4 align-middle">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-100">
              <span>{getFormatIcon(tournament.format)}</span>
              <span>{tournament.name}</span>
            </div>
            <div className="text-xs text-slate-500">{getFormatName(tournament.format)}</div>
          </div>
        </td>
        <td className="px-4 py-4 text-center align-middle text-sm text-slate-700 dark:text-slate-300">{state || "N/A"}</td>
        <td className="px-4 py-4 text-center align-middle text-sm text-slate-700 dark:text-slate-300">
          {playersCount} player{playersCount === 1 ? "" : "s"}
        </td>
        <td className="px-4 py-4 text-center align-middle text-sm text-slate-700 dark:text-slate-300">{formatDateRange(startDate, endDate)}</td>
        <td className="px-4 py-4 text-center align-middle text-sm text-slate-700 dark:text-slate-300">{sectionsCount ?? "—"}</td>
        <td className="px-4 py-4 align-middle text-right">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedTournament(tournament)}
            className="inline-flex items-center gap-2"
          >
            <Eye className="h-4 w-4" />
            View
          </Button>
        </td>
        <td className="px-4 py-4 align-middle text-right">
          <Button
            size="sm"
            disabled={registerDisabled}
            onClick={() => setLocation(`/tournaments/${tournament.id}/register/form`)}
          >
            {registerLabel}
          </Button>
        </td>
      </tr>
    );
  };

  const renderSection = (section: SectionData) => {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{section.label}</CardTitle>
          <CardDescription>{section.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {section.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
              <Trophy className="h-12 w-12 text-gray-400" />
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Nothing here yet</h3>
                <p className="text-gray-600 dark:text-gray-300">{section.empty}</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[960px] w-full border-collapse overflow-hidden rounded-xl">
                <thead className="bg-slate-50">
                  <tr className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-3 text-left">Tournament Name</th>
                    <th className="px-4 py-3 text-center">State</th>
                    <th className="px-4 py-3 text-center">Players</th>
                    <th className="px-4 py-3 text-center">Start Date – End Date</th>
                    <th className="px-4 py-3 text-center">Sections</th>
                    <th className="px-4 py-3 text-right">View</th>
                    <th className="px-4 py-3 text-right">Register</th>
                  </tr>
                </thead>
                <tbody>{section.items.map((entry) => renderTournamentRow(entry))}</tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (isLoading || statsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading tournaments...</p>
        </div>
      </div>
    );
  }

  // If no tournament selected, show tournament list
  if (!selectedTournament) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="bg-white dark:bg-gray-800 shadow">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between py-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tournament Dashboard</h1>
                <p className="text-gray-600 dark:text-gray-300">
                  Welcome, {user?.username}. Explore tournaments to follow or join.
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                  <Users className="h-4 w-4" />
                  Player Account
                </div>
                <SettingsMenu />
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 pb-10">
          {tournaments.length > 0 ? (
            <div className="mb-6 flex flex-wrap items-center justify-end gap-3">
              <span className="text-sm text-slate-500">Sort by:</span>
              <Select value={sortKey} onValueChange={(value) => setSortKey(value as SortKey)}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Sort tournaments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date">Start Date</SelectItem>
                  <SelectItem value="players">Players</SelectItem>
                  <SelectItem value="state">State</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="flex w-full flex-wrap flex-row-reverse gap-3 bg-transparent">
              {sectionsData.map((section) => (
                <TabsTrigger
                  key={section.key}
                  value={section.key}
                  className="flex min-w-[200px] flex-1 flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-medium text-slate-600 shadow-sm transition whitespace-normal break-words data-[state=active]:border-indigo-200 data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900"
                >
                  <span className="leading-tight">{section.label}</span>
                  <span className="text-xs text-slate-500 leading-tight">
                    {section.items.length} tournament{section.items.length === 1 ? "" : "s"}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>

            {sectionsData.map((section) => (
              <TabsContent key={section.key} value={section.key} className="mt-8 space-y-6">
                {renderSection(section)}
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    );
  }

  // Tournament Details View
  const tournamentConfig = parseTournamentConfig(selectedTournament);
  const schedule = tournamentConfig.schedule ?? [];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header with Back Button */}
      <div className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => setSelectedTournament(null)}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Tournaments
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {getFormatIcon(selectedTournament.format)} {selectedTournament.name}
                </h1>
                <p className="text-gray-600 dark:text-gray-300">
                  {getFormatName(selectedTournament.format)} • {selectedTournament.rounds} rounds
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Badge className={getStatusColor(selectedTournament.status)}>
                {selectedTournament.status}
              </Badge>
              <Button
                variant="outline"
                onClick={() => setLocation(`/tournaments/${selectedTournament.id}/register/form`)}
              >
                Register
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Tournament Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="info" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="info" className="flex items-center gap-2">
              <Info className="h-4 w-4" />
              Info
            </TabsTrigger>
            <TabsTrigger value="standings" className="flex items-center gap-2">
              <Medal className="h-4 w-4" />
              Standings
            </TabsTrigger>
            <TabsTrigger value="pairings" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Pairings
            </TabsTrigger>
            <TabsTrigger value="predictor" className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Predictor
            </TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Tournament Information</CardTitle>
                <CardDescription>
                  Details about this tournament
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <h4 className="font-medium text-gray-900">Tournament Name</h4>
                    <p className="text-gray-600">{selectedTournament.name}</p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium text-gray-900">Format</h4>
                    <p className="text-gray-600 capitalize">{selectedTournament.format}</p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium text-gray-900">Status</h4>
                    <Badge variant={selectedTournament.status === 'active' ? 'default' : selectedTournament.status === 'completed' ? 'secondary' : 'outline'}>
                      {selectedTournament.status.charAt(0).toUpperCase() + selectedTournament.status.slice(1)}
                    </Badge>
                  </div>
                  {selectedTournament.rounds && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-900">Total Rounds</h4>
                      <p className="text-gray-600">{selectedTournament.rounds}</p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <h4 className="font-medium text-gray-900">Current Round</h4>
                    <p className="text-gray-600">{selectedTournament.currentRound || 0}</p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium text-gray-900">Created</h4>
                    <p className="text-gray-600">
                      {selectedTournament.createdAt ? new Date(selectedTournament.createdAt).toLocaleDateString() : 'Unknown'}
                    </p>
                  </div>
                  {selectedTournament.format === 'roundrobin' && selectedTournament.isDoubleRoundRobin && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-900">Round Robin Type</h4>
                      <p className="text-gray-600">Double Round Robin</p>
                    </div>
                  )}
                  
                  {/* Tournament Details */}
                  {(tournamentConfig.basic.city || tournamentConfig.basic.description || tournamentConfig.basic.startDate || tournamentConfig.basic.endDate || selectedTournament.directorPhone || selectedTournament.directorEmail) && (
                    <>
                      <div className="col-span-full">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">
                          Tournament Details
                        </h3>
                      </div>
                      
                      {tournamentConfig.basic.city && (
                        <div className="space-y-2">
                          <h4 className="font-medium text-gray-900">Location</h4>
                          <p className="text-gray-600">{tournamentConfig.basic.city}</p>
                        </div>
                      )}
                      {tournamentConfig.basic.startDate && (
                        <div className="space-y-2">
                          <h4 className="font-medium text-gray-900">Start Date</h4>
                          <p className="text-gray-600">{new Date(tournamentConfig.basic.startDate).toLocaleDateString()}</p>
                        </div>
                      )}
                      {tournamentConfig.basic.endDate && (
                        <div className="space-y-2">
                          <h4 className="font-medium text-gray-900">End Date</h4>
                          <p className="text-gray-600">{new Date(tournamentConfig.basic.endDate).toLocaleDateString()}</p>
                        </div>
                      )}
                      {tournamentConfig.basic.description && (
                        <div className="space-y-2 md:col-span-2 lg:col-span-3">
                          <h4 className="font-medium text-gray-900">Description</h4>
                          <p className="text-gray-600 whitespace-pre-wrap">{tournamentConfig.basic.description}</p>
                        </div>
                      )}
                      
                      {selectedTournament.directorPhone && (
                        <div className="space-y-2">
                          <h4 className="font-medium text-gray-900">Director Phone</h4>
                          <p className="text-gray-600">{selectedTournament.directorPhone}</p>
                        </div>
                      )}
                      
                      {selectedTournament.directorEmail && (
                        <div className="space-y-2">
                          <h4 className="font-medium text-gray-900">Director Email</h4>
                          <p className="text-gray-600">{selectedTournament.directorEmail}</p>
                        </div>
                      )}
                    </>
                  )}
                  
                  {/* Round Schedule */}
                  {schedule.length > 0 && (
                    <>
                      <div className="col-span-full">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">
                          Round Schedule
                        </h3>
                      </div>
                      
                      <div className="col-span-full">
                        <div className="space-y-2">
                          {schedule.map((timing, index) => {
                            const hasSchedule = timing.date || timing.time;
                            if (!hasSchedule) return null;
                            
                            return (
                              <div key={index} className="flex items-center justify-between py-2 border-b border-gray-100">
                                <span className="font-medium">{timing.label ?? `Round ${timing.round ?? index + 1}`}</span>
                                <div className="text-gray-600">
                                  {timing.date && (
                                    <span className="mr-3">
                                      {new Date(timing.date).toLocaleDateString()}
                                    </span>
                                  )}
                                  {timing.time && (
                                    <span>
                                      {timing.time}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Player Registration Card */}
            <PlayerRegistration 
              tournament={selectedTournament}
              existingRegistration={myRegistrations.find(reg => reg.tournamentId === selectedTournament.id)}
            />
          </TabsContent>

          <TabsContent value="standings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Live Standings</CardTitle>
                <CardDescription>
                  Current tournament standings and results
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedTournament.format === 'roundrobin' ? (
                  <RoundRobinCrosstable tournamentId={selectedTournament.id} />
                ) : selectedTournament.format === 'swiss' ? (
                  <SwissStandings tournamentId={selectedTournament.id} />
                ) : (
                  <Standings tournamentId={selectedTournament.id} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pairings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Current Round Pairings</CardTitle>
                <CardDescription>
                  Live pairings and match results
                </CardDescription>
              </CardHeader>
              <CardContent>
                {selectedTournament.format === 'swiss' || selectedTournament.format === 'roundrobin' ? (
                  <SwissPairings tournamentId={selectedTournament.id} />
                ) : (
                  <p className="text-gray-600 dark:text-gray-400">
                    Pairings view not available for {getFormatName(selectedTournament.format)} format
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="predictor" className="space-y-6">
            <PairingPredictor 
              tournamentId={selectedTournament.id} 
              tournament={selectedTournament} 
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}