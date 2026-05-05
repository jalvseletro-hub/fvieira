import React, { Component, useState, useEffect } from 'react';
import { 
  Plus, 
  Truck, 
  Calendar, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Settings, 
  ChevronRight,
  Trash2,
  LayoutDashboard,
  History,
  Info,
  FileDown,
  Edit2,
  Camera,
  Upload,
  LogIn,
  LogOut,
  RefreshCw,
  Building2,
  Pencil
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  PieChart,
  Pie,
  Legend
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn, formatCurrency, cleanObject } from './lib/utils';
import { 
  Vehicle, 
  MonthRecord, 
  ServiceEntry, 
  MonthlyCosts, 
  ServiceType,
  GasItem,
  CompanySettings
} from './types';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy,
  handleFirestoreError,
  OperationType,
  User
} from './lib/firebase';

// Pre-populated data
const DEFAULT_DIESEL_PRICE = 6.50;
const INITIAL_SETTINGS: CompanySettings = {
  name: 'F.VIEIRA',
  cnpj: '',
  address: '',
  phone: '',
  email: ''
};

// Pre-populated data
const INITIAL_VEHICLE_ID = '';
const INITIAL_VEHICLES: Vehicle[] = [];
const INITIAL_SERVICES: ServiceEntry[] = [];
const INITIAL_RECORDS: MonthRecord[] = [];

const PRICES = {
  casada: 800,
  normal: 450,
  milho: 0, // Manual price
  cimento: 0, // Manual price
  boa_vista: 11000,
  gas: 0, // Manual price for revenue
  frete_avulso: 0, // Manual price
  aleatorio: 0 // Manual price
};

const getServiceRevenue = (s: ServiceEntry) => {
  let baseRevenue = 0;
  if (s.type === 'aleatorio') {
    baseRevenue = -(s.quantity * (s.unitPrice || 0));
  } else if (s.type === 'gas' && s.gasItems && s.gasItems.length > 0) {
    baseRevenue = s.gasItems.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);
  } else {
    const price = (s.type === 'milho' || s.type === 'cimento' || s.type === 'gas' || s.type === 'frete_avulso') ? (s.unitPrice || 0) : PRICES[s.type as keyof typeof PRICES];
    baseRevenue = (s.quantity || 0) * price;
  }
  return baseRevenue;
};

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false, errorInfo: null };

  constructor(props: ErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, errorInfo: error.message };
  }

  componentCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Ocorreu um erro inesperado.";
      try {
        const parsed = JSON.parse(this.state.errorInfo || "");
        if (parsed.error && parsed.error.includes("Missing or insufficient permissions")) {
          displayMessage = "Você não tem permissão para realizar esta ação ou acessar estes dados.";
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 text-center">
            <div className="w-20 h-20 bg-rose-100 rounded-2xl flex items-center justify-center text-rose-600 mx-auto mb-6">
              <Info size={40} />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Ops! Algo deu errado</h1>
            <p className="text-slate-500 mb-8">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl hover:bg-indigo-700 transition-all"
            >
              Recarregar Aplicativo
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [records, setRecords] = useState<MonthRecord[]>([]);
  const [settings, setSettings] = useState<CompanySettings>(INITIAL_SETTINGS);
  const [dataLoaded, setDataLoaded] = useState({
    vehicles: false,
    records: false,
    settings: false
  });
  const [forceReady, setForceReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setForceReady(true);
      setIsAuthReady(true); // Safety fallback for auth ready state
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const isDataReady = forceReady || (dataLoaded.vehicles && dataLoaded.records && dataLoaded.settings);

  const [activeTab, setActiveTab] = useState<'dashboard' | 'history' | 'vehicles' | 'settings'>('dashboard');
  const [userRole, setUserRole] = useState<'none' | 'admin' | 'driver'>('none');
  const [currentUserVehicleId, setCurrentUserVehicleId] = useState<string | null>(() => {
    return localStorage.getItem('ms_current_user_vehicle_id');
  });
  const [plateInput, setPlateInput] = useState('');
  const [accessError, setAccessError] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(INITIAL_VEHICLE_ID);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [showNewVehicleModal, setShowNewVehicleModal] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [recordToDelete, setRecordToDelete] = useState<string | null>(null);
  const [editingService, setEditingService] = useState<{recordId: string, service: ServiceEntry} | null>(null);
  const [showAddService, setShowAddService] = useState(false);

  // Auto-select latest record for selected vehicle if none selected
  useEffect(() => {
    if (selectedVehicleId && !selectedRecordId && dataLoaded.records) {
      const vRecords = records
        .filter(r => r.vehicleId === selectedVehicleId)
        .sort((a, b) => b.year - a.year || b.month - a.month);
      
      if (vRecords.length > 0) {
        setSelectedRecordId(vRecords[0].id);
      }
    }
  }, [selectedVehicleId, selectedRecordId, dataLoaded.records, records]);
  
  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
      
      if (user && user.email?.toLowerCase() === 'jalvs.eletro@gmail.com') {
        setUserRole('admin');
      } else if (currentUserVehicleId) {
        setUserRole('driver');
      } else {
        setUserRole('none');
      }
    });
    return () => unsubscribe();
  }, [currentUserVehicleId]);

  const isAdmin = userRole === 'admin';
  const isDriver = userRole === 'driver';
  useEffect(() => {
    if (!user) return;

    const unsubVehicles = onSnapshot(collection(db, 'vehicles'), (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as Vehicle);
      setVehicles(data);
      
      // Select vehicle logically
      setSelectedVehicleId(prevId => {
        // 1. If it's a driver, always use their assigned vehicle
        if (currentUserVehicleId) return currentUserVehicleId;
        
        // 2. If we have vehicles and the current ID is empty or not in the list, pick the first one
        if (data.length > 0) {
          const exists = data.some(v => v.id === prevId);
          if (!prevId || prevId === 'v1' || !exists) {
            return data[0].id;
          }
        }
        
        return prevId;
      });
      
      setDataLoaded(prev => ({ ...prev, vehicles: true }));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'vehicles', false));

    const unsubRecords = onSnapshot(collection(db, 'records'), (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as MonthRecord);
      setRecords(data);
      setDataLoaded(prev => ({ ...prev, records: true }));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'records', false));

    const unsubSettings = onSnapshot(doc(db, 'settings', 'company'), (snapshot) => {
      if (snapshot.exists()) {
        setSettings(snapshot.data() as CompanySettings);
      }
      setDataLoaded(prev => ({ ...prev, settings: true }));
    }, (error) => handleFirestoreError(error, OperationType.GET, 'settings/company', false));

    return () => {
      unsubVehicles();
      unsubRecords();
      unsubSettings();
    };
  }, [user]);

  // Migration Logic (Only for Admin)
  const currentUserVehicle = vehicles.find(v => v.id === currentUserVehicleId);

  const migrateData = async () => {
    if (!isAdmin || isMigrating) return;
    setIsMigrating(true);
    try {
      // Migrate Vehicles
      const savedVehicles = localStorage.getItem('ms_vehicles');
      if (savedVehicles) {
        const parsed = JSON.parse(savedVehicles) as Vehicle[];
        for (const v of parsed) {
          // Check if photo is too large for Firestore (1MB limit)
          // We use 800KB as a safe limit for the photo string
          if (v.photoUrl && v.photoUrl.length > 800000) {
            console.warn(`Photo for vehicle ${v.name} is too large (${(v.photoUrl.length / 1024 / 1024).toFixed(2)}MB). Clearing photo to allow migration.`);
            v.photoUrl = ''; 
          }
          await setDoc(doc(db, 'vehicles', v.id), cleanObject(v));
        }
      }

      // Migrate Records
      const savedRecords = localStorage.getItem('ms_records');
      if (savedRecords) {
        const parsed = JSON.parse(savedRecords) as MonthRecord[];
        for (const r of parsed) {
          await setDoc(doc(db, 'records', r.id), cleanObject(r));
        }
      }

      // Migrate Settings
      const savedSettings = localStorage.getItem('ms_settings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings) as CompanySettings;
        await setDoc(doc(db, 'settings', 'company'), cleanObject(parsed));
      }

      alert('Dados migrados para a nuvem com sucesso!');
    } catch (error) {
      console.error('Migration failed', error);
    } finally {
      setIsMigrating(false);
    }
  };

  useEffect(() => {
    if (currentUserVehicleId) {
      localStorage.setItem('ms_current_user_vehicle_id', currentUserVehicleId);
      setSelectedVehicleId(currentUserVehicleId);
    } else {
      localStorage.removeItem('ms_current_user_vehicle_id');
    }
  }, [currentUserVehicleId]);

  const handleUpdateSettings = async (updatedSettings: CompanySettings) => {
    try {
      await setDoc(doc(db, 'settings', 'company'), cleanObject(updatedSettings));
      alert('Configurações salvas com sucesso!');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/company');
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handlePlateAccess = () => {
    const v = vehicles.find(v => v.plate.toLowerCase() === plateInput.trim().toLowerCase());
    if (v) {
      setCurrentUserVehicleId(v.id);
      setUserRole('driver');
      setAccessError('');
      setActiveTab('dashboard');
    } else {
      setAccessError('Veículo não encontrado. Verifique a placa.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCurrentUserVehicleId(null);
      setUserRole('none');
      setPlateInput('');
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId) || vehicles[0];
  const vehicleRecords = records.filter(r => r.vehicleId === selectedVehicleId).sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  const activeRecord = selectedRecordId 
    ? vehicleRecords.find(r => r.id === selectedRecordId) || vehicleRecords[0]
    : vehicleRecords[0];

  const calculateRevenue = (record: MonthRecord) => {
    return record.services.reduce((acc, s) => acc + getServiceRevenue(s), 0);
  };

  const calculateCosts = (record: MonthRecord) => {
    const revenue = record.services.reduce((acc, s) => acc + getServiceRevenue(s), 0);
    
    const aleatorioImpact = record.services.reduce((acc, s) => {
      if (s.type === 'aleatorio') {
        return acc + (s.quantity * (s.unitPrice || 0)) + (s.driverPayment || 0);
      }
      return acc;
    }, 0);

    // Revenue subject to tax
    const taxableRevenue = record.services.reduce((acc, s) => {
      if (s.type === 'milho' || s.type === 'gas' || s.type === 'frete_avulso' || s.type === 'aleatorio') return acc;
      const price = s.type === 'cimento' ? (s.unitPrice || 0) : PRICES[s.type as keyof typeof PRICES];
      return acc + (s.quantity * price);
    }, 0);

    const diesel = record.costs.dieselLiters * record.costs.dieselPrice;
    
    const driver1Services = record.services.filter(s => (s.driverId || 1) === 1);
    const driver2Services = record.services.filter(s => (s.driverId || 1) === 2);
    
    const getDriverDailyEarnings = (services: ServiceEntry[]) => {
      const dates = Array.from(new Set(services.map(s => s.date)));
      let total = 0;
      dates.forEach(date => {
        const dayServices = services.filter(s => s.date === date);
        const customPayment = dayServices.reduce((acc, s) => acc + (s.driverPayment || 0), 0);
        // Se houver algum valor digitado, usa ele. Se não, usa a diária padrão.
        total += customPayment > 0 ? customPayment : record.costs.driverDailyRate;
      });
      return { total, days: dates.length };
    };

    const d1 = getDriverDailyEarnings(driver1Services);
    const d2 = getDriverDailyEarnings(driver2Services);
    
    const driver1Days = d1.days;
    const driver2Days = d2.days;
    const driver1TotalEarnings = d1.total;
    const driver2TotalEarnings = d2.total;
    
    const totalDriverDaysCalculated = driver1Days + driver2Days;
    const overtime = (record.costs.overtimeHours || 0) * (record.costs.overtimeRate || 0);
    
    // Se não houver serviços lançados, usa o padrão das configurações do registro
    const driverBase = totalDriverDaysCalculated > 0 
      ? (driver1TotalEarnings + driver2TotalEarnings)
      : record.costs.driverDays * record.costs.driverDailyRate;
      
    const driver = driverBase + overtime;
    
    const maintenance = record.costs.maintenanceParts + record.costs.maintenanceLabor;
    
    const vehicle = vehicles.find(v => v.id === record.vehicleId);
    const isAtego = vehicle?.name.includes('Atego 2425');
    
    const agentCommissions = record.services.reduce((acc, s) => acc + (s.agentCommission || 0), 0);
    const ategoExtras = isAtego ? record.services.reduce((acc, s) => acc + (s.helperCost || 0) + (s.lunchCost || 0) + (s.portCost || 0), 0) : 0;
    
    const pureExtraCosts = ategoExtras + agentCommissions;
    const taxes = (taxableRevenue * record.costs.taxRate) / 100;
    
    const total = diesel + driver + maintenance + taxes + pureExtraCosts; 
    const profit = revenue - total;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    
    return {
      revenue,
      aleatorioImpact,
      diesel,
      driver,
      driverBase,
      driver1Days,
      driver2Days,
      driver1TotalCost: driver1TotalEarnings,
      driver2TotalCost: driver2TotalEarnings,
      overtime,
      maintenance,
      extraCosts: pureExtraCosts,
      agentCommissions,
      taxes,
      total,
      profit,
      margin
    };
  };

  const stats = activeRecord ? calculateCosts(activeRecord) : null;

  const chartData = vehicleRecords.slice(0, 6).reverse().map(r => ({
    name: format(new Date(r.year, r.month), 'MMM', { locale: ptBR }),
    receita: calculateRevenue(r),
    custos: calculateCosts(r).total,
    lucro: calculateRevenue(r) - calculateCosts(r).total
  }));

  const handleUpdateVehicle = async (id: string, name: string, plate: string, photoUrl?: string, pin?: string) => {
    const updatedVehicle = { id, name, plate, photoUrl, pin };
    try {
      await setDoc(doc(db, 'vehicles', id), cleanObject(updatedVehicle));
      setEditingVehicleId(null);
      setShowNewVehicleModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `vehicles/${id}`);
    }
  };

  const generateVehiclePDF = (record: MonthRecord) => {
    const doc = new jsPDF();
    const vehicle = vehicles.find(v => v.id === record.vehicleId);
    const monthName = format(new Date(record.year, record.month), 'MMMM yyyy', { locale: ptBR });
    const stats = calculateCosts(record);
    const revenue = calculateRevenue(record);

    // Company Header
    if (settings.logoUrl) {
      try {
        doc.addImage(settings.logoUrl, 'JPEG', 14, 10, 30, 30);
      } catch (e) {
        console.error("Error adding logo to PDF", e);
      }
    }

    doc.setFontSize(20);
    doc.setTextColor(79, 70, 229); // Indigo 600
    doc.text(settings.name, settings.logoUrl ? 50 : 14, 22);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139); // Slate 500
    let headerY = 30;
    if (settings.cnpj) {
      doc.text(`CNPJ: ${settings.cnpj}`, settings.logoUrl ? 50 : 14, headerY);
      headerY += 5;
    }
    if (settings.address) {
      doc.text(settings.address, settings.logoUrl ? 50 : 14, headerY);
      headerY += 5;
    }
    if (settings.phone || settings.email) {
      doc.text(`${settings.phone || ''} ${settings.phone && settings.email ? '|' : ''} ${settings.email || ''}`, settings.logoUrl ? 50 : 14, headerY);
      headerY += 5;
    }

    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, Math.max(headerY + 10, 45));

    // Vehicle Info
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42); // Slate 900
    const infoY = Math.max(headerY + 20, 55);
    doc.text(`Veículo: ${vehicle?.name || 'N/A'}`, 14, infoY);
    doc.text(`Placa: ${vehicle?.plate || 'N/A'}`, 14, infoY + 7);
    doc.text(`Período: ${monthName}`, 14, infoY + 14);

    let nextY = infoY + 25;

    // Client Info (if available)
    if (record.client) {
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text('Dados do Cliente:', 120, infoY);
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      let clientY = infoY + 7;
      doc.text(`Empresa: ${record.client.name}`, 120, clientY);
      if (record.client.cnpj) { clientY += 5; doc.text(`CNPJ: ${record.client.cnpj}`, 120, clientY); }
      if (record.client.contactName) { clientY += 5; doc.text(`Contato: ${record.client.contactName}`, 120, clientY); }
      if (record.client.phone) { clientY += 5; doc.text(`Tel: ${record.client.phone}`, 120, clientY); }
      if (record.client.email) { clientY += 5; doc.text(`E-mail: ${record.client.email}`, 120, clientY); }
      if (record.client.address) { 
        clientY += 5; 
        const splitAddress = doc.splitTextToSize(`End: ${record.client.address}`, 80);
        doc.text(splitAddress, 120, clientY);
        clientY += (splitAddress.length * 5);
      }
      nextY = Math.max(nextY, clientY + 10);
    }

    // Summary Table
    const summaryRows = [
      ['Receita Bruta', formatCurrency(revenue)],
      ['Diesel', formatCurrency(stats.diesel)],
    ];

    if (stats.driver1Days > 0 || stats.driver2Days > 0) {
      if (stats.driver1Days > 0) {
        summaryRows.push([`Diárias Motorista 1 (${stats.driver1Days} dias)`, formatCurrency((stats as any).driver1TotalCost)]);
      }
      if (stats.driver2Days > 0) {
        summaryRows.push([`Diárias Motorista 2 (${stats.driver2Days} dias)`, formatCurrency((stats as any).driver2TotalCost)]);
      }
    } else {
      summaryRows.push([`Diárias Motorista (${record.costs.driverDays} dias)`, formatCurrency(stats.driverBase)]);
    }

    summaryRows.push(['Horas Extras', formatCurrency(stats.overtime)]);
    summaryRows.push(['Manutenção', formatCurrency(stats.maintenance)]);
    summaryRows.push(['Impostos (Exceto Milho)', formatCurrency(stats.taxes)]);

    const isAtego = vehicle?.name.includes('Atego 2425');
    if (isAtego) {
      const ategoExtras = record.services.reduce((acc, s) => acc + (s.helperCost || 0) + (s.lunchCost || 0) + (s.portCost || 0), 0);
      if (ategoExtras > 0) {
        summaryRows.push(['Custos Extras (Ajudante/Almoço/Porto)', formatCurrency(ategoExtras)]);
      }
    }

    if (stats.agentCommissions > 0) {
      summaryRows.push(['Comissão Agenciador (Milho)', formatCurrency(stats.agentCommissions)]);
    }

    summaryRows.push(['Custo Total', formatCurrency(stats.total)]);
    summaryRows.push(['Lucro Líquido', formatCurrency(stats.profit)]);
    summaryRows.push(['Margem de Lucro', `${stats.margin.toFixed(2)}%`]);

    autoTable(doc, {
      startY: nextY,
      head: [['Descrição', 'Valor']],
      body: summaryRows,
      theme: 'striped',
      headStyles: { fillColor: [79, 70, 229] },
    });

    // Services Table
    doc.setFontSize(14);
    doc.text('Detalhamento de Serviços', 14, (doc as any).lastAutoTable.finalY + 15);

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 20,
      head: [['Data', 'Tipo', 'Motor.', 'Qtd', 'Valor Unit.', 'Total']],
      body: record.services.map(s => {
        const typeStr = (s.type === 'casada' ? 'Casada' : 
                        s.type === 'normal' ? 'Normal' : 
                        s.type === 'milho' ? 'Milho' : 
                        s.type === 'cimento' ? 'Cimento' : 
                        s.type === 'boa_vista' ? 'Boa Vista' : 
                        s.type === 'gas' ? 'Gás' : 
                        s.type === 'aleatorio' ? 'Aleatório' : 'Frete Avulso') + 
                        (s.agentCommission ? `\n(Comis: ${formatCurrency(s.agentCommission)})` : '') +
                        (s.observation ? `\nObs: ${s.observation}` : '');
        
        return [
          format(parseISO(s.date), 'dd/MM/yyyy'),
          typeStr,
          s.driverId || 1,
          s.quantity + (s.overtimeHours ? ` (+${s.overtimeHours}h extra)` : ''),
          formatCurrency((s.type === 'milho' || s.type === 'cimento' || s.type === 'gas' || s.type === 'frete_avulso' || s.type === 'aleatorio') ? (s.unitPrice || 0) : PRICES[s.type]),
          formatCurrency(getServiceRevenue(s))
        ];
      }),
      theme: 'grid',
      headStyles: { fillColor: [71, 85, 105] },
      columnStyles: {
        2: { halign: 'center' }
      }
    });

    // Service Summary Table
    const serviceSummary = record.services.reduce((acc: any, s) => {
      const type = s.type;
      if (!acc[type]) acc[type] = { count: 0, quantity: 0, revenue: 0, details: {} };
      acc[type].count += 1;
      acc[type].quantity += s.quantity;
      
      acc[type].revenue += getServiceRevenue(s);
      
      if (type === 'gas') {
        if (s.gasItems) {
          s.gasItems.forEach(item => {
            acc[type].details[item.size] = (acc[type].details[item.size] || 0) + item.quantity;
          });
        } else if (s.containerSize) {
          acc[type].details[s.containerSize] = (acc[type].details[s.containerSize] || 0) + s.quantity;
        }
      }
      return acc;
    }, {});

    const summaryBody = [];
    const normalQty = (serviceSummary['normal']?.quantity || 0);
    const casadaQty = serviceSummary['casada']?.quantity || 0;
    const normalRev = (serviceSummary['normal']?.revenue || 0);
    const casadaRev = serviceSummary['casada']?.revenue || 0;
    
    if (normalQty > 0 || casadaQty > 0) {
      summaryBody.push([
        'Normal / Casada', 
        `${normalQty + casadaQty} Cargas (Normal: ${normalQty}, Casada: ${casadaQty})\nReceita: ${formatCurrency(normalRev + casadaRev)} (Normal: ${formatCurrency(normalRev)}, Casada: ${formatCurrency(casadaRev)})`
      ]);
    }
    if (serviceSummary['cimento']) {
      summaryBody.push(['Cimento', `${serviceSummary['cimento'].count} Cargas (${serviceSummary['cimento'].quantity} Sacas)\nReceita: ${formatCurrency(serviceSummary['cimento'].revenue)}`]);
    }
    if (serviceSummary['gas']) {
      const gasDetails = Object.entries(serviceSummary['gas'].details)
        .map(([size, qty]) => `${qty}x ${size}`)
        .join(', ');
      summaryBody.push(['Gás', `${serviceSummary['gas'].count} Cargas (${gasDetails})\nReceita: ${formatCurrency(serviceSummary['gas'].revenue)}`]);
    }
    if (serviceSummary['milho']) {
      summaryBody.push(['Milho', `${serviceSummary['milho'].count} Cargas (${serviceSummary['milho'].quantity} Unidades)\nReceita: ${formatCurrency(serviceSummary['milho'].revenue)}`]);
    }
    if (serviceSummary['boa_vista']) {
      summaryBody.push(['Boa Vista', `${serviceSummary['boa_vista'].count} Viagens\nReceita: ${formatCurrency(serviceSummary['boa_vista'].revenue)}`]);
    }
    if (serviceSummary['frete_avulso']) {
      summaryBody.push(['Frete Avulso', `${serviceSummary['frete_avulso'].count} Serviços\nReceita: ${formatCurrency(serviceSummary['frete_avulso'].revenue)}`]);
    }
    if (serviceSummary['aleatorio']) {
      const aleatorioCostValue = record.services.reduce((acc, s) => s.type === 'aleatorio' ? acc + (s.quantity * (s.unitPrice || 0)) + (s.driverPayment || 0) : acc, 0);
      summaryBody.push(['Aleatório (Ajuste)', `${serviceSummary['aleatorio'].count} Lançamentos\nSaída Total: ${formatCurrency(aleatorioCostValue)}`]);
    }

    if (summaryBody.length > 0) {
      doc.setFontSize(14);
      doc.text('Resumo de Serviços no Mês', 14, (doc as any).lastAutoTable.finalY + 15);

      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 20,
        head: [['Tipo de Serviço', 'Totalização']],
        body: summaryBody,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] },
      });
    }

    doc.save(`Relatorio_${vehicle?.name.replace(/\s+/g, '_')}_${monthName.replace(/\s+/g, '_')}.pdf`);
  };

  const generateReceiptPDF = (record: MonthRecord) => {
    const filteredServices = record.services.filter(s => s.type === 'normal' || s.type === 'casada');
    if (filteredServices.length === 0) {
      alert('Nenhum serviço Normal ou Casada encontrado para este período.');
      return;
    }

    const doc = new jsPDF();
    doc.setFont('helvetica', 'normal');
    const vehicle = vehicles.find(v => v.id === record.vehicleId);
    const monthName = format(new Date(record.year, record.month), 'MMMM yyyy', { locale: ptBR });
    
    const revenue = filteredServices.reduce((acc, s) => acc + getServiceRevenue(s), 0);
    const normalServices = filteredServices.filter(s => s.type === 'normal');
    const casadaServices = filteredServices.filter(s => s.type === 'casada');
    const normalQty = normalServices.reduce((acc, s) => acc + s.quantity, 0);
    const casadaQty = casadaServices.reduce((acc, s) => acc + s.quantity, 0);

    // Company Header
    if (settings.logoUrl) {
      try {
        doc.addImage(settings.logoUrl, 'JPEG', 14, 10, 30, 30);
      } catch (e) {
        console.error("Error adding logo to PDF", e);
      }
    }

    doc.setFontSize(20);
    doc.setTextColor(79, 70, 229); // Indigo 600
    doc.setFont('helvetica', 'bold');
    doc.text(settings.name, settings.logoUrl ? 50 : 14, 22);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139); // Slate 500
    doc.setFont('helvetica', 'normal');
    let headerY = 30;
    if (settings.cnpj) {
      doc.text(`CNPJ: ${settings.cnpj}`, settings.logoUrl ? 50 : 14, headerY);
      headerY += 5;
    }
    if (settings.address) {
      doc.text(settings.address, settings.logoUrl ? 50 : 14, headerY);
      headerY += 5;
    }
    if (settings.phone || settings.email) {
      doc.text(`${settings.phone || ''} ${settings.phone && settings.email ? '|' : ''} ${settings.email || ''}`, settings.logoUrl ? 50 : 14, headerY);
      headerY += 5;
    }

    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text(`Recibo gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, Math.max(headerY + 10, 45));

    // Information Section Layout (Symmetric)
    const infoStartY = Math.max(headerY + 20, 55);
    
    // Left side: Vehicle
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.text('Dados do Veículo:', 14, infoStartY);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Veículo: ${vehicle?.name || 'N/A'}`, 14, infoStartY + 7);
    doc.text(`Placa: ${vehicle?.plate || 'N/A'}`, 14, infoStartY + 13);
    doc.text(`Período: ${monthName}`, 14, infoStartY + 19);

    let finalInfoY = infoStartY + 19;

    // Right side: Client
    if (record.client) {
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.text('Dados do Cliente:', 110, infoStartY);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      let clientY = infoStartY + 7;
      
      // Wrap Empresa Name
      const splitClientName = doc.splitTextToSize(`Empresa: ${record.client.name}`, 85);
      doc.text(splitClientName, 110, clientY);
      clientY += (splitClientName.length * 5);

      if (record.client.cnpj) { doc.text(`CNPJ: ${record.client.cnpj}`, 110, clientY); clientY += 5; }
      if (record.client.contactName) { doc.text(`Contato: ${record.client.contactName}`, 110, clientY); clientY += 5; }
      if (record.client.phone) { doc.text(`Tel: ${record.client.phone}`, 110, clientY); clientY += 5; }
      if (record.client.email) { doc.text(`E-mail: ${record.client.email}`, 110, clientY); clientY += 5; }
      
      if (record.client.address) { 
        const splitAddress = doc.splitTextToSize(`End: ${record.client.address}`, 85);
        doc.text(splitAddress, 110, clientY);
        clientY += (splitAddress.length * 5);
      }
      finalInfoY = Math.max(finalInfoY, clientY);
    }

    let nextSectionY = finalInfoY + 15;

    // Financial Summary
    doc.setFontSize(13);
    doc.setTextColor(79, 70, 229);
    doc.setFont('helvetica', 'bold');
    doc.text('Resumo Financeiro', 14, nextSectionY);

    const summaryRows = [
      ['Quantidade de Cargas Normal', `${normalQty} Cargas`],
      ['Quantidade de Cargas Casada', `${casadaQty} Cargas`],
      [{ content: 'VALOR TOTAL A RECEBER', styles: { fontStyle: 'bold' as const, fillColor: [248, 250, 252] as [number, number, number] } }, 
       { content: formatCurrency(revenue), styles: { fontStyle: 'bold' as const, fillColor: [248, 250, 252] as [number, number, number], textColor: [79, 70, 229] as [number, number, number] } }],
    ];

    autoTable(doc, {
      startY: nextSectionY + 5,
      head: [['Descrição', 'Totalização']],
      body: summaryRows,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229], fontStyle: 'bold' },
      styles: { font: 'helvetica', fontSize: 10 },
      columnStyles: {
        1: { halign: 'right' }
      }
    });

    // Detailing
    const detailStartY = (doc as any).lastAutoTable.finalY + 15;
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.text('Detalhamento dos Serviços', 14, detailStartY);

    autoTable(doc, {
      startY: detailStartY + 5,
      head: [['Data', 'Tipo', 'Motor.', 'Qtd', 'Valor Unit.', 'Total']],
      body: filteredServices.map(s => [
        format(parseISO(s.date), 'dd/MM/yyyy'),
        (s.type === 'casada' ? 'Casada' : s.type === 'aleatorio' ? 'Aleatório' : 'Normal') + (s.observation ? `\nObs: ${s.observation}` : ''),
        s.driverId || 1,
        s.quantity + (s.overtimeHours ? ` (+${s.overtimeHours}h extra)` : ''),
        formatCurrency((s.type === 'milho' || s.type === 'cimento' || s.type === 'gas' || s.type === 'frete_avulso' || s.type === 'aleatorio') ? (s.unitPrice || 0) : PRICES[s.type as keyof typeof PRICES]),
        formatCurrency(getServiceRevenue(s))
      ]),
      theme: 'striped',
      headStyles: { fillColor: [51, 65, 85], fontStyle: 'bold' },
      styles: { font: 'helvetica', fontSize: 9 },
      columnStyles: {
        2: { halign: 'center' },
        3: { halign: 'center' },
        4: { halign: 'right' },
        5: { halign: 'right' }
      }
    });

    // Signature Area
    const pageHeight = doc.internal.pageSize.height;
    const signatureY = Math.max((doc as any).lastAutoTable.finalY + 40, pageHeight - 30);
    
    // Safety check if it overflows
    if (signatureY > pageHeight - 10) {
      doc.addPage();
      doc.setDrawColor(200, 200, 200);
      doc.line(60, 50, 150, 50);
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text('Assinatura do Recebedor', 105, 55, { align: 'center' });
    } else {
      doc.setDrawColor(200, 200, 200);
      doc.line(60, signatureY, 150, signatureY);
      doc.setFontSize(10);
      doc.setTextColor(100, 116, 139);
      doc.text('Assinatura do Recebedor', 105, signatureY + 5, { align: 'center' });
    }

    doc.save(`Recibo_${vehicle?.plate || 'Veiculo'}_${format(new Date(record.year, record.month), 'MM_yyyy')}.pdf`);
  };

  const generateFleetPDF = (month: number, year: number) => {
    const doc = new jsPDF();
    const monthName = format(new Date(year, month), 'MMMM yyyy', { locale: ptBR });
    const monthRecords = records.filter(r => r.month === month && r.year === year);

    let totalRevenue = 0;
    let totalCosts = 0;
    let totalProfit = 0;

    const fleetData = monthRecords.map(r => {
      const v = vehicles.find(veh => veh.id === r.vehicleId);
      const rev = calculateRevenue(r);
      const cost = calculateCosts(r).total;
      const prof = rev - cost;
      
      totalRevenue += rev;
      totalCosts += cost;
      totalProfit += prof;

      return [
        v?.name || 'N/A',
        v?.plate || 'N/A',
        formatCurrency(rev),
        formatCurrency(cost),
        formatCurrency(prof)
      ];
    });

    // Header
    doc.setFontSize(20);
    doc.setTextColor(79, 70, 229);
    doc.text('Relatório Consolidado da Frota', 14, 22);
    
    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`Período: ${monthName}`, 14, 30);
    doc.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 35);

    // Fleet Summary Table
    autoTable(doc, {
      startY: 45,
      head: [['Veículo', 'Placa', 'Receita', 'Custos', 'Lucro']],
      body: fleetData,
      foot: [['TOTAL', '', formatCurrency(totalRevenue), formatCurrency(totalCosts), formatCurrency(totalProfit)]],
      theme: 'striped',
      headStyles: { fillColor: [79, 70, 229] },
      footStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
    });

    doc.save(`Relatorio_Frota_${monthName.replace(/\s+/g, '_')}.pdf`);
  };

  const handleAddVehicle = async (name: string, plate: string, photoUrl?: string, pin?: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    const newVehicle: Vehicle = {
      id,
      name,
      plate,
      photoUrl,
      pin
    };
    try {
      await setDoc(doc(db, 'vehicles', id), cleanObject(newVehicle));
      setSelectedVehicleId(newVehicle.id);
      setShowNewVehicleModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `vehicles/${id}`);
    }
  };

  const handleAddRecord = async (record: Omit<MonthRecord, 'id'>) => {
    const id = crypto.randomUUID();
    const newRecord: MonthRecord = {
      ...record,
      id
    };
    try {
      await setDoc(doc(db, 'records', id), cleanObject(newRecord));
      setShowRecordModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `records/${id}`);
    }
  };

  const handleUpdateRecord = async (id: string, updatedData: Omit<MonthRecord, 'id'>) => {
    const updatedRecord = { ...updatedData, id };
    try {
      await setDoc(doc(db, 'records', id), cleanObject(updatedRecord));
      setEditingRecordId(null);
      setShowRecordModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `records/${id}`);
    }
  };

  const handleQuickAddService = async (service: Omit<ServiceEntry, 'id'>) => {
    const serviceDate = parseISO(service.date);
    const month = serviceDate.getMonth();
    const year = serviceDate.getFullYear();
    
    const existingRecord = records.find(r => 
      r.vehicleId === selectedVehicleId && 
      r.month === month && 
      r.year === year
    );

    try {
      if (existingRecord) {
        const updatedServices = [...existingRecord.services, { ...service, id: crypto.randomUUID() }].sort((a, b) => a.date.localeCompare(b.date));
        const updatedRecord = {
          ...existingRecord,
          services: updatedServices,
          costs: {
            ...existingRecord.costs,
            dieselLiters: updatedServices.reduce((acc, s) => acc + (s.dieselLiters || 0), 0),
            overtimeHours: updatedServices.reduce((acc, s) => acc + (s.overtimeHours || 0), 0)
          }
        };
        // driverDays only counts days with non-per-trip services
        const nonTripDates = new Set(updatedRecord.services.filter(s => s.type !== 'boa_vista' && s.type !== 'gas').map(s => s.date));
        updatedRecord.costs.driverDays = nonTripDates.size;
        await setDoc(doc(db, 'records', existingRecord.id), cleanObject(updatedRecord));
      } else {
        const id = crypto.randomUUID();
        const newRecord: MonthRecord = {
          id,
          vehicleId: selectedVehicleId,
          month,
          year,
          services: [{ ...service, id: crypto.randomUUID() }],
          costs: {
            dieselLiters: (service.dieselLiters || 0),
            dieselPrice: DEFAULT_DIESEL_PRICE,
            driverDays: (service.type === 'boa_vista' || service.type === 'gas') ? 0 : 1,
            driverDailyRate: 120,
            taxRate: 5,
            maintenanceParts: 0,
            maintenanceLabor: 0,
            overtimeHours: (service.overtimeHours || 0),
            overtimeRate: 15
          }
        };
        await setDoc(doc(db, 'records', id), cleanObject(newRecord));
        setSelectedRecordId(id);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'records');
    }
  };

  const handleDeleteService = async (recordId: string, serviceId: string) => {
    const record = records.find(r => r.id === recordId);
    if (!record) return;
    
    const updatedServices = record.services.filter(s => s.id !== serviceId);
    const updatedRecord = {
      ...record,
      services: updatedServices,
      costs: {
        ...record.costs,
        dieselLiters: updatedServices.reduce((acc, s) => acc + (s.dieselLiters || 0), 0),
        overtimeHours: updatedServices.reduce((acc, s) => acc + (s.overtimeHours || 0), 0)
      }
    };
    // driverDays only counts days with non-per-trip services
    const nonTripDates = new Set(updatedRecord.services.filter(s => s.type !== 'boa_vista' && s.type !== 'gas').map(s => s.date));
    updatedRecord.costs.driverDays = nonTripDates.size;
    
    try {
      await setDoc(doc(db, 'records', recordId), cleanObject(updatedRecord));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `records/${recordId}`);
    }
  };

  const handleDeleteRecord = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'records', id));
      if (selectedRecordId === id) setSelectedRecordId(null);
      setRecordToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `records/${id}`);
    }
  };

  const handleEditService = (recordId: string, service: ServiceEntry) => {
    setEditingService({ recordId, service });
    setShowAddService(true);
  };

  const handleUpdateService = async (service: Omit<ServiceEntry, 'id'>) => {
    if (!editingService) return;
    
    const record = records.find(r => r.id === editingService.recordId);
    if (!record) return;

    const updatedServices = record.services.map(s => 
      s.id === editingService.service.id ? { ...service, id: s.id } : s
    ).sort((a, b) => a.date.localeCompare(b.date));

    const updatedRecord = {
      ...record,
      services: updatedServices,
      costs: {
        ...record.costs,
        dieselLiters: updatedServices.reduce((acc, s) => acc + (s.dieselLiters || 0), 0),
        overtimeHours: updatedServices.reduce((acc, s) => acc + (s.overtimeHours || 0), 0)
      }
    };

    const nonTripDates = new Set(updatedRecord.services.filter(s => s.type !== 'boa_vista' && s.type !== 'gas').map(s => s.date));
    updatedRecord.costs.driverDays = nonTripDates.size;

    try {
      await setDoc(doc(db, 'records', record.id), cleanObject(updatedRecord));
      setEditingService(null);
      setShowAddService(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `records/${record.id}`);
    }
  };

  if (!isAuthReady || (user && !isDataReady)) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans text-center">
        <div className="text-white flex flex-col items-center gap-6">
          <RefreshCw className="animate-spin text-indigo-500" size={48} />
          <div className="space-y-2">
            <p className="text-lg font-medium">Carregando sistema...</p>
            <p className="text-slate-500 text-sm">Sincronizando seus dados com a nuvem</p>
          </div>
          {forceReady && (
             <button 
               onClick={() => window.location.reload()}
               className="mt-4 text-xs text-indigo-400 underline"
             >
               Está demorando muito? Clique para recarregar
             </button>
          )}
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans text-white">
        <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 text-center text-slate-900">
          <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center text-white mx-auto mb-6 shadow-xl shadow-indigo-500/20">
            <Truck size={40} />
          </div>
          <h1 className="text-2xl font-bold mb-2">F.VIEIRA</h1>
          <p className="text-slate-500 mb-8">Gestão de Frota</p>
          
          <button
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 p-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 transition-all font-bold text-white shadow-lg shadow-indigo-200"
          >
            <LogIn size={20} />
            Entrar com Google para Começar
          </button>
          
          <p className="mt-6 text-[10px] text-slate-400 uppercase tracking-widest font-bold">Acesso Restrito</p>
        </div>
      </div>
    );
  }

  if (userRole === 'none') {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 font-sans">
        <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8 text-center">
          <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center text-white mx-auto mb-6 shadow-xl shadow-indigo-500/20 overflow-hidden">
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <Truck size={40} />
            )}
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Bem-vindo ao {settings.name}</h1>
          <p className="text-slate-500 mb-8">Digite a placa do veículo para acessar o painel de lançamento</p>
          
          <div className="space-y-4">
            <div className="space-y-2 text-left">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">Placa do Veículo</label>
              <input 
                type="text" 
                placeholder="ABC-1234"
                value={plateInput}
                onChange={(e) => setPlateInput(e.target.value.toUpperCase())}
                className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-xl font-black text-slate-900 tracking-wider focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-300"
              />
              {accessError && <p className="text-rose-500 text-xs font-bold px-1">{accessError}</p>}
            </div>

            <button 
              onClick={handlePlateAccess}
              className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
            >
              Acessar Painel de Lançamento
              <ChevronRight size={20} />
            </button>

            <div className="pt-4 border-t border-slate-100">
              <button 
                onClick={handleLogout}
                className="text-slate-400 text-xs font-bold hover:text-rose-500 transition-colors"
              >
                Sair da conta
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row font-sans text-slate-900">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-white border-b md:border-r border-slate-200 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white overflow-hidden">
            {settings.logoUrl ? (
              <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <Truck size={24} />
            )}
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">{settings.name}</h1>
            <p className="text-xs text-slate-500">Gestão de Frotas</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all",
              activeTab === 'dashboard' ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-600 hover:bg-slate-50"
            )}
          >
            <LayoutDashboard size={20} />
            {isAdmin ? 'Dashboard Fleet' : 'Lançamentos'}
          </button>
          {isAdmin && (
            <>
              <button 
                onClick={() => setActiveTab('history')}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all",
                  activeTab === 'history' ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <History size={20} />
                Histórico
              </button>
              <button 
                onClick={() => setActiveTab('vehicles')}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all",
                  activeTab === 'vehicles' ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <Truck size={20} />
                Veículos
              </button>
              <button 
                onClick={() => setActiveTab('settings')}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all",
                  activeTab === 'settings' ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-600 hover:bg-slate-50"
                )}
              >
                <Settings size={20} />
                Configurações
              </button>
            </>
          )}
        </nav>

        <div className="p-4 border-t border-slate-100 space-y-4">
          {isAdmin && (
            <div className="bg-slate-50 rounded-xl p-4">
              <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider mb-2 block">
                Veículo Ativo
              </label>
              <select 
                value={selectedVehicleId}
                onChange={(e) => setSelectedVehicleId(e.target.value)}
                className="w-full bg-transparent font-medium text-slate-700 focus:outline-none cursor-pointer"
              >
                {vehicles.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
          )}
          
          <div className="flex items-center gap-3 p-2">
            <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-100 border-2 border-indigo-100">
              {currentUserVehicle?.photoUrl ? (
                <img src={currentUserVehicle.photoUrl} alt="User" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-indigo-600">
                  <Truck size={16} />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold truncate">{currentUserVehicle?.name}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">{isAdmin ? 'Gestão de Cargas' : '🚛 Motorista'}</p>
            </div>
            <div className="flex items-center gap-1">
              {isAdmin && (
                <button 
                  onClick={migrateData}
                  disabled={isMigrating}
                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                  title="Migrar dados locais para nuvem"
                >
                  <Upload size={18} className={cn(isMigrating && "animate-bounce")} />
                </button>
              )}
              <button 
                onClick={handleLogout}
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                title="Sair da conta"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        {activeTab === 'dashboard' && (
          <div className="max-w-6xl mx-auto space-y-8">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm shrink-0">
                  {selectedVehicle?.photoUrl ? (
                    <img src={selectedVehicle.photoUrl} alt={selectedVehicle.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300">
                      <Truck size={32} />
                    </div>
                  )}
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{selectedVehicle?.name}</h2>
                  <p className="text-slate-500">Placa: {selectedVehicle?.plate}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {activeRecord && isAdmin && (
                  <>
                    <button 
                      onClick={() => generateVehiclePDF(activeRecord)}
                      className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
                      title="Baixar PDF Completo do Veículo"
                    >
                      <FileDown size={18} />
                      PDF
                    </button>
                    <button 
                      onClick={() => generateReceiptPDF(activeRecord)}
                      className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 text-indigo-700 px-4 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
                      title="Baixar Recibo (Normal/Casada)"
                    >
                      <FileDown size={18} />
                      Recibo
                    </button>
                    <button 
                      onClick={() => generateFleetPDF(activeRecord.month, activeRecord.year)}
                      className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
                      title="Baixar PDF da Frota"
                    >
                      <Truck size={18} />
                      Frota
                    </button>
                    <button 
                      onClick={() => {
                        setEditingRecordId(activeRecord.id);
                        setShowRecordModal(true);
                      }}
                      className="inline-flex items-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
                    >
                      <Settings size={18} />
                      Editar Mês
                    </button>
                  </>
                )}
                {isAdmin && (
                  <button 
                    onClick={() => {
                      setEditingRecordId(null);
                      setShowRecordModal(true);
                    }}
                    className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-medium transition-colors shadow-sm shadow-indigo-200"
                  >
                    <Plus size={20} />
                    Novo Mês
                  </button>
                )}
              </div>
            </header>

            {activeRecord ? (
              <>
                {/* Quick Add Service Bar */}
                <QuickAddService 
                  vehicles={vehicles}
                  selectedVehicleId={selectedVehicleId}
                  onAdd={handleQuickAddService} 
                  isDriver={isDriver}
                  editingService={editingService?.service}
                  onEdit={handleUpdateService}
                  onCancel={() => {
                    setEditingService(null);
                  }}
                />
                {/* Stats Grid */}
                {isAdmin && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard 
                      title="Receita Líquida" 
                      value={formatCurrency(stats.revenue)} 
                      icon={<TrendingUp className="text-emerald-600" />}
                      subtitle={stats.aleatorioImpact > 0 
                        ? `Ajuste: -${formatCurrency(stats.aleatorioImpact)}` 
                        : `${activeRecord.services.length} cargas lançadas`}
                      color="emerald"
                    />
                    <StatCard 
                      title="Custos Operacionais" 
                      value={formatCurrency(stats.total + stats.aleatorioImpact)} 
                      icon={<TrendingDown className="text-rose-600" />}
                      subtitle={`${stats.margin.toFixed(1)}% de margem br.`}
                      color="rose"
                    />
                    <StatCard 
                      title="Lucro Líquido" 
                      value={formatCurrency(stats.profit)} 
                      icon={<DollarSign className="text-indigo-600" />}
                      subtitle="Resultado final"
                      color="indigo"
                    />
                    <StatCard 
                      title="Mês de Referência" 
                      value={activeRecord.year && activeRecord.month !== undefined ? format(new Date(activeRecord.year, activeRecord.month), 'MMMM yyyy', { locale: ptBR }) : 'N/A'} 
                      icon={<Calendar className="text-amber-600" />}
                      subtitle={selectedRecordId ? "Visualizando histórico" : "Mês atual"}
                      color="amber"
                    />
                  </div>
                )}

                {isAdmin && (
                  (() => {
                    const stats = calculateCosts(activeRecord);
                    return (
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Revenue Chart */}
                    <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                        <TrendingUp size={20} className="text-indigo-600" />
                        Evolução Financeira
                      </h3>
                      <div className="h-80 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis 
                              dataKey="name" 
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: '#64748b', fontSize: 12 }}
                            />
                            <YAxis 
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: '#64748b', fontSize: 12 }}
                              tickFormatter={(v) => `R$ ${v/1000}k`}
                            />
                            <Tooltip 
                              cursor={{ fill: '#f8fafc' }}
                              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                              formatter={(value: number) => [formatCurrency(value), '']}
                            />
                            <Bar dataKey="receita" name="Receita" radius={[4, 4, 0, 0]} fill="#4f46e5" />
                            <Bar dataKey="custos" name="Custos" radius={[4, 4, 0, 0]} fill="#f43f5e" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Costs Breakdown */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                      <h3 className="text-lg font-bold mb-6 flex items-center gap-2">
                        <TrendingDown size={20} className="text-rose-600" />
                        Distribuição de Custos
                      </h3>
                      <div className="h-64 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={[
                                { name: 'Diesel', value: stats.diesel, color: '#0f172a' },
                                ...(stats.driver1Days > 0 ? [{ name: 'Motorista 1', value: stats.driver1TotalCost, color: '#16a34a' }] : []),
                                ...(stats.driver2Days > 0 ? [{ name: 'Motorista 2', value: stats.driver2TotalCost, color: '#ca8a04' }] : []),
                                ...(stats.driver1Days === 0 && stats.driver2Days === 0 ? [{ name: 'Motorista', value: stats.driverBase, color: '#16a34a' }] : []),
                                { name: 'Horas Extras', value: stats.overtime, color: '#facc15' },
                                { name: 'Manutenção', value: stats.maintenance, color: '#ea580c' },
                                { name: 'Impostos (Fixo)', value: stats.taxes, color: '#dc2626' },
                                { name: 'Aleatório', value: stats.aleatorioImpact, color: '#f59e0b' },
                                { name: 'Custos Extras', value: stats.extraCosts, color: '#8b5cf6' },
                              ].filter(d => d.value > 0)}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="value"
                            >
                              {[
                                { name: 'Diesel', value: stats.diesel, color: '#0f172a' },
                                ...(stats.driver1Days > 0 ? [{ name: 'Motorista 1', value: stats.driver1TotalCost, color: '#16a34a' }] : []),
                                ...(stats.driver2Days > 0 ? [{ name: 'Motorista 2', value: stats.driver2TotalCost, color: '#ca8a04' }] : []),
                                ...(stats.driver1Days === 0 && stats.driver2Days === 0 ? [{ name: 'Motorista', value: stats.driverBase, color: '#16a34a' }] : []),
                                { name: 'Horas Extras', value: stats.overtime, color: '#facc15' },
                                { name: 'Manutenção', value: stats.maintenance, color: '#ea580c' },
                                { name: 'Impostos (Fixo)', value: stats.taxes, color: '#dc2626' },
                                { name: 'Aleatório', value: stats.aleatorioImpact, color: '#f59e0b' },
                                { name: 'Custos Extras', value: stats.extraCosts, color: '#8b5cf6' },
                              ].filter(d => d.value > 0).map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip 
                              formatter={(value: number) => formatCurrency(value)}
                              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            />
                            <Legend verticalAlign="bottom" height={36}/>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                        <div className="mt-4 space-y-3">
                          <CostItem label="Diesel" value={stats.diesel} color="bg-slate-900" />
                          
                          {stats.driver1Days > 0 && (
                            <CostItem 
                              label={`Motorista 1 (${stats.driver1Days} dias)`} 
                              value={stats.driver1TotalCost} 
                              color="bg-green-600" 
                            />
                          )}
                          
                          {stats.driver2Days > 0 && (
                            <CostItem 
                              label={`Motorista 2 (${stats.driver2Days} dias)`} 
                              value={stats.driver2TotalCost} 
                              color="bg-amber-600" 
                            />
                          )}

                          {stats.driver1Days === 0 && stats.driver2Days === 0 && (
                            <CostItem label="Motorista (Diárias)" value={stats.driverBase} color="bg-green-600" />
                          )}
                          
                          {stats.overtime > 0 && (
                            <CostItem label="Horas Extras" value={stats.overtime} color="bg-yellow-400" />
                          )}
                          
                          <CostItem label="Manutenção" value={stats.maintenance} color="bg-orange-600" />
                          <CostItem label="Impostos (Fixo)" value={stats.taxes} color="bg-red-600" />
                          {stats.aleatorioImpact > 0 && (
                            <CostItem label="Aleatório (Ajuste Rec.)" value={stats.aleatorioImpact} color="bg-amber-500" />
                          )}
                          {stats.extraCosts > 0 && (
                            <CostItem label="Custos Extras" value={stats.extraCosts} color="bg-violet-500" />
                          )}
                        </div>
                    </div>
                  </div>
                );
              })()
            )}

                {/* Recent Services Table */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <h3 className="text-lg font-bold">Serviços do Mês</h3>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-slate-500">{activeRecord.services.length} registros</span>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs uppercase font-bold tracking-wider">
                          <th className="px-6 py-4">Data</th>
                          <th className="px-6 py-4">Tipo</th>
                          <th className="px-6 py-4">Qtd</th>
                          {isAdmin && <th className="px-6 py-4 text-right">Total</th>}
                          <th className="px-6 py-4 text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeRecord.services.map((s) => (
                          <tr key={s.id} className="hover:bg-slate-50 transition-colors group">
                            <td className="px-6 py-4 text-sm font-medium">
                              {s.date ? format(parseISO(s.date), 'dd/MM/yyyy') : 'N/A'}
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide whitespace-nowrap",
                                s.type === 'casada' ? "bg-indigo-100 text-indigo-700" : 
                                s.type === 'normal' ? "bg-cyan-100 text-cyan-700" : 
                                s.type === 'milho' ? "bg-amber-100 text-amber-700" : 
                                s.type === 'boa_vista' ? "bg-emerald-100 text-emerald-700" : 
                                s.type === 'gas' ? "bg-orange-100 text-orange-700" : 
                                s.type === 'aleatorio' ? "bg-pink-100 text-pink-700" :
                                s.type === 'frete_avulso' ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-700"
                              )}>
                                {s.type === 'casada' ? 'Casada' : 
                                 s.type === 'normal' ? 'Normal' : 
                                 s.type === 'milho' ? 'Milho' : 
                                 s.type === 'boa_vista' ? 'Boa Vista' : 
                                 s.type === 'gas' ? 'Gás' : 
                                 s.type === 'frete_avulso' ? 'Frete Avulso' : 
                                 s.type === 'aleatorio' ? 'Aleatório' : 'Cimento'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-600 whitespace-nowrap">
                              {s.quantity} {(s.type === 'milho' || s.type === 'cimento' || s.type === 'aleatorio') ? (s.type === 'milho' ? 'sacas' : 'cargas/sacas') : 'unid.'}
                              {s.containerSize ? (
                                <span className="text-[10px] text-orange-600 block font-bold">
                                  Tam: {s.containerSize}
                                </span>
                              ) : null}
                              {s.gasItems && s.gasItems.length > 0 ? (
                                <div className="mt-1 space-y-0.5">
                                  {s.gasItems.map(item => (
                                    <span key={item.id} className="text-[9px] text-orange-600 block leading-tight">
                                      {item.quantity}x {item.size} ({formatCurrency(item.unitPrice)})
                                    </span>
                                  ))}
                                </div>
                              ) : null}
                              {isAdmin && s.driverPayment ? (
                                <span className="text-[10px] text-indigo-500 block font-bold">
                                  Pagto: {formatCurrency(s.driverPayment)}
                                </span>
                              ) : null}
                              {s.dieselLiters ? (
                                <span className="text-[10px] text-blue-600 block font-bold">
                                  Diesel: {s.dieselLiters}L ({s.dieselLiters / 20} baldes)
                                </span>
                              ) : null}
                              {s.overtimeHours ? (
                                <span className="text-[10px] text-emerald-600 block font-bold">
                                  H. Extra: {s.overtimeHours}h
                                </span>
                              ) : null}
                              {s.observation ? (
                                <span className="text-[10px] text-slate-500 block italic mt-1 bg-slate-50 p-1.5 rounded border border-slate-100 whitespace-normal break-words max-w-[200px]">
                                  Obs: {s.observation}
                                </span>
                              ) : null}
                            </td>
                            {isAdmin && (
                              <td className="px-6 py-4 text-sm font-bold whitespace-nowrap text-slate-900 border-l border-slate-50">
                                {formatCurrency(getServiceRevenue(s))}
                                {((s.type === 'milho' || s.type === 'cimento' || s.type === 'frete_avulso' || s.type === 'aleatorio' || (s.type === 'gas' && !s.gasItems)) && s.unitPrice) ? (
                                  <span className="text-[10px] text-slate-400 block font-normal">
                                    ({formatCurrency(s.unitPrice)}/unid)
                                  </span>
                                ) : null}
                              </td>
                            )}
                            <td className="px-6 py-4 text-right border-l border-slate-50">
                              <div className="flex items-center justify-end gap-1">
                                {isAdmin && (
                                  <>
                                    <button 
                                      onClick={() => handleEditService(activeRecord.id, s)}
                                      className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all active:scale-95"
                                      title="Editar Registro"
                                    >
                                      <Pencil size={18} />
                                    </button>
                                    <button 
                                      onClick={() => handleDeleteService(activeRecord.id, s.id)}
                                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-all active:scale-95"
                                      title="Excluir Registro"
                                    >
                                      <Trash2 size={18} />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-white p-12 rounded-2xl border border-dashed border-slate-300 flex flex-col items-center justify-center text-center space-y-4">
                <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                  <Calendar size={32} />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Nenhum registro mensal</h3>
                  <p className="text-slate-500 max-w-xs mx-auto">Comece adicionando os dados do primeiro mês para visualizar o dashboard.</p>
                </div>
                <button 
                  onClick={() => setShowRecordModal(true)}
                  className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-medium"
                >
                  Adicionar Primeiro Mês
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <header>
              <h2 className="text-2xl font-bold text-slate-900">Histórico Mensal</h2>
              <p className="text-slate-500">Todos os registros salvos para {selectedVehicle?.name}</p>
            </header>

            <div className="space-y-4">
              {vehicleRecords.map(record => (
                <div key={record.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600">
                      <Calendar size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-lg">
                        {record.year && record.month !== undefined ? format(new Date(record.year, record.month), 'MMMM yyyy', { locale: ptBR }) : 'Data Inválida'}
                      </h4>
                      <p className="text-sm text-slate-500">{record.services?.length || 0} serviços realizados</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-8">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Receita</p>
                      <p className="font-bold text-emerald-600">{formatCurrency(calculateRevenue(record))}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Custos</p>
                      <p className="font-bold text-rose-600">{formatCurrency(calculateCosts(record).total)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Lucro</p>
                      <p className="font-bold text-indigo-600">{formatCurrency(calculateRevenue(record) - calculateCosts(record).total)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setRecordToDelete(record.id)}
                      className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={20} />
                    </button>
                    <button 
                      onClick={() => {
                        setSelectedRecordId(record.id);
                        setActiveTab('dashboard');
                      }}
                      className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                    >
                      <ChevronRight size={20} />
                    </button>
                  </div>
                </div>
              ))}

              {vehicleRecords.length === 0 && (
                <div className="text-center py-12 text-slate-500 bg-white rounded-2xl border border-slate-200">
                  Nenhum registro encontrado.
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'vehicles' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <header className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Veículos</h2>
                <p className="text-slate-500">Gerencie sua frota de caminhões</p>
              </div>
              <button 
                onClick={() => setShowNewVehicleModal(true)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-medium flex items-center gap-2"
              >
                <Plus size={20} />
                Novo Veículo
              </button>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {vehicles.map(v => (
                <div 
                  key={v.id} 
                  className={cn(
                    "p-6 rounded-2xl border transition-all cursor-pointer overflow-hidden relative group",
                    selectedVehicleId === v.id ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-200" : "bg-white border-slate-200 hover:border-indigo-300"
                  )}
                  onClick={() => setSelectedVehicleId(v.id)}
                >
                  {v.photoUrl && (
                    <div className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity">
                      <img src={v.photoUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                  )}
                  <div className="relative z-10">
                    <div className="flex items-start justify-between mb-4">
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden",
                        selectedVehicleId === v.id ? "bg-white/20" : "bg-indigo-50 text-indigo-600"
                      )}>
                        {v.photoUrl ? (
                          <img src={v.photoUrl} alt={v.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <Truck size={24} />
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedVehicleId === v.id && (
                          <span className="bg-white/20 text-white text-[10px] font-bold uppercase px-2 py-1 rounded">Ativo</span>
                        )}
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingVehicleId(v.id);
                            setShowNewVehicleModal(true);
                          }}
                          className={cn(
                            "p-1.5 rounded-lg transition-colors",
                            selectedVehicleId === v.id ? "hover:bg-white/10 text-white" : "hover:bg-slate-100 text-slate-400"
                          )}
                        >
                          <Edit2 size={16} />
                        </button>
                      </div>
                    </div>
                    <h4 className="font-bold text-lg">{v.name}</h4>
                    <p className={cn("text-sm", selectedVehicleId === v.id ? "text-indigo-100" : "text-slate-500")}>
                      Placa: {v.plate || 'Não informada'}
                    </p>
                    <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                      <span className="text-xs font-medium">
                        {records.filter(r => r.vehicleId === v.id).length} meses registrados
                      </span>
                      <ChevronRight size={16} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'settings' && isAdmin && (
          <div className="max-w-2xl mx-auto space-y-8">
            <header>
              <h2 className="text-2xl font-bold text-slate-900">Configurações da Empresa</h2>
              <p className="text-slate-500">Gerencie os dados que aparecem nos recibos e no sistema.</p>
            </header>

            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-8 space-y-8">
              <div className="flex justify-center">
                <div className="relative group">
                  <div className="w-32 h-32 rounded-2xl bg-slate-100 border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden transition-all group-hover:border-indigo-300">
                    {settings.logoUrl ? (
                      <img src={settings.logoUrl} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="text-center p-4">
                        <Camera size={32} className="mx-auto text-slate-300 mb-2" />
                        <p className="text-[10px] font-bold text-slate-400 uppercase">Logo da Empresa</p>
                      </div>
                    )}
                  </div>
                  <label className="absolute -bottom-2 -right-2 w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg cursor-pointer hover:bg-indigo-700 transition-colors">
                    <Upload size={20} />
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            const img = new Image();
                            img.onload = () => {
                              const canvas = document.createElement('canvas');
                              const MAX_SIZE = 400;
                              let width = img.width;
                              let height = img.height;

                              if (width > height) {
                                if (width > MAX_SIZE) {
                                  height *= MAX_SIZE / width;
                                  width = MAX_SIZE;
                                }
                              } else {
                                if (height > MAX_SIZE) {
                                  width *= MAX_SIZE / height;
                                  height = MAX_SIZE;
                                }
                              }

                              canvas.width = width;
                              canvas.height = height;
                              const ctx = canvas.getContext('2d');
                              ctx?.drawImage(img, 0, 0, width, height);
                              const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                              setSettings({ ...settings, logoUrl: dataUrl });
                            };
                            img.src = reader.result as string;
                          };
                          reader.readAsDataURL(file);
                        }
                      }} 
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6">
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Nome da Empresa / App</label>
                  <input 
                    type="text" 
                    value={settings.name}
                    onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">CNPJ</label>
                  <input 
                    type="text" 
                    placeholder="00.000.000/0000-00"
                    value={settings.cnpj}
                    onChange={(e) => setSettings({ ...settings, cnpj: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700">Endereço Completo</label>
                  <input 
                    type="text" 
                    placeholder="Rua, Número, Bairro, Cidade - UF"
                    value={settings.address}
                    onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">Telefone</label>
                    <input 
                      type="text" 
                      placeholder="(00) 00000-0000"
                      value={settings.phone}
                      onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-bold text-slate-700">E-mail</label>
                    <input 
                      type="email" 
                      placeholder="contato@empresa.com"
                      value={settings.email}
                      onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                </div>
              </div>
              
              <div className="pt-4 border-t border-slate-100 flex justify-end">
                <button 
                  onClick={() => handleUpdateSettings(settings)}
                  className="px-8 py-2.5 rounded-xl font-medium bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200"
                >
                  Salvar Configurações
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      {showRecordModal && (
        <RecordModal 
          vehicleId={selectedVehicleId} 
          vehicles={vehicles}
          record={editingRecordId ? records.find(r => r.id === editingRecordId) : undefined}
          onClose={() => {
            setShowRecordModal(false);
            setEditingRecordId(null);
          }} 
          onSubmit={(data) => editingRecordId ? handleUpdateRecord(editingRecordId, data) : handleAddRecord(data)}
        />
      )}

      {showNewVehicleModal && (
        <NewVehicleModal 
          vehicle={editingVehicleId ? vehicles.find(v => v.id === editingVehicleId) : undefined}
          onClose={() => {
            setShowNewVehicleModal(false);
            setEditingVehicleId(null);
          }} 
          onSubmit={editingVehicleId ? (name, plate, photoUrl) => handleUpdateVehicle(editingVehicleId, name, plate, photoUrl) : handleAddVehicle}
        />
      )}

      {recordToDelete && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 text-center">
            <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Trash2 size={32} />
            </div>
            <h2 className="text-xl font-bold mb-2">Excluir Registro?</h2>
            <p className="text-slate-500 mb-8">Esta ação não pode ser desfeita. Deseja continuar?</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setRecordToDelete(null)}
                className="flex-1 px-4 py-2.5 rounded-xl font-medium text-slate-600 hover:bg-slate-50 border border-slate-200"
              >
                Cancelar
              </button>
              <button 
                onClick={() => handleDeleteRecord(recordToDelete)}
                className="flex-1 px-4 py-2.5 rounded-xl font-medium bg-rose-600 text-white hover:bg-rose-700"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}

function StatCard({ title, value, icon, subtitle, color }: { 
  title: string; 
  value: string; 
  icon: React.ReactNode; 
  subtitle: string;
  color: 'emerald' | 'rose' | 'indigo' | 'amber';
}) {
  const colors = {
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    indigo: "bg-indigo-50 text-indigo-600",
    amber: "bg-amber-50 text-amber-600",
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", colors[color])}>
          {icon}
        </div>
      </div>
      <h3 className="text-sm font-medium text-slate-500 mb-1">{title}</h3>
      <p className="text-2xl font-bold text-slate-900 mb-1">{value}</p>
      <p className="text-xs text-slate-400 flex items-center gap-1">
        <Info size={12} />
        {subtitle}
      </p>
    </div>
  );
}

function CostItem({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className={cn("w-2 h-2 rounded-full", color)} />
        <span className="text-sm text-slate-600">{label}</span>
      </div>
      <span className="text-sm font-bold">{formatCurrency(value)}</span>
    </div>
  );
}

function GasItemsModal({ items, onSave, onClose }: { 
  items: GasItem[]; 
  onSave: (items: GasItem[]) => void; 
  onClose: () => void;
}) {
  const [localItems, setLocalItems] = useState<GasItem[]>(items.length > 0 ? items : [
    { id: '1', size: '20kg', quantity: 0, unitPrice: 0 },
    { id: '2', size: '13kg', quantity: 0, unitPrice: 0 },
    { id: '3', size: '10kg', quantity: 0, unitPrice: 0 },
    { id: '4', size: '8kg', quantity: 0, unitPrice: 0 },
    { id: '5', size: '5kg', quantity: 0, unitPrice: 0 },
  ]);

  const updateItem = (id: string, field: keyof GasItem, value: any) => {
    setLocalItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const total = localItems.reduce((acc, item) => acc + (item.quantity * item.unitPrice), 0);

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden text-slate-900">
        <div className="p-6 border-b border-slate-100 flex justify-between items-center">
          <h3 className="font-bold text-lg text-slate-900">Detalhar Vasilhames de Gás</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
          {localItems.map(item => (
            <div key={item.id} className="grid grid-cols-3 gap-3 items-end">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Tamanho</label>
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700">
                  {item.size}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Qtd</label>
                <input 
                  type="number"
                  value={item.quantity || ''}
                  placeholder="0"
                  onChange={(e) => updateItem(item.id, 'quantity', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">R$ / Unid</label>
                <input 
                  type="number"
                  value={item.unitPrice || ''}
                  placeholder="0.00"
                  onChange={(e) => updateItem(item.id, 'unitPrice', e.target.value === '' ? 0 : parseFloat(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500 font-bold uppercase">Total da Carga</p>
            <p className="text-xl font-black text-indigo-600">{formatCurrency(total)}</p>
          </div>
          <button 
            onClick={() => onSave(localItems.filter(i => i.quantity > 0))}
            className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickAddService({ vehicles, selectedVehicleId, onAdd, isDriver, editingService, onEdit, onCancel }: { 
  vehicles: Vehicle[];
  selectedVehicleId: string;
  onAdd: (s: Omit<ServiceEntry, 'id'>) => void;
  isDriver?: boolean;
  editingService?: ServiceEntry | null;
  onEdit?: (s: Omit<ServiceEntry, 'id'>) => void;
  onCancel?: () => void;
}) {
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [type, setType] = useState<ServiceType>('normal');
  const [qty, setQty] = useState<string>('1');
  const [unitPrice, setUnitPrice] = useState<string>('0');
  const [driverPayment, setDriverPayment] = useState<string>('');
  const [containerSize, setContainerSize] = useState<string>('13kg');
  const [gasItems, setGasItems] = useState<GasItem[]>([]);
  const [showGasModal, setShowGasModal] = useState(false);
  const [helperCost, setHelperCost] = useState<string>('140'); 
  const [lunchCost, setLunchCost] = useState<string>('60');
  const [portCost, setPortCost] = useState<string>('0');
  const [dieselBuckets, setDieselBuckets] = useState<string>('0');
  const [overtimeHours, setOvertimeHours] = useState<string>('0');
  const [driverId, setDriverId] = useState<1 | 2>(1);
  const [agentCommission, setAgentCommission] = useState<string>('0');
  const [observation, setObservation] = useState<string>('');

  useEffect(() => {
    if (editingService) {
      setDate(editingService.date);
      setType(editingService.type);
      setQty(editingService.quantity.toString());
      setUnitPrice(editingService.unitPrice?.toString() || '0');
      setDriverPayment(editingService.driverPayment && editingService.driverPayment !== 0 ? editingService.driverPayment.toString() : '');
      setContainerSize(editingService.containerSize || '13kg');
      setGasItems(editingService.gasItems || []);
      setHelperCost(editingService.helperCost?.toString() || '140');
      setLunchCost(editingService.lunchCost?.toString() || '60');
      setPortCost(editingService.portCost?.toString() || '0');
      setDieselBuckets(editingService.dieselLiters ? (editingService.dieselLiters / 20).toString() : '0');
      setOvertimeHours(editingService.overtimeHours?.toString() || '0');
      setDriverId(editingService.driverId || 1);
      setAgentCommission(editingService.agentCommission?.toString() || '0');
      setObservation(editingService.observation || '');
    } else {
      setDate(format(new Date(), 'yyyy-MM-dd'));
      setType('normal');
      setQty('1');
      setUnitPrice('0');
      setDriverPayment('');
      setAgentCommission('0');
      setObservation('');
      setGasItems([]);
      setDieselBuckets('0');
      setOvertimeHours('0');
    }
  }, [editingService, selectedVehicleId]);

  const handleAdd = () => {
    const totalQty = type === 'gas' && gasItems.length > 0 
      ? gasItems.reduce((acc, i) => acc + i.quantity, 0)
      : parseFloat(qty) || 0;

    const isAtego = vehicles.find(v => v.id === selectedVehicleId)?.name.includes('Atego 2425');
    const isConstellation = vehicles.find(v => v.id === selectedVehicleId)?.name.includes('Constellation 30280');

    const serviceData: Omit<ServiceEntry, 'id'> = { 
      date, 
      type, 
      quantity: totalQty, 
      unitPrice: (type === 'milho' || type === 'cimento' || type === 'frete_avulso' || type === 'aleatorio' || (type === 'gas' && gasItems.length === 0)) ? (parseFloat(unitPrice) || 0) : undefined,
      driverPayment: (type === 'boa_vista' || type === 'gas' || isConstellation || type === 'milho' || type === 'cimento' || type === 'aleatorio' || type === 'frete_avulso') ? (parseFloat(driverPayment) || 0) : undefined,
      containerSize: (type === 'gas' && gasItems.length === 0) ? containerSize : undefined,
      gasItems: type === 'gas' && gasItems.length > 0 ? gasItems : undefined,
      helperCost: isAtego ? (parseFloat(helperCost) || 0) : 0,
      lunchCost: isAtego ? (parseFloat(lunchCost) || 0) : 0,
      portCost: isAtego ? (parseFloat(portCost) || 0) : 0,
      dieselLiters: (parseFloat(dieselBuckets) || 0) * 20,
      overtimeHours: parseFloat(overtimeHours) || 0,
      driverId,
      agentCommission: type === 'milho' ? (parseFloat(agentCommission) || 0) : undefined,
      observation: observation.trim() || undefined
    };

    if (editingService && onEdit) {
      onEdit(serviceData);
    } else {
      onAdd(serviceData);
      setGasItems([]);
      setDieselBuckets('0');
      setOvertimeHours('0');
      setAgentCommission('0');
      setDriverPayment('');
      setObservation('');
    }
  };

  return (
    <div className="bg-indigo-900 text-white p-4 rounded-2xl shadow-lg flex flex-col items-center gap-4">
      <div className="flex flex-col md:flex-row items-center gap-4 w-full">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
            <Plus size={20} />
          </div>
          <div>
            <p className="text-xs font-bold text-indigo-200 uppercase tracking-wider">Lançamento Rápido</p>
            <p className="text-sm font-medium">Adicionar carga hoje</p>
          </div>
        </div>
        
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-4 lg:grid-cols-5 gap-3 w-full">
          <input 
            type="date" 
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all"
          />
          <select 
            value={type}
            onChange={(e) => setType(e.target.value as ServiceType)}
            className="bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all"
          >
            <option value="casada" className="text-slate-900">Casada</option>
            <option value="normal" className="text-slate-900">Normal</option>
            <option value="milho" className="text-slate-900">Milho</option>
            <option value="cimento" className="text-slate-900">Cimento</option>
            <option value="boa_vista" className="text-slate-900">Boa Vista</option>
            <option value="gas" className="text-slate-900">Gás</option>
            <option value="frete_avulso" className="text-slate-900">Frete Avulso</option>
            <option value="aleatorio" className="text-slate-900">Aleatório</option>
          </select>
          {type === 'gas' && (
            <div className="flex gap-2">
              <select 
                value={containerSize}
                onChange={(e) => setContainerSize(e.target.value)}
                className="bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all"
              >
                <option value="20kg" className="text-slate-900">20kg</option>
                <option value="13kg" className="text-slate-900">13kg</option>
                <option value="10kg" className="text-slate-900">10kg</option>
                <option value="8kg" className="text-slate-900">8kg</option>
                <option value="5kg" className="text-slate-900">5kg</option>
              </select>
              <button 
                onClick={() => setShowGasModal(true)}
                className={cn(
                  "px-4 py-2 rounded-xl text-xs font-bold uppercase transition-all whitespace-nowrap",
                  gasItems.length > 0 ? "bg-emerald-500 text-white" : "bg-white/10 text-indigo-200 hover:bg-white/20"
                )}
              >
                {gasItems.length > 0 ? `${gasItems.length} Tamanhos` : 'Vários Tamanhos'}
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input 
              type="number" 
              placeholder={(type === 'milho' || type === 'cimento' || type === 'gas' || type === 'frete_avulso' || type === 'aleatorio') ? "Sacas/Qtd" : "Qtd"}
              value={type === 'gas' && gasItems.length > 0 ? gasItems.reduce((acc, i) => acc + i.quantity, 0).toString() : qty}
              disabled={type === 'gas' && gasItems.length > 0}
              onChange={(e) => setQty(e.target.value)}
              className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all disabled:opacity-50"
            />
            {(!isDriver && (type === 'milho' || type === 'cimento' || type === 'frete_avulso' || type === 'aleatorio' || (type === 'gas' && gasItems.length === 0))) && (
              <input 
                type="number" 
                placeholder="R$ / Unid"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all"
              />
            )}
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-indigo-200 font-bold uppercase mb-1">Motorista</label>
            <div className="flex bg-white/10 border border-white/20 rounded-xl p-0.5">
              <button
                onClick={() => setDriverId(1)}
                className={cn(
                  "flex-1 py-1 text-[10px] font-bold uppercase rounded-lg transition-all",
                  driverId === 1 ? "bg-white text-indigo-900 shadow-sm" : "text-indigo-200 hover:bg-white/10"
                )}
              >
                Mot 1
              </button>
              <button
                onClick={() => setDriverId(2)}
                className={cn(
                  "flex-1 py-1 text-[10px] font-bold uppercase rounded-lg transition-all",
                  driverId === 2 ? "bg-white text-indigo-900 shadow-sm" : "text-indigo-200 hover:bg-white/10"
                )}
              >
                Mot 2
              </button>
            </div>
          </div>

          {vehicles.find(v => v.id === selectedVehicleId)?.name.includes('Constellation 30280') && (
            <div className="flex flex-col flex-1">
              <label className="text-[10px] text-indigo-200 font-bold uppercase mb-1">Pagamento Mot.</label>
              <input 
                type="number" 
                placeholder="R$ Diária"
                value={driverPayment}
                onChange={(e) => setDriverPayment(e.target.value)}
                className="bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all text-white placeholder:text-white/30 w-24"
              />
            </div>
          )}
        </div>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 w-full border-t border-white/10 pt-3">
        {(type === 'boa_vista' || type === 'gas') && (
          <div className="flex flex-col">
            <label className="text-[10px] text-indigo-200 font-bold uppercase mb-1">Pagto Motorista</label>
            <input 
              type="number" 
              placeholder="Pagto Motorista"
              value={driverPayment}
              onChange={(e) => setDriverPayment(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all"
            />
          </div>
        )}
        {(!isDriver && type === 'milho') && (
          <div className="flex flex-col">
            <label className="text-[10px] text-indigo-200 font-bold uppercase mb-1">Comissão Agenc. (R$)</label>
            <input 
              type="number" 
              placeholder="R$"
              value={agentCommission}
              onChange={(e) => setAgentCommission(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all"
            />
          </div>
        )}
        <div className="flex flex-col">
          <label className="text-[10px] text-indigo-200 font-bold uppercase mb-1">Diesel (Baldes)</label>
          <input 
            type="number" 
            placeholder="Baldes"
            value={dieselBuckets}
            onChange={(e) => setDieselBuckets(e.target.value)}
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-[10px] text-indigo-200 font-bold uppercase mb-1">Horas Extras</label>
          <input 
            type="number" 
            placeholder="Horas"
            value={overtimeHours}
            onChange={(e) => setOvertimeHours(e.target.value)}
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all"
          />
        </div>
        <div className="flex flex-col sm:col-span-1 md:col-span-2">
          <label className="text-[10px] text-indigo-200 font-bold uppercase mb-1">Observação</label>
          <input 
            type="text" 
            placeholder="Nota opcional..."
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
            className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all font-medium placeholder:text-white/30"
          />
        </div>
        <div className="flex items-end gap-2">
          {editingService && (
            <button 
              onClick={onCancel}
              className="px-4 bg-white/10 hover:bg-white/20 text-white font-bold text-sm h-[38px] rounded-xl transition-colors"
            >
              Cancelar
            </button>
          )}
          <button 
            onClick={handleAdd}
            className={cn(
              "flex-1 md:w-auto font-bold text-sm h-[38px] px-6 rounded-xl transition-all flex items-center justify-center gap-2",
              editingService ? "bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/20" : "bg-white text-indigo-900 hover:bg-indigo-50 transition-colors"
            )}
          >
            {editingService ? (
              <>
                <Pencil size={16} />
                Salvar
              </>
            ) : 'Lançar'}
          </button>
        </div>
      </div>

      {/* Extra costs for Atego 2425 */}
      {vehicles.find(v => v.id === selectedVehicleId)?.name.includes('Atego 2425') && (
        <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3 pt-3 border-t border-white/10">
          <div className="flex flex-col">
            <label className="text-[10px] text-indigo-200 font-bold uppercase mb-1">Ajudantes (R$)</label>
            <input 
              type="number" 
              value={helperCost}
              onChange={(e) => setHelperCost(e.target.value)}
              className="bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-indigo-200 font-bold uppercase mb-1">Almoço (R$)</label>
            <input 
              type="number" 
              value={lunchCost}
              onChange={(e) => setLunchCost(e.target.value)}
              className="bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-[10px] text-indigo-200 font-bold uppercase mb-1">Porto (R$)</label>
            <input 
              type="number" 
              value={portCost}
              onChange={(e) => setPortCost(e.target.value)}
              className="bg-white/10 border border-white/20 rounded-xl px-4 py-2 text-sm outline-none focus:bg-white/20 transition-all"
            />
          </div>
        </div>
      )}

      {showGasModal && (
        <GasItemsModal 
          items={gasItems}
          onSave={(items) => {
            setGasItems(items);
            setShowGasModal(false);
          }}
          onClose={() => setShowGasModal(false)}
        />
      )}
    </div>
  );
}

function RecordModal({ vehicleId, vehicles, record, onClose, onSubmit }: { 
  vehicleId: string; 
  vehicles: Vehicle[];
  record?: MonthRecord;
  onClose: () => void; 
  onSubmit: (record: Omit<MonthRecord, 'id'>) => void 
}) {
  const [month, setMonth] = useState(record?.month ?? new Date().getMonth());
  const [year, setYear] = useState(record?.year ?? new Date().getFullYear());
  
  // Costs
  const [dieselLiters, setDieselLiters] = useState(record?.costs.dieselLiters ?? 0);
  const [dieselPrice, setDieselPrice] = useState(record?.costs.dieselPrice === 5.50 ? DEFAULT_DIESEL_PRICE : (record?.costs.dieselPrice ?? DEFAULT_DIESEL_PRICE));
  const [driverDays, setDriverDays] = useState(record?.costs.driverDays ?? 0);
  const [driverDailyRate, setDriverDailyRate] = useState(record?.costs.driverDailyRate ?? 120);
  const [taxRate, setTaxRate] = useState(record?.costs.taxRate ?? 5);
  const [maintenanceParts, setMaintenanceParts] = useState(record?.costs.maintenanceParts ?? 0);
  const [maintenanceLabor, setMaintenanceLabor] = useState(record?.costs.maintenanceLabor ?? 0);
  const [overtimeHours, setOvertimeHours] = useState(record?.costs.overtimeHours ?? 0);
  const [overtimeRate, setOvertimeRate] = useState(record?.costs.overtimeRate ?? 0);

  // Client Info
  const [clientName, setClientName] = useState(record?.client?.name ?? '');
  const [clientCnpj, setClientCnpj] = useState(record?.client?.cnpj ?? '');
  const [clientContact, setClientContact] = useState(record?.client?.contactName ?? '');
  const [clientPhone, setClientPhone] = useState(record?.client?.phone ?? '');
  const [clientAddress, setClientAddress] = useState(record?.client?.address ?? '');
  const [clientEmail, setClientEmail] = useState(record?.client?.email ?? '');

  const fillDefaultData = () => {
    setDieselLiters(550);
    setDieselPrice(DEFAULT_DIESEL_PRICE);
    setDriverDailyRate(120);
    setTaxRate(5);
    setMaintenanceParts(1800);
    setMaintenanceLabor(800);
    setOvertimeRate(15);
  };

  // Services
  const [services, setServices] = useState<ServiceEntry[]>(record?.services ?? []);
  const [newServiceDate, setNewServiceDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [newServiceType, setNewServiceType] = useState<ServiceType>('normal');
  const [newServiceQty, setNewServiceQty] = useState<string>('1');
  const [newServiceUnitPrice, setNewServiceUnitPrice] = useState<string>('0');
  const [newServiceDriverPayment, setNewServiceDriverPayment] = useState<string>('0');
  const [newServiceContainerSize, setNewServiceContainerSize] = useState<string>('13kg');
  const [newServiceGasItems, setNewServiceGasItems] = useState<GasItem[]>([]);
  const [showNewServiceGasModal, setShowNewServiceGasModal] = useState(false);
  const [newServiceHelperCost, setNewServiceHelperCost] = useState<string>('140');
  const [newServiceLunchCost, setNewServiceLunchCost] = useState<string>('60');
  const [newServicePortCost, setNewServicePortCost] = useState<string>('0');
  const [newServiceDieselBuckets, setNewServiceDieselBuckets] = useState<string>('0');
  const [newServiceOvertimeHours, setNewServiceOvertimeHours] = useState<string>('0');
  const [newServiceDriverId, setNewServiceDriverId] = useState<1 | 2>(1);
  const [newServiceAgentCommission, setNewServiceAgentCommission] = useState<string>('0');

  const addService = () => {
    const totalQty = newServiceType === 'gas' && newServiceGasItems.length > 0
      ? newServiceGasItems.reduce((acc, i) => acc + i.quantity, 0)
      : parseFloat(newServiceQty) || 0;

    const isAtego = vehicles.find(v => v.id === record?.vehicleId || v.id === vehicleId)?.name.includes('Atego 2425');

    const addedDiesel = (parseFloat(newServiceDieselBuckets) || 0) * 20;
    const addedOvertime = parseFloat(newServiceOvertimeHours) || 0;

    const isConstellation = vehicles.find(v => v.id === record?.vehicleId)?.name.includes('Constellation 30280');

    const newService: ServiceEntry = {
      id: crypto.randomUUID(),
      date: newServiceDate,
      type: newServiceType,
      quantity: totalQty,
      unitPrice: (newServiceType === 'milho' || newServiceType === 'cimento' || newServiceType === 'frete_avulso' || (newServiceType === 'gas' && newServiceGasItems.length === 0)) ? (parseFloat(newServiceUnitPrice) || 0) : undefined,
      driverPayment: (newServiceType === 'boa_vista' || newServiceType === 'gas' || isConstellation) ? (parseFloat(newServiceDriverPayment) || 0) : undefined,
      containerSize: (newServiceType === 'gas' && newServiceGasItems.length === 0) ? newServiceContainerSize : undefined,
      gasItems: newServiceType === 'gas' && newServiceGasItems.length > 0 ? newServiceGasItems : undefined,
      helperCost: isAtego ? (parseFloat(newServiceHelperCost) || 0) : 0,
      lunchCost: isAtego ? (parseFloat(newServiceLunchCost) || 0) : 0,
      portCost: isAtego ? (parseFloat(newServicePortCost) || 0) : 0,
      dieselLiters: addedDiesel,
      overtimeHours: addedOvertime,
      driverId: newServiceDriverId,
      agentCommission: newServiceType === 'milho' ? (parseFloat(newServiceAgentCommission) || 0) : undefined
    };
    const updatedServices = [...services, newService].sort((a, b) => a.date.localeCompare(b.date));
    setServices(updatedServices);
    setNewServiceQty('1');
    setNewServiceUnitPrice('0');
    setNewServiceGasItems([]);
    setNewServiceDieselBuckets('0');
    setNewServiceOvertimeHours('0');
    setNewServiceAgentCommission('0');
    setNewServiceDriverPayment('0');
    
    // Auto-calculate driver days based on unique dates (excluding per-trip services)
    const nonTripDates = new Set(updatedServices.filter(s => s.type !== 'boa_vista' && s.type !== 'gas').map(s => s.date));
    setDriverDays(nonTripDates.size);

    // Update totals from services
    setDieselLiters(updatedServices.reduce((acc, s) => acc + (s.dieselLiters || 0), 0));
    setOvertimeHours(updatedServices.reduce((acc, s) => acc + (s.overtimeHours || 0), 0));
  };

  const removeService = (id: string) => {
    const updatedServices = services.filter(s => s.id !== id);
    setServices(updatedServices);
    
    // Auto-calculate driver days based on unique dates (excluding per-trip services)
    const nonTripDates = new Set(updatedServices.filter(s => s.type !== 'boa_vista' && s.type !== 'gas').map(s => s.date));
    setDriverDays(nonTripDates.size);

    // Update totals from services
    setDieselLiters(updatedServices.reduce((acc, s) => acc + (s.dieselLiters || 0), 0));
    setOvertimeHours(updatedServices.reduce((acc, s) => acc + (s.overtimeHours || 0), 0));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      vehicleId,
      month,
      year,
      services,
      costs: {
        dieselLiters,
        dieselPrice,
        driverDays,
        driverDailyRate,
        taxRate,
        maintenanceParts,
        maintenanceLabor,
        overtimeHours,
        overtimeRate
      },
      client: clientName ? {
        name: clientName,
        cnpj: clientCnpj,
        contactName: clientContact,
        phone: clientPhone,
        address: clientAddress,
        email: clientEmail
      } : undefined
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl text-slate-900">
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-slate-900">{record ? 'Editar Registro Mensal' : 'Novo Registro Mensal'}</h2>
              <p className="text-slate-500 text-sm">Preencha os dados de frete e custos</p>
            </div>
            <div className="flex items-center gap-3">
              <button 
                type="button"
                onClick={fillDefaultData}
                className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-2 rounded-lg hover:bg-indigo-100 transition-colors"
              >
                Preencher Padrão
              </button>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                <Plus className="rotate-45" size={24} />
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Mês</label>
                <select 
                  value={month} 
                  onChange={(e) => setMonth(parseInt(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                >
                  {Array.from({ length: 12 }).map((_, i) => (
                    <option key={i} value={i}>{format(new Date(2024, i), 'MMMM', { locale: ptBR })}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Ano</label>
                <input 
                  type="number" 
                  value={year} 
                  onChange={(e) => setYear(parseInt(e.target.value))}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
                />
              </div>
            </div>
            
            {/* Client Info Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Building2 size={20} className="text-indigo-600" />
                Dados do Cliente (Opcional)
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase">Nome da Empresa</label>
                  <input 
                    type="text" 
                    value={clientName} 
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Ex: Transportadora XYZ"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase">CNPJ</label>
                  <input 
                    type="text" 
                    value={clientCnpj} 
                    onChange={(e) => setClientCnpj(e.target.value)}
                    placeholder="00.000.000/0000-00"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase">Nome do Contato</label>
                  <input 
                    type="text" 
                    value={clientContact} 
                    onChange={(e) => setClientContact(e.target.value)}
                    placeholder="Nome do responsável"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase">Telefone</label>
                  <input 
                    type="text" 
                    value={clientPhone} 
                    onChange={(e) => setClientPhone(e.target.value)}
                    placeholder="(00) 00000-0000"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase">E-mail</label>
                  <input 
                    type="email" 
                    value={clientEmail} 
                    onChange={(e) => setClientEmail(e.target.value)}
                    placeholder="cliente@email.com"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="space-y-1.5 lg:col-span-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Endereço</label>
                  <input 
                    type="text" 
                    value={clientAddress} 
                    onChange={(e) => setClientAddress(e.target.value)}
                    placeholder="Rua, Número, Bairro, Cidade"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Costs Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <TrendingDown size={20} className="text-rose-600" />
                Custos do Mês
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <InputGroup label="Diesel (Litros)" value={dieselLiters} onChange={setDieselLiters} />
                <InputGroup label="Preço Diesel (R$)" value={dieselPrice} onChange={setDieselPrice} step={0.01} />
                <InputGroup label="Diárias Motorista" value={driverDays} onChange={setDriverDays} />
                <InputGroup label="Valor Diária (R$)" value={driverDailyRate} onChange={setDriverDailyRate} />
                <InputGroup label="Imposto (%)" value={taxRate} onChange={setTaxRate} />
                <InputGroup label="Manutenção Peças (R$)" value={maintenanceParts} onChange={setMaintenanceParts} />
                <InputGroup label="Manutenção Mão de Obra (R$)" value={maintenanceLabor} onChange={setMaintenanceLabor} />
                <InputGroup label="Horas Extras" value={overtimeHours} onChange={setOvertimeHours} />
                <InputGroup label="Valor Hora Extra (R$)" value={overtimeRate} onChange={setOvertimeRate} step={0.01} />
              </div>
            </div>

            {/* Services Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <TrendingUp size={20} className="text-emerald-600" />
                Serviços Realizados
              </h3>
              
              <div className="bg-slate-50 p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-end">
                <div className="flex-1 space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Data</label>
                  <input 
                    type="date" 
                    value={newServiceDate} 
                    onChange={(e) => setNewServiceDate(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div className="flex-1 space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Tipo</label>
                    <select 
                      value={newServiceType} 
                      onChange={(e) => setNewServiceType(e.target.value as ServiceType)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900"
                    >
                      <option value="casada">Casada (R$ 800)</option>
                      <option value="normal">Normal (R$ 450)</option>
                      <option value="milho">Milho (Manual)</option>
                      <option value="cimento">Cimento (Manual)</option>
                      <option value="boa_vista">Boa Vista (R$ 11.000)</option>
                      <option value="gas">Gás (Manual)</option>
                      <option value="frete_avulso">Frete Avulso (Manual)</option>
                    </select>
                </div>
                <div className="w-24 space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">Motorista</label>
                  <div className="flex bg-slate-100 border border-slate-200 rounded-xl p-0.5">
                    <button
                      type="button"
                      onClick={() => setNewServiceDriverId(1)}
                      className={cn(
                        "flex-1 py-1 text-[10px] font-bold uppercase rounded-lg transition-all",
                        newServiceDriverId === 1 ? "bg-white text-indigo-900 shadow-sm" : "text-slate-500 hover:bg-slate-200"
                      )}
                    >
                      1
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewServiceDriverId(2)}
                      className={cn(
                        "flex-1 py-1 text-[10px] font-bold uppercase rounded-lg transition-all",
                        newServiceDriverId === 2 ? "bg-white text-indigo-900 shadow-sm" : "text-slate-500 hover:bg-slate-200"
                      )}
                    >
                      2
                    </button>
                  </div>
                </div>
                {newServiceType === 'milho' && (
                  <div className="flex-1 space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Comissão Agenc.</label>
                    <input 
                      type="number" 
                      value={newServiceAgentCommission} 
                      onChange={(e) => setNewServiceAgentCommission(e.target.value)}
                      placeholder="R$"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900"
                    />
                  </div>
                )}
                {newServiceType === 'gas' && (
                  <div className="flex-1 space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Vasilhame</label>
                    <div className="flex gap-2">
                      <select 
                        value={newServiceContainerSize} 
                        onChange={(e) => setNewServiceContainerSize(e.target.value)}
                        className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900"
                      >
                        <option value="20kg">20kg</option>
                        <option value="13kg">13kg</option>
                        <option value="10kg">10kg</option>
                        <option value="8kg">8kg</option>
                        <option value="5kg">5kg</option>
                      </select>
                      <button 
                        type="button"
                        onClick={() => setShowNewServiceGasModal(true)}
                        className={cn(
                          "px-3 py-2 rounded-xl text-[10px] font-bold uppercase transition-all",
                          newServiceGasItems.length > 0 ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        {newServiceGasItems.length > 0 ? `${newServiceGasItems.length} Tam.` : 'Vários'}
                      </button>
                    </div>
                  </div>
                )}
                {(newServiceType === 'boa_vista' || newServiceType === 'gas' || vehicles.find(v => v.id === record?.vehicleId)?.name.includes('Constellation 30280')) && (
                  <div className="flex-1 space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Pagto Motorista</label>
                    <input 
                      type="number" 
                      value={newServiceDriverPayment} 
                      onChange={(e) => setNewServiceDriverPayment(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900"
                    />
                  </div>
                )}
                {(newServiceType === 'milho' || newServiceType === 'cimento' || newServiceType === 'gas' || newServiceType === 'frete_avulso') && (
                  <div className="flex-1 space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">R$ / Unid</label>
                    <input 
                      type="number" 
                      value={newServiceUnitPrice} 
                      onChange={(e) => setNewServiceUnitPrice(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900"
                    />
                  </div>
                )}
                <div className="w-24 space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase">{(newServiceType === 'milho' || newServiceType === 'cimento' || newServiceType === 'gas' || newServiceType === 'frete_avulso') ? 'Qtd' : 'Qtd'}</label>
                  <input 
                    type="number" 
                    value={newServiceType === 'gas' && newServiceGasItems.length > 0 ? newServiceGasItems.reduce((acc, i) => acc + i.quantity, 0).toString() : newServiceQty}
                    disabled={newServiceType === 'gas' && newServiceGasItems.length > 0}
                    onChange={(e) => setNewServiceQty(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50 text-slate-900"
                  />
                </div>
                <button 
                  type="button"
                  onClick={addService}
                  className="bg-indigo-600 text-white p-2.5 rounded-xl hover:bg-indigo-700"
                >
                  <Plus size={20} />
                </button>
              </div>

              {/* Extra costs for Atego 2425 in RecordModal */}
              {vehicles.find(v => v.id === record?.vehicleId)?.name.includes('Atego 2425') && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-2xl">
                  <InputGroup label="Ajudantes (R$)" value={newServiceHelperCost} onChange={setNewServiceHelperCost} />
                  <InputGroup label="Almoço (R$)" value={newServiceLunchCost} onChange={setNewServiceLunchCost} />
                  <InputGroup label="Porto (R$)" value={newServicePortCost} onChange={setNewServicePortCost} />
                </div>
              )}

              {/* Common extra fields for all vehicles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl mt-2">
                <InputGroup label="Diesel (Baldes)" value={newServiceDieselBuckets} onChange={setNewServiceDieselBuckets} />
                <InputGroup label="Horas Extras" value={newServiceOvertimeHours} onChange={setNewServiceOvertimeHours} />
              </div>

              <div className="border border-slate-100 rounded-2xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Data</th>
                      <th className="px-4 py-3">Tipo</th>
                      <th className="px-4 py-3">Qtd</th>
                      <th className="px-4 py-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {services.map(s => (
                      <tr key={s.id} className="text-sm">
                        <td className="px-4 py-3">{format(parseISO(s.date), 'dd/MM/yyyy')}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-tight",
                            s.type === 'casada' ? "bg-indigo-100 text-indigo-700" : 
                            s.type === 'normal' ? "bg-cyan-100 text-cyan-700" : 
                            s.type === 'milho' ? "bg-amber-100 text-amber-700" : 
                            s.type === 'boa_vista' ? "bg-emerald-100 text-emerald-700" : 
                            s.type === 'gas' ? "bg-orange-100 text-orange-700" : 
                            s.type === 'aleatorio' ? "bg-pink-100 text-pink-700" :
                            s.type === 'frete_avulso' ? "bg-purple-100 text-purple-700" : "bg-slate-100 text-slate-700"
                          )}>
                            {s.type === 'casada' ? 'Casada' : 
                             s.type === 'normal' ? 'Normal' : 
                             s.type === 'milho' ? 'Milho' : 
                             s.type === 'boa_vista' ? 'Boa Vista' : 
                             s.type === 'gas' ? 'Gás' : 
                             s.type === 'frete_avulso' ? 'Frete Avulso' : 
                             s.type === 'aleatorio' ? 'Aleatório' : 'Cimento'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {s.quantity} {(s.type === 'milho' || s.type === 'cimento' || s.type === 'aleatorio') ? (s.type === 'milho' ? 'sacas' : 'cargas/sacas') : 'unid.'}
                          {s.containerSize ? (
                            <span className="text-[10px] text-orange-600 block font-bold">
                              Tam: {s.containerSize}
                            </span>
                          ) : null}
                          {s.gasItems && s.gasItems.length > 0 ? (
                            <div className="mt-1 space-y-0.5">
                              {s.gasItems.map(item => (
                                <span key={item.id} className="text-[9px] text-orange-600 block leading-tight">
                                  {item.quantity}x {item.size} ({formatCurrency(item.unitPrice)})
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {s.driverPayment ? (
                            <span className="text-[10px] text-indigo-500 block font-bold">
                              Pagto: {formatCurrency(s.driverPayment)}
                            </span>
                          ) : null}
                          {(s.type === 'milho' || s.type === 'cimento' || s.type === 'frete_avulso' || s.type === 'aleatorio' || (s.type === 'gas' && !s.gasItems)) && s.unitPrice ? (
                            <span className="text-[10px] text-slate-400 block">
                              ({formatCurrency(s.unitPrice)}/unid)
                            </span>
                          ) : null}
                          {(s.helperCost || s.lunchCost || s.portCost) && vehicles.find(v => v.id === record?.vehicleId)?.name.includes('Atego 2425') ? (
                            <div className="mt-1 pt-1 border-t border-slate-50">
                              {s.helperCost ? <span className="text-[9px] text-rose-500 block">Ajudantes: {formatCurrency(s.helperCost)}</span> : null}
                              {s.lunchCost ? <span className="text-[9px] text-rose-500 block">Almoço: {formatCurrency(s.lunchCost)}</span> : null}
                              {s.portCost ? <span className="text-[9px] text-rose-500 block">Porto: {formatCurrency(s.portCost)}</span> : null}
                            </div>
                          ) : null}
                          {s.dieselLiters ? (
                            <span className="text-[10px] text-blue-600 block font-bold mt-1">
                              Diesel: {s.dieselLiters}L ({s.dieselLiters / 20} baldes)
                            </span>
                          ) : null}
                          {s.overtimeHours ? (
                            <span className="text-[10px] text-emerald-600 block font-bold mt-1">
                              H. Extra: {s.overtimeHours}h
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button 
                            type="button"
                            onClick={() => removeService(s.id)}
                            className="text-rose-500 hover:bg-rose-50 p-1 rounded"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {services.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-400 italic">Nenhum serviço adicionado ainda</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100 flex justify-end gap-4">
              <button 
                type="button" 
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button 
                type="submit"
                className="px-8 py-2.5 rounded-xl font-medium bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200"
              >
                {record ? 'Salvar Alterações' : 'Salvar Mês'}
              </button>
            </div>
          </form>
        </div>

        {showNewServiceGasModal && (
          <GasItemsModal 
            items={newServiceGasItems}
            onSave={(items) => {
              setNewServiceGasItems(items);
              setShowNewServiceGasModal(false);
            }}
            onClose={() => setShowNewServiceGasModal(false)}
          />
        )}
      </div>
    </div>
  );
}

function NewVehicleModal({ vehicle, onClose, onSubmit }: { 
  vehicle?: Vehicle;
  onClose: () => void; 
  onSubmit: (name: string, plate: string, photoUrl?: string, pin?: string) => void 
}) {
  const [name, setName] = useState(vehicle?.name || '');
  const [plate, setPlate] = useState(vehicle?.plate || '');
  const [photoUrl, setPhotoUrl] = useState(vehicle?.photoUrl || '');
  const [pin, setPin] = useState(vehicle?.pin || '');
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onloadend = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Max dimensions
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        // Compress to JPEG with 0.7 quality
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        setPhotoUrl(dataUrl);
        setIsUploading(false);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8">
        <h2 className="text-2xl font-bold mb-6">{vehicle ? 'Editar Veículo' : 'Novo Veículo'}</h2>
        
        <div className="flex justify-center mb-8">
          <div className="relative group">
            <div className="w-32 h-32 rounded-2xl bg-slate-100 border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden transition-all group-hover:border-indigo-300">
              {photoUrl ? (
                <img src={photoUrl} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <div className="text-center p-4">
                  <Camera size={32} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Foto do Veículo</p>
                </div>
              )}
              {isUploading && (
                <div className="absolute inset-0 bg-white/80 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </div>
            <label className="absolute -bottom-2 -right-2 w-10 h-10 bg-indigo-600 text-white rounded-xl flex items-center justify-center shadow-lg cursor-pointer hover:bg-indigo-700 transition-colors">
              <Upload size={20} />
              <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </label>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Nome do Veículo</label>
            <input 
              type="text" 
              placeholder="Ex: Caminhão Scania R450"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">Placa</label>
            <input 
              type="text" 
              placeholder="ABC-1234"
              value={plate}
              onChange={(e) => setPlate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">URL da Foto (Opcional)</label>
            <input 
              type="text" 
              placeholder="https://exemplo.com/foto.jpg"
              value={photoUrl.startsWith('data:') ? '' : photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <p className="text-[10px] text-slate-400">Você pode fazer o upload acima ou colar um link aqui.</p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-bold text-slate-700">PIN de Acesso (Opcional)</label>
            <input 
              type="password" 
              placeholder="Ex: 1234"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <p className="text-[10px] text-slate-400">Recomendado para o veículo administrador.</p>
          </div>
        </div>
        <div className="mt-8 flex justify-end gap-4">
          <button onClick={onClose} className="px-6 py-2.5 rounded-xl font-medium text-slate-600 hover:bg-slate-50">
            Cancelar
          </button>
          <button 
            onClick={() => onSubmit(name, plate, photoUrl, pin)}
            disabled={!name || isUploading}
            className="px-8 py-2.5 rounded-xl font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {vehicle ? 'Salvar Alterações' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InputGroup({ label, value, onChange, step = 1 }: { 
  label: string; 
  value: number; 
  onChange: (v: number) => void;
  step?: number;
}) {
  const [internalValue, setInternalValue] = useState(value.toString());

  useEffect(() => {
    if (parseFloat(internalValue) !== value) {
      setInternalValue(value.toString());
    }
  }, [value]);

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold text-slate-500 uppercase">{label}</label>
      <input 
        type="number" 
        step={step}
        value={internalValue} 
        onChange={(e) => {
          const newValue = e.target.value;
          setInternalValue(newValue);
          const parsed = parseFloat(newValue);
          if (!isNaN(parsed)) {
            onChange(parsed);
          } else if (newValue === '') {
            onChange(0);
          }
        }}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-slate-900"
      />
    </div>
  );
}

function PinModal({ vehicle, onClose, onSuccess }: { 
  vehicle: Vehicle; 
  onClose: () => void; 
  onSuccess: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === vehicle.pin) {
      onSuccess();
    } else {
      setError(true);
      setPin('');
      setTimeout(() => setError(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-md z-[100] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 text-center">
        <div className="w-16 h-16 rounded-2xl overflow-hidden bg-slate-100 mx-auto mb-4 border-2 border-indigo-100">
          {vehicle.photoUrl ? (
            <img src={vehicle.photoUrl} alt={vehicle.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-indigo-600">
              <Truck size={24} />
            </div>
          )}
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-1">{vehicle.name}</h2>
        <p className="text-sm text-slate-500 mb-6">Digite o PIN de acesso</p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <input 
            type="password" 
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className={cn(
              "w-full text-center text-3xl tracking-[1em] font-bold bg-slate-50 border rounded-2xl py-4 focus:ring-2 focus:ring-indigo-500 outline-none transition-all",
              error ? "border-rose-500 bg-rose-50 animate-shake" : "border-slate-200"
            )}
            placeholder="****"
            maxLength={8}
          />
          {error && <p className="text-rose-500 text-sm font-bold">PIN Incorreto</p>}
          
          <div className="flex gap-3">
            <button 
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-50"
            >
              Voltar
            </button>
            <button 
              type="submit"
              className="flex-1 px-4 py-3 rounded-xl font-medium bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200"
            >
              Entrar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
