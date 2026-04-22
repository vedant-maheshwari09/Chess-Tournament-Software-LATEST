import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shuffle, RotateCcw, Target, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Tournament, InsertTournament } from "@shared/schema";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { parseISO, format as formatDate } from "date-fns";

interface TournamentWizardProps {
  tournament?: Tournament | null;
  onTournamentCreated: (tournament: Tournament) => void;
}

export default function TournamentWizard({ tournament, onTournamentCreated }: TournamentWizardProps) {
  const [, setLocation] = useLocation();
  const [name, setName] = useState(tournament?.name || "");
  const [format, setFormat] = useState<'swiss' | 'roundrobin' | 'knockout'>(tournament?.format as any || 'swiss');
  const [rounds, setRounds] = useState(tournament?.rounds || 5);
  const [tiebreakOrder, setTiebreakOrder] = useState(tournament?.tiebreakOrder || 'rating');

  const [isDoubleRoundRobin, setIsDoubleRoundRobin] = useState(tournament?.isDoubleRoundRobin || false);
  const [tournamentMode, setTournamentMode] = useState<'casual' | 'official'>('casual');
  const [playerCount, setPlayerCount] = useState(tournament?.playerCount || 8);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [skipAutoGeneration, setSkipAutoGeneration] = useState(false);
  
  // Tournament details
  const [location, setLocationField] = useState(tournament?.location || "");
  const [directorPhone, setDirectorPhone] = useState(tournament?.directorPhone || "");
  const [directorEmail, setDirectorEmail] = useState(tournament?.directorEmail || "");
  const [roundTimings, setRoundTimings] = useState<Array<{round: number, date: string, time: string}>>(
    tournament?.roundTimings as any || []
  );
  const [showDetailsSection, setShowDetailsSection] = useState(false);
  const { toast } = useToast();

  // Initialize round timings when rounds change
  useEffect(() => {
    if (roundTimings.length === 0 && rounds > 0) {
      const initialTimings = Array.from({ length: rounds }, (_, i) => ({
        round: i + 1,
        date: '',
        time: ''
      }));
      setRoundTimings(initialTimings);
    } else if (roundTimings.length !== rounds) {
      const newTimings = Array.from({ length: rounds }, (_, i) => ({
        round: i + 1,
        date: roundTimings[i]?.date || '',
        time: roundTimings[i]?.time || ''
      }));
      setRoundTimings(newTimings);
    }
  }, [rounds]);

  const updateRoundTiming = (roundIndex: number, field: 'date' | 'time', value: string) => {
    setRoundTimings(prev => prev.map((timing, index) => 
      index === roundIndex ? { ...timing, [field]: value } : timing
    ));
  };

  const createTournamentMutation = useMutation({
    mutationFn: async (tournamentData: InsertTournament) => {
      try {
        console.log('Creating tournament with data:', tournamentData);
        const tournament = await apiRequest("/api/tournaments", {
          method: "POST",
          body: JSON.stringify(tournamentData),
        });
        
        console.log('Tournament created successfully:', tournament);
        
        // If using casual mode and not skipping auto-generation, automatically create players
        if (tournamentData.useQuickSetup && tournamentData.playerCount && !skipAutoGeneration) {
          console.log('Auto-generating players...');
          const playerPromises = [];
          for (let i = 1; i <= tournamentData.playerCount; i++) {
            playerPromises.push(
              apiRequest(`/api/tournaments/${tournament.id}/players`, {
                method: "POST",
                body: JSON.stringify({
                  firstName: `Player`,
                  lastName: `${i}`,
                  rating: 1000,
                  federation: "USCF",
                }),
              })
            );
          }
          await Promise.all(playerPromises);
          console.log('Players auto-generated successfully');
        }
        
        return tournament;
      } catch (error) {
        console.error('Tournament creation error:', error);
        throw error;
      }
    },
    onSuccess: (newTournament) => {
      toast({
        title: "Tournament Created",
        description: tournamentMode === 'casual'
          ? `Tournament created with ${playerCount} players automatically added.`
          : "Your tournament has been successfully created.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments"] });
      onTournamentCreated(newTournament);
      
      // Redirect to tournament management page
      setLocation(`/tournaments/${newTournament.id}/manage`);
    },
    onError: (error: any) => {
      console.error('Tournament creation error:', error);
      let errorMessage = "Failed to create tournament. Please try again.";
      
      if (error.message.includes('tournament_director role required')) {
        errorMessage = "Only tournament directors can create tournaments. Please log in with a tournament director account or create a new account with tournament director role.";
      } else if (error.message.includes('403')) {
        errorMessage = "You don't have permission to create tournaments. Please log in as a tournament director.";
      }
      
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast({
        title: "Error",
        description: "Tournament name is required.",
        variant: "destructive",
      });
      return;
    }

    // Check for missing optional details
    const missingDetails = [];
    if (!location.trim()) missingDetails.push("tournament location");
    if (!directorPhone.trim()) missingDetails.push("director phone number");
    if (!directorEmail.trim()) missingDetails.push("director email");
    
    const hasRoundTimings = roundTimings.some(timing => timing.date || timing.time);
    if (!hasRoundTimings) missingDetails.push("round scheduling");

    // Show confirmation if missing details
    if (missingDetails.length > 0) {
      const message = `Are you sure you don't want to add: ${missingDetails.join(", ")}?`;
      if (!window.confirm(message)) {
        return;
      }
    }

    const tournamentData: InsertTournament = {
      name: name.trim(),
      format,
      status: 'draft',
      rounds: format === 'swiss' ? rounds : undefined,
      currentRound: 0,
      isDoubleRoundRobin: format === 'roundrobin' ? isDoubleRoundRobin : false,
      tiebreakOrder: format === 'swiss' ? tiebreakOrder : undefined,
      useQuickSetup: tournamentMode === 'casual' && !skipAutoGeneration,
      playerCount: (tournamentMode === 'casual' && !skipAutoGeneration) ? playerCount : undefined,
      location: location.trim() || undefined,
      directorPhone: directorPhone.trim() || undefined,
      directorEmail: directorEmail.trim() || undefined,
      roundTimings: hasRoundTimings ? roundTimings : undefined,
    };

    createTournamentMutation.mutate(tournamentData);
  };

  const formatCards = [
    {
      id: 'swiss',
      title: 'Swiss System',
      icon: Shuffle,
      description: 'Players are paired based on points and rating. Ideal for tournaments with many players and limited time.',
      features: ['Set number of rounds', 'Smart pairing algorithm', 'No elimination']
    },
    {
      id: 'roundrobin',
      title: 'Round Robin',
      icon: RotateCcw,
      description: 'Every player plays against every other player. Best for smaller groups where fairness is paramount.',
      features: ['Everyone plays everyone', 'Single or double round', 'Complete results']
    },
    {
      id: 'knockout',
      title: 'Knockout',
      icon: Target,
      description: 'Single elimination tournament with brackets. Fast-paced with clear progression to finals.',
      features: ['Elimination brackets', 'Seeding options', 'Automatic byes']
    }
  ];

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Create New Tournament</CardTitle>
        <p className="text-sm text-gray-600">Set up your chess tournament with the format that best suits your needs</p>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <Label htmlFor="name">Tournament Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter tournament name"
              className="mt-1"
            />
          </div>

          <div>
            <Label className="text-sm font-medium text-gray-700 mb-4 block">Select Tournament Format</Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {formatCards.map((card) => {
                const Icon = card.icon;
                const isSelected = format === card.id;
                
                return (
                  <div
                    key={card.id}
                    className={`relative border-2 rounded-lg p-6 cursor-pointer transition-colors ${
                      isSelected 
                        ? 'border-primary bg-primary/5' 
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                    onClick={() => setFormat(card.id as any)}
                  >
                    {isSelected && (
                      <div className="absolute top-4 right-4">
                        <div className="w-4 h-4 bg-primary rounded-full flex items-center justify-center">
                          <Check className="h-3 w-3 text-white" />
                        </div>
                      </div>
                    )}
                    <div className="mb-3">
                      <Icon className={`h-6 w-6 mb-2 ${isSelected ? 'text-primary' : 'text-gray-600'}`} />
                      <h3 className="text-lg font-semibold text-gray-900">{card.title}</h3>
                    </div>
                    <p className="text-sm text-gray-600 mb-3">{card.description}</p>
                    <div className={`text-xs ${isSelected ? 'text-primary' : 'text-gray-600'}`}>
                      {card.features.map((feature, index) => (
                        <div key={index}>• {feature}</div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {format === 'swiss' && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 mb-3">Swiss System Configuration</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rounds">Number of Rounds</Label>
                  <Select value={rounds.toString()} onValueChange={(value) => setRounds(parseInt(value))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 18 }, (_, i) => i + 3).map((num) => (
                        <SelectItem key={num} value={num.toString()}>{num} rounds</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="tiebreakOrder">Tiebreaker System</Label>
                  <Select value={tiebreakOrder} onValueChange={(value) => setTiebreakOrder(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rating">Rating-based (Points, then Rating)</SelectItem>
                      <SelectItem value="uscf">USCF System (Modified Median, Solkoff, Cumulative)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-500 mt-1">
                    {tiebreakOrder === 'rating' 
                      ? 'Simple system: ties broken by player rating'
                      : 'USCF-standard: Modified Median → Solkoff → Cumulative scores'
                    }
                  </p>
                </div>
              </div>
            </div>
          )}

          {format === 'roundrobin' && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="font-medium text-gray-900 mb-3">Round Robin Configuration</h4>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="doubleRoundRobin"
                  checked={isDoubleRoundRobin}
                  onChange={(e) => setIsDoubleRoundRobin(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <Label htmlFor="doubleRoundRobin">Double Round Robin (each player plays every other player twice)</Label>
              </div>
            </div>
          )}

          <div className="bg-blue-50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">Tournament Mode</h4>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div 
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    tournamentMode === 'casual' 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                  onClick={() => setTournamentMode('casual')}
                >
                  <div className="flex items-center space-x-2 mb-2">
                    <input
                      type="radio"
                      id="casual"
                      name="tournamentMode"
                      checked={tournamentMode === 'casual'}
                      onChange={() => setTournamentMode('casual')}
                      className="text-blue-600"
                    />
                    <Label htmlFor="casual" className="font-medium">Casual Mode</Label>
                  </div>
                  <p className="text-sm text-gray-600">
                    Quick setup - just specify number of players. Players will be auto-generated as "Player 1", "Player 2", etc.
                  </p>
                </div>
                
                <div 
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    tournamentMode === 'official' 
                      ? 'border-blue-500 bg-blue-50' 
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                  onClick={() => setTournamentMode('official')}
                >
                  <div className="flex items-center space-x-2 mb-2">
                    <input
                      type="radio"
                      id="official"
                      name="tournamentMode"
                      checked={tournamentMode === 'official'}
                      onChange={() => setTournamentMode('official')}
                      className="text-blue-600"
                    />
                    <Label htmlFor="official" className="font-medium">Standard Mode</Label>
                  </div>
                  <p className="text-sm text-gray-600">
                    Full player registration with real names, ratings, and federation details for official tournaments.
                  </p>
                </div>
              </div>
              
              {tournamentMode === 'casual' && (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="playerCount">Number of Players</Label>
                    <Select value={playerCount.toString()} onValueChange={(value) => setPlayerCount(parseInt(value))}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 15 }, (_, i) => i + 4).map((num) => (
                          <SelectItem key={num} value={num.toString()}>{num} players</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-sm text-gray-600 mt-1">
                      Players will be automatically created as "Player 1", "Player 2", etc. with default 1000 rating.
                    </p>
                  </div>
                  
                  <div className="border-t pt-4">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center space-x-1"
                    >
                      <span>{showAdvancedOptions ? 'Hide' : 'Show'} Advanced Options</span>
                      <span className={`transform transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`}>
                        ▼
                      </span>
                    </button>
                    
                    {showAdvancedOptions && (
                      <div className="mt-3 p-4 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-700 mb-2">
                          <strong>Advanced Setup:</strong> Skip auto-generation and manually add players with custom names, ratings, and details after creating the tournament.
                        </p>
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id="skipAutoGeneration"
                            checked={skipAutoGeneration}
                            onChange={(e) => setSkipAutoGeneration(e.target.checked)}
                            className="rounded border-gray-300"
                          />
                          <Label htmlFor="skipAutoGeneration" className="text-sm">
                            Skip auto-generation and add players manually
                          </Label>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {tournamentMode === 'official' && (
                <p className="text-sm text-gray-600">
                  You'll be able to add players manually with full details (names, ratings, federation info) after creating the tournament.
                </p>
              )}
            </div>
          </div>

          {/* Tournament Details Section */}
          <div className="border-t pt-6">
            <button
              type="button"
              onClick={() => setShowDetailsSection(!showDetailsSection)}
              className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center space-x-1"
            >
              <span>{showDetailsSection ? 'Hide' : 'Show'} Tournament Details (Optional)</span>
              <span className={`transform transition-transform ${showDetailsSection ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </button>
            
            {showDetailsSection && (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="location">Tournament Location</Label>
                    <Input
                      id="location"
                      value={location}
                      onChange={(e) => setLocationField(e.target.value)}
                      placeholder="e.g., Community Center, Room 101"
                    />
                  </div>
                  <div>
                    <Label htmlFor="directorPhone">Director Phone</Label>
                    <Input
                      id="directorPhone"
                      value={directorPhone}
                      onChange={(e) => setDirectorPhone(e.target.value)}
                      placeholder="e.g., (555) 123-4567"
                    />
                  </div>
                </div>
                
                <div>
                  <Label htmlFor="directorEmail">Director Email</Label>
                  <Input
                    id="directorEmail"
                    type="email"
                    value={directorEmail}
                    onChange={(e) => setDirectorEmail(e.target.value)}
                    placeholder="e.g., director@example.com"
                  />
                </div>

                <div>
                  <Label>Round Schedule</Label>
                  <p className="text-sm text-gray-600 mb-3">
                    Set dates and times for each round (all optional)
                  </p>
                  <div className="space-y-2">
                    {roundTimings.map((timing, index) => (
                      <div key={index} className="flex items-center space-x-3 bg-white p-3 rounded-xl border border-slate-100 shadow-sm transition-all hover:bg-slate-50/50">
                        <span className="text-sm font-semibold w-20 text-slate-600">Round {timing.round}</span>
                        <div className="flex-1">
                          <DatePicker
                             date={timing.date ? parseISO(timing.date) : null}
                             setDate={(newDate) => updateRoundTiming(index, 'date', newDate ? formatDate(newDate, "yyyy-MM-dd") : "")}
                             placeholder="Select date"
                             className="h-10 border-slate-200"
                          />
                        </div>
                        <div className="flex-1">
                          <TimePicker
                            time={timing.time}
                            setTime={(newTime) => updateRoundTiming(index, 'time', newTime)}
                            placeholder="Select time"
                            className="h-10 border-slate-200"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-3">
            <Button type="submit" disabled={createTournamentMutation.isPending}>
              {createTournamentMutation.isPending ? "Creating..." : "Create Tournament"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
