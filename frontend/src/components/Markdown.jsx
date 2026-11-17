import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

marked.setOptions({ gfm: true, breaks: true }); // tableaux, listes de tâches ; retour à la ligne = <br>

// Liens externes dans un nouvel onglet, sans accès à la page d'origine
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^https?:\/\//i.test(node.getAttribute('href') || '')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// Ancre d'un titre, comme sur Wikipedia / GitHub : « Règlement FSUK » → reglement-fsuk
// (même règle que l'outil MCP wiki_lire, dans backend/src/mcp/tools.js)
export function headingAnchor(text) {
  return (
    String(text)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'section'
  );
}

const RESERVED_IDS = new Set(['root']); // identifiants déjà utilisés par l'application

// Ajoute un identifiant et un lien « # » à chaque titre ; renvoie aussi le sommaire
function withAnchors(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const seen = new Set(RESERVED_IDS);
  const toc = [];
  template.content.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const text = h.textContent.trim();
    const base = headingAnchor(text);
    let id = base;
    for (let n = 2; seen.has(id); n += 1) id = `${base}-${n}`; // titres identiques : -2, -3…
    seen.add(id);
    h.id = id;
    const link = document.createElement('a');
    link.className = 'heading-anchor';
    link.href = `#${id}`;
    link.setAttribute('aria-label', `Lien vers la section « ${text} »`);
    link.title = 'Copier le lien vers cette section';
    link.textContent = '#';
    h.appendChild(link);
    toc.push({ id, text, level: Number(h.tagName[1]) });
  });
  return { html: template.innerHTML, toc };
}

// Mermaid (lourd) n'est chargé que si une page contient un diagramme
let mermaidPromise = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict', // pas de HTML ni de clics/scripts dans les libellés
        htmlLabels: false, // libellés en texte SVG : rien de HTML à injecter, et ils survivent au nettoyage DOMPurify
        flowchart: { htmlLabels: false },
        theme: 'base',
        fontFamily: 'Poppins, Arial, sans-serif',
        themeVariables: {
          primaryColor: '#e8ecf5',
          primaryBorderColor: '#000f2e',
          primaryTextColor: '#000f2e',
          lineColor: '#000f2e',
          secondaryColor: '#fde8ea',
          tertiaryColor: '#f3f4f7',
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let diagramCount = 0;

// Remplace les blocs ```mermaid par le diagramme rendu ; en cas d'erreur, garde le code et affiche l'erreur
async function renderDiagrams(container, isCancelled) {
  const blocks = [...container.querySelectorAll('pre > code.language-mermaid')];
  if (blocks.length === 0) return;
  const mermaid = await loadMermaid();
  for (const code of blocks) {
    if (isCancelled()) return;
    const pre = code.parentElement;
    const source = code.textContent;
    diagramCount += 1;
    const id = `mermaid-${diagramCount}`;
    try {
      const { svg } = await mermaid.render(id, source);
      if (isCancelled() || !pre.isConnected) return;
      const figure = document.createElement('div');
      figure.className = 'mermaid-diagram';
      figure.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { html: true, svg: true, svgFilters: true }, ADD_TAGS: ['foreignObject'] });
      pre.replaceWith(figure);
    } catch (err) {
      document.getElementById(`d${id}`)?.remove(); // conteneur temporaire laissé par mermaid en cas d'erreur
      if (isCancelled() || !pre.isConnected) return;
      const message = document.createElement('p');
      message.className = 'mermaid-error';
      message.textContent = `Diagramme Mermaid invalide : ${String(err?.message || err).split('\n')[0]}`;
      pre.after(message);
    }
  }
}

// Fait défiler jusqu'au titre visé par l'adresse (#ancre), une fois le contenu affiché
function scrollToHash(container) {
  const hash = window.location.hash.slice(1);
  if (!hash || !container) return;
  let id = hash;
  try {
    id = decodeURIComponent(hash);
  } catch {
    // ancre mal encodée : on la cherche telle quelle
  }
  const target = container.querySelector(`[id="${CSS.escape(id)}"]`);
  if (target) target.scrollIntoView({ block: 'start' });
}

function Toc({ items }) {
  const min = Math.min(...items.map((i) => i.level));
  return (
    <nav className="markdown-toc" aria-label="Sommaire">
      <strong>Sommaire</strong>
      <ol>
        {items.map((i) => (
          <li key={i.id} style={{ marginLeft: `${(i.level - min) * 1.1}em` }}>
            <a href={`#${i.id}`}>{i.text}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// Rendu Markdown, nettoyé (aucun script ni HTML dangereux, même si le texte en contient), avec ancres sur les titres,
// sommaire facultatif (toc) dès 3 titres, et diagrammes Mermaid
export default function Markdown({ source, toc = false }) {
  const { html, toc: items } = useMemo(() => withAnchors(DOMPurify.sanitize(marked.parse(source || ''))), [source]);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { hash } = useLocation();

  useEffect(() => {
    if (!ref.current) return undefined;
    let cancelled = false;
    scrollToHash(ref.current);
    // Petit délai : dans l'aperçu de l'éditeur, on ne redessine pas à chaque touche
    const timer = setTimeout(
      () =>
        renderDiagrams(ref.current, () => cancelled)
          .then(() => !cancelled && scrollToHash(ref.current)) // les diagrammes décalent la page
          .catch(() => {}),
      250
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [html]);

  // Lien interne vers une autre ancre de la même page (navigation sans rechargement)
  useEffect(() => {
    scrollToHash(ref.current);
  }, [hash]);

  // « # » d'un titre : copie le lien de la section ; liens internes (/wiki/…) : navigation sans recharger l'appli
  const onClick = (e) => {
    const link = e.target.closest('a');
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (link.classList.contains('heading-anchor')) {
      const url = `${window.location.origin}${window.location.pathname}${link.getAttribute('href')}`;
      navigator.clipboard?.writeText(url).then(
        () => {
          link.classList.add('copied');
          setTimeout(() => link.classList.remove('copied'), 1500);
        },
        () => {}
      );
      return; // le navigateur suit l'ancre normalement
    }
    const href = link.getAttribute('href') || '';
    if (href.startsWith('/') && !href.startsWith('//') && !link.target) {
      e.preventDefault();
      navigate(href);
    }
  };

  if (!source?.trim()) return <p className="muted">Cette page est vide pour l'instant.</p>;
  return (
    <>
      {toc && items.length >= 3 && <Toc items={items} />}
      <div ref={ref} className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}
