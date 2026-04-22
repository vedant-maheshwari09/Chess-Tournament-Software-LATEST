import React from "react";
import { 
  Plus, 
  Trash2, 
  Settings2, 
  Trophy, 
  ShieldAlert, 
  Layers,
  ArrowRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import type { TournamentConfig, MatchFormat, MatchWinConditionValue } from "@/shared/tournament-config";

interface KnockoutFormatEditorProps {
  config: TournamentConfig;
  onConfigChange: (config: TournamentConfig) => void;
}

export function KnockoutFormatEditor({ config, onConfigChange }: KnockoutFormatEditorProps) {
  const knockoutMatchFormat = config.details.knockoutMatchFormat || {
    default: { thresholds: [1] },
    overrides: {}
  };

  const updateFormat = (updates: Partial<typeof knockoutMatchFormat>) => {
    onConfigChange({
      ...config,
      details: {
        ...config.details,
        knockoutMatchFormat: {
          ...knockoutMatchFormat,
          ...updates
        }
      }
    });
  };

  const updateThresholds = (key: string | "default", newThresholds: MatchWinConditionValue[]) => {
    if (key === "default") {
      updateFormat({ default: { thresholds: newThresholds } });
    } else {
      const nextOverrides = { ...(knockoutMatchFormat.overrides || {}) };
      nextOverrides[key] = { thresholds: newThresholds };
      updateFormat({ overrides: nextOverrides });
    }
  };

  const addOverride = () => {
    const nextOverrides = { ...(knockoutMatchFormat.overrides || {}) };
    // Find a unique key
    let i = 1;
    while (nextOverrides[`Round ${i}`]) i++;
    nextOverrides[`Round ${i}`] = { thresholds: [1] };
    updateFormat({ overrides: nextOverrides });
  };

  const removeOverride = (key: string) => {
    const nextOverrides = { ...(knockoutMatchFormat.overrides || {}) };
    delete nextOverrides[key];
    updateFormat({ overrides: nextOverrides });
  };

  const renameOverride = (oldKey: string, newKey: string) => {
    if (oldKey === newKey || !newKey) return;
    const nextOverrides = { ...(knockoutMatchFormat.overrides || {}) };
    nextOverrides[newKey] = nextOverrides[oldKey];
    delete nextOverrides[oldKey];
    updateFormat({ overrides: nextOverrides });
  };

  const renderThresholdEditor = (key: string | "default", format: MatchFormat) => {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          {format.thresholds.map((threshold, idx) => (
            <React.Fragment key={idx}>
              <div className="flex items-center gap-1 group">
                {threshold === "armageddon" ? (
                  <Badge variant="destructive" className="h-8 gap-1 px-2">
                    <ShieldAlert className="w-3 h-3" />
                    Armageddon
                    <button 
                      onClick={() => {
                        const next = [...format.thresholds];
                        next.splice(idx, 1);
                        updateThresholds(key, next);
                      }}
                      className="ml-1 hover:text-white/80"
                    >
                      ×
                    </button>
                  </Badge>
                ) : (
                  <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-md p-1 pl-2">
                    <Input
                      type="number"
                      step="0.5"
                      min="0.5"
                      className="h-6 w-12 text-xs border-none bg-transparent p-0 focus-visible:ring-0 font-bold"
                      value={threshold as number}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val)) {
                          const next = [...format.thresholds];
                          next[idx] = val;
                          updateThresholds(key, next);
                        }
                      }}
                    />
                    <span className="text-[10px] text-slate-400 font-bold pr-1">PTS</span>
                    <button 
                      onClick={() => {
                        const next = [...format.thresholds];
                        next.splice(idx, 1);
                        updateThresholds(key, next);
                      }}
                      className="text-slate-300 hover:text-slate-600 px-1"
                    >
                      ×
                    </button>
                  </div>
                )}
                {idx < format.thresholds.length - 1 && (
                  <ArrowRight className="w-3 h-3 text-slate-300" />
                )}
              </div>
            </React.Fragment>
          ))}
          
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-[10px] gap-1 border-dashed"
              onClick={() => {
                const next = [...format.thresholds];
                const lastVal = next[next.length - 1];
                const nextVal = typeof lastVal === 'number' ? lastVal + 1 : 1;
                next.push(nextVal);
                updateThresholds(key, next);
              }}
            >
              <Plus className="w-3 h-3" />
              Add Stage
            </Button>
            
            {!format.thresholds.includes("armageddon") && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[10px] gap-1 border-dashed hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                onClick={() => {
                  const next = [...format.thresholds];
                  next.push("armageddon");
                  updateThresholds(key, next);
                }}
              >
                <ShieldAlert className="w-3 h-3" />
                Add Armageddon
              </Button>
            )}
          </div>
        </div>
        <p className="text-[10px] text-slate-500 italic">
          Matches progress through stages if tied. Points are cumulative.
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-indigo-500" />
          Match Victory Protocol
        </h3>
        <p className="text-xs text-slate-500">
          Define how many points are needed to win a match. If tied, the next threshold is used.
        </p>
      </div>

      <div className="space-y-4">
        {/* Default Rule */}
        <Card className="border-indigo-100 shadow-none bg-indigo-50/20">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                <Label className="text-sm font-bold text-indigo-900 uppercase tracking-tight">Global Default</Label>
                <Badge variant="outline" className="bg-white text-[10px]">Applied to all rounds</Badge>
              </div>
            </div>
            {renderThresholdEditor("default", knockoutMatchFormat.default)}
          </CardContent>
        </Card>

        {/* Overrides */}
        {Object.entries(knockoutMatchFormat.overrides || {}).map(([key, format], idx) => (
          <Card key={idx} className="border-slate-200 shadow-none">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-1">
                  <Trophy className="w-4 h-4 text-amber-500" />
                  <div className="flex-1 max-w-[200px]">
                    <Select
                      value={key}
                      onValueChange={(val) => renameOverride(key, val)}
                    >
                      <SelectTrigger className="h-8 text-xs font-bold border-none shadow-none focus:ring-0 p-0 hover:bg-slate-50 px-2 rounded">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Finals">Finals</SelectItem>
                        <SelectItem value="Semifinals">Semifinals</SelectItem>
                        <SelectItem value="Quarterfinals">Quarterfinals</SelectItem>
                        {Array.from({ length: config.details.rounds || 8 }).map((_, i) => (
                          <SelectItem key={i+1} value={`Round ${i+1}`}>Round {i+1}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Badge className="text-[9px] bg-slate-100 text-slate-600 hover:bg-slate-100 border-none">OVERRIDE</Badge>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-slate-400 hover:text-red-500"
                  onClick={() => removeOverride(key)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
              {renderThresholdEditor(key, format)}
            </CardContent>
          </Card>
        ))}

        <Button
          variant="outline"
          className="w-full border-dashed py-6 h-auto text-slate-500 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50/50"
          onClick={addOverride}
        >
          <div className="flex flex-col items-center gap-1">
            <Plus className="w-4 h-4" />
            <span className="text-xs font-semibold">Add Round Specific Override</span>
            <span className="text-[10px] opacity-60 font-normal">Apply different thresholds for Finals or specific rounds</span>
          </div>
        </Button>
      </div>
    </div>
  );
}
