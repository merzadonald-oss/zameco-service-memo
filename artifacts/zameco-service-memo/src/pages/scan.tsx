import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Wand2, SlidersHorizontal, Loader2 } from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { getScanSession, saveScanSession } from "@/lib/scan-session";
import { processImageCanvas } from "@/lib/image-processing";
import { useExtractMemo, useGetNextMemoCode } from "@workspace/api-client-react";

export default function Scan() {
  const [, setLocation] = useLocation();
  const session = getScanSession();

  const [originalBlob, setOriginalBlob] = useState<Blob | null>(null);
  const [processedBase64, setProcessedBase64] = useState<string>("");
  
  // Controls
  const [grayscale, setGrayscale] = useState(true);
  const [highContrast, setHighContrast] = useState(true);
  const [quality, setQuality] = useState(0.8);
  const [crop, setCrop] = useState({ top: 0, bottom: 0, left: 0, right: 0 });
  
  const [isProcessing, setIsProcessing] = useState(false);

  // Initialize
  useEffect(() => {
    if (!session) {
      setLocation("/");
      return;
    }
    
    setProcessedBase64(session.imageDataBase64);

    // Convert base64 to blob for re-processing
    fetch(session.imageDataBase64)
      .then(res => res.blob())
      .then(blob => setOriginalBlob(blob));
  }, [session, setLocation]);

  // Apply filters when controls change
  useEffect(() => {
    if (!originalBlob) return;
    let isActive = true;
    
    const applyFilters = async () => {
      setIsProcessing(true);
      try {
        const result = await processImageCanvas(originalBlob, {
          grayscale,
          highContrast,
          quality,
          mimeType: session?.mimeType === 'image/webp' ? 'image/webp' : 'image/jpeg',
          crop
        });
        if (isActive) {
          setProcessedBase64(result);
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (isActive) setIsProcessing(false);
      }
    };

    // debounce slightly to avoid lag on slider
    const timer = setTimeout(applyFilters, 150);
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [originalBlob, grayscale, highContrast, quality, crop, session?.mimeType]);

  // Fetch next memo code to include in extraction (if needed by API, though we can fetch it now)
  const { data: nextCodeData } = useGetNextMemoCode();

  // Extraction mutation
  const extractMemo = useExtractMemo({
    mutation: {
      onSuccess: (data) => {
        // Save extracted data and final image to session
        saveScanSession({
          imageDataBase64: processedBase64,
          mimeType: session?.mimeType || 'image/jpeg',
          extractedData: data
        } as any); // we will extend ScanSessionData locally in review
        setLocation("/review");
      },
      onError: (err) => {
        console.error("Extraction failed", err);
        alert("Failed to extract fields from memo. Please try again or proceed to manual entry.");
      }
    }
  });

  const handleExtract = () => {
    if (!processedBase64) return;
    
    // Strip the data URL prefix (e.g. data:image/jpeg;base64,)
    const base64Data = processedBase64.split(",")[1];
    if (!base64Data) {
      alert("Invalid image data");
      return;
    }

    extractMemo.mutate({
      data: {
        imageData: base64Data,
        imageMimeType: session?.mimeType as any,
        serviceMemoCode: nextCodeData?.code || "",
        dateReceived: nextCodeData?.dateReceived || new Date().toISOString().split("T")[0]
      }
    });
  };

  if (!session) return null;

  return (
    <Layout 
      title="Review Scan" 
      showNav={false}
      headerLeft={
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")} disabled={extractMemo.isPending}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
      }
    >
      <div className="flex flex-col h-full bg-black">
        {/* Image Preview Area */}
        <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black/90">
          {processedBase64 && (
            <img 
              src={processedBase64} 
              alt="Scan preview" 
              className="max-w-full max-h-full object-contain"
            />
          )}
          
          {isProcessing && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-sm transition-all">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
            </div>
          )}
          
          {extractMemo.isPending && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center backdrop-blur-sm z-50">
              <div className="relative">
                <Wand2 className="h-12 w-12 text-primary animate-pulse mb-4 relative z-10" />
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
              </div>
              <p className="text-white font-medium tracking-wide">Extracting Data...</p>
              <p className="text-white/60 text-sm mt-2">This usually takes a few seconds</p>
            </div>
          )}
        </div>

        {/* Controls Area */}
        <div className="bg-card rounded-t-3xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[0_-10px_40px_rgba(0,0,0,0.1)]">
          <div className="flex items-center gap-2 mb-4">
            <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />
            <h3 className="font-semibold">Enhancement</h3>
          </div>

          <div className="flex flex-col gap-5">
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <Label className="text-sm font-medium text-muted-foreground">Crop Edges (Top / Bottom)</Label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Slider 
                  value={[crop.top]} 
                  min={0} max={40} step={1}
                  onValueChange={(v) => setCrop(c => ({ ...c, top: v[0] }))}
                  disabled={extractMemo.isPending}
                />
                <Slider 
                  value={[crop.bottom]} 
                  min={0} max={40} step={1}
                  onValueChange={(v) => setCrop(c => ({ ...c, bottom: v[0] }))}
                  disabled={extractMemo.isPending}
                />
              </div>
              <div className="flex justify-between pt-1">
                <Label className="text-sm font-medium text-muted-foreground">Crop Edges (Left / Right)</Label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Slider 
                  value={[crop.left]} 
                  min={0} max={40} step={1}
                  onValueChange={(v) => setCrop(c => ({ ...c, left: v[0] }))}
                  disabled={extractMemo.isPending}
                />
                <Slider 
                  value={[crop.right]} 
                  min={0} max={40} step={1}
                  onValueChange={(v) => setCrop(c => ({ ...c, right: v[0] }))}
                  disabled={extractMemo.isPending}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="grayscale" className="text-base">Document Mode (Grayscale)</Label>
              <Switch 
                id="grayscale" 
                checked={grayscale} 
                onCheckedChange={setGrayscale} 
                disabled={extractMemo.isPending}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="contrast" className="text-base">High Contrast</Label>
              <Switch 
                id="contrast" 
                checked={highContrast} 
                onCheckedChange={setHighContrast} 
                disabled={extractMemo.isPending}
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between">
                <Label className="text-base">Compression Quality</Label>
                <span className="text-sm text-muted-foreground">{Math.round(quality * 100)}%</span>
              </div>
              <Slider 
                value={[quality * 100]} 
                min={10} 
                max={100} 
                step={5}
                onValueChange={(v) => setQuality(v[0] / 100)}
                disabled={extractMemo.isPending}
              />
            </div>

            <Button 
              size="lg" 
              className="w-full h-14 mt-4 text-lg font-semibold bg-primary hover:bg-accent text-white rounded-xl shadow-lg"
              onClick={handleExtract}
              disabled={extractMemo.isPending || isProcessing || !originalBlob}
            >
              Extract Text <Wand2 className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
