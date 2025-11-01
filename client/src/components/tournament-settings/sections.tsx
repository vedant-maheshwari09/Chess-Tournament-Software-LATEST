import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type ChessResultsConfig,
  type FideRegistrationData,
  type UscfReportData,
} from "@/lib/tournament-config";
import { cn } from "@/lib/utils";
import { Download, ExternalLink } from "lucide-react";

interface FideRegistrationSectionProps {
  value: FideRegistrationData;
  onChange: (update: Partial<FideRegistrationData>) => void;
  tournamentName?: string;
  tournamentCity?: string;
  federationName?: string;
  onDownloadTrf?: () => void;
  onDownloadRegistration?: () => void;
  onDownloadFa1?: () => void;
  onDownloadIa1?: () => void;
}

const fideToggleFields: Array<{ key: keyof FideRegistrationData; label: string }> = [
  { key: "nationalChampionship", label: "National Championship 1.43a" },
  { key: "titleNormsAvailable", label: "Title norms available" },
  { key: "femaleOnly", label: "Female players only" },
  { key: "allDigitalClocks", label: "All digital clocks" },
  { key: "officialCalendar", label: "Official FIDE calendar" },
  { key: "gmNormsAvailable", label: "GM/WGM norms available" },
  { key: "willProvidePgn", label: "Will PGN be provided" },
  { key: "internetTransmission", label: "Internet transmission" },
];

const fideAgeLimitOptions = [
  "None",
  "Under 8",
  "Under 10",
  "Under 12",
  "Under 14",
  "Under 16",
  "Under 18",
  "Under 20",
  "Senior 50+",
  "Senior 65+",
];

const US_STATES: Array<{ code: string; name: string }> = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" },
  { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" },
  { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" },
  { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" },
  { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

export function FideRegistrationSection({
  value,
  onChange,
  tournamentName,
  tournamentCity,
  federationName,
  onDownloadTrf,
  onDownloadRegistration,
  onDownloadFa1,
  onDownloadIa1,
}: FideRegistrationSectionProps) {
  const [activeTab, setActiveTab] = useState<"registration" | "norm">("registration");
  const toggleColumns = useMemo(() => {
    const midpoint = Math.ceil(fideToggleFields.length / 2);
    return [fideToggleFields.slice(0, midpoint), fideToggleFields.slice(midpoint)];
  }, []);

  return (
    <Tabs value={activeTab} onValueChange={(next) => setActiveTab(next as "registration" | "norm")} className="space-y-6">
      <TabsList className="flex w-full rounded-t-lg border border-slate-200 bg-slate-100 p-1">
        <TabsTrigger
          value="registration"
          className="flex-1 rounded-md px-4 py-3 text-sm font-semibold text-slate-600 transition data-[state=active]:bg-white data-[state=active]:text-indigo-700 data-[state=active]:shadow-sm"
        >
          FIDE Registration Form
        </TabsTrigger>
        <TabsTrigger
          value="norm"
          className="flex-1 rounded-md px-4 py-3 text-sm font-semibold text-slate-600 transition data-[state=active]:bg-white data-[state=active]:text-indigo-700 data-[state=active]:shadow-sm"
        >
          FIDE / IA Norm Report Form
        </TabsTrigger>
      </TabsList>

      <TabsContent value="registration" className="focus-visible:outline-none">
        <Card className="shadow-sm">
          <CardHeader className="border-b pb-6">
            <CardTitle className="text-2xl font-semibold text-indigo-900">FIDE Registration Form</CardTitle>
            <CardDescription>Provide the details required by the Events Commission to list your tournament.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Details</h3>
              <div className="space-y-2">
                <Label>Prize fund</Label>
                <Input value={value.prizeFund ?? ""} onChange={(event) => onChange({ prizeFund: event.target.value })} />
              </div>
              <div className="grid gap-6 md:grid-cols-2">
                {toggleColumns.map((group, index) => (
                  <div key={index} className="space-y-3">
                    {group.map(({ key, label }) => (
                      <label key={key as string} className="flex items-start gap-3 text-sm leading-tight">
                        <Checkbox
                          checked={Boolean(value[key])}
                          onCheckedChange={(checked) =>
                            onChange({ [key]: checked === true } as Partial<FideRegistrationData>)
                          }
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Players</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Expected number of players</Label>
                  <Input value={value.expectedPlayers ?? ""} onChange={(event) => onChange({ expectedPlayers: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Maximum rating</Label>
                  <Input value={value.maxRating ?? ""} onChange={(event) => onChange({ maxRating: event.target.value })} />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Age limit</Label>
                  <Select value={value.ageLimit ?? "None"} onValueChange={(next) => onChange({ ageLimit: next })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select age limit" />
                    </SelectTrigger>
                    <SelectContent>
                      {fideAgeLimitOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Additional notes</Label>
                  <Textarea
                    rows={3}
                    placeholder="Include national or FIDE event identifiers, or special remarks."
                    value={value.remarks ?? ""}
                    onChange={(event) => onChange({ remarks: event.target.value })}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Arbiters</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Surname, name</Label>
                  <Input value={value.arbiterSurname ?? ""} onChange={(event) => onChange({ arbiterSurname: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Input value={value.arbiterRole ?? ""} onChange={(event) => onChange({ arbiterRole: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Federation</Label>
                  <Input value={value.arbiterFederation ?? ""} onChange={(event) => onChange({ arbiterFederation: event.target.value })} />
                </div>
              </div>
            </section>

            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                onClick={onDownloadRegistration}
                disabled={!onDownloadRegistration}
              >
                <Download className="mr-2 h-4 w-4" /> Download registration data
              </Button>
              <Button
                type="button"
                variant="outline"
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={onDownloadTrf}
                disabled={!onDownloadTrf}
              >
                <Download className="mr-2 h-4 w-4" /> Download FIDE TRF16
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="norm" className="focus-visible:outline-none">
        <Card className="shadow-sm">
          <CardHeader className="border-b pb-6">
            <CardTitle className="text-2xl font-semibold text-indigo-900">FIDE / International Arbiter Norm Report Form</CardTitle>
            <CardDescription>Record the details needed when uploading FA1 or IA1 forms.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Tournament</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={tournamentName ?? ""} readOnly className="bg-muted/60" />
                </div>
                <div className="space-y-2">
                  <Label>Venue</Label>
                  <Input
                    value={value.tournamentVenue ?? tournamentCity ?? ""}
                    onChange={(event) => onChange({ tournamentVenue: event.target.value })}
                  />
                </div>
                <div className="space-y-2 md:col-span-2 lg:col-span-3">
                  <Label>FIDE Rating Server Event Code(s)</Label>
                  <Input value={value.eventCodes ?? ""} onChange={(event) => onChange({ eventCodes: event.target.value })} />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Norm for</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>Last name</Label>
                  <Input value={value.normLastName ?? ""} onChange={(event) => onChange({ normLastName: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>First name</Label>
                  <Input value={value.normFirstName ?? ""} onChange={(event) => onChange({ normFirstName: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>FIDE ID</Label>
                  <Input value={value.normFideId ?? ""} onChange={(event) => onChange({ normFideId: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Federation</Label>
                  <Input
                    value={value.normFederation ?? federationName ?? ""}
                    onChange={(event) => onChange({ normFederation: event.target.value })}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Signed by</h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-2">
                  <Label>Surname, name</Label>
                  <Input value={value.signedName ?? ""} onChange={(event) => onChange({ signedName: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Input value={value.signedRole ?? ""} onChange={(event) => onChange({ signedRole: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Federation</Label>
                  <Input
                    value={value.signedFederation ?? federationName ?? ""}
                    onChange={(event) => onChange({ signedFederation: event.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input type="date" value={value.signedDate ?? ""} onChange={(event) => onChange({ signedDate: event.target.value })} />
                </div>
              </div>
            </section>

            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                onClick={onDownloadFa1}
                disabled={!onDownloadFa1}
              >
                <Download className="mr-2 h-4 w-4" /> Download FA1 Form
              </Button>
              <Button
                type="button"
                variant="outline"
                className="bg-indigo-600 text-white hover:bg-indigo-700"
                onClick={onDownloadIa1}
                disabled={!onDownloadIa1}
              >
                <Download className="mr-2 h-4 w-4" /> Download IA1 Form
              </Button>
            </div>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

interface UscfReportSectionProps {
  value: UscfReportData;
  onChange: (update: Partial<UscfReportData>) => void;
  onDownload?: () => void;
}

export function UscfReportSection({ value, onChange, onDownload }: UscfReportSectionProps) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b pb-6">
        <CardTitle className="text-2xl font-semibold text-indigo-900">USCF Report</CardTitle>
        <CardDescription>Match the official USCF post-tournament summary layout before exporting.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8 pt-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="uscf-state">State</Label>
            <Select
              value={value.state ?? "unset"}
              onValueChange={(next) => onChange({ state: next === "unset" ? undefined : next })}
            >
              <SelectTrigger id="uscf-state">
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">Select state</SelectItem>
                {US_STATES.map((state) => (
                  <SelectItem key={state.code} value={state.code}>
                    {state.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="uscf-zip">ZIP Code</Label>
            <Input
              id="uscf-zip"
              value={value.zipCode ?? ""}
              onChange={(event) => onChange({ zipCode: event.target.value })}
            />
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="uscf-affiliate">Affiliate ID</Label>
            <Input
              id="uscf-affiliate"
              value={value.affiliateId ?? ""}
              onChange={(event) => onChange({ affiliateId: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="uscf-director">Tournament director</Label>
            <Input
              id="uscf-director"
              value={value.tournamentDirector ?? ""}
              onChange={(event) => onChange({ tournamentDirector: event.target.value })}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="uscf-assistant">Assistant tournament director</Label>
          <Input
            id="uscf-assistant"
            value={value.assistantDirector ?? ""}
            onChange={(event) => onChange({ assistantDirector: event.target.value })}
          />
        </div>

        <div className="space-y-3">
          <Label>Send cross table to</Label>
          <RadioGroup
            value={value.sendCrossTableTo ?? "none"}
            onValueChange={(next) => onChange({ sendCrossTableTo: next as UscfReportData["sendCrossTableTo"] })}
            className="flex flex-wrap gap-6"
          >
            {[
              { value: "affiliate", label: "Affiliate" },
              { value: "tournament_director", label: "Tournament Director" },
              { value: "none", label: "None" },
            ].map((option) => (
              <label key={option.value} className="flex items-center gap-2 text-sm text-slate-700">
                <RadioGroupItem value={option.value} />
                <span>{option.label}</span>
              </label>
            ))}
          </RadioGroup>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <Checkbox
            id="uscf-scholastic"
            checked={Boolean(value.scholastic)}
            onCheckedChange={(checked) => onChange({ scholastic: checked === true })}
          />
          <div className="space-y-1">
            <Label htmlFor="uscf-scholastic" className="text-sm font-medium text-slate-700">
              Scholastic event
            </Label>
            <p className="text-xs text-muted-foreground">Identify scholastic tournaments for USCF reporting.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="uscf-grand-prix">Grand Prix points (if any)</Label>
          <Input
            id="uscf-grand-prix"
            value={value.grandPrixPoints ?? ""}
            onChange={(event) => onChange({ grandPrixPoints: event.target.value })}
          />
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            className="bg-indigo-600 text-white hover:bg-indigo-700"
            onClick={onDownload}
          >
            <Download className="mr-2 h-4 w-4" />
            Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface ChessResultsSettingsCardProps {
  value: ChessResultsConfig;
  onChange: (update: Partial<ChessResultsConfig>) => void;
  onTest: () => void;
  onSync: () => void;
  testing: boolean;
  syncing: boolean;
  disabled?: boolean;
  onDownload?: () => void;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export function ChessResultsSettingsCard({
  value,
  onChange,
  onTest,
  onSync,
  testing,
  syncing,
  disabled,
  onDownload,
  enabled,
  onEnabledChange,
}: ChessResultsSettingsCardProps) {
  const syncDisabled = value.syncMode === "disabled" || disabled;
  const trimmedTournamentId = value.tournamentId?.trim();
  const chessResultsUrl = trimmedTournamentId
    ? `https://chess-results.com/tnr${trimmedTournamentId}.aspx`
    : "https://chess-results.com";

  const openTournamentPage = () => {
    if (!trimmedTournamentId) return;
    window.open(chessResultsUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b pb-6 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-2xl font-semibold text-indigo-900">Chess-Results Server Integration</CardTitle>
          <CardDescription>
            <a
              href="https://chess-results.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-indigo-700 hover:text-indigo-800 hover:underline"
            >
              https://chess-results.com
              <ExternalLink className="h-4 w-4" />
            </a>
          </CardDescription>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </CardHeader>
      {enabled && (
        <CardContent className="space-y-8 pt-6">
          <div className="grid gap-8 md:grid-cols-2">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Synchronization</h3>
              <RadioGroup
                value={value.syncMode}
                onValueChange={(next) => onChange({ syncMode: next as ChessResultsConfig["syncMode"] })}
                className="space-y-3"
              >
                {[
                  { key: "disabled", label: "Disabled", hint: "Do not export or sync." },
                  { key: "manual", label: "Manual", hint: "Run exports on demand." },
                  { key: "automatic", label: "Automatic", hint: "Sync on a repeating schedule." },
                ].map((option) => (
                  <label
                    key={option.key}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm",
                      value.syncMode === option.key && "border-indigo-500"
                    )}
                  >
                    <RadioGroupItem value={option.key} className="mt-1" />
                    <div className="space-y-1">
                      <span className="text-sm font-medium text-slate-700">{option.label}</span>
                      <p className="text-xs text-muted-foreground">{option.hint}</p>
                    </div>
                    {value.syncMode === option.key && <Badge variant="secondary" className="ml-auto">Active</Badge>}
                  </label>
                ))}
              </RadioGroup>
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Export scope</h3>
              <RadioGroup
                value={value.exportMode}
                onValueChange={(next) => onChange({ exportMode: next as ChessResultsConfig["exportMode"] })}
                className="space-y-3"
              >
                {[
                  { key: "page", label: "Tournament Page" },
                  { key: "participants", label: "Tournament Page + Participants" },
                  { key: "participants_standings", label: "Tournament Page + Participants + Standings" },
                  {
                    key: "participants_standings_rounds",
                    label: "Tournament Page + Participants + Standings + Rounds",
                  },
                ].map((option) => (
                  <label
                    key={option.key}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm",
                      value.exportMode === option.key && "border-indigo-500"
                    )}
                  >
                    <RadioGroupItem value={option.key} className="mt-1" />
                    <span className="text-sm font-medium text-slate-700">{option.label}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="chess-results-endpoint">Chess-Results endpoint</Label>
              <Input
                id="chess-results-endpoint"
                value={value.endpoint ?? ""}
                placeholder="https://chess-results.com/tnr_api/"
                onChange={(event) => onChange({ endpoint: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chess-results-tnr">Tournament number (TNR)</Label>
              <Input
                id="chess-results-tnr"
                value={value.tournamentId ?? ""}
                placeholder="e.g. 842391"
                onChange={(event) => onChange({ tournamentId: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chess-results-pno">Organizer personal number (PNo)</Label>
              <Input
                id="chess-results-pno"
                value={value.personalNumber ?? ""}
                placeholder="Assigned Chess-Results account ID"
                onChange={(event) => onChange({ personalNumber: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chess-results-password">Password</Label>
              <Input
                id="chess-results-password"
                type="password"
                value={value.password ?? ""}
                placeholder="••••••••"
                onChange={(event) => onChange({ password: event.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="chess-results-organizer">Organizer name</Label>
              <Input
                id="chess-results-organizer"
                value={value.organizerName ?? ""}
                onChange={(event) => onChange({ organizerName: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="chess-results-email">Organizer email</Label>
              <Input
                id="chess-results-email"
                type="email"
                value={value.organizerEmail ?? ""}
                onChange={(event) => onChange({ organizerEmail: event.target.value })}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="chess-results-event-code">Event code or remarks</Label>
              <Input
                id="chess-results-event-code"
                value={value.eventCode ?? ""}
                onChange={(event) => onChange({ eventCode: event.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="chess-results-interval">Auto-sync interval (minutes)</Label>
              <Input
                id="chess-results-interval"
                type="number"
                min={5}
                step={5}
                value={value.autoSyncIntervalMinutes ? String(value.autoSyncIntervalMinutes) : ""}
                onChange={(event) => {
                  const trimmed = event.target.value.trim();
                  if (!trimmed) {
                    onChange({ autoSyncIntervalMinutes: undefined });
                    return;
                  }
                  const parsed = Number(trimmed);
                  onChange({
                    autoSyncIntervalMinutes: Number.isFinite(parsed) ? parsed : value.autoSyncIntervalMinutes,
                  });
                }}
              />
            </div>
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600">
              Automatic mode will upload participants, pairings, and standings on the interval provided. Manual mode only
              syncs when you trigger it.
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-sm">
            <div>
              <p className="font-medium text-slate-700">Last synchronization</p>
              <p className="text-xs text-muted-foreground">
                {value.lastSyncAt ? new Date(value.lastSyncAt).toLocaleString() : "No syncs recorded yet."}
              </p>
              {value.lastSyncMessage && (
                <p className="text-xs text-muted-foreground">{value.lastSyncMessage}</p>
              )}
            </div>
            <Badge
              className={cn(
                value.lastSyncStatus === "success" && "bg-green-600 text-white",
                value.lastSyncStatus === "error" && "bg-red-600 text-white",
                value.lastSyncStatus === "pending" && "bg-yellow-500 text-white",
                !value.lastSyncStatus && "bg-slate-200 text-slate-600"
              )}
            >
              {value.lastSyncStatus ? value.lastSyncStatus.toUpperCase() : "NEVER"}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onTest} disabled={testing || syncDisabled}>
              {testing ? "Testing..." : "Test connection"}
            </Button>
            <Button type="button" onClick={onSync} disabled={syncDisabled || syncing}>
              {syncing ? "Syncing..." : "Sync now"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={openTournamentPage}
              disabled={!trimmedTournamentId}
            >
              <ExternalLink className="mr-2 h-4 w-4" /> View event on Chess-Results
            </Button>
            <Button type="button" variant="outline" onClick={onDownload}>
              <Download className="mr-2 h-4 w-4" /> Download configuration
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
