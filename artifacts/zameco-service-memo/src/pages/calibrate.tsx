import { useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Upload, RotateCcw, Check } from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import {
  type Calibration,
  type CalibratedField,
  FIELD_LABELS,
  loadCalibration,
  saveCalibration,
  resetCalibration,
  ZAMECO_DEFAULT_CALIBRATION,
} from "@/lib/ocr/calibration";

const FIELD_COLORS: Record<CalibratedField, string> = {
  consumerName: "#10B981",
  dateOfServiceMemo: "#6366F1",
  accountNumber: "#F59E0B",
  address: "#EC4899",
  natureOfComplaint: "#06B6D4",
  orArNumber: "#8B5CF6",
  totalAmountPaid: "#EF4444",
};

type DragMode = { field: CalibratedField; kind: "move" | "resize" } | null;

export default function Calibrate() {
  const [, setLocation] = useLocation();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<Calibration>(loadCalibration);
  const [activeField, setActiveField] = useState<CalibratedField | null>(null);
  const [saved, setSaved] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode>(null);
  const dragStartRef = useRef<{ x: number; y: number; region: Calibration[CalibratedField] } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const getRelativePoint = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }, []);

  const startDrag = (field: CalibratedField, kind: "move" | "resize") => (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setActiveField(field);
    dragRef.current = { field, kind };
    const point = getRelativePoint(e.clientX, e.clientY);
    dragStartRef.current = { x: point.x, y: point.y, region: calibration[field] };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !dragStartRef.current) return;
    const { field, kind } = dragRef.current;
    const start = dragStartRef.current;
    const point = getRelativePoint(e.clientX, e.clientY);
    const dx = point.x - start.x;
    const dy = point.y - start.y;

    setCalibration((prev) => {
      const region = start.region;
      if (kind === "move") {
        const x = Math.min(1 - region.width, Math.max(0, region.x + dx));
        const y = Math.min(1 - region.height, Math.max(0, region.y + dy));
        return { ...prev, [field]: { ...region, x, y } };
      }
      // resize from bottom-right corner
      const width = Math.min(1 - region.x, Math.max(0.02, region.width + dx));
      const height = Math.min(1 - region.y, Math.max(0.015, region.height + dy));
      return { ...prev, [field]: { ...region, width, height } };
    });
  };

  const endDrag = () => {
    dragRef.current = null;
    dragStartRef.current = null;
  };

  const handleSave = () => {
    saveCalibration(calibration);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleReset = () => {
    resetCalibration();
    setCalibration(ZAMECO_DEFAULT_CALIBRATION);
  };

  return (
    <Layout>
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 p-4 border-b">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold">Calibrate Field Positions</h1>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-sm text-muted-foreground">
            This only matters if your printed memos don't match ZAMECO's default layout.
            Load a sample scan, drag each colored box onto its field, drag the bottom-right
            corner to resize, then save.
          </p>

          <label className="flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-4 cursor-pointer hover:bg-muted/50">
            <Upload className="h-4 w-4" />
            <span className="text-sm">Load a sample scan</span>
            <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </label>
        </div>

        {imageUrl && (
          <div className="flex-1 overflow-auto p-4">
            <div
              ref={containerRef}
              className="relative mx-auto select-none touch-none"
              style={{ maxWidth: "100%" }}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <img src={imageUrl} alt="Calibration sample" className="w-full h-auto block" draggable={false} />
              {(Object.keys(calibration) as CalibratedField[]).map((field) => {
                const region = calibration[field];
                const color = FIELD_COLORS[field];
                const isActive = activeField === field;
                return (
                  <div
                    key={field}
                    onPointerDown={startDrag(field, "move")}
                    style={{
                      position: "absolute",
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.width * 100}%`,
                      height: `${region.height * 100}%`,
                      border: `2px solid ${color}`,
                      background: `${color}22`,
                      cursor: "move",
                      boxShadow: isActive ? `0 0 0 2px ${color}` : undefined,
                    }}
                  >
                    <span
                      className="absolute -top-5 left-0 text-[10px] font-medium px-1 rounded whitespace-nowrap"
                      style={{ background: color, color: "white" }}
                    >
                      {FIELD_LABELS[field]}
                    </span>
                    <div
                      onPointerDown={startDrag(field, "resize")}
                      style={{
                        position: "absolute",
                        right: -6,
                        bottom: -6,
                        width: 14,
                        height: 14,
                        borderRadius: 9999,
                        background: color,
                        cursor: "nwse-resize",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="p-4 border-t flex gap-2">
          <Button variant="outline" onClick={handleReset} className="flex-1">
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset to default
          </Button>
          <Button onClick={handleSave} className="flex-1">
            <Check className="h-4 w-4 mr-2" />
            {saved ? "Saved!" : "Save calibration"}
          </Button>
        </div>
      </div>
    </Layout>
  );
}
