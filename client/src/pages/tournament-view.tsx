import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Trophy, Users, Settings as SettingsIcon, Clock as ClockIcon, Info, Share2, Facebook, Twitter, Mail, Award, Link, Swords, Pencil, Plus } from "lucide-react";
import SwissStandings from "@/components/swiss-standings";
import SwissPairings from "@/components/swiss-pairings";
import RoundRobinCrosstable from "@/components/round-robin-crosstable";
import PairingPredictor from "@/components/pairing-predictor";
import TournamentByes from "@/components/tournament-byes";
import {
  createDefaultConfig,
  parseTournamentConfig,
  formatTournamentDateRange
} from "@/lib/tournament-config";
import { renderTournamentPageContent } from "@/lib/tournament-page";
import TournamentCountdown from "@/components/tournament-countdown";
import type { Tournament, Player, PlayerRegistration } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { RegistrationStatusCard } from "@/components/registration-status-card";
import KnockoutBracket from "@/components/knockout-bracket";
import { cn } from "@/lib/utils";
import { ArenaLobby, ArenaActiveMatches, ArenaStandings, ArenaTimer } from "@/components/arena-ui";
import PlayerManager from "@/components/player-manager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type TabKey = "pairings" | "standings" | "byes" | "predictor" | "info" | "lobby" | "players" | "bracket";

const TAB_LABELS: Record<TabKey, string> = {
  lobby: "Arena",
  pairings: "Pairings",
  standings: "Standings",
  byes: "Byes",
  predictor: "Pairing Predictor",
  info: "Information",
  players: "Players",
  bracket: "Bracket",
};

interface TournamentViewProps {
  tournamentId: number;
}

export default function TournamentView({ tournamentId }: TournamentViewProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const [match, params] = useRoute("/tournaments/:id/:tab");
  const tabParam = (params?.tab as TabKey) || "info";

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: allPlayers = [] } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const { data: registrations } = useQuery<PlayerRegistration[]>({
    queryKey: ["/api/my-registrations"],
    enabled: !!user,
  });

  const myRegistrations = useMemo(() =>
    registrations?.filter(r => r.tournamentId === tournamentId) || [],
    [registrations, tournamentId]
  );

  const hasRegistration = myRegistrations.length > 0;

  const config = useMemo(() => (tournament ? parseTournamentConfig(tournament) : createDefaultConfig("swiss")), [tournament]);
  const dateRange = tournament ? formatTournamentDateRange(tournament.startDate, tournament.endDate) : "";
  const tournamentHasStarted = tournament && ((tournament.currentRound ?? 0) > 0 || tournament.status === "active" || tournament.status === "completed");
  const predictorEnabled = Boolean(config.registers?.enablePairingPredictor);
  const showPredictor = predictorEnabled && (tournament?.format ?? config.format) === "swiss" && tournamentHasStarted;
  const isArena = tournament?.format === "arena";

  const availableTabs = useMemo<TabKey[]>(() => {
    if (tournament?.format === "knockout") {
      return ["players", "pairings", "bracket", "info"];
    } else if (tournament?.format === "swiss") {
      const tabs: TabKey[] = ["standings", "pairings"];
      if (showPredictor) tabs.push("predictor");
      tabs.push("byes", "info");
      return tabs;
    } else if (tournament?.format === "arena") {
      return ["players", "lobby", "standings", "info"];
    } else if (tournament?.format === "roundrobin") {
      return ["standings", "pairings", "byes", "info"];
    }
    return ["standings", "pairings", "byes", "info"];
  }, [tournament?.format, showPredictor]);

  const activeTab = availableTabs.includes(tabParam) ? tabParam : availableTabs[0];
  const infoHtml = useMemo(() => (config.tournamentPageContent ? renderTournamentPageContent(config.tournamentPageContent) : ""), [config.tournamentPageContent]);

  const [activeRoundSection, setActiveRoundSection] = useState<string>("all");

  const sections = useMemo(() => {
    return (config.sections || []).filter((s: any) => s.name.trim().length > 0);
  }, [config.sections]);

  const handleRegister = () => {
    if (!user) {
      toast({
        title: "Please log in",
        description: "You must be logged in to register for a tournament.",
        variant: "destructive",
      });
      return;
    }
    setLocation(`/tournaments/${tournamentId}/register`);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    toast({
      title: "Link copied!",
      description: "Tournament link has been copied to your clipboard.",
    });
  };

  if (tournamentLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-600" />
          <p className="mt-4 text-slate-600 dark:text-slate-400 font-medium">Loading tournament...</p>
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <Card className="w-full max-w-md border-none shadow-xl">
          <CardContent className="pt-8 pb-8 text-center">
            <Trophy className="mx-auto mb-6 h-16 w-16 text-slate-200" />
            <h3 className="mb-2 text-2xl font-bold text-slate-900 dark:text-white">Tournament Not Found</h3>
            <p className="mb-8 text-slate-500 dark:text-slate-400">The tournament you're looking for doesn't exist or has been moved.</p>
            <Button onClick={() => setLocation("/")} className="w-full bg-indigo-600 hover:bg-indigo-700">Back to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canManageTournament = Boolean(user && user.role === "tournament_director");

  return (
    <div className="min-h-screen bg-transparent pb-12">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={() => setLocation("/")}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Button>
        </div>

        {/* Hero Section */}
        <Card className="overflow-hidden border-none shadow-xl shadow-slate-200/50 dark:bg-slate-900">
          {config.publicPage?.bannerUrl && (
            <div className="h-48 sm:h-64 w-full overflow-hidden relative">
              <img src={config.publicPage.bannerUrl} className="w-full h-full object-cover" alt={tournament.name} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end p-8">
                <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">{tournament.name}</h1>
              </div>
            </div>
          )}
          <CardContent className={cn("p-6 sm:p-8", !config.publicPage?.bannerUrl && "pt-8")}>
            {!config.publicPage?.bannerUrl && <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2 text-center md:text-left tracking-tight">{tournament.name}</h1>}
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1 text-center md:text-left">
                <p className="text-slate-600 dark:text-slate-300 font-medium">
                  {tournament.format === "swiss" ? "Swiss System" :
                    tournament.format === "arena" ? "Arena" :
                      tournament.format === "knockout" ? "Knockout" :
                        tournament.format.charAt(0).toUpperCase() + tournament.format.slice(1)}
                  {" • "}
                  {tournament.format === "knockout"
                    ? `${allPlayers.length} players`
                    : tournament.format === "arena"
                      ? `${tournament.status === "completed" ? "Completed Arena " : ""}${allPlayers.length} players • ${tournament.arenaDuration || 0} mins`
                      : `${tournament.rounds} rounds`}
                </p>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-sm text-slate-500 dark:text-slate-400 mt-2">
                  <span className="flex items-center gap-1.5"><ClockIcon className="h-4 w-4" /> {dateRange}</span>
                  <span className="flex items-center gap-1.5"><Trophy className="h-4 w-4" /> {allPlayers.length} Players</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
                <Badge
                  variant={tournament.status === "active" ? "default" : tournament.status === "completed" ? "secondary" : "outline"}
                  className={cn(
                    "px-4 py-1 text-xs font-bold uppercase tracking-wider rounded-full border-none",
                    (tournament.status === "upcoming" || tournament.status === "registration" || tournament.status === "draft") && "bg-blue-100 text-blue-800 hover:bg-blue-100",
                    tournament.status === "active" && "bg-green-100 text-green-800 hover:bg-green-100",
                    tournament.status === "completed" && "bg-slate-100 text-slate-600 hover:bg-slate-100"
                  )}
                >
                  {tournament.status === "upcoming" || tournament.status === "registration" || tournament.status === "draft" ? "Upcoming" :
                    tournament.status === "active" ? "Live" :
                      tournament.status === "completed" ? "Past" :
                        tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
                </Badge>

                {(tournament.status === "upcoming" || tournament.status === "registration") && (
                  hasRegistration ? (
                    config.registers?.allowEditRegistration && (
                      <Button
                        onClick={() => setLocation(`/tournaments/${tournamentId}/register?edit=true`)}
                        variant="outline"
                        className="w-full sm:w-auto rounded-full border-blue-500 text-blue-600 hover:bg-blue-50 font-bold"
                      >
                        <Pencil className="mr-2 h-4 w-4" />
                        Edit Registration
                      </Button>
                    )
                  ) : (
                    <Button className="w-full sm:w-auto gap-2 bg-indigo-600 hover:bg-indigo-700 shadow-md" onClick={handleRegister}>
                      <Plus className="h-4 w-4" />
                      Register Now
                    </Button>
                  )
                )}

                {canManageTournament && (
                  <Button
                    variant="outline"
                    onClick={() => setLocation(`/tournaments/${tournamentId}/manage`)}
                    className="rounded-full border-slate-200 font-bold"
                  >
                    <SettingsIcon className="h-4 w-4 mr-2" />
                    Manage
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs Navigation */}
        <Tabs value={activeTab} onValueChange={(v) => setLocation(`/tournaments/${tournamentId}/${v}`)} className="w-full">
          <TabsList className="flex w-full min-h-[48px] h-auto overflow-x-auto no-scrollbar flex-nowrap items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200/60 shadow-sm backdrop-blur-sm">
            {availableTabs.map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className={cn(
                  "flex-none md:flex-1 h-full min-h-[38px] min-w-[90px] flex items-center justify-center gap-2 px-3 sm:px-6 rounded-lg text-center text-xs sm:text-sm font-semibold text-slate-500 transition-all whitespace-nowrap",
                  "data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-sm"
                )}
              >
                {TAB_LABELS[tab]}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="players" className="mt-8">
            <PlayerManager
              tournament={tournament}
              tournamentId={tournamentId}
              isTD={false}
            />
          </TabsContent>

          <TabsContent value="lobby" className="mt-8">
            <ArenaLobby tournamentId={tournamentId} isTD={false} userId={user?.id} />
          </TabsContent>

          <TabsContent value="pairings" className="mt-8">
            <Card className="border-none shadow-sm dark:bg-slate-900">
              <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="flex items-center gap-2 text-lg">
                  {isArena ? <Swords className="h-5 w-5 text-indigo-500" /> : <Users className="h-5 w-5 text-indigo-500" />}
                  <span>{isArena ? "Active Arena Matches" : "Pairings"}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {isArena ? (
                  <ArenaActiveMatches tournamentId={tournamentId} isTD={false} userId={user?.id} />
                ) : (
                  <div className="space-y-4">
                    {sections.length > 0 && (
                      <div className="flex w-full items-center justify-end overflow-x-auto no-scrollbar gap-2 pb-2">
                        <Button
                          variant={activeRoundSection === "all" ? "default" : "outline"}
                          size="sm"
                          onClick={() => setActiveRoundSection("all")}
                          className={activeRoundSection === "all" ? "bg-blue-600 hover:bg-blue-700" : ""}
                        >
                          All Sections
                        </Button>
                        {(sections as any[]).map((section) => (
                          <Button
                            key={section.id}
                            variant={activeRoundSection === section.id ? "default" : "outline"}
                            size="sm"
                            onClick={() => setActiveRoundSection(section.id)}
                            className={activeRoundSection === section.id ? "bg-blue-600 hover:bg-blue-700 whitespace-nowrap" : "whitespace-nowrap"}
                          >
                            {section.name}
                          </Button>
                        ))}
                      </div>
                    )}
                    <SwissPairings
                      tournamentId={tournamentId}
                      activeSection={activeRoundSection}
                      showExportControls={false}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="standings" className="mt-8">
            {tournament.format === "roundrobin" ? (
              <RoundRobinCrosstable tournamentId={tournamentId} />
            ) : tournament.format === "swiss" ? (
              <SwissStandings tournamentId={tournamentId} showExportControls={false} />
            ) : tournament.format === "arena" ? (
              <ArenaStandings tournamentId={tournamentId} isTD={false} userId={user?.id} />
            ) : (
              <Card className="border-none shadow-sm">
                <CardHeader>
                  <CardTitle className="text-lg">Tournament Standings</CardTitle>
                </CardHeader>
                <CardContent className="py-12 text-center text-slate-500">
                  Standings for this tournament format coming soon.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="bracket" className="mt-8">
            <Card className="border-none shadow-sm dark:bg-slate-900">
              <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Trophy className="h-5 w-5 text-amber-500" />
                  <span>Knockout Bracket</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 overflow-x-auto">
                <KnockoutBracket tournamentId={tournamentId} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="byes" className="mt-8">
            <TournamentByes tournamentId={tournamentId} />
          </TabsContent>

          {showPredictor && (
            <TabsContent value="predictor" className="mt-8">
              <PairingPredictor tournamentId={tournamentId} tournament={tournament} />
            </TabsContent>
          )}

          <TabsContent value="info" className="mt-8">
            <div className="max-w-5xl mx-auto space-y-8">
              <Card className="border-none shadow-sm dark:bg-slate-900">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Info className="h-5 w-5 text-indigo-500" />
                    <span>About the Tournament</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-8">
                  {infoHtml ? (
                    <div className="tournament-content prose prose-slate max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: infoHtml }} />
                  ) : (
                    <div className="text-center py-12 text-slate-400">
                      <Info className="h-12 w-12 mx-auto mb-4 opacity-20" />
                      <p>No information available for this tournament.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {config.publicPage?.showPrizeFund && config.prizes && config.prizes.length > 0 && (
                <Card className="border-none shadow-sm dark:bg-slate-900">
                  <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Award className="h-5 w-5 text-amber-500" />
                      <span>Prizes & Awards</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {config.prizes.map((prize, idx) => (
                        <div key={idx} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                          <div className="flex items-center gap-3">
                            <div className="bg-white dark:bg-slate-900 p-2 rounded-xl shadow-sm">
                              <Trophy className={cn("h-4 w-4", idx === 0 ? "text-amber-500" : idx === 1 ? "text-slate-400" : "text-amber-700")} />
                            </div>
                            <span className="font-bold text-slate-800 dark:text-slate-200">{prize.place}</span>
                          </div>
                          <span className="text-xl font-black text-indigo-600 dark:text-indigo-400">${prize.amount}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
