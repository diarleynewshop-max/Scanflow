import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import type { UserRole } from "@/hooks/useAuth";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole: UserRole | UserRole[];
  fallbackPath?: string;
}

/**
 * Componente para proteger rotas baseado no role do usuário
 * 
 * Exemplos de uso:
 * <ProtectedRoute requiredRole="admin">...</ProtectedRoute>
 * <ProtectedRoute requiredRole={['admin', 'super']}>...</ProtectedRoute>
 */
export function ProtectedRoute({ 
  children, 
  requiredRole, 
  fallbackPath = "/" 
}: ProtectedRouteProps) {
  const { loginSalvo } = useAuth();
  
  // Se não estiver logado, redireciona para home
  if (!loginSalvo || !loginSalvo.role) {
    return <Navigate to={fallbackPath} replace />;
  }
  
  // Verifica se o usuário tem o role necessário
  const hasAccess = Array.isArray(requiredRole) 
    ? requiredRole.includes(loginSalvo.role)
    : loginSalvo.role === requiredRole;
    
  // Se não tiver acesso, redireciona
  if (!hasAccess) {
    return <Navigate to={fallbackPath} replace />;
  }
  
  // Se tiver acesso, renderiza os children
  return <>{children}</>;
}

/**
 * Helper para verificar se um role tem acesso a outro
 * Hierarquia: super > admin > compras > operador
 */
export function hasRoleAccess(userRole: UserRole, requiredRole: UserRole): boolean {
  const hierarchy: Record<UserRole, number> = {
    'operador': 1,
    'compras': 2,
    'admin': 3,
    'super': 4
  };
  
  return hierarchy[userRole] >= hierarchy[requiredRole];
}

/**
 * Helper para verificar se um role tem acesso a múltiplos roles
 */
export function hasAnyRoleAccess(userRole: UserRole, requiredRoles: UserRole[]): boolean {
  return requiredRoles.some(requiredRole => hasRoleAccess(userRole, requiredRole));
}