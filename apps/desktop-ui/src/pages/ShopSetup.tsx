import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

interface ShopFormState {
  name: string;
  address: string;
  slug: string;
}

export default function ShopSetup() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState<ShopFormState>({ name: "", address: "", slug: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadExistingShop() {
      if (!session) return;
      const { data, error: fetchError } = await supabase
        .from("shops")
        .select("name, slug")
        .eq("owner_user_id", session.user.id)
        .maybeSingle();

      if (!fetchError && data) {
        setForm((prev) => ({ ...prev, name: data.name ?? "", slug: data.slug ?? "" }));
      }
      setLoading(false);
    }
    void loadExistingShop();
  }, [session]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!session) return;
    setSaving(true);
    setError(null);

    const slug = form.slug || slugify(form.name);

    const { error: upsertError } = await supabase.from("shops").upsert(
      {
        owner_user_id: session.user.id,
        name: form.name,
        slug,
        status: "active",
      },
      { onConflict: "owner_user_id" },
    );

    setSaving(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    navigate("/subscription");
  }

  function slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  }

  if (loading) return <p className="text-brand-500">Loading...</p>;

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-1 text-xl font-semibold text-brand-900">Shop setup</h1>
      <p className="mb-6 text-sm text-brand-500">Tell us about your print shop.</p>

      <form onSubmit={handleSubmit} className="card space-y-4">
        <div>
          <label className="label" htmlFor="name">
            Shop name
          </label>
          <input
            id="name"
            required
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>

        <div>
          <label className="label" htmlFor="address">
            Address
          </label>
          <input
            id="address"
            className="input"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>

        <div>
          <label className="label" htmlFor="slug">
            Public URL slug
          </label>
          <div className="flex items-center gap-2 text-sm text-brand-500">
            <span>smartprinter.in/s/</span>
            <input
              id="slug"
              className="input"
              placeholder={slugify(form.name) || "your-shop"}
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
            />
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" className="btn-primary w-full" disabled={saving}>
          {saving ? "Saving..." : "Save and continue"}
        </button>
      </form>
    </div>
  );
}
