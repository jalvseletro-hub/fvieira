import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, Pencil, ShoppingCart, Package, History as HistoryIcon,
  Upload, X, Minus, ChevronDown, ChevronUp, Search, AlertTriangle,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import type { Product, Sale, SaleItem, PaymentMethod } from '@/types';
import {
  subscribeProducts, subscribeSaleItems,
  saveProduct, deleteProduct, uploadProductImage,
  createSaleWithItems, deleteSale,
} from '@/lib/pdv';

interface Props {
  sales: Sale[]; // parent still owns the sales subscription
  onSaleItemsChange?: (items: SaleItem[]) => void;
}

type CartLine = {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  stock: number;
  unit: string;
  imageDisplayUrl?: string;
};

const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro', pix: 'Pix', cartao: 'Cartão', fiado: 'Fiado',
};
const PAYMENT_COLORS: Record<PaymentMethod, string> = {
  dinheiro: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  pix: 'bg-sky-50 text-sky-700 border-sky-200',
  cartao: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  fiado: 'bg-amber-50 text-amber-700 border-amber-200',
};

export default function PDVModule({ sales, onSaleItemsChange }: Props) {
  const [tab, setTab] = useState<'pdv' | 'products' | 'history'>('pdv');
  const [products, setProducts] = useState<Product[]>([]);
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);

  useEffect(() => {
    const un1 = subscribeProducts(setProducts);
    const un2 = subscribeSaleItems((items) => {
      setSaleItems(items);
      onSaleItemsChange?.(items);
    });
    return () => { un1(); un2(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Loja F.VIEIRA — PDV</h2>
          <p className="text-slate-500 text-sm">Vendas, estoque e cadastro de produtos.</p>
        </div>
      </header>

      {/* Sub-tabs */}
      <div className="bg-white rounded-2xl border border-slate-100 p-1 flex">
        {([
          { id: 'pdv', label: 'PDV', icon: ShoppingCart },
          { id: 'products', label: 'Produtos', icon: Package },
          { id: 'history', label: 'Histórico', icon: HistoryIcon },
        ] as const).map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-colors',
                active ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'
              )}
            >
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'pdv' && <PDVScreen products={products} />}
      {tab === 'products' && <ProductsScreen products={products} />}
      {tab === 'history' && <HistoryScreen sales={sales} items={saleItems} />}
    </div>
  );
}

// =========================================================================
// PDV SCREEN
// =========================================================================
function PDVScreen({ products }: { products: Product[] }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('dinheiro');
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(
    () => products
      .filter(p => p.active)
      .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase())),
    [products, search]
  );

  const total = cart.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const totalCost = cart.reduce((a, l) => a + l.quantity * l.unitCost, 0);
  const profit = total - totalCost;

  const addToCart = (p: Product) => {
    setCart(cur => {
      const idx = cur.findIndex(l => l.productId === p.id);
      if (idx >= 0) {
        const copy = [...cur];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [...cur, {
        productId: p.id, productName: p.name,
        quantity: 1, unitPrice: p.salePrice, unitCost: p.costPrice,
        stock: p.stock, unit: p.unit, imageDisplayUrl: p.imageDisplayUrl,
      }];
    });
  };

  const setQty = (productId: string, qty: number) => {
    if (qty <= 0) return setCart(c => c.filter(l => l.productId !== productId));
    setCart(c => c.map(l => l.productId === productId ? { ...l, quantity: qty } : l));
  };
  const setPrice = (productId: string, price: number) => {
    setCart(c => c.map(l => l.productId === productId ? { ...l, unitPrice: price } : l));
  };

  const finalize = async () => {
    if (cart.length === 0) return;
    if (paymentMethod === 'fiado' && !customerName.trim()) {
      alert('Informe o nome do cliente para venda fiado.');
      return;
    }
    // Warn stock
    const overStock = cart.filter(l => l.quantity > l.stock);
    if (overStock.length > 0) {
      const ok = confirm(`Alguns produtos ficarão com estoque negativo:\n${overStock.map(l => `- ${l.productName}`).join('\n')}\n\nContinuar mesmo assim?`);
      if (!ok) return;
    }
    setSaving(true);
    try {
      await createSaleWithItems({
        date: new Date().toISOString().slice(0, 10),
        paymentMethod,
        customerName: paymentMethod === 'fiado' ? customerName.trim() : undefined,
        notes: notes.trim() || undefined,
        items: cart.map(l => ({
          productId: l.productId, productName: l.productName,
          quantity: l.quantity, unitPrice: l.unitPrice, unitCost: l.unitCost,
        })),
      });
      setCart([]); setCustomerName(''); setNotes(''); setPaymentMethod('dinheiro');
      alert('Venda registrada!');
    } catch (e: any) {
      alert('Erro ao salvar venda: ' + (e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
      {/* Product grid */}
      <div className="bg-white rounded-3xl border border-slate-100 p-4 space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar produto..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 outline-none focus:border-indigo-400"
          />
        </div>
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Package size={40} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">Nenhum produto cadastrado.</p>
            <p className="text-xs">Vá em <b>Produtos</b> para começar.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {filtered.map(p => {
              const low = p.stock <= 0;
              return (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="text-left border border-slate-100 rounded-2xl overflow-hidden hover:border-indigo-300 hover:shadow-md transition-all bg-white"
                >
                  <div className="aspect-square bg-slate-50 flex items-center justify-center">
                    {p.imageDisplayUrl ? (
                      <img src={p.imageDisplayUrl} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <Package size={32} className="text-slate-300" />
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs font-bold text-slate-800 line-clamp-2">{p.name}</p>
                    <p className="text-sm font-bold text-emerald-600 mt-1">R$ {p.salePrice.toFixed(2)}</p>
                    <p className={cn(
                      "text-[10px] mt-0.5",
                      low ? "text-rose-600 font-bold" : "text-slate-400"
                    )}>
                      Estoque: {p.stock} {p.unit}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart */}
      <div className="bg-white rounded-3xl border border-slate-100 p-4 flex flex-col gap-3 h-fit lg:sticky lg:top-4">
        <h3 className="font-bold text-slate-900 flex items-center gap-2">
          <ShoppingCart size={18} /> Carrinho ({cart.length})
        </h3>

        {cart.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-6">Toque em um produto para adicionar.</p>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-auto">
            {cart.map(l => (
              <div key={l.productId} className="border border-slate-100 rounded-xl p-2 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-bold flex-1">{l.productName}</p>
                  <button onClick={() => setQty(l.productId, 0)} className="text-rose-500 hover:text-rose-700">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
                    <button onClick={() => setQty(l.productId, l.quantity - 1)} className="p-1 hover:bg-slate-50">
                      <Minus size={12} />
                    </button>
                    <input
                      type="number" step="0.001" value={l.quantity}
                      onChange={e => setQty(l.productId, parseFloat(e.target.value) || 0)}
                      className="w-14 text-center text-xs py-1 outline-none"
                    />
                    <button onClick={() => setQty(l.productId, l.quantity + 1)} className="p-1 hover:bg-slate-50">
                      <Plus size={12} />
                    </button>
                  </div>
                  <span className="text-[10px] text-slate-400">×</span>
                  <input
                    type="number" step="0.01" value={l.unitPrice}
                    onChange={e => setPrice(l.productId, parseFloat(e.target.value) || 0)}
                    className="w-20 text-xs border border-slate-200 rounded-lg px-2 py-1 outline-none"
                  />
                  <span className="ml-auto text-xs font-bold text-emerald-700">
                    R$ {(l.quantity * l.unitPrice).toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-slate-100 pt-3 space-y-2">
          <div className="grid grid-cols-4 gap-1">
            {(Object.keys(PAYMENT_LABELS) as PaymentMethod[]).map(m => (
              <button
                key={m}
                onClick={() => setPaymentMethod(m)}
                className={cn(
                  "text-[10px] font-bold py-2 rounded-lg border transition-colors uppercase",
                  paymentMethod === m ? PAYMENT_COLORS[m] : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                )}
              >
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
          {paymentMethod === 'fiado' && (
            <input
              value={customerName} onChange={e => setCustomerName(e.target.value)}
              placeholder="Nome do cliente (fiado)"
              className="w-full text-xs border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 outline-none"
            />
          )}
          <input
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Observação (opcional)"
            className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 outline-none"
          />

          <div className="flex justify-between text-xs text-slate-500">
            <span>Custo</span><span>R$ {totalCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs text-slate-500">
            <span>Lucro estimado</span>
            <span className={profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>R$ {profit.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold border-t border-slate-100 pt-2">
            <span>Total</span><span className="text-emerald-700">R$ {total.toFixed(2)}</span>
          </div>

          <button
            onClick={finalize}
            disabled={cart.length === 0 || saving}
            className="w-full py-3 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Salvando...' : 'Finalizar Venda'}
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// PRODUCTS SCREEN
// =========================================================================
function ProductsScreen({ products }: { products: Product[] }) {
  const [modal, setModal] = useState<{ open: boolean; editing?: Product }>({ open: false });
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    try { await deleteProduct(id); setDeleting(null); }
    catch (e: any) { alert('Erro: ' + (e?.message || e)); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{products.length} produto(s) cadastrado(s)</p>
        <button
          onClick={() => setModal({ open: true })}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700"
        >
          <Plus size={16} /> Novo Produto
        </button>
      </div>

      {products.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-12 text-center">
          <Package size={40} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500">Nenhum produto cadastrado ainda.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {products.map(p => (
            <div key={p.id} className={cn(
              "bg-white rounded-2xl border p-3 flex gap-3",
              p.active ? "border-slate-100" : "border-slate-200 opacity-60"
            )}>
              <div className="w-20 h-20 bg-slate-50 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden">
                {p.imageDisplayUrl ? (
                  <img src={p.imageDisplayUrl} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <Package size={28} className="text-slate-300" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-slate-900 truncate">{p.name}</p>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => setModal({ open: true, editing: p })}
                      className="w-7 h-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center justify-center">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => setDeleting(p.id)}
                      className="w-7 h-7 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 flex items-center justify-center">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                  <div className="flex gap-3">
                    <span>Custo: <b className="text-slate-700">R$ {p.costPrice.toFixed(2)}</b></span>
                    <span>Venda: <b className="text-emerald-700">R$ {p.salePrice.toFixed(2)}</b></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "font-bold",
                      p.stock <= 0 ? "text-rose-600" : p.stock < 5 ? "text-amber-600" : "text-slate-700"
                    )}>
                      {p.stock <= 0 && <AlertTriangle size={10} className="inline mr-1" />}
                      Estoque: {p.stock} {p.unit}
                    </span>
                    {!p.active && <span className="text-[10px] uppercase font-bold text-slate-400">Inativo</span>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal.open && (
        <ProductModal
          product={modal.editing}
          onClose={() => setModal({ open: false })}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Excluir Produto?"
          description="O produto será removido permanentemente. Vendas antigas mantêm o histórico."
          onCancel={() => setDeleting(null)}
          onConfirm={() => handleDelete(deleting)}
        />
      )}
    </div>
  );
}

// =========================================================================
// PRODUCT MODAL
// =========================================================================
function ProductModal({ product, onClose }: { product?: Product; onClose: () => void }) {
  const [name, setName] = useState(product?.name ?? '');
  const [costPrice, setCostPrice] = useState(product?.costPrice?.toString() ?? '');
  const [salePrice, setSalePrice] = useState(product?.salePrice?.toString() ?? '');
  const [stock, setStock] = useState(product?.stock?.toString() ?? '0');
  const [unit, setUnit] = useState(product?.unit ?? 'un');
  const [active, setActive] = useState(product?.active ?? true);
  const [notes, setNotes] = useState(product?.notes ?? '');
  const [imagePath, setImagePath] = useState<string | undefined>(product?.imageUrl);
  const [imagePreview, setImagePreview] = useState<string | undefined>(product?.imageDisplayUrl);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const path = await uploadProductImage(file);
      setImagePath(path);
      setImagePreview(URL.createObjectURL(file));
    } catch (err: any) {
      alert('Erro no upload: ' + (err?.message || err));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const cost = parseFloat(costPrice) || 0;
    const sale = parseFloat(salePrice) || 0;
    const stk = parseFloat(stock) || 0;
    setSaving(true);
    try {
      await saveProduct({
        id: product?.id,
        name: name.trim(),
        imageUrl: imagePath,
        costPrice: cost,
        salePrice: sale,
        stock: stk,
        unit,
        active,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err: any) {
      alert('Erro ao salvar: ' + (err?.message || err));
    } finally {
      setSaving(false);
    }
  };

  const margin = (parseFloat(salePrice) || 0) - (parseFloat(costPrice) || 0);
  const marginPct = parseFloat(costPrice) > 0 ? (margin / parseFloat(costPrice)) * 100 : 0;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-auto">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl my-8">
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">{product ? 'Editar Produto' : 'Novo Produto'}</h2>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X size={22} />
            </button>
          </div>

          {/* Image upload */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-32 h-32 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden">
              {imagePreview ? (
                <img src={imagePreview} alt="preview" className="w-full h-full object-cover" />
              ) : (
                <Package size={40} className="text-slate-300" />
              )}
            </div>
            <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">
              <Upload size={12} /> {uploading ? 'Enviando...' : imagePath ? 'Trocar imagem' : 'Adicionar imagem'}
              <input type="file" accept="image/*" onChange={handleFile} className="hidden" disabled={uploading} />
            </label>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-slate-500">Nome</label>
            <input value={name} onChange={e => setName(e.target.value)} required
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:border-indigo-400" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-slate-500">Preço custo</label>
              <input type="number" step="0.01" min="0" value={costPrice}
                onChange={e => setCostPrice(e.target.value)} required placeholder="0,00"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-indigo-400" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-slate-500">Preço venda</label>
              <input type="number" step="0.01" min="0" value={salePrice}
                onChange={e => setSalePrice(e.target.value)} required placeholder="0,00"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-indigo-400" />
            </div>
          </div>
          {parseFloat(costPrice) > 0 && parseFloat(salePrice) > 0 && (
            <p className="text-[11px] text-slate-500">
              Margem: <b className={margin >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                R$ {margin.toFixed(2)} ({marginPct.toFixed(1)}%)
              </b>
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-slate-500">Estoque</label>
              <input type="number" step="0.001" value={stock}
                onChange={e => setStock(e.target.value)} required
                className="w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-indigo-400" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-slate-500">Unidade</label>
              <select value={unit} onChange={e => setUnit(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-indigo-400 bg-white">
                <option value="un">Unidade</option>
                <option value="kg">Kg</option>
                <option value="saco">Saco</option>
                <option value="m">Metro</option>
                <option value="L">Litro</option>
                <option value="cx">Caixa</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            <span className="text-sm">Produto ativo (aparece no PDV)</span>
          </label>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase text-slate-500">Observações</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 outline-none focus:border-indigo-400" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl font-medium text-slate-600 hover:bg-slate-50 border border-slate-200">
              Cancelar
            </button>
            <button type="submit" disabled={saving || uploading}
              className="flex-1 px-4 py-2.5 rounded-xl font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Salvando...' : (product ? 'Salvar' : 'Cadastrar')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// =========================================================================
// HISTORY SCREEN
// =========================================================================
function HistoryScreen({ sales, items }: { sales: Sale[]; items: SaleItem[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const thisYear = today.slice(0, 4);

  const sorted = [...sales].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
  const todayTotal = sorted.filter(s => s.date === today).reduce((a, s) => a + s.totalValue, 0);
  const monthTotal = sorted.filter(s => s.date.startsWith(thisMonth)).reduce((a, s) => a + s.totalValue, 0);
  const yearTotal = sorted.filter(s => s.date.startsWith(thisYear)).reduce((a, s) => a + s.totalValue, 0);

  const itemsBySale = useMemo(() => {
    const map = new Map<string, SaleItem[]>();
    items.forEach(it => {
      const arr = map.get(it.saleId) || [];
      arr.push(it);
      map.set(it.saleId, arr);
    });
    return map;
  }, [items]);

  const handleDelete = async (id: string) => {
    try { await deleteSale(id); setDeleting(null); }
    catch (e: any) { alert('Erro: ' + (e?.message || e)); }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <StatBox label="Hoje" value={todayTotal} color="slate" />
        <StatBox label="Mês" value={monthTotal} color="emerald" />
        <StatBox label="Ano" value={yearTotal} color="indigo" />
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white rounded-3xl border border-dashed border-slate-200 p-12 text-center">
          <HistoryIcon size={40} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500">Nenhuma venda registrada ainda.</p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-100 divide-y divide-slate-100">
          {sorted.map(s => {
            const its = itemsBySale.get(s.id) || [];
            const isOpen = expanded === s.id;
            const cost = its.reduce((a, i) => a + i.quantity * i.unitCost, 0);
            const profit = s.totalValue - cost;
            return (
              <div key={s.id} className="p-3">
                <div className="flex items-center gap-2">
                  <button onClick={() => setExpanded(isOpen ? null : s.id)}
                    className="flex-1 flex items-center gap-2 text-left">
                    {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-700">
                          {format(parseISO(s.date), 'dd/MM/yyyy', { locale: ptBR })}
                        </span>
                        <span className={cn(
                          "text-[10px] uppercase font-bold px-2 py-0.5 rounded border",
                          PAYMENT_COLORS[s.paymentMethod]
                        )}>
                          {PAYMENT_LABELS[s.paymentMethod]}
                        </span>
                        {s.customerName && (
                          <span className="text-[10px] text-slate-500">→ {s.customerName}</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400">{its.length} item(ns){s.notes ? ` • ${s.notes}` : ''}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-emerald-700">R$ {s.totalValue.toFixed(2)}</p>
                      {cost > 0 && (
                        <p className={cn("text-[10px]", profit >= 0 ? "text-emerald-500" : "text-rose-500")}>
                          Lucro R$ {profit.toFixed(2)}
                        </p>
                      )}
                    </div>
                  </button>
                  <button onClick={() => setDeleting(s.id)}
                    className="w-7 h-7 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 flex items-center justify-center">
                    <Trash2 size={12} />
                  </button>
                </div>
                {isOpen && its.length > 0 && (
                  <div className="mt-3 ml-6 space-y-1">
                    {its.map(i => (
                      <div key={i.id} className="flex justify-between text-xs text-slate-600 border-l-2 border-slate-100 pl-3 py-1">
                        <span>{i.productName} × {i.quantity}</span>
                        <span className="font-bold">R$ {(i.quantity * i.unitPrice).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Excluir Venda?"
          description="A venda e seus itens serão removidos. O estoque será devolvido automaticamente."
          onCancel={() => setDeleting(null)}
          onConfirm={() => handleDelete(deleting)}
        />
      )}
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color: 'slate' | 'emerald' | 'indigo' }) {
  const styles = {
    slate: 'bg-white border-slate-100 text-slate-900',
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    indigo: 'bg-indigo-50 border-indigo-100 text-indigo-700',
  }[color];
  const labelStyles = {
    slate: 'text-slate-400',
    emerald: 'text-emerald-500',
    indigo: 'text-indigo-500',
  }[color];
  return (
    <div className={cn("rounded-2xl border p-3", styles)}>
      <p className={cn("text-[10px] uppercase font-bold", labelStyles)}>{label}</p>
      <p className="text-lg font-bold">R$ {value.toFixed(2)}</p>
    </div>
  );
}

function ConfirmDialog({ title, description, onCancel, onConfirm }: {
  title: string; description: string; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-8 text-center">
        <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <Trash2 size={32} />
        </div>
        <h2 className="text-xl font-bold mb-2">{title}</h2>
        <p className="text-slate-500 mb-8 text-sm">{description}</p>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 px-4 py-2.5 rounded-xl font-medium text-slate-600 hover:bg-slate-50 border border-slate-200">
            Cancelar
          </button>
          <button onClick={onConfirm}
            className="flex-1 px-4 py-2.5 rounded-xl font-medium bg-rose-600 text-white hover:bg-rose-700">
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}
