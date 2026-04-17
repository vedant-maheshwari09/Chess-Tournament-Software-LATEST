import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, CheckCheck, X, ClipboardList, Trophy, CreditCard, User, Info, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type { Notification } from "@shared/schema";

interface NotificationsResponse {
  notifications: Notification[];
  unreadCount: number;
}

function timeAgo(dateString: string | Date): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function getNotificationIcon(type: string) {
  switch (type) {
    case "registration_status":
      return <ClipboardList className="h-4 w-4 text-blue-500" />;
    case "pairing":
      return <User className="h-4 w-4 text-green-500" />;
    case "tournament_status":
      return <Trophy className="h-4 w-4 text-yellow-500" />;
    case "payment":
      return <CreditCard className="h-4 w-4 text-purple-500" />;
    default:
      return <Info className="h-4 w-4 text-slate-400" />;
  }
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery<NotificationsResponse>({
    queryKey: ["/api/notifications"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!localStorage.getItem("auth_token"),
    refetchInterval: 30_000, // Poll every 30 seconds
  });

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/notifications/${id}/read`, { method: "PATCH" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/notifications/read-all", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell button */}
      <Button
        variant="ghost"
        size="icon"
        className="relative h-9 w-9 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5 text-slate-600 dark:text-slate-300" />
        {unreadCount > 0 && (
          <span className="absolute top-2 right-2 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
          </span>
        )}
      </Button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-h-[420px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800 sm:w-96">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</h3>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
                  onClick={() => markAllRead.mutate()}
                  disabled={markAllRead.isPending}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-400 hover:text-slate-600"
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[340px] overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 dark:bg-slate-700/50">
                  <Inbox className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                </div>
                <h4 className="text-sm font-medium text-slate-900 dark:text-white">All caught up!</h4>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  You don't have any notifications at the moment.
                </p>
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`flex items-start gap-3 border-b border-slate-100 px-4 py-3 transition-colors last:border-b-0 dark:border-slate-700/50 ${
                    notif.read
                      ? "bg-white dark:bg-slate-800"
                      : "bg-blue-50/50 dark:bg-blue-900/10"
                  }`}
                >
                  <div className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    notif.read ? "bg-slate-100 dark:bg-slate-700" : "bg-white dark:bg-slate-700"
                  } shadow-sm ring-1 ring-slate-200/50 dark:ring-slate-700`}>
                    {getNotificationIcon(notif.type)}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm leading-tight ${notif.read ? "text-slate-600 dark:text-slate-400" : "font-medium text-slate-900 dark:text-white"}`}>
                      {notif.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-snug text-slate-500 dark:text-slate-400 line-clamp-2">
                      {notif.message}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {timeAgo(notif.createdAt)}
                    </p>
                  </div>

                  {/* Mark read button */}
                  {!notif.read && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mt-0.5 h-6 w-6 shrink-0 rounded-full text-blue-500 hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900/30"
                      onClick={() => markRead.mutate(notif.id)}
                      disabled={markRead.isPending}
                      aria-label="Mark as read"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
