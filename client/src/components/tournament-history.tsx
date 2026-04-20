import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { History, Undo2, Eye, Clock } from "lucide-react";
import type { TournamentHistory } from "@shared/schema";

interface TournamentHistoryProps {
  tournamentId: number;
}

export default function TournamentHistoryComponent({ tournamentId }: TournamentHistoryProps) {
  const [selectedEntry, setSelectedEntry] = useState<TournamentHistory | null>(null);

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['/api/tournaments', tournamentId, 'history'],
    queryFn: () => fetch(`/api/tournaments/${tournamentId}/history`).then(res => res.json()),
  });

  const getActionBadgeColor = (action: string) => {
    switch (action) {
      case 'result_change':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300';
      case 'pairing_generation':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300';
      case 'pairing_regeneration':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300';
      case 'player_withdrawal':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';
      case 'player_reactivation':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'result_change':
        return '🎯';
      case 'pairing_generation':
        return '⚡';
      case 'pairing_regeneration':
        return '🔄';
      case 'player_withdrawal':
        return '❌';
      case 'player_reactivation':
        return '✅';
      default:
        return '📝';
    }
  };

  const formatDate = (dateString: string | Date | null) => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleString();
  };

  const handleRevert = async (entry: TournamentHistory) => {
    // This would implement the revert functionality
    console.log('Reverting entry:', entry);
    // TODO: Implement revert API call
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Tournament History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Tournament History
        </CardTitle>
        <CardDescription>
          Track all changes made to this tournament. Revert changes when needed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No history entries yet.</p>
            <p className="text-sm">Changes will appear here as you manage the tournament.</p>
          </div>
        ) : (
          <ScrollArea className="h-96">
            <div className="space-y-4">
              {history.map((entry: TournamentHistory, index: number) => (
                <div key={entry.id} className="relative">
                  {index < history.length - 1 && (
                    <div className="absolute left-6 top-12 w-px h-full bg-border"></div>
                  )}
                  
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-12 h-12 bg-muted rounded-full flex items-center justify-center text-lg">
                      {getActionIcon(entry.action)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge 
                          variant="secondary" 
                          className={getActionBadgeColor(entry.action)}
                        >
                          {entry.action.replace('_', ' ')}
                        </Badge>
                        {entry.round && (
                          <Badge variant="outline">
                            Round {entry.round}
                          </Badge>
                        )}
                        <span className="text-sm text-muted-foreground ml-auto">
                          {formatDate(entry.createdAt)}
                        </span>
                      </div>
                      
                      <p className="text-sm text-foreground mb-3">
                        {entry.description}
                      </p>
                      
                      <div className="flex gap-2">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => setSelectedEntry(entry)}
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View Details
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>History Entry Details</DialogTitle>
                              <DialogDescription>
                                Detailed information about this tournament change
                              </DialogDescription>
                            </DialogHeader>
                            
                            <div className="space-y-4">
                              <div>
                                <h4 className="font-semibold mb-2">Action</h4>
                                <Badge className={getActionBadgeColor(entry.action)}>
                                  {entry.action.replace('_', ' ')}
                                </Badge>
                              </div>
                              
                              <div>
                                <h4 className="font-semibold mb-2">Description</h4>
                                <p className="text-sm bg-muted p-3 rounded">
                                  {entry.description}
                                </p>
                              </div>
                              
                              <div>
                                <h4 className="font-semibold mb-2">Timestamp</h4>
                                <p className="text-sm">{formatDate(entry.createdAt)}</p>
                              </div>
                              
                              {entry.round && (
                                <div>
                                  <h4 className="font-semibold mb-2">Round</h4>
                                  <p className="text-sm">Round {entry.round}</p>
                                </div>
                              )}
                              
                              {entry.previousState && (
                                <div>
                                  <h4 className="font-semibold mb-2">Previous State</h4>
                                  <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-32">
                                    {JSON.stringify(JSON.parse(entry.previousState), null, 2)}
                                  </pre>
                                </div>
                              )}
                              
                              {entry.newState && (
                                <div>
                                  <h4 className="font-semibold mb-2">New State</h4>
                                  <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-32">
                                    {JSON.stringify(JSON.parse(entry.newState), null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </DialogContent>
                        </Dialog>
                        
                        {entry.canRevert && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="outline" size="sm">
                                <Undo2 className="h-4 w-4 mr-1" />
                                Revert
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Revert This Change?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will undo the following change: "{entry.description}". 
                                  This action cannot be undone and may affect subsequent rounds.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction 
                                  onClick={() => handleRevert(entry)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Revert Change
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  {index < history.length - 1 && <Separator className="mt-4" />}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
