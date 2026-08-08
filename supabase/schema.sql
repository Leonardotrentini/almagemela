-- Almagemela leads
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  optin boolean NOT NULL DEFAULT false,
  card text,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'almagemela',
  user_agent text
);

CREATE INDEX IF NOT EXISTS leads_email_idx ON public.leads (email);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON public.leads (created_at DESC);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Sem policies públicas: só a API server-side (secret key) grava/lê.
