import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Trophy, Users, Settings as SettingsIcon } from "lucide-react";
import SwissStandings from "@/components/swiss-standings";
import SwissPairings from "@/components/swiss-pairings";
import RoundRobinCrosstable from "@/components/round-robin-crosstable";
import PairingPredictor from "@/components/pairing-predictor";
import TournamentByes from "@/components/tournament-byes";
import { createDefaultConfig, parseTournamentConfig } from "@/lib/tournament-config";
import { renderTournamentPageContent } from "@/lib/tournament-page";
import type { Tournament } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";

type TabKey = "pairings" | "standings" | "byes" | "predictor" | "info";

const TAB_LABELS: Record<TabKey, string> = {
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
  const [activeTab, setActiveTab] = useState<TabKey>("pairings");
  const { user, isLoading: authLoading } = useAuth();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

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
  const showPredictor =
    predictorEnabled && (tournament?.format ?? config.format) === "swiss" && tournamentHasStarted;

  const availableTabs = useMemo<TabKey[]>(
    () => (showPredictor ? ["pairings", "standings", "byes", "predictor", "info"] : ["pairings", "standings", "byes", "info"]),
    [showPredictor],
  );

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
    }
  }, [availableTabs, activeTab]);

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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" onClick={() => setLocation("/")} className="flex items-center gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to Dashboard
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{tournament.name}</h1>
                <p className="text-gray-600 dark:text-gray-300">
                  {tournament.format.toUpperCase()} • {tournament.rounds} rounds
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {canManageTournament ? (
                <Button
                  variant="outline"
                  onClick={() => setLocation(`/tournaments/${tournamentId}/actions`)}
                  className="flex items-center gap-2"
                >
                  <SettingsIcon className="h-4 w-4" />
                  Settings
                </Button>
              ) : null}
              <Badge variant={tournament.status === "active" ? "default" : tournament.status === "completed" ? "secondary" : "outline"}>
                {tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)}>
          <TabsList className="flex w-full flex-wrap gap-2">
            <TabsTrigger value="pairings" className="flex-1 min-w-[140px] text-sm font-semibold">
              {TAB_LABELS.pairings}
            </TabsTrigger>
            <TabsTrigger value="standings" className="flex-1 min-w-[140px] text-sm font-semibold">
              {TAB_LABELS.standings}
            </TabsTrigger>
            <TabsTrigger value="byes" className="flex-1 min-w-[140px] text-sm font-semibold">
              {TAB_LABELS.byes}
            </TabsTrigger>
            {showPredictor ? (
              <TabsTrigger value="predictor" className="flex-1 min-w-[140px] text-sm font-semibold">
                {TAB_LABELS.predictor}
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="info" className="flex-1 min-w-[140px] text-sm font-semibold">
              {TAB_LABELS.info}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pairings" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="h-5 w-5" />
                  <span>Current Pairings</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SwissPairings tournamentId={tournamentId} activeSection="all" showExportControls={false} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="standings" className="mt-6">
            {tournament.format === "roundrobin" ? (
              <RoundRobinCrosstable tournamentId={tournamentId} />
            ) : tournament.format === "swiss" ? (
              <SwissStandings tournamentId={tournamentId} showExportControls={false} />
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

          <TabsContent value="byes" className="mt-6">
            <TournamentByes tournamentId={tournamentId} />
          </TabsContent>

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
