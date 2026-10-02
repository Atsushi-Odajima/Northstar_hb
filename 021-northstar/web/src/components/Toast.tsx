import React, { createContext, useCallback, useContext, useState } from "react";

interface Toast { id: number; text: string; kind: "info" | "error" | "success" }
const Ctx = createContext<{ toast: (text: string, kind?: Toast["kind"]) => void }>({ toast: () => undefined });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, text, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}
