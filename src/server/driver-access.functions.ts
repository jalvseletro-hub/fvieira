import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { CompanySettings, MonthRecord, ServiceEntry, Vehicle } from "@/types";

const DEFAULT_DIESEL_PRICE = 6.5;

const serviceSchema = z.object({
  date: z.string(),
  type: z.enum(["casada", "normal", "milho", "cimento", "boa_vista", "gas", "frete_avulso", "aleatorio"]),
  quantity: z.number(),
  unitPrice: z.number().optional(),
  driverPayment: z.number().optional(),
  containerSize: z.string().optional(),
  gasItems: z.array(z.object({
    id: z.string(),
    size: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
  })).optional(),
  helperCost: z.number().optional(),
  lunchCost: z.number().optional(),
  portCost: z.number().optional(),
  dieselLiters: z.number().optional(),
  overtimeHours: z.number().optional(),
  driverId: z.union([z.literal(1), z.literal(2)]).optional(),
  agentCommission: z.number().optional(),
});

function makeId() {
  return crypto.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function rowToVehicle(row: any): Vehicle {
  return {
    id: row.id,
    name: row.name,
    plate: row.plate ?? "",
    photoUrl: row.photo_url ?? undefined,
    pin: row.pin ?? undefined,
  };
}

function rowToRecord(row: any): MonthRecord {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    month: row.month,
    year: row.year,
    services: row.services ?? [],
    costs: row.costs ?? {},
    client: row.client ?? undefined,
  };
}

function rowToSettings(row: any | null): CompanySettings {
  return {
    name: row?.name ?? "F.VIEIRA",
    cnpj: row?.cnpj ?? undefined,
    address: row?.address ?? undefined,
    phone: row?.phone ?? undefined,
    email: row?.email ?? undefined,
    logoUrl: row?.logo_url ?? undefined,
  };
}

function serviceMonthYear(date: string) {
  const [year, month] = date.split("-").map(Number);
  return { year, month: month - 1 };
}

function recalculateCosts(record: MonthRecord) {
  const nonTripDates = new Set(
    record.services.filter((s) => s.type !== "boa_vista" && s.type !== "gas").map((s) => s.date),
  );

  return {
    ...record.costs,
    dieselLiters: record.services.reduce((acc, s) => acc + (s.dieselLiters || 0), 0),
    overtimeHours: record.services.reduce((acc, s) => acc + (s.overtimeHours || 0), 0),
    driverDays: nonTripDates.size,
  };
}

export const getDriverWorkspace = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ plate: z.string().min(1) }).parse(data))
  .handler(async ({ data }) => {
    const normalizedPlate = data.plate.trim().toLowerCase();
    const { data: vehicles, error: vehicleError } = await supabaseAdmin
      .from("vehicles")
      .select("*");

    if (vehicleError) throw vehicleError;

    const vehicleRow = (vehicles ?? []).find(
      (vehicle: any) => String(vehicle.plate ?? "").trim().toLowerCase() === normalizedPlate,
    );

    if (!vehicleRow) throw new Error("Veículo não encontrado. Verifique a placa.");

    const [{ data: recordRows, error: recordsError }, { data: settingsRow, error: settingsError }] = await Promise.all([
      supabaseAdmin
        .from("month_records")
        .select("*")
        .eq("vehicle_id", vehicleRow.id)
        .order("year", { ascending: false })
        .order("month", { ascending: false }),
      supabaseAdmin
        .from("company_settings")
        .select("*")
        .eq("user_id", vehicleRow.user_id)
        .maybeSingle(),
    ]);

    if (recordsError) throw recordsError;
    if (settingsError) throw settingsError;

    return {
      vehicle: rowToVehicle(vehicleRow),
      records: (recordRows ?? []).map(rowToRecord),
      settings: rowToSettings(settingsRow),
    };
  });

export const addDriverService = createServerFn({ method: "POST" })
  .inputValidator((data) => z.object({ vehicleId: z.string().uuid(), service: serviceSchema }).parse(data))
  .handler(async ({ data }) => {
    const { data: vehicleRow, error: vehicleError } = await supabaseAdmin
      .from("vehicles")
      .select("*")
      .eq("id", data.vehicleId)
      .maybeSingle();

    if (vehicleError) throw vehicleError;
    if (!vehicleRow) throw new Error("Veículo não encontrado.");

    const { month, year } = serviceMonthYear(data.service.date);
    const { data: existingRow, error: existingError } = await supabaseAdmin
      .from("month_records")
      .select("*")
      .eq("vehicle_id", data.vehicleId)
      .eq("month", month)
      .eq("year", year)
      .maybeSingle();

    if (existingError) throw existingError;

    const service: ServiceEntry = { ...data.service, id: makeId() };
    const record: MonthRecord = existingRow
      ? rowToRecord(existingRow)
      : {
          id: makeId(),
          vehicleId: data.vehicleId,
          month,
          year,
          services: [],
          costs: {
            dieselLiters: 0,
            dieselPrice: DEFAULT_DIESEL_PRICE,
            driverDays: service.type === "boa_vista" || service.type === "gas" ? 0 : 1,
            driverDailyRate: 120,
            taxRate: 5,
            maintenanceParts: 0,
            maintenanceLabor: 0,
            overtimeHours: 0,
            overtimeRate: 15,
          },
        };

    const updatedRecord: MonthRecord = {
      ...record,
      services: [...record.services, service].sort((a, b) => a.date.localeCompare(b.date)),
    };
    updatedRecord.costs = recalculateCosts(updatedRecord);

    const upsertPayload: any = {
      id: updatedRecord.id,
      user_id: vehicleRow.user_id,
      vehicle_id: updatedRecord.vehicleId,
      month: updatedRecord.month,
      year: updatedRecord.year,
      services: updatedRecord.services as any,
      costs: updatedRecord.costs as any,
      client: (updatedRecord.client ?? null) as any,
    };
    const { data: savedRows, error: saveError } = await supabaseAdmin
      .from("month_records")
      .upsert(upsertPayload)
      .select("*");

    if (saveError) throw saveError;
    return rowToRecord(savedRows?.[0] ?? { ...updatedRecord, vehicle_id: updatedRecord.vehicleId });
  });
