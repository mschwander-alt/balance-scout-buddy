-- Create storage bucket for trial balance uploads
insert into storage.buckets (id, name, public) values ('trial-balances', 'trial-balances', false);

-- Create storage policies for trial balances
create policy "Users can upload their own trial balances" 
on storage.objects for insert 
with check (bucket_id = 'trial-balances' AND auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can view their own trial balances" 
on storage.objects for select 
using (bucket_id = 'trial-balances' AND auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can update their own trial balances" 
on storage.objects for update 
using (bucket_id = 'trial-balances' AND auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can delete their own trial balances" 
on storage.objects for delete 
using (bucket_id = 'trial-balances' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create trial_balances table
create table public.trial_balances (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  filename text not null,
  file_path text not null,
  file_size bigint,
  upload_date timestamp with time zone default now() not null,
  status text default 'uploaded' check (status in ('uploaded', 'configured', 'processed')),
  
  -- Column mapping configuration
  account_number_column text,
  account_name_column text,
  current_year_column text,
  previous_year_column text,
  foreign_currency_column text,
  
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Enable RLS on trial_balances
alter table public.trial_balances enable row level security;

-- Create policies for trial_balances
create policy "Users can view their own trial balances" 
on public.trial_balances for select 
using (auth.uid() = user_id);

create policy "Users can insert their own trial balances" 
on public.trial_balances for insert 
with check (auth.uid() = user_id);

create policy "Users can update their own trial balances" 
on public.trial_balances for update 
using (auth.uid() = user_id);

create policy "Users can delete their own trial balances" 
on public.trial_balances for delete 
using (auth.uid() = user_id);

-- Create trigger for trial_balances updated_at
create trigger update_trial_balances_updated_at
  before update on public.trial_balances
  for each row
  execute function public.update_updated_at_column();