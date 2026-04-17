import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CheckCircle2, Clock, XCircle, Users, User, Info } from "lucide-react";
import { type PlayerRegistration } from "@shared/schema";

interface Props {
  registrations: PlayerRegistration[];
}

export function RegistrationStatusCard({ registrations }: Props) {
  const [isOpen, setIsOpen] = useState(false);

  if (!registrations || registrations.length === 0) return null;

  // Determine overall status
  const hasDeclined = registrations.some(r => r.status === "declined");
  const hasPending = registrations.some(r => r.status === "pending");
  const allApproved = registrations.every(r => r.status === "approved");

  let statusConfig = {
    color: "bg-yellow-50 border-yellow-200 text-yellow-700",
    icon: <Clock className="w-5 h-5 text-yellow-500" />,
    label: "Pending Review",
    description: "Your registration is awaiting approval by the tournament director."
  };

  if (hasDeclined) {
    statusConfig = {
      color: "bg-red-50 border-red-200 text-red-700",
      icon: <XCircle className="w-5 h-5 text-red-500" />,
      label: "Declined",
      description: "One or more registrations were declined. Click for details."
    };
  } else if (allApproved) {
    statusConfig = {
      color: "bg-green-50 border-green-200 text-green-700",
      icon: <CheckCircle2 className="w-5 h-5 text-green-500" />,
      label: "Approved",
      description: "You are all set! Registration is fully approved."
    };
  }

  const isGroup = registrations.length > 1;

  return (
    <>
      <Card 
        className={`p-4 cursor-pointer hover:shadow-md transition-all border-2 ${statusConfig.color}`}
        onClick={() => setIsOpen(true)}
      >
        <div className="flex items-center gap-3">
          <div className="shrink-0">{statusConfig.icon}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">{statusConfig.label}</h3>
              <Badge variant="outline" className="bg-white border-current opacity-80">
                {isGroup ? <Users className="w-3 h-3 mr-1 inline" /> : <User className="w-3 h-3 mr-1 inline" />}
                {registrations.length} {isGroup ? "Players" : "Player"}
              </Badge>
            </div>
            <p className="text-sm opacity-90 mt-0.5">{statusConfig.description}</p>
          </div>
          <Info className="w-5 h-5 opacity-50 shrink-0 hidden sm:block" />
        </div>
      </Card>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Registration Status Details</DialogTitle>
            <DialogDescription>
              Current approval status for {isGroup ? "all players in your group" : "your registration"}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-4">
            {registrations.map(reg => (
              <div key={reg.id} className="flex items-center justify-between p-3 rounded-lg border bg-slate-50/50">
                <div className="font-medium">{reg.playerName}</div>
                <Badge 
                  variant={reg.status === 'declined' ? 'destructive' : 'default'}
                  className={
                    reg.status === 'approved' ? 'bg-green-500 hover:bg-green-600' : 
                    reg.status === 'pending' ? 'bg-yellow-500 hover:bg-yellow-600 text-white' : ''
                  }
                >
                  {reg.status.charAt(0).toUpperCase() + reg.status.slice(1)}
                </Badge>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
