import TagPill from './TagPill';

export default function TagList({ tags = [], onRemove, disabled, children }) {
  if (tags.length === 0 && !children) return null;
  return (
    <div className="tag-list">
      {tags.map((tag) => (
        <TagPill key={tag.id} tag={tag} onRemove={onRemove} disabled={disabled} />
      ))}
      {children}
    </div>
  );
}
