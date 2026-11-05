import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Coffee,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Menu as MenuIcon,
  Minus,
  Plus,
  ReceiptText,
  Search,
  ShoppingBag,
  Sparkles,
  Utensils,
  Users,
  WalletCards,
  X,
  Banknote,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { SalonView } from '@/components/salon/SalonView';
import { CashShiftPanel } from '@/components/caja/CashShiftPanel';
import { CashierOrders } from '@/components/caja/CashierOrders';
import { KitchenBoard } from '@/components/cocina/KitchenBoard';
import '@/components/carta/menu-availability.css';
import { InventoryView } from '@/components/inventory/InventoryView';
import { InventoryImportDialog } from '@/components/inventory/InventoryImportDialog';
import { fetchOpenCashShift, formatOpenedAt, type CashShiftSummary } from '@/lib/cashShift';
import { MANAGING_ROLES, roleLabels } from '@/lib/staffRoles';
import { TeamView } from '@/components/equipo/TeamView';
import { ForgotPasswordScreen } from '@/components/auth/ForgotPasswordScreen';

type View = 'inicio' | 'salon' | 'carta' | 'caja' | 'cocina' | 'inventario' | 'perfil' | 'equipo';

type Product = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  image: string;
  servings: number | null;
};

type OrderSubmitResult = { ok: true; orderNumber: number } | { ok: false; message: string };

type UserProfile = {
  display_name: string;
  role: string;
};

const greetingForHour = (): string => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
};

const FALLBACK_PRODUCT_IMAGE = 'https://images.pexels.com/photos/23086/food-restaurant-kitchen-meat-23086.jpg?auto=compress&cs=tinysrgb&h=650&w=940';

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<View>('inicio');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [dataError, setDataError] = useState<string | null>(null);
  const [orderMessage, setOrderMessage] = useState<string | null>(null);
  const [category, setCategory] = useState('Todos');
  const [search, setSearch] = useState('');
  const [kitchenCount, setKitchenCount] = useState('0');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [cashShift, setCashShift] = useState<CashShiftSummary | null>(null);
  const [cashPanelOpen, setCashPanelOpen] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const loadSession = async (): Promise<void> => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setAuthLoading(false);
    };

    void loadSession();
    const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, nextSession: Session | null) => {
      setSession(nextSession);
      setAuthLoading(false);
      if (!nextSession) setProfile(null);
    });

    return () => authSubscription.subscription.unsubscribe();
  }, []);

  const loadCatalog = useCallback(async (): Promise<void> => {
    const [categoriesResult, productsResult, availabilityResult] = await Promise.all([
      supabase.from('nexora_categories').select('id, name').eq('is_active', true).order('sort_order'),
      supabase.from('nexora_products').select('id, category_id, name, description, price_cop, image_url').eq('is_active', true).eq('is_available', true).order('created_at'),
      supabase.rpc('get_nexora_menu_availability'),
    ]);

    if (categoriesResult.error || productsResult.error || availabilityResult.error) {
      setDataError('No pudimos cargar la carta desde la base de datos.');
      return;
    }

    const categoryNames = new Map<string, string>(
      (categoriesResult.data ?? []).map((category: { id: string; name: string }) => [category.id, category.name]),
    );
    const servingsByProduct = new Map<string, number | null>(
      (availabilityResult.data ?? []).map((row: { product_id: string; servings_available: number | null }) => [row.product_id, row.servings_available]),
    );
    const loadedProducts: Product[] = (productsResult.data ?? []).map((product: { id: string; category_id: string; name: string; description: string; price_cop: number; image_url: string | null }) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price_cop,
      category: categoryNames.get(product.category_id) ?? 'Carta',
      image: product.image_url ?? FALLBACK_PRODUCT_IMAGE,
      servings: servingsByProduct.get(product.id) ?? null,
    }));
    setDataError(null);
    setProducts(loadedProducts);
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!session) return;
    const loadKitchenCount = async (): Promise<void> => {
      const { count, error } = await supabase
        .from('nexora_orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['submitted', 'accepted', 'ready']);
      if (!error && count !== null) setKitchenCount(String(count));
    };
    void loadKitchenCount();
  }, [session]);

  const refreshCashShift = useCallback(async (): Promise<void> => {
    const { shift } = await fetchOpenCashShift();
    setCashShift(shift);
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshCashShift();
  }, [session, refreshCashShift]);

  useEffect(() => {
    if (!session) return;
    const loadProfile = async (): Promise<void> => {
      const { data, error } = await supabase
        .from('nexora_profiles')
        .select('display_name, role')
        .eq('id', session.user.id)
        .maybeSingle();
      if (error || !data) return;
      setProfile({ display_name: data.display_name, role: data.role });
    };
    void loadProfile();
  }, [session]);

  const cartCount = Object.values(cart).reduce((total: number, quantity: number) => total + quantity, 0);
  const cartTotal = Object.entries(cart).reduce((total: number, [productId, quantity]: [string, number]) => {
    const product = products.find((item: Product) => item.id === productId);
    return total + (product?.price ?? 0) * quantity;
  }, 0);

  const filteredProducts = useMemo(() => products.filter((product: Product) => {
    const matchesCategory = category === 'Todos' || product.category === category;
    const matchesSearch = product.name.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  }), [category, search]);

  const updateCart = (productId: string, change: number): void => {
    setCart((current: Record<string, number>) => {
      const nextQuantity = (current[productId] ?? 0) + change;
      if (nextQuantity <= 0) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      return { ...current, [productId]: nextQuantity };
    });
  };

  const submitOrder = async (orderCart: Record<string, number>, guestName: string | null = null, guestPhone: string | null = null): Promise<OrderSubmitResult> => {
    const items = Object.entries(orderCart).map(([productId, quantity]: [string, number]) => ({ product_id: productId, quantity }));
    if (items.length === 0) return { ok: false, message: 'Agrega productos antes de continuar.' };
    const requestedTotal = items.reduce((total: number, item: { product_id: string; quantity: number }) => total + (products.find((product: Product) => product.id === item.product_id)?.price ?? 0) * item.quantity, 0);
    setOrderMessage(null);
    const { data, error } = await supabase.rpc('create_nexora_order', { items, requested_total_cop: requestedTotal, guest_name_input: guestName, guest_phone_input: guestPhone });
    if (error || !data?.[0]) {
      const message = error && /inventario suficiente|no está disponible/i.test(error.message) ? error.message : 'No pudimos guardar el pedido. Revisa la conexión e inténtalo de nuevo.';
      setOrderMessage(message);
      void loadCatalog();
      return { ok: false, message };
    }
    setCart({});
    setOrderMessage(`Pedido #${data[0].order_number} guardado correctamente.`);
    void loadCatalog();
    return { ok: true, orderNumber: data[0].order_number };
  };

  if (authLoading) return <div className="auth-loading">Cargando Nexora...</div>;
  if (!session && !guestMode && !forgotPassword) return <AuthScreen onGuestAccess={() => setGuestMode(true)} onForgotPassword={() => setForgotPassword(true)} />;
  if (!session && forgotPassword) return <ForgotPasswordScreen onBack={() => setForgotPassword(false)} />;
  if (!session && guestMode) return <GuestExperience products={products} onSubmitOrder={submitOrder} />;

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark">N</span><span>Nexora</span></div>
        <div className="location-selector"><MapPin size={15} /><span>Laureles</span><ChevronDown size={15} /></div>
        <button className={`open-register ${cashShift ? '' : 'closed'}`} type="button" onClick={() => setCashPanelOpen(true)}>
          <span className="status-dot" />
          {cashShift ? 'Caja abierta' : 'Caja cerrada'}
          {cashShift && <span>desde {formatOpenedAt(cashShift.opened_at)}</span>}
        </button>

        <nav className="main-nav" aria-label="Navegación principal">
          <p className="nav-label">Operación</p>
          <NavButton icon={<LayoutDashboard size={17} />} label="Inicio" active={view === 'inicio'} onClick={() => setView('inicio')} />
          <NavButton icon={<ReceiptText size={17} />} label="Pedidos" badge="3" active={false} onClick={() => setView('carta')} />
          <NavButton icon={<Utensils size={17} />} label="Salón" active={view === 'salon'} onClick={() => setView('salon')} />
          <NavButton icon={<Banknote size={17} />} label="Caja" active={view === 'caja'} onClick={() => setView('caja')} />
          <NavButton icon={<Clock3 size={17} />} label="Cocina" badge={kitchenCount} active={view === 'cocina'} onClick={() => setView('cocina')} />
          <NavButton icon={<ShoppingBag size={17} />} label="Despacho" active={false} onClick={() => setView('carta')} />
          <NavButton icon={<BookOpen size={17} />} label="Reservas" active={false} onClick={() => setView('salon')} />
          <p className="nav-label">Catálogo</p>
          <NavButton icon={<MenuIcon size={17} />} label="Carta" active={view === 'carta'} onClick={() => setView('carta')} />
          <NavButton icon={<Boxes size={17} />} label="Inventario" active={view === 'inventario'} onClick={() => setView('inventario')} />
          <p className="nav-label">Relaciones</p>
          <NavButton icon={<Users size={17} />} label="Clientes" active={false} onClick={() => setView('inicio')} />
          <p className="nav-label">Administración</p>
          {profile && MANAGING_ROLES.includes(profile.role) && <NavButton icon={<Users size={17} />} label="Equipo" active={view === 'equipo'} onClick={() => setView('equipo')} />}
          <NavButton icon={<WalletCards size={17} />} label="Compras y gastos" active={false} onClick={() => setView('inicio')} />
          <NavButton icon={<BarChart3 size={17} />} label="Reportes" active={false} onClick={() => setView('inicio')} />
          <NavButton icon={<Users size={17} />} label="Mi perfil" active={view === 'perfil'} onClick={() => setView('perfil')} />
        </nav>

        <button className="profile" type="button" onClick={() => setView('perfil')}><span className="avatar">{(profile?.display_name?.slice(0, 2) ?? session?.user.email?.slice(0, 2) ?? 'NX').toUpperCase()}</span><div><strong>{profile?.display_name ?? session?.user.email ?? 'Usuario Nexora'}</strong><small>{roleLabels[profile?.role ?? 'owner'] ?? 'Propietario'} · Ver perfil</small></div><LogOut size={15} /></button>
      </aside>

      {cashPanelOpen && <CashShiftPanel shift={cashShift} onChanged={refreshCashShift} onClose={() => setCashPanelOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">N</span>Nexora</div>
          <div className="breadcrumb"><span>Laureles</span><span>/</span><strong>{view === 'inicio' ? 'Inicio' : view === 'salon' ? 'Salón' : view === 'caja' ? 'Caja' : view === 'cocina' ? 'Cocina' : view === 'inventario' ? 'Inventario' : view === 'perfil' ? 'Mi perfil' : view === 'equipo' ? 'Equipo' : 'Carta y pedidos'}</strong></div>
          <div className="topbar-actions"><span className="credit-pill"><CircleDollarSign size={15} /> $270</span><button className="icon-button" type="button" aria-label="Notificaciones"><Bell size={18} /><span className="notification-dot" /></button><span className="language">ES</span><span className="avatar">{(profile?.display_name?.slice(0, 2) ?? 'MA').toUpperCase()}</span></div>
        </header>

        {view === 'inicio' && <Dashboard profile={profile} onNavigate={(nextView: View) => setView(nextView)} />}
        {view === 'salon' && <SalonView />}
        {view === 'caja' && <CashierOrders />}
        {view === 'cocina' && <KitchenBoard />}
        {view === 'inventario' && <InventoryView onImport={() => setImportOpen(true)} />}
        {importOpen && <InventoryImportDialog onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); setView('inventario'); }} />}
        {view === 'equipo' && session && profile && MANAGING_ROLES.includes(profile.role) && <TeamView currentUserId={session.user.id} callerRole={profile.role} />}
        {view === 'perfil' && <ProfileScreen profile={profile} session={session} onProfileUpdated={setProfile} />}
        {dataError && <div className="data-notice" role="alert">{dataError}</div>}
        {view === 'carta' && <MenuOrders products={products} cart={cart} cartCount={cartCount} cartTotal={cartTotal} category={category} filteredProducts={filteredProducts} orderMessage={orderMessage} onCategoryChange={setCategory} onSearchChange={setSearch} onUpdateCart={updateCart} onSubmitOrder={() => void submitOrder(cart)} />}
      </main>
    </div>
  );
}

type NavButtonProps = { icon: React.ReactNode; label: string; badge?: string; active: boolean; onClick: () => void };

function NavButton({ icon, label, badge, active, onClick }: NavButtonProps) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick} type="button">{icon}<span>{label}</span>{badge && <b>{badge}</b>}</button>;
}

type DashboardProps = { profile: UserProfile | null; onNavigate: (view: View) => void };

function Dashboard({ profile, onNavigate }: DashboardProps) {
  const displayName = profile?.display_name ?? 'Usuario';
  return (
    <div className="page-wrap">
      <div className="page-heading"><div><p className="eyebrow">Jueves, 29 de octubre de 2026</p><h1>{greetingForHour()}, {displayName}</h1><p className="muted">Esto es lo que está pasando en tu restaurante hoy.</p></div><button className="outline-button" type="button" onClick={() => onNavigate('inicio')}><BarChart3 size={16} /> Ver reportes</button></div>
      <section className="metric-grid">
        <Metric label="Ventas hoy" value="$416.800" detail="7 pedidos · ticket $59.543" trend="+12,4%" />
        <Metric label="Margen del día" value="54%" detail="$226.147 de utilidad" trend="Saludable" positive />
        <Metric label="Pendiente por cobrar" value="$0" detail="Al día · nada sin cobrar" trend="Al día" positive />
        <Metric label="Meta del día" value="$7.210.000" detail="Te faltan $8.362.314" trend="Recuperando" />
      </section>
      <section className="dashboard-grid">
        <div className="panel chart-panel"><div className="panel-heading"><div><h2>Ventas últimos 7 días</h2><p className="muted">Tendencia reciente del local</p></div><button className="text-button" type="button">Ver detalle <ArrowUpRight size={14} /></button></div><div className="chart"><div className="chart-y"><span>10,5 M</span><span>7,0 M</span><span>3,5 M</span><span>0</span></div><svg viewBox="0 0 700 220" role="img" aria-label="Tendencia de ventas de los últimos siete días"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#f0b4a5" stopOpacity=".45" /><stop offset="100%" stopColor="#fff" stopOpacity="0" /></linearGradient></defs><path d="M35 55 C120 35, 155 40, 210 88 S305 175, 380 142 S510 118, 570 133 S645 178, 680 188 L680 220 L35 220 Z" fill="url(#chart-fill)" /><path d="M35 55 C120 35, 155 40, 210 88 S305 175, 380 142 S510 118, 570 133 S645 178, 680 188" fill="none" stroke="#d9593b" strokeWidth="4" strokeLinecap="round" /><circle cx="680" cy="188" r="6" fill="#fff" stroke="#d9593b" strokeWidth="4" /></svg></div><div className="chart-days"><span>23 oct</span><span>24 oct</span><span>25 oct</span><span>26 oct</span><span>27 oct</span><span>28 oct</span><span>29 oct</span></div></div>
        <div className="panel payments-panel"><div className="panel-heading"><div><h2>Cómo te pagaron hoy</h2><p className="muted">Por medio de pago</p></div><WalletCards size={17} color="#9ba8a1" /></div><PaymentRow label="Efectivo" value="$141.200" percentage="33%" color="coral" /><PaymentRow label="Transferencia" value="$87.600" percentage="21%" color="dark" /><PaymentRow label="Bre-B" value="$81.600" percentage="19%" color="lime" /><PaymentRow label="T. Crédito" value="$71.600" percentage="17%" color="slate" /><PaymentRow label="T. Débito" value="$39.800" percentage="9%" color="light" /></div>
      </section>
      <div className="section-title"><h2>Ahora mismo</h2><span>Actualizado hace 2 min</span></div>
      <section className="quick-grid"><QuickCard icon={<ShoppingBag size={17} />} label="Pedidos abiertos" value="3" action="Ir a pedidos" onClick={() => onNavigate('carta')} /><QuickCard icon={<Utensils size={17} />} label="Mesas ocupadas" value="1 / 20" action="Ir a mesas" onClick={() => onNavigate('salon')} /><QuickCard icon={<Clock3 size={17} />} label="Tickets en cocina" value="1" action="Ver cocina" onClick={() => onNavigate('cocina')} /><QuickCard icon={<Boxes size={17} />} label="Insumos en alerta" value="13" action="Ver inventario" onClick={() => onNavigate('carta')} /></section>
    </div>
  );
}

function Metric({ label, value, detail, trend, positive = false }: { label: string; value: string; detail: string; trend: string; positive?: boolean }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><ArrowUpRight size={16} /></div><strong>{value}</strong><div className="metric-bottom"><span>{detail}</span><em className={positive ? 'positive' : ''}>{trend}</em></div></article>;
}

function PaymentRow({ label, value, percentage, color }: { label: string; value: string; percentage: string; color: string }) {
  return <div className="payment-row"><div><span>{label}</span><strong>{value} <small>· {percentage}</small></strong></div><div className={`payment-bar ${color}`}><span style={{ width: percentage }} /></div></div>;
}

function QuickCard({ icon, label, value, action, onClick }: { icon: React.ReactNode; label: string; value: string; action: string; onClick: () => void }) {
  return <article className="quick-card"><div className="quick-card-top"><span>{icon}</span><ShoppingBag size={15} /></div><p>{label}</p><strong>{value}</strong><button className="text-button" type="button" onClick={onClick}>{action} <ArrowUpRight size={14} /></button></article>;
}

type MenuOrdersProps = { products: Product[]; cart: Record<string, number>; cartCount: number; cartTotal: number; category: string; filteredProducts: Product[]; orderMessage: string | null; onCategoryChange: (category: string) => void; onSearchChange: (value: string) => void; onUpdateCart: (productId: string, change: number) => void; onSubmitOrder: () => void };

function MenuOrders({ products, cart, cartCount, cartTotal, category, filteredProducts, orderMessage, onCategoryChange, onSearchChange, onUpdateCart, onSubmitOrder }: MenuOrdersProps) {
  return <div className="page-wrap"><div className="page-heading"><div><p className="eyebrow">Catálogo · Operación</p><h1>Carta y pedidos</h1><p className="muted">Elige productos visualmente y arma una nueva cuenta.</p></div><div className="order-summary"><ShoppingBag size={18} /><strong>{cartCount}</strong><span>{formatCurrency(cartTotal)}</span></div></div><div className="menu-toolbar"><div className="category-tabs">{['Todos', 'Favoritos', 'Entradas', 'Para compartir'].map((item: string) => <button key={item} className={category === item ? 'selected' : ''} onClick={() => onCategoryChange(item)} type="button">{item}</button>)}</div><label className="search-field"><Search size={16} /><input aria-label="Buscar en la carta" onChange={(event: React.ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value)} placeholder="Buscar producto" /></label></div><div className="menu-layout"><section className="product-grid">{filteredProducts.map((product: Product) => <ProductCard key={product.id} product={product} quantity={cart[product.id] ?? 0} onUpdate={onUpdateCart} />)}</section><aside className="order-card"><div className="order-card-heading"><div><p className="eyebrow">Nueva cuenta</p><h2>Pedido actual</h2></div><button className="icon-button" type="button" aria-label="Cerrar pedido"><X size={17} /></button></div>{cartCount === 0 ? <div className="empty-order"><ShoppingBag size={28} /><strong>Tu pedido está vacío</strong><span>Agrega productos de la carta para comenzar.</span></div> : <><div className="order-lines">{Object.entries(cart).map(([productId, quantity]: [string, number]) => { const product = products.find((item: Product) => item.id === productId); if (!product) return null; return <div className="order-line" key={product.id}><div><strong>{product.name}</strong><span>{formatCurrency(product.price)} c/u</span></div><div className="quantity-control"><button onClick={() => onUpdateCart(product.id, -1)} type="button"><Minus size={13} /></button><b>{quantity}</b><button onClick={() => onUpdateCart(product.id, 1)} type="button"><Plus size={13} /></button></div></div>; })}</div><div className="order-total"><span>Total</span><strong>{formatCurrency(cartTotal)}</strong></div><button className="primary-button full-width" onClick={() => void onSubmitOrder()} type="button">Continuar pedido <ArrowUpRight size={16} /></button>{orderMessage && <p className="order-message" role="status">{orderMessage}</p>}</>}</aside></div></div>;
}

function ProductCard({ product, quantity, onUpdate }: { product: Product; quantity: number; onUpdate: (productId: string, change: number) => void }) {
  const soldOut = product.servings === 0;
  const reachedStockLimit = product.servings !== null && quantity >= product.servings;
  return <article className={`product-card ${soldOut ? 'sold-out' : ''}`}><img src={product.image} alt={product.name} /><div className="product-info"><div><span className="product-category">{product.category}</span><h3>{product.name}</h3><p>{product.description}</p></div><div className="product-bottom"><strong>{formatCurrency(product.price)}</strong>{soldOut ? <span className="sold-out-badge">Agotado</span> : quantity === 0 ? <button className="add-button" onClick={() => onUpdate(product.id, 1)} type="button"><Plus size={16} /> Agregar</button> : <div className="quantity-control"><button onClick={() => onUpdate(product.id, -1)} type="button"><Minus size={14} /></button><b>{quantity}</b><button onClick={() => onUpdate(product.id, 1)} type="button" disabled={reachedStockLimit} aria-label="Agregar uno más"><Plus size={14} /></button></div>}</div></div></article>;
}

function GuestExperience({ products, onSubmitOrder }: { products: Product[]; onSubmitOrder: (orderCart: Record<string, number>, guestName: string, guestPhone: string) => Promise<OrderSubmitResult> }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [category, setCategory] = useState('Todos');
  const [search, setSearch] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const cartCount = Object.values(cart).reduce((total: number, quantity: number) => total + quantity, 0);
  const cartTotal = Object.entries(cart).reduce((total: number, [productId, quantity]: [string, number]) => total + (products.find((product: Product) => product.id === productId)?.price ?? 0) * quantity, 0);
  const filteredProducts = useMemo(() => products.filter((product: Product) => (category === 'Todos' || product.category === category) && product.name.toLowerCase().includes(search.toLowerCase())), [category, products, search]);
  const updateCart = (productId: string, change: number): void => setCart((current: Record<string, number>) => { const nextQuantity = (current[productId] ?? 0) + change; if (nextQuantity <= 0) { const next = { ...current }; delete next[productId]; return next; } return { ...current, [productId]: nextQuantity }; });
  const placeGuestOrder = async (): Promise<void> => {
    if (!guestName.trim()) {
      setMessage({ tone: 'error', text: 'Escribe tu nombre en los datos del pedido para confirmarlo.' });
      return;
    }
    setMessage(null);
    const result = await onSubmitOrder(cart, guestName.trim(), guestPhone.trim());
    if (result.ok) {
      setCart({});
      setMessage({ tone: 'success', text: `Pedido #${result.orderNumber} enviado. Paga en caja para que cocina lo prepare.` });
      return;
    }
    setMessage({ tone: 'error', text: result.message });
  };
  return <main className="guest-shell"><header className="guest-header"><div className="brand-lockup"><span className="brand-mark">N</span><span>Nexora</span></div><span>Menú del restaurante</span></header><div className="guest-content"><div className="guest-intro"><p className="eyebrow">Cliente invitado</p><h1>Elige lo que quieres disfrutar</h1><p className="muted">No necesitas crear una cuenta. Solo te pediremos unos datos al confirmar.</p></div><MenuOrders products={products} cart={cart} cartCount={cartCount} cartTotal={cartTotal} category={category} filteredProducts={filteredProducts} orderMessage={null} onCategoryChange={setCategory} onSearchChange={setSearch} onUpdateCart={updateCart} onSubmitOrder={placeGuestOrder} /></div><div className="guest-checkout"><label>Nombre<input value={guestName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setGuestName(event.target.value)} placeholder="Tu nombre" /></label><label>Teléfono <span>(opcional)</span><input value={guestPhone} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setGuestPhone(event.target.value)} placeholder="300 000 0000" /></label><p className="guest-payment-note">Confirmas tu pedido y pagas en caja con efectivo, tarjeta o Bre-B. La cocina lo prepara cuando el pago queda aprobado.</p>{message && <p className={`guest-message ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}</div></main>;
}

function AuthScreen({ onGuestAccess, onForgotPassword }: { onGuestAccess: () => void; onForgotPassword: () => void }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);

    if (isSignUp) {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: displayName.trim() } },
      });
      if (signUpError) {
        setError('No pudimos crear la cuenta. Revisa los datos e inténtalo nuevamente.');
      } else if (!data.session) {
        setMessage('La cuenta fue creada. Revisa tu correo si se solicita confirmar la dirección.');
      }
    } else {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) setError('El correo o la contraseña no son correctos.');
    }

    setBusy(false);
  };

  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark">N</span><strong>Nexora</strong></div><p className="eyebrow">Restaurant OS</p><h1>{isSignUp ? 'Crea tu espacio de trabajo' : 'Bienvenido de nuevo'}</h1><p className="auth-description">{isSignUp ? 'Empieza a organizar la operación de tu restaurante.' : 'Ingresa para continuar con la operación de tu restaurante.'}</p><form onSubmit={(event: React.FormEvent<HTMLFormElement>) => void handleSubmit(event)}>{isSignUp && <label>Nombre<input value={displayName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)} placeholder="Tu nombre" required /></label>}<label>Correo electrónico<input type="email" value={email} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEmail(event.target.value)} placeholder="tu@restaurante.com" required /></label><label>Contraseña<input type="password" minLength={6} value={password} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setPassword(event.target.value)} placeholder="Mínimo 6 caracteres" required /></label>{error && <p className="auth-feedback error" role="alert">{error}</p>}{message && <p className="auth-feedback success" role="status">{message}</p>}<button className="primary-button auth-submit" type="submit" disabled={busy}><LogIn size={16} />{busy ? 'Procesando...' : isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}</button></form><button className="auth-switch" type="button" onClick={() => { setIsSignUp((current: boolean) => !current); setError(null); setMessage(null); }}>{isSignUp ? 'Ya tengo una cuenta' : 'Crear una cuenta'}</button><button className="guest-access" type="button" onClick={onGuestAccess}>Continuar como cliente invitado</button>{!isSignUp && <button className="auth-link" type="button" onClick={onForgotPassword}>¿Olvidaste tu contraseña?</button>}</section></main>;
}

type ProfileScreenProps = { profile: UserProfile | null; session: Session | null; onProfileUpdated: (profile: UserProfile) => void };

function ProfileScreen({ profile, session, onProfileUpdated }: ProfileScreenProps) {
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const role = profile?.role ?? 'owner';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name);
    }
  }, [profile]);

  const handleSave = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('update_nexora_profile', { display_name_input: displayName, role_input: role });
    if (rpcError || !data?.[0]) {
      setError('No pudimos guardar los cambios. Inténtalo de nuevo.');
      setBusy(false);
      return;
    }
    onProfileUpdated({ display_name: data[0].display_name, role: data[0].role });
    setMessage('Perfil actualizado correctamente.');
    setBusy(false);
  };

  const handleSignOut = async (): Promise<void> => {
    await supabase.auth.signOut();
  };

  return <div className="page-wrap"><div className="page-heading"><div><p className="eyebrow">Administración</p><h1>Mi perfil</h1><p className="muted">Personaliza tu nombre. Tu rol lo asigna un administrador.</p></div></div><div className="profile-screen"><section className="profile-card"><div className="profile-avatar-large">{(displayName?.slice(0, 2) ?? session?.user.email?.slice(0, 2) ?? 'NX').toUpperCase()}</div><div className="profile-info"><strong>{displayName || 'Usuario Nexora'}</strong><span className="profile-role-badge">{roleLabels[role] ?? 'Propietario'}</span><small>{session?.user.email ?? ''}</small></div></section><form className="profile-form" onSubmit={(event: React.FormEvent<HTMLFormElement>) => void handleSave(event)}><label>Nombre para mostrar<input value={displayName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)} placeholder="Tu nombre" required /></label><p className="muted">Rol en el equipo: <strong>{roleLabels[role] ?? 'Propietario'}</strong></p>{error && <p className="auth-feedback error" role="alert">{error}</p>}{message && <p className="auth-feedback success" role="status">{message}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Guardando...' : 'Guardar cambios'}</button></form><button className="auth-switch" type="button" onClick={() => void handleSignOut()}>Cerrar sesión</button></div></div>;
}

export default App;
