-- SC-V2.2 review artifact ONLY. Do not install without separate approval.
-- Requires Block 2B/2C and is_company_account_writable(uuid). No pricing/asset changes.
BEGIN;

-- Fail rather than replace an existing or unexpected public API/overload.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('scv22_country_valid','scv22_coverage',
      'scv22_manager','scv22_lock_manager','scv22_supplier','scv22_display_name','scv22_country_metadata','subscriber_supplier_directory',
      'company_central_suppliers','set_company_central_suppliers','company_operating_country',
      'set_company_operating_country')) THEN
    RAISE EXCEPTION 'SC-V2.2 function name collision; inspect before installation';
  END IF;
END $$;

-- Exact canonical ISO allowlist shared with src/lib/countries.ts. No regex-only validation.
CREATE FUNCTION public.scv22_country_valid(p_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_code IS NOT NULL AND p_code = ANY(string_to_array(
    'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW', ' '))
$$;
CREATE FUNCTION public.scv22_coverage(p_codes text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN array_ndims(p_codes)=1 AND cardinality(p_codes) BETWEEN 1 AND 249
    AND NOT EXISTS (SELECT 1 FROM unnest(p_codes) c WHERE NOT public.scv22_country_valid(c))
    THEN ARRAY(SELECT DISTINCT c FROM unnest(p_codes) c ORDER BY c) ELSE NULL END
$$;

-- Separate from legacy free-text country, address and currency. No inferred/backfilled default.
CREATE TABLE public.company_supplier_preferences (
  company_account_id uuid PRIMARY KEY REFERENCES public.company_accounts(id) ON DELETE RESTRICT,
  operating_country_code text CHECK (operating_country_code IS NULL OR public.scv22_country_valid(operating_country_code)),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  -- Transient CAS input, consumed by the trigger; never persisted or returned by an RPC.
  write_expected_revision bigint CHECK (write_expected_revision IS NULL),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_supplier_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.company_supplier_preferences FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.company_supplier_preferences TO service_role;

-- Direct writers supply write_expected_revision; stale OR omitted evidence fails closed.
CREATE FUNCTION public.scv22_country_metadata() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.write_expected_revision IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Country revision conflict'; END IF;
    NEW.revision := 1;
    NEW.updated_at := clock_timestamp();
  ELSE
    IF NEW.company_account_id IS DISTINCT FROM OLD.company_account_id THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid operating country'; END IF;
    IF NEW.write_expected_revision IS DISTINCT FROM OLD.revision OR NEW.revision IS DISTINCT FROM OLD.revision THEN
      RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Country revision conflict'; END IF;
    NEW.write_expected_revision := NULL;
    IF NEW.operating_country_code IS DISTINCT FROM OLD.operating_country_code THEN
      IF OLD.revision>=9007199254740991 THEN
        RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Country revision conflict'; END IF;
      NEW.revision := OLD.revision + 1;
      NEW.updated_at := greatest(clock_timestamp(),OLD.updated_at + interval '1 microsecond');
    ELSE
      NEW.revision := OLD.revision;
      NEW.updated_at := OLD.updated_at;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scv22_country_metadata BEFORE INSERT OR UPDATE ON public.company_supplier_preferences
  FOR EACH ROW EXECUTE FUNCTION public.scv22_country_metadata();

CREATE FUNCTION public.scv22_manager(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_company::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' AND (
    EXISTS (SELECT 1 FROM public.company_accounts ca WHERE ca.id=p_company AND ca.owner_user_id=auth.uid())
    OR EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.company_account_id=p_company
      AND cm.user_id=auth.uid() AND cm.status='active' AND cm.role IN ('owner','manager')))
$$;
-- Company row serializes missing-row creation, country CAS and batches. Lock member authority
-- too: concurrent membership removal/demotion and account restriction cannot race a write.
CREATE FUNCTION public.scv22_lock_manager(p_company uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_owner uuid;
BEGIN
  IF public.scv22_manager(p_company) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Supplier management denied'; END IF;
  SELECT ca.owner_user_id INTO v_owner FROM public.company_accounts ca WHERE ca.id=p_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Supplier management denied'; END IF;
  IF v_owner IS DISTINCT FROM auth.uid() THEN
    PERFORM 1 FROM public.company_members cm WHERE cm.company_account_id=p_company
      AND cm.user_id=auth.uid() AND cm.status='active' AND cm.role IN ('owner','manager') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Supplier management denied'; END IF;
  END IF;
  IF public.is_company_account_writable(p_company) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Supplier management denied';
  END IF;
END $$;
-- Projection only: never UPDATE the original platform-owned supplier name.
CREATE FUNCTION public.scv22_display_name(p_name text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_units integer := 0; v_char text; v_name text := ''; v_size integer; i integer;
BEGIN
  -- UTF-8 text cannot contain lone surrogates or NUL. Other C0/DEL/C1 become spaces.
  FOR i IN 1..least(coalesce(length(p_name),0),200) LOOP
    v_char := substr(p_name,i,1);
    IF ascii(v_char)<32 OR ascii(v_char) BETWEEN 127 AND 159 THEN v_char := ' '; END IF;
    v_size := CASE WHEN ascii(v_char)>65535 THEN 2 ELSE 1 END;
    IF v_units+v_size>200 THEN EXIT; END IF;
    v_units := v_units+v_size;
    v_name := v_name||v_char;
  END LOOP;
  v_name := btrim(v_name,U&'\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
  RETURN coalesce(nullif(v_name,''),'Unnamed supplier');
END $$;
CREATE FUNCTION public.scv22_supplier(p_id uuid, p_name text, p_status text, p_countries text[]) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_id IS NULL OR p_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR p_status IS NULL OR p_status NOT IN ('active','paused','retired','draft') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Supplier unavailable'; END IF;
  RETURN jsonb_build_object('kind','central','id',p_id,'name',public.scv22_display_name(p_name),
    'status',p_status,'countries',public.scv22_coverage(p_countries));
END $$;

CREATE FUNCTION public.subscriber_supplier_directory(p_company_account_id uuid,
  p_mode text DEFAULT 'international', p_search text DEFAULT '', p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_country text;
BEGIN
  IF public.scv22_manager(p_company_account_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Supplier management denied'; END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('recommended','international') OR p_search IS NULL
    OR length(p_search)>100 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100
    OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid supplier request'; END IF;
  SELECT p.operating_country_code INTO v_country FROM public.company_supplier_preferences p
    WHERE p.company_account_id=p_company_account_id;
  RETURN QUERY SELECT public.scv22_supplier(s.id,s.name,s.status,s.countries)
    FROM public.suppliers s WHERE s.status='active'
      AND (p_search='' OR strpos(lower(s.name),lower(p_search))>0)
      AND (p_mode='international' OR v_country=ANY(public.scv22_coverage(s.countries)))
    ORDER BY lower(s.name) COLLATE "C", s.id LIMIT p_limit OFFSET p_offset;
END $$;
CREATE FUNCTION public.company_central_suppliers(p_company_account_id uuid,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS SETOF jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.scv22_manager(p_company_account_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Supplier management denied'; END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid supplier request'; END IF;
  IF EXISTS (SELECT 1 FROM public.company_suppliers cs WHERE cs.company_account_id=p_company_account_id
    AND cs.revision NOT BETWEEN 1 AND 9007199254740991) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Supplier unavailable'; END IF;
  RETURN QUERY SELECT jsonb_build_object('companyAccountId',cs.company_account_id,
    'supplier',public.scv22_supplier(s.id,s.name,s.status,s.countries),
    'enabled',cs.enabled,'revision',cs.revision,'canEnable',s.status='active',
    'availability',CASE WHEN NOT cs.enabled THEN 'disabled' WHEN s.status='active' THEN 'available'
      WHEN s.status='paused' THEN 'supplier-paused' WHEN s.status='draft' THEN 'supplier-draft' ELSE 'supplier-retired' END)
    FROM public.company_suppliers cs JOIN public.suppliers s ON s.id=cs.supplier_id
    WHERE cs.company_account_id=p_company_account_id AND s.status IN ('active','paused','retired','draft')
    ORDER BY s.id LIMIT p_limit OFFSET p_offset;
END $$;

-- Array of the exact SC-V2.1 commands, central only, maximum 100; duplicate targets rejected.
-- expectedRevision NULL means absent, not "ignore revision". No-op still checks revision/state.
-- Any error aborts the entire statement including earlier commands. No partial-success results.
CREATE FUNCTION public.set_company_central_suppliers(p_company_account_id uuid, p_commands jsonb)
RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c jsonb; v_id uuid; v_expected bigint; v_enabled boolean; v_status text;
  v_row public.company_suppliers%ROWTYPE; v_seen uuid[] := '{}'; v_ids uuid[] := '{}';
BEGIN
  PERFORM public.scv22_lock_manager(p_company_account_id);
  IF jsonb_typeof(p_commands) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid supplier command'; END IF;
  IF jsonb_array_length(p_commands) NOT BETWEEN 1 AND 100 OR pg_column_size(p_commands)>65536 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid supplier command'; END IF;
  -- Validate every shape before casting/locking; never echo submitted/private data in errors.
  FOR c IN SELECT value FROM jsonb_array_elements(p_commands) LOOP
    IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid supplier command'; END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(c) k) IS DISTINCT FROM
      ARRAY['action','companyAccountId','enabled','expectedRevision','supplier']
      OR c->>'action' IS DISTINCT FROM 'set-enabled'
      OR lower(c->>'companyAccountId') IS DISTINCT FROM p_company_account_id::text
      OR jsonb_typeof(c->'enabled') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(c->'supplier') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid supplier command'; END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(c->'supplier') k) IS DISTINCT FROM ARRAY['id','kind']
      OR c->'supplier'->>'kind' IS DISTINCT FROM 'central'
      OR coalesce(c->'supplier'->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      OR (c->'expectedRevision'<>'null'::jsonb AND (jsonb_typeof(c->'expectedRevision')<>'number'
        OR (c->>'expectedRevision') !~ '^[1-9][0-9]{0,15}$')) THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid supplier command'; END IF;
    IF c->'expectedRevision'<>'null'::jsonb AND (c->>'expectedRevision')::numeric>9007199254740991 THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid supplier command'; END IF;
    v_id := (c->'supplier'->>'id')::uuid;
    IF v_id=ANY(v_seen) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid supplier command'; END IF;
    v_seen := array_append(v_seen,v_id);
  END LOOP;
  -- Stable global supplier lock order prevents opposite-order batches deadlocking.
  PERFORM s.id FROM public.suppliers s WHERE s.id=ANY(v_seen) ORDER BY s.id FOR SHARE;
  FOR c IN SELECT value FROM jsonb_array_elements(p_commands) ORDER BY value->'supplier'->>'id' LOOP
    v_id := (c->'supplier'->>'id')::uuid;
    v_expected := (c->>'expectedRevision')::bigint;
    v_enabled := (c->>'enabled')::boolean;
    SELECT s.status INTO v_status FROM public.suppliers s WHERE s.id=v_id;
    IF NOT FOUND OR v_status NOT IN ('active','paused','retired','draft') OR (v_enabled AND v_status<>'active') THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Supplier unavailable'; END IF;
    SELECT cs.* INTO v_row FROM public.company_suppliers cs
      WHERE cs.company_account_id=p_company_account_id AND cs.supplier_id=v_id FOR UPDATE;
    IF FOUND THEN
      IF v_expected IS DISTINCT FROM v_row.revision THEN
        RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Supplier revision conflict'; END IF;
      IF v_row.enabled IS DISTINCT FROM v_enabled THEN
        IF v_row.revision>=9007199254740991 THEN
          RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Supplier revision conflict'; END IF;
        UPDATE public.company_suppliers SET enabled=v_enabled
          WHERE company_account_id=p_company_account_id AND supplier_id=v_id;
      END IF;
    ELSE
      IF v_status='draft' THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Supplier unavailable'; END IF;
      IF v_expected IS NOT NULL THEN
        RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Supplier revision conflict'; END IF;
      -- Disable of an absent relationship is a no-op; do not manufacture history.
      IF v_enabled THEN
        INSERT INTO public.company_suppliers(company_account_id,supplier_id,enabled)
          VALUES(p_company_account_id,v_id,true) ON CONFLICT DO NOTHING;
        IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Supplier revision conflict'; END IF;
      END IF;
    END IF;
    v_ids := array_append(v_ids,v_id);
  END LOOP;
  RETURN QUERY SELECT jsonb_build_object('companyAccountId',p_company_account_id,
    'supplier',public.scv22_supplier(s.id,s.name,s.status,s.countries),
    'enabled',coalesce(cs.enabled,false),'revision',cs.revision,'canEnable',s.status='active',
    'availability',CASE WHEN NOT coalesce(cs.enabled,false) THEN 'disabled' WHEN s.status='active' THEN 'available'
      WHEN s.status='paused' THEN 'supplier-paused' WHEN s.status='draft' THEN 'supplier-draft' ELSE 'supplier-retired' END)
    FROM public.suppliers s LEFT JOIN public.company_suppliers cs
      ON cs.supplier_id=s.id AND cs.company_account_id=p_company_account_id
    WHERE s.id=ANY(v_ids) ORDER BY s.id;
END $$;

CREATE FUNCTION public.company_operating_country(p_company_account_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  IF public.scv22_manager(p_company_account_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='Supplier management denied'; END IF;
  SELECT jsonb_build_object('companyAccountId',p_company_account_id,'countryCode',p.operating_country_code,'revision',p.revision)
    INTO v_result FROM public.company_supplier_preferences p WHERE p.company_account_id=p_company_account_id;
  RETURN coalesce(v_result,jsonb_build_object('companyAccountId',p_company_account_id,'countryCode',NULL,'revision',NULL));
END $$;
CREATE FUNCTION public.set_company_operating_country(p_company_account_id uuid, p_country_code text,
  p_expected_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.company_supplier_preferences%ROWTYPE;
BEGIN
  PERFORM public.scv22_lock_manager(p_company_account_id);
  IF p_country_code IS NOT NULL AND NOT public.scv22_country_valid(p_country_code) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='Invalid operating country'; END IF;
  SELECT p.* INTO r FROM public.company_supplier_preferences p WHERE p.company_account_id=p_company_account_id FOR UPDATE;
  IF FOUND THEN
    IF p_expected_revision IS DISTINCT FROM r.revision THEN
      RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Country revision conflict'; END IF;
    IF p_country_code IS DISTINCT FROM r.operating_country_code THEN
      IF r.revision>=9007199254740991 THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Country revision conflict'; END IF;
      UPDATE public.company_supplier_preferences SET operating_country_code=p_country_code,
        write_expected_revision=p_expected_revision
        WHERE company_account_id=p_company_account_id AND revision=p_expected_revision;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Country revision conflict'; END IF;
    END IF;
  ELSE
    IF p_expected_revision IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Country revision conflict'; END IF;
    IF p_country_code IS NOT NULL THEN
      INSERT INTO public.company_supplier_preferences(company_account_id,operating_country_code)
        VALUES(p_company_account_id,p_country_code) ON CONFLICT DO NOTHING;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='Country revision conflict'; END IF;
    END IF;
  END IF;
  RETURN public.company_operating_country(p_company_account_id);
END $$;

-- Remove bypass paths, including column grants. Keep service_role/Platform Admin grants intact.
REVOKE ALL ON public.company_suppliers FROM PUBLIC, anon, authenticated;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT attname FROM pg_catalog.pg_attribute WHERE attrelid='public.company_suppliers'::regclass
    AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.company_suppliers FROM PUBLIC, anon, authenticated',
      c.attname,c.attname,c.attname,c.attname);
  END LOOP;
END $$;
DROP POLICY "Company supplier managers insert" ON public.company_suppliers;
DROP POLICY "Company supplier managers update" ON public.company_suppliers;
-- Existing SELECT policy retained as defense-in-depth; no direct client SELECT grant.
REVOKE ALL ON FUNCTION public.scv22_country_valid(text), public.scv22_coverage(text[]),
  public.scv22_display_name(text), public.scv22_country_metadata(),
  public.scv22_manager(uuid), public.scv22_lock_manager(uuid), public.scv22_supplier(uuid,text,text,text[]),
  public.subscriber_supplier_directory(uuid,text,text,integer,integer), public.company_central_suppliers(uuid,integer,integer),
  public.set_company_central_suppliers(uuid,jsonb), public.company_operating_country(uuid),
  public.set_company_operating_country(uuid,text,bigint) FROM PUBLIC, anon, authenticated, service_role;
-- CHECK constraints execute as the direct writer: permit only this pure validator to service_role.
GRANT EXECUTE ON FUNCTION public.scv22_country_valid(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.subscriber_supplier_directory(uuid,text,text,integer,integer),
  public.company_central_suppliers(uuid,integer,integer), public.set_company_central_suppliers(uuid,jsonb),
  public.company_operating_country(uuid), public.set_company_operating_country(uuid,text,bigint) TO authenticated;
COMMIT;
