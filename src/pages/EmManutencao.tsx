import { Wrench, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface EmManutencaoProps {
  titulo?: string;
}

// Tela generica de "em manutencao" — usada em rotas temporariamente indisponiveis
// (ex.: Dashboard durante a migracao pro Supabase).
const EmManutencao = ({ titulo = "Esta area" }: EmManutencaoProps) => {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 p-6 text-center bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="w-20 h-20 rounded-3xl bg-gray-200 flex items-center justify-center">
        <Wrench className="h-9 w-9 text-gray-500" />
      </div>
      <h1 className="text-2xl font-bold text-gray-700">{titulo} em manutenção</h1>
      <p className="text-gray-500 max-w-md leading-relaxed">
        Estamos atualizando esta área durante a migração do sistema. Ela ficará
        indisponível por enquanto e volta em breve.
      </p>
      <Button variant="outline" onClick={() => navigate("/")}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Voltar ao início
      </Button>
    </div>
  );
};

export default EmManutencao;
