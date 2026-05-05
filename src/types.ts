export type ServiceType = 'casada' | 'normal' | 'milho' | 'cimento' | 'boa_vista' | 'gas' | 'frete_avulso' | 'aleatorio';

export interface GasItem {
  id: string;
  size: string;
  quantity: number;
  unitPrice: number;
}

export interface ServiceEntry {
  id: string;
  date: string;
  type: ServiceType;
  quantity: number;
  unitPrice?: number; // Used for 'milho', 'cimento' or custom prices
  driverPayment?: number; // Used for per-trip driver payments (e.g., Boa Vista)
  containerSize?: string; // Used for 'gas' services
  gasItems?: GasItem[]; // Used for multi-size 'gas' services
  helperCost?: number; // Specific for Atego 2425
  lunchCost?: number;  // Specific for Atego 2425
  portCost?: number;   // Specific for Atego 2425
  dieselLiters?: number; // Added for quick diesel entry
  overtimeHours?: number; // Added for quick overtime entry
  driverId?: 1 | 2; // For vehicles with two drivers
  agentCommission?: number; // Specific commission for 'milho' services
  observation?: string; // Observação do motorista
}

export interface MonthlyCosts {
  dieselLiters: number;
  dieselPrice: number;
  driverDays: number;
  driverDailyRate: number;
  taxRate: number;
  maintenanceParts: number;
  maintenanceLabor: number;
  overtimeHours?: number;
  overtimeRate?: number;
}

export interface ClientInfo {
  name: string;
  cnpj?: string;
  contactName?: string;
  phone?: string;
  address?: string;
  email?: string;
}

export interface MonthRecord {
  id: string;
  vehicleId: string;
  month: number; // 0-11
  year: number;
  services: ServiceEntry[];
  costs: MonthlyCosts;
  client?: ClientInfo;
}

export interface Vehicle {
  id: string;
  name: string;
  plate?: string;
  photoUrl?: string;
  pin?: string;
}

export interface CompanySettings {
  name: string;
  logoUrl?: string;
  cnpj?: string;
  address?: string;
  phone?: string;
  email?: string;
}

export interface AppState {
  vehicles: Vehicle[];
  records: MonthRecord[];
  settings: CompanySettings;
}
