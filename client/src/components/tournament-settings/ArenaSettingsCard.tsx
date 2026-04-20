import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Calculator } from "lucide-react";

interface ArenaScoringConfig {
  winPoints: number;
  drawPoints: number;
  lossPoints: number;
  streakThreshold: number;
  onFireWinPoints: number;
  onFireDrawPoints: number;
}

interface ArenaSettingsCardProps {
  value: {
    durationMinutes: number;
    scoring: ArenaScoringConfig;
  };
  onChange: (update: Partial<ArenaSettingsCardProps['value']>) => void;
}

function ScoreInput({ id, label, value, onChange, description }: { id: string; label: string; value: number; onChange: (v: string) => void; description?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={-1}
        max={10}
        step="0.25"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(event.target.value)}
      />
      {description && <p className="text-[10px] text-muted-foreground">{description}</p>}
    </div>
  );
}

export function ArenaSettingsCard({ value, onChange }: ArenaSettingsCardProps) {
  const updateScoring = (updates: Partial<ArenaScoringConfig>) => {
    onChange({
      scoring: { ...value.scoring, ...updates },
    });
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader className="border-b pb-6">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-indigo-600" />
            <div>
              <CardTitle className="text-xl font-semibold text-indigo-900">Arena Timing</CardTitle>
              <CardDescription>Configure the duration of the tournament.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="arena-duration">Duration (Minutes)</Label>
              <Input
                id="arena-duration"
                type="number"
                min={1}
                value={value.durationMinutes}
                onChange={(e) => onChange({ durationMinutes: parseInt(e.target.value) || 1 })}
              />
              <p className="text-sm text-muted-foreground">The arena will automatically conclude after this time.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="border-b pb-6">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-indigo-600" />
            <div>
              <CardTitle className="text-xl font-semibold text-indigo-900">Arena Scoring & Streaks</CardTitle>
              <CardDescription>Customize points awarded for match results and win streaks.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-3">
              <ScoreInput
                id="arena-win"
                label="Base Win"
                value={value.scoring.winPoints}
                onChange={(v) => updateScoring({ winPoints: parseFloat(v) || 0 })}
              />
              <ScoreInput
                id="arena-draw"
                label="Base Draw"
                value={value.scoring.drawPoints}
                onChange={(v) => updateScoring({ drawPoints: parseFloat(v) || 0 })}
              />
              <ScoreInput
                id="arena-loss"
                label="Base Loss"
                value={value.scoring.lossPoints}
                onChange={(v) => updateScoring({ lossPoints: parseFloat(v) || 0 })}
              />
            </div>

            <div className="pt-4 border-t">
              <h4 className="text-sm font-semibold text-slate-700 mb-4">Streak Bonuses ("On Fire")</h4>
              <div className="grid gap-4 md:grid-cols-3">
                <ScoreInput
                  id="arena-threshold"
                  label="Streak Threshold"
                  value={value.scoring.streakThreshold}
                  description="Consecutive wins to become 'On Fire'."
                  onChange={(v) => updateScoring({ streakThreshold: parseInt(v) || 0 })}
                />
                <ScoreInput
                  id="arena-fire-win"
                  label="Fire Win Bonus"
                  value={value.scoring.onFireWinPoints}
                  onChange={(v) => updateScoring({ onFireWinPoints: parseFloat(v) || 0 })}
                />
                <ScoreInput
                  id="arena-fire-draw"
                  label="Fire Draw Bonus"
                  value={value.scoring.onFireDrawPoints}
                  onChange={(v) => updateScoring({ onFireDrawPoints: parseFloat(v) || 0 })}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
