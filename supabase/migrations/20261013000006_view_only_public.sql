-- Public library is view-only: no public downloads.
alter table public.assets alter column public_download set default false;
update public.assets set public_download = false where public_download is distinct from false;
