import { useState } from "react";
import { useMutation, queryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shuffle, RotateCcw, Target, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Tournament, InsertTournament } from "@shared/schema";

interface TournamentWizardProps {
  tournament?: Tournament | null;
  onTournamentCreated: (tournament: Tournament) => void;
}

export default function TournamentWizard({ tournament, onTournamentCreated }: TournamentWizardProps) {
  const [name, setName] = useState(tournament?.name || "");
  const [format, setFormat] = useState<'swiss' | 'roundrobin' | 'knockout'>(tournament?.format as any || 'swiss');
  const [rounds, setRounds] = useState(tournament?.rounds || 5);
  const [timeControl, setTimeControl] = useState(tournament?.timeControl || "90 min + 30 sec increment");
  const [isDoubleRoundRobin, setIsDoubleRoundRobin] = useState(tournament?.isDoubleRoundRobin || false);
  const { toast } = useToast();

  const createTournamentMutation = useMutation({
    mutationFn: async (tournamentData: InsertTournament) => {
      const response = await apiRequest("POST", "/api/tournaments", tournamentData);
      return response.json();
    },
    onSuccess: (newTournament) => {
      toast({
        title: "Tournament Created",
        description: "Your tournament has been successfully created.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments"] });
      onTournamentCreated(newTournament);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create tournament. Please try again.",
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

    const tournamentData: InsertTournament = {
      name: name.trim(),
      format,
      status: 'draft',
      rounds: format === 'swiss' ? rounds : undefined,
      timeControl,
      currentRound: 0,
      isDoubleRoundRobin: format === 'roundrobin' ? isDoubleRoundRobin : false,
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
                      {[5, 6, 7, 8, 9, 10].map((num) => (
                        <SelectItem key={num} value={num.toString()}>{num} rounds</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="timeControl">Time Control</Label>
                  <Select value={timeControl} onValueChange={setTimeControl}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="90 min + 30 sec increment">90 min + 30 sec increment</SelectItem>
                      <SelectItem value="60 min + 15 sec increment">60 min + 15 sec increment</SelectItem>
                      <SelectItem value="30 min + 10 sec increment">30 min + 10 sec increment</SelectItem>
                      <SelectItem value="15 min + 5 sec increment">15 min + 5 sec increment</SelectItem>
                    </SelectContent>
                  </Select>
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
