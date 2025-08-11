-- Fix critical security vulnerability in temp_account_matches table
-- Remove overly permissive policies that expose financial data to all users

-- Drop the existing policies that allow access to all users
DROP POLICY IF EXISTS "System can manage temp matches" ON public.temp_account_matches;
DROP POLICY IF EXISTS "Users can view their temp matches" ON public.temp_account_matches;

-- Create secure policies that restrict access based on trial_balance ownership
-- Users can only view temp matches for trial balances they own
CREATE POLICY "Users can view their own temp matches" 
ON public.temp_account_matches 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 
    FROM public.trial_balances 
    WHERE trial_balances.id = temp_account_matches.trial_balance_id 
    AND trial_balances.user_id = auth.uid()
  )
);

-- Users can only insert temp matches for trial balances they own
CREATE POLICY "Users can insert temp matches for their trial balances" 
ON public.temp_account_matches 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM public.trial_balances 
    WHERE trial_balances.id = temp_account_matches.trial_balance_id 
    AND trial_balances.user_id = auth.uid()
  )
);

-- Users can only update temp matches for trial balances they own
CREATE POLICY "Users can update their own temp matches" 
ON public.temp_account_matches 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 
    FROM public.trial_balances 
    WHERE trial_balances.id = temp_account_matches.trial_balance_id 
    AND trial_balances.user_id = auth.uid()
  )
);

-- Users can only delete temp matches for trial balances they own
CREATE POLICY "Users can delete their own temp matches" 
ON public.temp_account_matches 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 
    FROM public.trial_balances 
    WHERE trial_balances.id = temp_account_matches.trial_balance_id 
    AND trial_balances.user_id = auth.uid()
  )
);

-- Allow system operations (edge functions) to manage temp matches
-- This is needed for auto-matching functions to work
CREATE POLICY "System functions can manage temp matches" 
ON public.temp_account_matches 
FOR ALL 
USING (
  current_setting('role', true) = 'service_role'
);