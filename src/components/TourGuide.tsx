import React, { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { ChevronRight, X } from "lucide-react";

type TourStep = {
  id: string;
  target: string;
  title: string;
  content: string;
  placement?: "top" | "bottom";
};

const TOUR_STEPS_BY_ROUTE: Record<string, TourStep[]> = {
  "/": [
    { id: "login-empresa", target: "[data-tut='login-empresa']", title: "1. Selecione a Loja", content: "Escolha NEWSHOP, SOYE ou FACIL", placement: "bottom" },
    { id: "login-senha", target: "[data-tut='login-senha']", title: "2. Senha da Loja", content: "Digite a senha da loja", placement: "bottom" },
    { id: "login-lista", target: "[data-tut='login-lista']", title: "3. Nome da Lista", content: "Coloque o nome padrão da lista", placement: "bottom" },
    { id: "login-pessoa", target: "[data-tut='login-pessoa']", title: "4. Nome da Pessoa", content: "Informe o responsável", placement: "bottom" },
    { id: "login-salvar", target: "[data-tut='login-salvar']", title: "5. Salvar Login", content: "Clique para salvar e continuar", placement: "bottom" },
  ],
  "/scanner": [
    { id: "scanner-abrir", target: "[data-tut='abrir-lista']", title: "1. Abrir Lista", content: "Clique aqui para criar uma nova lista", placement: "bottom" },
    { id: "scanner-barcode", target: "[data-tut='barcode-input']", title: "2. Escanear Item", content: "Leia o código de barras do item ou digite manualmente", placement: "bottom" },
    { id: "scanner-descricao", target: "[data-tut='scanner-descricao']", title: "3. Descrição do Item", content: "Coloque a descrição do produto", placement: "top" },
    { id: "scanner-foto", target: "[data-tut='scanner-foto']", title: "4. Adicionar Foto", content: "Galeria ou tire a foto na hora", placement: "top" },
    { id: "scanner-qty", target: "[data-tut='scanner-quantity']", title: "5. Quantidade", content: "Informe a quantidade a ser pedida em unidade", placement: "bottom" },
    { id: "scanner-add", target: "[data-tut='scanner-add']", title: "6. Adicionar Item", content: "Clique para adicionar o item à lista", placement: "top" },
    { id: "scanner-fechar", target: "[data-tut='fechar-lista']", title: "7. Fechar Lista", content: "Ao colocar todos os itens, clique em Fechar", placement: "bottom" },
  ],
};

const getRouteKey = (pathname: string): string => {
  if (pathname.startsWith("/scanner")) {
    const idx = pathname.indexOf("?");
    const query = idx >= 0 ? pathname.substring(idx + 1) : "";
    const params = new URLSearchParams(query);
    return params.get("tab") === "list" ? "/scanner?tab=list" : "/scanner";
  }
  return pathname;
};

const Seta: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: "hsl(var(--primary))" }}>
    <path d="M12 2L2 12h3v8h14v-8h3L12 2z" />
  </svg>
);

const TourGuide: React.FC = () => {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [bubblePos, setBubblePos] = useState({ top: 0, left: 0 });
  const [arrowDir, setArrowDir] = useState<"top" | "bottom">("bottom");
  const bubbleRef = useRef<HTMLDivElement>(null);

  const routeKey = getRouteKey(location.pathname);
  const steps = TOUR_STEPS_BY_ROUTE[routeKey] || [];

  useEffect(() => {
    const handleStart = () => {
      if (steps.length > 0) {
        setIsOpen(true);
        setCurrentStep(0);
      }
    };
    window.addEventListener("start-tour", handleStart);
    return () => window.removeEventListener("start-tour", handleStart);
  }, []);

  const goNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      setIsOpen(false);
    }
  };

  const closeTour = () => setIsOpen(false);

  useEffect(() => {
    if (!isOpen || steps.length === 0) return;
    const s = steps[currentStep];
    if (!s) return;
    try {
      const el = document.querySelector(s.target) as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        const place = s.placement || "bottom";
        setArrowDir(place);
        if (place === "bottom") {
          setBubblePos({ top: r.bottom + 14, left: r.left + r.width / 2 });
        } else {
          setBubblePos({ top: r.top - 10, left: r.left + r.width / 2 });
        }
      }
    } catch (e) {}
  }, [isOpen, currentStep, steps]);

  useEffect(() => {
    if (!isOpen || steps.length === 0) return;
    const s = steps[currentStep];
    if (!s) return;
    try {
      const prev = document.querySelector("[data-tut-highlight]");
      if (prev) prev.removeAttribute("data-tut-highlight");
      const el = document.querySelector(s.target) as HTMLElement | null;
      if (el) el.setAttribute("data-tut-highlight", "true");
    } catch (e) {}
    return () => {
      try {
        const h = document.querySelector("[data-tut-highlight]");
        if (h) h.removeAttribute("data-tut-highlight");
      } catch (e) {}
    };
  }, [isOpen, currentStep, steps]);

  useEffect(() => {
    const st = document.createElement("style");
    st.textContent = `
      [data-tut-highlight]{position:relative;z-index:9998}
      [data-tut-highlight]::after{content:'';position:absolute;inset:-4px;border:2px solid hsl(var(--primary));border-radius:8px;animation:hp 1.5s ease-in-out infinite}
      @keyframes hp{0%,100%{box-shadow:0 0 0 0 hsl(var(--primary)/0.4)}50%{box-shadow:0 0 0 8px hsl(var(--primary)/0)}}
    `;
    document.head.appendChild(st);
    return () => { document.head.removeChild(st); };
  }, []);

  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Enter" || e.key === "ArrowRight") goNext();
      if (e.key === "Escape") closeTour();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [isOpen, currentStep]);

  if (!isOpen || steps.length === 0 || !steps[currentStep]) return null;

  const step = steps[currentStep];

  return (
    <>
      {/* seta (flecha) */}
      {arrowDir === "bottom" && (
        <div
          style={{
            position: "fixed",
            top: bubblePos.top - 10,
            left: bubblePos.left,
            transform: "translateX(-50%) rotate(180deg)",
            zIndex: 9999,
            pointerEvents: "none",
            filter: "drop-shadow(0 -2px 4px rgba(0,0,0,0.15))",
          }}
        >
          <Seta />
        </div>
      )}
      {arrowDir === "top" && (
        <div
          style={{
            position: "fixed",
            top: bubblePos.top + 10,
            left: bubblePos.left,
            transform: "translateX(-50%)",
            zIndex: 9999,
            pointerEvents: "none",
            filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.15))",
          }}
        >
          <Seta />
        </div>
      )}

      {/* balão */}
      <div
        ref={bubbleRef}
        style={{
          position: "fixed",
          top: bubblePos.top,
          left: bubblePos.left,
          transform: arrowDir === "bottom" ? "translateX(-50%)" : "translateX(-50%) translateY(-100%)",
          zIndex: 9999,
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: 12,
          padding: 14,
          minWidth: 240,
          maxWidth: 310,
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "hsl(var(--primary))", textTransform: "uppercase" }}>Tutorial</span>
          <button onClick={closeTour} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "hsl(var(--muted-foreground))" }}><X size={14} /></button>
        </div>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "hsl(var(--foreground))", marginBottom: 4 }}>{step.title}</h3>
        <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))", marginBottom: 12 }}>{step.content}</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
          <button onClick={closeTour} style={{ padding: "5px 8px", borderRadius: 4, border: "1px solid hsl(var(--border))", background: "transparent", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "hsl(var(--foreground))" }}>Fechar</button>
          <button onClick={goNext} style={{ padding: "5px 10px", borderRadius: 4, border: "none", background: "hsl(var(--primary))", fontSize: 11, fontWeight: 600, cursor: "pointer", color: "hsl(var(--primary-foreground))", display: "flex", alignItems: "center", gap: 3 }}>
            {currentStep === steps.length - 1 ? "Concluir" : "Próximo"} <ChevronRight size={10} />
          </button>
        </div>
      </div>
    </>
  );
};

export default TourGuide;
export const openTour = () => window.dispatchEvent(new CustomEvent("start-tour"));