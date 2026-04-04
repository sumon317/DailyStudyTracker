import { Outlet } from 'react-router-dom';
import type { LayoutProps } from '../types';
import BottomNavigation from './BottomNavigation';

const Layout = ({ children }: LayoutProps) => {
    return (
        <div className="flex flex-col min-h-screen">
            {children}

            <main className="flex-1 pb-20">
                {' '}
                {/* Padding bottom for navigation bar */}
                <Outlet />
            </main>

            <BottomNavigation />
        </div>
    );
};

export default Layout;
