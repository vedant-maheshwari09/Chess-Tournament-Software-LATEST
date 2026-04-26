import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trophy, Users } from "lucide-react";
import { Link, useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import type { Tournament } from "@shared/schema";
import SettingsMenu from "@/components/settings-menu";
import NotificationBell from "@/components/notification-bell";


export default function TournamentDirectorDashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [, dashboardParams] = useRoute("/dashboard/:tab");
  const activeTab = dashboardParams?.tab ?? "drafts";

  const { data: tournaments = [], isLoading } = useQuery<Tournament[]>({
    queryKey: ["/api/my-tournaments"],
  });

  const categorized = useMemo(
    () => ({
      past: tournaments.filter((tournament) => tournament.status === "completed"),
      live: tournaments.filter((tournament) => tournament.status === "active"),
      upcoming: tournaments.filter((tournament) => tournament.status === "upcoming"),
      drafts: tournaments.filter((tournament) => tournament.status === "draft"),
    }),
    [tournaments]
  );


  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-green-500 text-white";
      case "upcoming":
        return "bg-blue-500 text-white";
      case "draft":
        return "bg-yellow-500 text-gray-900";
      case "completed":
        return "bg-gray-500 text-white";
      default:
        return "bg-gray-500 text-white";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "active":
        return "Live";
      case "upcoming":
        return "Upcoming";
      case "draft":
        return "Draft";
      case "completed":
        return "Completed";
      default:
        return status;
    }
  };

  const formatLabel = (format: string) => {
    if (!format) return "";
    return format.charAt(0).toUpperCase() + format.slice(1);
  };

  const renderActions = (tournament: Tournament) => {
    const actions: ReactNode[] = [];
    if (tournament.status === "draft") {
      actions.push(
        <Link key="manage" href={`/tournaments/${tournament.id}/manage`}>
          <Button variant="secondary" size="sm">
            Manage
          </Button>
        </Link>
      );
    } else if (tournament.status === "upcoming") {
      actions.push(
        <Link key="manage" href={`/tournaments/${tournament.id}/manage`}>
          <Button variant="outline" size="sm">
            Manage
          </Button>
        </Link>
      );
    } else if (tournament.status === "active") {
      actions.push(
        <Link key="manage" href={`/tournaments/${tournament.id}/manage`}>
          <Button size="sm">Manage</Button>
        </Link>
      );
      actions.push(
        <Link key="view" href={`/tournaments/${tournament.id}`}>
          <Button variant="outline" size="sm">
            View Live
          </Button>
        </Link>
      );
    } else if (tournament.status === "completed") {
      actions.push(
        <Link key="view" href={`/tournaments/${tournament.id}/manage`}>
          <Button variant="outline" size="sm">
            View Results
          </Button>
        </Link>
      );
    }

    return actions;
  };

  const renderSection = (items: Tournament[], emptyMessage: string, cta?: ReactNode) => {
    if (items.length === 0) {
      return (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-4 py-12 text-center">
            <Trophy className="h-12 w-12 text-gray-400" />
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Nothing here yet</h3>
              <p className="text-gray-600 dark:text-gray-300">{emptyMessage}</p>
            </div>
            {cta}
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="grid gap-3">
        {items.map((tournament) => (
          <Card key={tournament.id} className="hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50">
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">{tournament.name}</h3>
                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Format: {formatLabel(tournament.format)}
                  </span>
                  {typeof tournament.rounds === "number" && tournament.rounds > 0 ? (
                    <span>Rounds: {tournament.rounds}</span>
                  ) : null}
                  <span>Round: {tournament.currentRound ?? 0}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Badge className={getStatusColor(tournament.status)}>{getStatusText(tournament.status)}</Badge>
                <div className="flex flex-wrap justify-end gap-2">{renderActions(tournament)}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  const sections = [
    {
      key: "past",
      label: "Past Tournaments",
      description: "Completed events and archived results.",
      items: categorized.past,
      empty: "Finish a tournament to see it listed here.",
    },
    {
      key: "live",
      label: "Live Tournaments",
      description: "Active events running right now.",
      items: categorized.live,
      empty: "Start a tournament to move it into the live section.",
    },
    {
      key: "upcoming",
      label: "Upcoming Tournaments",
      description: "Events scheduled and ready to start soon.",
      items: categorized.upcoming,
      empty: "Open a draft tournament and mark it as upcoming from the management view.",
    },
    {
      key: "drafts",
      label: "Tournament Drafts",
      description: "Keep refining your tournament setup before launch.",
      items: categorized.drafts,
      empty: "Create a new tournament or continue editing your drafts.",
      cta: (
        <Link href="/tournaments/new">
          <Button className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create Tournament
          </Button>
        </Link>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-primary"></div>
          <p className="mt-4 text-gray-600">Loading your tournaments...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent">
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-md shadow">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 text-center md:text-left py-6">
            <div className="space-y-1">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Tournament Director</h1>
              <p className="text-gray-600 dark:text-gray-300">
                Welcome back, {user?.firstName} {user?.lastName}
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center md:justify-end gap-3 w-full md:w-auto">
              <div className="flex items-center justify-center gap-2 sm:gap-4 pb-1 sm:pb-0">
                <NotificationBell />
                <SettingsMenu />
              </div>
              <Link href="/tournaments/new">
                <Button className="flex items-center gap-2 whitespace-nowrap">
                  <Plus className="h-4 w-4" />
                  Host New Tournament
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">

        <Tabs value={activeTab} onValueChange={(tab) => setLocation(`/dashboard/${tab}`)} className="w-full">
          <TabsList className="flex w-full min-h-[64px] flex-nowrap overflow-x-auto no-scrollbar items-center gap-3 bg-transparent mb-6">
            {sections.map((section) => (
              <TabsTrigger
                key={section.key}
                value={section.key}
                className="flex-none md:flex-1 flex h-full min-w-[140px] flex-col items-center justify-center gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center text-sm font-medium text-slate-600 shadow-sm transition whitespace-nowrap data-[state=active]:border-indigo-200 data-[state=active]:bg-indigo-50 data-[state=active]:text-indigo-900"
              >
                <span className="leading-tight">{section.label}</span>
                <span className="text-xs text-slate-500 leading-tight">{section.items.length} tournament{section.items.length === 1 ? "" : "s"}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {sections.map((section) => (
            <TabsContent key={section.key} value={section.key} className="mt-10 space-y-8">
              <Card>
                <CardHeader>
                  <CardTitle>{section.label}</CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  {renderSection(section.items, section.empty, section.cta)}
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
