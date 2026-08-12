-- Almagemela leads (existente)
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

-- Sessões do quiz (progresso por visitante)
CREATE TABLE IF NOT EXISTS public.quiz_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL UNIQUE,
  ip text,
  name text,
  birth_date text,
  current_step int NOT NULL DEFAULT 0,
  max_step int NOT NULL DEFAULT 0,
  step_label text,
  card text,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'started',
  -- started | in_progress | reading | checkout | downsell | purchased
  last_event text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quiz_sessions_updated_at_idx ON public.quiz_sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS quiz_sessions_status_idx ON public.quiz_sessions (status);
CREATE INDEX IF NOT EXISTS quiz_sessions_name_idx ON public.quiz_sessions (name);

ALTER TABLE public.quiz_sessions ENABLE ROW LEVEL SECURITY;

-- Sem policies públicas: só a API server-side (secret key) grava/lê.
-- Se a tabela não aparecer na Data API: Project Settings → Data API → expose public.quiz_sessions
-- ou rode:
-- GRANT SELECT, INSERT, UPDATE ON public.quiz_sessions TO service_role;
