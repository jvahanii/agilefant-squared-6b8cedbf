// Types so `tsc -p tsconfig.functions.json` can check edge functions.
//
// These files run on Deno, which resolves imports by URL and provides its own
// globals. Node's tsc can do neither, which is why they went unchecked — and
// why `fillDeadlines is not defined` reached production twice before anything
// noticed. Nothing here is imported at runtime: it only tells the compiler what
// Deno already provides.
//
// Shims stay as thin as the code needs. A remote module's real types come from
// the local package where there is one, so an actual type error is still caught.

declare const Deno: {
  env: {
    get(key: string): string | undefined;
  };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

declare module 'https://esm.sh/@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js';
}
declare module 'https://esm.sh/@supabase/supabase-js@2.45.0' {
  export * from '@supabase/supabase-js';
}
declare module 'https://esm.sh/@supabase/supabase-js@2.57.2' {
  export * from '@supabase/supabase-js';
}

declare module 'https://deno.land/std@0.190.0/http/server.ts' {
  export function serve(handler: (request: Request) => Response | Promise<Response>): void;
}

// Stripe is not a dependency of this project, so there are no real types to
// borrow: the shim keeps the checker quiet about the import itself.
declare module 'https://esm.sh/stripe@18.5.0' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Stripe: any;
  export default Stripe;
}
