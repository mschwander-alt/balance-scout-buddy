// src/components/PdfAnnotator.tsx
// Drop‑in Annotator für Highlight & FreeText mit Persistenz in Supabase (JSON je (doc_id,user_id))
// Voraussetzungen:
// 1) Tabelle + RLS (siehe Chat‑Anleitung)
// 2) Supabase Client unter "@/integrations/supabase/client"
// 3) Vite/Next: pdfjs-dist installiert (v4.x)

import React, { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { supabase } from "@/integrations/supabase/client";
import { Save, ToggleRight } from "lucide-react";

// Import PDF.js components für v4.x (latest) + CSS für TextLayer
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/build/pdf.mjs";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css"; // KRITISCH für TextLayer-Funktion

// Worker für v4.x mit .mjs (universeller Ansatz)
const worker = new Worker(
  new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
  { type: "module" }
);
GlobalWorkerOptions.workerPort = worker;

export type HighlightAnn = {
  id: string;
  page: number; // 1‑basiert
  type: "highlight";
  rects: { x: number; y: number; w: number; h: number }[]; // normiert 0..1 relativ zur Seite
  color?: string; // hex
};

export type FreeTextAnn = {
  id: string;
  page: number;
  type: "freetext";
  x: number; // 0..1
  y: number; // 0..1
  text: string;
  fontSize?: number;
  color?: string;
};

export type Ann = HighlightAnn | FreeTextAnn;

function useDebounced<T>(value: T, delay = 800) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

async function loadAnnotations(doc_id: string, user_id: string): Promise<Ann[]> {
  if (!user_id || user_id === '') {
    console.warn("loadAnnotations: Invalid user_id");
    return [];
  }
  
  console.log("🔍 Loading annotations for:", { doc_id, user_id });
  
  const { data, error } = await supabase
    .from("pdf_annotations")
    .select("annotations")
    .eq("doc_id", doc_id)
    .eq("user_id", user_id)
    .maybeSingle();
  
  if (error) {
    console.error("❌ Load annotations error:", error.message);
    return [];
  }
  
  const annotations = (data?.annotations as Ann[]) || [];
  console.log("✅ Loaded annotations:", annotations);
  return annotations;
}

async function saveAnnotations(doc_id: string, user_id: string, annotations: Ann[]) {
  if (!user_id || user_id === '') {
    console.warn("saveAnnotations: Invalid user_id");
    return;
  }
  
  console.log("💾 Saving annotations:", { doc_id, user_id, count: annotations.length, annotations });
  
  const { error } = await supabase
    .from("pdf_annotations")
    .upsert({ doc_id, user_id, annotations });
    
  if (error) {
    console.error("❌ Save annotations error:", error);
    throw error;
  }
  
  console.log("✅ Annotations saved successfully");
}

interface PdfAnnotatorProps {
  docUrl: string;
  docId: string;
  userId: string;
  initialScale?: number;
  viewerMode?: 'annotator' | 'pdfjs';
  onToggleViewer?: () => void;
}

export default function PdfAnnotator({
  docUrl,
  docId,
  userId,
  initialScale = 1,
  viewerMode,
  onToggleViewer,
}: PdfAnnotatorProps) {
  // Early return if user not authenticated
  if (!userId || userId === '') {
    return <div className="p-4">Benutzer nicht authentifiziert</div>;
  }
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(initialScale);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [mode, setMode] = useState<"highlight" | "freetext" | "none">("highlight");
  
  console.log("🎯 Current mode:", mode); // Debug current mode
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const debouncedAnns = useDebounced(anns, 700);

  // PDF laden
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const loadingTask = getDocument({ url: docUrl });
        const doc = await loadingTask.promise;
        if (!cancel) {
          setPdf(doc);
          setPages(doc.numPages);
        }
      } catch (error) {
        console.error("PDF loading error:", error);
        if (!cancel) {
          // Handle PDF loading error gracefully
          setPdf(null);
          setPages(0);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [docUrl]);

  // Bisherige Annotations laden
  useEffect(() => {
    if (!docId || !userId) return;
    loadAnnotations(docId, userId).then(setAnns);
  }, [docId, userId]);

  // Speichern (debounced)
  useEffect(() => {
    if (!docId || !userId) {
      console.log("⚠️ Missing docId or userId for saving:", { docId, userId });
      return;
    }
    
    console.log("💾 Debounced save triggered for:", debouncedAnns.length, "annotations");
    
    setSaving("saving");
    saveAnnotations(docId, userId, debouncedAnns)
      .then(() => {
        console.log("✅ Save completed successfully");
        setSaving("saved");
      })
      .catch((e) => {
        console.error("❌ Save failed:", e);
        setSaving("idle");
      });
  }, [debouncedAnns, docId, userId]);

  if (!pdf) return <div className="p-4 text-center">PDF wird geladen …</div>;

  return (
    <div className="flex flex-col h-full">
      <Toolbar 
        mode={mode} 
        setMode={setMode} 
        scale={scale} 
        setScale={setScale} 
        saving={saving} 
        docId={docId}
        userId={userId}
        anns={anns}
        onToggleViewer={onToggleViewer}
      />
      <div className="overflow-auto grow p-2">
        {Array.from({ length: pages }, (_, i) => (
          <PageView
            key={i + 1}
            pageNumber={i + 1}
            pdf={pdf}
            scale={scale}
            mode={mode}
            anns={anns}
            setAnns={setAnns}
          />
        ))}
      </div>
    </div>
  );
}

function Toolbar({
  mode,
  setMode,
  scale,
  setScale,
  saving,
  docId,
  userId,
  anns,
  onToggleViewer,
}: {
  mode: "highlight" | "freetext" | "none";
  setMode: (m: "highlight" | "freetext" | "none") => void;
  scale: number;
  setScale: (fn: (n: number) => number) => void;
  saving: "idle" | "saving" | "saved";
  docId: string;
  userId: string;
  anns: Ann[];
  onToggleViewer?: () => void;
}) {
  console.log("🔧 Toolbar mode change:", { currentMode: mode });
  
  const handleManualSave = async () => {
    try {
      await saveAnnotations(docId, userId, anns);
      console.log("🔄 Manual save completed");
    } catch (error) {
      console.error("❌ Manual save failed:", error);
    }
  };

  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 bg-white/70 sticky top-0 z-10">
      <button 
        className={mode === "highlight" ? "font-semibold bg-blue-100 px-2 py-1 rounded" : "opacity-70"} 
        onClick={() => {
          console.log("🎯 Setting mode to highlight");
          setMode("highlight");
        }}
      >
        Highlight
      </button>
      <button 
        className={mode === "freetext" ? "font-semibold bg-blue-100 px-2 py-1 rounded" : "opacity-70"} 
        onClick={() => {
          console.log("🎯 Setting mode to freetext");
          setMode("freetext");
        }}
      >
        FreeText
      </button>
      <button 
        className={mode === "none" ? "font-semibold bg-blue-100 px-2 py-1 rounded" : "opacity-70"} 
        onClick={() => {
          console.log("🎯 Setting mode to none");
          setMode("none");
        }}
      >
        Zeiger
      </button>
      
      {/* Manual save button */}
      <button 
        onClick={handleManualSave}
        className="p-2 bg-green-100 text-green-800 rounded hover:bg-green-200 flex items-center justify-center"
        title="Annotationen speichern"
      >
        <Save size={16} />
      </button>
      
      {/* PDF Viewer Toggle Button */}
      {onToggleViewer && (
        <button 
          onClick={onToggleViewer}
          className="p-2 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 flex items-center justify-center"
          title="Ansicht PDF Viewer"
        >
          <ToggleRight size={16} />
        </button>
      )}
      
      <div className="ml-auto flex items-center gap-2">
        <button onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>−</button>
        <span className="tabular-nums w-12 text-center">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(3, s + 0.2))}>+</button>
      </div>
      <span className="text-xs opacity-60">{saving === "saving" ? "Speichere…" : saving === "saved" ? "Gespeichert" : ""}</span>
    </div>
  );
}

function PageView({
  pdf,
  pageNumber,
  scale,
  mode,
  anns,
  setAnns,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  mode: "highlight" | "freetext" | "none";
  anns: Ann[];
  setAnns: React.Dispatch<React.SetStateAction<Ann[]>>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // State für Scan-PDF Fallback (Box-Highlight)
  const [hasText, setHasText] = useState(true);
  const [drag, setDrag] = useState<null | {x0:number;y0:number;x1:number;y1:number}>(null);

  const pageAnns = useMemo(() => anns.filter((a) => a.page === pageNumber), [anns, pageNumber]);

  useEffect(() => {
    let cancelled = false;
    let currentCanvas: HTMLCanvasElement | null = null;
    let currentTextDiv: HTMLDivElement | null = null;
    
    (async () => {
      try {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      
      // HiDPI/Retina korrekt rendern - IMPROVED für bessere Qualität
      const dpr = Math.min(window.devicePixelRatio || 1, 2); // Limit to 2x for better performance

      const canvas = canvasRef.current;
      const textLayerDiv = textRef.current;
      
      if (!canvas || !textLayerDiv || cancelled) return;
      
      // Store references for cleanup
      currentCanvas = canvas;
      currentTextDiv = textLayerDiv;
      
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;
      
      // IMPROVED: Better scaling for crisp rendering
      const scaledViewport = page.getViewport({ scale: scale * dpr });
      
      // Set physical resolution for crisp display
      canvas.width = Math.floor(scaledViewport.width);
      canvas.height = Math.floor(scaledViewport.height);
      
      // Set visible CSS size - IMPROVED precision
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      
      // IMPROVED: Better quality rendering
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
        
      // Render with optimized viewport
      await page.render({ 
        canvas,
        canvasContext: ctx, 
        viewport: scaledViewport
      }).promise;

      if (cancelled) return;

        // ÄNDERUNG: Immer Rectangle-Highlight ermöglichen (statt Text-Selektion)
        if (textLayerDiv.parentNode) {
          textLayerDiv.textContent = ""; // Clear previous content
          
          // Get actual text content from PDF
          try {
            const textContent = await page.getTextContent();
            const hasActualText = (textContent.items?.length ?? 0) > 0;
            
            // WICHTIG: Setze immer hasText = false für Rectangle-Highlighting
            setHasText(false);
            
            console.log("📄 PDF forcing rectangle mode for all PDFs");
            
          } catch (err) {
            console.warn("⚠️ TextContent error:", err);
            setHasText(false);
          }
        }
        
        // Wrapper EXAKT gleiche CSS-Größe für Koordinaten-Berechnung
        const wrapper = wrapperRef.current;
        if (wrapper && !cancelled) {
          wrapper.style.width = `${viewport.width}px`;
          wrapper.style.height = `${viewport.height}px`;
        }
      } catch (error) {
        if (!cancelled) {
          console.error("PDF rendering error:", error);
        }
      }
    })();
    
    return () => {
      cancelled = true;
      // Safer cleanup: Check if elements still exist before manipulation
      try {
        if (currentTextDiv && currentTextDiv.parentNode && currentTextDiv.isConnected) {
          // Clear children instead of textContent to avoid DOM conflicts
          while (currentTextDiv.firstChild) {
            currentTextDiv.removeChild(currentTextDiv.firstChild);
          }
          // Reset styles safely
          currentTextDiv.removeAttribute('style');
        }
      } catch (error) {
        // Silently ignore cleanup errors - DOM might already be cleaned up
        console.debug('PDF cleanup ignored:', error);
      }
    };
  }, [pdf, pageNumber, scale]);

  // Hilfsfunktion für Koordinaten-Normalisierung
  const normalizeCoords = (e: React.MouseEvent) => {
    const box = wrapperRef.current!.getBoundingClientRect();
    return {
      x: (e.clientX - box.left) / box.width,
      y: (e.clientY - box.top) / box.height,
    };
  };

  // MouseDown: Drag-Start für Rectangle-Highlighting (alle PDFs)
  const onMouseDown = (e: React.MouseEvent) => {
    console.log("🖱️ Mouse down, mode:", mode);
    
    if (mode !== "highlight") return;
    
    // Hit-test: Nicht auf bestehende Annotations starten
    if ((e.target as HTMLElement).closest("[data-ann-id]")) return;
    
    const {x, y} = normalizeCoords(e);
    setDrag({ x0: x, y0: y, x1: x, y1: y });
    console.log("🎯 Drag started at:", {x, y});
  };

  // MouseMove: Drag-Update für Scan-PDFs
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag || mode !== "highlight") return;
    
    const {x, y} = normalizeCoords(e);
    setDrag(d => d ? { ...d, x1: x, y1: y } : d);
  };

  // Throttle for preventing double highlights
  let lastHighlightTime = 0;

  // MouseUp: Highlight erstellen (Text-Selection oder Box-Drag)
  const onMouseUp = () => {
    console.log("🖱️ Mouse up event, mode:", mode, "hasText:", hasText, "drag:", !!drag);
    
    if (mode !== "highlight") {
      console.log("⚠️ Not in highlight mode, skipping");
      return;
    }

    // VEREINFACHT: Immer Box-Highlight verwenden
    if (drag) {
      const x = Math.min(drag.x0, drag.x1);
      const y = Math.min(drag.y0, drag.y1);
      const w = Math.abs(drag.x1 - drag.x0);
      const h = Math.abs(drag.y1 - drag.y0);
      
      console.log("📦 Box highlight:", {x, y, w, h});
      
      if (w > 0.005 && h > 0.005) { // Mindestgröße
        const newHighlight = {
          id: nanoid(),
          page: pageNumber,
          type: "highlight" as const,
          rects: [{x, y, w, h}],
          color: "#ffeb00"
        };
        
        console.log("✅ Creating box highlight:", newHighlight);
        
        setAnns(a => {
          const newAnns = [...a, newHighlight];
          console.log("📊 Updated annotations:", newAnns);
          return newAnns;
        });
      } else {
        console.log("⚠️ Box too small, ignoring");
      }
      
      setDrag(null);
      return;
    }

    // Text-Selektion ist jetzt deaktiviert - nur Rectangle-Highlighting
    setDrag(null);
  };

  // FreeText per Klick setzen - improved with hit-test to prevent bubbling
  const onClick = (e: React.MouseEvent) => {
    console.log("🖱️ Click event, mode:", mode, "target:", e.target);
    
    if (mode !== "freetext") {
      console.log("⚠️ Not in freetext mode, skipping");
      return;
    }
    
    // Hit-test: Don't create new annotation if clicking on existing one
    if ((e.target as HTMLElement).closest("[data-ann-id]")) {
      console.log("⚠️ Clicked on existing annotation, skipping");
      return;
    }
    
    const pageBox = wrapperRef.current!.getBoundingClientRect();
    const x = (e.clientX - pageBox.left) / pageBox.width;
    const y = (e.clientY - pageBox.top) / pageBox.height;
    
    const newFreeText = { 
      id: nanoid(), 
      page: pageNumber, 
      type: "freetext" as const, 
      x, 
      y, 
      text: "Notiz", 
      fontSize: 14, 
      color: "#111" 
    };
    
    console.log("✅ Creating freetext:", newFreeText);
    
    setAnns((a) => {
      const newAnns = [...a, newFreeText];
      console.log("📊 Updated annotations:", newAnns);
      return newAnns;
    });
  };

  const updateFreeText = (id: string, next: Partial<FreeTextAnn>) =>
    setAnns((all) => all.map((x) => (x.id === id ? ({ ...x, ...next } as Ann) : x)));

  const removeAnn = (id: string) => setAnns((all) => all.filter((x) => x.id !== id));

  return (
    <div
      className="relative mx-auto my-4 bg-white shadow"
      ref={wrapperRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onClick={onClick}
      style={{ width: "fit-content", minHeight: "200px", cursor: mode === "highlight" ? "crosshair" : "default" }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
      {/* TextLayer - DEAKTIVIERT für Rectangle-Highlighting */}
      <div 
        ref={textRef} 
        className="absolute left-0 top-0" 
        style={{ 
          inset: 0, 
          pointerEvents: 'none', // Deaktiviert für Rectangle-Mode
          userSelect: 'none'
        }} 
      />
      {/* Annotation‑Overlay - PASSIV, fängt keine Events ab */}
      <div 
        className="absolute left-0 top-0" 
        style={{ 
          inset: 0, 
          pointerEvents: 'none'  // KRITISCH: komplett passiv
        }}
      >
        {/* Temporäres Drag-Rechteck - IMMER verfügbar im Highlight-Modus */}
        {drag && mode === "highlight" && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.min(drag.x0, drag.x1) * 100}%`,
              top: `${Math.min(drag.y0, drag.y1) * 100}%`,
              width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
              height: `${Math.abs(drag.y1 - drag.y0) * 100}%`,
              background: 'rgba(255,235,0,0.6)',
              border: '2px dashed #ffcc00',
              borderRadius: 2,
              pointerEvents: 'none'
            }}
          />
        )}
        {pageAnns.map((a) =>
          a.type === "highlight" ? (
            <React.Fragment key={a.id}>
              {a.rects.map((r, i) => (
                <div
                  key={`${a.id}-${i}`}
                  style={{
                    position: "absolute",
                    left: `${r.x * 100}%`,
                    top: `${r.y * 100}%`,
                    width: `${r.w * 100}%`,
                    height: `${r.h * 100}%`,
                    background: "rgba(255,235,0,0.45)",
                    borderRadius: 2,
                    pointerEvents: "none", // Highlights nicht klickbar
                  }}
                />
              ))}
              {mode === "none" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAnn(a.id);
                  }}
                  className="absolute right-1 top-1 text-xs bg-white/80 px-1 rounded"
                  style={{ pointerEvents: "auto" }} // Button klickbar
                >
                  ×
                </button>
              )}
            </React.Fragment>
          ) : (
            <div
              key={a.id}
              data-ann-id={a.id} // Add data attribute for hit-testing
              contentEditable
              suppressContentEditableWarning
              onMouseDown={(e) => e.stopPropagation()} // Prevent bubbling
              onClick={(e) => e.stopPropagation()} // Prevent bubbling
              onBlur={(e) => updateFreeText(a.id, { text: e.currentTarget.textContent || "" })}
              style={{
                position: "absolute",
                left: `${a.x * 100}%`,
                top: `${a.y * 100}%`,
                padding: "2px 6px",
                background: "rgba(255,255,255,0.85)",
                border: "1px solid #ddd",
                borderRadius: 4,
                fontSize: `${(a.fontSize || 14) * scale}px`, // zoom‑aware
                color: a.color || "#111",
                cursor: "text",
                minWidth: 24,
                outline: "none",
                pointerEvents: "auto", // KRITISCH: FreeText muss Events bekommen
              }}
            >
              {a.text}
              {mode === "none" && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAnn(a.id);
                  }}
                  className="ml-2 text-xs opacity-70"
                  style={{ pointerEvents: "auto" }}
                >
                  ×
                </button>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}