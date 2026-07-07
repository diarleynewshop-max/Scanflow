import { useState, useEffect } from "react";
import { applyCompanyTheme } from "@/lib/companyTheme";

type Empresa = "NEWSHOP" | "SOYE" | "FACIL";
export type LoginFlag = "loja" | "cd";
export type UserRole = 'operador' | 'compras' | 'admin' | 'super';

export interface LoginData {
  empresa: Empresa;
  senha: string; // senha digitada (não armazenar a correta)
  tituloPadrao: string;
  nomePessoa: string;
  flag: LoginFlag;
  role: UserRole; // NOVO: perfil do usuário
  // Secoes que o comprador (role 'compras') acompanha. Definido no perfil
  // ("Alterar Perfil de Acesso"). Vazio/ausente = ve todas as secoes.
  secoesCompras?: string[];
}

const STORAGE_KEY = "scan_newshop_login";

// Senhas fixas para operadores (não devem ser expostas no frontend, mas como é um app offline, ficam aqui)
const SENHAS_OPERADOR: Record<Empresa, string> = {
  "NEWSHOP": "1148",
  "SOYE": "1090", 
  "FACIL": "2461"
};

const SENHAS_CD: Record<Empresa, string> = {
  "NEWSHOP": "n91",
  "SOYE": "s91",
  "FACIL": "f91"
};

// Senhas especiais para perfis avançados
// isSF=true → senha válida para SOYE ou FACIL (grupo SF)
const SENHAS_ESPECIAIS: Record<string, { role: UserRole; empresa: Empresa; isSF?: boolean }> = {
  'Compras1148':  { role: 'compras', empresa: 'NEWSHOP' },
  'ComprasSF':    { role: 'compras', empresa: 'SOYE', isSF: true },
  'Ad1148':       { role: 'admin',   empresa: 'NEWSHOP' },
  'Admin1148':    { role: 'super',   empresa: 'NEWSHOP' },
  'Admin2461':    { role: 'super',   empresa: 'NEWSHOP' },
  'Admin1090':    { role: 'super',   empresa: 'NEWSHOP' },
  'Admin1316':    { role: 'super',   empresa: 'NEWSHOP' },
};

// Validação de senha e detecção de role
export function validarSenha(empresa: Empresa, senhaDigitada: string, flag: LoginFlag = 'loja'): { valido: boolean; role: UserRole } {
  // Primeiro verifica se é senha especial
  const senhaEspecial = SENHAS_ESPECIAIS[senhaDigitada];
  if (senhaEspecial) {
    const match = senhaEspecial.isSF
      ? (empresa === 'SOYE' || empresa === 'FACIL')
      : senhaEspecial.empresa === empresa;
    return match ? { valido: true, role: senhaEspecial.role } : { valido: false, role: 'operador' };
  }
  
  // Depois verifica se é senha de operador normal
  const senhaEsperada = flag === 'cd' ? SENHAS_CD[empresa] : SENHAS_OPERADOR[empresa];
  const valido = senhaEsperada === senhaDigitada;
  return { valido, role: 'operador' };
}

// Salvar login no localStorage
export function salvarLogin(data: LoginData): void {
  try {
    // Não armazenar a senha correta, apenas marcar que a senha foi validada
    const { senha, ...dadosParaSalvar } = data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dadosParaSalvar));
    applyCompanyTheme(data.empresa);
  } catch (err) {
    console.error('Erro ao salvar login:', err);
  }
}

// Obter login salvo
export function obterLoginSalvo(): Omit<LoginData, 'senha'> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const dados = JSON.parse(raw);

    // Backward compatibility: se não tiver role, assume 'operador'
    if (!dados.role) {
      dados.role = 'operador';
    }

    if (!dados.flag) {
      dados.flag = 'loja';
    }

    if (dados.flag === 'cd' && !dados.tituloPadrao) {
      dados.tituloPadrao = 'CD';
    }

    return dados;
  } catch {
    return null;
  }
}

// Remover login (logout)
export function removerLogin(): void {
  localStorage.removeItem(STORAGE_KEY);
  applyCompanyTheme("NEWSHOP");
}

// Hook para gerenciar autenticação
export function useAuth() {
  const [loginSalvo, setLoginSalvo] = useState<Omit<LoginData, 'senha'> | null>(() => obterLoginSalvo());
  const [mostrarModalLogin, setMostrarModalLogin] = useState(false);

  // Verificar se precisa mostrar modal de login ao montar o componente
  useEffect(() => {
    // Se não há login salvo, mostrar modal imediatamente
    if (!loginSalvo) {
      setMostrarModalLogin(true);
    }
  }, [loginSalvo]);

  const fazerLogin = (data: LoginData): boolean => {
    const { valido, role } = validarSenha(data.empresa, data.senha, data.flag);
    if (!valido) {
      return false;
    }

    const flag = data.flag ?? 'loja';
    const nomePessoa = data.nomePessoa.trim();
    const tituloPadrao = flag === 'cd' ? 'CD' : data.tituloPadrao.trim();

    if (!nomePessoa) {
      return false;
    }

    if (flag === 'loja' && !tituloPadrao) {
      return false;
    }

    // Adiciona o role detectado aos dados de login
    const dadosComRole = { ...data, role, flag, nomePessoa, tituloPadrao };
    salvarLogin(dadosComRole);
    setLoginSalvo({ 
      empresa: data.empresa, 
      tituloPadrao,
      nomePessoa,
      flag,
      role
    });
    setMostrarModalLogin(false);
    return true;
  };

  const fazerLogout = (): void => {
    removerLogin();
    setLoginSalvo(null);
    setMostrarModalLogin(true); // Mostrar modal de login novamente
  };

  return {
    loginSalvo,
    mostrarModalLogin,
    setMostrarModalLogin,
    fazerLogin,
    fazerLogout,
    senhasOperador: SENHAS_OPERADOR, // Para referência (não exibir na UI)
    senhasEspeciais: SENHAS_ESPECIAIS // Para referência (não exibir na UI)
  };
}
