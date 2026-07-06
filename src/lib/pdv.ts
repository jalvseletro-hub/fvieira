/**
 * PDV / Point-of-sale data helpers backed directly by Supabase.
 * Products, sale items, sales and quotes live here.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  Product, Sale, SaleItem, PaymentMethod,
  Quote, QuoteItem, QuoteStatus, CompanySettings,
} from "@/types";

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

function rowToQuote(r: any): Quote {
  return {
    id: r.id,
    quoteNumber: Number(r.quote_number) || 0,
    date: r.quote_date,
    validUntil: r.valid_until ?? undefined,
    customerName: r.customer_name ?? undefined,
    customerPhone: r.customer_phone ?? undefined,
    customerAddress: r.customer_address ?? undefined,
    status: (r.status ?? 'aberto') as QuoteStatus,
    totalValue: Number(r.total_value) || 0,
    notes: r.notes ?? undefined,
    convertedSaleId: r.converted_sale_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToQuoteItem(r: any): QuoteItem {
  return {
    id: r.id,
    quoteId: r.quote_id,
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
  await Promise.all(
    list.map(async (p) => {
      if (p.imageUrl) {
        const { data: signed } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(p.imageUrl, 60 * 60 * 6);
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
export interface SaleItemInput {
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
}

export interface NewSaleInput {
  date: string;
  paymentMethod: PaymentMethod;
  customerName?: string;
  notes?: string;
  items: SaleItemInput[];
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
      await supabase.from("sales" as any).delete().eq("id", saleId);
      throw iErr;
    }
  }
  return saleId;
}

/**
 * Updates a sale: header + items. Existing items are deleted (stock trigger
 * restores stock) and new items are inserted (stock trigger subtracts again).
 */
export async function updateSaleWithItems(
  saleId: string,
  input: NewSaleInput
): Promise<void> {
  const userId = await requireUserId();
  const total = input.items.reduce((a, it) => a + it.quantity * it.unitPrice, 0);

  const { error: uErr } = await supabase
    .from("sales" as any)
    .update({
      sale_date: input.date,
      total_value: total,
      notes: input.notes ?? null,
      payment_method: input.paymentMethod,
      customer_name: input.customerName ?? null,
    })
    .eq("id", saleId);
  if (uErr) throw uErr;

  const { error: dErr } = await supabase
    .from("sale_items" as any)
    .delete()
    .eq("sale_id", saleId);
  if (dErr) throw dErr;

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
    if (iErr) throw iErr;
  }
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

// ---------- Quotes ----------
export interface NewQuoteInput {
  date: string;
  validUntil?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  notes?: string;
  status?: QuoteStatus;
  items: SaleItemInput[];
}

export async function listQuotes(): Promise<Quote[]> {
  const { data, error } = await supabase
    .from("quotes" as any)
    .select("*")
    .order("quote_number", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToQuote);
}

export async function listQuoteItems(): Promise<QuoteItem[]> {
  const { data, error } = await supabase.from("quote_items" as any).select("*");
  if (error) throw error;
  return (data ?? []).map(rowToQuoteItem);
}

export async function createQuoteWithItems(input: NewQuoteInput): Promise<string> {
  const userId = await requireUserId();
  const total = input.items.reduce((a, it) => a + it.quantity * it.unitPrice, 0);
  const { data: quote, error } = await supabase
    .from("quotes" as any)
    .insert({
      user_id: userId,
      quote_number: 0, // trigger assigns
      quote_date: input.date,
      valid_until: input.validUntil ?? null,
      customer_name: input.customerName ?? null,
      customer_phone: input.customerPhone ?? null,
      customer_address: input.customerAddress ?? null,
      status: input.status ?? 'aberto',
      total_value: total,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  const quoteId = (quote as any).id as string;

  if (input.items.length > 0) {
    const rows = input.items.map((it) => ({
      user_id: userId,
      quote_id: quoteId,
      product_id: it.productId ?? null,
      product_name: it.productName,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      unit_cost: it.unitCost,
    }));
    const { error: iErr } = await supabase.from("quote_items" as any).insert(rows);
    if (iErr) {
      await supabase.from("quotes" as any).delete().eq("id", quoteId);
      throw iErr;
    }
  }
  return quoteId;
}

export async function updateQuoteWithItems(
  quoteId: string,
  input: NewQuoteInput
): Promise<void> {
  const userId = await requireUserId();
  const total = input.items.reduce((a, it) => a + it.quantity * it.unitPrice, 0);
  const { error: uErr } = await supabase
    .from("quotes" as any)
    .update({
      quote_date: input.date,
      valid_until: input.validUntil ?? null,
      customer_name: input.customerName ?? null,
      customer_phone: input.customerPhone ?? null,
      customer_address: input.customerAddress ?? null,
      status: input.status ?? 'aberto',
      total_value: total,
      notes: input.notes ?? null,
    })
    .eq("id", quoteId);
  if (uErr) throw uErr;

  const { error: dErr } = await supabase
    .from("quote_items" as any)
    .delete()
    .eq("quote_id", quoteId);
  if (dErr) throw dErr;

  if (input.items.length > 0) {
    const rows = input.items.map((it) => ({
      user_id: userId,
      quote_id: quoteId,
      product_id: it.productId ?? null,
      product_name: it.productName,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      unit_cost: it.unitCost,
    }));
    const { error: iErr } = await supabase.from("quote_items" as any).insert(rows);
    if (iErr) throw iErr;
  }
}

export async function setQuoteStatus(quoteId: string, status: QuoteStatus, convertedSaleId?: string) {
  const patch: any = { status };
  if (convertedSaleId !== undefined) patch.converted_sale_id = convertedSaleId;
  const { error } = await supabase.from("quotes" as any).update(patch).eq("id", quoteId);
  if (error) throw error;
}

export async function deleteQuote(id: string) {
  const { error } = await supabase.from("quotes" as any).delete().eq("id", id);
  if (error) throw error;
}

/**
 * Approves a quote: creates a real sale from its items and updates status.
 */
export async function approveQuoteAsSale(
  quote: Quote,
  items: QuoteItem[],
  paymentMethod: PaymentMethod
): Promise<string> {
  const saleId = await createSaleWithItems({
    date: new Date().toISOString().slice(0, 10),
    paymentMethod,
    customerName: quote.customerName,
    notes: `Orçamento #${quote.quoteNumber}${quote.notes ? ' — ' + quote.notes : ''}`,
    items: items.map(it => ({
      productId: it.productId,
      productName: it.productName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      unitCost: it.unitCost,
    })),
  });
  await setQuoteStatus(quote.id, 'aprovado', saleId);
  return saleId;
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

export function subscribeQuotes(cb: (quotes: Quote[]) => void): () => void {
  let cancelled = false;
  const load = async () => {
    try { const list = await listQuotes(); if (!cancelled) cb(list); } catch {}
  };
  load();
  const ch = supabase
    .channel(`quotes-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes" as any, { event: "*", schema: "public", table: "quotes" }, load)
    .subscribe();
  return () => { cancelled = true; supabase.removeChannel(ch); };
}

export function subscribeQuoteItems(cb: (items: QuoteItem[]) => void): () => void {
  let cancelled = false;
  const load = async () => {
    try { const list = await listQuoteItems(); if (!cancelled) cb(list); } catch {}
  };
  load();
  const ch = supabase
    .channel(`quote-items-${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes" as any, { event: "*", schema: "public", table: "quote_items" }, load)
    .subscribe();
  return () => { cancelled = true; supabase.removeChannel(ch); };
}

// =============================================================================
// PRINT / A4 receipts and quotes
// =============================================================================
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
}

function money(v: number) { return `R$ ${v.toFixed(2)}`; }

function baseHtml(title: string, body: string, autoprint = true): string {
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; margin: 0; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px; }
  .header .company h1 { margin: 0 0 4px 0; font-size: 22px; }
  .header .company p { margin: 2px 0; font-size: 11px; color: #475569; }
  .header .doc { text-align: right; }
  .header .doc h2 { margin: 0 0 4px 0; font-size: 18px; color: #4f46e5; }
  .header .doc p { margin: 2px 0; font-size: 12px; color: #334155; }
  .logo { width: 70px; height: 70px; object-fit: contain; margin-right: 12px; }
  .company-row { display: flex; align-items: center; }
  .customer { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 18px; }
  .customer h3 { margin: 0 0 6px 0; font-size: 11px; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; }
  .customer p { margin: 2px 0; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th, td { padding: 8px 10px; text-align: left; font-size: 12px; }
  thead th { background: #0f172a; color: white; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
  tbody tr { border-bottom: 1px solid #e2e8f0; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tfoot td { font-weight: bold; font-size: 14px; border-top: 2px solid #0f172a; padding-top: 12px; }
  .total-row td { color: #059669; font-size: 16px; }
  .footer { margin-top: 32px; font-size: 11px; color: #64748b; }
  .footer .sig { margin-top: 60px; border-top: 1px solid #94a3b8; padding-top: 6px; text-align: center; width: 60%; margin-left: auto; margin-right: auto; }
  .note { font-size: 11px; color: #475569; background: #fef3c7; border: 1px solid #fde68a; border-radius: 6px; padding: 8px 12px; margin-bottom: 16px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; text-transform: uppercase; font-weight: bold; }
  @media print { body { padding: 16px; } .noprint { display: none; } }
</style>
</head><body>
${body}
${autoprint ? '<script>window.onload = () => { setTimeout(() => window.print(), 200); };</script>' : ''}
</body></html>`;
}

function companyHeader(settings: CompanySettings, docTitle: string, docNumber: string, docDate: string): string {
  const s = settings;
  return `<div class="header">
    <div class="company-row">
      ${s.logoUrl ? `<img class="logo" src="${escapeHtml(s.logoUrl)}" alt="logo"/>` : ''}
      <div class="company">
        <h1>${escapeHtml(s.name || 'F.VIEIRA')}</h1>
        ${s.cnpj ? `<p>CNPJ: ${escapeHtml(s.cnpj)}</p>` : ''}
        ${s.address ? `<p>${escapeHtml(s.address)}</p>` : ''}
        ${(s.phone || s.email) ? `<p>${escapeHtml(s.phone || '')}${s.phone && s.email ? ' • ' : ''}${escapeHtml(s.email || '')}</p>` : ''}
      </div>
    </div>
    <div class="doc">
      <h2>${escapeHtml(docTitle)}</h2>
      <p><b>${escapeHtml(docNumber)}</b></p>
      <p>${escapeHtml(docDate)}</p>
    </div>
  </div>`;
}

function itemsTable(items: { productName: string; quantity: number; unitPrice: number }[], total: number): string {
  const rows = items.map(it => `
    <tr>
      <td>${escapeHtml(it.productName)}</td>
      <td class="num">${it.quantity}</td>
      <td class="num">${money(it.unitPrice)}</td>
      <td class="num">${money(it.quantity * it.unitPrice)}</td>
    </tr>
  `).join('');
  return `<table>
    <thead><tr><th>Descrição</th><th class="num">Qtd</th><th class="num">Unit.</th><th class="num">Subtotal</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="total-row"><td colspan="3" class="num">TOTAL</td><td class="num">${money(total)}</td></tr></tfoot>
  </table>`;
}

function openPrintWindow(html: string) {
  const w = window.open('', '_blank', 'width=900,height=1100');
  if (!w) { alert('Bloqueado pelo navegador. Permita pop-ups para imprimir.'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro', pix: 'PIX', cartao: 'Cartão', fiado: 'Fiado',
};

export function printSaleReceipt(sale: Sale, items: SaleItem[], settings: CompanySettings) {
  const date = new Date(sale.date + 'T12:00:00').toLocaleDateString('pt-BR');
  const header = companyHeader(settings, 'RECIBO DE VENDA', `Nº ${sale.id.slice(0, 8).toUpperCase()}`, date);
  const customer = sale.customerName ? `<div class="customer"><h3>Cliente</h3><p>${escapeHtml(sale.customerName)}</p></div>` : '';
  const note = sale.notes ? `<div class="note"><b>Obs:</b> ${escapeHtml(sale.notes)}</div>` : '';
  const payInfo = `<p style="font-size:12px;margin:8px 0"><b>Forma de pagamento:</b> ${PAYMENT_LABEL[sale.paymentMethod]}</p>`;
  const body = `${header}${customer}${payInfo}${itemsTable(items, sale.totalValue)}${note}
    <div class="footer">
      <p>Recibo emitido em ${new Date().toLocaleString('pt-BR')}.</p>
      <div class="sig">Assinatura</div>
    </div>`;
  openPrintWindow(baseHtml(`Recibo #${sale.id.slice(0,8)}`, body));
}

export function printQuote(quote: Quote, items: QuoteItem[], settings: CompanySettings) {
  const date = new Date(quote.date + 'T12:00:00').toLocaleDateString('pt-BR');
  const validity = quote.validUntil
    ? `<p style="font-size:12px;margin:4px 0"><b>Válido até:</b> ${new Date(quote.validUntil + 'T12:00:00').toLocaleDateString('pt-BR')}</p>`
    : '';
  const header = companyHeader(settings, 'ORÇAMENTO', `Nº ${String(quote.quoteNumber).padStart(4, '0')}`, date);
  const customerParts = [
    quote.customerName ? `<p><b>${escapeHtml(quote.customerName)}</b></p>` : '',
    quote.customerPhone ? `<p>${escapeHtml(quote.customerPhone)}</p>` : '',
    quote.customerAddress ? `<p>${escapeHtml(quote.customerAddress)}</p>` : '',
  ].filter(Boolean).join('');
  const customer = customerParts
    ? `<div class="customer"><h3>Cliente</h3>${customerParts}${validity}</div>`
    : (validity ? `<div class="customer"><h3>Validade</h3>${validity}</div>` : '');
  const note = quote.notes ? `<div class="note"><b>Obs:</b> ${escapeHtml(quote.notes)}</div>` : '';
  const body = `${header}${customer}${itemsTable(items, quote.totalValue)}${note}
    <div class="footer">
      <p>Documento não fiscal. Valores sujeitos a alteração após a validade.</p>
      <div class="sig">Aprovação do cliente</div>
    </div>`;
  openPrintWindow(baseHtml(`Orçamento #${quote.quoteNumber}`, body));
}
