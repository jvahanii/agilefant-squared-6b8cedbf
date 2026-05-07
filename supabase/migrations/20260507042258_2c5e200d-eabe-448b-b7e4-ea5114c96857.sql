DROP TRIGGER IF EXISTS trim_organization_backups_trigger ON public.organization_backups;
CREATE TRIGGER trim_organization_backups_trigger
AFTER INSERT ON public.organization_backups
FOR EACH ROW
EXECUTE FUNCTION public.trim_organization_backups();