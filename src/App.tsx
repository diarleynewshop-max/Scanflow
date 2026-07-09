import { Suspense, lazy } from "react";
import { Analytics as VercelAnalytics } from "@vercel/analytics/react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { DesktopShell } from "@/components/DesktopShell";

// 1. IMPORTAMOS O BOTÃO AQUI
import { ThemeToggle } from "@/components/ui/theme-toggle";
import TourGuide from "@/components/TourGuide";
import { EmpresaToggleSF } from "@/components/EmpresaToggleSF";

const Home = lazy(() => import("./pages/Home"));
const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Compras = lazy(() => import("./pages/Compras"));
const ConsultaPreco = lazy(() => import("./pages/ConsultaPreco"));
const MeusPedidos = lazy(() => import("./pages/MeusPedidos"));
const Usuarios = lazy(() => import("./pages/Usuarios"));

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      
      {/* 2. COLOCAMOS O BOTÃO FLUTUANTE NO CANTO SUPERIOR DIREITO */}
      <div className="fixed top-4 right-4 z-[60]">
        <ThemeToggle />
      </div>

      {/* Botão SOYE ↔ FACIL (apenas para Compras/Admin logado em SOYE ou FACIL) */}
      <EmpresaToggleSF />

      <BrowserRouter>
        {/* TourGuide DENTRO do Router para useLocation funcionar */}
        <TourGuide />
        <Suspense fallback={<div className="p-4 text-sm text-muted-foreground">Carregando...</div>}>
          <Routes>
            {/* Home gerencia o próprio DesktopShell (tem dashboard + modais embutidos) */}
            <Route path="/" element={<Home />} />

            <Route path="/scanner" element={
              <DesktopShell pageTitle="Scanner"><Index /></DesktopShell>
            } />
            <Route path="/consulta-preco" element={
              <DesktopShell pageTitle="Consulta Preço"><ConsultaPreco /></DesktopShell>
            } />

            <Route path="/meus-pedidos" element={
              <ProtectedRoute requiredRole={['operador', 'compras', 'admin', 'super']}>
                <DesktopShell pageTitle="Meus Pedidos"><MeusPedidos /></DesktopShell>
              </ProtectedRoute>
            } />

            {/* Rotas protegidas por role */}
            <Route path="/analytics" element={
              <ProtectedRoute requiredRole={['admin', 'super']}>
                <DesktopShell pageTitle="Analytics"><Analytics /></DesktopShell>
              </ProtectedRoute>
            } />

            <Route path="/compras" element={
              <ProtectedRoute requiredRole={['compras', 'admin', 'super']}>
                <DesktopShell pageTitle="Compras"><Compras /></DesktopShell>
              </ProtectedRoute>
            } />

            <Route path="/dashboard" element={
              <ProtectedRoute requiredRole={['compras', 'admin', 'super']}>
                <DesktopShell pageTitle="Dashboard"><Dashboard /></DesktopShell>
              </ProtectedRoute>
            } />

            <Route path="/usuarios" element={
              <ProtectedRoute requiredRole={['admin', 'super']}>
                <DesktopShell pageTitle="Usuarios"><Usuarios /></DesktopShell>
              </ProtectedRoute>
            } />

            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <VercelAnalytics />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
