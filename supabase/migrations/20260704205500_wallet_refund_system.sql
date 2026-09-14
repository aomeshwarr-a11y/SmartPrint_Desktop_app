-- Migration: Wallet Refund System for Failed Print Jobs
-- Implements automatic, idempotent wallet refunds on print failures caused by system errors.

-- 1. Extend the check constraint on transactions type to allow 'refund'
-- We drop the existing check constraint (if it exists) and recreate it with the new allowed type.
-- We append NOT VALID to prevent failure if legacy data contains custom test types.
DO $$
BEGIN
  ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
  ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check CHECK (type IN ('referral', 'deduction', 'withdrawal', 'refund')) NOT VALID;
EXCEPTION
  WHEN undefined_object THEN
    -- If constraint was named differently or doesn't exist, we fall back to adding it
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_type_check CHECK (type IN ('referral', 'deduction', 'withdrawal', 'refund')) NOT VALID;
END $$;

-- 2. Add refund and user association fields to print_jobs table
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS refund_status TEXT DEFAULT 'pending' CHECK (refund_status IN ('pending', 'refunded', 'not_eligible'));
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS refund_processed_at TIMESTAMP WITH TIME ZONE;

-- Create index on user_id for query performance on user's print jobs
CREATE INDEX IF NOT EXISTS idx_print_jobs_user_id ON public.print_jobs(user_id);
-- Create index on refund_status to quickly scan refund states
CREATE INDEX IF NOT EXISTS idx_print_jobs_refund_status ON public.print_jobs(refund_status);

-- 3. Define the refund trigger function
CREATE OR REPLACE FUNCTION public.handle_wallet_refund_on_failure()
RETURNS TRIGGER AS $$
DECLARE
  v_user RECORD;
  v_refund_eligible BOOLEAN := TRUE;
  v_refund_reason TEXT;
  v_log_msg TEXT;
BEGIN
  -- IMMUTABILITY GUARD: If a refund has already been processed (refunded or marked not_eligible),
  -- prevent any further changes to the refund columns.
  IF (OLD.refund_status IS DISTINCT FROM 'pending') THEN
    NEW.refund_status := OLD.refund_status;
    NEW.refund_reason := OLD.refund_reason;
    NEW.refund_processed_at := OLD.refund_processed_at;
    
    -- If status is failed, log duplicate prevention (just for auditing)
    IF (NEW.status = 'failed') THEN
      v_log_msg := format('Duplicate Refund Prevented: Job ID: %s has already been processed with status %s', NEW.id, OLD.refund_status);
      RAISE LOG '%', v_log_msg;
    END IF;
    
    RETURN NEW;
  END IF;

  -- Trigger refund evaluation only when transitioning to 'failed' from a non-failed status,
  -- and the job was paid, and refund status is 'pending'
  IF (NEW.status = 'failed') AND 
     (OLD.status IS DISTINCT FROM 'failed') AND 
     (NEW.payment_status = 'paid') AND 
     (NEW.refund_status = 'pending') THEN

    -- Step A. Check if user_id is set
    IF NEW.user_id IS NULL THEN
      NEW.refund_status := 'not_eligible';
      NEW.refund_reason := 'Refund Skipped: No user_id associated with this print job';
      v_log_msg := format('Refund Skipped: Job ID: %s has no user_id associated', NEW.id);
      RAISE LOG '%', v_log_msg;
      RETURN NEW;
    END IF;

    -- Step B. Fetch and lock user profile
    SELECT * INTO v_user FROM public.users WHERE id = NEW.user_id FOR UPDATE;
    IF NOT FOUND THEN
      NEW.refund_status := 'not_eligible';
      NEW.refund_reason := 'Refund Skipped: User profile not found in public.users';
      v_log_msg := format('Refund Skipped: User profile for ID %s not found for Job ID: %s', NEW.user_id, NEW.id);
      RAISE LOG '%', v_log_msg;
      RETURN NEW;
    END IF;

    -- Step C. Check refund eligibility
    -- Eligible: System errors (offline, disconnected, paper out, paper jam, toner empty, network failure, internal error, timeout)
    -- Not Eligible: Payment failure, user cancellation, invalid/corrupted user file, unsupported format, fraud/duplicate
    IF NEW.error_message IS NOT NULL AND (
       NEW.error_message ILIKE '%corrupt%' OR 
       NEW.error_message ILIKE '%invalid file%' OR 
       NEW.error_message ILIKE '%bad file%' OR 
       NEW.error_message ILIKE '%malformed%' OR 
       NEW.error_message ILIKE '%cancelled%' OR 
       NEW.error_message ILIKE '%cancel%' OR 
       NEW.error_message ILIKE '%format%' OR 
       NEW.error_message ILIKE '%extension%' OR 
       NEW.error_message ILIKE '%unsupported%' OR 
       NEW.error_message ILIKE '%duplicate%' OR 
       NEW.error_message ILIKE '%fraud%'
    ) THEN
      v_refund_eligible := FALSE;
      v_refund_reason := format('Not Eligible: User-caused print failure: %s', NEW.error_message);
    ELSE
      v_refund_eligible := TRUE;
      v_refund_reason := COALESCE(NEW.error_message, 'Unknown System Error');
    END IF;

    -- Step D. Execute refund if eligible
    IF v_refund_eligible THEN
      v_log_msg := format('Refund Started: Job ID: %s, User ID: %s, Amount: %s, Reason: %s', NEW.id, NEW.user_id, NEW.total_price, v_refund_reason);
      RAISE LOG '%', v_log_msg;

      -- Check for positive amount
      IF NEW.total_price <= 0 THEN
        NEW.refund_status := 'not_eligible';
        NEW.refund_reason := 'Refund Skipped: Print job price is zero or negative';
        v_log_msg := format('Refund Skipped: Job ID: %s has non-positive price: %s', NEW.id, NEW.total_price);
        RAISE LOG '%', v_log_msg;
        RETURN NEW;
      END IF;

      -- Credit the user's wallet
      UPDATE public.users 
      SET wallet = wallet + NEW.total_price,
          last_active_at = now()
      WHERE id = NEW.user_id;

      v_log_msg := format('Wallet Credited: User ID: %s credited with %s', NEW.user_id, NEW.total_price);
      RAISE LOG '%', v_log_msg;

      -- Create wallet transaction
      INSERT INTO public.transactions (user_id, amount, type, status)
      VALUES (NEW.user_id, NEW.total_price, 'refund', 'completed');

      v_log_msg := format('Transaction Created: Wallet Transaction logged for User ID: %s, Amount: %s', NEW.user_id, NEW.total_price);
      RAISE LOG '%', v_log_msg;

      -- Mark job as refunded
      NEW.refund_status := 'refunded';
      NEW.refund_reason := format('Refund Eligible: %s', v_refund_reason);
      NEW.refund_processed_at := now();

      v_log_msg := format('Refund Completed: Wallet successfully refunded for Job ID: %s, Amount: %s', NEW.id, NEW.total_price);
      RAISE LOG '%', v_log_msg;
    ELSE
      -- Mark job as not eligible
      NEW.refund_status := 'not_eligible';
      NEW.refund_reason := v_refund_reason;
      NEW.refund_processed_at := now();

      v_log_msg := format('Refund Skipped (Not Eligible): Job ID: %s, Reason: %s', NEW.id, v_refund_reason);
      RAISE LOG '%', v_log_msg;
    END IF;

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Create the trigger on print_jobs
DROP TRIGGER IF EXISTS trg_handle_wallet_refund_on_failure ON public.print_jobs;
CREATE TRIGGER trg_handle_wallet_refund_on_failure
  BEFORE UPDATE OF status ON public.print_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_wallet_refund_on_failure();
