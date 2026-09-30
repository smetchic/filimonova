-- A supplier price import evaluates and persists the whole immutable snapshot in
-- one transaction.  Large supplier files can legitimately exceed the short
-- PostgREST role timeout, so keep the operation atomic and give this RPC its
-- own bounded execution window.
alter function public.apply_supplier_spec_import(uuid,text,text,text,jsonb)
  set statement_timeout = '60s';
