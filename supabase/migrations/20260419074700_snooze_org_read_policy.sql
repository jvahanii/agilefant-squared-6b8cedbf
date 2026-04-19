-- Allow org members to read other members' active snoozes within the same organization.
-- This enables the "greyed out for others" UI feature: when a user snoozes an item,
-- other members of the same org can see it is snoozed (and by whom / until when).
CREATE POLICY "Org members can read org snoozes"
ON public.work_item_snoozes
FOR SELECT
TO authenticated
USING (is_member_of(auth.uid(), organization_id));
