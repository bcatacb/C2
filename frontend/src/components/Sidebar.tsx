import { NavLink, useNavigate } from 'react-router-dom'
import { Inbox, Users, Target, Megaphone, Kanban, Zap, Settings, LogOut } from 'lucide-react'
import { cn } from '../lib/utils'

const links = [
  { to: '/app/unibox', label: 'Inbox', icon: Inbox },
  { to: '/app/accounts', label: 'Accounts', icon: Users },
  { to: '/app/leads', label: 'Leads', icon: Target },
  { to: '/app/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/app/pipeline', label: 'Pipeline', icon: Kanban },
  { to: '/app/automation', label: 'Automation', icon: Zap },
  { to: '/app/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const navigate = useNavigate()

  function handleLogout() {
    localStorage.removeItem('ui_token')
    navigate('/login')
  }

  return (
    <nav className="flex w-56 flex-col border-r border-zinc-800 bg-zinc-900 p-4">
      <div className="mb-8 text-lg font-semibold text-white">TokTik C2</div>
      <ul className="flex flex-1 flex-col gap-1">
        {links.map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                )
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
      <button
        onClick={handleLogout}
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300 transition-colors"
      >
        <LogOut size={18} />
        Logout
      </button>
    </nav>
  )
}
