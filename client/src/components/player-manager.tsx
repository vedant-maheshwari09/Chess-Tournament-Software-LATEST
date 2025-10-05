import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Player, Tournament } from "@shared/schema";
import { parseTournamentConfig } from "@/lib/tournament-config";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";

type SourceKey = "uscf" | "fide";

interface RatingLookupItem {
  id: string;
  name: string;
  rating?: string;
  ratingDisplay?: string;
  location?: string;
  extra?: string;
  extraRatings?: Array<{
    type: "quick" | "blitz" | "rapid";
    label: string;
    value?: string;
    display?: string;
  }>;
  metadata?: Record<string, string | undefined>;
  sex?: string;
  birthYear?: string;
}

interface RatingLookupResponse {
  query: {
    term?: string;
    firstName?: string;
    lastName?: string;
    id?: string;
  };
  uscf?: RatingLookupItem[];
  fide?: RatingLookupItem[];
  errors?: Partial<Record<SourceKey, string>>;
}

interface PlayerManagerProps {
  tournament: Tournament;
  tournamentId: number;
}

const FEDERATION_OPTIONS = [
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

const SOURCE_META: Record<SourceKey, { label: string; accent: string }> = {
  uscf: { label: "USCF", accent: "bg-blue-50 text-blue-700" },
  fide: { label: "FIDE", accent: "bg-purple-50 text-purple-700" },
};

const FEDERATION_SEARCH_LINKS: Record<SourceKey, string> = {
  uscf: "https://www.uschess.org/msa/thin.php",
  fide: "https://ratings.fide.com/",
};
type TabKey = "basic" | "payments" | "notes";
type RatingLookupEntry = RatingLookupItem;
type ExtraRating = NonNullable<RatingLookupEntry["extraRatings"]>[number];

const SEX_FORM_MAP: Record<string, "male" | "female" | "other"> = {
  m: "male",
  male: "male",
  f: "female",
  female: "female",
};

const SEX_DISPLAY_MAP: Record<string, string> = {
  m: "Male",
  male: "Male",
  f: "Female",
  female: "Female",
};

const mapSexToFormValue = (sex?: string) => {
  if (!sex) return undefined;
  const normalized = sex.trim().toLowerCase();
  return SEX_FORM_MAP[normalized] ?? undefined;
};

const formatSexDisplay = (sex?: string) => {
  if (!sex) return undefined;
  const normalized = sex.trim().toLowerCase();
  if (normalized in SEX_DISPLAY_MAP) {
    return SEX_DISPLAY_MAP[normalized];
  }
  if (sex.length === 1) {
    return sex.toUpperCase();
  }
  return sex;
};

const extractRatingValue = (rating?: ExtraRating) => rating?.value ?? rating?.display ?? "";

const FEDERATION_CODE_MAP: Record<string, string> = {
  USA: "United States",
  US: "United States",
  ENG: "United Kingdom",
  GBR: "United Kingdom",
  SCO: "United Kingdom",
  WLS: "United Kingdom",
  CAN: "Canada",
  FRA: "France",
  GER: "Germany",
  ESP: "Spain",
  IND: "India",
  CHN: "China",
  AUS: "Australia",
};

export default function PlayerManager({ tournament, tournamentId }: PlayerManagerProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("basic");
  const [searchInputs, setSearchInputs] = useState({ lastName: "", firstName: "", id: "" });
  const [debouncedSearchInputs, setDebouncedSearchInputs] = useState({ lastName: "", firstName: "", id: "" });

  const tournamentConfig = useMemo(() => parseTournamentConfig(tournament), [tournament]);
  const defaultFederation = tournamentConfig.basic.federation || "United States";
  const federationOptions = useMemo(() => {
    return FEDERATION_OPTIONS.includes(defaultFederation)
      ? FEDERATION_OPTIONS
      : [defaultFederation, ...FEDERATION_OPTIONS];
  }, [defaultFederation]);

  const createEmptyForm = useCallback(
    () => ({
      firstName: "",
      lastName: "",
      federation: defaultFederation,
      rating: "",
      ratingRapid: "",
      ratingBlitz: "",
      email: "",
      phoneCountry: "+1",
      phone: "",
      club: "",
      birthdate: "",
      sex: "",
      title: "",
      labels: "",
      uscfId: "",
      localId: "",
      notesAdmin: "",
      notesPublic: "",
      notesPrivate: "",
      paymentDate: "",
      paymentMethod: "",
      paymentAmount: "",
    }),
    [defaultFederation],
  );

  const [formState, setFormState] = useState(createEmptyForm);

  const { data: players = [], isLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearchInputs({
        lastName: searchInputs.lastName.trim(),
        firstName: searchInputs.firstName.trim(),
        id: searchInputs.id.trim(),
      });
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInputs]);

  const hasSearchInput = useMemo(
    () => Object.values(debouncedSearchInputs).some((value) => value.length > 0),
    [debouncedSearchInputs],
  );

  const { data: lookupDataRaw, isFetching: lookupFetching, error: lookupError } = useQuery<
    RatingLookupResponse | null,
    Error
  >({
    queryKey: [
      "rating-lookup",
      debouncedSearchInputs.lastName,
      debouncedSearchInputs.firstName,
      debouncedSearchInputs.id,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearchInputs.lastName) params.set("lastName", debouncedSearchInputs.lastName);
      if (debouncedSearchInputs.firstName) params.set("firstName", debouncedSearchInputs.firstName);
      if (debouncedSearchInputs.id) params.set("id", debouncedSearchInputs.id);
      if (!params.toString()) return null;
      return await apiRequest(`/api/rating-lookup?${params.toString()}`);
    },
    enabled: hasSearchInput,
    staleTime: 1000 * 30,
    retry: false,
  });

  const lookupData = hasSearchInput ? lookupDataRaw : null;

  useEffect(() => {
    if (lookupError) {
      console.warn("lookup failed", lookupError);
    }
  }, [lookupError]);

  useEffect(() => {
    if (!dialogOpen) {
      setActiveTab("basic");
      setSearchInputs({ lastName: "", firstName: "", id: "" });
      setDebouncedSearchInputs({ lastName: "", firstName: "", id: "" });
      setFormState(createEmptyForm());
    }
  }, [dialogOpen, createEmptyForm]);

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
    },
    onError: (error: any) => {
      toast({
        title: "Unable to add player",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const lookupResults = useMemo(() => {
    if (!lookupData || lookupError) {
      return { uscf: [] as RatingLookupEntry[], fide: [] as RatingLookupEntry[] };
    }
    return {
      uscf: lookupData.uscf ?? [],
      fide: lookupData.fide ?? [],
    };
  }, [lookupData, lookupError]);

  const totalLookupResults = useMemo(
    () => lookupResults.uscf.length + lookupResults.fide.length,
    [lookupResults],
  );

  const sourceErrors = useMemo(() => {
    if (!lookupData?.errors) return [] as Array<{ source: SourceKey; label: string; message: string }>;
    return (Object.entries(lookupData.errors) as Array<[SourceKey, string | undefined]> )
      .filter((entry): entry is [SourceKey, string] => Boolean(entry[1]))
      .map(([source, message]) => ({
        source,
        label: SOURCE_META[source]?.label ?? source.toUpperCase(),
        message: message.trim(),
      }));
  }, [lookupData]);

  const hasLookupResults = totalLookupResults > 0;

  const matchingTournamentPlayers = useMemo(() => {
    const tokens = [searchInputs.lastName, searchInputs.firstName]
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
    if (tokens.length === 0) return [] as Player[];
    return players
      .filter((player) => {
        const fullName = `${player.lastName ?? ""} ${player.firstName ?? ""}`.toLowerCase();
        return tokens.every((token) => fullName.includes(token));
      })
      .slice(0, 6);
  }, [players, searchInputs]);

  const isSearchDirty = useMemo(
    () => Object.values(searchInputs).some((value) => value.length > 0),
    [searchInputs],
  );

  const handleClearSearch = () => {
    setSearchInputs({ lastName: "", firstName: "", id: "" });
    setDebouncedSearchInputs({ lastName: "", firstName: "", id: "" });
  };

  const handleResultClick = (source: SourceKey, item: RatingLookupEntry) => {
    const [lastNameRaw, firstNameRaw] = item.name.split(",");
    const cleanedFirst = (firstNameRaw ?? "").trim();
    const cleanedLast = (lastNameRaw ?? item.name).trim();
    const quickRating = item.extraRatings?.find((rating) => rating.type === "quick");
    const rapidRating = item.extraRatings?.find((rating) => rating.type === "rapid");
    const blitzRating = item.extraRatings?.find((rating) => rating.type === "blitz");
    const formSex = mapSexToFormValue(item.sex);
    setFormState((prev) => {
      const next = { ...prev };
      if (cleanedFirst) next.firstName = cleanedFirst;
      if (cleanedLast) next.lastName = cleanedLast;

      const mainRating = (item.rating ?? item.ratingDisplay ?? "").trim();
      next.rating = mainRating;

      const rapidValue = extractRatingValue(rapidRating) || extractRatingValue(quickRating);
      next.ratingRapid = rapidValue ?? "";

      const blitzValue = extractRatingValue(blitzRating);
      next.ratingBlitz = blitzValue ?? "";

      next.sex = formSex ?? "";

      if (source === "uscf") {
        next.federation = "United States";
      } else if (item.location) {
        const rawLocation = item.location.trim();
        const mappedLocation = FEDERATION_CODE_MAP[rawLocation.toUpperCase()] ?? rawLocation;
        if (mappedLocation && federationOptions.includes(mappedLocation)) {
          next.federation = mappedLocation;
        }
      }

      if (source === "fide") {
        next.title = item.extra?.trim() ?? "";
        next.club = "";
      } else {
        next.title = "";
        next.club = item.extra?.trim() ?? "";
      }

      if (item.id) {
        const idValue = item.id.trim();
        if (source === "uscf") {
          next.uscfId = idValue;
          next.localId = "";
        } else if (source === "fide") {
          next.localId = idValue;
          next.uscfId = "";
        } else {
          next.uscfId = "";
          next.localId = idValue;
        }
      } else {
        if (source === "uscf") {
          next.uscfId = "";
        } else {
          next.localId = "";
        }
      }

      return next;
    });
    setActiveTab("basic");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[240px,1fr]">
      <Card className="self-start">
        <CardHeader>
          <CardTitle className="text-lg">Player tools</CardTitle>
          <p className="text-sm text-muted-foreground">Quick actions for updating your roster.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="w-full">Add Player</Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-[92vw] overflow-y-auto p-3 sm:p-5 lg:max-w-[1100px]">
              <div className="mx-auto origin-top scale-95 transform-gpu space-y-4 sm:origin-center">
                <DialogHeader>
                  <DialogTitle>Add Player</DialogTitle>
                  <DialogDescription>Search federations or add a player manually.</DialogDescription>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)} className="space-y-4">
                  <TabsList className="grid grid-cols-3 w-full">
                    <TabsTrigger value="basic">Basic</TabsTrigger>
                    <TabsTrigger value="payments">Payments</TabsTrigger>
                    <TabsTrigger value="notes">Notes</TabsTrigger>
                  </TabsList>

                  <TabsContent value="basic" className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-[280px,1fr]">
                    <div className="space-y-3">
                      <Label>Search national databases</Label>
                      {sourceErrors.length > 0 && (
                        <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                          {sourceErrors.map(({ source, label, message }) => (
                            <p key={source} className="font-medium">
                              {label} lookup unavailable: <span className="font-normal">{message}</span>
                            </p>
                          ))}
                        </div>
                      )}
                      <div className="space-y-3 rounded-md border p-3">
                        <div className="grid gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">Last name</Label>
                            <Input
                              value={searchInputs.lastName}
                              onChange={(event) =>
                                setSearchInputs((prev) => ({ ...prev, lastName: event.target.value }))
                              }
                              placeholder="e.g., Carlsen"
                              autoComplete="off"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">First name</Label>
                            <Input
                              value={searchInputs.firstName}
                              onChange={(event) =>
                                setSearchInputs((prev) => ({ ...prev, firstName: event.target.value }))
                              }
                              placeholder="e.g., Magnus"
                              autoComplete="off"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">Federation ID</Label>
                            <Input
                              value={searchInputs.id}
                              onChange={(event) =>
                                setSearchInputs((prev) => ({ ...prev, id: event.target.value }))
                              }
                              placeholder="USCF or FIDE ID"
                              autoComplete="off"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {hasSearchInput
                              ? lookupFetching
                                ? "Searching federation records…"
                                : hasLookupResults
                                  ? `${totalLookupResults} result${totalLookupResults === 1 ? "" : "s"} found. Click a row to autofill.`
                                  : lookupError
                                    ? "Lookup failed. Try again or use the official finder links."
                                    : "No players found. Adjust your search or open the official finder."
                              : "Enter any combination of last name, first name, or ID to search."}
                          </span>
                          <div className="flex items-center gap-2">
                            {lookupFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={handleClearSearch}
                              disabled={!isSearchDirty}
                            >
                              Clear
                            </Button>
                          </div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">Results</p>
                          {hasSearchInput && !lookupFetching && (
                            <span className="text-xs text-muted-foreground">
                              {hasLookupResults
                                ? `${totalLookupResults} match${totalLookupResults === 1 ? "" : "es"}`
                                : "No matches"}
                            </span>
                          )}
                        </div>
                        {hasSearchInput ? (
                          hasLookupResults ? (
                            <div className="overflow-hidden rounded-md border">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-[80px]">Source</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead className="w-[110px]">ID</TableHead>
                                    <TableHead className="w-[140px]">Federation</TableHead>
                                    <TableHead className="w-[110px]">Classic</TableHead>
                                    <TableHead className="w-[120px]">Quick/Rapid</TableHead>
                                    <TableHead className="w-[110px]">Blitz</TableHead>
                                    <TableHead className="w-[140px]">Extra</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {(Object.keys(SOURCE_META) as SourceKey[]).map((source) => {
                                    const meta = SOURCE_META[source];
                                    const items = lookupResults[source];
                                    if (!items.length) return null;
                                    return items.map((item) => {
                                      const classicValue = (item.ratingDisplay ?? item.rating ?? "").trim();
                                      const rapidRating =
                                        item.extraRatings?.find((rating) => rating.type === "rapid") ??
                                        item.extraRatings?.find((rating) => rating.type === "quick");
                                      const blitzRating = item.extraRatings?.find((rating) => rating.type === "blitz");
                                      const rapidValue = extractRatingValue(rapidRating);
                                      const blitzValue = extractRatingValue(blitzRating);
                                      const sexLabel = formatSexDisplay(item.sex);
                                      const metadataBadges: string[] = [];
                                      if (sexLabel) metadataBadges.push(sexLabel);
                                      if (item.birthYear) metadataBadges.push(`Born ${item.birthYear}`);
                                      if (item.metadata?.expiration) metadataBadges.push(`Expires ${item.metadata.expiration}`);

                                      return (
                                        <TableRow
                                          key={`${source}-${item.id}-${item.name}`}
                                          className="cursor-pointer hover:bg-muted/60"
                                          onClick={() => handleResultClick(source, item)}
                                        >
                                          <TableCell className="align-top">
                                            <Badge className={`${meta.accent}`}>{meta.label}</Badge>
                                          </TableCell>
                                          <TableCell className="align-top">
                                            <div className="font-medium leading-none">{item.name}</div>
                                            {metadataBadges.length > 0 && (
                                              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                                {metadataBadges.map((badge, index) => (
                                                  <span key={`${item.id}-meta-${index}`}>{badge}</span>
                                                ))}
                                              </div>
                                            )}
                                          </TableCell>
                                          <TableCell className="align-top font-mono text-sm">{item.id}</TableCell>
                                          <TableCell className="align-top text-sm">{item.location ?? "—"}</TableCell>
                                          <TableCell className="align-top text-sm">{classicValue || "—"}</TableCell>
                                          <TableCell className="align-top text-sm">{rapidValue || "—"}</TableCell>
                                          <TableCell className="align-top text-sm">{blitzValue || "—"}</TableCell>
                                          <TableCell className="align-top text-sm">{item.extra ?? "—"}</TableCell>
                                        </TableRow>
                                      );
                                    });
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          ) : (
                            <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                              {lookupError
                                ? "Unable to reach federation services. Please try again or use the official finder."
                                : "No players found. Adjust your search or open the official finder below."}
                            </div>
                          )
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Enter a last name, first name, or federation ID to begin searching.
                          </p>
                        )}
                      </div>

                      {matchingTournamentPlayers.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase text-muted-foreground">Current tournament</p>
                          <div className="space-y-1 rounded-md border border-dashed p-2">
                            {matchingTournamentPlayers.map((player) => (
                              <div
                                key={`existing-${player.id}`}
                                className="flex items-center justify-between text-xs text-muted-foreground"
                              >
                                <span className="font-medium text-slate-700 dark:text-slate-300">
                                  {player.lastName}, {player.firstName}
                                </span>
                                <span className="font-mono">{player.rating ?? "-"}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid gap-2 sm:grid-cols-2">
                        {(Object.keys(SOURCE_META) as SourceKey[]).map((source) => (
                          <Button
                            key={source}
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => window.open(FEDERATION_SEARCH_LINKS[source], "_blank")}
                          >
                            {SOURCE_META[source].label} Finder
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-5">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label>First name</Label>
                          <Input
                            value={formState.firstName}
                            onChange={(event) => setFormState((prev) => ({ ...prev, firstName: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Last name</Label>
                          <Input
                            value={formState.lastName}
                            onChange={(event) => setFormState((prev) => ({ ...prev, lastName: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Birthdate</Label>
                          <Input
                            type="date"
                            value={formState.birthdate}
                            onChange={(event) => setFormState((prev) => ({ ...prev, birthdate: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Sex</Label>
                          <Select value={formState.sex} onValueChange={(value) => setFormState((prev) => ({ ...prev, sex: value }))}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="male">Male</SelectItem>
                              <SelectItem value="female">Female</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label>Club</Label>
                          <Input
                            value={formState.club}
                            onChange={(event) => setFormState((prev) => ({ ...prev, club: event.target.value }))}
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
                        <div className="space-y-1">
                          <Label>Title</Label>
                          <Input
                            value={formState.title}
                            onChange={(event) => setFormState((prev) => ({ ...prev, title: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Labels</Label>
                          <Input
                            value={formState.labels}
                            onChange={(event) => setFormState((prev) => ({ ...prev, labels: event.target.value }))}
                          />
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1">
                          <Label>Rating (Classic)</Label>
                          <Input
                            value={formState.rating}
                            onChange={(event) => setFormState((prev) => ({ ...prev, rating: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Rating (Rapid)</Label>
                          <Input
                            value={formState.ratingRapid}
                            onChange={(event) => setFormState((prev) => ({ ...prev, ratingRapid: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Rating (Blitz)</Label>
                          <Input
                            value={formState.ratingBlitz}
                            onChange={(event) => setFormState((prev) => ({ ...prev, ratingBlitz: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>USCF ID</Label>
                          <Input
                            value={formState.uscfId}
                            onChange={(event) => setFormState((prev) => ({ ...prev, uscfId: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Local ID</Label>
                          <Input
                            value={formState.localId}
                            onChange={(event) => setFormState((prev) => ({ ...prev, localId: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label>Email</Label>
                          <Input
                            type="email"
                            value={formState.email}
                            onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <Label>Phone number</Label>
                          <div className="grid grid-cols-[120px,1fr] gap-2">
                            <Input
                              value={formState.phoneCountry}
                              onChange={(event) => setFormState((prev) => ({ ...prev, phoneCountry: event.target.value }))}
                            />
                            <Input
                              value={formState.phone}
                              onChange={(event) => setFormState((prev) => ({ ...prev, phone: event.target.value }))}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="payments" className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1">
                      <Label>Date</Label>
                      <Input
                        type="datetime-local"
                        value={formState.paymentDate}
                        onChange={(event) => setFormState((prev) => ({ ...prev, paymentDate: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Method</Label>
                      <Select
                        value={formState.paymentMethod}
                        onValueChange={(value) => setFormState((prev) => ({ ...prev, paymentMethod: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                          <SelectItem value="online">Online</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Amount</Label>
                      <Input
                        type="number"
                        value={formState.paymentAmount}
                        onChange={(event) => setFormState((prev) => ({ ...prev, paymentAmount: event.target.value }))}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Payment tracking fields are informational for now and will be stored in a later update.
                  </p>
                </TabsContent>

                <TabsContent value="notes" className="space-y-3">
                  <div className="space-y-1">
                    <Label>Admin&apos;s notes</Label>
                    <Textarea
                      rows={4}
                      value={formState.notesAdmin}
                      onChange={(event) => setFormState((prev) => ({ ...prev, notesAdmin: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Public notes</Label>
                    <Textarea
                      rows={4}
                      value={formState.notesPublic}
                      onChange={(event) => setFormState((prev) => ({ ...prev, notesPublic: event.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Private message from player</Label>
                    <Textarea
                      rows={4}
                      value={formState.notesPrivate}
                      onChange={(event) => setFormState((prev) => ({ ...prev, notesPrivate: event.target.value }))}
                    />
                  </div>
                </TabsContent>
              </Tabs>

              <div className="flex justify-end gap-2 pt-2">
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

          <Button variant="outline" className="w-full" disabled>
            Entry fees
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="w-full" disabled>
              Export
            </Button>
            <Button variant="secondary" className="w-full" disabled>
              Import
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Chess-Results syncing will use these controls once backend automation is enabled.
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-1">
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle className="text-xl">Players</CardTitle>
            <p className="text-sm text-muted-foreground">Overview of everyone registered for this event.</p>
          </div>
          <Badge variant="secondary">Total: {players.length}</Badge>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading players…</p>
          ) : players.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">No players registered yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Surname, Name</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Club</TableHead>
                  <TableHead>Birthdate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {players.map((player, index) => (
                  <TableRow key={player.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      {player.lastName}, {player.firstName}
                    </TableCell>
                    <TableCell>{player.rating ?? "-"}</TableCell>
                    <TableCell>-</TableCell>
                    <TableCell>-</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}