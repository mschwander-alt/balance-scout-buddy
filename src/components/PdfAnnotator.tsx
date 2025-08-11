// src/components/PdfAnnotator.tsx
// Drop‑in Annotator für Highlight & FreeText mit Persistenz in Supabase (JSON je (doc_id,user_id))
// Voraussetzungen:
// 1) Tabelle + RLS (siehe Chat‑Anleitung)
// 2) Supabase Client unter "@/integrations/supabase/client"
// 3) Vite/Next: pdfjs-dist installiert (v4.x)

import React, { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { supabase } from "@/integrations/supabase/client";

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
  
  const { data, error } = await supabase
    .from("pdf_annotations")
    .select("annotations")
    .eq("doc_id", doc_id)
    .eq("user_id", user_id)
    .maybeSingle();
  if (error) console.warn("loadAnnotations", error.message);
  return (data?.annotations as Ann[]) || [];
}

async function saveAnnotations(doc_id: string, user_id: string, annotations: Ann[]) {
  if (!user_id || user_id === '') {
    console.warn("saveAnnotations: Invalid user_id");
    return;
  }
  
  const { error } = await supabase
    .from("pdf_annotations")
    .upsert({ doc_id, user_id, annotations });
  if (error) throw error;
}

export default function PdfAnnotator({
  docUrl,
  docId,
  userId,
  initialScale = 1,
}: {
  docUrl: string; // signierte URL aus Supabase Storage
  docId: string; // UUID eures Dokuments
  userId: string; // auth.uid()
  initialScale?: number;
}) {
  // Early return if user not authenticated
  if (!userId || userId === '') {
    return <div className="p-4">Benutzer nicht authentifiziert</div>;
  }
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState(0);
  const [scale, setScale] = useState(initialScale);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [mode, setMode] = useState<"highlight" | "freetext" | "none">("highlight");
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
    if (!docId || !userId) return;
    setSaving("saving");
    saveAnnotations(docId, userId, debouncedAnns)
      .then(() => setSaving("saved"))
      .catch((e) => {
        console.error(e);
        setSaving("idle");
      });
  }, [debouncedAnns, docId, userId]);

  if (!pdf) return <div className="p-4 text-center">PDF wird geladen …</div>;

  return (
    <div className="flex flex-col h-full">
      <Toolbar mode={mode} setMode={setMode} scale={scale} setScale={setScale} saving={saving} />
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
}: {
  mode: "highlight" | "freetext" | "none";
  setMode: (m: "highlight" | "freetext" | "none") => void;
  scale: number;
  setScale: (fn: (n: number) => number) => void;
  saving: "idle" | "saving" | "saved";
}) {
  return (
    <div className="flex items-center gap-3 border-b px-3 py-2 bg-white/70 sticky top-0 z-10">
      <button className={mode === "highlight" ? "font-semibold" : "opacity-70"} onClick={() => setMode("highlight")}>Highlight</button>
      <button className={mode === "freetext" ? "font-semibold" : "opacity-70"} onClick={() => setMode("freetext")}>FreeText</button>
      <button className={mode === "none" ? "font-semibold" : "opacity-70"} onClick={() => setMode("none")}>Zeiger</button>
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

  const pageAnns = useMemo(() => anns.filter((a) => a.page === pageNumber), [anns, pageNumber]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      
      // HiDPI/Retina support - fix for coordinate drift
      const outputScale = window.devicePixelRatio || 1;

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      
      // Set physical resolution for HiDPI displays
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      
      // Set visible CSS size
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      
      // Render with proper transform for HiDPI
      await page.render({ 
        canvas, 
        canvasContext: ctx, 
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
      }).promise;

      // Text layer for text selection - KRITISCH: muss selektierbar sein
      const textLayerDiv = textRef.current!;
      textLayerDiv.innerHTML = "";
      textLayerDiv.style.position = "absolute";
      textLayerDiv.style.left = "0";
      textLayerDiv.style.top = "0";
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      textLayerDiv.style.overflow = "hidden";
      textLayerDiv.style.userSelect = "text"; // ENABLE text selection
      textLayerDiv.style.pointerEvents = "auto"; // ENABLE mouse events
      textLayerDiv.style.opacity = "0.2";
      textLayerDiv.style.lineHeight = "1.0";
      
      // Ensure wrapper has exact CSS size for coordinate calculations
      if (wrapperRef.current) {
        wrapperRef.current.style.width = `${viewport.width}px`;
        wrapperRef.current.style.height = `${viewport.height}px`;
      }
      
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pageNumber, scale]);

  // Throttle for preventing double highlights
  let lastHighlightTime = 0;

  // Highlight durch Textauswahl - improved with guards
  const onMouseUp = () => {
    if (mode !== "highlight") return;
    
    // Guard against double highlights
    const now = Date.now();
    if (now - lastHighlightTime < 200) return;
    lastHighlightTime = now;
    
    const sel = window.getSelection();
    if (!sel || sel.type !== "Range" || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!wrapperRef.current?.contains(range.commonAncestorContainer as any)) return;
    const rects = Array.from(range.getClientRects());
    if (!rects.length) return;
    
    const pageBox = wrapperRef.current!.getBoundingClientRect();
    const normRects = rects.map((r) => ({
      x: (r.left - pageBox.left) / pageBox.width,
      y: (r.top - pageBox.top) / pageBox.height,
      w: r.width / pageBox.width,
      h: r.height / pageBox.height,
    }));
    setAnns((a) => [
      ...a,
      { id: nanoid(), page: pageNumber, type: "highlight", rects: normRects, color: "#ffeb00" },
    ]);
    sel.removeAllRanges();
  };

  // FreeText per Klick setzen - improved with hit-test to prevent bubbling
  const onClick = (e: React.MouseEvent) => {
    if (mode !== "freetext") return;
    
    // Hit-test: Don't create new annotation if clicking on existing one
    if ((e.target as HTMLElement).closest("[data-ann-id]")) return;
    
    const pageBox = wrapperRef.current!.getBoundingClientRect();
    const x = (e.clientX - pageBox.left) / pageBox.width;
    const y = (e.clientY - pageBox.top) / pageBox.height;
    setAnns((a) => [
      ...a,
      { id: nanoid(), page: pageNumber, type: "freetext", x, y, text: "Notiz", fontSize: 14, color: "#111" },
    ]);
  };

  const updateFreeText = (id: string, next: Partial<FreeTextAnn>) =>
    setAnns((all) => all.map((x) => (x.id === id ? ({ ...x, ...next } as Ann) : x)));

  const removeAnn = (id: string) => setAnns((all) => all.filter((x) => x.id !== id));

  return (
    <div
      className="relative mx-auto my-4 bg-white shadow"
      ref={wrapperRef}
      onMouseUp={onMouseUp}
      onClick={onClick}
      style={{ width: "fit-content" }}
    >
      <canvas ref={canvasRef} />
      {/* TextLayer - MUSS selektierbar sein für Highlights */}
      <div 
        ref={textRef} 
        className="absolute left-0 top-0 pointer-events-auto select-text" 
        style={{ inset: 0, userSelect: 'text', pointerEvents: 'auto' }} 
      />
      {/* Annotation‑Overlay - NICHT selektierbar, damit TextLayer funktioniert */}
      <div 
        className="absolute left-0 top-0" 
        style={{ inset: 0, pointerEvents: 'none' }} // KRITISCH: pointer-events none
      >
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
                pointerEvents: "auto", // KRITISCH: FreeText muss klickbar sein
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