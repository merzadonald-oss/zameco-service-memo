import { useEffect, useState } from "react";
import { Search, Filter, AlertCircle, CheckCircle2, Clock, RotateCcw } from "lucide-react";
import { useListMemos, useRetryMemoSync } from "@workspace/api-client-react";
import type { ListMemosStatus } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { getListMemosQueryKey } from "@workspace/api-client-react";

export default function History() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<ListMemosStatus>("all");
  
  const queryClient = useQueryClient();

  // Simple debounce
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: memos, isLoading, error } = useListMemos({
    search: debouncedSearch || undefined,
    status: status !== "all" ? status : undefined,
    limit: 50
  });

  const retrySync = useRetryMemoSync({
    mutation: {
      onSuccess: (memo) => {
        queryClient.invalidateQueries({ queryKey: getListMemosQueryKey() });
        if (memo.driveStatus !== "synced" || memo.sheetStatus !== "synced") {
          alert(`Memo saved, but sync is still incomplete: ${memo.syncError || "Check the settings and try again."}`);
        } else {
          alert("Memo is synced to Google Drive and Google Sheets.");
        }
      },
      onError: (err) => {
        alert(err instanceof Error ? err.message : "Retry failed. Please try again.");
      }
    }
  });

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'synced': return <CheckCircle2 className="h-4 w-4 text-[#10B981]" />;
      case 'pending': return <Clock className="h-4 w-4 text-[#F59E0B]" />;
      case 'failed': return <AlertCircle className="h-4 w-4 text-destructive" />;
      default: return null;
    }
  };

  return (
    <Layout title="History" showNav>
      <div className="flex flex-col h-full bg-secondary/30">
        
        <div className="sticky top-14 z-10 bg-card border-b p-4 space-y-3 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input 
              placeholder="Search names, codes, acct..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-secondary/50 border-transparent focus-visible:bg-transparent"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {(["all", "synced", "pending", "failed"] as const).map(s => (
              <Button 
                key={s}
                variant={status === s ? "default" : "outline"}
                size="sm"
                className="rounded-full capitalize text-xs h-8 px-4 shrink-0"
                onClick={() => setStatus(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1 p-4 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col gap-3">
              {[1,2,3,4].map(i => (
                <div key={i} className="h-28 rounded-xl bg-card border shadow-sm animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <AlertCircle className="h-10 w-10 text-destructive/50 mb-2" />
              <p>Failed to load history</p>
            </div>
          ) : memos?.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground h-40">
              <Filter className="h-10 w-10 opacity-20 mb-2" />
              <p>No memos found</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pb-8">
              {memos?.map((memo) => {
                const isFailed = memo.driveStatus === 'failed' || memo.sheetStatus === 'failed';
                return (
                  <div key={memo.id} className="flex flex-col p-4 bg-card border rounded-xl shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex-1 min-w-0 pr-2">
                        <h3 className="font-semibold text-foreground text-sm truncate">{memo.consumerName || "Unknown Consumer"}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">Code: <span className="font-mono">{memo.serviceMemoCode}</span></p>
                        <p className="text-xs text-muted-foreground">Date: {formatDate(memo.dateOfServiceMemo)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1.5 bg-secondary px-2 py-1 rounded-md">
                          <span className="text-[10px] text-muted-foreground">Drive</span>
                          {getStatusIcon(memo.driveStatus)}
                          <span className="ml-1 text-[10px] text-muted-foreground">Sheet</span>
                          {getStatusIcon(memo.sheetStatus)}
                        </div>
                      </div>
                    </div>
                    
                    <div className="mt-2 pt-2 border-t flex justify-between items-center">
                      <p className="text-sm font-semibold">{formatCurrency(memo.totalAmountPaid)}</p>
                      {isFailed && (
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-8 text-xs border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                          disabled={retrySync.isPending}
                          onClick={() => retrySync.mutate({ id: memo.id })}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Retry Sync
                        </Button>
                      )}
                    </div>
                    {isFailed && memo.syncError && (
                      <p className="text-[10px] text-destructive mt-2 bg-destructive/10 p-2 rounded-md">
                        {memo.syncError}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
