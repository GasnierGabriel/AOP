import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import { academicYearStart, loadCatalog } from '../catalog';
import { ItemActions, RoleTimeline } from './CareerLists';

const emptyForm = () => ({ name: '', pole: '', startDate: academicYearStart(), endDate: '', current: true });

// Historique des rôles éditable : ajout, modification, suppression
export default function RolesEditor({ memberId, roles, onChange }) {
  const [catalog, setCatalog] = useState({ roles: [], poles: [] });
  const [editing, setEditing] = useState(null); // null | 'new' | id de l'entrée
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadCatalog().then(setCatalog).catch(() => {}); // suggestions facultatives
  }, []);

  const open = (role) => {
    setError('');
    if (role) {
      setEditing(role.id);
      setForm({
        name: role.name,
        pole: role.pole || '',
        startDate: role.startDate,
        endDate: role.endDate || '',
        current: !role.endDate,
      });
    } else {
      setEditing('new');
      setForm(emptyForm());
    }
  };

  const close = () => {
    setEditing(null);
    setError('');
  };

  const update = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Rôle connu choisi dans les suggestions : on reprend son pôle si aucun n'est saisi
      if (field === 'name' && !prev.pole) {
        const known = catalog.roles.find((r) => r.name.toLowerCase() === value.trim().toLowerCase());
        if (known?.pole) next.pole = known.pole;
      }
      return next;
    });
  };

  const request = async (call, fallback) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await call();
      onChange(data.roles);
      loadCatalog({ refresh: true }).then(setCatalog).catch(() => {});
      return true;
    } catch (err) {
      setError(errorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      name: form.name,
      pole: form.pole,
      startDate: form.startDate,
      endDate: form.current ? null : form.endDate || null,
    };
    if (!form.current && !payload.endDate) return setError('Indique la date de fin, ou coche « Rôle en cours »');
    const ok = await request(
      () =>
        editing === 'new'
          ? api.post(`/annuaire/members/${memberId}/roles`, payload)
          : api.patch(`/annuaire/members/${memberId}/roles/${editing}`, payload),
      "Impossible d'enregistrer le rôle"
    );
    if (ok) close();
  };

  const handleDelete = (role) => {
    if (!window.confirm(`Supprimer le rôle « ${role.name} » de l'historique ?`)) return;
    request(() => api.delete(`/annuaire/members/${memberId}/roles/${role.id}`), 'Impossible de supprimer le rôle').then(
      (ok) => ok && editing === role.id && close()
    );
  };

  return (
    <div className="career-editor">
      <RoleTimeline
        roles={roles}
        highlightId={editing}
        actions={(role) => (
          <ItemActions label={role.name} onEdit={() => open(role)} onDelete={() => handleDelete(role)} disabled={busy} />
        )}
      />

      {editing ? (
        <form className="form career-form" onSubmit={handleSubmit}>
          <h3>{editing === 'new' ? 'Ajouter un rôle' : 'Modifier le rôle'}</h3>
          <div className="form-grid">
            <label>
              Intitulé
              <input
                list="role-suggestions"
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="ex : Responsable Méca"
                maxLength={150}
                required
                autoFocus
              />
            </label>
            <label>
              Pôle
              <input
                list="pole-suggestions"
                value={form.pole}
                onChange={(e) => update('pole', e.target.value)}
                placeholder="ex : Mécanique"
                maxLength={100}
              />
            </label>
            <label>
              Début
              <input type="date" value={form.startDate} onChange={(e) => update('startDate', e.target.value)} required />
            </label>
            <label>
              Fin
              <input
                type="date"
                value={form.current ? '' : form.endDate}
                min={form.startDate}
                onChange={(e) => update('endDate', e.target.value)}
                disabled={form.current}
              />
            </label>
          </div>
          <label className="check-label">
            <input type="checkbox" checked={form.current} onChange={(e) => update('current', e.target.checked)} />
            Rôle en cours
          </label>
          <datalist id="role-suggestions">
            {catalog.roles.map((r) => (
              <option key={r.id} value={r.name} />
            ))}
          </datalist>
          <datalist id="pole-suggestions">
            {catalog.poles.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Enregistrer
            </button>
          </div>
        </form>
      ) : (
        <>
          {error && <div className="alert alert-error">{error}</div>}
          <button type="button" className="btn btn-outline btn-sm add-btn" onClick={() => open(null)}>
            + Ajouter un rôle
          </button>
        </>
      )}
    </div>
  );
}
