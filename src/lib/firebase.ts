/**
 * Firebase-compatible shim backed by Lovable Cloud (Supabase).
 * Allows the legacy App.tsx (originally written for Firebase) to run
 * unchanged on top of Supabase Postgres + Auth.
 */
import { supabase } from "@/integrations/supabase/client";
import type { User as SupabaseUser } from "@supabase/supabase-js";

// ---------- Types ----------
export type User = SupabaseUser;

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export function handleFirestoreError(
  error: unknown,
  op: OperationType,
  path: string | null,
  shouldThrow = true
) {
  // eslint-disable-next-line no-console
  console.error("DB Error:", op, path, error);
  // Show a visible message so mobile users know why the action failed
  if (shouldThrow && typeof window !== "undefined") {
    const message = error instanceof Error
      ? error.message
      : (typeof error === "object" && error && "message" in error
          ? String((error as any).message)
          : String(error));
    try { window.alert(`Não foi possível salvar: ${message}`); } catch {}
  }
  if (shouldThrow) throw error instanceof Error ? error : new Error(String(error));
}

// ---------- Auth surface ----------
type AuthUserCallback = (user: User | null) => void;

export const auth = {
  get currentUser(): User | null {
    return _currentUser;
  },
};

let _currentUser: User | null = null;
const _authListeners = new Set<AuthUserCallback>();

// Bootstrap session
if (typeof window !== "undefined") {
  supabase.auth.getSession().then(({ data }) => {
    _currentUser = data.session?.user ?? null;
    _authListeners.forEach((cb) => cb(_currentUser));
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    _currentUser = session?.user ?? null;
    _authListeners.forEach((cb) => cb(_currentUser));
  });
}

export function onAuthStateChanged(_authObj: typeof auth, cb: AuthUserCallback) {
  _authListeners.add(cb);
  // Fire immediately with current state
  Promise.resolve().then(() => cb(_currentUser));
  return () => {
    _authListeners.delete(cb);
  };
}

export const googleProvider = { providerId: "google" };

// signInWithPopup → redirect to /auth (real login lives there)
export async function signInWithPopup(_authObj: typeof auth, _provider: any) {
  if (typeof window !== "undefined") {
    window.location.href = "/auth";
  }
}

export async function signOut(_authObj: typeof auth) {
  await supabase.auth.signOut();
}

// ---------- Firestore-like surface ----------
export const db = { __isShim: true };

type CollectionRef = { __kind: "collection"; name: CollectionName };
type DocRef = { __kind: "doc"; name: CollectionName; id: string };

type CollectionName = "vehicles" | "records" | "settings" | "debts" | "employees";

export function collection(_db: any, name: CollectionName): CollectionRef {
  return { __kind: "collection", name };
}

export function doc(_db: any, name: CollectionName, id: string): DocRef {
  return { __kind: "doc", name, id };
}

// ---------- Mappers (camelCase <-> snake_case) ----------
function vehicleToRow(v: any, userId: string) {
  return {
    id: v.id,
    user_id: userId,
    name: v.name,
    plate: v.plate ?? null,
    photo_url: v.photoUrl ?? null,
    pin: v.pin ?? null,
  };
}
function rowToVehicle(r: any) {
  return {
    id: r.id,
    name: r.name,
    plate: r.plate ?? "",
    photoUrl: r.photo_url ?? undefined,
    pin: r.pin ?? undefined,
  };
}
function recordToRow(rec: any, userId: string) {
  return {
    id: rec.id,
    user_id: userId,
    vehicle_id: rec.vehicleId,
    month: rec.month,
    year: rec.year,
    services: rec.services ?? [],
    costs: rec.costs ?? {},
    client: rec.client ?? null,
  };
}
function rowToRecord(r: any) {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    month: r.month,
    year: r.year,
    services: r.services ?? [],
    costs: r.costs ?? {},
    client: r.client ?? undefined,
  };
}
function settingsToRow(s: any, userId: string) {
  return {
    user_id: userId,
    name: s.name ?? "F.VIEIRA",
    cnpj: s.cnpj ?? null,
    address: s.address ?? null,
    phone: s.phone ?? null,
    email: s.email ?? null,
    logo_url: s.logoUrl ?? null,
  };
}
function rowToSettings(r: any) {
  return {
    name: r.name,
    cnpj: r.cnpj ?? undefined,
    address: r.address ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    logoUrl: r.logo_url ?? undefined,
  };
}
function debtToRow(d: any, userId: string) {
  return {
    id: d.id,
    user_id: userId,
    name: d.name,
    total_value: Number(d.totalValue) || 0,
    installment_value: Number(d.installmentValue) || 0,
    total_installments: Number(d.totalInstallments) || 1,
    paid_installments: Number(d.paidInstallments) || 0,
    payment_day: Number(d.paymentDay) || 1,
    start_date: d.startDate,
    notes: d.notes ?? null,
  };
}
function rowToDebt(r: any) {
  return {
    id: r.id,
    name: r.name,
    totalValue: Number(r.total_value) || 0,
    installmentValue: Number(r.installment_value) || 0,
    totalInstallments: Number(r.total_installments) || 1,
    paidInstallments: Number(r.paid_installments) || 0,
    paymentDay: Number(r.payment_day) || 1,
    startDate: r.start_date,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
function employeeToRow(e: any, userId: string) {
  return {
    id: e.id,
    user_id: userId,
    name: e.name,
    role: e.role ?? null,
    salary: Number(e.salary) || 0,
    payment_day: Number(e.paymentDay) || 5,
    hire_date: e.hireDate || null,
    phone: e.phone ?? null,
    notes: e.notes ?? null,
    active: e.active !== false,
  };
}
function rowToEmployee(r: any) {
  return {
    id: r.id,
    name: r.name,
    role: r.role ?? undefined,
    salary: Number(r.salary) || 0,
    paymentDay: Number(r.payment_day) || 5,
    hireDate: r.hire_date ?? undefined,
    phone: r.phone ?? undefined,
    notes: r.notes ?? undefined,
    active: r.active !== false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function uid(): string {
  if (!_currentUser) throw new Error("Not authenticated");
  return _currentUser.id;
}

// ---------- setDoc / getDoc / deleteDoc / updateDoc / getDocs ----------
export async function setDoc(ref: DocRef, data: any) {
  const userId = uid();
  if (ref.name === "vehicles") {
    const { error } = await supabase
      .from("vehicles")
      .upsert(vehicleToRow({ ...data, id: ref.id }, userId));
    if (error) throw error;
  } else if (ref.name === "records") {
    const { error } = await supabase
      .from("month_records")
      .upsert(recordToRow({ ...data, id: ref.id }, userId));
    if (error) throw error;
  } else if (ref.name === "settings") {
    // ref.id is "company" — single row per user
    const { error } = await supabase
      .from("company_settings")
      .upsert(settingsToRow(data, userId), { onConflict: "user_id" });
    if (error) throw error;
  } else if (ref.name === "debts") {
    const { error } = await supabase
      .from("debts" as any)
      .upsert(debtToRow({ ...data, id: ref.id }, userId));
    if (error) throw error;
  } else if (ref.name === "employees") {
    const { error } = await supabase
      .from("employees" as any)
      .upsert(employeeToRow({ ...data, id: ref.id }, userId));
    if (error) throw error;
  }
}

export async function deleteDoc(ref: DocRef) {
  if (ref.name === "vehicles") {
    const { error } = await supabase.from("vehicles").delete().eq("id", ref.id);
    if (error) throw error;
  } else if (ref.name === "records") {
    const { error } = await supabase.from("month_records").delete().eq("id", ref.id);
    if (error) throw error;
  } else if (ref.name === "debts") {
    const { error } = await supabase.from("debts" as any).delete().eq("id", ref.id);
    if (error) throw error;
  } else if (ref.name === "employees") {
    const { error } = await supabase.from("employees" as any).delete().eq("id", ref.id);
    if (error) throw error;
  }
}

export async function updateDoc(ref: DocRef, data: any) {
  return setDoc(ref, data);
}

type Snapshot =
  | { exists: () => boolean; data: () => any; docs: never }
  | { docs: { id: string; data: () => any }[]; exists: never };

export async function getDoc(ref: DocRef): Promise<any> {
  let row: any = null;
  if (ref.name === "vehicles") {
    const { data } = await supabase.from("vehicles").select("*").eq("id", ref.id).maybeSingle();
    row = data ? rowToVehicle(data) : null;
  } else if (ref.name === "records") {
    const { data } = await supabase
      .from("month_records")
      .select("*")
      .eq("id", ref.id)
      .maybeSingle();
    row = data ? rowToRecord(data) : null;
  } else if (ref.name === "settings") {
    const userId = uid();
    const { data } = await supabase
      .from("company_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    row = data ? rowToSettings(data) : null;
  }
  return {
    exists: () => row !== null,
    data: () => row,
  };
}

export async function getDocs(ref: CollectionRef) {
  const docs: { id: string; data: () => any }[] = [];
  if (ref.name === "vehicles") {
    const { data } = await supabase.from("vehicles").select("*").order("created_at");
    (data ?? []).forEach((r: any) => {
      const v = rowToVehicle(r);
      docs.push({ id: v.id, data: () => v });
    });
  } else if (ref.name === "records") {
    const { data } = await supabase.from("month_records").select("*").order("created_at");
    (data ?? []).forEach((r: any) => {
      const rec = rowToRecord(r);
      docs.push({ id: rec.id, data: () => rec });
    });
  } else if (ref.name === "debts") {
    const { data } = await supabase.from("debts" as any).select("*").order("created_at");
    (data ?? []).forEach((r: any) => {
      const d = rowToDebt(r);
      docs.push({ id: d.id, data: () => d });
    });
  } else if (ref.name === "employees") {
    const { data } = await supabase.from("employees" as any).select("*").order("created_at");
    (data ?? []).forEach((r: any) => {
      const e = rowToEmployee(r);
      docs.push({ id: e.id, data: () => e });
    });
  }
  return { docs };
}

// ---------- onSnapshot (initial load + realtime) ----------
type SnapshotCallback = (snap: any) => void;
type ErrorCallback = (err: any) => void;

export function onSnapshot(
  ref: CollectionRef | DocRef,
  cb: SnapshotCallback,
  errCb?: ErrorCallback
): () => void {
  let cancelled = false;

  async function load() {
    try {
      if (ref.__kind === "collection") {
        const snap = await getDocs(ref);
        if (!cancelled) cb(snap);
      } else {
        const snap = await getDoc(ref);
        if (!cancelled) cb(snap);
      }
    } catch (e) {
      if (!cancelled && errCb) errCb(e);
    }
  }

  load();

  // Realtime subscription
  const tableMap: Record<CollectionName, string> = {
    vehicles: "vehicles",
    records: "month_records",
    settings: "company_settings",
    debts: "debts",
  };
  const table = tableMap[ref.__kind === "collection" ? ref.name : ref.name];
  const channel = supabase
    .channel(`shim-${table}-${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table },
      () => {
        if (!cancelled) load();
      }
    )
    .subscribe();

  return () => {
    cancelled = true;
    supabase.removeChannel(channel);
  };
}

// Stubs for unused query helpers to satisfy imports
export function query(...args: any[]) {
  return args[0];
}
export function where(..._args: any[]) {
  return {} as any;
}
export function orderBy(..._args: any[]) {
  return {} as any;
}
