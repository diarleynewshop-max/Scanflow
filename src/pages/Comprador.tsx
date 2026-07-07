import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { 
  ArrowLeft, ShoppingCart, Package, AlertTriangle, CheckCircle, XCircle, 
  Filter, Download, RefreshCw, Eye, ThumbsUp, ThumbsDown, Check, X, 
  ShoppingBag, Search, Calendar, User, Tag, BarChart3 
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const Comprador = () => {
  const navigate = useNavigate();
  const { loginSalvo } = useAuth();
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [filtroQualidade, setFiltroQualidade] = useState<string>("todos");
  const [filtroAnalisado, setFiltroAnalisado] = useState<string>("todos");
  const [filtroComprado, setFiltroComprado] = useState<string>("todos");
  const [searchTerm, setSearchTerm] = useState<string>("");

  // Dados mockados para itens sem estoque (serão substituídos por dados do Supabase)
  const itensSemEstoque = [
    { 
      id: 1, 
      codigo: "PROD001", 
      descricao: "Smartphone Galaxy S24", 
      quantidadePedida: 50, 
      quantidadeConferida: 0, 
      quantidadeFaltante: 50,
      status: "nao_tem", 
      conferenciaId: "CONF20250408-001",
      dataConferencia: "08/04/2025 14:30",
      setor: "Eletrônicos",
      motivo: "Produto esgotado no fornecedor",
      qualidade: "bom", // bom ou ruim
      analisado: true, // true ou false
      comprado: false, // true ou false
      dataAnalise: "09/04/2025",
      analisadoPor: "João Silva",
      fornecedor: "TechCorp",
      precoUnitario: 2499.90,
      prioridade: "alta"
    },
    { 
      id: 2, 
      codigo: "PROD002", 
      descricao: "Fone Bluetooth Premium", 
      quantidadePedida: 100, 
      quantidadeConferida: 25, 
      quantidadeFaltante: 75,
      status: "nao_tem_tudo", 
      conferenciaId: "CONF20250408-002",
      dataConferencia: "08/04/2025 15:15",
      setor: "Acessórios",
      motivo: "Fornecedor com entrega parcial",
      qualidade: "bom",
      analisado: true,
      comprado: true,
      dataAnalise: "09/04/2025",
      analisadoPor: "Maria Santos",
      fornecedor: "AudioPlus",
      precoUnitario: 299.90,
      prioridade: "media"
    },
    { 
      id: 3, 
      codigo: "PROD003", 
      descricao: "Carregador Rápido 65W", 
      quantidadePedida: 80, 
      quantidadeConferida: 0, 
      quantidadeFaltante: 80,
      status: "nao_tem", 
      conferenciaId: "CONF20250408-003",
      dataConferencia: "07/04/2025 10:45",
      setor: "Eletrônicos",
      motivo: "Aguardando nova remessa",
      qualidade: "ruim",
      analisado: true,
      comprado: false,
      dataAnalise: "08/04/2025",
      analisadoPor: "Carlos Oliveira",
      fornecedor: "PowerTech",
      precoUnitario: 89.90,
      prioridade: "baixa"
    },
    { 
      id: 4, 
      codigo: "PROD004", 
      descricao: "Capa Protetora Anti-Impacto", 
      quantidadePedida: 150, 
      quantidadeConferida: 90, 
      quantidadeFaltante: 60,
      status: "nao_tem_tudo", 
      conferenciaId: "CONF20250407-001",
      dataConferencia: "07/04/2025 16:20",
      setor: "Acessórios",
      motivo: "Produção atrasada",
      qualidade: "bom",
      analisado: false,
      comprado: false,
      dataAnalise: null,
      analisadoPor: null,
      fornecedor: "CaseMaster",
      precoUnitario: 49.90,
      prioridade: "media"
    },
    { 
      id: 5, 
      codigo: "PROD005", 
      descricao: "Tablet Pro 12.9\"", 
      quantidadePedida: 30, 
      quantidadeConferida: 0, 
      quantidadeFaltante: 30,
      status: "nao_tem", 
      conferenciaId: "CONF20250406-001",
      dataConferencia: "06/04/2025 09:15",
      setor: "Eletrônicos",
      motivo: "Problema de fabricação",
      qualidade: "ruim",
      analisado: true,
      comprado: false,
      dataAnalise: "07/04/2025",
      analisadoPor: "Ana Costa",
      fornecedor: "DigitalTech",
      precoUnitario: 4299.90,
      prioridade: "alta"
    },
    { 
      id: 6, 
      codigo: "PROD006", 
      descricao: "Power Bank 20000mAh", 
      quantidadePedida: 120, 
      quantidadeConferida: 45, 
      quantidadeFaltante: 75,
      status: "nao_tem_tudo", 
      conferenciaId: "CONF20250406-002",
      dataConferencia: "06/04/2025 11:30",
      setor: "Eletrônicos",
      motivo: "Demanda maior que o esperado",
      qualidade: "bom",
      analisado: true,
      comprado: true,
      dataAnalise: "07/04/2025",
      analisadoPor: "Pedro Almeida",
      fornecedor: "EnergyPlus",
      precoUnitario: 159.90,
      prioridade: "media"
    },
    { 
      id: 7, 
      codigo: "PROD007", 
      descricao: "Cabo USB-C 2m", 
      quantidadePedida: 200, 
      quantidadeConferida: 50, 
      quantidadeFaltante: 150,
      status: "nao_tem_tudo", 
      conferenciaId: "CONF20250405-001",
      dataConferencia: "05/04/2025 13:45",
      setor: "Acessórios",
      motivo: "Fornecedor em falta",
      qualidade: "bom",
      analisado: false,
      comprado: false,
      dataAnalise: null,
      analisadoPor: null,
      fornecedor: "CablePro",
      precoUnitario: 29.90,
      prioridade: "alta"
    },
    { 
      id: 8, 
      codigo: "PROD008", 
      descricao: "Suporte para Celular", 
      quantidadePedida: 80, 
      quantidadeConferida: 0, 
      quantidadeFaltante: 80,
      status: "nao_tem", 
      conferenciaId: "CONF20250405-002",
      dataConferencia: "05/04/2025 15:20",
      setor: "Acessórios",
      motivo: "Modelo descontinuado",
      qualidade: "ruim",
      analisado: true,
      comprado: false,
      dataAnalise: "06/04/2025",
      analisadoPor: "Fernanda Lima",
      fornecedor: "MountTech",
      precoUnitario: 39.90,
      prioridade: "baixa"
    },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "nao_tem":
        return (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 12,
            background: "hsl(var(--destructive) / 0.1)",
            color: "hsl(var(--destructive))",
            fontSize: 12,
            fontWeight: 600,
          }}>
            <XCircle size={12} /> Sem Estoque
          </span>
        );
      case "nao_tem_tudo":
        return (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 12,
            background: "hsl(var(--warning) / 0.1)",
            color: "hsl(var(--warning))",
            fontSize: 12,
            fontWeight: 600,
          }}>
            <AlertTriangle size={12} /> Estoque Parcial
          </span>
        );
      default:
        return null;
    }
  };

  const getQualidadeBadge = (qualidade: string) => {
    switch (qualidade) {
      case "bom":
        return (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 12,
            background: "hsl(var(--success) / 0.1)",
            color: "hsl(var(--success))",
            fontSize: 12,
            fontWeight: 600,
          }}>
            <ThumbsUp size={12} /> Bom
          </span>
        );
      case "ruim":
        return (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 12,
            background: "hsl(var(--destructive) / 0.1)",
            color: "hsl(var(--destructive))",
            fontSize: 12,
            fontWeight: 600,
          }}>
            <ThumbsDown size={12} /> Ruim
          </span>
        );
      default:
        return null;
    }
  };

  const getAnalisadoBadge = (analisado: boolean) => {
    return analisado ? (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 12,
        background: "hsl(var(--success) / 0.1)",
        color: "hsl(var(--success))",
        fontSize: 12,
        fontWeight: 600,
      }}>
        <Check size={12} /> Analisado
      </span>
    ) : (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 12,
        background: "hsl(var(--muted) / 0.1)",
        color: "hsl(var(--muted-foreground))",
        fontSize: 12,
        fontWeight: 600,
      }}>
        <X size={12} /> Pendente
      </span>
    );
  };

  const getCompradoBadge = (comprado: boolean) => {
    return comprado ? (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 12,
        background: "hsl(var(--success) / 0.1)",
        color: "hsl(var(--success))",
        fontSize: 12,
        fontWeight: 600,
      }}>
        <ShoppingBag size={12} /> Comprado
      </span>
    ) : (
      <span style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 12,
        background: "hsl(var(--warning) / 0.1)",
        color: "hsl(var(--warning))",
        fontSize: 12,
        fontWeight: 600,
      }}>
        <ShoppingCart size={12} /> Aguardando
      </span>
    );
  };

  const getPrioridadeBadge = (prioridade: string) => {
    switch (prioridade) {
      case "alta":
        return (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 12,
            background: "hsl(var(--destructive) / 0.1)",
            color: "hsl(var(--destructive))",
            fontSize: 12,
            fontWeight: 600,
          }}>
            <AlertTriangle size={12} /> Alta
          </span>
        );
      case "media":
        return (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 12,
            background: "hsl(var(--warning) / 0.1)",
            color: "hsl(var(--warning))",
            fontSize: 12,
            fontWeight: 600,
          }}>
            <AlertTriangle size={12} /> Média
          </span>
        );
      case "baixa":
        return (
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 12,
            background: "hsl(var(--success) / 0.1)",
            color: "hsl(var(--success))",
            fontSize: 12,
            fontWeight: 600,
          }}>
            <Check size={12} /> Baixa
          </span>
        );
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "nao_tem": return "hsl(var(--destructive))";
      case "nao_tem_tudo": return "hsl(var(--warning))";
      default: return "hsl(var(--muted-foreground))";
    }
  };

  const filteredItens = itensSemEstoque.filter(item => {
    // Filtro por status (estoque)
    if (filtroStatus !== "todos" && item.status !== filtroStatus) return false;
    
    // Filtro por qualidade (bom/ruim)
    if (filtroQualidade !== "todos" && item.qualidade !== filtroQualidade) return false;
    
    // Filtro por analisado
    if (filtroAnalisado !== "todos") {
      if (filtroAnalisado === "sim" && !item.analisado) return false;
      if (filtroAnalisado === "nao" && item.analisado) return false;
    }
    
    // Filtro por comprado
    if (filtroComprado !== "todos") {
      if (filtroComprado === "sim" && !item.comprado) return false;
      if (filtroComprado === "nao" && item.comprado) return false;
    }
    
    // Filtro por busca
    if (searchTerm && !item.descricao.toLowerCase().includes(searchTerm.toLowerCase()) && 
        !item.codigo.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !item.setor.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }
    
    return true;
  });

  const stats = {
    total: itensSemEstoque.length,
    semEstoque: itensSemEstoque.filter(item => item.status === "nao_tem").length,
    parcial: itensSemEstoque.filter(item => item.status === "nao_tem_tudo").length,
    totalPedido: itensSemEstoque.reduce((sum, item) => sum + item.quantidadePedida, 0),
    totalFaltante: itensSemEstoque.reduce((sum, item) => sum + item.quantidadeFaltante, 0),
    bom: itensSemEstoque.filter(item => item.qualidade === "bom").length,
    ruim: itensSemEstoque.filter(item => item.qualidade === "ruim").length,
    analisado: itensSemEstoque.filter(item => item.analisado).length,
    naoAnalisado: itensSemEstoque.filter(item => !item.analisado).length,
    comprado: itensSemEstoque.filter(item => item.comprado).length,
    naoComprado: itensSemEstoque.filter(item => !item.comprado).length,
    valorTotal: itensSemEstoque.reduce((sum, item) => sum + (item.precoUnitario * item.quantidadeFaltante), 0),
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "hsl(var(--background))",
      color: "hsl(var(--foreground))",
      padding: "16px",
    }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        
        {/* Header */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "16px",
          marginBottom: "24px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={() => navigate("/")}
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                background: "hsl(var(--secondary))",
                border: "1px solid hsl(var(--border))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 style={{
                fontSize: "28px",
                fontWeight: 700,
                fontFamily: "var(--font-serif)",
                color: "hsl(var(--foreground))",
                margin: 0,
              }}>
                COMPRADOR
              </h1>
              <p style={{
                fontSize: "14px",
                color: "hsl(var(--muted-foreground))",
                margin: "4px 0 0 0",
              }}>
                Itens sem estoque identificados nas conferências
              </p>
            </div>
          </div>

          {/* Stats Cards */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
            marginBottom: "20px",
          }}>
            <div style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "12px",
              padding: "16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                <div style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  background: "hsl(var(--primary) / 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <ShoppingCart size={18} color="hsl(var(--primary))" />
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: 0 }}>Total Itens</p>
                  <p style={{ fontSize: "20px", fontWeight: 700, color: "hsl(var(--foreground))", margin: "2px 0 0 0" }}>
                    {stats.total}
                  </p>
                </div>
              </div>
            </div>

            <div style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "12px",
              padding: "16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                <div style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  background: "hsl(var(--success) / 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <ThumbsUp size={18} color="hsl(var(--success))" />
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: 0 }}>Itens Bons</p>
                  <p style={{ fontSize: "20px", fontWeight: 700, color: "hsl(var(--success))", margin: "2px 0 0 0" }}>
                    {stats.bom}
                  </p>
                </div>
              </div>
            </div>

            <div style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "12px",
              padding: "16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                <div style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  background: "hsl(var(--destructive) / 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <ThumbsDown size={18} color="hsl(var(--destructive))" />
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: 0 }}>Itens Ruins</p>
                  <p style={{ fontSize: "20px", fontWeight: 700, color: "hsl(var(--destructive))", margin: "2px 0 0 0" }}>
                    {stats.ruim}
                  </p>
                </div>
              </div>
            </div>

            <div style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "12px",
              padding: "16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                <div style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  background: "hsl(var(--warning) / 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <Check size={18} color="hsl(var(--warning))" />
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: 0 }}>Analisados</p>
                  <p style={{ fontSize: "20px", fontWeight: 700, color: "hsl(var(--warning))", margin: "2px 0 0 0" }}>
                    {stats.analisado}
                  </p>
                </div>
              </div>
            </div>

            <div style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "12px",
              padding: "16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                <div style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  background: "hsl(var(--indigo) / 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <ShoppingBag size={18} color="hsl(var(--indigo))" />
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: 0 }}>Comprados</p>
                  <p style={{ fontSize: "20px", fontWeight: 700, color: "hsl(var(--indigo))", margin: "2px 0 0 0" }}>
                    {stats.comprado}
                  </p>
                </div>
              </div>
            </div>

            <div style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "12px",
              padding: "16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                <div style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  background: "hsl(var(--violet) / 0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <BarChart3 size={18} color="hsl(var(--violet))" />
                </div>
                <div>
                  <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: 0 }}>Valor Total</p>
                  <p style={{ fontSize: "16px", fontWeight: 700, color: "hsl(var(--foreground))", margin: "2px 0 0 0" }}>
                    R$ {stats.valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Barra de Busca */}
          <div style={{
            marginBottom: "20px",
          }}>
            <div style={{
              position: "relative",
              maxWidth: "500px",
            }}>
              <Search size={18} style={{
                position: "absolute",
                left: "14px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "hsl(var(--muted-foreground))",
              }} />
              <input
                type="text"
                placeholder="Buscar por código, descrição ou setor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: "100%",
                  padding: "12px 16px 12px 44px",
                  borderRadius: "10px",
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--background))",
                  color: "hsl(var(--foreground))",
                  fontSize: "14px",
                  fontFamily: "var(--font-sans)",
                }}
              />
            </div>
          </div>

          {/* Filtros */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            marginBottom: "24px",
          }}>
            {/* Filtro 1: Status do Estoque */}
            <div>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: "8px" }}>
                Status do Estoque
              </p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={() => setFiltroStatus("todos")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: filtroStatus === "todos" ? "hsl(var(--primary))" : "hsl(var(--secondary))",
                    color: filtroStatus === "todos" ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Todos ({stats.total})
                </button>
                <button
                  onClick={() => setFiltroStatus("nao_tem")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: filtroStatus === "nao_tem" ? "hsl(var(--destructive))" : "hsl(var(--secondary))",
                    color: filtroStatus === "nao_tem" ? "white" : "hsl(var(--foreground))",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Sem Estoque ({stats.semEstoque})
                </button>
                <button
                  onClick={() => setFiltroStatus("nao_tem_tudo")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: filtroStatus === "nao_tem_tudo" ? "hsl(var(--warning))" : "hsl(var(--secondary))",
                    color: filtroStatus === "nao_tem_tudo" ? "white" : "hsl(var(--foreground))",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Estoque Parcial ({stats.parcial})
                </button>
              </div>
            </div>

            {/* Filtro 2: Qualidade (Bom/Ruim) */}
            <div>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: "8px" }}>
                1 - Item Bom ou Ruim
              </p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={() => setFiltroQualidade("todos")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: filtroQualidade === "todos" ? "hsl(var(--primary))" : "hsl(var(--secondary))",
                    color: filtroQualidade === "todos" ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Todos
                </button>
                <button
                  onClick={() => setFiltroQualidade("bom")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: filtroQualidade === "bom" ? "hsl(var(--success))" : "hsl(var(--secondary))",
                    color: filtroQualidade === "bom" ? "white" : "hsl(var(--foreground))",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <ThumbsUp size={14} style={{ marginRight: "6px" }} /> Bom ({stats.bom})
                </button>
                <button
                  onClick={() => setFiltroQualidade("ruim")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: filtroQualidade === "ruim" ? "hsl(var(--destructive))" : "hsl(var(--secondary))",
                    color: filtroQualidade === "ruim" ? "white" : "hsl(var(--foreground))",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <ThumbsDown size={14} style={{ marginRight: "6px" }} /> Ruim ({stats.ruim})
                </button>
              </div>
            </div>

            {/* Filtro 3: Analisado */}
            <div>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: "8px" }}>
                2 - Item foi Analisado
              </p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={() => setFiltroAnalisado("todos")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: filtroAnalisado === "todos" ? "hsl(var(--primary))" : "hsl(var(--secondary))",
                    color: filtroAnalisado === "todos" ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Todos
                </button>
                <button
                  onClick={() => setFiltroAnalisado("sim")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: filtroAnalisado === "sim" ? "hsl(var(--success))" : "hsl(var(--secondary))",
                    color: filtroAnalisado === "sim" ? "white" : "hsl(var(--foreground))",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <Check size={14} style={{ marginRight: "6px" }} /> Analisado ({stats.analisado})
                </button>
                <button
                  onClick={() => setFiltroAnalisado("nao")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: filtroAnalisado === "nao" ? "hsl(var(--warning))" : "hsl(var(--secondary))",
                    color: filtroAnalisado === "nao" ? "white" : "hsl(var(--foreground))",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <X size={14} style={{ marginRight: "6px" }} /> Pendente ({stats.naoAnalisado})
                </button>
              </div>
            </div>

            {/* Filtro 4: Comprado */}
            <div>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "hsl(var(--foreground))", marginBottom: "8px" }}>
                3 - Item foi Comprado
              </p>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={() => setFiltroComprado("todos")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: filtroComprado === "todos" ? "hsl(var(--primary))" : "hsl(var(--secondary))",
                    color: filtroComprado === "todos" ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Todos
                </button>
                <button
                  onClick={() => setFiltroComprado("sim")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: filtroComprado === "sim" ? "hsl(var(--success))" : "hsl(var(--secondary))",
                    color: filtroComprado === "sim" ? "white" : "hsl(var(--foreground))",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <ShoppingBag size={14} style={{ marginRight: "6px" }} /> Comprado ({stats.comprado})
                </button>
                <button
                  onClick={() => setFiltroComprado("nao")}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "8px",
                    background: filtroComprado === "nao" ? "hsl(var(--warning))" : "hsl(var(--secondary))",
                    color: filtroComprado === "nao" ? "white" : "hsl(var(--foreground))",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <ShoppingCart size={14} style={{ marginRight: "6px" }} /> Aguardando ({stats.naoComprado})
                </button>
              </div>
            </div>

            {/* Ações */}
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "8px",
            }}>
              <p style={{ fontSize: "13px", color: "hsl(var(--muted-foreground))", margin: 0 }}>
                Mostrando {filteredItens.length} de {itensSemEstoque.length} itens
              </p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={() => {
                    setFiltroStatus("todos");
                    setFiltroQualidade("todos");
                    setFiltroAnalisado("todos");
                    setFiltroComprado("todos");
                    setSearchTerm("");
                  }}
                  style={{
                    padding: "10px 16px",
                    borderRadius: "8px",
                    background: "hsl(var(--secondary))",
                    border: "1px solid hsl(var(--border))",
                    color: "hsl(var(--foreground))",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <Filter size={16} /> Limpar Filtros
                </button>
                <button
                  style={{
                    padding: "10px 16px",
                    borderRadius: "8px",
                    background: "hsl(var(--secondary))",
                    border: "1px solid hsl(var(--border))",
                    color: "hsl(var(--foreground))",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <Download size={16} /> Exportar
                </button>
                <button
                  style={{
                    padding: "10px 16px",
                    borderRadius: "8px",
                    background: "hsl(var(--primary))",
                    border: "none",
                    color: "hsl(var(--primary-foreground))",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <RefreshCw size={16} /> Atualizar
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Tabela de Itens */}
        <div style={{
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          borderRadius: "12px",
          overflow: "hidden",
        }}>
          <div style={{
            padding: "20px",
            borderBottom: "1px solid hsl(var(--border))",
            background: "hsl(var(--secondary))",
          }}>
            <h2 style={{
              fontSize: "18px",
              fontWeight: 600,
              color: "hsl(var(--foreground))",
              margin: 0,
            }}>
              Itens para Reposição
            </h2>
            <p style={{
              fontSize: "13px",
              color: "hsl(var(--muted-foreground))",
              margin: "4px 0 0 0",
            }}>
              Lista de produtos identificados como sem estoque nas conferências
            </p>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{
              width: "100%",
              borderCollapse: "collapse",
            }}>
              <thead>
                <tr style={{
                  background: "hsl(var(--secondary))",
                  borderBottom: "1px solid hsl(var(--border))",
                }}>
                  <th style={{ padding: "16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>Código</th>
                  <th style={{ padding: "16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>Descrição</th>
                  <th style={{ padding: "16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>Quantidade</th>
                  <th style={{ padding: "16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>Status</th>
                  <th style={{ padding: "16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>Qualidade</th>
                  <th style={{ padding: "16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>Analisado</th>
                  <th style={{ padding: "16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>Comprado</th>
                  <th style={{ padding: "16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>Fornecedor</th>
                  <th style={{ padding: "16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>Valor</th>
                  <th style={{ padding: "16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "hsl(var(--muted-foreground))" }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {filteredItens.map((item) => (
                  <tr key={item.id} style={{
                    borderBottom: "1px solid hsl(var(--border))",
                    transition: "background 0.2s",
                    background: item.comprado ? "hsl(var(--success) / 0.05)" : 
                             item.analisado ? "hsl(var(--warning) / 0.05)" : 
                             "transparent",
                  }}>
                    <td style={{ padding: "16px", fontSize: "14px", fontWeight: 600, color: "hsl(var(--foreground))" }}>
                      {item.codigo}
                    </td>
                    <td style={{ padding: "16px" }}>
                      <div>
                        <p style={{ fontSize: "14px", fontWeight: 600, color: "hsl(var(--foreground))", margin: "0 0 4px 0" }}>
                          {item.descricao}
                        </p>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                          {getPrioridadeBadge(item.prioridade)}
                          <span style={{
                            fontSize: "11px",
                            padding: "2px 8px",
                            borderRadius: "6px",
                            background: "hsl(var(--muted) / 0.2)",
                            color: "hsl(var(--muted-foreground))",
                          }}>
                            {item.setor}
                          </span>
                        </div>
                        <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: 0 }}>
                          {item.motivo}
                        </p>
                      </div>
                    </td>
                    <td style={{ padding: "16px" }}>
                      <div>
                        <p style={{ fontSize: "13px", fontWeight: 600, color: "hsl(var(--foreground))", margin: "0 0 4px 0" }}>
                          Pedido: {item.quantidadePedida}
                        </p>
                        <p style={{ fontSize: "13px", color: "hsl(var(--muted-foreground))", margin: "0 0 4px 0" }}>
                          Conferido: {item.quantidadeConferida}
                        </p>
                        <p style={{ 
                          fontSize: "14px", 
                          fontWeight: 700, 
                          color: getStatusColor(item.status),
                          margin: 0,
                        }}>
                          Faltam: {item.quantidadeFaltante}
                        </p>
                      </div>
                    </td>
                    <td style={{ padding: "16px" }}>
                      {getStatusBadge(item.status)}
                    </td>
                    <td style={{ padding: "16px" }}>
                      {getQualidadeBadge(item.qualidade)}
                    </td>
                    <td style={{ padding: "16px" }}>
                      {getAnalisadoBadge(item.analisado)}
                      {item.analisado && item.analisadoPor && (
                        <div style={{ marginTop: "6px" }}>
                          <p style={{ fontSize: "11px", color: "hsl(var(--muted-foreground))", margin: "2px 0 0 0" }}>
                            <User size={10} style={{ marginRight: "4px" }} /> {item.analisadoPor}
                          </p>
                          <p style={{ fontSize: "10px", color: "hsl(var(--muted-foreground))", margin: "2px 0 0 0" }}>
                            <Calendar size={10} style={{ marginRight: "4px" }} /> {item.dataAnalise}
                          </p>
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "16px" }}>
                      {getCompradoBadge(item.comprado)}
                    </td>
                    <td style={{ padding: "16px" }}>
                      <div>
                        <p style={{ fontSize: "13px", fontWeight: 600, color: "hsl(var(--foreground))", margin: "0 0 4px 0" }}>
                          {item.fornecedor}
                        </p>
                        <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: 0 }}>
                          {item.conferenciaId}
                        </p>
                      </div>
                    </td>
                    <td style={{ padding: "16px" }}>
                      <div>
                        <p style={{ fontSize: "14px", fontWeight: 700, color: "hsl(var(--foreground))", margin: "0 0 4px 0" }}>
                          R$ {item.precoUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: 0 }}>
                          Total: R$ {(item.precoUnitario * item.quantidadeFaltante).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </td>
                    <td style={{ padding: "16px" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <button
                          style={{
                            padding: "8px 12px",
                            borderRadius: "8px",
                            background: "hsl(var(--primary) / 0.1)",
                            border: "1px solid hsl(var(--primary) / 0.3)",
                            color: "hsl(var(--primary))",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          <Eye size={12} /> Detalhes
                        </button>
                        <button
                          style={{
                            padding: "8px 12px",
                            borderRadius: "8px",
                            background: item.analisado ? "hsl(var(--success) / 0.1)" : "hsl(var(--warning) / 0.1)",
                            border: item.analisado ? "1px solid hsl(var(--success) / 0.3)" : "1px solid hsl(var(--warning) / 0.3)",
                            color: item.analisado ? "hsl(var(--success))" : "hsl(var(--warning))",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          {item.analisado ? <Check size={12} /> : <Tag size={12} />}
                          {item.analisado ? "Analisado" : "Analisar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredItens.length === 0 && (
            <div style={{
              padding: "40px 20px",
              textAlign: "center",
              color: "hsl(var(--muted-foreground))",
            }}>
              <CheckCircle size={48} style={{ margin: "0 auto 16px", opacity: 0.5 }} />
              <p style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 8px 0" }}>
                Nenhum item encontrado
              </p>
              <p style={{ fontSize: "14px", margin: 0 }}>
                {filtroStatus === "todos" 
                  ? "Todos os itens estão com estoque completo!" 
                  : `Nenhum item com status "${filtroStatus}" encontrado.`}
              </p>
            </div>
          )}

          <div style={{
            padding: "16px 20px",
            borderTop: "1px solid hsl(var(--border))",
            background: "hsl(var(--secondary))",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            <p style={{ fontSize: "13px", color: "hsl(var(--muted-foreground))", margin: 0 }}>
              Mostrando {filteredItens.length} de {itensSemEstoque.length} itens
            </p>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "hsl(var(--secondary))",
                  border: "1px solid hsl(var(--border))",
                  color: "hsl(var(--foreground))",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Anterior
              </button>
              <button
                style={{
                  padding: "8px 12px",
                  borderRadius: "6px",
                  background: "hsl(var(--primary))",
                  border: "none",
                  color: "hsl(var(--primary-foreground))",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                Próxima
              </button>
            </div>
          </div>
        </div>

        {/* Nota Informativa */}
        <div style={{
          marginTop: "20px",
          padding: "16px",
          background: "hsl(var(--secondary))",
          border: "1px solid hsl(var(--border))",
          borderRadius: "12px",
        }}>
          <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
            <AlertTriangle size={20} color="hsl(var(--warning))" />
            <div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "hsl(var(--foreground))", margin: "0 0 8px 0" }}>
                Fluxo de Trabalho - Setor de Compras
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px" }}>
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 600, color: "hsl(var(--foreground))", margin: "0 0 6px 0" }}>
                    1. Qualidade (Bom/Ruim)
                  </p>
                  <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: 0, lineHeight: 1.5 }}>
                    Avalie se o produto atende aos padrões de qualidade antes de prosseguir com a compra.
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 600, color: "hsl(var(--foreground))", margin: "0 0 6px 0" }}>
                    2. Análise Técnica
                  </p>
                  <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: 0, lineHeight: 1.5 }}>
                    Verifique especificações, fornecedores alternativos e viabilidade de reposição.
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: "13px", fontWeight: 600, color: "hsl(var(--foreground))", margin: "0 0 6px 0" }}>
                    3. Compra Efetivada
                  </p>
                  <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: 0, lineHeight: 1.5 }}>
                    Após análise e aprovação, efetive a compra e atualize o status do item.
                  </p>
                </div>
              </div>
              <p style={{ fontSize: "12px", color: "hsl(var(--muted-foreground))", margin: "12px 0 0 0", lineHeight: 1.5 }}>
                Esta lista é atualizada automaticamente com os itens marcados como "não tem" ou "não tem tudo" 
                durante as conferências de estoque. Use os filtros para gerenciar o fluxo de trabalho.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Comprador;