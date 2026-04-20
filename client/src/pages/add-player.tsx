import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ChevronLeft, ChevronRight, FilePlus2, Save, Search, UserRound, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { parseTournamentConfig } from "@/lib/tournament-config";
import type { Player, Tournament } from "@shared/schema";
import type { SectionDefinition } from "@shared/tournament-config";
import { useAuth } from "@/hooks/useAuth";
import { Breadcrumbs } from "@/components/breadcrumbs";

type SourceKey = "uscf" | "fide";
type TabKey = "basic" | "payments" | "notes";

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

const PHONE_COUNTRY_OPTIONS = [
  { code: "+1", label: "United States" },
  { code: "+44", label: "United Kingdom" },
  { code: "+91", label: "India" },
  { code: "+61", label: "Australia" },
  { code: "+33", label: "France" },
];

const SOURCE_META: Record<SourceKey, { label: string; accent: string }> = {
  uscf: { label: "USCF", accent: "bg-blue-50 text-blue-700" },
  fide: { label: "FIDE", accent: "bg-purple-50 text-purple-700" },
};

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

const normalizeName = (name: string) => {
  if (!name) return "";
  return name.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
};

const formatNameLastFirst = (name?: string) => {
  if (!name) return "";
  const trimmed = name.trim();
  if (!trimmed) return "";
  
  // Normalize the name before formatting if it's all uppercase
  const shouldNormalize = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
  const targetName = shouldNormalize ? normalizeName(trimmed) : trimmed;

  if (targetName.includes(",")) {
    const [last, ...rest] = targetName.split(",");
    const first = rest.join(",").trim();
    const normalizedLast = last.trim();
    return first ? `${normalizedLast}, ${first}` : normalizedLast;
  }
  const parts = targetName.split(/\s+/);
  if (parts.length <= 1) return targetName;
  const last = parts.pop();
  const first = parts.join(" ");
  return last ? `${last}, ${first}` : targetName;
};

interface AddPlayerPageProps {
  tournamentId: number;
  playerId?: number;
}

export default function AddPlayerPage({ tournamentId, playerId }: AddPlayerPageProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const resolvedPlayerId = typeof playerId === "number" && Number.isFinite(playerId) ? playerId : null;
  const isEditing = resolvedPlayerId !== null;
  const [editInitialized, setEditInitialized] = useState(false);

  const { data: tournament, isLoading: tournamentLoading } = useQuery<Tournament>({
    queryKey: [`/api/tournaments/${tournamentId}`],
  });

  const { data: players = [], isLoading: playersLoading } = useQuery<Player[]>({
    queryKey: [`/api/tournaments/${tournamentId}/players`],
  });

  const { data: editingPlayer, isLoading: editingPlayerLoading } = useQuery<Player | null>({
    queryKey: ["player-detail", tournamentId, resolvedPlayerId],
    enabled: Boolean(isEditing && resolvedPlayerId),
    queryFn: async () => {
      if (!resolvedPlayerId) return null;
      return (await apiRequest(`/api/tournaments/${tournamentId}/players/${resolvedPlayerId}`)) as Player;
    },
  });

  const isOwner = useMemo(() => {
    if (!tournament || !user) return false;
    return user.role === "tournament_director" && tournament.createdBy === user.id;
  }, [tournament, user]);

  const tournamentConfig = useMemo(() => {
    if (!tournament) return null;
    return parseTournamentConfig(tournament);
  }, [tournament]);

  const defaultFederation = tournamentConfig?.basic.federation || "United States";
  const federationOptions = useMemo(() => {
    if (!defaultFederation) return FEDERATION_OPTIONS;
    return FEDERATION_OPTIONS.includes(defaultFederation)
      ? FEDERATION_OPTIONS
      : [defaultFederation, ...FEDERATION_OPTIONS];
  }, [defaultFederation]);

  const sections = useMemo<SectionDefinition[]>(() => {
    if (!tournamentConfig) return [];
    const source = tournamentConfig.sections ?? [];
    return source.filter((section) => section.name.trim().length > 0);
  }, [tournamentConfig]);

  const primarySection = sections[0];

  const resolveSectionByRating = useCallback(
    (ratingValue: number | null | undefined) => {
      if (!sections.length) return undefined;
      if (ratingValue === null || ratingValue === undefined || Number.isNaN(ratingValue)) {
        return sections[0];
      }
      return (
        sections.find((section) => {
          const minOk = section.ratingMin === null || ratingValue >= section.ratingMin;
          const maxOk = section.ratingMax === null || ratingValue <= section.ratingMax;
          return minOk && maxOk;
        }) ?? sections[0]
      );
    },
    [sections],
  );

  const [activeTab, setActiveTab] = useState<TabKey>("basic");
  const [searchInputs, setSearchInputs] = useState({ term: "", lastName: "", firstName: "", id: "" });
  const [debouncedSearchInputs, setDebouncedSearchInputs] = useState({ term: "", lastName: "", firstName: "", id: "" });
  const [combinedNameInput, setCombinedNameInput] = useState("");

  const createEmptyForm = useCallback(
    (initialSection?: { id?: string; name?: string | null }) => ({
      firstName: "",
      lastName: "",
      federation: defaultFederation,
      rating: "",
      ratingLocal: "",
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
      sectionId: initialSection?.id ?? "",
      sectionName: initialSection?.name ?? "",
      uscfRating: "",
      fideRating: "",
    }),
    [defaultFederation],
  );

  const [formState, setFormState] = useState(() => createEmptyForm());

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
      debouncedSearchInputs.term,
      debouncedSearchInputs.lastName,
      debouncedSearchInputs.firstName,
      debouncedSearchInputs.id,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (debouncedSearchInputs.term) params.set("q", debouncedSearchInputs.term);
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
    return (Object.entries(lookupData.errors) as Array<[SourceKey, string | undefined]>)
      .filter((entry): entry is [SourceKey, string] => Boolean(entry[1]))
      .map(([source, message]) => ({
        source,
        label: SOURCE_META[source]?.label ?? source.toUpperCase(),
        message: message.trim(),
      }));
  }, [lookupData]);

  const matchingTournamentPlayers = useMemo(() => {
    const tokens = [searchInputs.term, searchInputs.lastName, searchInputs.firstName, searchInputs.id]
      .map((value) => value.replace(/[^0-9a-zA-Z]+/g, " ").trim().toLowerCase())
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

  const savePlayerMutation = useMutation<void, Error, "close" | "stay">({
    mutationFn: async (_mode) => {
      const selectedSectionDetails = formState.sectionId
        ? sections.find((section) => section.id === formState.sectionId)
        : formState.sectionName
          ? sections.find((section) => section.name === formState.sectionName)
          : undefined;
      const payload = {
        firstName: formState.firstName.trim() || "Player",
        lastName: formState.lastName.trim() || `#${players.length + 1}`,
        rating: parseInt(formState.rating, 10) || 0,
        federation: formState.federation || "United States",
        sectionId: formState.sectionId || selectedSectionDetails?.id || null,
        sectionName: (selectedSectionDetails?.name ?? formState.sectionName)?.trim() || null,
        uscfRating: parseInt(formState.uscfRating, 10) || null,
        fideRating: parseInt(formState.fideRating, 10) || null,
      };
      if (isEditing && resolvedPlayerId) {
        return apiRequest(`/api/tournaments/${tournamentId}/players/${resolvedPlayerId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      }
      return apiRequest(`/api/tournaments/${tournamentId}/players`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (_data, mode) => {
      toast({ title: isEditing ? "Player updated" : "Player added" });
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      if (isEditing && resolvedPlayerId) {
        queryClient.invalidateQueries({ queryKey: ["player-detail", tournamentId, resolvedPlayerId] });
      }
      if (mode === "close") {
        setLocation(`/tournaments/${tournamentId}/manage`);
        return;
      }
      if (!isEditing) {
        const nextForm = createEmptyForm(primarySection);
        setFormState(nextForm);
        setCombinedNameInput("");
        setSearchInputs({ term: "", lastName: "", firstName: "", id: "" });
        setDebouncedSearchInputs({ term: "", lastName: "", firstName: "", id: "" });
        setActiveTab("basic");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Unable to save player",
        description: error?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!tournamentLoading && !tournament) {
      setLocation(`/tournaments/${tournamentId}/manage`);
    }
  }, [tournament, tournamentId, tournamentLoading, setLocation]);

  useEffect(() => {
    if (tournament && user && !isOwner) {
      setLocation(`/tournaments/${tournamentId}`);
    }
  }, [tournament, user, isOwner, setLocation, tournamentId]);

  useEffect(() => {
    setFormState((prev) => {
      const hasUserInput = Object.values(prev).some((value) => typeof value === "string" && value.trim().length > 0);
      if (hasUserInput) return prev;
      return createEmptyForm(primarySection);
    });
  }, [createEmptyForm, primarySection]);

  useEffect(() => {
    setFormState((prev) => {
      if (sections.length === 0) {
        if (!prev.sectionId && !prev.sectionName) return prev;
        return { ...prev, sectionId: "", sectionName: "" };
      }

      const currentById = prev.sectionId
        ? sections.find((section) => section.id === prev.sectionId)
        : undefined;

      if (currentById) {
        if (currentById.name === prev.sectionName) return prev;
        return { ...prev, sectionName: currentById.name };
      }

      const matchByName = prev.sectionName
        ? sections.find((section) => section.name === prev.sectionName)
        : undefined;

      if (matchByName) {
        if (prev.sectionId === matchByName.id) return prev;
        return { ...prev, sectionId: matchByName.id, sectionName: matchByName.name };
      }

      if (!primarySection) return prev;
      return { ...prev, sectionId: primarySection.id, sectionName: primarySection.name };
    });
  }, [sections, primarySection]);

  useEffect(() => {
    if (!isEditing || editInitialized) return;
    if (editingPlayerLoading) return;
    if (!editingPlayer) {
      toast({ title: "Player not found", variant: "destructive" });
      setLocation(`/tournaments/${tournamentId}/manage`);
      return;
    }
    const matchedSection = sections.find((section) => section.id === editingPlayer.sectionId) ??
      sections.find((section) => section.name === editingPlayer.sectionName) ??
      primarySection;
    setFormState((prev) => ({
      ...prev,
      firstName: editingPlayer.firstName ?? prev.firstName,
      lastName: editingPlayer.lastName ?? prev.lastName,
      rating: editingPlayer.rating != null ? String(editingPlayer.rating) : prev.rating,
      federation: editingPlayer.federation ?? prev.federation,
      sectionId: matchedSection?.id ?? editingPlayer.sectionId ?? prev.sectionId,
      sectionName: matchedSection?.name ?? editingPlayer.sectionName ?? prev.sectionName,
      uscfRating: editingPlayer.uscfRating != null ? String(editingPlayer.uscfRating) : prev.uscfRating,
      fideRating: editingPlayer.fideRating != null ? String(editingPlayer.fideRating) : prev.fideRating,
    }));
    setCombinedNameInput([editingPlayer.lastName, editingPlayer.firstName].filter(Boolean).join(", "));
    setEditInitialized(true);
  }, [
    isEditing,
    editInitialized,
    editingPlayer,
    editingPlayerLoading,
    sections,
    primarySection,
    toast,
    setLocation,
    tournamentId,
  ]);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearchInputs({
        term: searchInputs.term.trim(),
        lastName: searchInputs.lastName.trim(),
        firstName: searchInputs.firstName.trim(),
        id: searchInputs.id.trim(),
      });
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInputs]);

  useEffect(() => {
    if (lookupError) {
      console.warn("lookup failed", lookupError);
    }
  }, [lookupError]);

  const handleCombinedNameChange = (value: string) => {
    setCombinedNameInput(value);
    const trimmedValue = value.trim();
    const [lastPart, ...rest] = value.split(",");
    const nextLast = lastPart?.trim() ?? "";
    const nextFirst = rest.join(",").trim();
    const digitsOnly = trimmedValue.replace(/\D/g, "");
    const isLikelyId = trimmedValue.length > 0 && digitsOnly.length >= 4 && trimmedValue.replace(/[0-9\s-]/g, "") === "";
    const containsLetters = /[A-Za-z]/.test(trimmedValue);
    const sanitizedTerm = trimmedValue.replace(/,+$/g, "").trim();

    setFormState((prev) => ({
      ...prev,
      lastName: isLikelyId ? prev.lastName : nextLast,
      firstName: isLikelyId ? prev.firstName : nextFirst,
    }));

    setSearchInputs((prev) => ({
      ...prev,
      term: isLikelyId ? "" : sanitizedTerm,
      lastName: isLikelyId ? "" : nextLast,
      firstName: isLikelyId ? "" : nextFirst,
      id: isLikelyId ? digitsOnly : trimmedValue.length === 0 || containsLetters ? "" : prev.id,
    }));
  };

  const handleIdInputChange = (value: string) => {
    const normalized = value.replace(/\D/g, "");
    setSearchInputs((prev) => ({
      ...prev,
      id: normalized,
      term: normalized.length > 0 ? "" : prev.term,
      lastName: normalized.length > 0 ? "" : prev.lastName,
      firstName: normalized.length > 0 ? "" : prev.firstName,
    }));
  };

  const handleClearSearch = () => {
    setSearchInputs({ term: "", lastName: "", firstName: "", id: "" });
    setDebouncedSearchInputs({ term: "", lastName: "", firstName: "", id: "" });
    setCombinedNameInput("");
  };

  const hasLookupResults = totalLookupResults > 0;

  const handleResultClick = (source: SourceKey, item: RatingLookupEntry) => {
    const [lastNameRaw, firstNameRaw] = item.name.split(",");
    const cleanedFirst = normalizeName((firstNameRaw ?? "").trim());
    const cleanedLast = normalizeName((lastNameRaw ?? item.name).trim());
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
      if (!next.ratingLocal) {
        next.ratingLocal = mainRating;
      }
      const numericRating = Number(mainRating);
      if (!Number.isNaN(numericRating)) {
        const detectedSection = resolveSectionByRating(numericRating);
        if (detectedSection) {
          next.sectionId = detectedSection.id;
          next.sectionName = detectedSection.name;
        }
      }

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
          next.uscfRating = mainRating;
        } else if (source === "fide") {
          next.localId = idValue;
          next.uscfId = "";
          next.fideRating = mainRating;
        } else {
          next.uscfId = "";
          next.localId = idValue;
        }
      } else {
        if (source === "uscf") {
          next.uscfId = "";
          next.uscfRating = mainRating;
        } else if (source === "fide") {
          next.localId = "";
          next.fideRating = mainRating;
        } else {
          next.localId = "";
        }
      }

      return next;
    });
    setCombinedNameInput([cleanedLast, cleanedFirst].filter(Boolean).join(", "));
    setActiveTab("basic");
  };

  if (tournamentLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-600" />
          <p className="mt-4 text-sm text-muted-foreground">Loading tournament…</p>
        </div>
      </div>
    );
  }

  if (!tournament || !isOwner) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4">


        <Card className="overflow-hidden border-0 shadow-lg">
          <CardContent className="flex flex-col p-0">
            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as TabKey)}
              className="flex h-full flex-1 flex-col"
            >
              <div className="flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b bg-muted/10 px-8 py-6">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
                      <UserRound className="h-7 w-7" />
                    </div>
                    <div>
                      <h1 className="text-2xl font-semibold text-slate-800">
                        {isEditing ? "Edit Player" : "Add Player"}
                      </h1>
                      <p className="text-sm text-muted-foreground">
                        {isEditing
                          ? "Update roster information, payments, and notes for this participant."
                          : "Complete the player details below."}
                      </p>
                    </div>
                  </div>
                  <TabsList className="grid grid-cols-3 gap-2 rounded-full bg-white px-1 py-1 shadow-inner">
                    <TabsTrigger
                      value="basic"
                      className="rounded-full px-6 py-2 text-sm font-semibold data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
                    >
                      Basic
                    </TabsTrigger>
                    <TabsTrigger
                      value="payments"
                      className="rounded-full px-6 py-2 text-sm font-semibold data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
                    >
                      Payments
                    </TabsTrigger>
                    <TabsTrigger
                      value="notes"
                      className="rounded-full px-6 py-2 text-sm font-semibold data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
                    >
                      Notes
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="flex-1 overflow-y-auto px-8 py-6">
                  <TabsContent value="basic" className="space-y-6">
                    <div className="rounded-xl border bg-white shadow-sm">
                      <div className="grid gap-4 px-6 py-6 md:grid-cols-12">
                        <div className="md:col-span-6 space-y-4">
                          <div>
                            <Label className="text-sm font-semibold text-slate-700">Surname, Name</Label>
                            <div className="relative mt-1">
                              <Input
                                value={combinedNameInput}
                                onChange={(event) => handleCombinedNameChange(event.target.value)}
                                placeholder="e.g., Carlsen, Magnus"
                                className="pr-10"
                              />
                              <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-indigo-500" />
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Format: Last name, First name — matches appear automatically.
                            </p>
                          </div>

                          <div className="space-y-1">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">Federation ID search</Label>
                            <Input
                              value={searchInputs.id}
                              onChange={(event) => handleIdInputChange(event.target.value)}
                              placeholder="Type USCF or FIDE ID"
                              autoComplete="off"
                            />
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                            <div className="flex items-center gap-2">
                              {lookupFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                              <span>
                                {hasSearchInput
                                  ? lookupFetching
                                    ? "Searching federation records…"
                                    : hasLookupResults
                                      ? `${totalLookupResults} result${totalLookupResults === 1 ? "" : "s"} found.`
                                      : lookupError
                                        ? "Lookup failed. Try again or use the official finder links."
                                        : "No players found. Adjust your search terms."
                                  : "Begin typing to search local federation data."}
                              </span>
                            </div>
                            {isSearchDirty && (
                              <Button type="button" variant="ghost" size="sm" onClick={handleClearSearch}>
                                Clear
                              </Button>
                            )}
                          </div>

                          {sourceErrors.length > 0 && (
                            <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                              {sourceErrors.map(({ source, label, message }) => (
                                <p key={source} className="font-medium">
                                  {label} lookup unavailable: <span className="font-normal">{message}</span>
                                </p>
                              ))}
                            </div>
                          )}

                          <div className="rounded-lg border bg-white/70">
                            {hasSearchInput ? (
                              hasLookupResults ? (
                                <div className="max-h-[320px] overflow-y-auto pr-1">
                                  <div className="pb-1">
                                    {(Object.keys(SOURCE_META) as SourceKey[]).map((source) => {
                                      const meta = SOURCE_META[source];
                                      const items = lookupResults[source];
                                      if (!items.length) return null;
                                      return (
                                        <div key={source} className="grid grid-cols-[78px,1fr] border-b last:border-b-0">
                                          <div className="flex items-start justify-center border-r bg-slate-50 px-2 py-3 text-xs font-semibold uppercase text-slate-600">
                                            {meta.label}
                                          </div>
                                          <div className="divide-y">
                                            {items.map((item) => {
                                              const classicValue = (item.ratingDisplay ?? item.rating ?? "").trim();
                                              const rapidRating =
                                                item.extraRatings?.find((rating) => rating.type === "rapid") ??
                                                item.extraRatings?.find((rating) => rating.type === "quick");
                                              const blitzRating = item.extraRatings?.find((rating) => rating.type === "blitz");
                                              const rapidValue = extractRatingValue(rapidRating);
                                              const blitzValue = extractRatingValue(blitzRating);
                                              const classicDisplay = classicValue || "----";
                                              const rapidDisplay = (rapidValue ?? "").trim() || "----";
                                              const blitzDisplay = (blitzValue ?? "").trim() || "----";
                                              const nameDisplay = formatNameLastFirst(item.name);
                                              const infoBadges: string[] = [];
                                              const sexLabel = formatSexDisplay(item.sex);
                                              if (sexLabel) infoBadges.push(sexLabel);
                                              if (item.birthYear) infoBadges.push(`Born ${item.birthYear}`);
                                              if (item.extra) infoBadges.push(item.extra);
                                              const rightMeta: string[] = [];
                                              if (item.location) rightMeta.push(item.location);
                                              if (item.metadata?.expiration) rightMeta.push(`exp. ${item.metadata.expiration}`);

                                              return (
                                                <button
                                                  key={`${source}-${item.id}-${item.name}`}
                                                  type="button"
                                                  onClick={() => handleResultClick(source, item)}
                                                  className="flex w-full items-start justify-between gap-4 px-3 py-3 text-left transition hover:bg-indigo-50 focus:outline-none"
                                                >
                                                  <div className="space-y-1">
                                                    <div className="text-sm font-semibold text-slate-900">{nameDisplay || item.name}</div>
                                                    <div className="flex gap-4 font-sans text-xs text-muted-foreground">
                                                      <span>{classicDisplay}</span>
                                                      <span>{rapidDisplay}</span>
                                                      <span>{blitzDisplay}</span>
                                                    </div>
                                                    {infoBadges.length > 0 && (
                                                      <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                                                        {infoBadges.map((badge, index) => (
                                                          <span key={`${item.id}-badge-${index}`}>{badge}</span>
                                                        ))}
                                                      </div>
                                                    )}
                                                  </div>
                                                  <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
                                                    <span className="font-sans text-sm text-slate-700">{item.id || "—"}</span>
                                                    {rightMeta.map((metaLine, index) => (
                                                      <span key={`${item.id}-meta-${index}`}>{metaLine}</span>
                                                    ))}
                                                  </div>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <div className="p-4 text-sm text-muted-foreground">
                                  {lookupError
                                    ? "Unable to reach federation services. Please try again or use the official finder."
                                    : "No players found. Adjust your search or refine your criteria."}
                                </div>
                              )
                            ) : (
                              <div className="p-4 text-sm text-muted-foreground">
                                Enter a search term, name, or federation ID to begin.
                              </div>
                            )}
                          </div>

                          {matchingTournamentPlayers.length > 0 && (
                            <div className="space-y-2 rounded-lg border border-dashed bg-indigo-50/40 p-3">
                              <p className="text-xs font-semibold uppercase text-indigo-700">Current tournament</p>
                              <div className="space-y-1 text-xs text-slate-700">
                                {matchingTournamentPlayers.map((player) => (
                                  <div key={`existing-${player.id}`} className="flex items-center justify-between">
                                    <span>
                                      {player.lastName}, {player.firstName}
                                    </span>
                                    <span className="font-sans text-muted-foreground">{player.rating ?? "-"}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                        </div>
                        <div className="md:col-span-3">
                          <Label className="text-sm font-semibold text-slate-700">Birthdate</Label>
                          <Input
                            type="date"
                            value={formState.birthdate}
                            onChange={(event) => setFormState((prev) => ({ ...prev, birthdate: event.target.value }))}
                            className="mt-1"
                            placeholder="YYYY-MM-DD"
                          />
                        </div>
                        <div className="md:col-span-3">
                          <Label className="text-sm font-semibold text-slate-700">Sex</Label>
                          <Select
                            value={formState.sex}
                            onValueChange={(value) => setFormState((prev) => ({ ...prev, sex: value }))}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="male">Male</SelectItem>
                              <SelectItem value="female">Female</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">Club</Label>
                          <Input
                            className="mt-1"
                            value={formState.club}
                            onChange={(event) => setFormState((prev) => ({ ...prev, club: event.target.value }))}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">Federation</Label>
                          <Select
                            value={formState.federation}
                            onValueChange={(value) => setFormState((prev) => ({ ...prev, federation: value }))}
                          >
                            <SelectTrigger className="mt-1">
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
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">Title</Label>
                          <Input
                            className="mt-1"
                            value={formState.title}
                            onChange={(event) => setFormState((prev) => ({ ...prev, title: event.target.value }))}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">E-mail Address</Label>
                          <Input
                            type="email"
                            className="mt-1"
                            value={formState.email}
                            onChange={(event) => setFormState((prev) => ({ ...prev, email: event.target.value }))}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">Phone Number</Label>
                          <div className="mt-1 flex gap-2">
                            <Select
                              value={formState.phoneCountry}
                              onValueChange={(value) => setFormState((prev) => ({ ...prev, phoneCountry: value }))}
                            >
                              <SelectTrigger className="w-[110px]">
                                <SelectValue placeholder="+1" />
                              </SelectTrigger>
                              <SelectContent>
                                {PHONE_COUNTRY_OPTIONS.map((option) => (
                                  <SelectItem key={option.code} value={option.code}>
                                    {option.label} ({option.code})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              value={formState.phone}
                              onChange={(event) => setFormState((prev) => ({ ...prev, phone: event.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">Labels</Label>
                          <Input
                            className="mt-1"
                            value={formState.labels}
                            onChange={(event) => setFormState((prev) => ({ ...prev, labels: event.target.value }))}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">USCF ID</Label>
                          <Input
                            className="mt-1"
                            value={formState.uscfId}
                            onChange={(event) => setFormState((prev) => ({ ...prev, uscfId: event.target.value }))}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">Rating Classic</Label>
                          <Input
                            className="mt-1"
                            value={formState.rating}
                            onChange={(event) => setFormState((prev) => ({ ...prev, rating: event.target.value }))}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">Rating Rapid</Label>
                          <Input
                            className="mt-1"
                            value={formState.ratingRapid}
                            onChange={(event) => setFormState((prev) => ({ ...prev, ratingRapid: event.target.value }))}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">Local ID</Label>
                          <Input
                            className="mt-1"
                            value={formState.localId}
                            onChange={(event) => setFormState((prev) => ({ ...prev, localId: event.target.value }))}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">Rating Local</Label>
                          <Input
                            className="mt-1"
                            value={formState.ratingLocal}
                            onChange={(event) => setFormState((prev) => ({ ...prev, ratingLocal: event.target.value }))}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">Rating Blitz</Label>
                          <Input
                            className="mt-1"
                            value={formState.ratingBlitz}
                            onChange={(event) => setFormState((prev) => ({ ...prev, ratingBlitz: event.target.value }))}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">USCF Rating</Label>
                          <Input
                            className="mt-1"
                            value={formState.uscfRating}
                            onChange={(event) => setFormState((prev) => {
                              const val = event.target.value;
                              const regConfig = parseTournamentConfig(tournament!);
                              const primary = regConfig.details.primaryRatingSystem || 'uscf';
                              return {
                                ...prev,
                                uscfRating: val,
                                rating: primary === 'uscf' ? val : prev.rating
                              };
                            })}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">FIDE Rating</Label>
                          <Input
                            className="mt-1"
                            value={formState.fideRating}
                            onChange={(event) => setFormState((prev) => {
                              const val = event.target.value;
                              const regConfig = parseTournamentConfig(tournament!);
                              const primary = regConfig.details.primaryRatingSystem || 'uscf';
                              return {
                                ...prev,
                                fideRating: val,
                                rating: primary === 'fide' ? val : prev.rating
                              };
                            })}
                          />
                        </div>
                        <div className="md:col-span-4">
                          <Label className="text-sm font-semibold text-slate-700">Section</Label>
                          <Select
                            value={formState.sectionId || "default"}
                            onValueChange={(value) => {
                              setFormState((prev) => {
                                const nextSection = sections.find((section) => section.id === value);
                                return {
                                  ...prev,
                                  sectionId: value === "default" ? "" : value,
                                  sectionName: nextSection?.name ?? prev.sectionName,
                                };
                              });
                            }}
                            disabled={sections.length === 0}
                          >
                            <SelectTrigger className="mt-1">
                              <SelectValue placeholder={sections.length === 0 ? "Sections unavailable" : "Choose a section"} />
                            </SelectTrigger>
                            <SelectContent>
                              {sections.length === 0 ? (
                                <SelectItem value="default" disabled>
                                  Sections not configured
                                </SelectItem>
                              ) : (
                                sections.map((section) => (
                                  <SelectItem key={section.id} value={section.id}>
                                    {section.name}
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
 
                  </TabsContent>

                  <TabsContent value="payments" className="space-y-4">
                    <div className="rounded-xl border bg-white p-6 shadow-sm">
                      <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-sm font-semibold text-slate-700">Date</Label>
                          <Input
                            type="datetime-local"
                            value={formState.paymentDate}
                            onChange={(event) => setFormState((prev) => ({ ...prev, paymentDate: event.target.value }))}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-sm font-semibold text-slate-700">Method</Label>
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
                          <Label className="text-sm font-semibold text-slate-700">Amount</Label>
                          <Input
                            type="number"
                            value={formState.paymentAmount}
                            onChange={(event) => setFormState((prev) => ({ ...prev, paymentAmount: event.target.value }))}
                          />
                        </div>
                      </div>
                    </div>
                    <p className="px-1 text-xs text-muted-foreground">
                      Payment tracking fields are informational for now and will be stored in a later update.
                    </p>
                  </TabsContent>

                  <TabsContent value="notes" className="space-y-4">
                    <div className="space-y-4 rounded-xl border bg-white p-6 shadow-sm">
                      <div className="space-y-1">
                        <Label className="text-sm font-semibold text-slate-700">Admin&apos;s notes</Label>
                        <Textarea
                          rows={4}
                          value={formState.notesAdmin}
                          onChange={(event) => setFormState((prev) => ({ ...prev, notesAdmin: event.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm font-semibold text-slate-700">Public notes</Label>
                        <Textarea
                          rows={4}
                          value={formState.notesPublic}
                          onChange={(event) => setFormState((prev) => ({ ...prev, notesPublic: event.target.value }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm font-semibold text-slate-700">Private message from player</Label>
                        <Textarea
                          rows={4}
                          value={formState.notesPrivate}
                          onChange={(event) => setFormState((prev) => ({ ...prev, notesPrivate: event.target.value }))}
                        />
                      </div>
                    </div>
                  </TabsContent>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/10 px-8 py-4">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      className="bg-indigo-700 px-5 text-white hover:bg-indigo-800"
                      onClick={() => savePlayerMutation.mutate("close")}
                      disabled={savePlayerMutation.isPending}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      {savePlayerMutation.isPending ? "Saving..." : "Save & Close"}
                    </Button>
                    <Button
                      type="button"
                      className="bg-indigo-600 px-5 text-white hover:bg-indigo-700"
                      onClick={() => savePlayerMutation.mutate("stay")}
                      disabled={savePlayerMutation.isPending}
                    >
                      {isEditing ? (
                        <Save className="mr-2 h-4 w-4" />
                      ) : (
                        <FilePlus2 className="mr-2 h-4 w-4" />
                      )}
                      {savePlayerMutation.isPending ? "Saving..." : isEditing ? "Save" : "Save & Add Another"}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="icon" disabled>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="rounded-md border px-3 py-1 text-sm font-medium text-muted-foreground">
                      {playersLoading ? "" : players.length}
                    </span>
                    <Button type="button" variant="outline" size="icon" disabled>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setLocation(`/tournaments/${tournamentId}/manage`)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
