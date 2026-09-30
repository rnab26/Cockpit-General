/**
 * Copie un texte dans le presse-papier. Appelée DANS le gestionnaire du clic
 * (exigence des navigateurs). Repli par une zone de texte invisible quand
 * l'API est refusée (contexte non sécurisé, permission). Une seule copie pour
 * toute l'app : consigne de relance, marche à suivre d'une action (0033).
 */
export async function copierTexte(texte: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texte); return true }
  } catch { /* refusé : repli ci-dessous */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = texte; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}
