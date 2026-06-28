-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Create user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS: users can read their own roles, admins can read all
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all roles" ON public.user_roles
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Products table (admin-configurable)
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subtitle TEXT,
  warranty TEXT,
  badge_type TEXT NOT NULL DEFAULT 'installed' CHECK (badge_type IN ('installed', 'optional')),
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  price_label TEXT DEFAULT 'Included in Selling Price',
  disclosure TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Anyone can read active products
CREATE POLICY "Anyone can view active products" ON public.products
  FOR SELECT USING (true);
-- Only admins can insert/update/delete
CREATE POLICY "Admins can insert products" ON public.products
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update products" ON public.products
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete products" ON public.products
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'));

-- Addendums table (saved completed forms)
CREATE TABLE IF NOT EXISTS public.addendums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id),
  vehicle_ymm TEXT,
  vehicle_stock TEXT,
  vehicle_vin TEXT,
  addendum_date DATE,
  products_snapshot JSONB NOT NULL DEFAULT '[]',
  initials JSONB DEFAULT '{}',
  optional_selections JSONB DEFAULT '{}',
  customer_signature_data TEXT,
  customer_signature_type TEXT CHECK (customer_signature_type IN ('draw', 'type')),
  cobuyer_signature_data TEXT,
  cobuyer_signature_type TEXT CHECK (cobuyer_signature_type IN ('draw', 'type')),
  employee_signature_data TEXT,
  employee_signature_type TEXT CHECK (employee_signature_type IN ('draw', 'type')),
  customer_name TEXT,
  cobuyer_name TEXT,
  employee_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'signed', 'completed')),
  total_installed NUMERIC(10,2),
  total_with_optional NUMERIC(10,2),
  signing_token UUID DEFAULT NULL,
  customer_signed_at TIMESTAMPTZ,
  cobuyer_signed_at TIMESTAMPTZ,
  employee_signed_at TIMESTAMPTZ,
  customer_ip TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.addendums ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX idx_addendums_signing_token ON public.addendums (signing_token) WHERE signing_token IS NOT NULL;

-- Authenticated users can CRUD addendums
CREATE POLICY "Auth users can view addendums" ON public.addendums
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth users can create addendums" ON public.addendums
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Creator or admin can update addendums" ON public.addendums
  FOR UPDATE TO authenticated
  USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'));

-- Allow anonymous access via signing token
CREATE POLICY "Anyone can view addendum by signing token"
ON public.addendums FOR SELECT TO anon
USING (signing_token IS NOT NULL);

CREATE POLICY "Anyone can update addendum via signing token"
ON public.addendums FOR UPDATE TO anon
USING (signing_token IS NOT NULL)
WITH CHECK (signing_token IS NOT NULL);

-- Function to look up by token safely
CREATE OR REPLACE FUNCTION public.get_addendum_by_token(_token UUID)
RETURNS SETOF public.addendums
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.addendums WHERE signing_token = _token LIMIT 1;
$$;

-- Profiles table for user display info
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles viewable by authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Trigger for auto-creating profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_addendums_updated_at BEFORE UPDATE ON public.addendums FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default products
INSERT INTO public.products (name, subtitle, warranty, badge_type, price, price_label, disclosure, sort_order) VALUES
  ('Ceramic Protection Package', 'Full exterior & interior ceramic polymer coating application.', '7-Year / Unlimited-Mile Guarantee', 'installed', 1495.00, 'Included in Selling Price', 'Pre-Installed — Non-Removable: This product has been professionally applied to the vehicle prior to sale and cannot be removed. Its cost is included in the dealer''s selling price of this vehicle.', 1),
  ('Door Edge Guard & Handle Cup Protection Package', 'Pre-cut door edge guards & door handle cup protectors — installed on all applicable doors.', '5-Year Product Warranty', 'installed', 499.99, 'Included in Selling Price', 'Pre-Installed — Non-Removable: Door edge guards and handle cup protectors have been applied to this vehicle prior to sale and cannot be removed without potential damage to the vehicle''s finish.', 2),
  ('EvinEtch™ Anti-Theft Protection & Guarantee', 'VIN etching on all glass surfaces + theft deterrent registration + theft guarantee.', 'Theft Guarantee Included · See Terms', 'installed', 349.00, 'Included in Selling Price', 'Pre-Installed — Non-Removable: The vehicle''s VIN has been permanently etched onto all glass surfaces prior to sale. VIN etching is a permanent, irreversible process and cannot be removed.', 3),
  ('ValueShield™ — Market Value Protection Program', 'Protects up to $10,000 in market value under covered circumstances. See program terms.', 'Up to $10,000 Value Protection · See Program Terms', 'optional', 494.00, 'If Accepted', 'OPTIONAL PRODUCT — YOUR CHOICE: ValueShield™ has not been pre-installed or applied to this vehicle. You are under no obligation to purchase this product.', 4);