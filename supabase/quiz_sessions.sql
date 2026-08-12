-- Rode isto no Supabase SQL Editor (project da Almagemela)
-- Cria a tabela de progresso do quiz usada pelo /admin

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
  last_event text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quiz_sessions_updated_at_idx ON public.quiz_sessions (updated_at DESC);
CREATE INDEX IF NOT EXISTS quiz_sessions_status_idx ON public.quiz_sessions (status);
CREATE INDEX IF NOT EXISTS quiz_sessions_name_idx ON public.quiz_sessions (name);

ALTER TABLE public.quiz_sessions ENABLE ROW LEVEL SECURITY;
