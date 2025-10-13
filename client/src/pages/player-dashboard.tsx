import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Trophy, Users, Eye, ArrowLeft, Medal, Info, Calculator, PauseCircle } from "lucide-react";
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
import TournamentByes from "@/components/tournament-byes";
import { parseTournamentConfig } from "@/lib/tournament-config";
import { renderTournamentPageContent } from "@/lib/tournament-page";
import { apiRequest } from "@/lib/queryClient";

type SortKey = "players" | "date" | "state";

type DetailTabKey = "pairings" | "standings" | "byes" | "predictor" | "info";

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

const DETAIL_TAB_META: Array<{ key: DetailTabKey; label: string; icon: ComponentType<{ className?: string }> }> = [
  { key: "pairings", label: "Pairings", icon: Users },
  { key: "standings", label: "Standings", icon: Medal },
  { key: "byes", label: "Byes", icon: PauseCircle },
  { key: "predictor", label: "Pairing Predictor", icon: Calculator },
  { key: "info", label: "Info", icon: Info },
];

export default function PlayerDashboard() {
  const { user } = useAuth();
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [activeTab, setActiveTab] = useState<string>("ongoing");
  const [detailTab, setDetailTab] = useState<DetailTabKey>("pairings");
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
        <td className="px-4 py-4 align-middle text-center">
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
        <td className="px-4 py-4 align-middle text-center">
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
                    <th className="px-4 py-3 text-center">View</th>
                    <th className="px-4 py-3 text-center">Register</th>
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

  const tournamentConfig = useMemo(
    () => (selectedTournament ? parseTournamentConfig(selectedTournament) : null),
    [selectedTournament],
  );
  const schedule = tournamentConfig?.schedule ?? [];
  const infoHtml = useMemo(
    () => renderTournamentPageContent(tournamentConfig?.tournamentPageContent ?? ""),
    [tournamentConfig?.tournamentPageContent],
  );
  const predictorEnabled = Boolean(tournamentConfig?.registers?.enablePairingPredictor);
  const tournamentHasStarted = Boolean(
    selectedTournament &&
      ((selectedTournament.currentRound ?? 0) > 0 ||
        selectedTournament.status === "active" ||
        selectedTournament.status === "completed"),
  );
  const showPredictorTab = Boolean(
    selectedTournament && predictorEnabled && selectedTournament.format === "swiss" && tournamentHasStarted,
  );
  const visibleTabMeta = useMemo(
    () => DETAIL_TAB_META.filter((tab) => (showPredictorTab ? true : tab.key !== "predictor")),
    [showPredictorTab],
  );
  const visibleTabs = useMemo<DetailTabKey[]>(
    () => visibleTabMeta.map((tab) => tab.key as DetailTabKey),
    [visibleTabMeta],
  );

  useEffect(() => {
    if (!visibleTabs.includes(detailTab)) {
      setDetailTab(visibleTabs[0] ?? "pairings");
    }
  }, [visibleTabs, detailTab]);

  useEffect(() => {
    if (selectedTournament) {
      setDetailTab(visibleTabs[0] ?? "pairings");
    }
  }, [selectedTournament?.id, visibleTabs]);

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

  if (!tournamentConfig) {
    return null;
  }

  // Tournament Details View
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
        <Tabs value={detailTab} onValueChange={(value) => setDetailTab(value as DetailTabKey)} className="space-y-6">
          <TabsList className="grid w-full gap-2 sm:grid-cols-3 md:grid-cols-5">
            {visibleTabMeta.map(({ key, label, icon: Icon }) => (
              <TabsTrigger key={key} value={key} className="flex items-center justify-center gap-2 text-sm font-semibold">
                <Icon className="h-4 w-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="pairings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Current Round Pairings</CardTitle>
                <CardDescription>Live pairings and match results</CardDescription>
              </CardHeader>
              <CardContent>
                {selectedTournament.format === "swiss" || selectedTournament.format === "roundrobin" ? (
                  <SwissPairings tournamentId={selectedTournament.id} />
                ) : (
                  <p className="text-gray-600 dark:text-gray-400">
                    Pairings view not available for {getFormatName(selectedTournament.format)} format
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="standings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Live Standings</CardTitle>
                <CardDescription>Current tournament standings and results</CardDescription>
              </CardHeader>
              <CardContent>
                {selectedTournament.format === "roundrobin" ? (
                  <RoundRobinCrosstable tournamentId={selectedTournament.id} />
                ) : selectedTournament.format === "swiss" ? (
                  <SwissStandings tournamentId={selectedTournament.id} />
                ) : (
                  <Standings tournamentId={selectedTournament.id} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="byes" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Registered Byes</CardTitle>
                <CardDescription>Approved half-point and full-point byes</CardDescription>
              </CardHeader>
              <CardContent>
                <TournamentByes tournamentId={selectedTournament.id} />
              </CardContent>
            </Card>
          </TabsContent>

          {showPredictorTab ? (
            <TabsContent value="predictor" className="space-y-6">
              <PairingPredictor tournamentId={selectedTournament.id} tournament={selectedTournament} />
            </TabsContent>
          ) : null}

          <TabsContent value="info" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Public Tournament Page</CardTitle>
                <CardDescription>Information provided by the tournament director</CardDescription>
              </CardHeader>
              <CardContent>
                {infoHtml.trim() ? (
                  <div className="prose prose-slate max-w-none" dangerouslySetInnerHTML={{ __html: infoHtml }} />
                ) : (
                  <p className="text-sm text-slate-600">
                    The tournament director has not published public page content yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}