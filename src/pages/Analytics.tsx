import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, Users, Package, DollarSign } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const Analytics = () => {
  const navigate = useNavigate();

  // Dados para gráficos
  const salesData = [
    { day: '01/04', vendas: 4200, clientes: 45 },
    { day: '05/04', vendas: 5800, clientes: 62 },
    { day: '10/04', vendas: 7200, clientes: 78 },
    { day: '15/04', vendas: 8900, clientes: 92 },
    { day: '20/04', vendas: 10500, clientes: 108 },
    { day: '25/04', vendas: 9200, clientes: 95 },
    { day: '30/04', vendas: 11800, clientes: 124 },
  ];

  const categoryData = [
    { name: 'Eletrônicos', value: 45, color: '#0088FE' },
    { name: 'Acessórios', value: 25, color: '#00C49F' },
    { name: 'Informática', value: 18, color: '#FFBB28' },
    { name: 'Games', value: 12, color: '#FF8042' },
  ];

  const topProductsData = [
    { name: 'Smartphone X1', vendas: 124, receita: 49600 },
    { name: 'Tablet Pro', vendas: 89, receita: 35600 },
    { name: 'Fone Bluetooth', vendas: 76, receita: 7600 },
    { name: 'Carregador Rápido', vendas: 65, receita: 3250 },
    { name: 'Capa Protetora', vendas: 58, receita: 2900 },
  ];

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="mb-2"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Voltar
            </Button>
            <h1 className="text-3xl font-bold text-gray-900">Dashboard Analytics</h1>
            <p className="text-gray-600 mt-1">
              Painel executivo com métricas e insights para tomada de decisão
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
              NEWSHOP
            </div>
            <div className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
              Admin
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Vendas Totais</CardTitle>
                <DollarSign className="h-5 w-5 text-blue-600" />
              </div>
              <CardDescription>Últimos 30 dias</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">R$ 245.890,50</div>
              <div className="flex items-center text-sm text-green-600 mt-1">
                <TrendingUp className="h-4 w-4 mr-1" />
                +12.5% vs período anterior
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Produtos Vendidos</CardTitle>
                <Package className="h-5 w-5 text-green-600" />
              </div>
              <CardDescription>Últimos 30 dias</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">1.847</div>
              <div className="flex items-center text-sm text-green-600 mt-1">
                <TrendingUp className="h-4 w-4 mr-1" />
                +8.2% vs período anterior
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Ticket Médio</CardTitle>
                <DollarSign className="h-5 w-5 text-purple-600" />
              </div>
              <CardDescription>Últimos 30 dias</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">R$ 133,15</div>
              <div className="flex items-center text-sm text-green-600 mt-1">
                <TrendingUp className="h-4 w-4 mr-1" />
                +4.1% vs período anterior
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Clientes Ativos</CardTitle>
                <Users className="h-5 w-5 text-orange-600" />
              </div>
              <CardDescription>Últimos 30 dias</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">342</div>
              <div className="flex items-center text-sm text-green-600 mt-1">
                <TrendingUp className="h-4 w-4 mr-1" />
                +15.3% vs período anterior
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Vendas por Dia</CardTitle>
              <CardDescription>Evolução das vendas nos últimos 30 dias</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={salesData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip 
                      formatter={(value) => [`R$ ${value.toLocaleString()}`, 'Vendas']}
                      labelFormatter={(label) => `Dia: ${label}`}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="vendas" 
                      stroke="#8884d8" 
                      strokeWidth={2}
                      name="Vendas (R$)"
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="clientes" 
                      stroke="#82ca9d" 
                      strokeWidth={2}
                      name="Clientes"
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Vendas por Categoria</CardTitle>
              <CardDescription>Distribuição das vendas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {categoryData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${value}%`, 'Participação']} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top Produtos</CardTitle>
              <CardDescription>Produtos mais vendidos por receita</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProductsData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={60} />
                    <YAxis />
                    <Tooltip 
                      formatter={(value) => [`R$ ${value.toLocaleString()}`, 'Receita']}
                      labelFormatter={(label) => `Produto: ${label}`}
                    />
                    <Legend />
                    <Bar dataKey="receita" name="Receita (R$)" fill="#8884d8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Performance Metrics */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Métricas de Performance</CardTitle>
            <CardDescription>Indicadores chave de desempenho</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm font-medium">Taxa de Conversão</span>
                  <span className="text-sm font-bold">4.8%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full" style={{ width: "48%" }}></div>
                </div>
                <div className="text-xs text-gray-500 mt-1">Meta: 5.0%</div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm font-medium">Satisfação do Cliente</span>
                  <span className="text-sm font-bold">92%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-green-600 h-2 rounded-full" style={{ width: "92%" }}></div>
                </div>
                <div className="text-xs text-gray-500 mt-1">Meta: 90%</div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm font-medium">Tempo Médio de Atendimento</span>
                  <span className="text-sm font-bold">3.2 min</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-purple-600 h-2 rounded-full" style={{ width: "64%" }}></div>
                </div>
                <div className="text-xs text-gray-500 mt-1">Meta: 5.0 min</div>
              </div>

              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sm font-medium">Retenção de Clientes</span>
                  <span className="text-sm font-bold">78%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-orange-600 h-2 rounded-full" style={{ width: "78%" }}></div>
                </div>
                <div className="text-xs text-gray-500 mt-1">Meta: 75%</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer Note */}
        <div className="text-center text-gray-500 text-sm mt-8">
          <p>Dashboard Analytics - Acesso restrito a administradores e super admin</p>
          <p className="mt-1">Dados atualizados em tempo real • Última atualização: hoje às 14:30</p>
        </div>
      </div>
    </div>
  );
};

export default Analytics;