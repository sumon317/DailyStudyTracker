import { BarChart2, LayoutDashboard, ListTodo, StickyNote, Timer } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const navItems = [
    { path: '/', label: 'Tracker', icon: LayoutDashboard },
    { path: '/todo', label: 'Todo', icon: ListTodo },
    { path: '/notes', label: 'Notes', icon: StickyNote },
    { path: '/stats', label: 'Stats', icon: BarChart2 },
    { path: '/focus', label: 'Focus', icon: Timer },
];

const BottomNavigation = () => {
    return (
        <nav
            aria-label="Primary navigation"
            className="bottom-navigation fixed bottom-0 left-0 right-0 z-50 border-t border-app-border bg-app-surface"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
            <ul className="flex h-16 items-center justify-around">
                {navItems.map(({ path, label, icon: Icon }) => (
                    <li key={path} className="h-full flex-1">
                        <NavLink
                            to={path}
                            end={path === '/'}
                            className={({ isActive }) =>
                                `group flex h-full w-full flex-col items-center justify-center py-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-app-primary ${
                                    isActive
                                        ? 'font-semibold text-app-primary'
                                        : 'text-app-text-muted hover:text-app-text-main'
                                }`
                            }
                        >
                            {({ isActive }) => (
                                <>
                                    <div
                                        className={`flex items-center justify-center rounded-full px-3.5 py-0.5 transition-colors duration-200 ${
                                            isActive
                                                ? 'bg-app-primary/15 text-app-primary'
                                                : 'text-app-text-muted group-hover:text-app-text-main'
                                        }`}
                                    >
                                        <Icon size={22} aria-hidden="true" />
                                    </div>
                                    <span className="text-[10px] font-medium tracking-tight">{label}</span>
                                    {isActive && <span className="sr-only">(current page)</span>}
                                </>
                            )}
                        </NavLink>
                    </li>
                ))}
            </ul>
        </nav>
    );
};

export default BottomNavigation;
