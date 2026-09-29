-- Internal numbering helpers are called by SECURITY DEFINER create_invoice/create_job.
-- Browser roles have no legitimate reason to execute them directly.
begin;
revoke all on function public.next_invoice_number(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.next_job_reference(uuid, integer)
  from public, anon, authenticated;
commit;
