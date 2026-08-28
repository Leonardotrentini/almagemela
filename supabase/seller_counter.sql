-- Contador global de rotação de vendedores (LP → WhatsApp)
CREATE TABLE IF NOT EXISTS public.seller_counter (
  id text PRIMARY KEY DEFAULT 'global',
  seq bigint NOT NULL DEFAULT 0
);

INSERT INTO public.seller_counter (id, seq) VALUES ('global', 0)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.next_seller_seq()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_seq bigint;
BEGIN
  UPDATE seller_counter
  SET seq = seq + 1
  WHERE id = 'global'
  RETURNING seq INTO v_seq;

  IF v_seq IS NULL THEN
    INSERT INTO seller_counter (id, seq) VALUES ('global', 1)
    ON CONFLICT (id) DO UPDATE SET seq = seller_counter.seq + 1
    RETURNING seq INTO v_seq;
  END IF;

  RETURN v_seq;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_seller_seq() TO service_role;
