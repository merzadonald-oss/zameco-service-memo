import { useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Save, AlertTriangle, Info, Image as ImageIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { getScanSession, clearScanSession } from "@/lib/scan-session";
import { dateForInput } from "@/lib/memo-fields";
import { useCreateMemo } from "@workspace/api-client-react";
import type { MemoExtraction } from "@workspace/api-client-react";

const reviewSchema = z.object({
  serviceMemoCode: z.string().min(1, "Code is required"),
  dateReceived: z.string().min(1, "Date received is required"),
  dateOfServiceMemo: z.string().min(1, "Date of memo is required"),
  natureOfComplaint: z.string().min(1, "Nature of complaint is required"),
  accountNumber: z.string().min(1, "Account number is required"),
  consumerName: z.string().min(1, "Consumer name is required"),
  address: z.string().min(1, "Address is required"),
  totalAmountPaid: z.string().min(1, "Amount paid is required"),
  orArNumber: z.string().min(1, "OR/AR Number is required"),
});

type ReviewFormValues = z.infer<typeof reviewSchema>;

interface ExtendedSession {
  imageDataBase64: string;
  mimeType: string;
  extractedData?: MemoExtraction;
}

export default function Review() {
  const [, setLocation] = useLocation();
  const session = getScanSession() as ExtendedSession | null;
  
  const createMemo = useCreateMemo({
    mutation: {
      onSuccess: (memo) => {
        clearScanSession();
        if (memo.driveStatus === "synced" && memo.sheetStatus === "synced") {
          alert("Memo saved and synced successfully.");
        } else {
          alert(`Memo saved, but sync needs attention: ${memo.syncError || "Open History to retry."}`);
        }
        setLocation("/");
      },
      onError: (err) => {
        console.error("Save failed", err);
        alert("Failed to save memo. Please try again.");
      }
    }
  });

  const form = useForm<ReviewFormValues>({
    resolver: zodResolver(reviewSchema),
    defaultValues: {
      serviceMemoCode: "",
      dateReceived: "",
      dateOfServiceMemo: "",
      natureOfComplaint: "",
      accountNumber: "",
      consumerName: "",
      address: "",
      totalAmountPaid: "",
      orArNumber: "",
    }
  });

  useEffect(() => {
    if (!session) {
      setLocation("/");
      return;
    }
    if (session.extractedData) {
      form.reset({
        serviceMemoCode: session.extractedData.serviceMemoCode || "",
        dateReceived: dateForInput(session.extractedData.dateReceived || ""),
        dateOfServiceMemo: dateForInput(session.extractedData.dateOfServiceMemo || ""),
        natureOfComplaint: session.extractedData.natureOfComplaint || "",
        accountNumber: session.extractedData.accountNumber || "",
        consumerName: session.extractedData.consumerName || "",
        address: session.extractedData.address || "",
        totalAmountPaid: session.extractedData.totalAmountPaid || "",
        orArNumber: session.extractedData.orArNumber || "",
      });
    }
  }, [session, form, setLocation]);

  const onSubmit = (data: ReviewFormValues) => {
    if (!session) return;
    const base64Data = session.imageDataBase64.split(",")[1];
    
    createMemo.mutate({
      data: {
        ...data,
        imageData: base64Data,
        imageMimeType: session.mimeType as any
      }
    });
  };

  if (!session) return null;
  const extraction = session.extractedData;
  const warnings = [
    ...(extraction?.warnings || []),
    ...(["dateReceived", "dateOfServiceMemo"] as const)
      .filter((key) => extraction?.[key] && !dateForInput(extraction[key]))
      .map((key) => `${key === "dateReceived" ? "Date received" : "Memo date"} could not be formatted. Enter it manually.`),
  ];

  return (
    <Layout 
      title="Verify Fields" 
      showNav={false}
      headerLeft={
        <Button variant="ghost" size="icon" onClick={() => setLocation("/scan")} disabled={createMemo.isPending}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
      }
    >
      <div className="flex flex-col h-full bg-background overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom))]">
        
        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="m-4 mb-0 p-3 bg-amber-50 border border-amber-200 rounded-xl flex flex-col gap-2 shadow-sm">
            <div className="flex items-center gap-2 text-amber-700 font-semibold">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm">Double check these fields</span>
            </div>
            <ul className="list-disc list-inside pl-6 text-xs text-amber-800 space-y-1">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}

        {extraction?.confidence !== undefined && (
          <div className="mx-4 mt-4 flex items-center justify-between text-xs text-muted-foreground bg-secondary/50 p-2 rounded-lg border">
            <div className="flex items-center gap-1.5">
              <Info className="h-4 w-4" />
              <span>AI Confidence</span>
            </div>
            <span className="font-mono font-medium">
              {Math.round(extraction.confidence * 100)}%
            </span>
          </div>
        )}

        <div className="p-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="serviceMemoCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Memo Code</FormLabel>
                      <FormControl>
                        <Input className="font-mono" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="accountNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Account Number</FormLabel>
                      <FormControl>
                        <Input className="font-mono" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="consumerName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Consumer Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[60px] resize-none" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="natureOfComplaint"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nature of Complaint</FormLabel>
                    <FormControl>
                      <Textarea {...field} className="min-h-[60px] resize-none" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="dateOfServiceMemo"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Memo Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="dateReceived"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date Received</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="totalAmountPaid"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount Paid</FormLabel>
                      <FormControl>
                        <Input type="text" inputMode="decimal" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="orArNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>OR/AR Number</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <div className="h-[200px] w-full mt-4 rounded-xl border overflow-hidden bg-black/5 relative group">
                <div className="absolute inset-0 flex flex-col items-center justify-center opacity-50 z-0">
                   <ImageIcon className="h-8 w-8 mb-2" />
                   <span className="text-xs font-medium">Original Image</span>
                </div>
                <img 
                  src={session.imageDataBase64} 
                  alt="Original scan" 
                  className="w-full h-full object-cover opacity-80 mix-blend-multiply absolute inset-0 z-10 cursor-pointer"
                  onClick={() => {
                    // Quick modal or fullscreen viewer could go here.
                  }}
                />
              </div>

            </form>
          </Form>
        </div>
      </div>

      {/* Floating Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/80 backdrop-blur-xl border-t border-border z-40 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
        <Button 
          size="lg" 
          className="w-full h-14 bg-[#10B981] hover:bg-[#059669] text-white shadow-lg text-lg"
          onClick={form.handleSubmit(onSubmit)}
          disabled={createMemo.isPending}
        >
          {createMemo.isPending ? "Saving..." : (
            <>
              <Save className="mr-2 h-5 w-5" />
              Save Record
            </>
          )}
        </Button>
      </div>
    </Layout>
  );
}
