-- Add upi_id to users table
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS upi_id TEXT;

-- Add updated_at to withdrawals table
ALTER TABLE public.withdrawals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Update RLS policy to allow users to update their own upi_id
-- We use a DO block to avoid error if policy exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'users' AND policyname = 'Users can update their own upi_id'
    ) THEN
        CREATE POLICY "Users can update their own upi_id" ON public.users
          FOR UPDATE USING (auth.uid() = id)
          WITH CHECK (auth.uid() = id);
    END IF;
END
$$;
