import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  type YouTubeChannel,
  type YouTubeVideoSelection,
  DEFAULT_VIDEO_SELECTION,
  getYouTubeChannels,
  addYouTubeChannel,
  removeYouTubeChannel,
  toggleYouTubeChannel,
  setYouTubeChannelVideoSelection,
  getChannelVideoUrl,
  fetchLatestVideoUrl,
} from "@/hooks/useYouTubeChannels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Trash2, Plus, Youtube } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function SuperuserYoutube() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isSuperuser, setIsSuperuser] = useState<boolean | null>(null);
  const [channels, setChannels] = useState<YouTubeChannel[]>([]);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newVideoSelection, setNewVideoSelection] = useState<YouTubeVideoSelection>(DEFAULT_VIDEO_SELECTION);
  const [deleteTarget, setDeleteTarget] = useState<YouTubeChannel | null>(null);
  const [loadingLatest, setLoadingLatest] = useState<Set<string>>(new Set());

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate(-1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  // Verify superuser status
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("is_superuser")
      .eq("id", user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          toast({ title: "Failed to verify permissions", variant: "destructive" });
          navigate("/");
          return;
        }
        const su = data?.is_superuser ?? false;
        setIsSuperuser(su);
        if (!su) navigate("/");
      });
  }, [user?.id, navigate]);

  // Load channels once superuser confirmed
  useEffect(() => {
    if (!isSuperuser) return;
    setChannels(getYouTubeChannels());
  }, [isSuperuser]);

  const handleAdd = () => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name) {
      toast({ title: "Channel name is required", variant: "destructive" });
      return;
    }
    if (!url) {
      toast({ title: "Channel URL is required", variant: "destructive" });
      return;
    }
    addYouTubeChannel(name, url, newVideoSelection);
    setChannels(getYouTubeChannels());
    setNewName("");
    setNewUrl("");
    setNewVideoSelection(DEFAULT_VIDEO_SELECTION);
    toast({ title: `Added channel: ${name}` });
  };

  const handleToggle = (id: string) => {
    toggleYouTubeChannel(id);
    setChannels(getYouTubeChannels());
  };

  const handleVideoSelectionChange = (id: string, value: YouTubeVideoSelection) => {
    setYouTubeChannelVideoSelection(id, value);
    setChannels(getYouTubeChannels());
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    removeYouTubeChannel(deleteTarget.id);
    setChannels(getYouTubeChannels());
    toast({ title: `Removed channel: ${deleteTarget.name}` });
    setDeleteTarget(null);
  };

  const handleOpenLatestVideo = async (channel: YouTubeChannel) => {
    setLoadingLatest((prev) => new Set(prev).add(channel.id));
    try {
      const videoUrl = await fetchLatestVideoUrl(channel);
      if (!videoUrl) {
        toast({ title: "Could not resolve latest video – opening videos page instead", variant: "destructive" });
      }
      window.open(videoUrl ?? getChannelVideoUrl(channel), "_blank", "noopener,noreferrer");
    } finally {
      setLoadingLatest((prev) => {
        const next = new Set(prev);
        next.delete(channel.id);
        return next;
      });
    }
  };

  if (isSuperuser === null) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="h-12 border-b flex items-center px-4 gap-3 bg-[#f5f5f5] shadow-sm">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
          <ArrowLeft className="w-4 h-4" />
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Youtube className="w-4 h-4 text-red-500" />
          <h1 className="text-sm font-semibold">YouTube Channels</h1>
        </div>
        <span className="text-xs text-muted-foreground ml-1">(superuser only)</span>
      </header>

      <div className="max-w-2xl mx-auto p-6 space-y-6">
        {/* Add channel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add a channel
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="channel-name">Channel name</Label>
              <Input
                id="channel-name"
                placeholder="e.g. Fireship"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="channel-url">Channel URL or handle</Label>
              <Input
                id="channel-url"
                placeholder="e.g. https://www.youtube.com/@fireship"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="channel-video-selection">Auto-select video</Label>
              <Select
                value={newVideoSelection}
                onValueChange={(v) => setNewVideoSelection(v as YouTubeVideoSelection)}
              >
                <SelectTrigger id="channel-video-selection">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">Latest</SelectItem>
                  <SelectItem value="oldest">Oldest</SelectItem>
                  <SelectItem value="popular">Most popular</SelectItem>
                  <SelectItem value="latest-video">Latest upload (direct)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAdd} disabled={!newName.trim() || !newUrl.trim()}>
              <Plus className="w-4 h-4" />
              Add channel
            </Button>
          </CardContent>
        </Card>

        {/* Channel list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Youtube className="w-4 h-4 text-red-500" />
              Channels to watch
              {channels.length > 0 && (
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {channels.filter((c) => c.enabled).length} / {channels.length} enabled
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {channels.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No channels added yet. Add one above.
              </p>
            ) : (
              <ul className="space-y-2">
                {channels.map((channel) => (
                  <li
                    key={channel.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2.5 bg-background"
                  >
                    <Switch
                      checked={channel.enabled}
                      onCheckedChange={() => handleToggle(channel.id)}
                      aria-label={`Toggle ${channel.name}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{channel.name}</p>
                      {channel.videoSelection === "latest-video" ? (
                        <button
                          onClick={() => handleOpenLatestVideo(channel)}
                          disabled={loadingLatest.has(channel.id)}
                          className="text-xs text-muted-foreground hover:text-primary truncate block text-left disabled:opacity-50"
                        >
                          {loadingLatest.has(channel.id) ? "Loading…" : channel.url}
                        </button>
                      ) : (
                        <a
                          href={getChannelVideoUrl(channel)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-primary truncate block"
                        >
                          {channel.url}
                        </a>
                      )}
                    </div>
                    <Select
                      value={channel.videoSelection ?? DEFAULT_VIDEO_SELECTION}
                      onValueChange={(v) => handleVideoSelectionChange(channel.id, v as YouTubeVideoSelection)}
                    >
                      <SelectTrigger className="w-36 h-8 text-xs shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="latest">Latest</SelectItem>
                        <SelectItem value="oldest">Oldest</SelectItem>
                        <SelectItem value="popular">Most popular</SelectItem>
                        <SelectItem value="latest-video">Latest upload (direct)</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget(channel)}
                      aria-label={`Remove ${channel.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove channel?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}" will be removed from your watchlist. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
