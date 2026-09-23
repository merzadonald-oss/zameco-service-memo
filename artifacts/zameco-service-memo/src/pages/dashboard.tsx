import { useRef } from "react";
import { useLocation } from "wouter";
import { Camera, Upload, AlertCircle, RefreshCw, FileText } from "lucide-react";
import { useGetDashboard } from "@workspace/api-client-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { processImageCanvas } from "@/lib/image-processing";
import { saveScanSession } from "@/lib/scan-session";
import { formatCurrency, formatDate } from "@/lib/utils";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: dashboard, isLoading, error, refetch } = useGetDashboard();

  const handleFileCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Create a fast, rough initial downscale to store in memory to pass to /scan
      const base64 = await processImageCanvas(file, { quality: 1.0 });
      saveScanSession({
        imageDataBase64: base64,
        mimeType: file.type.startsWith("image/") ? (file.type as any) : "image/jpeg",
      });
      setLocation("/scan");
    } catch (err) {
      console.error("Failed to read captured file", err);
      alert("Failed to read image. Please try again.");
    } finally {
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <Layout title="Dashboard" showNav>
      <div className="flex flex-col gap-6 p-4 pb-12 h-full">
        
        {/* Top Summary */}
        <section className="grid grid-cols-2 gap-3">
          <Card className="bg-primary text-primary-foreground border-transparent shadow-md">
            <CardContent className="p-4 flex flex-col justify-center">
              <span className="text-3xl font-bold tracking-tight">
                {isLoading ? "-" : dashboard?.todayScans || 0}
              </span>
              <span className="text-sm font-medium opacity-90">Scanned Today</span>
            </CardContent>
          </Card>
          
          <Card className="bg-card shadow-sm border-border">
            <CardContent className="p-4 flex flex-col justify-center">
              <span className="text-3xl font-bold tracking-tight text-foreground">
                {isLoading ? "-" : dashboard?.totalScans || 0}
              </span>
              <span className="text-sm font-medium text-muted-foreground">Total Scans</span>
            </CardContent>
          </Card>
        </section>

        {/* Sync Status */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Sync Status</h2>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex flex-col items-center justify-center p-3 bg-card border rounded-xl shadow-sm">
              <span className="text-xl font-bold text-[#10B981]">{dashboard?.syncedCount || 0}</span>
              <span className="text-[11px] font-medium text-muted-foreground mt-1">Synced</span>
            </div>
            <div className="flex flex-col items-center justify-center p-3 bg-card border rounded-xl shadow-sm">
              <span className="text-xl font-bold text-[#F59E0B]">{dashboard?.pendingCount || 0}</span>
              <span className="text-[11px] font-medium text-muted-foreground mt-1">Pending</span>
            </div>
            <div className="flex flex-col items-center justify-center p-3 bg-card border rounded-xl shadow-sm">
              <span className="text-xl font-bold text-destructive">{dashboard?.failedCount || 0}</span>
              <span className="text-[11px] font-medium text-muted-foreground mt-1">Failed</span>
            </div>
          </div>
        </section>

        {/* Action Buttons */}
        <section className="flex flex-col gap-3 mt-2">
          <Button 
            size="lg" 
            className="w-full h-16 shadow-md bg-primary hover:bg-accent text-white"
            onClick={() => fileInputRef.current?.click()}
          >
            <Camera className="mr-2 h-6 w-6" />
            <span className="text-lg font-semibold">Scan Memo</span>
          </Button>
          
          <input 
            type="file" 
            accept="image/*" 
            capture="environment"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileCapture}
          />
        </section>

        {/* Recent Memos */}
        <section className="flex flex-col gap-3 flex-1 mt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Recent Activity</h2>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="h-8 w-8 p-0" disabled={isLoading}>
              <RefreshCw className={`h-4 w-4 text-muted-foreground ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-pulse flex flex-col items-center gap-2 text-muted-foreground">
                <FileText className="h-8 w-8 opacity-20" />
                <span className="text-sm">Loading activity...</span>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center text-destructive flex-col gap-2 p-4 text-center border border-destructive/20 rounded-xl bg-destructive/5">
              <AlertCircle className="h-8 w-8" />
              <p className="text-sm font-medium">Could not load dashboard.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>Try Again</Button>
            </div>
          ) : dashboard?.recentMemos?.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <FileText className="h-10 w-10 opacity-20" />
                <span className="text-sm font-medium">No recent memos</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 pb-4">
              {dashboard?.recentMemos?.map((memo) => (
                <div key={memo.id} className="flex flex-col gap-2 p-4 bg-card border rounded-xl shadow-sm">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-foreground text-sm line-clamp-1">{memo.consumerName || "Unknown Consumer"}</h3>
                      <p className="text-xs text-muted-foreground">Code: <span className="font-mono text-foreground/80">{memo.serviceMemoCode}</span></p>
                    </div>
                    {memo.driveStatus === 'failed' || memo.sheetStatus === 'failed' ? (
                      <Badge variant="destructive">Failed</Badge>
                    ) : memo.driveStatus === 'pending' || memo.sheetStatus === 'pending' ? (
                      <Badge variant="warning">Pending</Badge>
                    ) : (
                      <Badge variant="success">Synced</Badge>
                    )}
                  </div>
                  <div className="flex justify-between items-end mt-1">
                    <p className="text-xs text-muted-foreground truncate flex-1 pr-2">{memo.natureOfComplaint}</p>
                    <p className="text-sm font-semibold whitespace-nowrap">{formatCurrency(memo.totalAmountPaid)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </Layout>
  );
}
