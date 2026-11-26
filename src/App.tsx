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
  Clock3,
  Coffee,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Megaphone,
  Menu as MenuIcon,
  Minus,
  Plus,
  ReceiptText,
  Search,
  ShoppingBag,
  Sparkles,
  Upload,
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
import { MenuImportExportDialog } from '@/components/inventory/MenuImportExportDialog';
import { fetchOpenCashShift, formatOpenedAt, type CashShiftSummary } from '@/lib/cashShift';
import { MANAGING_ROLES, roleLabels } from '@/lib/staffRoles';
import { TeamView } from '@/components/equipo/TeamView';
import { ForgotPasswordScreen } from '@/components/auth/ForgotPasswordScreen';
import { useDashboardData, methodLabels } from '@/lib/dashboardData';
import { OptionPickerDialog } from '@/components/salon/OptionPickerDialog';
import { OfflineStatusBar } from '@/components/OfflineStatusBar';
import { HoursView } from '@/components/horas/HoursView';
import { fetchFreshness, type FreshnessRow } from '@/lib/freshness';
import { fetchInsights } from '@/lib/assistant';
import { SalesView } from '@/components/finanzas/SalesView';
import { PurchasesExpensesView } from '@/components/finanzas/PurchasesExpensesView';
import { ReportsView } from '@/components/finanzas/ReportsView';
import { MarketingView } from '@/components/marketing/MarketingView';
import { ShiftPill } from '@/components/horas/ShiftPill';
import { DeviceGate } from '@/components/horas/DeviceGate';
import { useWorkTracking } from '@/lib/useWorkTracking';
import { deviceRequiredFor } from '@/lib/workTime';
import { readCache, writeCache } from '@/lib/offline/cache';
import { addSale, newClientId, removeSale, methodLabel, type OfflineMethod, type OfflineSale } from '@/lib/offline/salesStore';
import { useConnectivity, useOfflineSales } from '@/lib/offline/useOffline';
import { cartItems, cartKey, cartQuantityOfProduct, choiceNames, parseCartKey, useProductOptions, type ProductOptionMap } from '@/lib/productOptions';

type View = 'marketing' | 'inicio' | 'salon' | 'carta' | 'caja' | 'cocina' | 'inventario' | 'perfil' | 'equipo' | 'horas' | 'ventas' | 'gastos' | 'reportes';

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

/** Enlace para el código QR: https://tu-direccion/menu (también funciona ?menu). Abre la carta para clientes sin pedir ingreso. */
const IS_MENU_LINK = typeof window !== 'undefined'
  && (window.location.pathname.replace(/\/+$/, '') === '/menu' || new URLSearchParams(window.location.search).has('menu'));

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [guestMode, setGuestMode] = useState(IS_MENU_LINK);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<View>('inicio');
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const productOptions = useProductOptions();
  const online = useConnectivity();
  const offlineSales = useOfflineSales(Boolean(session), online);
  const tracking = useWorkTracking(session);
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
  const [menuImportOpen, setMenuImportOpen] = useState(false);

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
      const cached = readCache<Product[]>('catalog');
      if (cached) {
        setProducts(cached.value);
        setDataError(`Sin conexión con el servidor: se muestra la carta guardada el ${new Date(cached.savedAt).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Los agotados pueden no estar al día.`);
      } else {
        setDataError('No pudimos cargar la carta desde la base de datos.');
      }
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
      image: product.image_url?.trim() || FALLBACK_PRODUCT_IMAGE,
      servings: servingsByProduct.get(product.id) ?? null,
    }));
    setDataError(null);
    setProducts(loadedProducts);
    writeCache('catalog', loadedProducts);
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
    const { shift, error } = await fetchOpenCashShift();
    if (error) {
      // Sin internet no sabemos si la caja cambió: se conserva el último estado conocido.
      const cached = readCache<CashShiftSummary | null>('cash-shift');
      if (cached) setCashShift(cached.value);
      return;
    }
    setCashShift(shift);
    writeCache('cash-shift', shift);
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
      if (error || !data) {
        const cached = readCache<UserProfile>('profile');
        if (cached) setProfile(cached.value);
        return;
      }
      setProfile({ display_name: data.display_name, role: data.role });
      writeCache('profile', { display_name: data.display_name, role: data.role });
    };
    void loadProfile();
  }, [session]);

  const cartCount = Object.values(cart).reduce((total: number, quantity: number) => total + quantity, 0);
  const cartTotal = Object.entries(cart).reduce((total: number, [key, quantity]: [string, number]) => {
    const product = products.find((item: Product) => item.id === parseCartKey(key).productId);
    return total + (product?.price ?? 0) * quantity;
  }, 0);

  const filteredProducts = useMemo(() => products.filter((product: Product) => {
    const matchesCategory = category === 'Todos' || product.category === category;
    const matchesSearch = product.name.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  }), [category, products, search]);

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
    const items = cartItems(orderCart);
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

  const submitOfflineSale = (method: OfflineMethod): void => {
    const items = cartItems(cart);
    if (items.length === 0) { setOrderMessage('Agrega productos antes de cobrar.'); return; }
    if (!cashShift) { setOrderMessage('Abre la caja antes de cobrar. Toca "Caja cerrada" en el menú de la izquierda.'); return; }
    const lines = Object.entries(cart).map(([key, quantity]: [string, number]) => {
      const { productId, choiceIds } = parseCartKey(key);
      const product = products.find((item: Product) => item.id === productId);
      const detail = choiceNames(productOptions[productId], choiceIds);
      return { name: `${product?.name ?? 'Producto'}${detail ? ` (${detail})` : ''}`, quantity, unit_price: product?.price ?? 0 };
    });
    const sale: OfflineSale = { clientId: newClientId(), items, lines, method, total: cartTotal, occurredAt: new Date().toISOString(), status: 'pending', message: null, attempts: 0 };
    if (!addSale(sale)) {
      setOrderMessage('No se pudo guardar la venta en este equipo (el navegador bloqueó o llenó el almacenamiento). No la des por registrada: anótala a mano.');
      return;
    }
    setCart({});
    offlineSales.refresh();
    setOrderMessage(`Venta de ${formatCurrency(cartTotal)} en ${methodLabel[method].toLowerCase()} guardada en este equipo. Subirá sola cuando vuelva el internet.`);
  };

  if (IS_MENU_LINK) return <GuestExperience products={products} options={productOptions} onSubmitOrder={submitOrder} />;
  if (authLoading) return <div className="auth-loading">Cargando Nexora...</div>;
  if (!session && !guestMode && !forgotPassword) return <AuthScreen onGuestAccess={() => setGuestMode(true)} onForgotPassword={() => setForgotPassword(true)} />;
  if (!session && forgotPassword) return <ForgotPasswordScreen onBack={() => setForgotPassword(false)} />;
  if (!session && guestMode) return <GuestExperience products={products} onSubmitOrder={submitOrder} />;

  const signOutNow = async (): Promise<void> => {
    await tracking.finish(); // cierra el turno antes de salir
    await supabase.auth.signOut();
  };
  // El personal solo puede trabajar desde un equipo asignado al restaurante.
  if (session && profile && deviceRequiredFor(profile.role)) {
    if (tracking.status === 'checking') return <div className="auth-loading">Verificando este equipo...</div>;
    if (tracking.status === 'not_authorized') return <DeviceGate onRetry={tracking.recheck} onSignOut={() => void signOutNow()} />;
  }

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
        <ShiftPill tracking={tracking} isManager={Boolean(profile && MANAGING_ROLES.includes(profile.role))} />

        <nav className="main-nav" aria-label="Navegación principal">
          <p className="nav-label">Operación</p>
          <NavButton icon={<LayoutDashboard size={17} />} label="Inicio" active={view === 'inicio'} onClick={() => setView('inicio')} />
          <NavButton icon={<ReceiptText size={17} />} label="Pedidos" active={false} onClick={() => setView('carta')} />
          <NavButton icon={<Utensils size={17} />} label="Salón" active={view === 'salon'} onClick={() => setView('salon')} />
          <NavButton icon={<Banknote size={17} />} label="Caja" active={view === 'caja'} onClick={() => setView('caja')} />
          {profile && MANAGING_ROLES.includes(profile.role) && <NavButton icon={<ReceiptText size={17} />} label="Ventas" active={view === 'ventas'} onClick={() => setView('ventas')} />}
          <NavButton icon={<Clock3 size={17} />} label="Cocina" badge={kitchenCount} active={view === 'cocina'} onClick={() => setView('cocina')} />
          <NavButton icon={<ShoppingBag size={17} />} label="Despacho" active={false} onClick={() => setView('carta')} />
          <NavButton icon={<BookOpen size={17} />} label="Reservas" active={false} onClick={() => setView('salon')} />
          <p className="nav-label">Catálogo</p>
          <NavButton icon={<MenuIcon size={17} />} label="Carta" active={view === 'carta'} onClick={() => setView('carta')} />
          <NavButton icon={<Boxes size={17} />} label="Inventario" active={view === 'inventario'} onClick={() => setView('inventario')} />
          <p className="nav-label">Relaciones</p>
          {profile && (MANAGING_ROLES.includes(profile.role) || profile.role === 'marketing') && <NavButton icon={<Megaphone size={17} />} label="Marketing" active={view === 'marketing'} onClick={() => setView('marketing')} />}
          <NavButton icon={<Users size={17} />} label="Clientes" active={false} onClick={() => setView('inicio')} />
          <p className="nav-label">Administración</p>
          {profile && MANAGING_ROLES.includes(profile.role) && <NavButton icon={<Users size={17} />} label="Equipo" active={view === 'equipo'} onClick={() => setView('equipo')} />}
          {profile && MANAGING_ROLES.includes(profile.role) && <NavButton icon={<Clock3 size={17} />} label="Horas" active={view === 'horas'} onClick={() => setView('horas')} />}
          {profile && MANAGING_ROLES.includes(profile.role) && <NavButton icon={<WalletCards size={17} />} label="Compras y gastos" active={view === 'gastos'} onClick={() => setView('gastos')} />}
          {profile && MANAGING_ROLES.includes(profile.role) && <NavButton icon={<BarChart3 size={17} />} label="Reportes" active={view === 'reportes'} onClick={() => setView('reportes')} />}
          <NavButton icon={<Users size={17} />} label="Mi perfil" active={view === 'perfil'} onClick={() => setView('perfil')} />
        </nav>

        <button className="profile" type="button" onClick={() => setView('perfil')}><span className="avatar">{(profile?.display_name?.slice(0, 2) ?? session?.user.email?.slice(0, 2) ?? 'NX').toUpperCase()}</span><div><strong>{profile?.display_name ?? session?.user.email ?? 'Usuario Nexora'}</strong><small>{roleLabels[profile?.role ?? 'owner'] ?? 'Propietario'} · Ver perfil</small></div><LogOut size={15} /></button>
      </aside>

      {cashPanelOpen && <CashShiftPanel shift={cashShift} onChanged={refreshCashShift} onClose={() => setCashPanelOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-mark">N</span>Nexora</div>
          <div className="breadcrumb"><span>Laureles</span><span>/</span><strong>{view === 'inicio' ? 'Inicio' : view === 'salon' ? 'Salón' : view === 'caja' ? 'Caja' : view === 'cocina' ? 'Cocina' : view === 'inventario' ? 'Inventario' : view === 'perfil' ? 'Mi perfil' : view === 'equipo' ? 'Equipo' : view === 'horas' ? 'Horas' : view === 'ventas' ? 'Ventas' : view === 'gastos' ? 'Compras y gastos' : view === 'reportes' ? 'Reportes' : view === 'marketing' ? 'Marketing' : 'Carta y pedidos'}</strong></div>
          <div className="topbar-actions"><button className="icon-button" type="button" aria-label="Notificaciones"><Bell size={18} /></button><span className="language">ES</span><span className="avatar">{(profile?.display_name?.slice(0, 2) ?? 'MA').toUpperCase()}</span></div>
        </header>

        {view === 'inicio' && <Dashboard profile={profile} onNavigate={(nextView: View) => setView(nextView)} />}
        {view === 'salon' && <SalonView />}
        {view === 'caja' && <CashierOrders />}
        {view === 'cocina' && <KitchenBoard />}
        {view === 'inventario' && <InventoryView onImport={() => setImportOpen(true)} canManage={Boolean(profile && MANAGING_ROLES.includes(profile.role))} isKitchen={profile?.role === 'kitchen'} canSeeAlerts={Boolean(profile && (MANAGING_ROLES.includes(profile.role) || profile.role === 'kitchen' || profile.role === 'inventory'))} />}
        {importOpen && <InventoryImportDialog onClose={() => setImportOpen(false)} onImported={() => { setImportOpen(false); setView('inventario'); }} />}
        {menuImportOpen && profile && MANAGING_ROLES.includes(profile.role) && <MenuImportExportDialog onClose={() => setMenuImportOpen(false)} onImported={() => void loadCatalog()} />}
        {view === 'equipo' && session && profile && MANAGING_ROLES.includes(profile.role) && <TeamView currentUserId={session.user.id} callerRole={profile.role} />}
        {view === 'horas' && profile && MANAGING_ROLES.includes(profile.role) && <HoursView tracking={tracking} />}
        {view === 'ventas' && profile && MANAGING_ROLES.includes(profile.role) && <SalesView />}
        {view === 'gastos' && profile && MANAGING_ROLES.includes(profile.role) && <PurchasesExpensesView />}
        {view === 'reportes' && profile && MANAGING_ROLES.includes(profile.role) && <ReportsView onOpenSales={() => setView('ventas')} />}
        {view === 'marketing' && profile && (MANAGING_ROLES.includes(profile.role) || profile.role === 'marketing') && <MarketingView canApprove={MANAGING_ROLES.includes(profile.role)} />}
        {view === 'perfil' && <ProfileScreen profile={profile} session={session} onProfileUpdated={setProfile} onSignOut={signOutNow} />}
        <OfflineStatusBar online={online} sales={offlineSales.sales} syncing={offlineSales.syncing} onSync={() => void offlineSales.syncNow()} onDiscard={(clientId: string) => { removeSale(clientId); offlineSales.refresh(); }} />
        {dataError && <div className="data-notice" role="alert">{dataError}</div>}
        {view === 'carta' && <MenuOrders products={products} options={productOptions} cart={cart} cartCount={cartCount} cartTotal={cartTotal} category={category} filteredProducts={filteredProducts} orderMessage={orderMessage} onCategoryChange={setCategory} onSearchChange={setSearch} onUpdateCart={updateCart} onSubmitOrder={() => void submitOrder(cart)} onImportMenu={profile && MANAGING_ROLES.includes(profile.role) ? () => setMenuImportOpen(true) : undefined} offlineSale={!online ? submitOfflineSale : undefined} />}
      </main>
    </div>
  );
}

type NavButtonProps = { icon: React.ReactNode; label: string; badge?: string; active: boolean; onClick: () => void };

function NavButton({ icon, label, badge, active, onClick }: NavButtonProps) {
  return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick} type="button">{icon}<span>{label}</span>{badge && <b>{badge}</b>}</button>;
}

type DashboardProps = { profile: UserProfile | null; onNavigate: (view: View) => void };

const cop = (value: number): string => formatCurrency(value);

function Dashboard({ profile, onNavigate }: DashboardProps) {
  const displayName = profile?.display_name ?? 'Usuario';
  const canSeeSales = Boolean(profile && MANAGING_ROLES.includes(profile.role));
  const { data, loaded, reload } = useDashboardData();
  const [stale, setStale] = useState<{ name: string }[]>([]);
  useEffect(() => {
    if (!canSeeSales) return;
    void fetchInsights().then(async (smart) => {
      if (!smart.error) { setStale(smart.data.filter((row) => row.level === 'alert').map((row) => ({ name: row.name }))); return; }
      const simple = await fetchFreshness();
      setStale(simple.rows.filter((row: FreshnessRow) => row.level === 'alert').map((row: FreshnessRow) => ({ name: row.name })));
    });
  }, [canSeeSales]);
  const today = new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const maxDay = Math.max(1, ...(data?.days.map((day: { total: number }) => day.total) ?? [0]));
  const points = (data?.days ?? []).map((day: { total: number }, index: number) => `${35 + index * 107.5},${200 - (day.total / maxDay) * 170}`);
  const line = points.length > 0 ? `M${points.join(' L')}` : '';
  const area = points.length > 0 ? `${line} L680,220 L35,220 Z` : '';
  const methodTotal = (data?.byMethod ?? []).reduce((sum: number, row: { total: number }) => sum + row.total, 0);
  const paymentColors = ['coral', 'dark', 'lime', 'slate', 'light'];
  const ticket = data && data.paymentsToday > 0 ? Math.round(data.salesToday / data.paymentsToday) : 0;
  return (
    <div className="page-wrap">
      <div className="page-heading"><div><p className="eyebrow">{today}</p><h1>{greetingForHour()}, {displayName}</h1><p className="muted">Esto es lo que está pasando en tu restaurante hoy.</p></div><button className="outline-button" type="button" onClick={reload}><BarChart3 size={16} /> Actualizar</button></div>
      {loaded && !data && <div className="data-notice" role="alert">No pudimos cargar las cifras del día. Revisa la conexión e inténtalo de nuevo.</div>}
      <section className="metric-grid">
         <Metric onClick={canSeeSales ? () => onNavigate('ventas') : undefined} label="Ventas hoy" value={cop(data?.salesToday ?? 0)} detail={data && data.paymentsToday > 0 ? `${data.paymentsToday} pagos · ticket ${cop(ticket)}` : 'Aún no hay ventas hoy'} trend="Hoy" />
         <Metric onClick={canSeeSales ? () => onNavigate('ventas') : undefined} label="Ventas del mes" value={cop(data?.salesMonth ?? 0)} detail="Pagos recibidos este mes" trend="Mes" />
        <Metric label="Pendiente por cobrar" value={cop(data?.pendingToCollect ?? 0)} detail={data && data.pendingToCollect > 0 ? 'Pedidos sin pagar' : 'Al día · nada sin cobrar'} trend={data && data.pendingToCollect > 0 ? 'Por cobrar' : 'Al día'} positive={!data || data.pendingToCollect === 0} />
        <Metric label="Pedidos abiertos" value={String(data?.openOrders ?? 0)} detail="En curso ahora mismo" trend="Ahora" />
      </section>
      <section className="dashboard-grid">
        <div className="panel chart-panel"><div className="panel-heading"><div><h2>Ventas últimos 7 días</h2><p className="muted">{data && data.days.some((day: { total: number }) => day.total > 0) ? 'Pagos recibidos por día' : 'Todavía no hay ventas en los últimos 7 días'}</p></div></div><div className="chart"><div className="chart-y">{data && data.days.some((day: { total: number }) => day.total > 0) ? <><span>{cop(maxDay)}</span><span>{cop(Math.round(maxDay * 2 / 3))}</span><span>{cop(Math.round(maxDay / 3))}</span><span>0</span></> : <><span /><span /><span /><span>0</span></>}</div><svg viewBox="0 0 700 220" role="img" aria-label="Ventas de los últimos siete días"><defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#f0b4a5" stopOpacity=".45" /><stop offset="100%" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>{area && <path d={area} fill="url(#chart-fill)" />}{line && <path d={line} fill="none" stroke="#d9593b" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />}</svg></div><div className="chart-days">{(data?.days ?? []).map((day: { label: string }) => <span key={day.label}>{day.label}</span>)}</div></div>
        <div className="panel payments-panel"><div className="panel-heading"><div><h2>Cómo te pagaron hoy</h2><p className="muted">Por medio de pago</p></div><WalletCards size={17} color="#9ba8a1" /></div>{(data?.byMethod ?? []).length === 0 ? <p className="muted">Todavía no hay pagos hoy.</p> : (data?.byMethod ?? []).map((row: { method: string; total: number }, index: number) => <PaymentRow key={row.method} label={methodLabels[row.method] ?? row.method} value={cop(row.total)} percentage={`${Math.round((row.total / methodTotal) * 100)}%`} color={paymentColors[index % paymentColors.length]} />)}</div>
      </section>
      {stale.length > 0 && (
        <div className="auth-feedback error" role="alert" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
          <span><strong>{stale.length} {stale.length === 1 ? 'insumo se está apichando' : 'insumos se están apichando'}:</strong> {stale.slice(0, 4).map((row: { name: string }) => row.name).join(', ')}{stale.length > 4 ? '…' : ''}. Haz promoción o úsalos ya.</span>
          <button className="outline-button" type="button" onClick={() => onNavigate('inventario')}>Ver en Inventario &gt; Asistente</button>
        </div>
      )}
      <div className="section-title"><h2>Ahora mismo</h2><span>{loaded ? 'Actualizado al abrir esta pantalla' : 'Cargando…'}</span></div>
      <section className="quick-grid"><QuickCard icon={<ShoppingBag size={17} />} label="Pedidos abiertos" value={String(data?.openOrders ?? 0)} action="Ir a pedidos" onClick={() => onNavigate('carta')} /><QuickCard icon={<Utensils size={17} />} label="Mesas ocupadas" value={`${data?.occupiedTables ?? 0} / ${data?.totalTables ?? 0}`} action="Ir a mesas" onClick={() => onNavigate('salon')} /><QuickCard icon={<Clock3 size={17} />} label="Tickets en cocina" value={String(data?.openOrders ?? 0)} action="Ver cocina" onClick={() => onNavigate('cocina')} /><QuickCard icon={<Boxes size={17} />} label="Insumos en alerta" value={String(data?.lowStock ?? 0)} action="Ver inventario" onClick={() => onNavigate('inventario')} /></section>
    </div>
  );
}

function Metric({ label, value, detail, trend, positive = false, onClick }: { label: string; value: string; detail: string; trend: string; positive?: boolean; onClick?: () => void }) {
  return <article className="metric-card" onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} style={onClick ? { cursor: 'pointer' } : undefined} title={onClick ? 'Ver el detalle de ventas' : undefined}><div className="metric-top"><span>{label}</span><ArrowUpRight size={16} /></div><strong>{value}</strong><div className="metric-bottom"><span>{detail}</span><em className={positive ? 'positive' : ''}>{trend}</em></div></article>;
}

function PaymentRow({ label, value, percentage, color }: { label: string; value: string; percentage: string; color: string }) {
  return <div className="payment-row"><div><span>{label}</span><strong>{value} <small>· {percentage}</small></strong></div><div className={`payment-bar ${color}`}><span style={{ width: percentage }} /></div></div>;
}

function QuickCard({ icon, label, value, action, onClick }: { icon: React.ReactNode; label: string; value: string; action: string; onClick: () => void }) {
  return <article className="quick-card"><div className="quick-card-top"><span>{icon}</span><ShoppingBag size={15} /></div><p>{label}</p><strong>{value}</strong><button className="text-button" type="button" onClick={onClick}>{action} <ArrowUpRight size={14} /></button></article>;
}

type MenuOrdersProps = { products: Product[]; options: ProductOptionMap; cart: Record<string, number>; cartCount: number; cartTotal: number; category: string; filteredProducts: Product[]; orderMessage: string | null; onCategoryChange: (category: string) => void; onSearchChange: (value: string) => void; onUpdateCart: (productId: string, change: number) => void; onSubmitOrder: () => void; onImportMenu?: () => void; offlineSale?: (method: OfflineMethod) => void };

function MenuOrders({ products, options, cart, cartCount, cartTotal, category, filteredProducts, orderMessage, onCategoryChange, onSearchChange, onUpdateCart, onSubmitOrder, onImportMenu, offlineSale }: MenuOrdersProps) {
  const [picking, setPicking] = useState<Product | null>(null);
  const updateProduct = (productId: string, change: number): void => {
    if (change > 0 && options[productId]) {
      const product = products.find((item: Product) => item.id === productId);
      if (product) setPicking(product);
      return;
    }
    if (change < 0 && options[productId]) {
      const lastKey = Object.keys(cart).filter((key: string) => parseCartKey(key).productId === productId).pop();
      if (lastKey) onUpdateCart(lastKey, change);
      return;
    }
    onUpdateCart(productId, change);
  };
  return <div className="page-wrap">{picking && options[picking.id] && <OptionPickerDialog productName={picking.name} option={options[picking.id]} onClose={() => setPicking(null)} onConfirm={(choiceIds: string[]) => { onUpdateCart(cartKey(picking.id, choiceIds), 1); setPicking(null); }} />}<div className="page-heading"><div><p className="eyebrow">Catálogo · Operación</p><h1>Carta y pedidos</h1><p className="muted">Elige productos visualmente y arma una nueva cuenta.</p></div><div className="page-heading-actions">{onImportMenu && <button className="outline-button" type="button" onClick={onImportMenu}><Upload size={16} /> Importar o gestionar menú</button>}<div className="order-summary"><ShoppingBag size={18} /><strong>{cartCount}</strong><span>{formatCurrency(cartTotal)}</span></div></div></div><div className="menu-toolbar"><div className="category-tabs">{['Todos', ...Array.from(new Set(products.map((product: Product) => product.category)))].map((item: string) => <button key={item} className={category === item ? 'selected' : ''} onClick={() => onCategoryChange(item)} type="button">{item}</button>)}</div><label className="search-field"><Search size={16} /><input aria-label="Buscar en la carta" onChange={(event: React.ChangeEvent<HTMLInputElement>) => onSearchChange(event.target.value)} placeholder="Buscar producto" /></label></div><div className="menu-layout"><section className="product-grid">{products.length === 0 && <p className="muted">La carta no tiene productos activos todavía. Si ya importaste el menú, recarga la página; si sigue vacía, revisa la tabla de productos en la base de datos.</p>}{filteredProducts.map((product: Product) => <ProductCard key={product.id} product={product} quantity={cartQuantityOfProduct(cart, product.id)} onUpdate={updateProduct} />)}</section><aside className="order-card"><div className="order-card-heading"><div><p className="eyebrow">Nueva cuenta</p><h2>Pedido actual</h2></div><button className="icon-button" type="button" aria-label="Cerrar pedido"><X size={17} /></button></div>{cartCount === 0 ? <div className="empty-order"><ShoppingBag size={28} /><strong>Tu pedido está vacío</strong><span>Agrega productos de la carta para comenzar.</span></div> : <><div className="order-lines">{Object.entries(cart).map(([key, quantity]: [string, number]) => { const { productId, choiceIds } = parseCartKey(key); const product = products.find((item: Product) => item.id === productId); if (!product) return null; const detail = choiceNames(options[productId], choiceIds); return <div className="order-line" key={key}><div><strong>{product.name}</strong>{detail && <span>{detail}</span>}<span>{formatCurrency(product.price)} c/u</span></div><div className="quantity-control"><button onClick={() => onUpdateCart(key, -1)} type="button"><Minus size={13} /></button><b>{quantity}</b><button onClick={() => onUpdateCart(key, 1)} type="button"><Plus size={13} /></button></div></div>; })}</div><div className="order-total"><span>Total</span><strong>{formatCurrency(cartTotal)}</strong></div>{offlineSale ? <div className="offline-sale-actions"><button className="primary-button full-width" onClick={() => offlineSale('cash')} type="button">Cobrar en efectivo (sin internet)</button><button className="outline-button full-width" onClick={() => offlineSale('card')} type="button">Cobrar con tarjeta (sin internet)</button><small>Sin internet la venta se guarda en este equipo y sube sola después. Bre-B necesita internet para confirmar la referencia.</small></div> : <button className="primary-button full-width" onClick={() => void onSubmitOrder()} type="button">Continuar pedido <ArrowUpRight size={16} /></button>}{orderMessage && <p className="order-message" role="status">{orderMessage}</p>}</>}</aside></div></div>;
}

function ProductCard({ product, quantity, onUpdate }: { product: Product; quantity: number; onUpdate: (productId: string, change: number) => void }) {
  const soldOut = product.servings === 0;
  const reachedStockLimit = product.servings !== null && quantity >= product.servings;
  return <article className={`product-card ${soldOut ? 'sold-out' : ''}`}><img src={product.image} alt={product.name} /><div className="product-info"><div><span className="product-category">{product.category}</span><h3>{product.name}</h3><p>{product.description}</p></div><div className="product-bottom"><strong>{formatCurrency(product.price)}</strong>{soldOut ? <span className="sold-out-badge">Agotado</span> : quantity === 0 ? <button className="add-button" onClick={() => onUpdate(product.id, 1)} type="button"><Plus size={16} /> Agregar</button> : <div className="quantity-control"><button onClick={() => onUpdate(product.id, -1)} type="button"><Minus size={14} /></button><b>{quantity}</b><button onClick={() => onUpdate(product.id, 1)} type="button" disabled={reachedStockLimit} aria-label="Agregar uno más"><Plus size={14} /></button></div>}</div></div></article>;
}

function GuestExperience({ products, options, onSubmitOrder }: { products: Product[]; options: ProductOptionMap; onSubmitOrder: (orderCart: Record<string, number>, guestName: string, guestPhone: string) => Promise<OrderSubmitResult> }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [category, setCategory] = useState('Todos');
  const [search, setSearch] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const cartCount = Object.values(cart).reduce((total: number, quantity: number) => total + quantity, 0);
  const cartTotal = Object.entries(cart).reduce((total: number, [key, quantity]: [string, number]) => total + (products.find((product: Product) => product.id === parseCartKey(key).productId)?.price ?? 0) * quantity, 0);
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
  return <main className="guest-shell"><header className="guest-header"><div className="brand-lockup"><span className="brand-mark">T</span><span>El Taita</span></div><span>Menú del restaurante</span></header><div className="guest-content"><div className="guest-intro"><p className="eyebrow">Cliente invitado</p><h1>Elige lo que quieres disfrutar</h1><p className="muted">No necesitas crear una cuenta. Solo te pediremos unos datos al confirmar.</p></div><MenuOrders products={products} options={productOptions} cart={cart} cartCount={cartCount} cartTotal={cartTotal} category={category} filteredProducts={filteredProducts} orderMessage={null} onCategoryChange={setCategory} onSearchChange={setSearch} onUpdateCart={updateCart} onSubmitOrder={placeGuestOrder} /></div><div className="guest-checkout"><label>Nombre<input value={guestName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setGuestName(event.target.value)} placeholder="Tu nombre" /></label><label>Teléfono <span>(opcional)</span><input value={guestPhone} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setGuestPhone(event.target.value)} placeholder="300 000 0000" /></label><p className="guest-payment-note">Confirmas tu pedido y pagas en caja con efectivo, tarjeta o Bre-B. La cocina lo prepara cuando el pago queda aprobado.</p>{message && <p className={`guest-message ${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>{message.text}</p>}</div></main>;
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

type ProfileScreenProps = { profile: UserProfile | null; session: Session | null; onProfileUpdated: (profile: UserProfile) => void; onSignOut: () => Promise<void> };

function ProfileScreen({ profile, session, onProfileUpdated, onSignOut }: ProfileScreenProps) {
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
    await onSignOut();
  };

  return <div className="page-wrap"><div className="page-heading"><div><p className="eyebrow">Administración</p><h1>Mi perfil</h1><p className="muted">Personaliza tu nombre. Tu rol lo asigna un administrador.</p></div></div><div className="profile-screen"><section className="profile-card"><div className="profile-avatar-large">{(displayName?.slice(0, 2) ?? session?.user.email?.slice(0, 2) ?? 'NX').toUpperCase()}</div><div className="profile-info"><strong>{displayName || 'Usuario Nexora'}</strong><span className="profile-role-badge">{roleLabels[role] ?? 'Propietario'}</span><small>{session?.user.email ?? ''}</small></div></section><form className="profile-form" onSubmit={(event: React.FormEvent<HTMLFormElement>) => void handleSave(event)}><label>Nombre para mostrar<input value={displayName} onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDisplayName(event.target.value)} placeholder="Tu nombre" required /></label><p className="muted">Rol en el equipo: <strong>{roleLabels[role] ?? 'Propietario'}</strong></p>{error && <p className="auth-feedback error" role="alert">{error}</p>}{message && <p className="auth-feedback success" role="status">{message}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Guardando...' : 'Guardar cambios'}</button></form><button className="auth-switch" type="button" onClick={() => void handleSignOut()}>Cerrar sesión</button></div></div>;
}

export default App;
