import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ThemeProvider } from "./components/ui/theme-provider";
import { applyLightModeClass, getLightModeEnabled } from "./lib/lightMode";
import { applySavedCompanyTheme } from "./lib/companyTheme";

applyLightModeClass(getLightModeEnabled());
applySavedCompanyTheme();

createRoot(document.getElementById("root")!).render(
  <ThemeProvider defaultTheme="light" storageKey="newshop-theme">
    <App />
  </ThemeProvider>
);
