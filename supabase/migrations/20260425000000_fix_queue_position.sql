-- Fix queue position assignment
-- When a job moves to 'queued' status, calculate its position based on earlier jobs for the same printer.

CREATE OR REPLACE FUNCTION assign_queue_position()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'queued' AND (OLD.status IS DISTINCT FROM 'queued') THEN
    SELECT COUNT(*) + 1 INTO NEW.queue_position
    FROM print_jobs
    WHERE printer_id = NEW.printer_id
      AND status IN ('queued', 'printing')
      AND created_at < NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists to avoid errors on re-run
DROP TRIGGER IF EXISTS set_queue_position ON print_jobs;

CREATE TRIGGER set_queue_position
BEFORE UPDATE ON print_jobs
FOR EACH ROW EXECUTE FUNCTION assign_queue_position();

-- Function to get real-time queue position
CREATE OR REPLACE FUNCTION get_queue_position(job_id uuid)
RETURNS integer AS $$
DECLARE
  pos integer;
  job_printer uuid;
  job_created timestamptz;
BEGIN
  SELECT printer_id, created_at INTO job_printer, job_created
  FROM print_jobs WHERE id = job_id;

  SELECT COUNT(*) + 1 INTO pos
  FROM print_jobs
  WHERE printer_id = job_printer
    AND status IN ('queued', 'printing')
    AND created_at < job_created;

  RETURN pos;
END;
$$ LANGUAGE plpgsql;
