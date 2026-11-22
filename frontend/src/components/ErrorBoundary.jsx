import { Component } from 'react';

// Filet de sécurité : une erreur d'affichage ne laisse plus une page blanche
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Erreur d’affichage', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    // Changement de page : on retente l'affichage
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    // Nouvelle version du site déployée pendant la navigation : un morceau de page n'existe plus
    const outdated = /Loading chunk|ChunkLoadError|dynamically imported module/i.test(String(this.state.error?.message));
    return (
      <div className="card error-page" role="alert">
        <h1>{outdated ? 'Le site a été mis à jour' : 'Oups, cette page a rencontré un problème'}</h1>
        <p className="muted">
          {outdated
            ? 'Recharge la page pour utiliser la nouvelle version.'
            : 'Recharge la page. Si le problème revient, préviens le bureau en indiquant ce que tu faisais.'}
        </p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Recharger la page
        </button>
      </div>
    );
  }
}
