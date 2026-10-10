// Adresse email avec un point de coupure après « @ » : sur un écran étroit,
// elle passe à la ligne proprement (« prenom.nom@ » / « gmail.com ») au lieu de déborder
export default function Email({ address, link = false }) {
  const at = address.lastIndexOf('@');
  const text =
    at > 0 ? (
      <>
        {address.slice(0, at + 1)}
        <wbr />
        {address.slice(at + 1)}
      </>
    ) : (
      address
    );
  return link ? (
    <a className="email" href={`mailto:${address}`}>
      {text}
    </a>
  ) : (
    <span className="email">{text}</span>
  );
}
