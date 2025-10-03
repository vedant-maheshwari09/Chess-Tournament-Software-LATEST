import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Player, Tournament } from "@shared/schema";
import { parseTournamentConfig } from "@/lib/tournament-config";

interface RatingLookupResponse {
  query: string;
  uscf: Array<{ id: string; name: string; rating?: string; location?: string; extra?: string }>;
  fide: Array<{ id: string; name: string; rating?: string; location?: string; extra?: string }>;
  ecf: Array<{ id: string; name: string; rating?: string; location?: string; extra?: string }>;
}

interface PlayerManagerProps {
  tournament: Tournament;
  tournamentId: number;
}

const STATIC_FEDERATION_OPTIONS = [
  "United States",
  "Canada",
  "United Kingdom",
  "Germany",
  "France",
  "Spain",
  "India",
  "China",
  "Australia",
];

const SOURCE_LABELS: Record<string, string> = {
  uscf: "USCF",
  fide: "FIDE",
  ecf: "ECF",
};

const SOURCE_ACCENTS: Record<string, string> = {
  uscf: "bg-blue-50 text-blue-700",
  fide: "bg-purple-50 text-purple-700",
  ecf: "bg-amber-50 text-amber-700",
};

export default function PlayerManager({ tournament, tournamentId }: PlayerManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedSource, setSelectedSource] = useState("uscf");
  const tournamentConfig = useMemo(() => parseTournamentConfig(tournament), [tournament]);
  const defaultFederation = tournamentConfig.basic.federation || "United States";
  const federationOptions = useMemo(() => {
    return STATIC_FEDERATION_OPTIONS.includes(defaultFederation)
      ? STATIC_FEDERATION_OPTIONS
      : [defaultFederation, ...STATIC_FEDERATION_OPTIONS];
  }, [defaultFederation]);
  const [formState, setFormState] = useState({
    firstName: "",
    lastName: "",
    federation: defaultFederation,
    rating: "",
    email: "",
    phone: "",
    club: "",
    notes: "",
  });

  const { data: players = [], isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const [lookupQuery, setLookupQuery] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => {
      setLookupQuery(searchTerm.trim());
    }, 400);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  const { data: lookupData, isFetching: lookupFetching } = useQuery<RatingLookupResponse | null>({
    queryKey: ["rating-lookup", lookupQuery],
    queryFn: async () => {
      if (!lookupQuery) return null;
      try {
        return await apiRequest(`/api/rating-lookup?q=${encodeURIComponent(lookupQuery)}`);
      } catch (error) {
        console.warn("lookup failed", error);
        return null;
      }
    },
    staleTime: 1000 * 30,
  });

  const addPlayerMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        firstName: formState.firstName.trim() || "Player",
        lastName: formState.lastName.trim() || `#${players.length + 1}`,
        rating: Number(formState.rating) || 0,
        federation: formState.federation || "United States",
      };
      return apiRequest(`/api/tournaments/${tournamentId}/players`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      toast({ title: "Player added" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      setDialogOpen(false);
      setFormState((prev) => ({
        ...prev,
        firstName: "",
        lastName: "",
        federation: defaultFederation,
        rating: "",
        email: "",
        phone: "",
        club: "",
        notes: "",
      }));
    },
    onError: (error: any) => {
      toast({
        title: "Unable to add player",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const resultsBySource = useMemo(() => {
    if (!lookupData) return { uscf: [], fide: [], ecf: [] };
    return {
      uscf: lookupData.uscf ?? [],
      fide: lookupData.fide ?? [],
      ecf: lookupData.ecf ?? [],
    };
  }, [lookupData]);

  const handleResultClick = (source: string, item: any) => {
    const [lastName, firstName] = item.name.split(",");
    setSelectedSource(source);
    setFormState((prev) => ({
      ...prev,
      firstName: (firstName ?? "").trim(),
      lastName: (lastName ?? item.name).trim(),
      rating: item.rating ?? prev.rating,
      federation: item.location ?? prev.federation,
    }));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-xl">Players</CardTitle>
          <p className="text-sm text-muted-foreground">Manage participants and import ratings from federations.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>Add Player</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[720px]">
            <DialogHeader>
              <DialogTitle>Add Player</DialogTitle>
              <DialogDescription>Search national databases or enter details manually.</DialogDescription>
            </DialogHeader>

            <Tabs value={selectedSource} onValueChange={setSelectedSource} className="w-full">
              <TabsList className="grid grid-cols-3 mb-4">
                <TabsTrigger value="uscf">USCF</TabsTrigger>
                <TabsTrigger value="fide">FIDE</TabsTrigger>
                <TabsTrigger value="ecf">ECF</TabsTrigger>
              </TabsList>

              <TabsContent value="uscf" className="space-y-3">
                <Label htmlFor="lookup-uscf">Search by name</Label>
                <Input
                  id="lookup-uscf"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="e.g., Jack Finlay"
                />
                {lookupFetching && <p className="text-sm text-muted-foreground">Searching USCF...</p>}
                <ScrollArea className="h-40 border rounded-md p-2">
                  {(resultsBySource.uscf ?? []).length === 0 && !lookupFetching ? (
                    <p className="text-sm text-muted-foreground">No results yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {resultsBySource.uscf.map((item) => (
                        <button
                          key={`${item.id}-${item.name}`}
                          type="button"
                          className={`w-full text-left border rounded p-2 hover:border-primary ${SOURCE_ACCENTS.uscf}`}
                          onClick={() => handleResultClick("uscf", item)}
                        >
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs opacity-80 flex gap-4">
                            {item.rating && <span>Rating: {item.rating}</span>}
                            {item.location && <span>{item.location}</span>}
                            {item.extra && <span>{item.extra}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="fide" className="space-y-3">
                <Label>FIDE search</Label>
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="e.g., Carlsen"
                />
                {lookupFetching && <p className="text-sm text-muted-foreground">Searching FIDE...</p>}
                <ScrollArea className="h-40 border rounded-md p-2">
                  {(resultsBySource.fide ?? []).length === 0 && !lookupFetching ? (
                    <p className="text-sm text-muted-foreground">No results yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {resultsBySource.fide.map((item) => (
                        <button
                          key={`${item.id}-${item.name}`}
                          type="button"
                          className={`w-full text-left border rounded p-2 hover:border-primary ${SOURCE_ACCENTS.fide}`}
                          onClick={() => handleResultClick("fide", item)}
                        >
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs opacity-80 flex gap-4">
                            {item.rating && <span>ELO: {item.rating}</span>}
                            {item.location && <span>{item.location}</span>}
                            {item.extra && <span>{item.extra}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>

              <TabsContent value="ecf" className="space-y-3">
                <Label>ECF search</Label>
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="e.g., Adams"
                />
                {lookupFetching && <p className="text-sm text-muted-foreground">Searching ECF...</p>}
                <ScrollArea className="h-40 border rounded-md p-2">
                  {(resultsBySource.ecf ?? []).length === 0 && !lookupFetching ? (
                    <p className="text-sm text-muted-foreground">No results yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {resultsBySource.ecf.map((item) => (
                        <button
                          key={`${item.id}-${item.name}`}
                          type="button"
                          className={`w-full text-left border rounded p-2 hover:border-primary ${SOURCE_ACCENTS.ecf}`}
                          onClick={() => handleResultClick("ecf", item)}
                        >
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs opacity-80 flex gap-4">
                            {item.rating && <span>ECF: {item.rating}</span>}
                            {item.location && <span>{item.location}</span>}
                            {item.extra && <span>{item.extra}</span>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </TabsContent>
            </Tabs>

            <div className="mt-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>First Name</Label>
                  <Input
                    value={formState.firstName}
                    onChange={(event) => setFormState((prev) => ({ ...prev, firstName: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Last Name</Label>
                  <Input
                    value={formState.lastName}
                    onChange={(event) => setFormState((prev) => ({ ...prev, lastName: event.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label>Rating</Label>
                  <Input
                    value={formState.rating}
                    onChange={(event) => setFormState((prev) => ({ ...prev, rating: event.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Federation</Label>
                  <Select
                    value={formState.federation}
                    onValueChange={(value) => setFormState((prev) => ({ ...prev, federation: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                    {federationOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => addPlayerMutation.mutate()} disabled={addPlayerMutation.isPending}>
                  {addPlayerMutation.isPending ? "Adding..." : "Add Player"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading players...</p>
        ) : players.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-muted-foreground">No players registered yet.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Federation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.map((player, index) => (
                <TableRow key={player.id}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>{player.firstName} {player.lastName}</TableCell>
                  <TableCell>{player.rating ?? "-"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{player.federation ?? ""}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
