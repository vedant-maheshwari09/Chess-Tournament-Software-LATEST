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
import { parseTournamentConfig } from "@/lib/tournament-config";
import { cn } from "@/lib/utils";
import type { Tournament } from "@shared/schema";
import { useAuth } from "@/hooks/useAuth";

type TabKey = "pairings" | "standings" | "byes" | "predictor" | "info";

interface TournamentViewProps {
  tournamentId: number;
}

const GRID_COLUMNS_MAP: Record<number, string> = {
  3: "grid-cols-3",
  4: "grid-cols-4",
  5: "grid-cols-5",
};

export default function TournamentView({ tournamentId }: TournamentViewProps) {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<TabKey>("pairings");
  const { user, isLoading: authLoading } = useAuth();

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

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
  const config = useMemo(() => parseTournamentConfig(tournament), [tournament]);
  const tournamentPageContent = config.tournamentPageContent?.trim() ?? "";
  const predictorEnabled = Boolean(config.registers?.enablePairingPredictor);
  const tournamentHasStarted = (tournament.currentRound ?? 0) > 0 || tournament.status === "active" || tournament.status === "completed";
  const showPredictor = predictorEnabled && tournamentHasStarted && tournament.format === "swiss";

  const tabs = useMemo<{ key: TabKey; label: string }[]>(() => {
    const items: { key: TabKey; label: string }[] = [
      { key: "pairings", label: "Pairings" },
      { key: "standings", label: "Standings" },
      { key: "byes", label: "Byes" },
    ];
    if (showPredictor) {
      items.push({ key: "predictor", label: "Predictor" });
    }
    items.push({ key: "info", label: "Info" });
    return items;
  }, [showPredictor]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(tabs[0]?.key ?? "pairings");
    }
  }, [tabs, activeTab]);

  const infoHtml = useMemo(() => (tournamentPageContent ? renderTournamentPageContent(tournamentPageContent) : ""), [tournamentPageContent]);
  const gridClass = GRID_COLUMNS_MAP[tabs.length] ?? "grid-cols-4";

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
          <TabsList className={cn("grid w-full gap-2", gridClass)}>
            {tabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="text-sm font-semibold">
                {tab.label}
              </TabsTrigger>
            ))}
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
                <SwissPairings tournamentId={tournamentId} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="standings" className="mt-6">
            {tournament.format === "roundrobin" ? (
              <RoundRobinCrosstable tournamentId={tournamentId} />
            ) : tournament.format === "swiss" ? (
              <SwissStandings tournamentId={tournamentId} />
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatInlineMarkdown(input: string): string {
  let result = escapeHtml(input);
  result = result.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*(.+?)\*/g, "<em>$1</em>");
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  result = result.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return result;
}

function renderTournamentPageContent(content: string): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inUnordered = false;
  let inOrdered = false;

  const closeLists = () => {
    if (inUnordered) {
      html.push("</ul>");
      inUnordered = false;
    }
    if (inOrdered) {
      html.push("</ol>");
      inOrdered = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeLists();
      html.push("<p>&nbsp;</p>");
      continue;
    }

    if (/^#{1,6}\s/.test(trimmed)) {
      closeLists();
      const level = Math.min(6, trimmed.match(/^#+/)?.[0].length ?? 1);
      const text = trimmed.replace(/^#{1,6}\s*/, "");
      html.push(`<h${level}>${formatInlineMarkdown(text)}</h${level}>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (!inUnordered) {
        closeLists();
        html.push("<ul>");
        inUnordered = true;
      }
      const text = trimmed.replace(/^[-*]\s+/, "");
      html.push(`<li>${formatInlineMarkdown(text)}</li>`);
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inOrdered) {
        closeLists();
        html.push("<ol>");
        inOrdered = true;
      }
      const text = trimmed.replace(/^\d+\.\s+/, "");
      html.push(`<li>${formatInlineMarkdown(text)}</li>`);
      continue;
    }

    closeLists();
    html.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
  }

  closeLists();
  return html.join("");
}
