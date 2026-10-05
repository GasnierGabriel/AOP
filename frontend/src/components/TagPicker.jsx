import { useEffect, useRef, useState } from 'react';

// Menu de sélection façon Discord. À placer dans un parent `position: relative`
// qui contient aussi le bouton d'ouverture (les clics dedans ne ferment pas le menu).
export default function TagPicker({
  options,
  selectedIds = new Set(),
  onSelect,
  onCreate,
  onEdit,
  onClose,
  placeholder = 'Rechercher un tag',
}) {
  const ref = useRef(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const handleMouseDown = (e) => {
      if (!ref.current?.parentNode.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  const trimmed = query.trim().replace(/\s+/g, ' ');
  const q = trimmed.toLowerCase();
  const filtered = options.filter((t) => t.name.toLowerCase().includes(q));
  const exactMatch = options.some((t) => t.name.toLowerCase() === q);
  const items = filtered.map((tag) => ({ type: 'tag', tag }));
  if (onCreate && !exactMatch) items.push({ type: 'create' });

  const activeIndex = Math.min(active, Math.max(items.length - 1, 0));

  const choose = (item) => {
    if (!item) return;
    if (item.type === 'create') onCreate(trimmed);
    else onSelect(item.tag);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((activeIndex + 1) % Math.max(items.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((activeIndex - 1 + items.length) % Math.max(items.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[activeIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="tag-popover" ref={ref}>
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        maxLength={40}
        aria-label={placeholder}
      />
      {items.length === 0 ? (
        <div className="tag-popover-empty">Aucun tag trouvé</div>
      ) : (
        <ul className="tag-options" role="listbox">
          {items.map((item, i) =>
            item.type === 'create' ? (
              <li
                key="__create"
                role="option"
                aria-selected={i === activeIndex}
                className={`tag-option tag-option-create ${i === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
              >
                <span className="tag-option-plus">+</span>
                {trimmed ? <>Créer le tag « {trimmed} »</> : 'Créer un nouveau tag'}
              </li>
            ) : (
              <li
                key={item.tag.id}
                role="option"
                aria-selected={i === activeIndex}
                className={`tag-option ${i === activeIndex ? 'active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
              >
                <span className="tag-dot" style={{ background: item.tag.color }} />
                {item.tag.emoji && <span className="tag-emoji">{item.tag.emoji}</span>}
                <span className="tag-option-name">{item.tag.name}</span>
                {item.tag.memberCount !== undefined && (
                  <span className="tag-option-count">{item.tag.memberCount}</span>
                )}
                {selectedIds.has(item.tag.id) && <span className="tag-option-check">✓</span>}
                {onEdit && (
                  <button
                    type="button"
                    className="tag-option-edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(item.tag);
                    }}
                    aria-label={`Modifier le tag ${item.tag.name}`}
                    title="Modifier"
                  >
                    ✎
                  </button>
                )}
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
