import { BarChart2, CheckSquare, LayoutDashboard, ListTodo, Timer } from 'lucide-react';
import { NavLink } from 'react-router-dom';

const BottomNavigation = () => {
    const navItems = [
        { path: '/', label: 'Tracker', icon: LayoutDashboard },
        { path: '/todo', label: 'Todo', icon: ListTodo },
        { path: '/review', label: 'Review', icon: CheckSquare },
        { path: '/stats', label: 'Stats', icon: BarChart2 },
        { path: '/focus', label: 'Focus', icon: Timer },
    ];

    return (
        <nav className="fixed bottom-0 left-0 right-0 z-50 bg-app-surface border-t border-app-border pb-safe">
            <div className="flex justify-around items-center h-16">
                {navItems.map(({ path, label, icon: Icon }) => (
                    <NavLink
                        key={path}
                        to={path}
                        className={({ isActive }) => `
                            flex flex-col items-center justify-center w-full h-full space-y-1
                            transition-colors duration-200
                            ${isActive ? 'text-app-primary' : 'text-app-text-muted hover:text-app-text-main'}
                        `}
                    >
                        <Icon size={24} />
                        <span className="text-[10px] font-medium">{label}</span>
                    </NavLink>
                ))}
            </div>
        </nav>
    );
};

export default BottomNavigation;
