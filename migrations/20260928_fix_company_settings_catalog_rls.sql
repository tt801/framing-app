-- Correct the two Block 6 membership predicates without changing the read policies or grants.
-- Replace both existing named policies atomically; a missing policy aborts the transaction.
BEGIN;

DROP POLICY "Company admins can write settings" ON public.company_settings;
CREATE POLICY "Company admins can write settings" ON public.company_settings
FOR ALL
USING (
  public.is_company_account_writable(company_account_id) AND (
    EXISTS (SELECT 1 FROM public.company_accounts ca
            WHERE ca.id = company_settings.company_account_id AND ca.owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.company_members cm
               WHERE cm.company_account_id = company_settings.company_account_id
                 AND cm.user_id = auth.uid() AND cm.status = 'active'
                 AND cm.role IN ('owner', 'manager'))
  )
)
WITH CHECK (
  public.is_company_account_writable(company_account_id) AND (
    EXISTS (SELECT 1 FROM public.company_accounts ca
            WHERE ca.id = company_settings.company_account_id AND ca.owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.company_members cm
               WHERE cm.company_account_id = company_settings.company_account_id
                 AND cm.user_id = auth.uid() AND cm.status = 'active'
                 AND cm.role IN ('owner', 'manager'))
  )
);

DROP POLICY "Company admins can write catalog" ON public.company_catalog;
CREATE POLICY "Company admins can write catalog" ON public.company_catalog
FOR ALL
USING (
  public.is_company_account_writable(company_account_id) AND (
    EXISTS (SELECT 1 FROM public.company_accounts ca
            WHERE ca.id = company_catalog.company_account_id AND ca.owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.company_members cm
               WHERE cm.company_account_id = company_catalog.company_account_id
                 AND cm.user_id = auth.uid() AND cm.status = 'active'
                 AND cm.role IN ('owner', 'manager'))
  )
)
WITH CHECK (
  public.is_company_account_writable(company_account_id) AND (
    EXISTS (SELECT 1 FROM public.company_accounts ca
            WHERE ca.id = company_catalog.company_account_id AND ca.owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.company_members cm
               WHERE cm.company_account_id = company_catalog.company_account_id
                 AND cm.user_id = auth.uid() AND cm.status = 'active'
                 AND cm.role IN ('owner', 'manager'))
  )
);

COMMIT;
