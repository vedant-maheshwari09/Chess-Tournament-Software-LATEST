import { useState } from "react";
import { useQuery, useMutation, queryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Player, InsertPlayer } from "@shared/schema";

interface PlayerRegistrationProps {
  tournamentId: number;
}

export default function PlayerRegistration({ tournamentId }: PlayerRegistrationProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [rating, setRating] = useState("");
  const [federation, setFederation] = useState("USCF");
  const { toast } = useToast();

  const { data: players, isLoading } = useQuery<Player[]>({
    queryKey: ["/api/tournaments", tournamentId, "players"],
  });

  const addPlayerMutation = useMutation({
    mutationFn: async (playerData: InsertPlayer) => {
      const response = await apiRequest("POST", `/api/tournaments/${tournamentId}/players`, playerData);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Player Added",
        description: "Player has been successfully registered.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "players"] });
      setFirstName("");
      setLastName("");
      setRating("");
      setFederation("USCF");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add player. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deletePlayerMutation = useMutation({
    mutationFn: async (playerId: number) => {
      await apiRequest("DELETE", `/api/players/${playerId}`);
    },
    onSuccess: () => {
      toast({
        title: "Player Removed",
        description: "Player has been successfully removed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/tournaments", tournamentId, "players"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove player. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      toast({
        title: "Error",
        description: "First name and last name are required.",
        variant: "destructive",
      });
      return;
    }

    const playerData: InsertPlayer = {
      tournamentId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      rating: rating ? parseInt(rating) : 1000,
      federation,
    };

    addPlayerMutation.mutate(playerData);
  };

  const handleDeletePlayer = (playerId: number) => {
    deletePlayerMutation.mutate(playerId);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <Card>
        <CardHeader>
          <CardTitle>Player Registration</CardTitle>
          <p className="text-sm text-gray-600">Add players to the tournament</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="John"
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Doe"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="rating">Rating</Label>
                <Input
                  id="rating"
                  type="number"
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                  placeholder="1800"
                />
              </div>
              <div>
                <Label htmlFor="federation">Federation</Label>
                <Select value={federation} onValueChange={setFederation}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USCF">USCF</SelectItem>
                    <SelectItem value="FIDE">FIDE</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={addPlayerMutation.isPending}>
              <Plus className="h-4 w-4 mr-2" />
              {addPlayerMutation.isPending ? "Adding..." : "Add Player"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Registered Players</CardTitle>
            <p className="text-sm text-gray-600">
              {players?.length || 0} players registered
            </p>
          </div>
          <Button variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-1" />
            Import CSV
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-16 bg-gray-200 rounded-lg"></div>
                </div>
              ))}
            </div>
          ) : !players || players.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">No players registered yet</p>
            </div>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {players.map((player) => (
                <div key={player.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center mr-3">
                      <span className="text-primary font-medium text-sm">{player.seed}</span>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900">
                        {player.firstName} {player.lastName}
                      </div>
                      <div className="text-sm text-gray-600">Rating: {player.rating}</div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeletePlayer(player.id)}
                    className="text-red-600 hover:text-red-800"
                    disabled={deletePlayerMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
