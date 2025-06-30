import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Upload, Edit, UserX, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Player, InsertPlayer } from "@shared/schema";

interface PlayerRegistrationProps {
  tournamentId: number;
}

export default function PlayerRegistration({ tournamentId }: PlayerRegistrationProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [rating, setRating] = useState("");
  const [federation, setFederation] = useState("USCF");
  const [byeConfiguration, setByeConfiguration] = useState<string>("");
  
  // Player editing state
  const [editingPlayer, setEditingPlayer] = useState<Player | null>(null);
  const [playerStatus, setPlayerStatus] = useState<"active" | "withdrawn">("active");
  const [upcomingByeRounds, setUpcomingByeRounds] = useState<string>("");
  const [upcomingByeType, setUpcomingByeType] = useState<"half_point" | "zero_point">("half_point");
  const [existingByes, setExistingByes] = useState<Array<{round: number, type: string, id: number}>>([]);
  
  const { toast } = useToast();

  const { data: players, isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  // Fetch tournament info to get number of rounds for bye selection
  const { data: tournament } = useQuery({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  // Fetch pairings to show bye status indicators
  const { data: allPairings } = useQuery<any[]>({
    queryKey: [`/api/tournaments/${tournamentId}/pairings`],
  });

  // Helper function to get player bye status
  const getPlayerByeStatus = (playerId: number) => {
    if (!allPairings || !Array.isArray(allPairings)) return { status: 'active', byes: [] };
    
    const playerByes = allPairings.filter((pairing: any) => 
      pairing.playerId === playerId && pairing.isBye
    );
    
    const withdrawnByes = playerByes.filter((bye: any) => bye.byeType === 'zero_point');
    const requestedByes = playerByes.filter((bye: any) => bye.byeType === 'half_point');
    
    if (withdrawnByes.length > 0) {
      return { status: 'withdrawn', byes: playerByes };
    } else if (requestedByes.length > 0) {
      return { status: 'has_byes', byes: requestedByes };
    }
    
    return { status: 'active', byes: [] };
  };

  const addPlayerMutation = useMutation({
    mutationFn: async (playerData: InsertPlayer & { byeConfiguration?: Array<{round: number, type: string}> }) => {
      return await apiRequest(`/api/tournaments/${tournamentId}/players`, {
        method: "POST",
        body: JSON.stringify(playerData),
      });
    },
    onSuccess: () => {
      toast({
        title: "Player Added",
        description: "Player has been successfully registered.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setFirstName("");
      setLastName("");
      setRating("");
      setFederation("USCF");
      setByeConfiguration("");
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
      return await apiRequest(`/api/players/${playerId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      toast({
        title: "Player Removed",
        description: "Player has been successfully removed.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove player. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updatePlayerStatusMutation = useMutation({
    mutationFn: async ({ playerId, status, byeRounds }: { 
      playerId: number; 
      status: string; 
      byeRounds?: Array<{round: number, type: string}> 
    }) => {
      return await apiRequest(`/api/players/${playerId}/status`, {
        method: "PUT",
        body: JSON.stringify({ status, byeRounds }),
      });
    },
    onSuccess: () => {
      toast({
        title: "Player Status Updated",
        description: "Player status has been successfully updated.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      setEditingPlayer(null);
      setUpcomingByeRounds("");
      setPlayerStatus("active");
      setExistingByes([]);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update player status.",
        variant: "destructive",
      });
    },
  });

  const removePairingMutation = useMutation({
    mutationFn: async (pairingId: number) => {
      return await apiRequest(`/api/pairings/${pairingId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      toast({
        title: "Bye Removed",
        description: "Bye request has been successfully removed.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/pairings`] });
      // Refresh the dialog data
      if (editingPlayer) {
        handleEditPlayer(editingPlayer);
      }
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove bye request.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim()) {
      toast({
        title: "Error",
        description: "First name is required.",
        variant: "destructive",
      });
      return;
    }

    // Parse bye configuration (e.g., "1:half,4:zero" for round 1 half-point bye and round 4 zero-point bye)
    const parseByeConfiguration = (text: string): Array<{round: number, type: string}> => {
      if (!text.trim()) return [];
      try {
        return text.split(',').map(entry => {
          const [round, type] = entry.trim().split(':');
          const roundNum = parseInt(round);
          const byeType = type === 'half' ? 'half_point' : type === 'zero' ? 'zero_point' : 'half_point';
          return { round: roundNum, type: byeType };
        }).filter(entry => !isNaN(entry.round) && entry.round > 0);
      } catch {
        return [];
      }
    };

    const playerData: InsertPlayer & { byeConfiguration?: Array<{round: number, type: string}> } = {
      tournamentId,
      firstName: firstName.trim(),
      lastName: lastName.trim() || "",
      rating: rating ? parseInt(rating) : undefined,
      federation: federation || "USCF",
      byeConfiguration: byeConfiguration ? parseByeConfiguration(byeConfiguration) : undefined,
    };

    addPlayerMutation.mutate(playerData);
  };

  const handleDeletePlayer = (playerId: number) => {
    deletePlayerMutation.mutate(playerId);
  };

  const handleEditPlayer = async (player: Player) => {
    setEditingPlayer(player);
    
    // Load player's existing byes and determine status
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/pairings`);
      const pairings = await response.json();
      
      const playerByes = pairings.filter((pairing: any) => 
        pairing.playerId === player.id && pairing.isBye
      );
      
      // Separate withdrawal byes from requested byes
      const withdrawnByes = playerByes.filter((bye: any) => bye.byeType === 'zero_point');
      const requestedByes = playerByes.filter((bye: any) => bye.byeType === 'half_point');
      
      // Set player status
      if (withdrawnByes.length > 0) {
        setPlayerStatus("withdrawn");
      } else {
        setPlayerStatus("active");
      }
      
      // Load existing bye requests (excluding withdrawal byes)
      const existingByeData = requestedByes.map((bye: any) => ({
        round: bye.round,
        type: bye.byeType,
        id: bye.id
      }));
      setExistingByes(existingByeData);
      
    } catch {
      setPlayerStatus("active");
      setExistingByes([]);
    }
    
    setUpcomingByeRounds("");
  };

  const handleSavePlayerStatus = () => {
    if (!editingPlayer) return;

    let byeRounds: Array<{round: number, type: string}> | undefined;
    
    if (upcomingByeRounds.trim()) {
      try {
        byeRounds = upcomingByeRounds.split(',').map(round => ({
          round: parseInt(round.trim()),
          type: upcomingByeType
        })).filter(entry => !isNaN(entry.round) && entry.round > 0);
      } catch {
        toast({
          title: "Error",
          description: "Invalid bye rounds format. Use comma-separated numbers.",
          variant: "destructive",
        });
        return;
      }
    }

    updatePlayerStatusMutation.mutate({
      playerId: editingPlayer.id,
      status: playerStatus,
      byeRounds
    });
  };

  // Check if a player is withdrawn (has zero-point byes)
  const isPlayerWithdrawn = async (playerId: number): Promise<boolean> => {
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/pairings`);
      const pairings = await response.json();
      
      return pairings.some((pairing: any) => 
        pairing.playerId === playerId && 
        pairing.isBye && 
        pairing.byeType === 'zero_point'
      );
    } catch {
      return false;
    }
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
            
            {/* Bye Assignment Section */}
            <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
              <Label className="text-sm font-medium text-gray-700">Bye Assignment (for late-joining players)</Label>
              <div>
                <Label htmlFor="byeConfiguration">Bye Configuration</Label>
                <Input
                  id="byeConfiguration"
                  type="text"
                  value={byeConfiguration}
                  onChange={(e) => setByeConfiguration(e.target.value)}
                  placeholder="1:half,4:zero"
                />
                <div className="text-xs text-gray-500 mt-1 space-y-1">
                  <p>Format: round:type,round:type</p>
                  <p>Examples:</p>
                  <p>• "1:half" = Round 1 gets 1/2 point bye</p>
                  <p>• "4:zero" = Round 4 gets 0 point bye</p>
                  <p>• "1:half,4:zero" = Round 1 gets 1/2 point, Round 4 gets 0 points</p>
                </div>
              </div>
              {byeConfiguration && (
                <div className="text-sm text-blue-600">
                  <p className="font-medium">Bye Configuration Preview:</p>
                  {byeConfiguration.split(',').map((entry, index) => {
                    const [round, type] = entry.trim().split(':');
                    const points = type === 'half' ? '0.5' : '0';
                    return (
                      <p key={index}>• Round {round}: {points} points</p>
                    );
                  })}
                </div>
              )}
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
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Loading players...</div>
          ) : players && players.length > 0 ? (
            <div className="space-y-2">
              {players.map((player) => {
                const byeStatus = getPlayerByeStatus(player.id);
                return (
                  <div
                    key={player.id}
                    className="flex items-center justify-between p-3 bg-white border rounded-lg hover:shadow-sm transition-shadow"
                  >
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-medium">
                          {player.firstName} {player.lastName}
                        </span>
                        <span className="text-sm text-gray-500">
                          ({player.rating || "Unrated"} - {player.federation})
                        </span>
                        
                        {/* Status Indicators */}
                        {byeStatus.status === 'withdrawn' && (
                          <Badge variant="destructive" className="text-xs">
                            Withdrawn
                          </Badge>
                        )}
                        {byeStatus.status === 'has_byes' && (
                          <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-800">
                            Bye R{byeStatus.byes.map((bye: any) => bye.round).join(', ')}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditPlayer(player)}
                          className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-md">
                        <DialogHeader>
                          <DialogTitle>Manage Player Status</DialogTitle>
                          <DialogDescription>
                            Update {player.firstName} {player.lastName}'s tournament status. 
                            {playerStatus === "withdrawn" ? " This player can be reactivated to rejoin future rounds." : " Request specific byes or withdraw from all remaining rounds."}
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="playerStatus">Player Status</Label>
                            <Select value={playerStatus} onValueChange={(value: "active" | "withdrawn") => setPlayerStatus(value)}>
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="withdrawn">Withdrawn</SelectItem>
                              </SelectContent>
                            </Select>
                            {playerStatus === "withdrawn" && (
                              <p className="text-xs text-orange-600 mt-1">
                                Player will appear in standings but won't be paired in future rounds. Select "Active" to reactivate.
                              </p>
                            )}
                          </div>
                          
                          {playerStatus === "active" && (
                            <div className="space-y-4">
                              {/* Show existing bye requests */}
                              {existingByes.length > 0 && (
                                <div>
                                  <Label>Current Bye Requests</Label>
                                  <div className="space-y-2 mt-2">
                                    {existingByes.map((bye) => (
                                      <div key={bye.id} className="flex items-center justify-between p-2 bg-gray-50 rounded border">
                                        <span className="text-sm">
                                          Round {bye.round}: {bye.type === 'half_point' ? '1/2' : '0'} point bye
                                        </span>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={() => removePairingMutation.mutate(bye.id)}
                                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                          disabled={removePairingMutation.isPending}
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              <div>
                                <Label htmlFor="upcomingByeRounds">Add New Bye Rounds</Label>
                                <Input
                                  id="upcomingByeRounds"
                                  value={upcomingByeRounds}
                                  onChange={(e) => setUpcomingByeRounds(e.target.value)}
                                  placeholder="5, 6"
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                  Enter round numbers separated by commas (e.g., "5, 6" for rounds 5 and 6)
                                </p>
                              </div>
                              
                              {upcomingByeRounds && (
                                <div>
                                  <Label htmlFor="upcomingByeType">Bye Type</Label>
                                  <Select value={upcomingByeType} onValueChange={(value: "half_point" | "zero_point") => setUpcomingByeType(value)}>
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="half_point">1/2 Point Bye</SelectItem>
                                      <SelectItem value="zero_point">0 Point Bye</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <DialogFooter>
                          <Button 
                            onClick={handleSavePlayerStatus}
                            disabled={updatePlayerStatusMutation.isPending}
                          >
                            {updatePlayerStatusMutation.isPending ? "Updating..." : "Update Status"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeletePlayer(player.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No players registered yet. Add some players to get started.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}