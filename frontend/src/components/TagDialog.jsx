import { useEffect, useState } from 'react';
import { errorMessage } from '../api';
import { DEFAULT_TAG_COLOR, EMOJI_CHOICES, TAG_COLORS, readableTextColor } from '../tagConfig';
import TagPill from './TagPill';

// Fenêtre de création / édition d'un tag, façon paramètres de rôle Discord
export default function TagDialog({ tag, onSave, onDelete, onClose }) {
  const isEdit = Boolean(tag?.id);
  const [name, setName] = useState(tag?.name || '');
  const [color, setColor] = useState(tag?.color || DEFAULT_TAG_COLOR);
  const [emoji, setEmoji] = useState(tag?.emoji || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const handleKeyDown = (e) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busy, onClose]);

  const isCustomColor = color !== DEFAULT_TAG_COLOR && !TAG_COLORS.includes(color);

  const run = async (action, fallback) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err, fallback));
      setBusy(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return setError('Donne un nom au tag');
    run(() => onSave({ name: name.trim(), color, emoji: emoji.trim() || null }), "Impossible d'enregistrer le tag");
  };

  const handleDelete = () => {
    const count = tag.memberCount ?? 0;
    const detail = count > 0 ? ` Il sera retiré de ${count} membre${count > 1 ? 's' : ''}.` : '';
    if (window.confirm(`Supprimer définitivement le tag « ${tag.name} » ?${detail}`)) {
      run(onDelete, 'Impossible de supprimer le tag');
    }
  };

  const swatch = (value, extraClass = '') => (
    <button
      key={value}
      type="button"
      className={`swatch ${extraClass}`}
      style={{ background: value, color: readableTextColor(value) }}
      onClick={() => setColor(value)}
      aria-label={`Couleur ${value}`}
      aria-pressed={color === value}
    >
      {color === value && '✓'}
    </button>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tag-dialog-title">
        <h2 id="tag-dialog-title">{isEdit ? 'Modifier le tag' : 'Créer un tag'}</h2>

        <div className="tag-preview">
          <span className="muted small">Aperçu</span>
          <TagPill tag={{ name: name.trim() || 'nouveau tag', color, emoji: emoji.trim() }} />
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <label>
            Nom du tag
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
          </label>

          <div className="field">
            <span className="field-label">Couleur</span>
            <div className="color-picker">
              <div className="color-big">
                {swatch(DEFAULT_TAG_COLOR, 'swatch-lg')}
                <label
                  className="swatch swatch-lg swatch-custom"
                  style={isCustomColor ? { background: color, color: readableTextColor(color) } : undefined}
                  title="Couleur personnalisée"
                >
                  <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="Couleur personnalisée" />
                  {isCustomColor ? '✓' : '🎨'}
                </label>
              </div>
              <div className="color-grid">{TAG_COLORS.map((c) => swatch(c))}</div>
            </div>
          </div>

          <div className="field">
            <span className="field-label">Puce</span>
            <div className="emoji-grid">
              <button
                type="button"
                className={`emoji-option ${!emoji ? 'selected' : ''}`}
                onClick={() => setEmoji('')}
                title="Aucune puce"
                aria-label="Aucune puce"
              >
                <span className="emoji-none">∅</span>
              </button>
              {EMOJI_CHOICES.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`emoji-option ${emoji === e ? 'selected' : ''}`}
                  onClick={() => setEmoji(e)}
                  aria-label={`Puce ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <input
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="…ou colle n'importe quel emoji (Win + .  /  Ctrl + Cmd + Espace)"
              maxLength={16}
              aria-label="Emoji personnalisé"
            />
          </div>

          {error && <div className="alert alert-error">{error}</div>}

          <div className="modal-actions">
            {isEdit && onDelete && (
              <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={busy}>
                Supprimer
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {isEdit ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
