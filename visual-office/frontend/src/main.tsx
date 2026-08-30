import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app.js";
import "./styles.css";
const client = new QueryClient({ defaultOptions: { queries: { refetchInterval: 5000, retry: 1 } } });
createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={client}><BrowserRouter><App /></BrowserRouter></QueryClientProvider></React.StrictMode>);
