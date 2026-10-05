import { readableTextColor } from '../tagConfig';

// Pastille façon rôle Discord : point coloré (devient × au survol si retirable) + emoji + nom
export default function TagPill({ tag, onRemove, disabled }) {
  return (
    <span className="tag-pill">
      {onRemove ? (
        <button
          type="button"
          className="tag-dot tag-dot-btn"
          style={{ background: tag.color, color: readableTextColor(tag.color) }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(tag);
          }}
          disabled={disabled}
          aria-label={`Retirer le tag ${tag.name}`}
          title="Retirer"
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : (
        <span className="tag-dot" style={{ background: tag.color }} />
      )}
      {tag.emoji && (
        <span className="tag-emoji" aria-hidden="true">
          {tag.emoji}
        </span>
      )}
      <span className="tag-name">{tag.name}</span>
    </span>
  );
}
