"use client";

import { useState, useEffect, useRef } from "react";
import { Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import "@excalidraw/excalidraw/index.css";

interface WhiteboardEditorProps {
  fileName: string;
  onSave?: (data: string) => void;
  onClose?: () => void;
}

export function WhiteboardEditor({
  fileName,
  onSave,
  onClose,
}: WhiteboardEditorProps) {
  const [mounted, setMounted] = useState(false);
  const excalidrawRef = useRef<any>(null);
  const [ExcalidrawComponent, setExcalidrawComponent] = useState<any>(null);

  useEffect(() => {
    setMounted(true);
    import("@excalidraw/excalidraw").then((mod) => {
      setExcalidrawComponent(() => mod.Excalidraw);
    });
  }, []);

  const handleSave = () => {
    if (!excalidrawRef.current || !onSave) return;
    const elements = excalidrawRef.current.getSceneElements();
    const appState = excalidrawRef.current.getAppState();
    const data = JSON.stringify({
      elements,
      appState: {
        viewBackgroundColor: appState.viewBackgroundColor,
      },
    });
    onSave(data);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-panel border-b border-line">
        <span className="text-sm font-medium text-fg truncate">{fileName}</span>
        <div className="flex items-center gap-1">
          {onSave && (
            <Button variant="ghost" size="xs" onClick={handleSave}>
              <Save className="w-4 h-4 mr-1" />
              Save
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="xs" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 relative" style={{ minHeight: 400 }}>
        {mounted && ExcalidrawComponent ? (
          <ExcalidrawComponent
            theme="dark"
            excalidrawAPI={(api: any) => {
              excalidrawRef.current = api;
            }}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                export: false,
                saveToActiveFile: false,
              },
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-fg-muted">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
