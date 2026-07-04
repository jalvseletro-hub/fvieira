/**
 * PDV / Point-of-sale data helpers backed directly by Supabase.
 * Products, sale items and store-sales (with items) live here to keep
 * the giant App.tsx focused on driver/vehicle logic.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Product, Sale, SaleItem, PaymentMethod } from "@/types";

const BUCKET = "product-images";

// ---------- Mappers ----------
function rowToProduct(r: any): Product {
  return {
    id: r.id,
    name: r.name,
    imageUrl: r.image_url ?? undefined,
    costPrice: Number(r.cost_price) || 0,
    salePrice: Number(r.sale_price) || 0,
    stock: Number(r.stock) || 0,
    unit: r.unit ?? "un",
    active: r.active !== false,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToSaleItem(r: any): SaleItem {
  return {
    id: r.id,
    saleId: r.sale_id,
    productId: r.product_id ?? undefined,
    productName: r.product_name,
    quantity: Number(r.quantity) || 0,
    unitPrice: Number(r.unit_price) || 0,
    unitCost: Number(r.unit_cost) || 0,
  };
}

async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Não autenticado");
  return data.user.id;
}

// ---------- Products ----------
export async function listProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from("products" as any)
    .select("*")
    .order("name");
  if (error) throw error;
  const list = (data ?? []).map(rowToProduct);
  // Resolve signed URLs for images (bucket is private)
  await Promise.all(
    list.map(async (p) => {
      if (p.imageUrl) {
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(p.imageUrl, 60 * 60 * 6); // 6h
        if (signed?.signedUrl) p.imageDisplayUrl = signed.signedUrl;
      }
    })
  );
  return list;
}

export async function saveProduct(
  input: Omit<Product, "id" | "createdAt" | "updatedAt" | "imageDisplayUrl"> & { id?: string }
): Promise<string> {
  const userId = await requireUserId();
  const row: any = {
    user_id: userId,
    name: input.name,
    image_url: input.imageUrl ?? null,
    cost_price: input.costPrice,
    sale_price: input.salePrice,
    stock: input.stock,
    unit: input.unit,
    active: input.active,
    notes: input.notes ?? null,
  };
  if (input.id) row.id = input.id;
  const { data, error } = await supabase
    .from("products" as any)
    .upsert(row)
    .select("id")
    .single();
  if (error) throw error;
  return (data as any).id;
}

export async function deleteProduct(id: string) {
  // Fetch image path before delete so we can also clean the file
  const { data } = await supabase
    .from("products" as any)
    .select("image_url")
    .eq("id", id)
    .maybeSingle();
  const path = (data as any)?.image_url as string | null | undefined;
  const { error } = await supabase.from("products" as any).delete().eq("id", id);
  if (error) throw error;
  if (path) {
    try { await supabase.storage.from(BUCKET).remove([path]); } catch {}
  }
}

export async function uploadProductImage(file: File): Promise<string> {
  const userId = await requireUserId();
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return path;
}

// ---------- Sales with items ----------
export interface NewSaleInput {
  date: string;
  paymentMethod: PaymentMethod;
  customerName?: string;
  notes?: string;
  items: Array<{
    productId?: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    unitCost: number;
  }>;
}

export async function createSaleWithItems(input: NewSaleInput): Promise<string> {
  const userId = await requireUserId();
  const total = input.items.reduce((a, it) => a + it.quantity * it.unitPrice, 0);

  const { data: sale, error: sErr } = await supabase
    .from("sales" as any)
    .insert({
      user_id: userId,
      sale_date: input.date,
      total_value: total,
      notes: input.notes ?? null,
      payment_method: input.paymentMethod,
      customer_name: input.customerName ?? null,
    })
    .select("id")
    .single();
  if (sErr) throw sErr;

  const saleId = (sale as any).id as string;

  if (input.items.length > 0) {
    const rows = input.items.map((it) => ({
      user_id: userId,
      sale_id: saleId,
      product_id: it.productId ?? null,
      product_name: it.productName,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      unit_cost: it.unitCost,
    }));
    const { error: iErr } = await supabase.from("sale_items" as any).insert(rows);
    if (iErr) {
      // rollback
      await supabase.from("sales" as any).delete().eq("id", saleId);
      throw iErr;
    }
  }
  return saleId;
}

export async function deleteSale(id: string) {
  const { error } = await supabase.from("sales" as any).delete().eq("id", id);
  if (error) throw error;
}

export async function listSaleItems(): Promise<SaleItem[]> {
  const { data, error } = await supabase
    .from("sale_items" as any)
    .select("*");
  if (error) throw error;
  return (data ?? []).map(rowToSaleItem);
}

// ---------- Realtime subscriptions ----------
export function subscribeProducts(cb: (products: Product[]) => void): () => void {
  let cancelled = false;
  const load = async () => {
    try { const list = await listProducts(); if (!cancelled) cb(list); } catch {}
  };
  load();
  const ch = supabase
    .channel(`products-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes" as any, { event: "*", schema: "public", table: "products" }, load)
    .subscribe();
  return () => { cancelled = true; supabase.removeChannel(ch); };
}

export function subscribeSaleItems(cb: (items: SaleItem[]) => void): () => void {
  let cancelled = false;
  const load = async () => {
    try { const list = await listSaleItems(); if (!cancelled) cb(list); } catch {}
  };
  load();
  const ch = supabase
    .channel(`sale-items-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes" as any, { event: "*", schema: "public", table: "sale_items" }, load)
    .subscribe();
  return () => { cancelled = true; supabase.removeChannel(ch); };
}
