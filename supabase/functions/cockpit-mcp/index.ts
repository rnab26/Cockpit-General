import "jsr:@supabase/functions-js/edge-runtime.d.ts"

/**
 * cockpit-mcp — le cockpit d'un projet, exposé en MCP (Model Context Protocol)
 * à tout outil IA hors Claude : Codex, ChatGPT, Cursor, Gemini CLI…
 *
 * POURQUOI UN SIMPLE RELAIS : la fonction `cockpit-embed` porte déjà TOUTE la
 * règle (une clé par projet, colonnes listées, jamais de champ interne, un
 * chantier hors projet = 404). Ici on ne réécrit rien : chaque outil MCP appelle
 * `cockpit-embed` avec la même clé. Une seule source de vérité ; ce qu'un outil
 * IA peut voir ou faire est EXACTEMENT ce que peut le module embarqué.
 *
 * Transport : Streamable HTTP (spec MCP 2025-06-18), mode sans état, réponses
 * `application/json` (pas de SSE) : POST JSON-RPC ; notification → 202 sans
 * corps ; GET/DELETE → 405 (pas de flux serveur, pas de session).
 * Versions négociées : 2025-06-18, 2025-03-26, 2024-11-05.
 *
 * Clé du projet (la `cle_embed`, jamais régénérée ici), au choix :
 *  - `Authorization: Bearer <clé>`  (Codex : bearer_token_env_var) ;
 *  - `x-cockpit-key: <clé>` ;
 *  - dans l'adresse : `/cockpit-mcp/<clé>` ou `?cle=<clé>` (ChatGPT ne sait
 *    proposer que « OAuth » ou « Aucune authentification » : la clé va donc
 *    dans l'adresse).
 * Jamais de cookie : pas d'authentification ambiante, donc pas de risque de
 * détournement depuis un site tiers (l'en-tête Origin n'a rien à protéger ici).
 *
 * verify_jwt = false : la clé du projet EST l'authentification.
 */

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
const SERVEUR = { name: "cockpit", title: "Cockpit", version: "1.0.0" }

const INSTRUCTIONS =
  "Cockpit : les demandes (chantiers) d'UN projet. Commence par cockpit_etat pour voir les demandes, " +
  "leurs messages et les questions en attente. Une demande passe « à vérifier » quand elle est codée : " +
  "l'humain la certifie (cockpit_certifier) ou la renvoie (cockpit_corriger, en disant ce qui ne marche pas). " +
  "Réponses courtes, en français."

const AUTEUR = { type: "string", description: "Nom de la personne qui agit (facultatif, « Utilisateur » par défaut)." }
const ID_CHANTIER = { type: "string", description: "Identifiant (uuid) de la demande, lu dans cockpit_etat." }

type Outil = { name: string; action: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }

const OUTILS: Outil[] = [
  {
    name: "cockpit_etat", action: "etat", title: "Voir l'état du projet",
    description: "Liste les demandes du projet avec leur état, leurs messages, leurs questions en attente et l'avancement en direct.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "cockpit_creer", action: "creer", title: "Créer une demande",
    description: "Crée une nouvelle demande dans le projet.",
    inputSchema: {
      type: "object", required: ["titre"], additionalProperties: false,
      properties: { titre: { type: "string", description: "Titre court (200 caractères au plus)." }, demande: { type: "string", description: "Le détail de la demande." }, auteur: AUTEUR },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "cockpit_repondre", action: "repondre", title: "Répondre à une question",
    description: "Répond à une question posée dans une demande (message_id lu dans cockpit_etat).",
    inputSchema: {
      type: "object", required: ["message_id"], additionalProperties: false,
      properties: {
        message_id: { type: "string", description: "Identifiant (uuid) de la question." },
        reponse: { type: "string", description: "La réponse choisie ou écrite." },
        precision: { type: "string", description: "Une précision libre (facultatif)." },
        etat: { type: "string", enum: ["fait", "pas_encore", "bloque"], description: "Pour une action demandée : fait, pas encore, ou bloqué." },
        auteur: AUTEUR,
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "cockpit_certifier", action: "certifier", title: "Certifier une demande",
    description: "Déclare qu'une demande « à vérifier » marche : elle est certifiée (fini). À n'appeler que si l'humain l'a confirmé.",
    inputSchema: {
      type: "object", required: ["chantier_id"], additionalProperties: false,
      properties: { chantier_id: ID_CHANTIER, mots: { type: "string", description: "Un mot de l'humain (facultatif)." }, auteur: AUTEUR },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "cockpit_corriger", action: "corriger", title: "Renvoyer une demande à corriger",
    description: "Dit que ça ne marche pas : la demande repart en correction avec ce message.",
    inputSchema: {
      type: "object", required: ["chantier_id", "mots"], additionalProperties: false,
      properties: { chantier_id: ID_CHANTIER, mots: { type: "string", description: "Ce qui ne marche pas, en clair." }, auteur: AUTEUR },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "cockpit_message", action: "message", title: "Écrire dans une demande",
    description: "Ajoute un message dans le fil d'une demande.",
    inputSchema: {
      type: "object", required: ["chantier_id", "corps"], additionalProperties: false,
      properties: { chantier_id: ID_CHANTIER, corps: { type: "string", description: "Le message." }, auteur: AUTEUR },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "cockpit_modifier", action: "modifier", title: "Modifier une demande",
    description: "Réécrit le titre et le détail d'une demande créée ici, tant qu'aucune session ne l'a prise.",
    inputSchema: {
      type: "object", required: ["chantier_id", "titre"], additionalProperties: false,
      properties: { chantier_id: ID_CHANTIER, titre: { type: "string" }, demande: { type: "string" }, auteur: AUTEUR },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
]

const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }

function repondre(corps: unknown, statut = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { ...HEADERS, ...extra } })
}
const rpcErreur = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } })

/** La clé du projet : en-tête Bearer, x-cockpit-key, puis l'adresse. Jamais journalisée. */
function cleDe(req: Request): string {
  const auth = req.headers.get("authorization") ?? ""
  const m = /^Bearer\s+(\S+)/i.exec(auth)
  if (m) return m[1]
  const h = (req.headers.get("x-cockpit-key") ?? "").trim()
  if (h) return h
  const url = new URL(req.url)
  const q = (url.searchParams.get("cle") ?? "").trim()
  if (q) return q
  const segments = url.pathname.split("/").filter(Boolean)
  const i = segments.indexOf("cockpit-mcp")
  return i >= 0 && segments[i + 1] ? decodeURIComponent(segments[i + 1]) : ""
}

async function appelerEmbed(cle: string, action: string, args: Record<string, unknown>): Promise<{ ok: boolean; statut: number; corps: Record<string, unknown> }> {
  const base = Deno.env.get("SUPABASE_URL")
  if (!base) return { ok: false, statut: 500, corps: { erreur: "Le serveur du Cockpit est mal configuré." } }
  const r = await fetch(`${base}/functions/v1/cockpit-embed`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cockpit-key": cle },
    body: JSON.stringify({ ...args, action }),
  })
  let corps: Record<string, unknown>
  try { corps = await r.json() } catch { corps = { erreur: "Réponse illisible du Cockpit." } }
  return { ok: r.ok, statut: r.status, corps }
}

/** La clé n'ouvre aucun projet : HTTP 401, pour que le client le voie tout de suite. */
class CleRefusee extends Error {}

async function traiter(msg: Record<string, unknown>, cle: string): Promise<unknown | null> {
  const { id, method } = msg
  const params = (msg.params && typeof msg.params === "object" ? msg.params : {}) as Record<string, unknown>
  if (typeof method !== "string") return rpcErreur(id, -32600, "Requête JSON-RPC invalide.")
  // Une notification (pas d'id) n'a pas de réponse.
  if (id === undefined || id === null) return null
  switch (method) {
    case "initialize": {
      // Vérifie la clé dès la poignée de main : un client mal réglé le sait
      // à la connexion, pas à son premier appel d'outil.
      const sonde = await appelerEmbed(cle, "etat", {})
      if (sonde.statut === 401) throw new CleRefusee(typeof sonde.corps.erreur === "string" ? sonde.corps.erreur : "Clé refusée.")
      const voulue = typeof params.protocolVersion === "string" ? params.protocolVersion : ""
      return {
        jsonrpc: "2.0", id,
        result: {
          protocolVersion: VERSIONS.includes(voulue) ? voulue : VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVEUR,
          instructions: INSTRUCTIONS,
        },
      }
    }
    case "ping": return { jsonrpc: "2.0", id, result: {} }
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: OUTILS.map(({ action: _a, ...o }) => o) } }
    case "tools/call": {
      const outil = OUTILS.find((o) => o.name === params.name)
      if (!outil) return rpcErreur(id, -32602, `Outil inconnu : ${String(params.name)}`)
      const args = (params.arguments && typeof params.arguments === "object" ? params.arguments : {}) as Record<string, unknown>
      const r = await appelerEmbed(cle, outil.action, args)
      if (r.statut === 401) throw new CleRefusee(typeof r.corps.erreur === "string" ? r.corps.erreur : "Clé refusée.")
      // Une erreur métier (« écris ce qui ne marche pas ») est un résultat d'outil
      // en erreur, lisible par le modèle : pas une erreur de protocole.
      if (!r.ok) {
        const message = typeof r.corps.erreur === "string" ? r.corps.erreur : `Erreur ${r.statut}.`
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: message }], isError: true } }
      }
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(r.corps) }], structuredContent: r.corps } }
    }
    default: return rpcErreur(id, -32601, `Méthode inconnue : ${method}`)
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 })
  if (req.method !== "POST") {
    return repondre(rpcErreur(null, -32000, "Ce serveur n'ouvre pas de flux : envoie des requêtes POST."), 405, { allow: "POST" })
  }
  const debut = Date.now()
  const cle = cleDe(req)
  if (!cle) {
    return repondre(rpcErreur(null, -32001, "Clé du projet manquante : Authorization: Bearer <clé>, x-cockpit-key, ou /cockpit-mcp/<clé>."), 401)
  }
  const version = req.headers.get("mcp-protocol-version")
  if (version && !VERSIONS.includes(version)) {
    return repondre(rpcErreur(null, -32600, `Version de protocole non gérée : ${version}.`), 400)
  }
  let corps: unknown
  try { corps = await req.json() } catch { return repondre(rpcErreur(null, -32700, "JSON invalide."), 400) }

  try {
    if (Array.isArray(corps)) {
      // Lot JSON-RPC (2024-11-05 / 2025-03-26).
      const reponses = (await Promise.all(corps.map((m) => traiter(m as Record<string, unknown>, cle)))).filter((r) => r !== null)
      console.log(`cockpit-mcp lot ${corps.length} ${Date.now() - debut} ms`)
      return reponses.length ? repondre(reponses) : new Response(null, { status: 202 })
    }
    if (!corps || typeof corps !== "object") return repondre(rpcErreur(null, -32600, "Requête JSON-RPC invalide."), 400)
    const m = corps as Record<string, unknown>
    const rep = await traiter(m, cle)
    console.log(`cockpit-mcp ${String(m.method)} ${Date.now() - debut} ms`)
    return rep === null ? new Response(null, { status: 202 }) : repondre(rep)
  } catch (e) {
    if (e instanceof CleRefusee) return repondre(rpcErreur(null, -32001, e.message), 401)
    console.error("cockpit-mcp erreur :", e instanceof Error ? e.message : String(e))
    return repondre(rpcErreur(null, -32603, "Erreur interne du serveur."), 500)
  }
})
