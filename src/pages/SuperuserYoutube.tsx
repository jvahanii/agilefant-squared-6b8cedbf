import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  type YouTubeChannel,
  type YouTubeSearchChannel,
  type YouTubeVideoLink,
  type YouTubeSearchOrder,
  DEFAULT_SEARCH_ORDER,
  getYouTubeChannels,
  addYouTubeChannel,
  removeYouTubeChannel,
  toggleYouTubeChannel,
  getChannelVideoUrl,
  getYouTubeSearchChannels,
  addYouTubeSearchChannel,
  removeYouTubeSearchChannel,
  toggleYouTubeSearchChannel,
  setYouTubeSearchChannelOrder,
  getSearchChannelUrl,
  getYouTubeVideoLinks,
  addYouTubeVideoLink,
  removeYouTubeVideoLink,
  toggleYouTubeVideoLink,
  getVideoLinkUrl,
} from "@/hooks/useYouTubeChannels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Trash2, Plus, Youtube, Search, Link } from "lucide-react";
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

type DeleteTarget =
  | { kind: "channel"; item: YouTubeChannel }
  | { kind: "search"; item: YouTubeSearchChannel }
  | { kind: "video"; item: YouTubeVideoLink };

export default function SuperuserYoutube() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isSuperuser, setIsSuperuser] = useState<boolean | null>(null);
  const [channels, setChannels] = useState<YouTubeChannel[]>([]);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const [searchChannels, setSearchChannels] = useState<YouTubeSearchChannel[]>([]);
  const [newSearchName, setNewSearchName] = useState("");
  const [newSearchKeywords, setNewSearchKeywords] = useState("");
  const [newSearchOrder, setNewSearchOrder] = useState<YouTubeSearchOrder>(DEFAULT_SEARCH_ORDER);

  const [videoLinks, setVideoLinks] = useState<YouTubeVideoLink[]>([]);
  const [newVideoName, setNewVideoName] = useState("");
  const [newVideoUrl, setNewVideoUrl] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

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

  // Load data once superuser confirmed
  useEffect(() => {
    if (!isSuperuser) return;
    setChannels(getYouTubeChannels());
    setSearchChannels(getYouTubeSearchChannels());
    setVideoLinks(getYouTubeVideoLinks());
  }, [isSuperuser]);

  // --- Regular channels ---

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
    addYouTubeChannel(name, url);
    setChannels(getYouTubeChannels());
    setNewName("");
    setNewUrl("");
    toast({ title: `Added channel: ${name}` });
  };

  const handleToggle = (id: string) => {
    toggleYouTubeChannel(id);
    setChannels(getYouTubeChannels());
  };

  const handleOpenChannel = (channel: YouTubeChannel) => {
    window.open(getChannelVideoUrl(channel), "_blank", "noopener,noreferrer");
  };

  // --- Search channels ---

  const handleAddSearch = () => {
    const name = newSearchName.trim();
    const keywords = newSearchKeywords.trim();
    if (!name) {
      toast({ title: "Search channel name is required", variant: "destructive" });
      return;
    }
    if (!keywords) {
      toast({ title: "Keywords are required", variant: "destructive" });
      return;
    }
    addYouTubeSearchChannel(name, keywords, newSearchOrder);
    setSearchChannels(getYouTubeSearchChannels());
    setNewSearchName("");
    setNewSearchKeywords("");
    setNewSearchOrder(DEFAULT_SEARCH_ORDER);
    toast({ title: `Added search channel: ${name}` });
  };

  const handleToggleSearch = (id: string) => {
    toggleYouTubeSearchChannel(id);
    setSearchChannels(getYouTubeSearchChannels());
  };

  const handleSearchOrderChange = (id: string, value: YouTubeSearchOrder) => {
    setYouTubeSearchChannelOrder(id, value);
    setSearchChannels(getYouTubeSearchChannels());
  };

  const handleOpenSearch = (channel: YouTubeSearchChannel) => {
    window.open(getSearchChannelUrl(channel), "_blank", "noopener,noreferrer");
  };

  // --- Video links ---

  const handleAddVideo = () => {
    const name = newVideoName.trim();
    const url = newVideoUrl.trim();
    if (!name) {
      toast({ title: "Video name is required", variant: "destructive" });
      return;
    }
    if (!url) {
      toast({ title: "Video URL is required", variant: "destructive" });
      return;
    }
    addYouTubeVideoLink(name, url);
    setVideoLinks(getYouTubeVideoLinks());
    setNewVideoName("");
    setNewVideoUrl("");
    toast({ title: `Added video link: ${name}` });
  };

  const handleToggleVideo = (id: string) => {
    toggleYouTubeVideoLink(id);
    setVideoLinks(getYouTubeVideoLinks());
  };

  const handleOpenVideo = (link: YouTubeVideoLink) => {
    window.open(getVideoLinkUrl(link), "_blank", "noopener,noreferrer");
  };

  // --- Delete ---

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "channel") {
      removeYouTubeChannel(deleteTarget.item.id);
      setChannels(getYouTubeChannels());
      toast({ title: `Removed channel: ${deleteTarget.item.name}` });
    } else if (deleteTarget.kind === "search") {
      removeYouTubeSearchChannel(deleteTarget.item.id);
      setSearchChannels(getYouTubeSearchChannels());
      toast({ title: `Removed search channel: ${deleteTarget.item.name}` });
    } else {
      removeYouTubeVideoLink(deleteTarget.item.id);
      setVideoLinks(getYouTubeVideoLinks());
      toast({ title: `Removed video link: ${deleteTarget.item.name}` });
    }
    setDeleteTarget(null);
  };

  const deleteTargetLabel = (kind: DeleteTarget["kind"] | undefined) => {
    if (kind === "search") return "search channel";
    if (kind === "video") return "video link";
    return "channel";
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

      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Combined add form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Add a source
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="channel">
              <TabsList className="mb-4">
                <TabsTrigger value="channel" className="gap-1.5">
                  <Youtube className="w-3.5 h-3.5" />
                  Channel
                </TabsTrigger>
                <TabsTrigger value="search" className="gap-1.5">
                  <Search className="w-3.5 h-3.5" />
                  Search by keywords
                </TabsTrigger>
                <TabsTrigger value="video" className="gap-1.5">
                  <Link className="w-3.5 h-3.5" />
                  Video link
                </TabsTrigger>
              </TabsList>

              <TabsContent value="channel" className="space-y-4">
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
                <Button onClick={handleAdd} disabled={!newName.trim() || !newUrl.trim()}>
                  <Plus className="w-4 h-4" />
                  Add channel
                </Button>
              </TabsContent>

              <TabsContent value="search" className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="search-channel-name">Name</Label>
                  <Input
                    id="search-channel-name"
                    placeholder="e.g. React tutorials"
                    value={newSearchName}
                    onChange={(e) => setNewSearchName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddSearch()}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="search-keywords">Keywords</Label>
                  <Input
                    id="search-keywords"
                    placeholder="e.g. react hooks tutorial"
                    value={newSearchKeywords}
                    onChange={(e) => setNewSearchKeywords(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddSearch()}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="search-order">Sort results by</Label>
                  <Select
                    value={newSearchOrder}
                    onValueChange={(v) => setNewSearchOrder(v as YouTubeSearchOrder)}
                  >
                    <SelectTrigger id="search-order">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="relevance">Most relevant</SelectItem>
                      <SelectItem value="date">Most recent upload</SelectItem>
                      <SelectItem value="viewCount">Most popular</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleAddSearch}
                  disabled={!newSearchName.trim() || !newSearchKeywords.trim()}
                >
                  <Plus className="w-4 h-4" />
                  Add search channel
                </Button>
              </TabsContent>

              <TabsContent value="video" className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="video-name">Video name</Label>
                  <Input
                    id="video-name"
                    placeholder="e.g. Intro to React"
                    value={newVideoName}
                    onChange={(e) => setNewVideoName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddVideo()}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="video-url">Video URL</Label>
                  <Input
                    id="video-url"
                    placeholder="e.g. https://www.youtube.com/watch?v=..."
                    value={newVideoUrl}
                    onChange={(e) => setNewVideoUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddVideo()}
                  />
                </div>
                <Button onClick={handleAddVideo} disabled={!newVideoName.trim() || !newVideoUrl.trim()}>
                  <Plus className="w-4 h-4" />
                  Add video link
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Side-by-side lists */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Channel list */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Youtube className="w-4 h-4 text-red-500" />
                Channels to watch
                {channels.length > 0 && (
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {channels.filter((c) => c.enabled).length} / unlimited (free trial)
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
                        <button
                          onClick={() => handleOpenChannel(channel)}
                          className="text-xs text-muted-foreground hover:text-primary truncate block text-left"
                        >
                          {channel.url}
                        </button>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget({ kind: "channel", item: channel })}
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

          {/* Search channel list */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="w-4 h-4" />
                Search channels
                {searchChannels.length > 0 && (
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {searchChannels.filter((c) => c.enabled).length} / {searchChannels.length} enabled
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {searchChannels.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No search channels added yet. Add one above.
                </p>
              ) : (
                <ul className="space-y-2">
                  {searchChannels.map((channel) => (
                    <li
                      key={channel.id}
                      className="flex items-center gap-3 rounded-md border px-3 py-2.5 bg-background"
                    >
                      <Switch
                        checked={channel.enabled}
                        onCheckedChange={() => handleToggleSearch(channel.id)}
                        aria-label={`Toggle ${channel.name}`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{channel.name}</p>
                        <button
                          onClick={() => handleOpenSearch(channel)}
                          className="text-xs text-muted-foreground hover:text-primary truncate block text-left"
                        >
                          {channel.keywords}
                        </button>
                      </div>
                      <Select
                        value={channel.searchOrder}
                        onValueChange={(v) =>
                          handleSearchOrderChange(channel.id, v as YouTubeSearchOrder)
                        }
                      >
                        <SelectTrigger className="w-44 h-8 text-xs shrink-0">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="relevance">Most relevant</SelectItem>
                          <SelectItem value="date">Most recent upload</SelectItem>
                          <SelectItem value="viewCount">Most popular</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteTarget({ kind: "search", item: channel })}
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

        {/* Video links list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Link className="w-4 h-4" />
              Video links
              {videoLinks.length > 0 && (
                <span className="ml-auto text-xs font-normal text-muted-foreground">
                  {videoLinks.filter((l) => l.enabled).length} / {videoLinks.length} enabled
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {videoLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No video links added yet. Add one above.
              </p>
            ) : (
              <ul className="space-y-2">
                {videoLinks.map((link) => (
                  <li
                    key={link.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2.5 bg-background"
                  >
                    <Switch
                      checked={link.enabled}
                      onCheckedChange={() => handleToggleVideo(link.id)}
                      aria-label={`Toggle ${link.name}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{link.name}</p>
                      <button
                        onClick={() => handleOpenVideo(link)}
                        className="text-xs text-muted-foreground hover:text-primary truncate block text-left"
                      >
                        {link.url}
                      </button>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteTarget({ kind: "video", item: link })}
                      aria-label={`Remove ${link.name}`}
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
            <AlertDialogTitle>
              Remove {deleteTargetLabel(deleteTarget?.kind)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.item.name}" will be removed. This cannot be undone.
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
