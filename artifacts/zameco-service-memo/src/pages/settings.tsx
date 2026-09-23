import { useEffect, useRef, useState } from "react";
import { Layout } from "@/components/layout";
import { listSheetTabs, useGetSettings, useListDriveItems, useUpdateSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, CheckCircle2, ChevronRight, FileSpreadsheet, Folder, FolderOpen, Save, Loader2, XCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getGetSettingsQueryKey } from "@workspace/api-client-react";

const settingsSchema = z.object({
  driveFolderId: z.string().min(1, "Drive Folder ID is required"),
  spreadsheetId: z.string().min(1, "Spreadsheet ID is required"),
  sheetName: z.string().min(1, "Sheet Name is required"),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

type PickerKind = "folder" | "spreadsheet";

function DrivePicker({
  kind,
  open,
  onOpenChange,
  onSelect,
}: {
  kind: PickerKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string, name: string) => void;
}) {
  const [path, setPath] = useState<Array<{ id: string; name: string }>>([{ id: "root", name: "My Drive" }]);
  const current = path[path.length - 1];
  const { data, isLoading, error } = useListDriveItems({ parentId: current.id, type: kind });

  useEffect(() => {
    if (!open) setPath([{ id: "root", name: "My Drive" }]);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>{kind === "folder" ? "Choose Drive folder" : "Choose Google Sheet"}</DialogTitle>
          <DialogDescription>
            Browse the Google Drive account connected to this app.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 rounded-lg bg-muted px-2 py-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            disabled={path.length === 1}
            onClick={() => setPath((items) => items.slice(0, -1))}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <p className="min-w-0 truncate text-sm font-medium">{path.map((item) => item.name).join(" / ")}</p>
        </div>

        {kind === "folder" && current.id !== "root" && (
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              onSelect(current.id, current.name);
              onOpenChange(false);
            }}
          >
            Select this folder
          </Button>
        )}

        <ScrollArea className="h-[min(55vh,360px)]">
          <div className="space-y-1 pr-3">
            {isLoading && (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}
            {error && <p className="p-4 text-sm text-destructive">Unable to load Drive files. Please try again.</p>}
            {!isLoading && !error && data?.items.length === 0 && (
              <p className="p-8 text-center text-sm text-muted-foreground">No matching items in this folder.</p>
            )}
            {data?.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-muted"
                onClick={() => {
                  if (item.kind === "folder") {
                    setPath((items) => [...items, { id: item.id, name: item.name }]);
                  } else {
                    onSelect(item.id, item.name);
                    onOpenChange(false);
                  }
                }}
              >
                {item.kind === "folder" ? (
                  <Folder className="h-5 w-5 shrink-0 text-amber-500" />
                ) : (
                  <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-600" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</span>
                {item.kind === "folder" && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </button>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export default function Settings() {
  const { data: settings, isLoading } = useGetSettings();
  const queryClient = useQueryClient();
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const [selectedFolderName, setSelectedFolderName] = useState("");
  const [selectedSheetName, setSelectedSheetName] = useState("");
  
  const updateSettings = useUpdateSettings({
    mutation: {
      onSuccess: (data) => {
        // Optimistic update of local cache
        queryClient.setQueryData(getGetSettingsQueryKey(), data);
        alert("Settings saved. The spreadsheet and tab are accessible; write access will be confirmed when a memo syncs.");
      },
      onError: (err) => {
        console.error(err);
        const message =
          typeof err === "object" &&
          err !== null &&
          "data" in err &&
          typeof (err as { data?: { error?: unknown } }).data?.error === "string"
            ? (err as { data: { error: string } }).data.error
            : err instanceof Error ? err.message : "Failed to save settings";
        alert(message);
      }
    }
  });

  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      driveFolderId: "",
      spreadsheetId: "",
      sheetName: "Sheet1",
    }
  });
  const spreadsheetInput = form.watch("spreadsheetId").trim();
  const spreadsheetId = spreadsheetInput.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] ?? spreadsheetInput;
  const tabsQuery = useQuery({
    queryKey: ["sheet-tabs", spreadsheetId],
    queryFn: () => listSheetTabs(spreadsheetId),
    enabled: /^[\w-]+$/.test(spreadsheetId),
    retry: false,
  });

  // Track if we've initialized form from server to avoid overwriting edits
  const isInitialized = useRef(false);

  useEffect(() => {
    if (settings && !isInitialized.current) {
      form.reset({
        driveFolderId: settings.driveFolderId,
        spreadsheetId: settings.spreadsheetId,
        sheetName: settings.sheetName,
      });
      isInitialized.current = true;
    }
  }, [settings, form]);

  const onSubmit = (data: SettingsFormValues) => {
    updateSettings.mutate({ data });
  };

  return (
    <Layout title="Settings" showNav>
      <div className="p-4 pb-12 flex flex-col gap-6">
        
        {/* Connection Statuses */}
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Integrations</h2>
          <div className="grid grid-cols-2 gap-3">
            <Card className="bg-card">
              <CardContent className="p-4 flex flex-col items-center text-center gap-2">
                {settings?.driveConnected ? (
                  <CheckCircle2 className="h-8 w-8 text-[#10B981]" />
                ) : (
                  <XCircle className="h-8 w-8 text-muted-foreground opacity-50" />
                )}
                <div>
                  <p className="font-semibold text-sm">Google Drive</p>
                  <p className="text-xs text-muted-foreground">
                    {settings?.driveConnected ? "Connected" : "Disconnected"}
                  </p>
                </div>
              </CardContent>
            </Card>
            
            <Card className="bg-card">
              <CardContent className="p-4 flex flex-col items-center text-center gap-2">
                {settings?.sheetsConnected ? (
                  <CheckCircle2 className="h-8 w-8 text-[#10B981]" />
                ) : (
                  <XCircle className="h-8 w-8 text-muted-foreground opacity-50" />
                )}
                <div>
                  <p className="font-semibold text-sm">Google Sheets</p>
                  <p className="text-xs text-muted-foreground">
                    {settings?.sheetsConnected ? "Connected" : "Disconnected"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Configuration Form */}
        <section>
          <Card className="bg-card border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Workspace Config</CardTitle>
              <CardDescription>Target folders and sheets for sync</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="flex justify-center p-6">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="driveFolderId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Drive Folder</FormLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input placeholder="Folder link or ID" {...field} />
                            </FormControl>
                            <Button type="button" variant="outline" onClick={() => setPicker("folder")}>
                              <FolderOpen className="mr-2 h-4 w-4" />
                              Browse
                            </Button>
                          </div>
                          {selectedFolderName && <p className="text-xs text-muted-foreground">Selected: {selectedFolderName}</p>}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={form.control}
                      name="spreadsheetId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Google Sheet</FormLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input placeholder="Sheet link or ID" {...field} />
                            </FormControl>
                            <Button type="button" variant="outline" onClick={() => setPicker("spreadsheet")}>
                              <FileSpreadsheet className="mr-2 h-4 w-4" />
                              Browse
                            </Button>
                          </div>
                          {selectedSheetName && <p className="text-xs text-muted-foreground">Selected: {selectedSheetName}</p>}
                          <p className="text-xs text-muted-foreground">Choose a spreadsheet, then select its tab below.</p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="sheetName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Sheet Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g. Sheet1" {...field} />
                          </FormControl>
                          {tabsQuery.isLoading && <p className="text-xs text-muted-foreground">Loading available tabs…</p>}
                          {tabsQuery.data && (
                            <div className="space-y-2">
                              {tabsQuery.data.tabs.length ? (
                                <>
                                  <p className="text-xs text-muted-foreground">Select an existing tab:</p>
                                  <div className="flex flex-wrap gap-2">
                                    {tabsQuery.data.tabs.map((name) => (
                                      <Button
                                        key={name}
                                        type="button"
                                        size="sm"
                                        variant={field.value === name ? "default" : "outline"}
                                        onClick={() => field.onChange(name)}
                                      >
                                        {name}
                                      </Button>
                                    ))}
                                  </div>
                                  {!tabsQuery.data.tabs.includes(field.value.trim()) && (
                                    <p className="text-xs text-destructive">“{field.value}” is not a tab in this spreadsheet. Select one above before saving.</p>
                                  )}
                                </>
                              ) : <p className="text-xs text-destructive">This spreadsheet has no available tabs.</p>}
                            </div>
                          )}
                          {tabsQuery.error && <p className="text-xs text-destructive">{tabsQuery.error.message}</p>}
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button 
                      type="submit" 
                      className="w-full mt-6"
                      disabled={updateSettings.isPending}
                    >
                      {updateSettings.isPending ? (
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      ) : (
                        <Save className="h-5 w-5 mr-2" />
                      )}
                      Save Settings
                    </Button>
                  </form>
                </Form>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
      <DrivePicker
        kind={picker ?? "folder"}
        open={picker !== null}
        onOpenChange={(open) => {
          if (!open) setPicker(null);
        }}
        onSelect={(id, name) => {
          if (picker === "folder") {
            form.setValue("driveFolderId", id, { shouldDirty: true, shouldValidate: true });
            setSelectedFolderName(name);
          } else {
            form.setValue("spreadsheetId", id, { shouldDirty: true, shouldValidate: true });
            setSelectedSheetName(name);
          }
        }}
      />
    </Layout>
  );
}
