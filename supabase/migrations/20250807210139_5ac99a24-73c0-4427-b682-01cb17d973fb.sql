-- Fix security issues by setting search_path for functions
drop function if exists public.update_updated_at_column();
drop function if exists public.handle_new_user();

-- Create function to update updated_at timestamp with secure search_path
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql security definer set search_path = '';

-- Create function to handle new user signup with secure search_path
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer set search_path = '';

-- Recreate triggers
drop trigger if exists update_profiles_updated_at on public.profiles;
drop trigger if exists on_auth_user_created on auth.users;

create trigger update_profiles_updated_at
  before update on public.profiles
  for each row
  execute function public.update_updated_at_column();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();