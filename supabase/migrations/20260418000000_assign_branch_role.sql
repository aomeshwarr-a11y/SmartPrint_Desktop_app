-- Assign branch_owner role to jbiet@vprint.in
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'branch_owner'
FROM auth.users
WHERE email = 'jbiet@vprint.in'
ON CONFLICT (user_id, role) DO NOTHING;
