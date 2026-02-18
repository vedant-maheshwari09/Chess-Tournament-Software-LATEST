import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface BoardNumberingSettings {
  start?: number;
  increment?: number;
  gaps?: string; // Storing as a string for easy text area binding
  customSequence?: string; // Storing as a string for easy text area binding
}

interface BoardNumberingCardProps {
  value: BoardNumberingSettings;
  onChange: (update: Partial<BoardNumberingSettings>) => void;
}

export function BoardNumberingCard({ value, onChange }: BoardNumberingCardProps) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="border-b pb-6">
        <CardTitle className="text-2xl font-semibold text-indigo-900">Board Numbering</CardTitle>
        <CardDescription>Customize how board numbers are assigned for each round.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-8 pt-6">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="bn-start">Starting Number</Label>
            <Input
              id="bn-start"
              type="number"
              value={value.start ?? ""}
              onChange={(e) => onChange({ start: e.target.value === '' ? undefined : Number(e.target.value) })}
              placeholder="e.g., 1"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bn-increment">Increment</Label>
            <Input
              id="bn-increment"
              type="number"
              value={value.increment ?? ""}
              onChange={(e) => onChange({ increment: e.target.value === '' ? undefined : Number(e.target.value) })}
              placeholder="e.g., 1"
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="bn-gaps">Gaps</Label>
          <Textarea
            id="bn-gaps"
            placeholder="e.g., 10:1, 20:3 (After board 10, skip 1; After board 20, skip 3)"
            value={value.gaps ?? ""}
            onChange={(e) => onChange({ gaps: e.target.value })}
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bn-custom-sequence">Custom Sequence</Label>
          <Textarea
            id="bn-custom-sequence"
            placeholder="e.g., 1, 3, 5, 10, 11, 15 (Overrides all other settings)"
            value={value.customSequence ?? ""}
            onChange={(e) => onChange({ customSequence: e.target.value })}
            rows={3}
          />
        </div>
      </CardContent>
    </Card>
  );
}
