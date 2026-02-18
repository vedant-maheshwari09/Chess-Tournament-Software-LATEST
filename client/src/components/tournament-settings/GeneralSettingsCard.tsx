import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface GeneralSettingsCardProps {
  value: {
    showOnCalendar: boolean;
    allowSignup: boolean;
    enablePairingPredictor: boolean;
  };
  onChange: (update: Partial<GeneralSettingsCardProps['value']>) => void;
}

export function GeneralSettingsCard({ value, onChange }: GeneralSettingsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>General Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="publishOnCalendar">Publish on Calendar</Label>
          <Switch
            id="publishOnCalendar"
            checked={value.showOnCalendar}
            onCheckedChange={(checked) => onChange({ showOnCalendar: checked })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="allowOnlineRegistration">Allow Online Registration</Label>
          <Switch
            id="allowOnlineRegistration"
            checked={value.allowSignup}
            onCheckedChange={(checked) => onChange({ allowSignup: checked })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="enablePairingPredictor">Enable Pairing Predictor</Label>
          <Switch
            id="enablePairingPredictor"
            checked={value.enablePairingPredictor}
            onCheckedChange={(checked) => onChange({ enablePairingPredictor: checked })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
