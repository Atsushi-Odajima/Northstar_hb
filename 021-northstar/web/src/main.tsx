import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import "./styles.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: true } } });

const updateSW = registerSW({
  onNeedRefresh() {
    window.dispatchEvent(new CustomEvent("northstar:sw-update", { detail: { update: () => updateSW(true) } }));
  },
  onOfflineReady() {
    window.dispatchEvent(new CustomEvent("northstar:offline-ready"));
  },
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
