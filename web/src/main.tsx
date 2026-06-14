import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { Gate } from "@/components/Gate";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { PrefsProvider } from "@/lib/prefs";
import { WindowManagerProvider } from "@/components/windows/WindowManager";
import { ToastProvider } from "@/components/ui/Toast";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PrefsProvider>
          <AuthProvider>
            <ToastProvider>
              <WindowManagerProvider>
                <Gate />
              </WindowManagerProvider>
            </ToastProvider>
          </AuthProvider>
        </PrefsProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
