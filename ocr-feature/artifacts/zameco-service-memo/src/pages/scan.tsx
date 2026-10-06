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
import { useGetNextMemoCode } from "@workspace/api-client-react";
import { extractFieldsWithOcr, type ExtractProgress } from "@/lib/ocr/fieldOcr";
import { loadCalibration } from "@/lib/ocr/calibration";

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

  // On-device OCR extraction state. This runs entirely in the browser via
  // Tesseract.js against the calibrated field regions - no server call, no
  // AI key, works offline.
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState<ExtractProgress | null>(null);

  const handleExtract = async () => {
    if (!processedBase64) return;

    setIsExtracting(true);
    setExtractProgress(null);
    try {
      const calibration = loadCalibration();
      const ocrResults = await extractFieldsWithOcr(processedBase64, calibration, setExtractProgress);

      // Flag fields Tesseract itself wasn't confident about, so the review
      // screen can highlight them for a closer look rather than silently
      // trusting a low-confidence read.
      const LOW_CONFIDENCE_THRESHOLD = 55;
      const warnings = Object.entries(ocrResults)
        .filter(([, result]) => result.value.length > 0 && result.confidence < LOW_CONFIDENCE_THRESHOLD)
        .map(([field]) => `Low confidence reading "${field}" - please double-check this field.`);

      const extractedData = {
        serviceMemoCode: nextCodeData?.code || "",
        dateReceived: nextCodeData?.dateReceived || new Date().toISOString().split("T")[0],
        dateOfServiceMemo: ocrResults.dateOfServiceMemo.value,
        natureOfComplaint: ocrResults.natureOfComplaint.value,
        accountNumber: ocrResults.accountNumber.value,
        consumerName: ocrResults.consumerName.value,
        address: ocrResults.address.value,
        totalAmountPaid: ocrResults.totalAmountPaid.value,
        orArNumber: ocrResults.orArNumber.value,
        confidence:
          Object.values(ocrResults).reduce((sum, r) => sum + r.confidence, 0) /
          (Object.values(ocrResults).length * 100),
        warnings,
      };

      saveScanSession({
        imageDataBase64: processedBase64,
        mimeType: session?.mimeType || "image/jpeg",
        extractedData,
      } as any); // we will extend ScanSessionData locally in review
      setLocation("/review");
    } catch (err) {
      console.error("OCR extraction failed", err);
      alert("Failed to read fields from memo. Please try again or proceed to manual entry.");
    } finally {
      setIsExtracting(false);
      setExtractProgress(null);
    }
  };

  if (!session) return null;

  return (
    <Layout 
      title="Review Scan" 
      showNav={false}
      headerLeft={
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")} disabled={isExtracting}>
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
          
          {isExtracting && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center backdrop-blur-sm z-50">
              <div className="relative">
                <Wand2 className="h-12 w-12 text-primary animate-pulse mb-4 relative z-10" />
                <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full" />
              </div>
              <p className="text-white font-medium tracking-wide">Reading fields on-device...</p>
              <p className="text-white/60 text-sm mt-2">
                {extractProgress
                  ? `${extractProgress.label} (${extractProgress.index}/${extractProgress.total})`
                  : "Starting..."}
              </p>
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
                  disabled={isExtracting}
                />
                <Slider 
                  value={[crop.bottom]} 
                  min={0} max={40} step={1}
                  onValueChange={(v) => setCrop(c => ({ ...c, bottom: v[0] }))}
                  disabled={isExtracting}
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
                  disabled={isExtracting}
                />
                <Slider 
                  value={[crop.right]} 
                  min={0} max={40} step={1}
                  onValueChange={(v) => setCrop(c => ({ ...c, right: v[0] }))}
                  disabled={isExtracting}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="grayscale" className="text-base">Document Mode (Grayscale)</Label>
              <Switch 
                id="grayscale" 
                checked={grayscale} 
                onCheckedChange={setGrayscale} 
                disabled={isExtracting}
              />
            </div>
            
            <div className="flex items-center justify-between">
              <Label htmlFor="contrast" className="text-base">High Contrast</Label>
              <Switch 
                id="contrast" 
                checked={highContrast} 
                onCheckedChange={setHighContrast} 
                disabled={isExtracting}
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
                disabled={isExtracting}
              />
            </div>

            <Button 
              size="lg" 
              className="w-full h-14 mt-4 text-lg font-semibold bg-primary hover:bg-accent text-white rounded-xl shadow-lg"
              onClick={handleExtract}
              disabled={isExtracting || isProcessing || !originalBlob}
            >
              Extract Text <Wand2 className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
