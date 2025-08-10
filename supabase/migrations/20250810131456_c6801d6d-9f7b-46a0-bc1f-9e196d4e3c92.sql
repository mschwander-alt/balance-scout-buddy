-- Add assigned_member_id column to temp_account_matches table for assignments
ALTER TABLE public.temp_account_matches 
ADD COLUMN assigned_member_id UUID REFERENCES public.team_members(id) ON DELETE SET NULL;