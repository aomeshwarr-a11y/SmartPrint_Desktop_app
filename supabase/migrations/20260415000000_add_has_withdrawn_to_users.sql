-- Add has_withdrawn column to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS has_withdrawn BOOLEAN DEFAULT false NOT NULL;
