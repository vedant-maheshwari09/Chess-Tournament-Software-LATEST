import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Trophy, Users, Settings as SettingsIcon, Pencil, Swords } from "lucide-react";
import SwissStandings from "@/components/swiss-standings";
import SwissPairings from "@/components/swiss-pairings";
import RoundRobinCrosstable from "@/components/round-robin-crosstable";
import PairingPredictor from "@/components/pairing-predictor";
import TournamentByes from "@/components/tournament-byes";
import { createDefaultConfig, parseTournamentConfig } from "@/lib/tournament-config";
import { renderTournamentPageContent } from "@/lib/tournament-page";
import type { Tournament } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";
import type { PlayerRegistration } from "@shared/schema";
import { RegistrationStatusCard } from "@/components/registration-status-card";
import KnockoutBracket from "@/components/knockout-bracket";
import { cn } from "@/lib/utils";
import { ArenaLobby, ArenaActiveMatches, ArenaStandings, ArenaTimer, TournamentHistory } from "@/components/arena-ui";


type TabKey = "pairings" | "standings" | "byes" | "predictor" | "info" | "lobby";

const TAB_LABELS: Record<TabKey, string> = {
  lobby: "Lobby",
  pairings: "Pairings",
  standings: "Standings",
  byes: "Byes",
  predictor: "Pairing Predictor",
  info: "Info",
};

interface TournamentViewProps {
  tournamentId: number;
}

export default function TournamentView({ tournamentId }: TournamentViewProps) {
  const [, setLocation] = useLocation();
  const [match, params] = useRoute("/tournaments/:id/:tab");
  const tabParam = match && params?.tab ? (params.tab as TabKey) : "pairings";
  const { user, isLoading: authLoading } = useAuth();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
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

  const config = useMemo(
    () => (tournament ? parseTournamentConfig(tournament) : createDefaultConfig("swiss")),
    [tournament],
  );
  const tournamentPageContent = config.tournamentPageContent?.trim() ?? "";
  const predictorEnabled = Boolean(config.registers?.enablePairingPredictor);
  const tournamentHasStarted = Boolean(
    tournament &&
    ((tournament.currentRound ?? 0) > 0 || tournament.status === "active" || tournament.status === "completed"),
  );
  const isArena = tournament?.format === "arena";
  const showPredictor =
    predictorEnabled && (tournament?.format ?? config.format) === "swiss" && tournamentHasStarted;

  const availableTabs = useMemo<TabKey[]>(
    () => {
      const tabs: TabKey[] = [];
      if (isArena) {
        tabs.push("lobby");
        // Remove "standings" for Arena as it's now integrated into Lobby
      }
      tabs.push("pairings");
      if (!isArena) {
        tabs.push("standings");
        tabs.push("byes");
      }
      if (showPredictor) tabs.push("predictor");
      tabs.push("info");
      return tabs;
    },
    [showPredictor, isArena]
  );

  const activeTab = useMemo(() => {
    return availableTabs.includes(tabParam) ? tabParam : availableTabs[0];
  }, [availableTabs, tabParam]);

  const infoHtml = useMemo(
    () => (tournamentPageContent ? renderTournamentPageContent(tournamentPageContent) : ""),
    [tournamentPageContent],
  );

  if (tournamentLoading || authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="mt-2 text-gray-600">Loading tournament...</p>
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-96">
          <CardContent className="pt-6 text-center">
            <Trophy className="mx-auto mb-4 h-12 w-12 text-gray-400" />
            <h3 className="mb-2 text-lg font-semibold">Tournament Not Found</h3>
            <p className="mb-4 text-gray-600">The tournament you're looking for doesn't exist.</p>
            <Button onClick={() => setLocation("/")}>Back to Dashboard</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canManageTournament = Boolean(user && user.role === "tournament_director");

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">

      <div className="bg-white shadow dark:bg-gray-800">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Button variant="ghost" onClick={() => setLocation("/")} className="flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to Tournaments
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{tournament.name}</h1>
                <p className="text-gray-600 dark:text-gray-300">
                  {tournament.format === "swiss" ? "Swiss System" : tournament.format === "arena" ? "Arena" : tournament.format.charAt(0).toUpperCase() + tournament.format.slice(1)} • {isArena ? `${tournament.arenaDuration || 0} mins` : `${tournament.rounds} rounds`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <Badge variant={tournament.status === "active" ? "default" : tournament.status === "completed" ? "secondary" : "outline"} className={
                tournament.status === "upcoming" ? "bg-blue-100 text-blue-800 border-none hover:bg-blue-100" : ""
              }>
                {tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
              </Badge>

              {(tournament.status === "upcoming" || tournament.status === "registration" || tournament.status === "active") && (
                hasRegistration ? (
                  config.registers.allowEditRegistration && (
                    <Button
                      onClick={() => setLocation(`/tournaments/${tournamentId}/register?edit=true`)}
                      variant="outline"
                      className="border-blue-500 text-blue-600 hover:bg-blue-50 font-semibold"
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit Registration
                    </Button>
                  )
                ) : (
                  <Button
                    onClick={() => setLocation(`/tournaments/${tournamentId}/register`)}
                    className="bg-blue-500 hover:bg-blue-600 text-white font-semibold shadow-sm shadow-blue-200"
                  >
                    <Trophy className="mr-2 h-4 w-4" />
                    Register
                  </Button>
                )
              )}

              {canManageTournament && (
                <Button
                  variant="outline"
                  onClick={() => setLocation(`/tournaments/${tournamentId}/actions`)}
                  className="flex items-center gap-2"
                >
                  <SettingsIcon className="h-4 w-4" />
                  Settings
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {isArena && tournament && (
          <div className="mb-6 flex justify-center">
            <ArenaTimer tournament={tournament} />
          </div>
        )}
        {hasRegistration && (
          <div className="mb-6">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-3">Registration Status</h2>
            <RegistrationStatusCard registrations={myRegistrations} />
          </div>
        )}
        <Tabs value={activeTab} onValueChange={(value) => setLocation(`/tournaments/${tournamentId}/${value}`)} className="w-full">
          <TabsList className={cn(
            "grid w-full items-stretch gap-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-0",
            availableTabs.length === 3 ? "grid-cols-3" : 
            availableTabs.length === 4 ? "grid-cols-4" : 
            availableTabs.length === 5 ? "grid-cols-5" : "grid-cols-6"
          )}>
            {availableTabs.map((tab) => (
              <TabsTrigger 
                key={tab} 
                value={tab} 
                className={cn(
                  "flex h-full w-full items-center justify-center gap-2 px-6 py-4 text-center text-sm font-semibold text-slate-600 transition",
                  "data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900 data-[state=active]:shadow-none data-[state=active]:rounded-none"
                )}
              >
                {TAB_LABELS[tab]}
              </TabsTrigger>
            ))}
          </TabsList>

          {isArena && (
            <>
              <TabsContent value="lobby" className="mt-6">
                <ArenaLobby tournamentId={tournamentId} isTD={canManageTournament} userId={user?.id} />
              </TabsContent>
            </>
          )}

          <TabsContent value="pairings" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {isArena ? <Swords className="h-5 w-5 text-blue-500" /> : <Users className="h-5 w-5 border-blue-500" />}
                  <span>{isArena ? "Active Arena Matches" : "Current Pairings"}</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {tournament.format === 'knockout' ? (
                  <KnockoutBracket tournamentId={tournamentId} />
                ) : tournament.format === 'arena' ? (
                  <ArenaActiveMatches tournamentId={tournamentId} isTD={canManageTournament} userId={user?.id} />
                ) : (
                  <SwissPairings tournamentId={tournamentId} activeSection="all" showExportControls={false} />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="standings" className="mt-6">
            {tournament.format === "roundrobin" ? (
              <RoundRobinCrosstable tournamentId={tournamentId} />
            ) : tournament.format === "swiss" ? (
              <SwissStandings tournamentId={tournamentId} showExportControls={false} />
            ) : tournament.format === "arena" ? (
              <ArenaStandings tournamentId={tournamentId} isTD={canManageTournament} userId={user?.id} />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Trophy className="h-5 w-5" />
                    <span>Tournament Standings</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-gray-600">Standings for this tournament format coming soon.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {!isArena && (
            <TabsContent value="byes" className="mt-6">
              <TournamentByes tournamentId={tournamentId} />
            </TabsContent>
          )}

          {showPredictor ? (
            <TabsContent value="predictor" className="mt-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users className="h-5 w-5" />
                    <span>Pairing Predictor</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PairingPredictor tournamentId={tournamentId} tournament={tournament} />
                </CardContent>
              </Card>
            </TabsContent>
          ) : null}

          <TabsContent value="info" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Trophy className="h-5 w-5" />
                  <span>Public Tournament Page</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {infoHtml ? (
                  <div className="prose prose-slate max-w-none" dangerouslySetInnerHTML={{ __html: infoHtml }} />
                ) : (
                  <p className="text-sm text-slate-600">The tournament director has not published public page content yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
