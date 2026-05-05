-- ============================================
-- CORREÇÃO: Consistência de Relatórios (Nutricionista)
-- ============================================

-- 1. Atualizar contagem de próximos dias (Upcoming)
-- Agora inclui tanto 'reserved' quanto 'confirmed' para não sumir quem já fez check-in
CREATE OR REPLACE FUNCTION public.get_upcoming_counts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_counts jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'nutricionista') THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('date', d.dt, 'weekday', to_char(d.dt, 'TMDy'),
      'weekday_full', to_char(d.dt, 'TMDay'), 'count', COALESCE(s.cnt, 0))
    ORDER BY d.dt
  ), '[]'::jsonb) INTO v_counts
  FROM generate_series(CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days', '1 day'::interval) AS d(dt)
  LEFT JOIN (
    SELECT reservation_date, COUNT(*) AS cnt FROM public.reservations
    WHERE status IN ('reserved', 'confirmed') AND reservation_date >= CURRENT_DATE
    GROUP BY reservation_date
  ) s ON s.reservation_date = d.dt::date
  WHERE EXTRACT(ISODOW FROM d.dt) <= 5;

  RETURN jsonb_build_object('success', true, 'upcoming', v_counts);
END; $$;

-- 2. Atualizar relatório mensal
-- Filtra o 'total' para ignorar cancelamentos e no-shows, focando no planejado (reservado + confirmado)
CREATE OR REPLACE FUNCTION public.get_monthly_report(p_month INT, p_year INT)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_start DATE;
  v_end DATE;
  v_total_reserved INT; v_total_confirmed INT; v_total_no_show INT;
  v_daily jsonb;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  IF v_role NOT IN ('admin', 'nutricionista') THEN RETURN jsonb_build_object('error', 'Acesso negado'); END IF;

  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::date;

  SELECT COUNT(*) FILTER (WHERE status IN ('reserved','confirmed')),
         COUNT(*) FILTER (WHERE status = 'confirmed'),
         COUNT(*) FILTER (WHERE status = 'no_show')
  INTO v_total_reserved, v_total_confirmed, v_total_no_show
  FROM public.reservations WHERE reservation_date BETWEEN v_start AND v_end;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('date', d.dt, 'weekday', to_char(d.dt, 'Dy'),
      'total', COALESCE(s.total, 0), 'confirmed', COALESCE(s.confirmed, 0),
      'no_show', COALESCE(s.no_show, 0))
    ORDER BY d.dt
  ), '[]'::jsonb) INTO v_daily
  FROM generate_series(v_start, v_end, '1 day'::interval) AS d(dt)
  LEFT JOIN (
    SELECT reservation_date,
      COUNT(*) FILTER (WHERE status IN ('reserved', 'confirmed')) AS total,
      COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
      COUNT(*) FILTER (WHERE status = 'no_show') AS no_show
    FROM public.reservations WHERE reservation_date BETWEEN v_start AND v_end
    GROUP BY reservation_date
  ) s ON s.reservation_date = d.dt::date
  WHERE EXTRACT(ISODOW FROM d.dt) <= 5;

  RETURN jsonb_build_object('success', true,
    'month', p_month, 'year', p_year,
    'total_reserved', v_total_reserved, 'total_confirmed', v_total_confirmed,
    'total_no_show', v_total_no_show,
    'attendance_rate', CASE WHEN v_total_reserved > 0 THEN ROUND((v_total_confirmed::numeric / v_total_reserved) * 100, 1) ELSE 0 END,
    'daily', v_daily);
END; $$;
