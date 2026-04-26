import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatePicker } from "@/components/ui/date-picker";
import { parseISO, format as formatDate } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { Search, Plus, Trash2, Loader2, CreditCard, ChevronLeft, ChevronRight, Calendar, User, Info, Trophy, Check, UserRound, Save, FilePlus2, ArrowLeft, Users } from "lucide-react";
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
  const [isDirty, setIsDirty] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

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
      status: "active",
      federation: defaultFederation,
      rating: "",
      ratingLocal: "",
      ratingRapid: "",
      ratingBlitz: "",
      email: "",

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
      lookupMode: "profile" as "profile" | "manual",
    }),
    [defaultFederation],
  );

  const [formState, setFormState] = useState(() => createEmptyForm());
  const { lookupMode } = formState;
  const [searchTerm, setSearchTerm] = useState("");

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
      searchTerm,
    ],
    queryFn: async () => {
      const term = searchTerm.trim();
      if (term.length < 3) return null;
      const params = new URLSearchParams({ q: term, limit: "10" });
      return await apiRequest(`/api/rating-lookup?${params.toString()}`);
    },
    enabled: formState.lookupMode === "profile" && searchTerm.trim().length >= 3,
    staleTime: 1000 * 30,
    retry: false,
  });

  const lookupData = formState.lookupMode === "profile" ? lookupDataRaw : null;

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

  const isSearchDirty = searchTerm.length > 0;

  const savePlayerMutation = useMutation<void, Error, "close" | "stay" | "autosave">({
    mutationFn: async (mode) => {
      const selectedSectionDetails = formState.sectionId
        ? sections.find((section) => section.id === formState.sectionId)
        : formState.sectionName
          ? sections.find((section) => section.name === formState.sectionName)
          : undefined;
      const payload = {
        firstName: formState.firstName.trim() || (mode === "autosave" ? "..." : "Player"),
        lastName: formState.lastName.trim() || (mode === "autosave" ? "..." : `#${players.length + 1}`),
        rating: parseInt(formState.rating, 10) || 0,
        federation: formState.federation || "United States",
        sectionId: formState.sectionId || selectedSectionDetails?.id || null,
        sectionName: (selectedSectionDetails?.name ?? formState.sectionName)?.trim() || null,
        uscfRating: parseInt(formState.uscfRating, 10) || null,
        fideRating: parseInt(formState.fideRating, 10) || null,
        birthdate: formState.birthdate || null,
        sex: formState.sex || null,
        email: formState.email || null,

        club: formState.club || null,
        title: formState.title || null,
        localId: formState.localId || null,
        ratingLocal: parseInt(formState.ratingLocal, 10) || null,
        ratingRapid: parseInt(formState.ratingRapid, 10) || null,
        ratingBlitz: parseInt(formState.ratingBlitz, 10) || null,
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
      if (mode !== "autosave") {
        toast({ title: isEditing ? "Player updated" : "Player added" });
      }
      queryClient.invalidateQueries({ queryKey: [`/api/tournaments/${tournamentId}/players`] });
      if (isEditing && resolvedPlayerId) {
        queryClient.invalidateQueries({ queryKey: ["player-detail", tournamentId, resolvedPlayerId] });
      }
      
      setIsDirty(false);
      setLastSaved(new Date());

      if (mode === "close") {
        setLocation(`/tournaments/${tournamentId}/manage`);
        return;
      }
      if (!isEditing && mode !== "autosave" && mode !== "stay") {
         // If we just created, transition to edit mode or clear
      }
      if (!isEditing && mode === "stay") {
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
    if (!isDirty || !isEditing) return;
    const timer = setTimeout(() => {
      savePlayerMutation.mutate("autosave");
    }, 1500);
    return () => clearTimeout(timer);
  }, [isDirty, isEditing, formState, savePlayerMutation]);

  const markDirty = () => setIsDirty(true);

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
      birthdate: editingPlayer.birthdate ?? prev.birthdate,
      sex: editingPlayer.sex ?? prev.sex,
      email: editingPlayer.email ?? prev.email,

      club: editingPlayer.club ?? prev.club,
      title: editingPlayer.title ?? prev.title,
      localId: editingPlayer.localId ?? prev.localId,
      ratingLocal: editingPlayer.ratingLocal != null ? String(editingPlayer.ratingLocal) : prev.ratingLocal,
      ratingRapid: editingPlayer.ratingRapid != null ? String(editingPlayer.ratingRapid) : prev.ratingRapid,
      ratingBlitz: editingPlayer.ratingBlitz != null ? String(editingPlayer.ratingBlitz) : prev.ratingBlitz,
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
    // If switching to manual, ensure fields are cleared so search results don't ghost
    if (formState.lookupMode === "manual" && !isEditing) {
      setFormState(prev => ({ ...prev, firstName: "", lastName: "" }));
      setSearchTerm("");
    }
  }, [formState.lookupMode, isEditing]);

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
    markDirty();

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
    setSearchTerm("");
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
    markDirty();
    setCombinedNameInput([cleanedLast, cleanedFirst].filter(Boolean).join(", "));
    setActiveTab("basic");
  };

  if (tournamentLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent">
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
    <div className="min-h-screen bg-transparent py-10">
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
                      <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-semibold text-slate-800">
                          {isEditing ? "Edit Player" : "Add Player"}
                        </h1>
                        <div className="flex items-center gap-1.5 mt-1">
                          {savePlayerMutation.isPending ? (
                            <span className="flex items-center gap-1.5 text-[10px] font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              Saving...
                            </span>
                          ) : isDirty ? (
                            <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                              Unsaved changes
                            </span>
                          ) : lastSaved ? (
                            <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
                              <Check className="h-2.5 w-2.5" />
                              Autosaved
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {isEditing
                          ? "Update roster information, payments, and notes for this participant."
                          : "Complete the player details below."}
                      </p>
                    </div>
                  </div>
                  <TabsList className="flex w-full flex-nowrap overflow-x-auto no-scrollbar justify-start md:grid md:grid-cols-3 gap-2 rounded-full bg-white px-1 py-1 shadow-inner">
                    <TabsTrigger
                      value="basic"
                      className="flex-none md:flex-1 rounded-full px-6 py-2 text-xs sm:text-sm font-semibold data-[state=active]:bg-indigo-600 data-[state=active]:text-white whitespace-nowrap transition-all"
                    >
                      Basic
                    </TabsTrigger>
                    <TabsTrigger
                      value="payments"
                      className="flex-none md:flex-1 rounded-full px-6 py-2 text-xs sm:text-sm font-semibold data-[state=active]:bg-indigo-600 data-[state=active]:text-white whitespace-nowrap transition-all"
                    >
                      Payments
                    </TabsTrigger>
                    <TabsTrigger
                      value="notes"
                      className="flex-none md:flex-1 rounded-full px-6 py-2 text-xs sm:text-sm font-semibold data-[state=active]:bg-indigo-600 data-[state=active]:text-white whitespace-nowrap transition-all"
                    >
                      Notes
                    </TabsTrigger>
                  </TabsList>
                </div>

                <div className="flex-1 overflow-y-auto px-8 py-6">
                  <TabsContent value="basic" className="space-y-6">
                    <div className="rounded-xl border bg-white shadow-sm">
                      <div className="flex flex-col">
                        {/* Search and Mode Section - Full Width */}
                        <div className="border-b bg-slate-50/50 px-8 py-8 space-y-8">
                          <div className="space-y-6">
                            <RadioGroup
                              value={lookupMode}
                              onValueChange={(value) => {
                                const newMode = value as "profile" | "manual";
                                setFormState(prev => ({ ...prev, lookupMode: newMode }));
                                if (newMode === "manual" && !isEditing) {
                                  setFormState(prev => ({ ...prev, firstName: "", lastName: "" }));
                                  setSearchTerm("");
                                }
                              }}
                            >
                               <div className="grid gap-4 sm:grid-cols-2 lg:max-w-2xl">
                                <label
                                  className={cn(
                                    "flex flex-1 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 transition hover:border-blue-300",
                                    lookupMode === "profile" && "border-blue-500 bg-blue-50",
                                  )}
                                >
                                  <RadioGroupItem value="profile" id="lookup-profile" />
                                  <div className="grid gap-1.5 leading-none">
                                    <p className="text-sm font-medium text-slate-900">Use saved profile</p>
                                    <p className="text-xs text-slate-500">Search USCF and FIDE player lists.</p>
                                  </div>
                                </label>
                                <label
                                  className={cn(
                                    "flex flex-1 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-4 transition hover:border-blue-300",
                                    lookupMode === "manual" && "border-blue-500 bg-blue-50",
                                  )}
                                >
                                  <RadioGroupItem value="manual" id="lookup-manual" />
                                  <div className="grid gap-1.5 leading-none">
                                    <p className="text-sm font-medium text-slate-900">Manual entry</p>
                                    <p className="text-xs text-slate-500">Enter all details yourself.</p>
                                  </div>
                                </label>
                              </div>
                            </RadioGroup>

                            {lookupMode === "profile" && (
                              <div className="space-y-4">
                                <Label className="text-sm font-medium text-slate-700">Search players</Label>
                                <div className="relative">
                                  <Input
                                    value={searchTerm}
                                    onChange={(event) => setSearchTerm(event.target.value)}
                                    placeholder="Type name or ID (Min 3 chars)..."
                                    autoComplete="off"
                                    className="h-11 pl-10 pr-10 focus-visible:ring-blue-500/30"
                                  />
                                  <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                  {isSearchDirty && (
                                    <button
                                      type="button"
                                      onClick={handleClearSearch}
                                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </div>

                                {lookupFetching ? (
                                  <div className="my-2 flex flex-col items-center justify-center gap-3 py-8 rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
                                    <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                                    <span className="text-sm font-medium text-slate-500">Searching USCF & FIDE databases...</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between">
                                    {searchTerm.trim().length < 3 ? (
                                      <p className="text-xs text-slate-500">Enter at least three characters to search both databases.</p>
                                    ) : (
                                      <p className="text-xs text-slate-500">
                                        Showing the best matches from the official USCF and FIDE directories.
                                      </p>
                                    )}
                                  </div>
                                )}

                                {searchTerm.trim().length >= 3 && (totalLookupResults > 0 || matchingTournamentPlayers.length > 0) && (
                                  <div className="space-y-5">
                                    {totalLookupResults > 0 && (
                                      <div className="space-y-2">
                                        <p className="text-[11px] uppercase tracking-wide text-slate-500">USCF & FIDE results</p>
                                        <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                                          {(Object.keys(SOURCE_META) as SourceKey[]).map((source) => {
                                            const items = lookupResults[source];
                                            return items.map((result) => (
                                              <button
                                                key={`${source}-${result.id}`}
                                                type="button"
                                                onClick={() => handleResultClick(source, result)}
                                                className="group w-full rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition-all hover:bg-gray-50"
                                              >
                                                <div className="flex items-center justify-between gap-4">
                                                  <div className="flex items-center gap-3">
                                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100 font-medium text-gray-500 transition group-hover:text-gray-900">
                                                      {source === 'uscf' ? 'US' : 'FI'}
                                                    </div>
                                                    <div className="space-y-0.5">
                                                      <p className="text-sm font-semibold text-gray-900">{result.name}</p>
                                                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                                                        <span className="font-medium text-gray-600">{source.toUpperCase()} · #{result.id}</span>
                                                        {result.location && <span className="text-gray-300">|</span>}
                                                        {result.location && <span>{result.location}</span>}
                                                      </div>
                                                    </div>
                                                  </div>
                                                  <div className="bg-gray-900 text-white rounded px-2.5 py-1 text-xs font-medium">
                                                    {result.ratingDisplay ?? result.rating ?? "No Rating"}
                                                  </div>
                                                </div>
                                              </button>
                                            ));
                                          })}
                                        </div>
                                      </div>
                                    )}

                                    {matchingTournamentPlayers.length > 0 && (
                                      <div className="space-y-2">
                                        <p className="text-[11px] uppercase tracking-wide text-slate-500">Tournament roster matches</p>
                                        <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                                          {matchingTournamentPlayers.map((player) => (
                                            <button
                                              key={player.id}
                                              type="button"
                                              onClick={() => {
                                                setFormState(prev => ({
                                                  ...prev,
                                                  firstName: player.firstName ?? "",
                                                  lastName: player.lastName ?? "",
                                                  rating: player.rating ? String(player.rating) : "",
                                                }));
                                                setSearchTerm(`${player.firstName} ${player.lastName}`);
                                              }}
                                              className="w-full rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm transition hover:bg-gray-50"
                                            >
                                              <div className="flex items-center justify-between gap-3">
                                                <div>
                                                  <p className="text-sm font-semibold text-slate-900">
                                                    {player.firstName} {player.lastName}
                                                  </p>
                                                  <p className="text-[11px] text-slate-500">Registered for this event</p>
                                                </div>
                                                {player.rating !== null && (
                                                  <span className="text-sm font-medium text-slate-700">{player.rating}</span>
                                                )}
                                              </div>
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Identity and Details Section - Full Width with Grid */}
                        <div className="px-8 py-8 space-y-10">
                          <div className="space-y-6">
                            <div className="space-y-4">
                              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Player Identity</p>
                              <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium text-slate-700">First name <span className="text-red-500">*</span></Label>
                                  <Input
                                    value={formState.firstName}
                                    onChange={(e) => {
                                      setFormState(prev => ({ ...prev, firstName: e.target.value }));
                                      markDirty();
                                    }}
                                    required
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium text-slate-700">Last name <span className="text-red-500">*</span></Label>
                                  <Input
                                    value={formState.lastName}
                                    onChange={(e) => {
                                      setFormState(prev => ({ ...prev, lastName: e.target.value }));
                                      markDirty();
                                    }}
                                    required
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium text-slate-700">USCF ID</Label>
                                  <Input
                                    value={formState.uscfId}
                                    onChange={(e) => {
                                      setFormState(prev => ({ ...prev, uscfId: e.target.value }));
                                      markDirty();
                                    }}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium text-slate-700">FIDE ID</Label>
                                  <Input
                                    value={formState.localId}
                                    onChange={(e) => {
                                      setFormState(prev => ({ ...prev, localId: e.target.value }));
                                      markDirty();
                                    }}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium text-slate-700">USCF Rating</Label>
                                  <Input
                                    type="number"
                                    value={formState.uscfRating}
                                    onChange={(e) => {
                                      setFormState(prev => ({ ...prev, uscfRating: e.target.value }));
                                      markDirty();
                                    }}
                                  />
                                </div>
                                <div className="space-y-2">
                                  <Label className="text-sm font-medium text-slate-700">FIDE Rating</Label>
                                  <Input
                                    type="number"
                                    value={formState.fideRating}
                                    onChange={(e) => {
                                      setFormState(prev => ({ ...prev, fideRating: e.target.value }));
                                      markDirty();
                                    }}
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="grid gap-5 md:grid-cols-2">
                              <div>
                                <Label className="text-sm font-semibold text-slate-700 mb-1 block">Birthdate</Label>
                                <DatePicker
                                  date={formState.birthdate ? parseISO(formState.birthdate) : null}
                                  setDate={(date) => {
                                    setFormState((prev) => ({ ...prev, birthdate: date ? formatDate(date, "yyyy-MM-dd") : "" }));
                                    markDirty();
                                  }}
                                  placeholder="Select birth date"
                                  className="w-full h-11 border-slate-200 rounded-xl text-sm"
                                />
                              </div>
                              <div>
                                <Label className="text-sm font-semibold text-slate-700">Sex</Label>
                                <Select
                                  value={formState.sex}
                                  onValueChange={(value) => {
                                    setFormState((prev) => ({ ...prev, sex: value }));
                                    markDirty();
                                  }}
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
                            </div>

                            <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
                              <div>
                                <Label className="text-sm font-semibold text-slate-700">Club</Label>
                                <Input
                                  className="mt-1"
                                  value={formState.club}
                                  onChange={(event) => {
                                    setFormState((prev) => ({ ...prev, club: event.target.value }));
                                    markDirty();
                                  }}
                                />
                              </div>
                              <div>
                                <Label className="text-sm font-semibold text-slate-700">Federation</Label>
                                <Select
                                  value={formState.federation}
                                  onValueChange={(value) => {
                                    setFormState((prev) => ({ ...prev, federation: value }));
                                    markDirty();
                                  }}
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
                            </div>

                            <div className="grid gap-5 md:grid-cols-2">
                              <div>
                                <Label className="text-sm font-semibold text-slate-700">Title</Label>
                                <Input
                                  className="mt-1"
                                  value={formState.title}
                                  onChange={(event) => {
                                    setFormState((prev) => ({ ...prev, title: event.target.value }));
                                    markDirty();
                                  }}
                                />
                              </div>
                              <div>
                                <Label className="text-sm font-semibold text-slate-700">E-mail Address</Label>
                                <Input
                                  type="email"
                                  className="mt-1"
                                  value={formState.email}
                                  onChange={(event) => {
                                    setFormState((prev) => ({ ...prev, email: event.target.value }));
                                    markDirty();
                                  }}
                                />
                              </div>
                            </div>

                            <div className="space-y-2">
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
                                  markDirty();
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
                            onChange={(event) => {
                              setFormState((prev) => ({ ...prev, paymentDate: event.target.value }));
                              markDirty();
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-sm font-semibold text-slate-700">Method</Label>
                          <Select
                            value={formState.paymentMethod}
                            onValueChange={(value) => {
                              setFormState((prev) => ({ ...prev, paymentMethod: value }));
                              markDirty();
                            }}
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
                            onChange={(event) => {
                              setFormState((prev) => ({ ...prev, paymentAmount: event.target.value }));
                              markDirty();
                            }}
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
                          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                            setFormState((prev) => ({ ...prev, notesAdmin: event.target.value }));
                            markDirty();
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm font-semibold text-slate-700">Public notes</Label>
                        <Textarea
                          rows={4}
                          value={formState.notesPublic}
                          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                            setFormState((prev) => ({ ...prev, notesPublic: event.target.value }));
                            markDirty();
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-sm font-semibold text-slate-700">Private message from player</Label>
                        <Textarea
                          rows={4}
                          value={formState.notesPrivate}
                          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
                            setFormState((prev) => ({ ...prev, notesPrivate: event.target.value }));
                            markDirty();
                          }}
                        />
                      </div>
                    </div>
                  </TabsContent>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-t bg-muted/10 px-8 py-4">
                  <div className="flex items-center gap-2">
                    {isEditing ? (
                      <Button
                        type="button"
                        className="bg-slate-800 px-8 text-white hover:bg-slate-900 shadow-sm"
                        onClick={() => setLocation(`/tournaments/${tournamentId}/manage`)}
                      >
                        Done
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          className="bg-indigo-700 px-5 text-white hover:bg-indigo-800"
                          onClick={() => savePlayerMutation.mutate("close")}
                          disabled={savePlayerMutation.isPending}
                        >
                          <Save className="mr-2 h-4 w-4" />
                          {savePlayerMutation.isPending ? "Creating..." : "Create & Close"}
                        </Button>
                        <Button
                          type="button"
                          className="bg-indigo-600 px-5 text-white hover:bg-indigo-700"
                          onClick={() => savePlayerMutation.mutate("stay")}
                          disabled={savePlayerMutation.isPending}
                        >
                          <FilePlus2 className="mr-2 h-4 w-4" />
                          {savePlayerMutation.isPending ? "Creating..." : "Create & Add Another"}
                        </Button>
                      </>
                    )}
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
