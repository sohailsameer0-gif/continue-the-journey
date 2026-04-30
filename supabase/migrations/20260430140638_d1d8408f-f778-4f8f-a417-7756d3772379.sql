-- Permanently mark sohailsameer0@gmail.com as admin
-- 1) If the user already exists, assign admin role now
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users WHERE email = 'sohailsameer0@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- 2) Update handle_new_user trigger so this email automatically becomes admin on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email = 'sohailsameer0@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'outlet_owner')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;