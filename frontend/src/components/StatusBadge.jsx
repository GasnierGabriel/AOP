import { STATUS_LABELS } from '../utils';

export default function StatusBadge({ status, isBureau }) {
  return (
    <span className="badges">
      <span className={`badge badge-${status}`}>{STATUS_LABELS[status] || status}</span>
      {isBureau && <span className="badge badge-bureau">Bureau</span>}
    </span>
  );
}
