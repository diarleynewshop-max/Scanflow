import type { EmpresaKey, FlagKey } from "./pedidosFila";

const SENHAS: Record<EmpresaKey, string> = {
  NEWSHOP: "n91",
  SOYE: "s91",
  FACIL: "f91",
};

export function obterSenhaPadrao(empresa: EmpresaKey, _flag: FlagKey = "loja"): string {
  return SENHAS[empresa] ?? "";
}

export function validarSenha(empresa: EmpresaKey, senha: string, flag: FlagKey = "loja"): boolean {
  return obterSenhaPadrao(empresa, flag) === senha;
}
