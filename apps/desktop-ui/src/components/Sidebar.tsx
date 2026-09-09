import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/jobs/active", label: "Active Jobs" },
  { to: "/jobs/history", label: "Job History" },
  { to: "/printers/status", label: "Printer Status" },
  { to: "/printers/authorize", label: "Authorize Printers" },
  { to: "/qr", label: "QR Code" },
  { to: "/subscription", label: "Subscription" },
  { to: "/settings", label: "Settings" },
  { to: "/diagnostics", label: "Diagnostics" },
];

export default function Sidebar() {
  return (
    <aside className="flex h-full w-60 flex-col border-r border-brand-100 bg-white">
      <div className="flex items-center gap-2 px-5 py-6">
        <div className="h-8 w-8 rounded-lg bg-brand-600" />
        <span className="text-lg font-semibold text-brand-900">SmartPrinter</span>
      </div>
      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `block rounded-lg px-3 py-2 text-sm font-medium transition ${
                isActive ? "bg-brand-100 text-brand-800" : "text-brand-600 hover:bg-brand-50"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="px-5 py-4">
        <NavLink to="/logout" className="text-sm font-medium text-brand-500 hover:text-brand-700">
          Log out / Unpair
        </NavLink>
      </div>
    </aside>
  );
}
