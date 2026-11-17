// Outils MCP exposés aux assistants IA. Chaque outil appelle l'API de l'ERP avec le jeton du membre :
// mêmes droits, mêmes validations que dans l'interface. Aucune suppression possible.
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');

const PORT = Number(process.env.PORT) || 3000;
const API = `http://127.0.0.1:${PORT}/api`;
const PUBLIC_URL = (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, '');

const TASK_STATUS = { todo: 'À faire', doing: 'En cours', done: 'Fait' };
const PRIORITY = { high: 'Haute', medium: 'Moyenne', low: 'Basse' };
const SPONSOR_STATUS = { to_contact: 'À contacter', contacted: 'Contacté', negotiation: 'En négociation', signed: 'Signé', declined: 'Refusé' };
const CONTRIBUTION = { money: 'Argent', material: 'Matériel', service: 'Service', mixed: 'Mixte' };

const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

class ToolError extends Error {}

// Résultat d'un outil : texte JSON lisible par le modèle
const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
const fail = (message) => ({ content: [{ type: 'text', text: message }], isError: true });

function client(token) {
  return async function call(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) throw new ToolError(data?.error || `Erreur ${res.status}`);
    return data;
  };
}

// Encapsule un outil : erreurs de l'API renvoyées au modèle comme message lisible
const handler = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (err) {
    if (err instanceof ToolError) return fail(err.message);
    console.error('Outil MCP en erreur :', err);
    return fail('Erreur interne de l’ERP');
  }
};

function findByName(list, name, label) {
  const n = norm(name);
  const exact = list.filter((x) => norm(x.name) === n);
  if (exact.length === 1) return exact[0];
  const partial = list.filter((x) => norm(x.name).includes(n));
  if (partial.length === 1) return partial[0];
  const names = list.map((x) => x.name).join(', ');
  throw new ToolError(
    partial.length > 1
      ? `${label} « ${name} » ambigu : ${partial.map((x) => x.name).join(', ')}`
      : `${label} « ${name} » introuvable. Valeurs possibles : ${names || 'aucune'}`
  );
}

// Membre de l'ERP reconnu par son nom (ou « moi ») ; sinon personne sans compte
function resolvePeople(names, members, me) {
  const notes = [];
  const people = names.map((raw) => {
    const name = String(raw).trim();
    if (['moi', 'me', 'myself'].includes(norm(name))) return { userId: me.id, fullName: me.fullName };
    const n = norm(name);
    const exact = members.filter((m) => norm(m.fullName) === n);
    // Nom partiel (« Tristan ») accepté s'il ne désigne qu'un membre
    const matches = exact.length ? exact : n.length >= 3 ? members.filter((m) => norm(m.fullName).split(' ').some((w) => w.startsWith(n)) || norm(m.fullName).startsWith(n)) : [];
    if (matches.length === 1) return { userId: matches[0].id, fullName: matches[0].fullName };
    if (matches.length > 1) throw new ToolError(`Responsable « ${name} » ambigu : ${matches.map((m) => m.fullName).join(', ')}`);
    notes.push(`« ${name} » n'a pas de compte ERP : ajouté comme responsable sans compte`);
    return { name };
  });
  return { people, notes };
}

const taskView = (t) => ({
  id: t.id,
  titre: t.title,
  statut: TASK_STATUS[t.status],
  priorite: PRIORITY[t.priority],
  pole: t.pole?.name || null,
  echeance: t.dueDate,
  responsables: t.assignees.map((a) => a.fullName || `${a.name} (sans compte)`),
  commentaires: t.commentCount,
});

const today = () => new Date().toISOString().slice(0, 10);

const sponsorView = (s) => ({
  id: s.id,
  nom: s.name,
  statut: SPONSOR_STATUS[s.status],
  rang: s.tier?.name || null,
  apport: s.amount,
  type_apport: CONTRIBUTION[s.contributionType],
  responsable: s.owner?.fullName || s.ownerExternal || null,
  contact_principal: s.contacts[0] ? [s.contacts[0].name, s.contacts[0].role].filter(Boolean).join(' · ') : null,
  prochaine_relance: s.nextActionDate,
  contreparties: `${s.counterparts.filter((c) => c.done).length}/${s.counterparts.length} faites`,
});

const sponsorDetails = (s) => ({
  ...sponsorView(s),
  detail_apport: s.contributionDetails,
  site_web: s.website,
  notes: s.notes,
  contacts: s.contacts.map((c) => ({ nom: c.name, fonction: c.role, email: c.email, telephone: c.phone })),
  contreparties: s.counterparts.map((c) => ({ id: c.id, intitule: c.label, precisions: c.details, echeance: c.dueDate, faite: c.done })),
  modifie_le: s.updatedAt,
});

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format AAAA-MM-JJ');

function buildServer({ token, me }) {
  const call = client(token);
  const server = new McpServer(
    { name: 'erp-arece', version: '1.0.0' },
    {
      instructions:
        "ERP de l'association ARECE (Formula Student, ECE Paris). Tu agis au nom du membre connecté, avec ses droits. " +
        'Tâches : Kanban de l’asso (À faire / En cours / Fait), avec pôle, priorité, échéance, responsables et commentaires. ' +
          'Wiki : documentation de l’asso, pages Markdown rangées par catégorie, avec historique des versions ; lis une page avant de la modifier et préfère des remplacements ciblés. ' +
        (me.canSponsoring ? 'Sponsoring : suivi des partenaires (statut, rang, contacts, contreparties promises). ' : '') +
        "Aucune suppression n'est possible depuis l'assistant : elle se fait dans l'ERP (https://erp.arece.eu). " +
        'Appelle erp_reference pour connaître les pôles, les membres et les valeurs possibles avant de créer ou modifier. ' +
        'Réponds en français.',
    }
  );
  const RO = { readOnlyHint: true, openWorldHint: false };
  const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

  const loadTasks = () => call('GET', '/tasks');

  server.registerTool(
    'erp_reference',
    {
      title: 'Référentiel de l’ERP',
      description: 'Membre connecté, pôles, membres pouvant être responsables, et valeurs possibles (statuts, priorités, rangs de sponsoring).',
      inputSchema: {},
      annotations: RO,
    },
    handler(async () => {
      const data = await loadTasks();
      const result = {
        moi: { nom: me.fullName, bureau: me.isBureau, acces_sponsoring: me.canSponsoring },
        date_du_jour: today(),
        taches: {
          statuts: TASK_STATUS,
          priorites: PRIORITY,
          poles: data.poles.map((p) => p.name),
          membres: data.members.map((m) => m.fullName),
        },
      };
      if (me.canSponsoring) {
        const [tiers, team] = await Promise.all([call('GET', '/sponsoring/tiers'), call('GET', '/sponsoring/team')]);
        result.sponsoring = {
          statuts: SPONSOR_STATUS,
          types_apport: CONTRIBUTION,
          rangs: tiers.tiers.map((t) => t.name),
          equipe: team.team.map((m) => m.fullName),
        };
      }
      return result;
    })
  );

  /* ---------- Tâches ---------- */

  server.registerTool(
    'taches_lister',
    {
      title: 'Lister les tâches',
      description: 'Liste les tâches du Kanban, avec filtres facultatifs. Les tâches faites sont exclues sauf si statut = done.',
      inputSchema: {
        statut: z.enum(['todo', 'doing', 'done']).optional().describe('todo = À faire, doing = En cours, done = Fait'),
        pole: z.string().optional().describe('Nom du pôle'),
        responsable: z.string().optional().describe('« moi » ou nom d’un responsable'),
        en_retard: z.boolean().optional().describe('Seulement les tâches non faites dont l’échéance est passée ou aujourd’hui'),
        recherche: z.string().optional().describe('Texte cherché dans le titre et le contexte'),
        limite: z.number().int().min(1).max(200).optional().describe('Nombre maximum de tâches (50 par défaut)'),
      },
      annotations: RO,
    },
    handler(async ({ statut, pole, responsable, en_retard, recherche, limite = 50 }) => {
      const { tasks, poles, members } = await loadTasks();
      let list = tasks.filter((t) => (statut ? t.status === statut : t.status !== 'done'));
      if (pole) {
        const p = findByName(poles, pole, 'Pôle');
        list = list.filter((t) => t.pole?.id === p.id);
      }
      if (responsable) {
        const { people } = resolvePeople([responsable], members, me);
        const who = people[0];
        list = list.filter((t) => t.assignees.some((a) => (who.userId ? a.userId === who.userId : norm(a.name) === norm(who.name))));
      }
      if (en_retard) list = list.filter((t) => t.status !== 'done' && t.dueDate && t.dueDate <= today());
      if (recherche) {
        const q = norm(recherche);
        list = list.filter((t) => norm(`${t.title} ${t.context}`).includes(q));
      }
      list.sort((a, b) => (a.status === b.status ? a.position - b.position : a.status.localeCompare(b.status)));
      return { total: list.length, taches: list.slice(0, limite).map(taskView) };
    })
  );

  server.registerTool(
    'tache_details',
    {
      title: 'Détails d’une tâche',
      description: 'Contexte complet et commentaires d’une tâche.',
      inputSchema: { id: z.number().int().positive() },
      annotations: RO,
    },
    handler(async ({ id }) => {
      const { tasks } = await loadTasks();
      const t = tasks.find((x) => x.id === id);
      if (!t) throw new ToolError(`Tâche ${id} introuvable`);
      const { comments } = await call('GET', `/tasks/${id}/comments`);
      return {
        ...taskView(t),
        contexte: t.context,
        cree_par: t.createdBy?.fullName || null,
        importee_de_notion: t.imported,
        faite_le: t.completedAt,
        commentaires: comments.map((c) => ({ auteur: c.author?.fullName || c.authorName, date: c.createdAt, texte: c.body })),
      };
    })
  );

  const taskFields = {
    contexte: z.string().max(5000).optional().describe('Détails, liens, prochaines étapes'),
    statut: z.enum(['todo', 'doing', 'done']).optional().describe('todo = À faire, doing = En cours, done = Fait'),
    priorite: z.enum(['high', 'medium', 'low']).optional().describe('high = Haute, medium = Moyenne, low = Basse'),
    responsables: z.array(z.string()).max(10).optional().describe('Noms des responsables (« moi » accepté) ; remplace la liste'),
  };

  // Champs communs à la création et à la modification → corps de l'API
  async function taskBody(args, data) {
    const body = {};
    const notes = [];
    if (args.titre !== undefined) body.title = args.titre;
    if (args.contexte !== undefined) body.context = args.contexte;
    if (args.statut !== undefined) body.status = args.statut;
    if (args.priorite !== undefined) body.priority = args.priorite;
    if (args.echeance !== undefined) body.dueDate = args.echeance;
    if (args.pole !== undefined) body.poleId = args.pole === null ? null : findByName(data.poles, args.pole, 'Pôle').id;
    if (args.responsables !== undefined) {
      const resolved = resolvePeople(args.responsables, data.members, me);
      body.assignees = resolved.people.map((p) => (p.userId ? { userId: p.userId } : { name: p.name }));
      notes.push(...resolved.notes);
    }
    return { body, notes };
  }

  server.registerTool(
    'tache_creer',
    {
      title: 'Créer une tâche',
      description: 'Crée une tâche dans le Kanban (en haut de sa colonne).',
      inputSchema: {
        titre: z.string().min(1).max(300),
        ...taskFields,
        pole: z.string().optional().describe('Nom du pôle'),
        echeance: dateSchema.optional().describe('Date AAAA-MM-JJ'),
      },
      annotations: RW,
    },
    handler(async (args) => {
      const data = await loadTasks();
      const { body, notes } = await taskBody(args, data);
      const { task } = await call('POST', '/tasks', body);
      return { creee: taskView(task), remarques: notes };
    })
  );

  server.registerTool(
    'tache_modifier',
    {
      title: 'Modifier une tâche',
      description: 'Modifie une tâche : seuls les champs fournis changent. Déplacer une tâche = changer son statut.',
      inputSchema: {
        id: z.number().int().positive(),
        titre: z.string().min(1).max(300).optional(),
        ...taskFields,
        pole: z.string().nullable().optional().describe('Nom du pôle, ou null pour le retirer'),
        echeance: dateSchema.nullable().optional().describe('Date AAAA-MM-JJ, ou null pour la retirer'),
      },
      annotations: { ...RW, idempotentHint: true },
    },
    handler(async ({ id, ...args }) => {
      const data = await loadTasks();
      const { body, notes } = await taskBody(args, data);
      if (Object.keys(body).length === 0) throw new ToolError('Aucun champ à modifier');
      const { task } = await call('PATCH', `/tasks/${id}`, body);
      return { modifiee: taskView(task), remarques: notes };
    })
  );

  server.registerTool(
    'tache_commenter',
    {
      title: 'Commenter une tâche',
      description: 'Ajoute un commentaire à une tâche, au nom du membre connecté.',
      inputSchema: { id: z.number().int().positive(), texte: z.string().min(1).max(5000) },
      annotations: RW,
    },
    handler(async ({ id, texte }) => {
      const { comment } = await call('POST', `/tasks/${id}/comments`, { body: texte });
      return { commentaire_ajoute: { id: comment.id, date: comment.createdAt } };
    })
  );

  /* ---------- Wiki (tous les membres validés) ---------- */

  const pageView = (p) => ({
    page: p.slug,
    titre: p.title,
    categorie: p.category.name,
    modifiee_le: p.updatedAt,
    modifiee_par: p.updatedBy?.fullName || null,
    ...(p.excerpt !== undefined ? { apercu: p.excerpt } : {}),
  });

  // Page désignée par son identifiant (slug) ou, à défaut, par son titre exact ou partiel s'il est unique
  async function resolvePage(ref) {
    const slug = String(ref).trim();
    const direct = await fetch(`${API}/wiki/pages/${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (direct.ok) return (await direct.json()).page;
    if (direct.status !== 404) {
      const data = await direct.json().catch(() => null);
      throw new ToolError(data?.error || `Erreur ${direct.status}`);
    }
    const { pages } = await call('GET', `/wiki/pages?q=${encodeURIComponent(slug)}&tri=titre`);
    const n = norm(slug);
    const exact = pages.filter((p) => norm(p.title) === n);
    const matches = exact.length ? exact : pages.filter((p) => norm(p.title).includes(n));
    if (matches.length !== 1) {
      throw new ToolError(
        matches.length > 1
          ? `Page « ${slug} » ambiguë : ${matches.slice(0, 15).map((p) => `${p.title} (${p.slug})`).join(', ')}`
          : `Page « ${slug} » introuvable : utilise wiki_chercher pour trouver son identifiant`
      );
    }
    return (await call('GET', `/wiki/pages/${encodeURIComponent(matches[0].slug)}`)).page;
  }

  async function categoryId(name) {
    const { categories } = await call('GET', '/wiki/categories');
    return findByName(categories, name, 'Catégorie').id;
  }

  server.registerTool(
    'wiki_chercher',
    {
      title: 'Chercher dans le wiki',
      description: 'Liste les pages du wiki (titre, catégorie, aperçu), avec recherche plein texte et filtre par catégorie. Sans argument : les catégories et les pages récemment modifiées.',
      inputSchema: {
        recherche: z.string().optional().describe('Texte cherché dans le titre et le contenu'),
        categorie: z.string().optional().describe('Nom de la catégorie'),
        tri: z.enum(['recent', 'titre']).optional().describe('recent (par défaut) ou titre'),
        limite: z.number().int().min(1).max(100).optional().describe('Nombre maximum de pages (30 par défaut)'),
      },
      annotations: RO,
    },
    handler(async ({ recherche, categorie, tri = 'recent', limite = 30 }) => {
      const { categories } = await call('GET', '/wiki/categories');
      const params = new URLSearchParams({ tri });
      if (recherche) params.set('q', recherche);
      if (categorie) params.set('categorie', findByName(categories, categorie, 'Catégorie').slug);
      const { pages } = await call('GET', `/wiki/pages?${params}`);
      return {
        categories: categories.map((c) => ({ nom: c.name, pages: c.pageCount, description: c.description || undefined })),
        total: pages.length,
        pages: pages.slice(0, limite).map(pageView),
      };
    })
  );

  server.registerTool(
    'wiki_lire',
    {
      title: 'Lire une page du wiki',
      description: 'Contenu Markdown complet d’une page. Renvoie aussi « version », à repasser à wiki_modifier_page.',
      inputSchema: { page: z.string().min(1).describe('Identifiant de la page (ex : reglement-fsuk) ou son titre') },
      annotations: RO,
    },
    handler(async ({ page }) => {
      const p = await resolvePage(page);
      return {
        ...pageView(p),
        creee_par: p.createdBy?.fullName || null,
        creee_le: p.createdAt,
        nombre_de_versions: p.revisionCount,
        version: p.updatedAt,
        lien: `${PUBLIC_URL}/wiki/p/${p.slug}`,
        contenu: p.content,
      };
    })
  );

  server.registerTool(
    'wiki_creer_page',
    {
      title: 'Créer une page du wiki',
      description: 'Crée une page du wiki en Markdown dans une catégorie existante (les catégories se gèrent dans l’ERP).',
      inputSchema: {
        titre: z.string().min(1).max(200),
        categorie: z.string().min(1).describe('Nom de la catégorie (voir wiki_chercher)'),
        contenu: z.string().max(100000).describe('Contenu en Markdown'),
      },
      annotations: RW,
    },
    handler(async ({ titre, categorie, contenu }) => {
      const { page } = await call('POST', '/wiki/pages', { title: titre, categoryId: await categoryId(categorie), content: contenu });
      return { creee: { ...pageView(page), lien: `${PUBLIC_URL}/wiki/p/${page.slug}` } };
    })
  );

  server.registerTool(
    'wiki_modifier_page',
    {
      title: 'Modifier une page du wiki',
      description:
        'Modifie une page : titre, catégorie, et contenu de trois façons au choix : « remplacements » ciblés (recommandé), ' +
        '« ajouter_a_la_fin », ou « contenu » complet. Chaque modification crée une version restaurable dans l’ERP. ' +
        'Passe « version » (renvoyée par wiki_lire) pour ne pas écraser une modification faite entre-temps par quelqu’un d’autre.',
      inputSchema: {
        page: z.string().min(1).describe('Identifiant de la page ou son titre'),
        version: z.string().optional().describe('Valeur « version » lue avec wiki_lire'),
        titre: z.string().min(1).max(200).optional(),
        categorie: z.string().optional().describe('Nom de la nouvelle catégorie'),
        remplacements: z
          .array(z.object({ ancien: z.string().min(1), nouveau: z.string() }))
          .max(50)
          .optional()
          .describe('Passages à remplacer : chaque « ancien » doit apparaître exactement une fois dans la page'),
        ajouter_a_la_fin: z.string().max(100000).optional().describe('Markdown ajouté à la fin de la page'),
        contenu: z.string().max(100000).optional().describe('Nouveau contenu complet (remplace tout)'),
      },
      annotations: { ...RW, idempotentHint: false },
    },
    handler(async ({ page, version, titre, categorie, remplacements, ajouter_a_la_fin, contenu }) => {
      if (contenu !== undefined && (remplacements || ajouter_a_la_fin !== undefined)) {
        throw new ToolError('« contenu » remplace toute la page : ne le combine pas avec « remplacements » ou « ajouter_a_la_fin »');
      }
      const p = await resolvePage(page);
      let content = contenu !== undefined ? contenu : p.content;
      for (const { ancien, nouveau } of remplacements || []) {
        const count = content.split(ancien).length - 1;
        if (count !== 1) {
          throw new ToolError(
            count === 0
              ? `Passage introuvable dans la page : « ${ancien.slice(0, 80)} ». Relis la page avec wiki_lire.`
              : `Passage présent ${count} fois : « ${ancien.slice(0, 80)} ». Donne un extrait plus long pour qu’il soit unique.`
          );
        }
        content = content.replace(ancien, () => nouveau);
      }
      if (ajouter_a_la_fin !== undefined) content = `${content.replace(/\s+$/, '')}\n\n${ajouter_a_la_fin}`;
      const body = {
        title: titre ?? p.title,
        categoryId: categorie ? await categoryId(categorie) : p.category.id,
        content,
        baseUpdatedAt: version || p.updatedAt,
      };
      const { page: updated, unchanged } = await call('PUT', `/wiki/pages/${encodeURIComponent(p.slug)}`, body);
      return {
        modifiee: { ...pageView(updated), version: updated.updatedAt, lien: `${PUBLIC_URL}/wiki/p/${updated.slug}` },
        ...(unchanged ? { remarque: 'Aucun changement : la page était déjà identique' } : {}),
      };
    })
  );

  server.registerTool(
    'wiki_historique',
    {
      title: 'Historique d’une page du wiki',
      description: 'Versions d’une page (date, auteur, taille). Avec version_id : contenu de cette ancienne version.',
      inputSchema: {
        page: z.string().min(1).describe('Identifiant de la page ou son titre'),
        version_id: z.number().int().positive().optional().describe('Identifiant d’une version à lire'),
      },
      annotations: RO,
    },
    handler(async ({ page, version_id }) => {
      const p = await resolvePage(page);
      const base = `/wiki/pages/${encodeURIComponent(p.slug)}/revisions`;
      if (version_id) {
        const { revision: r } = await call('GET', `${base}/${version_id}`);
        return { page: p.slug, version_id: r.id, date: r.createdAt, auteur: r.editedBy?.fullName || null, titre: r.title, contenu: r.content };
      }
      const { revisions } = await call('GET', base);
      return {
        page: p.slug,
        titre: p.title,
        versions: revisions.map((r) => ({ version_id: r.id, date: r.createdAt, auteur: r.editedBy?.fullName || null, titre: r.title, caracteres: r.length })),
      };
    })
  );

  if (!me.canSponsoring) return server;

  /* ---------- Sponsoring (bureau et tag « Sponsoring ») ---------- */

  const loadSponsors = () => call('GET', '/sponsoring/sponsors');
  async function getSponsor(id) {
    const { sponsors } = await loadSponsors();
    const s = sponsors.find((x) => x.id === id);
    if (!s) throw new ToolError(`Partenaire ${id} introuvable`);
    return s;
  }

  server.registerTool(
    'partenaires_lister',
    {
      title: 'Lister les partenaires',
      description: 'Liste les partenaires du sponsoring, avec filtres facultatifs.',
      inputSchema: {
        statut: z.enum(['to_contact', 'contacted', 'negotiation', 'signed', 'declined']).optional()
          .describe('to_contact = À contacter, contacted = Contacté, negotiation = En négociation, signed = Signé, declined = Refusé'),
        rang: z.string().optional().describe('Nom du rang (Bronze, Argent, Or, Platine…)'),
        recherche: z.string().optional().describe('Texte cherché dans le nom, les contacts, les notes et les contreparties'),
        relance_due: z.boolean().optional().describe('Seulement les partenaires dont la relance est passée ou aujourd’hui'),
      },
      annotations: RO,
    },
    handler(async ({ statut, rang, recherche, relance_due }) => {
      let { sponsors } = await loadSponsors();
      if (statut) sponsors = sponsors.filter((s) => s.status === statut);
      if (rang) sponsors = sponsors.filter((s) => s.tier && norm(s.tier.name) === norm(rang));
      if (relance_due) sponsors = sponsors.filter((s) => s.nextActionDate && s.nextActionDate <= today() && !['signed', 'declined'].includes(s.status));
      if (recherche) {
        const q = norm(recherche);
        sponsors = sponsors.filter((s) =>
          norm([s.name, s.notes, s.contributionDetails, ...s.contacts.flatMap((c) => [c.name, c.role, c.email]), ...s.counterparts.map((c) => c.label)].join(' ')).includes(q)
        );
      }
      return { total: sponsors.length, partenaires: sponsors.map(sponsorView) };
    })
  );

  server.registerTool(
    'partenaire_details',
    {
      title: 'Détails d’un partenaire',
      description: 'Fiche complète d’un partenaire : contacts, contreparties, notes.',
      inputSchema: { id: z.number().int().positive() },
      annotations: RO,
    },
    handler(async ({ id }) => sponsorDetails(await getSponsor(id)))
  );

  const sponsorFields = {
    statut: z.enum(['to_contact', 'contacted', 'negotiation', 'signed', 'declined']).optional()
      .describe('to_contact, contacted, negotiation, signed (rang obligatoire), declined'),
    rang: z.string().nullable().optional().describe('Nom du rang ; obligatoire une fois signé'),
    type_apport: z.enum(['money', 'material', 'service', 'mixed']).optional().describe('money = Argent, material = Matériel, service, mixed = Mixte'),
    montant: z.number().min(0).nullable().optional().describe('Montant ou valeur estimée en euros'),
    detail_apport: z.string().max(1000).optional(),
    site_web: z.string().max(500).optional().describe('URL commençant par https://'),
    relance: dateSchema.nullable().optional().describe('Prochaine relance AAAA-MM-JJ, ou null'),
    responsable: z.string().nullable().optional().describe('Membre de l’équipe Sponsoring (« moi » accepté) ou nom libre ; null pour aucun'),
    notes: z.string().max(5000).optional(),
  };

  async function sponsorBody(args) {
    const body = {};
    const notes = [];
    if (args.nom !== undefined) body.name = args.nom;
    if (args.statut !== undefined) body.status = args.statut;
    if (args.type_apport !== undefined) body.contributionType = args.type_apport;
    if (args.montant !== undefined) body.amount = args.montant;
    if (args.detail_apport !== undefined) body.contributionDetails = args.detail_apport;
    if (args.site_web !== undefined) body.website = args.site_web;
    if (args.relance !== undefined) body.nextActionDate = args.relance;
    if (args.notes !== undefined) body.notes = args.notes;
    if (args.rang !== undefined) {
      if (args.rang === null) body.tierId = null;
      else {
        const { tiers } = await call('GET', '/sponsoring/tiers');
        body.tierId = findByName(tiers, args.rang, 'Rang').id;
      }
    }
    if (args.responsable !== undefined) {
      if (args.responsable === null) Object.assign(body, { ownerId: null, ownerName: null });
      else {
        const { team } = await call('GET', '/sponsoring/team');
        const { people, notes: n } = resolvePeople([args.responsable], team, me);
        const p = people[0];
        Object.assign(body, p.userId ? { ownerId: p.userId, ownerName: null } : { ownerId: null, ownerName: p.name });
        notes.push(...n.map((x) => x.replace('responsable sans compte', 'responsable hors équipe')));
      }
    }
    return { body, notes };
  }

  server.registerTool(
    'partenaire_creer',
    {
      title: 'Créer un partenaire',
      description: 'Ajoute un partenaire au suivi du sponsoring.',
      inputSchema: {
        nom: z.string().min(1).max(200),
        ...sponsorFields,
        contacts: z
          .array(z.object({ nom: z.string().optional(), fonction: z.string().optional(), email: z.string().optional(), telephone: z.string().optional() }))
          .max(20)
          .optional()
          .describe('Le premier est le contact principal'),
      },
      annotations: RW,
    },
    handler(async ({ contacts, ...args }) => {
      const { body, notes } = await sponsorBody(args);
      if (contacts) body.contacts = contacts.map((c) => ({ name: c.nom, role: c.fonction, email: c.email, phone: c.telephone }));
      const { sponsor } = await call('POST', '/sponsoring/sponsors', body);
      return { cree: sponsorDetails(sponsor), remarques: notes };
    })
  );

  server.registerTool(
    'partenaire_modifier',
    {
      title: 'Modifier un partenaire',
      description: 'Modifie la fiche d’un partenaire : seuls les champs fournis changent (contacts et contreparties : outils dédiés).',
      inputSchema: { id: z.number().int().positive(), nom: z.string().min(1).max(200).optional(), ...sponsorFields },
      annotations: { ...RW, idempotentHint: true },
    },
    handler(async ({ id, ...args }) => {
      const { body, notes } = await sponsorBody(args);
      if (Object.keys(body).length === 0) throw new ToolError('Aucun champ à modifier');
      const { sponsor } = await call('PATCH', `/sponsoring/sponsors/${id}`, body);
      return { modifie: sponsorDetails(sponsor), remarques: notes };
    })
  );

  // Contacts et contreparties : l'API attend la liste complète, on repart donc de la fiche actuelle
  const currentContacts = (s) => s.contacts.map((c) => ({ id: c.id, name: c.name, role: c.role, email: c.email, phone: c.phone }));
  const currentCounterparts = (s) =>
    s.counterparts.map((c) => ({ id: c.id, label: c.label, details: c.details, dueDate: c.dueDate, done: c.done }));

  server.registerTool(
    'partenaire_ajouter_contact',
    {
      title: 'Ajouter un contact',
      description: 'Ajoute une personne de contact à un partenaire (à la fin de la liste, sauf si principal = true).',
      inputSchema: {
        id: z.number().int().positive().describe('Identifiant du partenaire'),
        nom: z.string().max(200).optional(),
        fonction: z.string().max(200).optional().describe('ex : Directrice marketing Europe'),
        email: z.string().max(255).optional(),
        telephone: z.string().max(50).optional(),
        principal: z.boolean().optional().describe('En faire le contact principal'),
      },
      annotations: RW,
    },
    handler(async ({ id, nom, fonction, email, telephone, principal }) => {
      const s = await getSponsor(id);
      const contact = { name: nom, role: fonction, email, phone: telephone };
      const contacts = principal ? [contact, ...currentContacts(s)] : [...currentContacts(s), contact];
      const { sponsor } = await call('PATCH', `/sponsoring/sponsors/${id}`, { contacts });
      return { contacts: sponsorDetails(sponsor).contacts };
    })
  );

  server.registerTool(
    'partenaire_ajouter_contrepartie',
    {
      title: 'Ajouter une contrepartie',
      description: 'Ajoute une contrepartie promise au partenaire (logo, post, invitation…), datée ou non.',
      inputSchema: {
        id: z.number().int().positive().describe('Identifiant du partenaire'),
        intitule: z.string().min(1).max(300),
        precisions: z.string().max(1000).optional().describe('Exigences de la marque, détails'),
        echeance: dateSchema.optional().describe('Date AAAA-MM-JJ'),
      },
      annotations: RW,
    },
    handler(async ({ id, intitule, precisions, echeance }) => {
      const s = await getSponsor(id);
      const counterparts = [...currentCounterparts(s), { label: intitule, details: precisions, dueDate: echeance || null, done: false }];
      const { sponsor } = await call('PATCH', `/sponsoring/sponsors/${id}`, { counterparts });
      return { contreparties: sponsorDetails(sponsor).contreparties };
    })
  );

  server.registerTool(
    'contrepartie_marquer',
    {
      title: 'Marquer une contrepartie',
      description: 'Coche (ou décoche) une contrepartie comme faite.',
      inputSchema: {
        partenaire_id: z.number().int().positive(),
        contrepartie_id: z.number().int().positive(),
        faite: z.boolean(),
      },
      annotations: { ...RW, idempotentHint: true },
    },
    handler(async ({ partenaire_id, contrepartie_id, faite }) => {
      const s = await getSponsor(partenaire_id);
      if (!s.counterparts.some((c) => c.id === contrepartie_id)) throw new ToolError(`Contrepartie ${contrepartie_id} introuvable chez ${s.name}`);
      const counterparts = currentCounterparts(s).map((c) => (c.id === contrepartie_id ? { ...c, done: faite } : c));
      const { sponsor } = await call('PATCH', `/sponsoring/sponsors/${partenaire_id}`, { counterparts });
      return { contreparties: sponsorDetails(sponsor).contreparties };
    })
  );

  return server;
}

module.exports = { buildServer };
