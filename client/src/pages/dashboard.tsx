import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trophy, Users, Calendar, Plus, Settings } from "lucide-react";
import type { Tournament } from "@shared/schema";

export default function Dashboard() {
  const [location] = useLocation();
  const { data: tournaments, isLoading } = useQuery<Tournament[]>({
    queryKey: ["/api/tournaments"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center">
                <Trophy className="h-8 w-8 text-primary mr-3" />
                <h1 className="text-xl font-bold text-gray-900">ChessTournament Pro</h1>
              </div>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse">
            <div className="h-32 bg-gray-200 rounded-lg mb-6"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-48 bg-gray-200 rounded-lg"></div>
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Trophy className="h-8 w-8 text-primary mr-3" />
              <h1 className="text-xl font-bold text-gray-900">ChessTournament Pro</h1>
            </div>
            <nav className="hidden md:flex space-x-8">
              <Link href="/" className={location === "/" ? "text-primary font-medium" : "text-gray-600 hover:text-gray-900"}>Dashboard</Link>
              <Link href="/tournaments" className={location === "/tournaments" ? "text-primary font-medium" : "text-gray-600 hover:text-gray-900"}>Tournaments</Link>
              <Link href="/players" className={location === "/players" ? "text-primary font-medium" : "text-gray-600 hover:text-gray-900"}>Players</Link>
              <Link href="/settings" className={location === "/settings" ? "text-primary font-medium" : "text-gray-600 hover:text-gray-900"}>Settings</Link>
            </nav>
            <Link href="/tournaments/new">
              <Button className="bg-primary hover:bg-primary/90">
                <Plus className="h-4 w-4 mr-2" />
                New Tournament
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          {location === "/" && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Tournament Dashboard</h2>
              <p className="text-gray-600">Manage and track your chess tournaments</p>
            </>
          )}
          {location === "/tournaments" && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">All Tournaments</h2>
              <p className="text-gray-600">View and manage all your chess tournaments</p>
            </>
          )}
          {location === "/players" && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Player Management</h2>
              <p className="text-gray-600">Manage players across all tournaments</p>
            </>
          )}
          {location === "/settings" && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Settings</h2>
              <p className="text-gray-600">Configure your tournament management preferences</p>
            </>
          )}
        </div>

        {location === "/players" ? (
          <Card className="text-center py-12">
            <CardContent>
              <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Player Management</h3>
              <p className="text-gray-600 mb-6">View and manage all players across your tournaments</p>
              <Button variant="outline" disabled>
                Coming Soon - Player Database
              </Button>
            </CardContent>
          </Card>
        ) : location === "/settings" ? (
          <Card className="text-center py-12">
            <CardContent>
              <Settings className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">Settings</h3>
              <p className="text-gray-600 mb-6">Configure tournament defaults and application preferences</p>
              <Button variant="outline" disabled>
                Coming Soon - Settings Panel
              </Button>
            </CardContent>
          </Card>
        ) : (!tournaments || tournaments.length === 0) ? (
          <Card className="text-center py-12">
            <CardContent>
              <Trophy className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No tournaments yet</h3>
              <p className="text-gray-600 mb-6">Create your first tournament to get started</p>
              <Link href="/tournaments/new">
                <Button className="bg-primary hover:bg-primary/90">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Tournament
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tournaments.map((tournament) => (
              <Card key={tournament.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">{tournament.name}</CardTitle>
                    <Badge variant={tournament.status === 'active' ? 'default' : 'secondary'}>
                      {tournament.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center text-sm text-gray-600">
                      <Calendar className="h-4 w-4 mr-2" />
                      {tournament.format.charAt(0).toUpperCase() + tournament.format.slice(1)} Format
                    </div>
                    {tournament.rounds && (
                      <div className="flex items-center text-sm text-gray-600">
                        <Users className="h-4 w-4 mr-2" />
                        Round {tournament.currentRound} of {tournament.rounds}
                      </div>
                    )}
                    <div className="pt-4">
                      <Link href={`/tournaments/${tournament.id}`}>
                        <Button variant="outline" className="w-full">
                          View Tournament
                        </Button>
                      </Link>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
