
-- Lowercase all existing organization slugs
UPDATE public.organizations SET slug = lower(slug) WHERE slug != lower(slug);

-- Create a trigger function to enforce lowercase slugs on insert/update
CREATE OR REPLACE FUNCTION public.enforce_lowercase_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.slug := lower(NEW.slug);
  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_org_slug_lowercase
BEFORE INSERT OR UPDATE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_lowercase_slug();
