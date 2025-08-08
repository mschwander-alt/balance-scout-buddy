-- Create team_members table
create table public.team_members (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  email text not null,
  role text default 'auditor' check (role in ('auditor', 'senior_auditor', 'manager', 'partner')),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Enable RLS on team_members
alter table public.team_members enable row level security;

-- Create policies for team_members
create policy "Users can view their team members" 
on public.team_members for select 
using (auth.uid() = user_id);

create policy "Users can insert their team members" 
on public.team_members for insert 
with check (auth.uid() = user_id);

create policy "Users can update their team members" 
on public.team_members for update 
using (auth.uid() = user_id);

create policy "Users can delete their team members" 
on public.team_members for delete 
using (auth.uid() = user_id);

-- Create account_groups table
create table public.account_groups (
  id uuid default gen_random_uuid() primary key,
  trial_balance_id uuid references public.trial_balances(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  description text,
  assigned_member_id uuid references public.team_members(id) on delete set null,
  status text default 'pending' check (status in ('pending', 'in_progress', 'completed', 'reviewed')),
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Enable RLS on account_groups
alter table public.account_groups enable row level security;

-- Create policies for account_groups
create policy "Users can view their account groups" 
on public.account_groups for select 
using (auth.uid() = user_id);

create policy "Users can insert their account groups" 
on public.account_groups for insert 
with check (auth.uid() = user_id);

create policy "Users can update their account groups" 
on public.account_groups for update 
using (auth.uid() = user_id);

create policy "Users can delete their account groups" 
on public.account_groups for delete 
using (auth.uid() = user_id);

-- Create account_group_assignments table (which accounts belong to which groups)
create table public.account_group_assignments (
  id uuid default gen_random_uuid() primary key,
  account_group_id uuid references public.account_groups(id) on delete cascade not null,
  account_number text not null,
  account_name text not null,
  current_year_balance numeric not null default 0,
  previous_year_balance numeric not null default 0,
  foreign_currency_balance numeric,
  created_at timestamp with time zone default now() not null
);

-- Enable RLS on account_group_assignments
alter table public.account_group_assignments enable row level security;

-- Create policies for account_group_assignments (inherit from account_groups)
create policy "Users can view assignments for their groups" 
on public.account_group_assignments for select 
using (
  exists (
    select 1 from public.account_groups 
    where account_groups.id = account_group_assignments.account_group_id 
    and account_groups.user_id = auth.uid()
  )
);

create policy "Users can insert assignments for their groups" 
on public.account_group_assignments for insert 
with check (
  exists (
    select 1 from public.account_groups 
    where account_groups.id = account_group_assignments.account_group_id 
    and account_groups.user_id = auth.uid()
  )
);

create policy "Users can update assignments for their groups" 
on public.account_group_assignments for update 
using (
  exists (
    select 1 from public.account_groups 
    where account_groups.id = account_group_assignments.account_group_id 
    and account_groups.user_id = auth.uid()
  )
);

create policy "Users can delete assignments for their groups" 
on public.account_group_assignments for delete 
using (
  exists (
    select 1 from public.account_groups 
    where account_groups.id = account_group_assignments.account_group_id 
    and account_groups.user_id = auth.uid()
  )
);

-- Create triggers for updated_at columns
create trigger update_team_members_updated_at
  before update on public.team_members
  for each row
  execute function public.update_updated_at_column();

create trigger update_account_groups_updated_at
  before update on public.account_groups
  for each row
  execute function public.update_updated_at_column();