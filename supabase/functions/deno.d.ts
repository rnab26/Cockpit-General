// Les Edge Functions tournent sous Deno, pas sous Node : `tsc` ne connaît ni
// son global `Deno`, ni ses spécificateurs d'import (`jsr:`). Ce fichier lui
// donne le strict minimum pour VÉRIFIER NOTRE code — pas pour le compiler ni
// l'exécuter. Repris de Jarvis-assistant (supabase/functions/deno.d.ts), où
// l'absence de typecheck a laissé passer des fautes qui ne se voyaient
// qu'après déploiement.
//
//   npx tsc -p supabase/functions/tsconfig.json
//
// Le SDK Supabase est typé large exprès : on vérifie que nos fichiers se
// tiennent entre eux, pas le SDK.

/* eslint-disable @typescript-eslint/no-explicit-any */

declare module "jsr:@supabase/functions-js/edge-runtime.d.ts" {}

declare module "jsr:@supabase/supabase-js@2" {
  export type SupabaseClient = {
    from(table: string): any
    rpc(nom: string, args?: Record<string, unknown>): any
    [autre: string]: any
  }
  export function createClient(
    url: string,
    cle: string,
    options?: Record<string, unknown>,
  ): SupabaseClient
}

declare const Deno: {
  env: { get(cle: string): string | undefined }
  serve(gestionnaire: (req: Request) => Response | Promise<Response>): unknown
}
