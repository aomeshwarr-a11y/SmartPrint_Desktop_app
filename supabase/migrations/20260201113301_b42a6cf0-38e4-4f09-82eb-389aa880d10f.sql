-- VPrint Database Schema

-- Locations table
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Printers table
CREATE TABLE public.printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID REFERENCES public.locations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'busy')),
  paper_count INTEGER DEFAULT 500,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Orders table
CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  printer_id UUID REFERENCES public.printers(id) ON DELETE SET NULL,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  pages INTEGER NOT NULL DEFAULT 1,
  color_type TEXT NOT NULL DEFAULT 'bw' CHECK (color_type IN ('bw', 'color')),
  copies INTEGER NOT NULL DEFAULT 1,
  amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'printing', 'completed', 'failed', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Payments table
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  razorpay_payment_id TEXT,
  razorpay_order_id TEXT,
  amount DECIMAL(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Print Jobs table
CREATE TABLE public.print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES public.orders(id) ON DELETE CASCADE NOT NULL,
  printer_id UUID REFERENCES public.printers(id) ON DELETE SET NULL NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'printing', 'done', 'failed')),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Admin roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- User roles table for admin access
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE (user_id, role)
);

-- Enable RLS on all tables
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function for checking roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Locations: Public read, admin write
CREATE POLICY "Anyone can view active locations"
  ON public.locations FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can manage locations"
  ON public.locations FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Printers: Public read, admin write
CREATE POLICY "Anyone can view printers"
  ON public.printers FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage printers"
  ON public.printers FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Orders: Public insert/read for own orders, admin full access
CREATE POLICY "Anyone can create orders"
  ON public.orders FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can view orders"
  ON public.orders FOR SELECT
  USING (true);

CREATE POLICY "Anyone can update orders"
  ON public.orders FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admins can delete orders"
  ON public.orders FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Payments: Public insert/read, admin full access
CREATE POLICY "Anyone can create payments"
  ON public.payments FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can view payments"
  ON public.payments FOR SELECT
  USING (true);

CREATE POLICY "Anyone can update payments"
  ON public.payments FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Print Jobs: Public insert/read, admin full access
CREATE POLICY "Anyone can create print jobs"
  ON public.print_jobs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can view print jobs"
  ON public.print_jobs FOR SELECT
  USING (true);

CREATE POLICY "Anyone can update print jobs"
  ON public.print_jobs FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- User roles: Admin only
CREATE POLICY "Admins can view all user roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR auth.uid() = user_id);

CREATE POLICY "Admins can manage user roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Updated at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add triggers for updated_at
CREATE TRIGGER update_printers_updated_at
  BEFORE UPDATE ON public.printers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert sample locations and printers
INSERT INTO public.locations (name, city, address) VALUES
  ('VPrint Hub Central', 'Mumbai', 'Shop 12, Phoenix Mall, Lower Parel'),
  ('VPrint Express', 'Mumbai', 'Andheri Station, West Exit'),
  ('VPrint Campus', 'Pune', 'FC Road, Near Fergusson College');

-- Insert sample printers
INSERT INTO public.printers (location_id, name, status) 
SELECT id, 'Kiosk A', 'online' FROM public.locations WHERE name = 'VPrint Hub Central'
UNION ALL
SELECT id, 'Kiosk B', 'online' FROM public.locations WHERE name = 'VPrint Hub Central'
UNION ALL
SELECT id, 'Kiosk 1', 'online' FROM public.locations WHERE name = 'VPrint Express'
UNION ALL
SELECT id, 'Kiosk 1', 'offline' FROM public.locations WHERE name = 'VPrint Campus';

-- Create storage bucket for uploaded files
INSERT INTO storage.buckets (id, name, public) VALUES ('print-files', 'print-files', true);

-- Storage policies
CREATE POLICY "Anyone can upload print files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'print-files');

CREATE POLICY "Anyone can view print files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'print-files');

CREATE POLICY "Anyone can delete their print files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'print-files');