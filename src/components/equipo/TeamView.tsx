import { useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { roleLabels } from '@/lib/staffRoles';
import { CreateStaffDialog } from '@/components/equipo/CreateStaffDialog';
import '@/components/equipo/team.css';

type StaffMember = { user_id: string; display_name: string; role: string; email: string | null; created_at: string };

type TeamViewProps = { currentUserId: string; callerRole: string };

export function TeamView({ currentUserId, callerRole }: TeamViewProps) {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadMembers = useCallback(async (): Promise<void> => {
    setLoading(true);
    const { data, error } = await supabase.rpc('list_nexora_staff');
    if (error || !Array.isArray(data)) {
      setLoadError('No pudimos cargar el equipo. Inténtalo de nuevo.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setMembers(data as StaffMember[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const changeRole = async (member: StaffMember, nextRole: string): Promise<void> => {
    if (nextRole === member.role) return;
    setSavingId(member.user_id);
    setActionError(null);
    setNotice(null);
    const { data, error } = await supabase.rpc('set_nexora_staff_role', { target_user_id: member.user_id, role_input: nextRole });
    setSavingId(null);
    if (error || !Array.isArray(data) || data.length === 0) {
      setActionError(`No pudimos cambiar el rol de ${member.display_name}. Revisa tus permisos e inténtalo de nuevo.`);
      void loadMembers();
      return;
    }
    setNotice(`${member.display_name} ahora es ${roleLabels[nextRole]}.`);
    void loadMembers();
  };

  const roleOptions = Object.entries(roleLabels).filter(([value]: [string, string]) => value !== 'owner' || callerRole === 'owner');

  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Administración</p>
          <h1>Equipo</h1>
          <p className="muted">Crea usuarios y asigna el rol que define lo que puede hacer cada persona.</p>
        </div>
        <button className="primary-button" type="button" onClick={() => setCreateOpen(true)}><UserPlus size={16} /> Nuevo usuario</button>
      </div>

      {notice && <p className="auth-feedback success team-notice" role="status">{notice}</p>}
      {actionError && <p className="auth-feedback error team-notice" role="alert">{actionError}</p>}

      <section className="panel team-panel">
        {loading && <p className="muted">Cargando equipo...</p>}
        {!loading && loadError && <p className="auth-feedback error" role="alert">{loadError}</p>}
        {!loading && !loadError && members.length === 0 && <p className="muted">Todavía no hay usuarios en el equipo.</p>}
        {!loading && !loadError && members.length > 0 && (
          <ul className="team-list">
            {members.map((member: StaffMember) => {
              const isSelf = member.user_id === currentUserId;
              const locked = isSelf || (member.role === 'owner' && callerRole !== 'owner');
              return (
                <li className="team-row" key={member.user_id}>
                  <span className="avatar">{member.display_name.slice(0, 2).toUpperCase()}</span>
                  <div className="team-row-info">
                    <strong>{member.display_name}{isSelf && <small> · Tú</small>}</strong>
                    <span className="muted">{member.email ?? 'Sin correo'}</span>
                  </div>
                  <label className="team-role-select">
                    <span className="sr-only">Rol de {member.display_name}</span>
                    <select value={member.role} disabled={locked || savingId === member.user_id} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => void changeRole(member, event.target.value)}>
                      {roleOptions.map(([value, label]: [string, string]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {createOpen && (
        <CreateStaffDialog
          callerRole={callerRole}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            setNotice('Usuario creado correctamente.');
            void loadMembers();
          }}
        />
      )}
    </div>
  );
}
