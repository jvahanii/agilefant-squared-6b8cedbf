
-- Public bucket for work item image attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('work-item-attachments', 'work-item-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Public read for the bucket
CREATE POLICY "Work item attachments are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'work-item-attachments');

-- Org members can upload into folders named after their org id
CREATE POLICY "Org members can upload work item attachments"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'work-item-attachments'
  AND (
    public.is_member_of(auth.uid(), ((storage.foldername(name))[1])::uuid)
    OR public.is_superuser(auth.uid())
  )
);

-- Org members can delete their org's attachments
CREATE POLICY "Org members can delete work item attachments"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'work-item-attachments'
  AND (
    public.is_member_of(auth.uid(), ((storage.foldername(name))[1])::uuid)
    OR public.is_superuser(auth.uid())
  )
);
