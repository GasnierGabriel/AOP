import { useEffect, useState } from 'react';
import api, { errorMessage } from '../api';
import TagDialog from './TagDialog';
import TagList from './TagList';
import TagPicker from './TagPicker';

const byName = (a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });

// Tags d'un membre, éditables par le bureau : clic sur « + » pour ajouter / retirer / créer
export default function MemberTags({ memberId, tags, onChange }) {
  const [allTags, setAllTags] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dialogTag, setDialogTag] = useState(null); // { name } en création, tag complet en édition
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/annuaire/tags')
      .then(({ data }) => setAllTags(data.tags))
      .catch((err) => setError(errorMessage(err, 'Impossible de charger les tags')));
  }, []);

  const selectedIds = new Set(tags.map((t) => t.id));
  const bumpCount = (tagId, delta) =>
    setAllTags((prev) => prev.map((t) => (t.id === tagId ? { ...t, memberCount: t.memberCount + delta } : t)));

  const mutate = async (request, fallback) => {
    setBusy(true);
    setError('');
    try {
      const { data } = await request();
      onChange(data.tags);
      return true;
    } catch (err) {
      setError(errorMessage(err, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const assign = async (tag) => {
    if (await mutate(() => api.post(`/annuaire/members/${memberId}/tags`, { tagId: tag.id }), "Impossible d'ajouter le tag")) {
      bumpCount(tag.id, 1);
    }
  };

  const remove = async (tag) => {
    if (await mutate(() => api.delete(`/annuaire/members/${memberId}/tags/${tag.id}`), 'Impossible de retirer le tag')) {
      bumpCount(tag.id, -1);
    }
  };

  const toggle = (tag) => (selectedIds.has(tag.id) ? remove(tag) : assign(tag));

  // Les erreurs de ces trois actions remontent dans la fenêtre (elle les affiche)
  const createTag = async (values) => {
    const { data } = await api.post('/annuaire/tags', values);
    setAllTags((prev) => [...prev, { ...data.tag, memberCount: 0 }].sort(byName));
    setDialogTag(null);
    await assign(data.tag);
  };

  const updateTag = async (values) => {
    const { data } = await api.patch(`/annuaire/tags/${dialogTag.id}`, values);
    setAllTags((prev) => prev.map((t) => (t.id === data.tag.id ? { ...t, ...data.tag } : t)).sort(byName));
    onChange(tags.map((t) => (t.id === data.tag.id ? data.tag : t)).sort(byName));
    setDialogTag(null);
  };

  const deleteTag = async () => {
    await api.delete(`/annuaire/tags/${dialogTag.id}`);
    setAllTags((prev) => prev.filter((t) => t.id !== dialogTag.id));
    onChange(tags.filter((t) => t.id !== dialogTag.id));
    setDialogTag(null);
  };

  return (
    <>
      <TagList tags={tags} onRemove={remove} disabled={busy}>
        <div className="tag-anchor">
          <button
            type="button"
            className="tag-add"
            onClick={() => setPickerOpen((open) => !open)}
            aria-label="Ajouter un tag"
            aria-expanded={pickerOpen}
            title="Ajouter un tag"
            disabled={busy}
          >
            +
          </button>
          {pickerOpen && (
            <TagPicker
              options={allTags}
              selectedIds={selectedIds}
              onSelect={toggle}
              onCreate={(name) => {
                setPickerOpen(false);
                setDialogTag({ name });
              }}
              onEdit={(tag) => {
                setPickerOpen(false);
                setDialogTag(tag);
              }}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </TagList>

      {error && <div className="alert alert-error tag-error">{error}</div>}

      {dialogTag && (
        <TagDialog
          tag={dialogTag}
          onSave={dialogTag.id ? updateTag : createTag}
          onDelete={dialogTag.id ? deleteTag : undefined}
          onClose={() => setDialogTag(null)}
        />
      )}
    </>
  );
}
