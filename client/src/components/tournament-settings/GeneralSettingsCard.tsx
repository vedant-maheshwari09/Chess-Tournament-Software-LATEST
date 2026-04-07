import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface GeneralSettingsCardProps {
  value: {
    showOnCalendar: boolean;
    allowSignup: boolean;
    allowMultiPlayerSignup: boolean;
    allowEditRegistration: boolean;
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
          <Label htmlFor="allowMultiPlayerSignup">Allow Multi-Player Sign Up</Label>
          <Switch
            id="allowMultiPlayerSignup"
            checked={value.allowMultiPlayerSignup}
            onCheckedChange={(checked) => onChange({ allowMultiPlayerSignup: checked })}
          />
        </div>
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="allowEditRegistration">Allow Registration Editing</Label>
            <p className="text-sm text-muted-foreground">
              Players can modify their confirmed registrations
            </p>
          </div>
          <Switch
            id="allowEditRegistration"
            checked={value.allowEditRegistration}
            onCheckedChange={(checked) => onChange({ allowEditRegistration: checked })}
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
