import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Trophy, Users, Calendar } from "lucide-react";
import SwissStandings from "@/components/swiss-standings";
import SwissPairings from "@/components/swiss-pairings";
import RoundRobinCrosstable from "@/components/round-robin-crosstable";
import PairingPredictor from "@/components/pairing-predictor";
import type { Tournament } from "@shared/schema";

interface TournamentViewProps {
  tournamentId: number;
}

export default function TournamentView({ tournamentId }: TournamentViewProps) {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("info");

  // Fetch tournament details
  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  if (tournamentLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading tournament...</p>
        </div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-96">
          <CardContent className="pt-6 text-center">
            <Trophy className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Tournament Not Found</h3>
            <p className="text-gray-600 mb-4">The tournament you're looking for doesn't exist.</p>
            <Button onClick={() => setLocation("/")}>
              Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header with Back Button */}
      <div className="bg-white dark:bg-gray-800 shadow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between py-6">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => setLocation("/")}
                className="flex items-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Dashboard
              </Button>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {tournament.name}
                </h1>
                <p className="text-gray-600 dark:text-gray-300">
                  {tournament.format.toUpperCase()} • {tournament.rounds} rounds
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Badge variant={tournament.status === 'active' ? 'default' : tournament.status === 'completed' ? 'secondary' : 'outline'}>
                {tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      {/* Tournament Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="standings">Standings</TabsTrigger>
            <TabsTrigger value="pairings">Pairings</TabsTrigger>
            <TabsTrigger value="predictor">Predictor</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Trophy className="h-5 w-5" />
                  <span>Tournament Information</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <div className="space-y-2">
                    <h4 className="font-medium text-gray-900">Tournament Name</h4>
                    <p className="text-gray-600">{tournament.name}</p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium text-gray-900">Format</h4>
                    <p className="text-gray-600 capitalize">{tournament.format}</p>
                  </div>
                  <div className="space-y-2">
                    <h4 className="font-medium text-gray-900">Status</h4>
                    <Badge variant={tournament.status === 'active' ? 'default' : tournament.status === 'completed' ? 'secondary' : 'outline'}>
                      {tournament.status.charAt(0).toUpperCase() + tournament.status.slice(1)}
                    </Badge>
                  </div>
                  {tournament.rounds && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-900">Total Rounds</h4>
                      <p className="text-gray-600">{tournament.rounds}</p>
                    </div>
                  )}
                  <div className="space-y-2">
                    <h4 className="font-medium text-gray-900">Current Round</h4>
                    <p className="text-gray-600">{tournament.currentRound || 0}</p>
                  </div>
                  {tournament.format === 'roundrobin' && tournament.isDoubleRoundRobin && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-900">Format Type</h4>
                      <p className="text-gray-600">Double Round Robin</p>
                    </div>
                  )}
                  
                  {/* Tournament Details */}
                  {(tournament.location || tournament.directorPhone || tournament.directorEmail) && (
                    <div className="col-span-full">
                      <h3 className="text-lg font-semibold text-gray-900 mb-4 border-b pb-2">
                        Tournament Details
                      </h3>
                    </div>
                  )}
                  
                  {tournament.location && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-900">Location</h4>
                      <p className="text-gray-600">{tournament.location}</p>
                    </div>
                  )}
                  
                  {tournament.directorPhone && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-900">Director Phone</h4>
                      <p className="text-gray-600">{tournament.directorPhone}</p>
                    </div>
                  )}
                  
                  {tournament.directorEmail && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-gray-900">Director Email</h4>
                      <p className="text-gray-600">{tournament.directorEmail}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="standings" className="mt-6">
            {tournament.format === 'roundrobin' ? (
              <RoundRobinCrosstable tournamentId={tournamentId} />
            ) : tournament.format === 'swiss' ? (
              <SwissStandings tournamentId={tournamentId} />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Trophy className="h-5 w-5" />
                    <span>Tournament Standings</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-600">Standings for this tournament format coming soon.</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="pairings" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Users className="h-5 w-5" />
                  <span>Current Pairings</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SwissPairings tournamentId={tournamentId} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="predictor" className="mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Calendar className="h-5 w-5" />
                  <span>Pairing Predictor</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <PairingPredictor tournamentId={tournamentId} tournament={tournament} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}